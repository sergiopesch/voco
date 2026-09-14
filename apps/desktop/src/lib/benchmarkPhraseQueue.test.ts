import {beforeEach,describe,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock('@tauri-apps/api/core',()=>({invoke:transport}));
import {appendOnlySuffix,BenchmarkPhraseQueue} from './benchmarkPhraseQueue';
const make=()=>{const paste=vi.fn(async(_s:string)=>{}),observed=vi.fn(),failure=vi.fn();return {paste,observed,failure,queue:new BenchmarkPhraseQueue(async()=>'',paste,observed,failure,vi.fn())};};
beforeEach(()=>{transport.mockReset().mockResolvedValue({});});
describe('pinned append-only candidate',()=>{
 it('extends partial words and punctuation without inventing spaces',()=>{
  expect(appendOnlySuffix('Every elevat','Every elevation')).toBe('ion');
  expect(appendOnlySuffix('Hello','Hello, world.')).toBe(', world.');
  expect(()=>appendOnlySuffix('I happen','I happened')).not.toThrow();
  expect(()=>appendOnlySuffix('Hello','hello.')).toThrow('revised');
 });
 it('appends exactly once and preserves final punctuation',async()=>{
  let n=0;transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Every elevation.':['Every elevat','Every elevation'][n++]}));
  const {queue,paste}=make();queue.pushAudio(new Float32Array(640),16000);queue.enqueue(new Float32Array());await queue.finish();
  expect(paste.mock.calls.map(c=>c[0]).join('')).toBe('Every elevation.');
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Every elevat','ion','.']);
 });
 it('retains a revision and refuses to paste it',async()=>{
  let n=0;transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['Hello','Hallo'][n++]}));
  const {queue,paste,observed,failure}=make();queue.pushAudio(new Float32Array(640),16000);await expect(queue.finish()).rejects.toThrow('revised');
  expect(paste).toHaveBeenCalledTimes(1);expect(observed).toHaveBeenLastCalledWith('Hallo');expect(failure).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith('benchmark_stream',{request:expect.objectContaining({op:'diagnostic',reason:'prefix_revision'})});
 });
 it('bounds queued audio and retains recovery without sending a partial backlog',async()=>{
  const {queue,failure}=make();queue.pushAudio(new Float32Array(16000*4),16000);
  await expect(queue.finish()).rejects.toThrow('three seconds');expect(failure).toHaveBeenCalledOnce();expect(transport).toHaveBeenCalledWith('benchmark_stream',{request:expect.objectContaining({op:'diagnostic',reason:'backlog_limit'})});
 });
 it('ignores an in-flight response after cancellation',async()=>{
  let resolve!:(x:unknown)=>void;let inflight:Record<string,unknown>={};
  transport.mockImplementation(async(_c,{request:r})=>r.op==='push'?new Promise(done=>{resolve=done;inflight=r;}):({...r,mode:'append-only',text:null}));
  const {queue,paste}=make();queue.pushAudio(new Float32Array(320),16000);
  await vi.waitFor(()=>expect(resolve).toBeDefined());queue.cancel();resolve({...inflight,mode:'append-only',text:'Late text'});await queue.finish();expect(paste).not.toHaveBeenCalled();
  expect(transport.mock.calls[transport.mock.calls.length-1]?.[1].request.op).toBe('cancel');
 });
 it('rejects stale response identity',async()=>{
  transport.mockImplementation(async(_c,{request:r})=>({...r,session:'stale',mode:'append-only',text:'Wrong'}));
  const {queue,paste}=make();await expect(queue.finish()).rejects.toThrow('Unexpected');expect(paste).not.toHaveBeenCalled();
 });
 it('keeps recognition moving during slow paste and coalesces only insertion',async()=>{
  let n=0;transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['Every','Every elevat','Every elevation.'][n++]}));
  let release!:()=>void;const pasted:string[]=[];
  const paste=vi.fn(async(text:string)=>{pasted.push(text);if(pasted.length===1)await new Promise<void>(done=>{release=done;});});
  const queue=new BenchmarkPhraseQueue(async()=>'',paste,vi.fn(),vi.fn(),vi.fn());
  queue.pushAudio(new Float32Array(960),16000);
  await vi.waitFor(()=>expect(transport).toHaveBeenCalledTimes(4));
  expect(paste).toHaveBeenCalledTimes(1);release();await queue.finish();
  expect(pasted).toEqual(['Every',' elevation.']);
 });

 it('preserves every sample across irregular callback boundaries and flushes the tail',async()=>{
  transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue}=make();
  const audio=Float32Array.from({length:1001},(_,i)=>i/1024);
  queue.pushAudio(audio.subarray(0,111),16000);
  queue.pushAudio(audio.subarray(111,878),16000);
  queue.pushAudio(audio.subarray(878),16000);
  queue.enqueue(new Float32Array());await queue.finish();
  const packets=transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='push');
  expect(packets.map(r=>r.audio.length)).toEqual([320,320,320,41]);
  expect(packets.flatMap(r=>r.audio)).toEqual(Array.from(audio));
 });
 it('rejects sample rate changes before the first complete packet',async()=>{
  transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue,failure}=make();queue.pushAudio(new Float32Array(100),16000);
  queue.pushAudio(new Float32Array(100),48000);
  await expect(queue.finish()).rejects.toThrow('sample rate changed');
  expect(failure).toHaveBeenCalledOnce();
  expect(transport.mock.calls.some(c=>c[1].request.op==='push')).toBe(false);
 });

 it('retains even a falsy transport rejection as a terminal failure',async()=>{
  transport.mockRejectedValue(undefined);
  const {queue,failure}=make();
  await expect(queue.finish()).rejects.toThrow('undefined');
  expect(failure).toHaveBeenCalledOnce();
 });
 it.each([8000,22050,44100,48000,96000])('keeps packet geometry at %i Hz',async rate=>{
  transport.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue}=make();const count=Math.round(rate*.02);
  const audio=Float32Array.from({length:count*2+7},(_,i)=>i/(count*3));
  queue.pushAudio(audio.subarray(0,3),rate);queue.pushAudio(audio.subarray(3),rate);
  queue.enqueue(new Float32Array());await queue.finish();
  const packets=transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='push');
  expect(packets.map(r=>r.audio.length)).toEqual([count,count,7]);
  expect(packets.every(r=>r.rate===rate)).toBe(true);
  expect(packets.flatMap(r=>r.audio)).toEqual(Array.from(audio));
 });

});
