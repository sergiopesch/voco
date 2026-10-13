import {beforeEach,describe,expect,it,vi} from 'vitest';
const transport=vi.hoisted(()=>vi.fn().mockResolvedValue({}));
vi.mock('@tauri-apps/api/core',()=>({invoke:transport}));
import {appendOnlySuffix,DictationStream,endsSentence,textLengths} from './dictationStream';
const worker=vi.fn();
const quality=()=>transport.mock.calls.map(c=>c[1].request).filter(r=>r.op==='quality');
const requests=()=>transport.mock.calls.map(c=>c[1].request).filter(r=>!['quality','diagnostic'].includes(r.op));
const noMutation={outcome:'no-mutation',message:'Physical modifiers are still held.',clipboardChanged:true};
const make=()=>{const paste=vi.fn(async(_s:string)=>{}),observed=vi.fn(),failure=vi.fn();return {paste,observed,failure,queue:new DictationStream(paste,observed,failure,vi.fn())};};
beforeEach(()=>{worker.mockReset().mockResolvedValue({});transport.mockReset().mockImplementation((c,args)=>['quality','diagnostic'].includes(args.request.op)?Promise.resolve({logged:true}):worker(c,args));});
describe('append-only dictation stream',()=>{
 it('knows a sentence end: . ? ! or …, perhaps before closing quotes or brackets',()=>{
  for(const text of ['Hello.','Really?','Wow!','Wait…','He said "go."','He said “go.”','It’s done.’','(See below.)','[Done!]','Between ten and eleven P.M.','And so...'])
   expect(endsSentence(text),text).toBe(true);
  // A text that already ends in a blank, a space or a control pasted as one, needs no other.
  for(const text of ['Hello','Hello. ','Hello.\n','Hello.\u001b','','Hi,','Wait;','Visit voco.dev','Pi is 3.14','"Quoted"','(An aside)','Done.)x'])
   expect(endsSentence(text),text).toBe(false);
 });
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
 it('ends every desktop paste inside the words, so no space is pasted alone or at an edge',async()=>{
  // Chromium's address bar strips the spaces around pasted text, and its
  // rich-text fields turn a space pasted alone into a no-break space.
  const hypotheses=()=>{let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Hello linux.':['Hello','Hello linux'][n++]}));};
  hypotheses();const field=vi.fn(async(_s:string)=>{});const exact=new DictationStream(field,vi.fn(),vi.fn(),vi.fn(),undefined,false);
  exact.pushAudio(new Float32Array(3200),16000);exact.enqueue();await exact.finish();
  // A browser field takes the words exactly, so its appends keep the space.
  expect(field.mock.calls.map(c=>c[0])).toEqual(['Hello',' linux','.']);
  hypotheses();transport.mockClear();const paste=vi.fn(async(_s:string)=>{});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(3200),16000);queue.enqueue();await queue.finish();
  // The last letter waits for the next words; the final text goes out whole.
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Hell','o linu','x.']);
  const requested=quality().filter(e=>e.event==='delivery_requested');
  expect(requested.map(e=>[e.hypothesis_seq,e.partial,e.committed_utf8_bytes,e.suffix_utf8_bytes,e.target_utf8_bytes]))
   .toEqual([[1,true,0,4,4],[2,true,4,6,10],[3,false,10,2,12]]);
  expect(quality().filter(e=>e.event==='delivery_dispatched').map(e=>e.committed_utf8_bytes)).toEqual([4,10,12]);
 });
 it('keeps every space of real speech inside a desktop paste',async()=>{
  // The worker's pushes for a public LibriSpeech clip (174-168635-0000).
  const pushes=['He had',' never',' been',' father',',',' lo','ver',',',' husband',',',' friend'];
  const final='He had never been father, lover, husband, friend.';
  let n=0;const texts=pushes.map((_p,i)=>pushes.slice(0,i+1).join(''));
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?final:texts[n++]}));
  const paste=vi.fn(async(_s:string)=>{});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(1600*pushes.length),16000);queue.enqueue();await queue.finish();
  const chunks=paste.mock.calls.map(c=>c[0]);
  expect(chunks).toEqual(['He ha','d neve','r bee','n fathe','r',', l','ove','r',', husban','d',', frien','d.']);
  expect(chunks.join('')).toBe(final);
  expect(chunks.every(chunk=>/^\S(?:[^]*\S)?$/.test(chunk))).toBe(true);
 });
 it('never splits a letter from its marks, a ZWJ sequence or a surrogate pair',async()=>{
  // Adéṣọ̀lá with every accent a combining mark: ọ̀ is o, a dot below and a grave.
  const name='Adéṣọ̀lá';
  const texts=['Adéṣọ̀',name+' met 👩‍💻',name+' met 👩‍💻👍'];
  const final=name+' met 👩‍💻👍 🇬🇧!';
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?final:texts[n++]}));
  const paste=vi.fn(async(_s:string)=>{});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(4800),16000);queue.enqueue();await queue.finish();
  const chunks=paste.mock.calls.map(c=>c[0]);
  expect(chunks).toEqual(['Adéṣ','ọ̀lá me','t 👩‍💻','👍 🇬🇧!']);
  expect(chunks.join('')).toBe(final);
  // No paste starts with a mark, a joiner or the second half of a surrogate pair.
  expect(chunks.some(chunk=>/^[\p{M}‍\udc00-\udfff]/u.test(chunk))).toBe(false);
 });
 it('leaves a trailing space for the words it joins',async()=>{
  // British spelling holds back an open word starting with "e" (aesthetic), so
  // a push can end in ", ".
  const hypotheses=()=>{let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Ernest Dowson, etcetera.':['Ernest Dowson','Ernest Dowson, '][n++]}));};
  hypotheses();const paste=vi.fn(async(_s:string)=>{});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(3200),16000);queue.enqueue();await queue.finish();
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Ernest Dowso','n',', etcetera.']);
  const requested=quality().filter(e=>e.event==='delivery_requested');
  expect(requested.map(e=>[e.hypothesis_seq,e.partial,e.target_utf8_bytes])).toEqual([[1,true,12],[2,true,13],[3,false,24]]);
  // A browser field appends the space with the words it joins, as the
  // extension refuses a url field that ends in one.
  hypotheses();transport.mockClear();const field=vi.fn(async(_s:string)=>{});
  const exact=new DictationStream(field,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,false);
  exact.pushAudio(new Float32Array(3200),16000);exact.enqueue();await exact.finish();
  expect(field.mock.calls.map(c=>c[0])).toEqual(['Ernest Dowson',',',' etcetera.']);
  expect(quality().filter(e=>e.event==='delivery_requested').map(e=>e.partial)).toEqual([false,true,false]);
 });
 it('pastes nothing while only a space is new, and the final text whole',async()=>{
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Hello ':['Hello','Hello '][n++]}));
  const paste=vi.fn(async(_s:string)=>{}),observed=vi.fn();
  const queue=new DictationStream(paste,observed,vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(3200),16000);
  await vi.waitFor(()=>expect(observed).toHaveBeenCalledTimes(2));
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Hell']);
  queue.enqueue();
  await expect(queue.finish()).resolves.toEqual({undelivered:'',uncertain:false,complete:true,text:'Hello '});
  // Nothing extends the final text, so it goes out whole, its trailing space too.
  expect(paste.mock.calls.map(c=>c[0])).toEqual(['Hell','o ']);
 });
 describe('quiet release',()=>{
  // The worker's text for each push packet (100 ms of audio); other packets bring no new words.
  const timeline=(byPacket:Record<number,string>,final:string)=>{let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?final:r.op==='push'?(byPacket[n++]??null):null}));};
  const pushes=()=>worker.mock.calls.filter(c=>c[1].request.op==='push').length;
  const packets=async(queue:DictationStream,count:number)=>{
   const before=pushes();queue.pushAudio(new Float32Array(1600*count),16000);
   await vi.waitFor(()=>expect(pushes()).toBe(before+count));await new Promise(resolve=>setTimeout(resolve,5));
  };
  const desktop=(paste:(text:string)=>Promise<void>)=>new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  const texts=(paste:ReturnType<typeof vi.fn>)=>paste.mock.calls.map(c=>c[0]);
  it('releases the held letter after a pause, then pastes the next joining space alone',async()=>{
   timeline({0:'Hello world',9:'Hello world and more'},'Hello world and more.');
   const paste=vi.fn(async(_s:string)=>{});const queue=desktop(paste);
   // 0.7 s without new words keeps the last letter; 0.8 s releases it.
   await packets(queue,8);expect(texts(paste)).toEqual(['Hello worl']);
   await packets(queue,1);expect(texts(paste)).toEqual(['Hello worl','d']);
   await packets(queue,1);expect(texts(paste)).toEqual(['Hello worl','d',' ','and mor']);
   queue.enqueue();await queue.finish();
   expect(texts(paste)).toEqual(['Hello worl','d',' ','and mor','e.']);
   expect(quality().filter(e=>e.event==='delivery_requested').map(e=>[e.hypothesis_seq,e.partial]))
    .toEqual([[1,true],[1,false],[10,true],[10,true],[11,false]]);
  });
  it('restarts the quiet count with every new hypothesis',async()=>{
   timeline({0:'Hello',6:'Hello world',12:'Hello world again'},'Hello world again.');
   const paste=vi.fn(async(_s:string)=>{});const queue=desktop(paste);
   // Ten quiet packets since "Hello", but only five since "Hello world".
   await packets(queue,12);expect(texts(paste)).toEqual(['Hell','o worl']);
   await packets(queue,9);expect(texts(paste)).toEqual(['Hell','o worl','d agai','n']);
   queue.enqueue();await queue.finish();
   expect(texts(paste)).toEqual(['Hell','o worl','d agai','n','.']);
  });
  it('keeps a trailing space for the next words, and pastes the final words after it alone first',async()=>{
   timeline({0:'Hello world, ',9:'Hello world, again'},'Hello world, again.');
   const paste=vi.fn(async(_s:string)=>{});const queue=desktop(paste);
   await packets(queue,9);expect(texts(paste)).toEqual(['Hello world',',']);
   await packets(queue,1);queue.enqueue();await queue.finish();
   expect(texts(paste)).toEqual(['Hello world',',',' ','agai','n.']);
   timeline({0:'Hello world'},'Hello world again.');
   const last=vi.fn(async(_s:string)=>{});const ended=desktop(last);
   await packets(ended,9);ended.enqueue();await ended.finish();
   // Nothing extends the final text, but its joining space still goes alone.
   expect(texts(last)).toEqual(['Hello worl','d',' ','again.']);
  });
  it('waits for a paste in flight and never releases after Stop or cancel',async()=>{
   timeline({0:'Hello world'},'Hello world.');
   let open=0,most=0,finishFirst=()=>{};
   const paste=vi.fn(async(text:string)=>{open++;most=Math.max(most,open);if(text==='Hello worl')await new Promise<void>(resolve=>{finishFirst=resolve;});open--;});
   const queue=desktop(paste);
   await packets(queue,9);
   // The release came while "Hello worl" was still being pasted, so it waits for it.
   expect(texts(paste)).toEqual(['Hello worl']);
   finishFirst();await vi.waitFor(()=>expect(texts(paste)).toEqual(['Hello worl','d']));
   queue.enqueue();await queue.finish();
   expect(texts(paste)).toEqual(['Hello worl','d','.']);expect(most).toBe(1);
   // Stop's tail packet would complete the quiet period, but Stop already took over.
   timeline({0:'Hello world'},'Hello world.');
   const stopped=vi.fn(async(_s:string)=>{});const atStop=desktop(stopped);
   await packets(atStop,8);atStop.pushAudio(new Float32Array(800),16000);atStop.enqueue();await atStop.finish();
   expect(texts(stopped)).toEqual(['Hello worl','d.']);
   timeline({0:'Hello world'},'Hello world.');
   const cancelled=vi.fn(async(_s:string)=>{});const gone=desktop(cancelled);
   await packets(gone,1);gone.cancel();gone.pushAudio(new Float32Array(1600*9),16000);
   await new Promise(resolve=>setTimeout(resolve,20));
   expect(texts(cancelled)).toEqual(['Hello worl']);
  });
 });
 it('counts a control character as the space it is pasted as, never at a paste edge',async()=>{
  // insertion.rs pastes ASCII controls as spaces, so one at an edge would be a
  // space the address bar strips.
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Hello\u001bworld.':['Hello\u001b','Hello\u001bworld'][n++]}));
  const paste=vi.fn(async(_s:string)=>{});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),undefined,true,false,true);
  queue.pushAudio(new Float32Array(3200),16000);queue.enqueue();await queue.finish();
  const chunks=paste.mock.calls.map(c=>c[0]);
  expect(chunks).toEqual(['Hell','o\u001bworl','d.']);
  expect(chunks.filter(c=>/^[\s\p{Cc}]|[\s\p{Cc}]$/u.test(c))).toEqual([]);
 });
 it('retains a revision and refuses to paste it',async()=>{
  let n=0;worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['Hello','Hallo'][n++]}));
  const {queue,paste,observed,failure}=make();queue.pushAudio(new Float32Array(3200),16000);await expect(queue.finish()).rejects.toThrow('revised');
  expect(paste).toHaveBeenCalledTimes(1);expect(observed).toHaveBeenLastCalledWith('Hallo');expect(failure).toHaveBeenCalledOnce();
  expect(transport).toHaveBeenCalledWith('speech_stream',{request:expect.objectContaining({op:'diagnostic',reason:'prefix_revision'})});
 });
 it('preserves the native insertion rejection message for recovery',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'Synthetic phrase':null}));
  const failure={outcome:'rejected',message:'Click in a text field and try again.',clipboardChanged:false};
  const onFailure=vi.fn();
  const queue=new DictationStream(async()=>{throw failure},vi.fn(),onFailure,vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);
  await expect(queue.finish()).resolves.toEqual({undelivered:'Synthetic phrase',uncertain:false,complete:false,text:''});
  expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({message:failure.message}),'delivery');
  expect(quality().find(e=>e.event==='delivery_failed')).toMatchObject({delivery_seq:1,outcome:'rejected'});
 });
 it('continues recognition and Stop tail after delivery fails without retrying insertion',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'First and later words.':r.sample_end<=1600?'First':'First and later words'}));
  const paste=vi.fn(async()=>{throw new Error('Destination changed');}),observed=vi.fn(),failure=vi.fn();
  const queue=new DictationStream(paste,observed,failure,vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(failure).toHaveBeenCalledOnce());
  queue.pushAudio(new Float32Array(1701),16000);queue.enqueue();
  await expect(queue.finish()).resolves.toEqual({undelivered:'First and later words.',uncertain:true,complete:false,text:''});
  expect(observed).toHaveBeenLastCalledWith('First and later words.');
  expect(failure.mock.calls[0]?.[0]).toMatchObject({message:'Destination changed'});
  expect(quality().find(e=>e.event==='delivery_failed')).toMatchObject({outcome:'uncertain'});
  expect(paste).toHaveBeenCalledOnce();
  expect(requests().filter(r=>r.op==='push').reduce((n,r)=>n+r.audio.length,0)).toBe(3301);
  expect(requests().filter(r=>r.op==='finish')).toHaveLength(1);
  expect(failure).toHaveBeenCalledOnce();
  expect(quality().filter(e=>e.event==='terminal').pop()).toMatchObject({outcome:'failed',finish_responded:true,responded_samples:3301,failed_delivery_seq:1});
 });
 it('defers a no-mutation paste and delivers the whole pending suffix once',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'Hello world.':r.sample_end<=1600?'Hello':'Hello world'}));
  const typed:string[]=[];
  const paste=vi.fn(async(text:string)=>{if(paste.mock.calls.length===1)throw noMutation;typed.push(text);});
  const failure=vi.fn(),preview=vi.fn();
  const queue=new DictationStream(paste,vi.fn(),failure,preview);
  queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(preview).toHaveBeenCalledWith('deferred'));
  queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();
  await expect(queue.finish()).resolves.toEqual({undelivered:'',uncertain:false,complete:true,text:'Hello world.'});
  expect(paste.mock.calls[0]?.[0]).toBe('Hello');
  expect(typed[0]).toMatch(/^Hello/);
  expect(typed.join('')).toBe('Hello world.');
  expect(failure).not.toHaveBeenCalled();
  expect(quality().filter(e=>e.event==='delivery_failed')).toEqual([expect.objectContaining({delivery_seq:1,outcome:'no-mutation'})]);
  expect(quality().filter(e=>e.event==='terminal').pop()).toMatchObject({outcome:'finished',accepted_equals_dispatched:true,failed_delivery_seq:null});
 });
 it('retries deferred text at Stop and succeeds without replaying it',async()=>{
  vi.useFakeTimers();
  try{
   worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'Hello':null}));
   const paste=vi.fn(async(_text:string)=>{if(paste.mock.calls.length===1)throw noMutation;});
   const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn());
   queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();
   const result=queue.finish();
   await vi.advanceTimersByTimeAsync(1000);
   await expect(result).resolves.toEqual({undelivered:'',uncertain:false,complete:true,text:'Hello'});
   expect(paste.mock.calls.map(c=>c[0])).toEqual(['Hello','Hello']);
  }finally{vi.useRealTimers();}
 });
 it('gives up after three Stop retries and returns deferred text as undelivered',async()=>{
  vi.useFakeTimers();
  try{
   worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'Hello':null}));
   const paste=vi.fn(async()=>{throw noMutation;});
   const failure=vi.fn(),preview=vi.fn();
   const queue=new DictationStream(paste,vi.fn(),failure,preview);
   queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();
   const result=queue.finish();
   await vi.advanceTimersByTimeAsync(1000);
   await expect(result).resolves.toEqual({undelivered:'Hello',uncertain:false,complete:false,text:''});
   expect(paste).toHaveBeenCalledTimes(4);
   expect(failure).not.toHaveBeenCalled();
   expect(preview.mock.calls.filter(c=>c[0]==='deferred')).toHaveLength(4);
   expect(quality().filter(e=>e.event==='delivery_failed').map(e=>e.outcome)).toEqual(Array(4).fill('no-mutation'));
   expect(quality().filter(e=>e.event==='terminal').pop()).toMatchObject({outcome:'finished',accepted_equals_dispatched:false,dispatched_count:0});
  }finally{vi.useRealTimers();}
 });
 it('never replays an uncertain chunk and returns it for the Stop copy',async()=>{
  vi.useFakeTimers();
  try{
   worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:r.op==='finish'?'One two.':'One'}));
   const paste=vi.fn(async()=>{throw {outcome:'uncertain',message:'Keyboard dispatch failed',clipboardChanged:true};});
   const failure=vi.fn();
   const queue=new DictationStream(paste,vi.fn(),failure,vi.fn());
   queue.pushAudio(new Float32Array(1600),16000);queue.enqueue();
   const result=queue.finish();
   await vi.advanceTimersByTimeAsync(1000);
   await expect(result).resolves.toEqual({undelivered:'One two.',uncertain:true,complete:false,text:''});
   expect(paste).toHaveBeenCalledOnce();
   expect(failure).toHaveBeenCalledOnce();
   expect(failure.mock.calls[0]?.[1]).toBe('delivery');
  }finally{vi.useRealTimers();}
 });
 it('still bounds recognition failure after a delivery interruption',async()=>{
  worker.mockImplementation(async(_c,{request:r})=>({...r,mode:'append-only',text:r.op==='push'?'First':null}));
  const paste=vi.fn(async()=>{throw new Error('Destination changed');}),failure=vi.fn();
  const queue=new DictationStream(paste,vi.fn(),failure,vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(failure).toHaveBeenCalledOnce());
  worker.mockRejectedValue(new Error('Worker unavailable'));
  queue.pushAudio(new Float32Array(3200),16000);queue.enqueue();
  await expect(queue.finish()).rejects.toThrow('Worker unavailable');
  expect(failure.mock.calls.map(call=>call[1])).toEqual(['delivery','recognition']);
  expect(paste).toHaveBeenCalledOnce();
  expect(requests().filter(r=>r.op==='push')).toHaveLength(2);
 });
 it('bounds queued audio and retains recovery without sending a partial backlog',async()=>{
  const {queue,failure}=make();queue.pushAudio(new Float32Array(16000*4),16000);
  await expect(queue.finish()).rejects.toThrow('three seconds');expect(failure).toHaveBeenCalledOnce();expect(transport).toHaveBeenCalledWith('speech_stream',{request:expect.objectContaining({op:'diagnostic',reason:'backlog_limit'})});
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
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn());
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
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn(),17);
  queue.pushAudio(new Float32Array(327),16000);queue.enqueue();await queue.finish();await queue.finish();
  const events=quality();
  const requested=events.find(e=>e.event==='delivery_requested');
  expect(paste).toHaveBeenCalledWith('Private_SENTINEL é😀', {session:requested.session,dictationSessionId:17,deliverySeq:1,hypothesisSeq:1});
  const terminal=events.filter(e=>e.event==='terminal');expect(terminal).toHaveLength(1);
  expect(terminal[0]).toMatchObject({outcome:'finished',accepted_equals_dispatched:true,captured_samples:327,enqueued_samples:327,responded_samples:327,buffered_samples:0,dispatched_count:1});
  // Rust records that a desktop paste never observes the field's content.
  expect(events.some(e=>'destination_content_observation' in e)).toBe(false);
  expect(JSON.stringify(events)).not.toContain('Private_SENTINEL');
  expect(events.every(e=>e.session===requested.session)).toBe(true);
 });
 it('reports coalescing and a pending delivery without mistaking it for lost recognition', async () => {
  let n=0;worker.mockImplementation(async (_c,{request:r}) => ({...r,mode:'append-only',text:r.op==='start'?null:['A','A b','A bc'][n++]}));
  let release!:()=>void;const paste=vi.fn(async()=>{if(paste.mock.calls.length===1)await new Promise<void>(done=>{release=done;});});
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(4800),16000);
  await vi.waitFor(()=>expect(requests()).toHaveLength(4));release();await queue.finish();
  const deliveries=quality().filter(e=>e.event==='delivery_requested');
  expect(deliveries.map(e=>[e.delivery_seq,e.hypothesis_seq,e.coalesced_hypotheses])).toEqual([[1,1,0],[2,3,1]]);
  expect(deliveries[1].pending_age_ms).toBeGreaterThanOrEqual(0);
  expect(quality()[quality().length-1]).toMatchObject({outcome:'incomplete',dispatched_count:2,accepted_equals_dispatched:true});
 });
 it('keeps uncertain delivery explicit and does not leak rejection content', async () => {
  worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:'secret_SENTINEL'}));
  const queue=new DictationStream(async()=>{throw new Error('secret_SENTINEL /private/path window title');},vi.fn(),vi.fn(),vi.fn());
  queue.pushAudio(new Float32Array(1600),16000);await expect(queue.finish()).resolves.toEqual({undelivered:'secret_SENTINEL',uncertain:true,complete:false,text:''});
  expect(quality().find(e=>e.event==='delivery_failed')).toMatchObject({delivery_seq:1,outcome:'uncertain'});
  expect(quality()[quality().length-1]).toMatchObject({outcome:'failed',failed_delivery_seq:1,pending_delivery_count:0,dispatched_count:0,accepted_equals_dispatched:false});
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
  const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(1600),16000);
  await vi.waitFor(()=>expect(release).toBeDefined());queue.cancel();
  expect(quality().some(e=>e.event==='terminal')).toBe(false);release();await queue.finish();
  expect(quality()[quality().length-1]).toMatchObject({outcome:'cancelled',dispatched_count:1});
 });
});


it('keeps coalesced delivery linked to a recorded hypothesis when identical replies repeat', async () => {
 let n=0;worker.mockImplementation(async (_c,{request:r})=>({...r,mode:'append-only',text:r.op==='start'?null:['A','A b','A b'][n++]}));
 let release!:()=>void;const paste=vi.fn(async()=>{if(paste.mock.calls.length===1)await new Promise<void>(done=>{release=done;});});
 const queue=new DictationStream(paste,vi.fn(),vi.fn(),vi.fn());queue.pushAudio(new Float32Array(4800),16000);
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
