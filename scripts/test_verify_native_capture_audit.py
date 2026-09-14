"""Adversarial numeric fixtures only; no capture, model, or private artifacts."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('verify-native-capture-audit.py')
spec = importlib.util.spec_from_file_location('audit_verifier', SCRIPT)
v = importlib.util.module_from_spec(spec); spec.loader.exec_module(v)

def encoded(value): return json.dumps(value, separators=(',', ':')).encode()

def fixture():
    identity = {'captureId':'native-1-1','sessionId':1,'generation':2}
    source = {'selectionToken':'[1,62,"test","62"]','name':'test','label':'Public numeric fixture',
              'index':62,'objectSerial':'62','isMonitor':False}
    d = {'schemaVersion':1,'guiPid':123,'optIn':{'nativeCaptureDev':True,'debugCaptureAudio':True,'debugNativeCapture':True},
         'descriptor':{**identity,'source':source,'format':'s16le','sampleRate':44100,'channels':2,
                       'channelMap':['front-left','front-right'],'frameBytes':4,'maxFrames':v.MAX_FRAMES}}
    def receipt(ack, stopped=False):
        return {'state':'stopped' if stopped else 'stopping','producedFrames':4,'lastSequence':2,
                'corkAcknowledged':stopped,'barrierAcknowledged':stopped,'health':{'healthy':True,'reason':None},
                'limitReached':False,'acknowledgedSequence':ack}
    raw = struct.pack('<hhhhhhhh',32767,-32768,200,-100,123,-123,-32768,-32768)
    block = lambda n: {'sequence':n+1,'frameStart':n*2,'frames':2,'byteOffset':n*8,'byteLength':8}
    def packet(blocks, r, pcm):
        header = encoded({'version':1,**identity,'blocks':blocks,'receipt':r})
        return struct.pack('<I',len(header))+header+pcm
    first = packet([block(0),block(1)],receipt(0),raw)
    last = packet([],receipt(2,True),b'')
    def event(n, ack, before, after, offset, data, replay=False):
        return {'ordinal':n,'kind':'drain','request':{**identity,'ackThroughSequence':ack},'ackAccepted':True,
                'acknowledgedBefore':before,'acknowledgedAfter':after,'packetOffset':offset,'packetBytes':len(data),'replay':replay}
    events=[event(0,0,0,0,0,first),event(1,0,0,0,len(first),first,True),
            {'ordinal':2,'kind':'stop','receipt':receipt(0,True)},event(3,2,0,2,2*len(first),last)]
    journal={'schemaVersion':1,'events':events,'termination':{'reason':'complete','receipt':receipt(2,True)},'complete':True,'incompleteReasons':[],'uniqueIssuedFrames':4,'uniqueIssuedSequences':2}
    return d,journal,first+first+last,raw

def write_bundle(root,d,j,packets,raw):
    root.mkdir(exist_ok=True)
    files={'descriptor.json':encoded(d),'journal.json':encoded(j),'packets.bin':packets,'raw.s16le':raw}
    for name,data in files.items(): (root/name).write_bytes(data)
    identity={k:d['descriptor'][k] for k in v.IDENTITY}
    commit={'schemaVersion':1,'kind':'native','metadata':{'guiPid':d['guiPid'],**identity},'complete':True,
            'files':{n:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for n,data in files.items()}}
    (root/'COMMIT.json').write_bytes(encoded(commit))

def write_renderer(root,d,raw,mono=None,change=None):
    root.mkdir(exist_ok=True)
    identity={k:d['descriptor'][k] for k in v.IDENTITY}
    capture={'backend':'native','sessionId':identity['sessionId'],'generation':identity['generation'],
             'sourceSampleRate':44100,'sourceChannels':2,'deliveredChannels':1,
             'sourceIdentity':json.dumps(d['descriptor']['source']),'conversion':'s16le-stereo-average'}
    meta={'schemaVersion':1,'guiPid':d['guiPid'],'optIn':d['optIn'],'nativeCaptureIdentity':identity,
          'captureDescriptor':capture,'stage':'renderer-retained-source-before-dc-resample','sampleFormat':'f32le',
          'sampleCount':len(raw)//4,'byteLength':len(raw),'terminalOutcome':'healthy-stop',**(change or {})}
    if mono is None:mono=b''.join(struct.pack('<f',(a+b)/65536) for a,b in struct.iter_unpack('<hh',raw))
    files={'renderer.json':encoded(meta),'source.f32le':mono}
    for name,data in files.items():(root/name).write_bytes(data)
    (root/'COMMIT.json').write_bytes(encoded({'schemaVersion':1,'kind':'renderer','complete':True,
        'metadata':{'guiPid':d['guiPid'],'identity':identity,'terminalOutcome':'healthy-stop'},
        'files':{name:{'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)} for name,data in files.items()}}))

class VerifyTests(unittest.TestCase):
    def check_mutation(self, mutate):
        d,j,p,r=fixture();expected=copy.deepcopy(d);d,j,p,r=mutate(d,j,p,r)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'native';write_bundle(root,d,j,p,r)
            with self.assertRaises(ValueError):v.verify_bundle(root,expected)

    def test_complete_exact_replay_and_numeric_mono(self):
        d,j,p,r=fixture()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'native';write_bundle(root,d,j,p,r)
            renderer=Path(temp)/'renderer';write_renderer(renderer,d,r)
            result=v.verify_bundle(root,d,renderer);self.assertEqual(result['frames'],4);self.assertTrue(result['rendererMonoCompared'])
            write_renderer(renderer,d,r,mono=b'\0'*16)
            with self.assertRaises(ValueError):v.verify_bundle(root,d,renderer)

    def test_renderer_identity_stage_tail_flags_and_commit(self):
        d,j,p,r=fixture()
        for field,value in [('terminalOutcome','interrupted'),('stage','after-dc'),('guiPid',999),('sampleCount',3)]:
            with self.subTest(field=field),tempfile.TemporaryDirectory() as temp:
                root=Path(temp)/'native';write_bundle(root,d,j,p,r);renderer=Path(temp)/'renderer';write_renderer(renderer,d,r,change={field:value})
                with self.assertRaises(ValueError):v.verify_bundle(root,d,renderer)
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'native';write_bundle(root,d,j,p,r);renderer=Path(temp)/'renderer';write_renderer(renderer,d,r)
            (renderer/'COMMIT.json').unlink()
            with self.assertRaises(ValueError):v.verify_bundle(root,d,renderer)

    def test_source_frame_gap_and_sequence_gap(self):
        for field in ('frameStart','sequence'):
            def change(d,j,p,r):
                size=j['events'][0]['packetBytes'];first=p[:size];n=struct.unpack_from('<I',first)[0]
                header=json.loads(first[4:4+n]);header['blocks'][1][field]+=1
                encoded_header=encoded(header);new=struct.pack('<I',len(encoded_header))+encoded_header+first[4+n:]
                j['events'][0]['packetBytes']=len(new);j['events'][1]['packetOffset']=len(new);j['events'][1]['packetBytes']=len(new);j['events'][-1]['packetOffset']=2*len(new)
                return d,j,new+new+p[2*size:],r
            self.check_mutation(change)

    def test_bool_identity_is_not_integer(self):
        def change(d,j,p,r):j['events'][0]['request']['sessionId']=True;return d,j,p,r
        self.check_mutation(change)

    def test_partial_ack(self):
        def change(d,j,p,r):j['events'][-1]['request']['ackThroughSequence']=1;return d,j,p,r
        self.check_mutation(change)

    def test_mutated_replay(self):
        def change(d,j,p,r):p=bytearray(p);p[j['events'][1]['packetOffset']+j['events'][1]['packetBytes']-1]^=1;return d,j,bytes(p),r
        self.check_mutation(change)

    def test_gap_in_packet_and_missing_tail(self):
        def change(d,j,p,r):j['events'][1]['packetOffset']+=1;return d,j,p,r
        self.check_mutation(change)
        self.check_mutation(lambda d,j,p,r:(d,j,p,r[:-4]))

    def test_extra_and_truncated_packet_bytes(self):
        for tail in (b'extra',None):
            self.check_mutation(lambda d,j,p,r:(d,j,p+tail if tail else p[:-1],r))

    def test_stale_session(self):
        def change(d,j,p,r):j['events'][0]['request']['sessionId']=2;return d,j,p,r
        self.check_mutation(change)

    def test_disabled_and_substituted_descriptor(self):
        def disabled(d,j,p,r):d['optIn']['debugNativeCapture']=False;return d,j,p,r
        self.check_mutation(disabled)
        def substituted(d,j,p,r):d['descriptor']['source']['objectSerial']='other';return d,j,p,r
        self.check_mutation(substituted)

    def test_unacked_and_missing_terminal(self):
        def change(d,j,p,r):j['events']=j['events'][:-1];return d,j,p[:j['events'][1]['packetOffset']+j['events'][1]['packetBytes']],r
        self.check_mutation(change)
        def no_barrier(d,j,p,r):j['termination']['receipt']['barrierAcknowledged']=False;return d,j,p,r
        self.check_mutation(no_barrier)

    def test_rejected_ack_is_never_healthy_proof(self):
        def change(d,j,p,r):j['events'][0]['kind']='drainRejected';return d,j,p,r
        self.check_mutation(change)

    def test_missing_commit_and_digest_substitution(self):
        d,j,p,r=fixture()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)/'native';write_bundle(root,d,j,p,r);(root/'raw.s16le').write_bytes(b'bad')
            with self.assertRaises(ValueError):v.verify_bundle(root,d)
            (root/'COMMIT.json').unlink()
            with self.assertRaises(ValueError):v.verify_bundle(root,d)

    def test_artifact_reader_refuses_links_and_fifo_without_blocking(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);file=root/'file';file.write_bytes(b'bytes')
            link=root/'link';link.symlink_to(file)
            with self.assertRaises(ValueError):v.read_bounded(link,100)
            link.unlink();os.link(file,link)
            with self.assertRaises(ValueError):v.read_bounded(file,100)
            fifo=root/'fifo';os.mkfifo(fifo)
            with self.assertRaises(ValueError):v.read_bounded(fifo,100)

    def test_uncommitted_extra_file_rejected(self):
        d,j,p,r=fixture()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);write_bundle(root,d,j,p,r);(root/'COMMIT.pending').write_text('partial')
            with self.assertRaises(ValueError):v.verify_bundle(root,d)

    def test_duplicate_json_key_rejected(self):
        with self.assertRaises(ValueError):v.decode_json(b'{"a":1,"a":2}')

    def test_cli_failure_retained_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);out=root/'result.json';args=[sys.executable,str(SCRIPT),'--bundle',str(root/'absent'),'--expected',str(root/'missing'),'--output',str(out)]
            self.assertEqual(subprocess.run(args,capture_output=True).returncode,1)
            before=out.read_bytes();self.assertFalse(json.loads(before)['passed'])
            self.assertNotEqual(subprocess.run(args,capture_output=True).returncode,0);self.assertEqual(out.read_bytes(),before)

if __name__=='__main__':unittest.main()
