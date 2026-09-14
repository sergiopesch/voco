#!/usr/bin/env python3
"""Offline CLI tests use public fixture PCM; no microphone or inference."""
import datetime as dt
import hashlib
import importlib.util
from unittest.mock import patch
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import wave

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / 'scripts/prepare-physical-speech-session.py'
FIXTURE = ROOT / 'tests/fixtures/speech/84-121123-0000.wav'

class SessionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest = self.root / 'session.json'
        self.run_cli('template', '--output', str(self.manifest))
        self.data = json.loads(self.manifest.read_text())
        now = dt.datetime.now(dt.timezone.utc)
        self.data['consent'].update(approved=True, participantAlias='synthetic-test', approvedAt=(now-dt.timedelta(minutes=1)).isoformat(), deleteAfter=(now+dt.timedelta(days=1)).isoformat())
        self.data['device'] = dict(alias='public-fixture', connection='synthetic-test-only', selectedInput='none', gainNotes='not recorded')
        self.data['environment'] = dict(distribution='test', desktopSession='none', audioServer='none')
        self.data['candidate'].update(guiSha256='1'*64, workerSha256='2'*64)
        self.data['aggregateMaxWer'] = .25
        self.data['cases'][0].update(status='recorded', originalWav=str(FIXTURE), originalSha256=hashlib.sha256(FIXTURE.read_bytes()).hexdigest(), referenceVerifiedAgainstRecording=True, maxWer=.25, captureNotes='Public fixture, no participant recording')
    def tearDown(self):
        self.temp.cleanup()
    def run_cli(self, *args, success=True):
        result = subprocess.run([sys.executable, str(TOOL), *args], env={**os.environ, 'PYTHONOPTIMIZE':'1'}, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return result
    def import_data(self, success=True):
        self.manifest.write_text(json.dumps(self.data))
        return self.run_cli('import', '--session', str(self.manifest), '--output-dir', str(self.root/'out'), success=success)
    def test_preserves_original_and_unrun_cases_with_private_modes(self):
        self.import_data()
        out = self.root/'out'
        self.assertEqual((out/'brief.original.wav').read_bytes(), FIXTURE.read_bytes())
        self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o700)
        self.assertTrue(all(stat.S_IMODE(p.stat().st_mode)==0o600 for p in out.iterdir()))
        status = json.loads((out/'status.json').read_text())
        self.assertEqual([c['status'] for c in status['cases']], ['imported-not-evaluated']+['not-run']*4)
        plan = json.loads((out/'plan.json').read_text())
        self.assertEqual(len(plan['cases']), 1)
        self.assertEqual(plan['combinedSha256'], hashlib.sha256((out/'combined.wav').read_bytes()).hexdigest())
    def test_preserves_explicit_derived_file_and_conversion_provenance(self):
        derived=self.root/'derived.wav'; derived.write_bytes(FIXTURE.read_bytes()+b'preserved trailing recorder metadata')
        self.data['cases'][0].update(replayWav='derived.wav', replaySha256=hashlib.sha256(derived.read_bytes()).hexdigest(), conversion='Test-only unchanged public PCM with retained trailing metadata')
        self.import_data()
        out=self.root/'out'
        self.assertEqual((out/'brief.derived-original.wav').read_bytes(),derived.read_bytes())
        plan=json.loads((out/'plan.json').read_text())
        self.assertEqual(plan['cases'][0]['source']['inputReplaySha256'],hashlib.sha256(derived.read_bytes()).hexdigest())
        self.assertNotEqual(plan['cases'][0]['sha256'],plan['cases'][0]['source']['inputReplaySha256'])

    def test_refuses_cropped_derived_audio(self):
        derived=self.root/'cropped.wav'
        with wave.open(str(FIXTURE),'rb') as source:
            pcm=source.readframes(source.getnframes())
        with wave.open(str(derived),'wb') as target:
            target.setparams((1,2,16000,0,'NONE','not compressed')); target.writeframes(pcm[:-3200])
        self.data['cases'][0].update(replayWav='cropped.wav', replaySha256=hashlib.sha256(derived.read_bytes()).hexdigest(), conversion='Incorrect cropped conversion')
        self.import_data(False)
        self.assertFalse((self.root/'out').exists())

    def test_refuses_missing_consent(self):
        self.data['consent']['approved']=False; self.import_data(False)
        self.assertFalse((self.root/'out').exists())
    def test_refuses_expired_retention(self):
        self.data['consent']['deleteAfter']='2000-01-01T00:00:00Z'; self.import_data(False)
    def test_refuses_unverified_reference(self):
        self.data['cases'][0]['referenceVerifiedAgainstRecording']=False; self.import_data(False)
    def test_refuses_mismatched_hash(self):
        self.data['cases'][0]['originalSha256']='0'*64; self.import_data(False)
    def test_refuses_symlink(self):
        link=self.root/'link.wav'; link.symlink_to(FIXTURE); self.data['cases'][0]['originalWav']=str(link); self.import_data(False)
    def test_refuses_fifo_without_hanging(self):
        fifo=self.root/'input.wav'; os.mkfifo(fifo); self.data['cases'][0]['originalWav']=str(fifo); self.import_data(False)
    def test_refuses_duplicate_and_traversal_case_ids(self):
        for ident in ['quiet','../escape']:
            with self.subTest(ident=ident):
                self.data['cases'][0]['id']=ident; self.import_data(False)
    def test_refuses_boolean_threshold(self):
        self.data['aggregateMaxWer']=True; self.import_data(False)
    def test_opened_descriptor_rejects_symlink_before_any_read(self):
        spec=importlib.util.spec_from_file_location('physical_import', TOOL)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        link=self.root/'raced.wav'; link.symlink_to(FIXTURE)
        with self.assertRaises(OSError):
            module.regular(link)
        fifo=self.root/'raced-fifo.wav'; os.mkfifo(fifo)
        with self.assertRaisesRegex(ValueError, 'regular non-symlink'):
            module.regular(fifo)

    def test_path_replacement_after_open_cannot_redirect_read(self):
        spec=importlib.util.spec_from_file_location('physical_import', TOOL)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        source=self.root/'replace.wav'; source.write_bytes(b'authorized bytes')
        other=self.root/'other.wav'; other.write_bytes(b'unrelated bytes')
        actual_fstat=module.os.fstat
        def replace_after_open(fd):
            info=actual_fstat(fd)
            source.unlink(); source.symlink_to(other)
            return info
        with patch.object(module.os,'fstat',replace_after_open):
            self.assertEqual(module.regular(source),b'authorized bytes')

    def test_growth_after_stat_stays_bounded(self):
        spec=importlib.util.spec_from_file_location('physical_import', TOOL)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        growing=self.root/'growing.wav'; growing.write_bytes(b'x'*64)
        actual_fstat=module.os.fstat
        def fake_size(fd):
            info=actual_fstat(fd)
            return type('Info', (), {'st_mode':info.st_mode, 'st_size':0})()
        with patch.object(module,'MAX_FILE_BYTES',32), patch.object(module.os,'fstat',fake_size):
            with self.assertRaisesRegex(ValueError, 'grew beyond'):
                module.regular(growing)

    def test_cumulative_original_metadata_budget_before_outputs(self):
        spec=importlib.util.spec_from_file_location('physical_import', TOOL)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        first=self.data['cases'][0]
        second=dict(first, id='second')
        self.data['cases']=[first,second]
        self.manifest.write_text(json.dumps(self.data))
        # Each file and the PCM alone fit; retained originals plus replay copies do not.
        limit=3*len(FIXTURE.read_bytes())
        with patch.object(module,'MAX_SESSION_AUDIO_BYTES',limit):
            with self.assertRaisesRegex(ValueError, 'Retained session audio'):
                module.prepare(self.manifest,self.root/'out')
        self.assertFalse((self.root/'out').exists())

    def test_refuses_overwrite(self):
        self.import_data(); before=(self.root/'out/plan.json').read_bytes(); self.import_data(False)
        self.assertEqual((self.root/'out/plan.json').read_bytes(),before)

if __name__ == '__main__':
    unittest.main()
