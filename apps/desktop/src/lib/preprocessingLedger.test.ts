import { expect, it } from "vitest";
import {beginPreparation,completePreparation,createLedger,rawPreviewAnchor,replaceAfterCacheClear} from "./preprocessingLedger";
const identity={sessionId:1,generation:0};
it("requires the exact final sample count after complete 30 and 29 second cores", () => {
 let ledger=createLedger(identity,48000);
 ledger=completePreparation(ledger,beginPreparation(ledger,0,30*48000,false),480000);
 ledger=completePreparation(ledger,beginPreparation(ledger,30*48000,59*48000,false),464000);
 const ticket=beginPreparation(ledger,59*48000,59*48000+6021,true);
 expect(()=>completePreparation(ledger,ticket,2008)).toThrow();
 ledger=completePreparation(ledger,ticket,2007);
 expect(ledger.blocks[2]?.preparedEnd).toBe(946007);
 expect(rawPreviewAnchor(ledger,identity,946007,946007)).toBe(59*48000+6021);
});
it.each([16000,44100,48000])("maps decoded coverage, not lookahead or overlap at %sHz",rate=>{
 let l=createLedger(identity,rate);l=completePreparation(l,beginPreparation(l,0,30*rate,false),480000);
 expect(rawPreviewAnchor(l,identity,112000,112000)).toBe(7*rate);
 expect(rawPreviewAnchor(l,identity,480000,464000)).toBe(30*rate);
 const n=12347,m=rate===16000?n:Math.ceil(n/rate*16000);
 l=completePreparation(l,beginPreparation(l,30*rate,30*rate+n,true),m);
 expect(rawPreviewAnchor(l,identity,480000+m,480000+m)).toBe(30*rate+n);
 for(const k of [1,Math.floor(m/2),m-1])expect(rawPreviewAnchor(l,identity,480000+k,480000+k)).toBe(30*rate+Number(BigInt(k)*BigInt(n)/BigInt(m)));
});
it("captures before await and rejects same-session invalidation without publishing",async()=>{
 let current=createLedger(identity,48000);const ticket=beginPreparation(current,0,1440000,false);
 let release!: (n:number)=>void;const work=new Promise<number>(resolve=>{release=resolve;}).then(n=>completePreparation(current,ticket,n));
 current=replaceAfterCacheClear(current,{sessionId:1,generation:1});release(480000);
 await expect(work).rejects.toThrow(/replaced/);expect(current.blocks).toHaveLength(0);
});
it("rejects duplicate tickets, invalid geometry and unexpected output counts",()=>{
 let l=createLedger(identity,48000);const t=beginPreparation(l,0,1440000,false),duplicate=beginPreparation(l,0,1440000,false);
 expect(()=>completePreparation(l,t,479999)).toThrow();l=completePreparation(l,t,480000);
 expect(()=>completePreparation(l,duplicate,480000)).toThrow();expect(()=>beginPreparation(l,1440001,1440300,true)).toThrow();
 expect(()=>rawPreviewAnchor(l,identity,480001,480001)).toThrow();expect(()=>replaceAfterCacheClear(l,identity)).toThrow();
});
it("preserves fractional-rate rounding and immutable metadata with no PCM operations",()=>{
 const rate=44100.5;let l=createLedger(identity,rate);const start=Math.round(30*rate);l=completePreparation(l,beginPreparation(l,0,start,false),480000);
 const n=23457,m=Math.ceil(n/rate*16000);l=completePreparation(l,beginPreparation(l,start,start+n,true),m);
 expect(Object.isFrozen(l.blocks[0])).toBe(true);
 for(let k=1;k<m;k+=17)expect(rawPreviewAnchor(l,identity,480000+k,480000+k)-start).toBeLessThanOrEqual(k*rate/16000);
 expect(rawPreviewAnchor(l,identity,480000+m,480000+m)).toBe(start+n);
});
