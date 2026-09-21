import {beforeEach,describe,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock('@tauri-apps/api/core',()=>({invoke:transport}));
import {appendOnlySuffix,BenchmarkPhraseQueue,textLengths} from './benchmarkPhraseQueue';
const worker=vi.fn();
const quality=()=>transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='quality');
const requests=()=>transport.mock.calls.map(c=>c[1].request).filter(r=>!['quality','diagnostic'].includes(r.op));
const make=()=>{const paste=vi.fn(async(_s:string)=>{}),observed=vi.fn(),failure=vi.fn();return {paste,observed,failure,queue:new BenchmarkPhraseQueue(paste,observed,failure,vi.fn())};};
beforeEach(()=>{worker.mockReset().mockResolvedValue({});transport.mockReset().mockImplementation((c,args)=>['quality','diagnostic'].includes(args.request.op)?Promise.resolve({logged:true}):worker(c,args));});
describe('pinned append-only candidate',()=>{
 it('extends partial words and punctuation without inventing spaces',()=>{
  expect(appendOnlySuffix('Every elevat','Every elevation')).toBe('ion');
  expect(appendOnlySuffix('Hello','Hello, world.')).toBe(', world.');
  expect(()=>appendOnlySuffix('I happen','I happened')).not.toThrow();
  expect(()=>appendOnlySuffix('Hello','hello.')).toThrow('revised');
 });
 it('appends exactly once and preserves final punctuation',async()=>{
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Every elevation.':['Every elevat','Every elevation'][n++]}));
  const {queue,paste}=make();queue.pushAudio(new Float32Array(3200),16000);queue.enqueue();await queue.finish();
  expect(paste.mock.calls.map(c=>c[0]).join('')).toBe('Every elevation.');
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Every elevat','ion','.']);
 });
 it('retains a revision and refuses to paste it',async()=>{
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['Hello','Hallo'][n++]}));
  const {queue,paste,observed,failure}=make();queue.pushAudio(new Float32Array(3200),16000);await expect(queue.finish()).rejects.toThrow('revised');
  expect(paste).toHaveBeenCalledTimes(1);expect(observed).toHaveBeenLastCalledWith('Hallo');expect(failure).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith('benchmark_stream',{request:expect.objectContaining({op:'diagnostic',reason:'prefix_revision'})});
 });
 it('preserves the native insertion rejection message for recovery',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'Synthetic phrase':null}));
  const failure={outcome:'rejected',message:'Click in a text field and try again.',clipboardChanged:false};
  const queue=new BenchmarkPhraseQueue(async()=>{throw failure},vi.fn(),vi.fn(),vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);
  await expect(queue.finish()).rejects.toThrow(failure.message);
 });
 it('bounds queued audio and retains recovery without sending a partial backlog',async()=>{
  const {queue,failure}=make();queue.pushAudio(new Float32Array(16000*4),16000);
  await expect(queue.finish()).rejects.toThrow('three seconds');expect(failure).toHaveBeenCalledOnce();expect(transport).toHaveBeenCalledWith('benchmark_stream',{request:expect.objectContaining({op:'diagnostic',reason:'backlog_limit'})});
 });
 it('ignores an in-flight response after cancellation',async()=>{
  let resolve!:(x:unknown)=>void;let inflight:Record<string,unknown>={};
  worker.mockImplementation(async(_c,{request:r})=>r.op==='push'?new Promise(done=>{resolve=done;inflight=r;}):({...r,mode:'append-only',text:null}));
  const {queue,paste}=make();queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(resolve).toBeDefined());queue.cancel();resolve({...inflight,mode:'append-only',text:'Late text'});await queue.finish();expect(paste).not.toHaveBeenCalled();
  expect(requests()[requests().length-1]?.op).toBe('cancel');
 });
 it('rejects stale response identity',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,session:'stale',mode:'append-only',text:'Wrong'}));
  const {queue,paste}=make();await expect(queue.finish()).rejects.toThrow('Unexpected');expect(paste).not.toHaveBeenCalled();
 });
 it('keeps recognition moving during slow paste and coalesces only insertion',async()=>{
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['Every','Every elevat','Every elevation.'][n++]}));
  let release!:()=>void;const pasted:string[]=[];
  const paste=vi.fn(async(text:string)=>{pasted.push(text);if(pasted.length===1)await new Promise<void>(done=>{release=done;});});
  const queue=new BenchmarkPhraseQueue(paste,vi.fn(),vi.fn(),vi.fn());
  queue.pushAudio(new Float32Array(4800),16000);
  await vi.waitFor(()=>expect(requests()).toHaveLength(4));
  expect(paste).toHaveBeenCalledTimes(1);release();await queue.finish();
  expect(pasted).toEqual(['Every',' elevation.']);
 });

 it('preserves every sample across irregular callback boundaries and flushes the tail',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue}=make();
  const audio=Float32Array.from({length:4841},(_,i)=>i/8192);
  queue.pushAudio(audio.subarray(0,111),16000);
  queue.pushAudio(audio.subarray(111,2878),16000);
  queue.pushAudio(audio.subarray(2878),16000);
  queue.enqueue();await queue.finish();
  const packets=transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='push');
  expect(packets.map(r=>r.audio.length)).toEqual([1600,1600,1600,41]);
  expect(packets.flatMap(r=>r.audio)).toEqual(Array.from(audio));
 });
 it('rejects sample rate changes before the first complete packet',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue,failure}=make();queue.pushAudio(new Float32Array(100),16000);
  queue.pushAudio(new Float32Array(100),48000);
  await expect(queue.finish()).rejects.toThrow('sample rate changed');
  expect(failure).toHaveBeenCalledOnce();
  expect(transport.mock.calls.some(c=>c[1].request.op==='push')).toBe(false);
 });

 it('retains even a falsy transport rejection as a terminal failure',async()=>{
  worker.mockRejectedValue(undefined);
  const {queue,failure}=make();
  await expect(queue.finish()).rejects.toThrow('undefined');
  expect(failure).toHaveBeenCalledOnce();
 });
 it.each([8000,22050,44100,48000,96000])('keeps packet geometry at %i Hz',async rate=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:null}));
  const {queue}=make();const count=Math.round(rate*.1);
  const audio=Float32Array.from({length:count*2+7},(_,i)=>i/(count*3));
  queue.pushAudio(audio.subarray(0,3),rate);queue.pushAudio(audio.subarray(3),rate);
  queue.enqueue();await queue.finish();
  const packets=transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='push');
  expect(packets.map(r=>r.audio.length)).toEqual([count,count,7]);
  expect(packets.every(r=>r.rate===rate)).toBe(true);
  expect(packets.flatMap(r=>r.audio)).toEqual(Array.from(audio));
 });

});


describe('privacy-preserving delivery attribution', () => {
 it('names text units explicitly for astral and multibyte characters', () => {
  expect(textLengths(' é😀', 'suffix')).toEqual({suffix_utf16_units:4,suffix_utf8_bytes:7,suffix_unicode_scalars:3});
 });
 it('correlates native paste identities and reconciles a completed stream without claiming field receipt', async () => {
  worker.mockImplementation(async (_c,{request:r}) => ({...r,mode:'append-only',text:r.op==='start'?null:'Private_SENTINEL é😀'}));
  const paste=vi.fn(async()=>{});
  const queue=new BenchmarkPhraseQueue(paste,vi.fn(),vi.fn(),vi.fn(),17);
  queue.pushAudio(new Float32Array(327),16000);queue.enqueue();await queue.finish();await queue.finish();
  const events=quality();
  const requested=events.find(e=>e.event==='delivery_requested');
  expect(paste).toHaveBeenCalledWith('Private_SENTINEL é😀', {session:requested.session,dictationSessionId:17,deliverySeq:1,hypothesisSeq:1});
  const terminal=events.filter(e=>e.event==='terminal');expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({outcome:'finished',accepted_equals_dispatched:true,captured_samples:327,enqueued_samples:327,responded_samples:327,buffered_samples:0,dispatched_count:1,destination_content_observation:'unavailable'});
  expect(JSON.stringify(events)).not.toContain('Private_SENTINEL');
  expect(events.every(e=>e.session===requested.session)).toBe(true);
 });
 it('reports coalescing and a pending delivery without mistaking it for lost recognition', async () => {
  let n=0;worker.mockImplementation(async (_c,{request:r}) => ({...r,mode:'append-only',text:r.op==='start'?null:['A','A b','A bc'][n++]}));
  let release!:()=>void;const paste=vi.fn(async()=>{if(paste.mock.calls.length===1)await new Promise<void>(done=>{release=done;});});
  const queue=new BenchmarkPhraseQueue(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(4800),16000);
  await vi.waitFor(()=>expect(requests()).toHaveLength(4));release();await queue.finish();
  const deliveries=quality().filter(e=>e.event==='delivery_requested');
  expect(deliveries.map(e=>[e.delivery_seq,e.hypothesis_seq,e.coalesced_hypotheses])).toEqual([[1,1,0],[2,3,1]]);
  expect(deliveries[1].pending_age_ms).toBeGreaterThanOrEqual(0);
  expect(quality()[quality().length-1]).toMatchObject({outcome:'incomplete',dispatched_count:2,accepted_equals_dispatched:true});
 });
 it('keeps uncertain delivery explicit and does not leak rejection content', async () => {
  worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:'secret_SENTINEL'}));
  const queue=new BenchmarkPhraseQueue(async()=>{throw new Error('secret_SENTINEL /private/path window title');},vi.fn(),vi.fn(),vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);await expect(queue.finish()).rejects.toThrow('secret_SENTINEL');
  expect(quality()[quality().length-1]).toMatchObject({outcome:'failed',failed_delivery_seq:1,pending_delivery_count:0,dispatched_count:0,accepted_equals_dispatched:false,destination_content_observation:'unavailable'});
  expect(JSON.stringify(quality())).not.toContain('SENTINEL');
 });
 it('keeps diagnostics rejection independent of successful dictation', async () => {
  transport.mockImplementation(async (_c,{request:r})=>{if(r.op==='quality')throw new Error('disk unavailable');return {...r,mode:'append-only',text:r.op==='start'?null:'Hello'};});
  const {queue,paste,failure}=make();queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();await queue.finish();
  expect(paste).toHaveBeenCalledOnce();expect(failure).not.toHaveBeenCalled();
 });
});


describe('bounded diagnostic transport', () => {
 it('drops excess diagnostic requests and reports gaps without blocking capture or paste', async () => {
  let n=0;const releases:Array<()=>void>=[];
  transport.mockImplementation(async (_c,{request:r})=>{
   if(r.op==='quality')return new Promise<void>(done=>releases.push(done));
   return {...r,mode:'append-only',text:r.op==='start'?null:'x'.repeat(++n)};
  });
  const {queue,paste}=make();queue.pushAudio(new Float32Array(1600*20),16000);
  await vi.waitFor(()=>expect(requests()).toHaveLength(21));
  expect(releases).toHaveLength(32);expect(paste).toHaveBeenCalledTimes(20);
  releases.forEach(release=>release());await Promise.resolve();await Promise.resolve();await Promise.resolve();
  queue.enqueue();await queue.finish();
  expect(quality()[quality().length-1]).toMatchObject({event:'terminal',outcome:'finished'});
  expect(quality()[quality().length-1].quality_dropped).toBeGreaterThan(0);
  releases.forEach(release=>release());
 });
});


describe('exact suffix preservation with attributed diagnostics', () => {
 it.each([
  ['Every elevat', 'Every elevation.'],
  ['Hello', 'Hello, world!'],
  ['I can', "I can't."],
  [' leading', ' leading  spaces '],
  ['line\n', 'line\n\tindent'],
  ['café', 'café 😀世界'],
  ['Unicode', 'Unicode\u00a0space\u2003end'],
  ['https://', 'https://example.test/a_b?x=2026-09-15'],
 ])('preserves the exact final payload for %j', async (first, final) => {
  worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?final:first}));
  const {queue,paste}=make();queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();await queue.finish();
  expect(paste.mock.calls.map(c=>c[0]).join('')).toBe(final);
  expect(quality()[quality().length-1]).toMatchObject({outcome:'finished',accepted_equals_dispatched:true,...textLengths(final,'dispatched')});
 });
 it('waits for an in-flight dispatch on cancellation and reports its weaker outcome', async () => {
  worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'Hello':null}));
  let release!:()=>void;const paste=vi.fn(async()=>new Promise<void>(done=>{release=done;}));
  const queue=new BenchmarkPhraseQueue(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(release).toBeDefined());queue.cancel();
  expect(quality().some(e=>e.event==='terminal')).toBe(false);release();await queue.finish();
  expect(quality()[quality().length-1]).toMatchObject({outcome:'cancelled',dispatched_count:1,destination_content_observation:'unavailable'});
 });
});


it('keeps coalesced delivery linked to a recorded hypothesis when identical replies repeat', async () => {
 let n=0;worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['A','A b','A b'][n++]}));
 let release!:()=>void;const paste=vi.fn(async()=>{if(paste.mock.calls.length===1)await new Promise<void>(done=>{release=done;});});
 const queue=new BenchmarkPhraseQueue(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(4800),16000);
 await vi.waitFor(()=>expect(requests()).toHaveLength(4));release();await queue.finish();
 const hypotheses=quality().filter(e=>e.event==='hypothesis').map(e=>e.hypothesis_seq);
 const deliveries=quality().filter(e=>e.event==='delivery_requested').map(e=>e.hypothesis_seq);
 expect(hypotheses).toEqual([1,2]);expect(deliveries).toEqual([1,2]);
});

it('uses ten ordered audio requests per second and flushes Stop without waiting for another callback', async () => {
 worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:null}));
 const {queue}=make();
 const audio=Float32Array.from({length:44117},(_,i)=>Math.sin(i/37));
 for(let offset=0;offset<audio.length;offset+=882) queue.pushAudio(audio.subarray(offset,offset+882),44100);
 queue.enqueue(); await queue.finish();
 const pushes=requests().filter(r=>r.op==='push');
 expect(pushes).toHaveLength(11);
 expect(pushes.slice(0,10).every(r=>r.audio.length===4410)).toBe(true);
 expect(pushes[10].audio.length).toBe(17);
 expect(pushes.flatMap(r=>r.audio)).toEqual(Array.from(audio));
 expect(requests()[requests().length-1]?.op).toBe('finish');
 expect(quality()[quality().length-1]).toMatchObject({captured_samples:44117,enqueued_samples:44117,responded_samples:44117,buffered_samples:0});
});

it('counts Unicode metrics without changing TextEncoder semantics', () => {
  const samples = ['', 'ASCII', 'é中😀', '\ud800', '\udc00', '\ud800A\udc00', '👩‍💻'];
  for (let point = 0; point <= 0x10ffff; point += 997) samples.push(String.fromCodePoint(point));
  for (const text of samples) expect(textLengths(text, 'text')).toEqual({
    text_utf16_units: text.length, text_utf8_bytes: new TextEncoder().encode(text).length,
    text_unicode_scalars: Array.from(text).length,
  });
});
