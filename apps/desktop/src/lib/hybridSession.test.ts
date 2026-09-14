import { expect, it } from "vitest";
import { beginHybridAttempt, completeHybridAttempt, createHybridSession, failHybridAttempt,
  HybridAttempt, invalidateHybridGeneration, nextHybridRange, prepareHybridRequest,
  type HybridSession, type HybridResponse } from "./hybridSession";

function start(s: HybridSession, n: number, finalizing = false) {
  return beginHybridAttempt(prepareHybridRequest(s, new Float32Array(n), finalizing));
}
function result(s: HybridSession, text: string): HybridResponse {
  const m=s.active!.metadata,end=m.nextInputStart+m.payloadSamples;
  const append=text?(s.canonicalText?" ":"")+text:"";
  return {protocolVersion:2,sessionId:m.sessionId,generation:m.generation,requestSequence:m.requestSequence,
    chunkText:text,canonicalText:s.canonicalText+append,appendText:append,
    receipt:{sequence:m.plannerSequence,inputStart:m.nextInputStart,inputEnd:end,
      previousDecodedEnd:m.previousDecodedEnd,leftJoinMode:m.plannerSequence===0?"initial":m.previousDecodedEnd===m.nextInputStart?"disjoint":"legacyOverlap",
      rightBoundaryMode:m.payloadSamples===480000?"legacyStride":"final",plateauStart:null,plateauEnd:null,
      nextInputStart:m.payloadSamples===480000?end-16000:end}};
}
function payload(a: HybridAttempt) {
  const bytes=a.packet(),n=new DataView(bytes.buffer).getUint32(4,true);
  return {metadata:JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+n))),audio:bytes.slice(8+n)};
}
it("owns finite PCM bits and immutable metadata independently of caller mutations",()=>{
  const audio=new Float32Array([-0,Math.fround(1.401298464324817e-45),.125]);
  const s=beginHybridAttempt(prepareHybridRequest(createHybridSession(1,0),audio,true));
  const before=payload(s.active!);audio.fill(9);s.active!.packet().fill(0);
  expect(payload(s.active!).audio).toEqual(before.audio);
  expect(new DataView(before.audio.buffer).getUint32(0,true)).toBe(0x80000000);
  expect(new DataView(before.audio.buffer).getUint32(4,true)).toBe(1);
  const metadata={...s.active!.metadata},raw=new Uint8Array(12),attempt=new HybridAttempt(metadata,raw);
  metadata.generation=9;raw.fill(9);
  expect(attempt.metadata.generation).toBe(0);expect(payload(attempt).metadata.generation).toBe(0);
  expect(payload(attempt).audio).toEqual(new Uint8Array(12));
});
it("retries exact failed bytes and prefix with a distinct attempt, not a committed sequence",()=>{
  let s=start(createHybridSession(1,0),480000);s=completeHybridAttempt(s,s.active!,result(s,"First.")).session;
  s=start(s,480000);const attempt=s.active!,first=payload(attempt),pending=s.pending;
  s=failHybridAttempt(s,attempt);expect(s.pending).toBe(pending);
  expect(()=>prepareHybridRequest(s,new Float32Array(480000),true)).toThrow();
  s=beginHybridAttempt(s);expect(payload(s.active!).audio).toEqual(first.audio);
  expect(s.active!.metadata.requestSequence).toBe(3);expect(s.active!.metadata.plannerSequence).toBe(1);
  expect(s.active!.metadata.previousCanonicalText).toBe("First.");
  expect(()=>completeHybridAttempt(s,attempt,result(s,"Second."))).toThrow();
});
it("rejects stale and malformed receipts without consuming recovery",()=>{
 const s=start(createHybridSession(2,3),32000,true),good=result(s,"Hello.");
 for(const bad of [{...good,generation:4},{...good,receipt:{...good.receipt,inputEnd:32001}},
  {...good,receipt:{...good.receipt,nextInputStart:0}},{...good,canonicalText:"rewrite"},{...good,error:null}]) {
  expect(()=>completeHybridAttempt(s,s.active!,bad)).toThrow();expect(s.pending).not.toBeNull();
 }
 const cleared=invalidateHybridGeneration(s,4);
 expect(()=>completeHybridAttempt(cleared,s.active!,good)).toThrow();
 expect(()=>failHybridAttempt(cleared,s.active!)).toThrow();
 expect(cleared.pending).toBeNull();expect(()=>invalidateHybridGeneration(cleared,4)).toThrow();
});
it("finishes exact30 without overlap-only decode and admits one new sample with context",()=>{
 let s=start(createHybridSession(1,0),480000,true);s=completeHybridAttempt(s,s.active!,result(s,"Done.")).session;
 expect(nextHybridRange(s,480000,true)).toBeNull();expect(nextHybridRange(s,480001,true)).toEqual({startSample:464000,endSample:480001});
 expect(()=>prepareHybridRequest(s,new Float32Array(16000),true)).toThrow(/no new audio/);
 s=start(s,16001,true);s=completeHybridAttempt(s,s.active!,result(s,"")).session;
 expect(s.progress.plannerFinalized).toBe(true);expect(()=>nextHybridRange(s,480002,true)).toThrow();
});
it("keeps committed text after generation invalidation and rejects invalid requests",()=>{
 let s=start(createHybridSession(1,0),16000,true);s=completeHybridAttempt(s,s.active!,result(s,"Retained.")).session;
 const cleared=invalidateHybridGeneration(s,1);expect(cleared.canonicalText).toBe("Retained.");expect(cleared.progress).toEqual(s.progress);
 for(const audio of [new Float32Array(),new Float32Array(480001),new Float32Array([NaN]),new Float32Array([Infinity])])expect(()=>prepareHybridRequest(createHybridSession(1,0),audio,true)).toThrow();
 expect(()=>prepareHybridRequest(createHybridSession(1,0),new Float32Array(100),false)).toThrow();
});
