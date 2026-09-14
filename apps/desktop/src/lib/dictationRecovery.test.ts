import { expect, it } from "vitest";
import { beginCanonicalTranscription, captureCanonicalPreparation, completeCanonicalTranscription,
  createCanonicalCursorSession, failCanonicalSession, failCanonicalTranscription, finishCanonicalSession,
  invalidateCanonicalCache, planCanonicalWork, planNextCompleteSourceBlock, recordCanonicalSourceBlock,
  requestCanonicalStop, type CanonicalCursorSession } from "./canonicalCursorSession";
import {captureSampleLimit,errorMessage,MAX_CAPTURE_SAMPLES,resumeCanonicalForRecovery}from"./dictationRecovery";
function cached() {
 let s=createCanonicalCursorSession(3,16000);const block=planNextCompleteSourceBlock(s,480000)!;
 s=recordCanonicalSourceBlock(s,block,480000,captureCanonicalPreparation(s,block));
 return beginCanonicalTranscription(s,new Float32Array(480000));
}
function complete(s:CanonicalCursorSession) {
 const a=s.recognition.active!,m=a.metadata;
 return completeCanonicalTranscription(s,a,{protocolVersion:2,sessionId:3,generation:0,requestSequence:m.requestSequence,
  canonicalText:"Retained transcript.",appendText:"Retained transcript.",chunkText:"Retained transcript.",
  receipt:{sequence:0,inputStart:0,inputEnd:480000,previousDecodedEnd:0,leftJoinMode:"initial",rightBoundaryMode:"legacyStride",plateauStart:null,plateauEnd:null,nextInputStart:464000}});
}
it("waits active recognition and retries the same pending audio without target ownership",()=>{
 const active=cached(),attempt=active.recognition.active!,pending=active.recognition.pending;
 const waiting=resumeCanonicalForRecovery(failCanonicalSession(active));
 expect(waiting.recognition.active).toBe(attempt);expect(planCanonicalWork(waiting,true)).toBeNull();
 const failed=failCanonicalTranscription(waiting,attempt),retry=resumeCanonicalForRecovery(failed);
 expect(planCanonicalWork(retry,true)).toEqual({kind:"retry",pending});expect(retry.delivery).toBe("uncertain");
 const next=beginCanonicalTranscription(retry);expect(next.recognition.pending).toBe(pending);
 expect(next.recognition.active!.metadata.requestSequence).toBe(2);expect(next.recognition.progress.plannerSequence).toBe(0);
});
it("complete→drain→delivery failure→manual recovery keeps transcript without decoding",()=>{
 let s=finishCanonicalSession(requestCanonicalStop(complete(cached())),480000);
 s=invalidateCanonicalCache(s,1);expect(s.cacheReleased).toBe(true);expect(s.ledger).toBeNull();
 const failed=failCanonicalSession(s),recovery=resumeCanonicalForRecovery(failed);
 expect(recovery.phase).toBe("complete");expect(recovery.recognition.canonicalText).toBe("Retained transcript.");
 expect(recovery.delivery).toBe("uncertain");expect(recovery.recognition.pending).toBeNull();
 expect(recovery.recognition.progress.plannerSequence).toBe(1);expect(recovery.recognition.requestSequence).toBe(1);
 expect(()=>planCanonicalWork(recovery,true)).toThrow(/released/);
});
it("bounds source memory and preserves structured target errors",()=>{
 expect(captureSampleLimit(16000)).toBe(9600000);expect(captureSampleLimit(48000)).toBe(28800000);
 expect(captureSampleLimit(192000)).toBe(MAX_CAPTURE_SAMPLES);
 expect(errorMessage({message:"Target may contain text."})).toBe("Target may contain text.");
});
