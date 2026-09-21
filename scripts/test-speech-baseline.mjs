#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn, execFileSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {scoreTranscript, validateSpeechFixtureWav, validateSpeechManifest} from './speech-score.mjs';
import {buildRepeatedSpeech, checkRepeatedContinuity} from './test-speech-continuity.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(args.length && (args.length!==2 || args[0]!=='--report' || !args[1])) throw Error('Usage: test-speech-baseline.mjs [--report NEW-report.json]');
const reportPath=args[1] && path.resolve(args[1]);
if(reportPath && fs.existsSync(reportPath)) throw Error('Choose a new report path to preserve previous evidence');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hashFile=file=>hash(fs.readFileSync(file));
const identity=JSON.parse(fs.readFileSync(path.join(root,'runtime/speech/MODEL-IDENTITY.json')));
const model=process.env.VOCO_NEMOTRON_MODEL || path.join(root,'runtime/speech/models/nemotron-speech-streaming-en-0.6b.q8_0.gguf');
if(!fs.existsSync(model) || hashFile(model)!==identity.model_sha256) throw Error('Provision the pinned Nemotron payload first. This test never downloads a model.');
const fixtureDir=path.join(root,'tests/fixtures/speech');
const manifestPath=path.join(fixtureDir,'manifest.json');
// Corpus identity and thresholds stay fixed; the report identifies the new engine.
const manifest=validateSpeechManifest(JSON.parse(fs.readFileSync(manifestPath)));
const pcm=wav=>Array.from({length:(wav.length-44)/2},(_,i)=>wav.readInt16LE(44+i*2)/32768);
const fixtures=manifest.fixtures.map(f=>{
  const file=path.join(fixtureDir,f.file), relative=path.relative(fs.realpathSync(fixtureDir),fs.realpathSync(file));
  if(relative.startsWith('..') || path.isAbsolute(relative) || hashFile(file)!==f.sha256) throw Error('Fixture identity mismatch');
  const wav=fs.readFileSync(file);validateSpeechFixtureWav(wav,f.seconds);
  return {...f,wav,audio:pcm(wav)};
});
const state=fs.mkdtempSync(path.join(os.tmpdir(),'voco-nemotron-regression-'));
const worker=path.join(root,'runtime/speech/stream_worker.py');
const child=spawn(process.env.VOCO_PYTHON || '/usr/bin/python3',[worker],{
  env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',VOCO_NEMOTRON_MODEL:model,XDG_STATE_HOME:state,VOCO_SPEECH_PERF:'0'},stdio:['pipe','pipe','pipe'],
});
child.stdin.on('error',()=>{});
let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});
const exited=new Promise(resolve=>{child.once('error',error=>resolve({error:error.message}));child.once('close',(code,signal)=>resolve({code,signal}));});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
const report={schemaVersion:3,startedAt:new Date().toISOString(),modelSha256:identity.model_sha256,
  manifestSha256:hashFile(manifestPath),workerSha256:hashFile(worker),nativeBuildSha256:hashFile(path.join(root,'runtime/speech/NATIVE-BUILD.json')),
  source:{gitHead:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),gitDirty:Boolean(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim())},
  note:'Pinned Nemotron, production streaming worker, 100 ms packets, original corpus thresholds. Excludes microphones, Tauri IPC and field delivery. Historical Whisper evidence is not requalified.',
  fixtures:[],silence:[],variants:[],continuity:null,passed:false};
async function read(){
  let timer;
  try {
    const line=await Promise.race([lines.next(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recognizer response deadline exceeded')),120000);})]);
    if(line.done) throw Error(`Recognizer exited: ${stderr}`);
    return JSON.parse(line.value);
  } finally {clearTimeout(timer);}
}
async function exchange(request){
  child.stdin.write(JSON.stringify(request)+'\n');
  const r=await read();
  if(r.error || r.session!==request.session || r.seq!==request.seq || r.mode!=='append-only' || (r.text!==null && typeof r.text!=='string')) throw Error('Invalid recognizer response');
  return r.text;
}
async function transcribe(audio){
  const session=crypto.randomUUID(),started=performance.now();let seq=0,text='',hypotheses=0;
  async function request(op,chunk){
    const next=await exchange({op,session,seq:seq++,...(chunk?{audio:chunk,rate:16000}:{})});
    if(next!==null){if(!next.startsWith(text)) throw Error('Recognizer revised a committed prefix');text=next;hypotheses++;}
    if(op==='finish' && next===null) throw Error('Missing final transcript');
  }
  await request('start');
  for(let offset=0;offset<audio.length;offset+=1600) await request('push',audio.slice(offset,offset+1600));
  await request('finish');return {text,hypotheses,samples:audio.length,elapsedMs:Math.round(performance.now()-started)};
}
try{
  const ready=await read();
  if(ready.ready!==true) throw Error(`Recognizer failed to warm up: ${stderr}`);
  let edits=0,words=0;
  for(const f of fixtures){
    const result=await transcribe(f.audio),score=scoreTranscript(f.reference,result.text),passed=score.hypothesisWords>0 && score.wer<=f.maxWer;
    report.fixtures.push({id:f.id,...result,score,maxWer:f.maxWer,passed});edits+=score.edits;words+=score.referenceWords;
    console.log(`${passed?'PASS':'FAIL'} ${f.id}: WER ${(score.wer*100).toFixed(2)}%`);
  }
  report.aggregateWer=edits/words;report.maxAggregateWer=manifest.maxAggregateWer;
  const short=fixtures.find(f=>f.id==='84-121123-0000');if(!short) throw Error('Missing fixed continuity fixture');
  const repeated=buildRepeatedSpeech(short.wav,short.seconds),result=await transcribe(pcm(repeated));
  report.continuity={...result,...checkRepeatedContinuity(Array(18).fill(short.reference).join(' '),result.text,short.reference),wavSha256:hash(repeated)};
  console.log(`${report.continuity.passed?'PASS':'FAIL'} repeated speech`);
  for(const seconds of [10,20,30]){const result=await transcribe(Array(seconds*16000).fill(0));report.silence.push({seconds,...result,passed:result.text===''});}
  for(const [name,audio] of [['quiet',short.audio.map(x=>x*0.1)],['leading-silence',[...Array(16000).fill(0),...short.audio]],['trailing-silence',[...short.audio,...Array(16000).fill(0)]],['partial-stop-packet',short.audio]]){
    const result=await transcribe(audio),score=scoreTranscript(short.reference,result.text);
    report.variants.push({name,...result,score,passed:score.hypothesisWords>0 && score.wer<=short.maxWer});
  }
  report.passed=report.fixtures.every(r=>r.passed) && report.silence.every(r=>r.passed) && report.variants.every(r=>r.passed) && report.continuity.passed && report.aggregateWer<=manifest.maxAggregateWer;
}catch(error){report.error=error.message;}
finally{
  child.stdin.end();const timer=setTimeout(()=>child.kill('SIGKILL'),5000);const exit=await exited;clearTimeout(timer);
  if(exit.code!==0){report.passed=false;report.workerExit=exit;}
  if(reportPath) fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  fs.rmSync(state,{recursive:true,force:true});
}
console.log(JSON.stringify({passed:report.passed,aggregateWer:report.aggregateWer,error:report.error}));process.exitCode=report.passed?0:1;
