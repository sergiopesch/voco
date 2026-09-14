import { describe, expect, it, vi } from "vitest";
import { beginNativeCapture, nativeStereoToMono, parseNativeBatch, type NativeCaptureApi, type NativeCaptureIdentity, type NativeCaptureReceipt } from "./nativeCapture";
const identity: NativeCaptureIdentity = {captureId:"capture-1",sessionId:1,generation:0};
const source = {selectionToken:"chosen",name:"source",label:"Microphone",index:4,objectSerial:"99",isMonitor:false};
const descriptor = {...identity,source,format:"s16le",sampleRate:44100,channels:2,channelMap:["front-left","front-right"],frameBytes:4,maxFrames:26460000};
function receipt(ack=0, stopped=true, healthy=true): NativeCaptureReceipt {
  return {state:stopped?"stopped":"stopping",producedFrames:2,lastSequence:1,corkAcknowledged:stopped,
    barrierAcknowledged:stopped,limitReached:false,acknowledgedSequence:ack,health:{healthy,reason:healthy?null:"source moved"}};
}
function packet(ack=0, include=true, changes: Record<string,unknown>={}): Uint8Array {
  const blocks=include?[{sequence:1,frameStart:0,frames:2,byteOffset:0,byteLength:8}]:[];
  const header=new TextEncoder().encode(JSON.stringify({version:1,...identity,blocks,receipt:receipt(ack),...changes}));
  const raw=new Uint8Array(4+header.length+(include?8:0));const view=new DataView(raw.buffer);view.setUint32(0,header.length,true);raw.set(header,4);
  if(include){view.setInt16(4+header.length,16384,true);view.setInt16(6+header.length,0,true);view.setInt16(8+header.length,-32768,true);view.setInt16(10+header.length,-32768,true);}
  return raw;
}
function mockApi(): NativeCaptureApi {
  return {begin:vi.fn(async()=>descriptor),stop:vi.fn(async()=>receipt()),cancel:vi.fn(async()=>undefined),
    drain:vi.fn(async request=>packet(request.ackThroughSequence,request.ackThroughSequence===0))};
}
function callbacks(api:NativeCaptureApi) {
  return {sessionId:1,generation:0,selectionToken:"chosen",api,pollMs:1,timeoutMs:50,
    onSamples:vi.fn((samples:Float32Array)=>samples.length),onInterrupted:vi.fn(),onLimit:vi.fn()};
}
describe("native capture protocol and ownership",()=>{
  it("binds complete packet identity, bounded extents and unknown fields",()=>{
    expect(parseNativeBatch(packet(),identity).blocks.length).toBe(1);
    for(const changes of [{sessionId:2},{version:2},{extra:true},{blocks:[{sequence:1,frameStart:0,frames:2,byteOffset:1,byteLength:8}]}])
      expect(()=>parseNativeBatch(packet(0,true,changes),identity)).toThrow();
    const extra=new Uint8Array(packet().length+1);extra.set(packet());expect(()=>parseNativeBatch(extra,identity)).toThrow();
    expect(()=>parseNativeBatch([256],identity)).toThrow();
  });
  it("converts unequal, antiphase and full-scale stereo without overflow",()=>{
    const bytes=new Uint8Array(12),v=new DataView(bytes.buffer);
    [[32767,-32767],[-32768,-32768],[16384,0]].forEach((pair,i)=>pair.forEach((n,c)=>v.setInt16(i*4+c*2,n,true)));
    expect([...nativeStereoToMono(bytes)]).toEqual([0,-1,.25]);
  });
  it("does not drain before activation and confirms final ACK before stop success",async()=>{
    const api=mockApi(),opts=callbacks(api),session=await beginNativeCapture(opts);
    expect(api.drain).not.toHaveBeenCalled();
    const done=await session.stopAndDrain();
    expect(opts.onSamples).toHaveBeenCalledTimes(1);
    expect([...opts.onSamples.mock.calls[0]![0]]).toEqual([.25,-1]);
    expect(done.acknowledgedSequence).toBe(1);
    expect(api.drain).toHaveBeenNthCalledWith(2,{...identity,ackThroughSequence:1});
    expect(await session.stopAndDrain()).toBe(done);expect(api.cancel).not.toHaveBeenCalled();
  });
  it("accepts exact replay without appending twice and rejects changed replay",async()=>{
    for(const changed of [false,true]) {
      const api=mockApi();let count=0;
      api.drain=vi.fn(async()=>{count++;if(count===1)return packet();if(count===2){const p=packet();if(changed)p[p.length-1]=(p[p.length-1] ?? 0)^1;return p;}return packet(1,false);});
      const opts=callbacks(api),session=await beginNativeCapture(opts);
      if(changed)await expect(session.stopAndDrain()).rejects.toThrow("Conflicting");
      else await session.stopAndDrain();
      expect(opts.onSamples).toHaveBeenCalledTimes(1);
    }
  });
  it("never ACKs a partially retained block",async()=>{
    const api=mockApi(),opts=callbacks(api);opts.onSamples.mockImplementation(()=>1);
    const session=await beginNativeCapture(opts);
    await expect(session.stopAndDrain()).rejects.toThrow("not fully retained");
    expect(api.drain).toHaveBeenCalledTimes(1);expect(opts.onInterrupted).toHaveBeenCalledOnce();
  });
  it("invalidates output immediately on unhealthy receipt but drains received prefix",async()=>{
    const api=mockApi();api.stop=vi.fn(async()=>receipt(0,true,false));
    const opts=callbacks(api),events:string[]=[];opts.onInterrupted.mockImplementation(()=>events.push('invalid'));
    opts.onSamples.mockImplementation(samples=>{events.push('samples');return samples.length;});
    const session=await beginNativeCapture(opts);await expect(session.stopAndDrain()).rejects.toThrow('source moved');
    expect(events).toEqual(['invalid','samples']);expect(api.cancel).not.toHaveBeenCalled();
  });
  it("rejects delivery gaps and future ACKs",async()=>{
    for(const bad of [packet(1),packet(0,true,{blocks:[{sequence:2,frameStart:2,frames:2,byteOffset:0,byteLength:8}],receipt:{...receipt(),lastSequence:2,producedFrames:4}})]){
      const api=mockApi();api.drain=vi.fn(async()=>bad);const opts=callbacks(api),session=await beginNativeCapture(opts);
      await expect(session.stopAndDrain()).rejects.toThrow();expect(opts.onSamples).not.toHaveBeenCalled();
    }
  });
  it("cancels exactly the owned handle and ignores a late drain response",async()=>{
    let resolve!: (value:unknown)=>void;const api=mockApi();api.drain=vi.fn(()=>new Promise(r=>{resolve=r;}));
    const opts=callbacks(api),session=await beginNativeCapture(opts);session.startDelivery();
    await new Promise(r=>setTimeout(r,5));await session.cancel();resolve(packet());await new Promise(r=>setTimeout(r,5));
    expect(opts.onSamples).not.toHaveBeenCalled();expect(api.cancel).toHaveBeenCalledExactlyOnceWith(identity);
  });
  it("serializes Stop behind an in-flight batch before final ACK",async()=>{
    let resolve!: (value:unknown)=>void; const api=mockApi(); let first=true;
    api.drain=vi.fn(request=>{if(first){first=false;return new Promise(r=>{resolve=r;});}return Promise.resolve(packet(request.ackThroughSequence,false));});
    const opts=callbacks(api),session=await beginNativeCapture(opts);session.startDelivery();
    await new Promise(r=>setTimeout(r,5));const stopping=session.stopAndDrain();
    expect(api.stop).not.toHaveBeenCalled();resolve(packet());
    await stopping;expect(opts.onSamples).toHaveBeenCalledTimes(1);expect(api.drain).toHaveBeenCalledTimes(2);
  });
  it("fails bounded missing drain and missing tail acknowledgement",async()=>{
    const stalled=mockApi();stalled.drain=vi.fn(()=>new Promise(()=>{}));
    const stalledOptions={...callbacks(stalled),timeoutMs:5};const waiting=await beginNativeCapture(stalledOptions);
    await expect(waiting.stopAndDrain()).rejects.toThrow("timed out");expect(stalledOptions.onInterrupted).toHaveBeenCalledOnce();
    const incomplete=mockApi();incomplete.drain=vi.fn(async request=>packet(request.ackThroughSequence,request.ackThroughSequence===0,
      {receipt:{...receipt(request.ackThroughSequence),barrierAcknowledged:false}}));
    const session=await beginNativeCapture(callbacks(incomplete));await expect(session.stopAndDrain()).rejects.toThrow("tail unconfirmed");
  });
  it("rejects changed selected source or unexpected descriptor fields",async()=>{
    for(const reply of [{...descriptor,source:{...source,selectionToken:"other"}},{...descriptor,unknown:true}]){
      const api=mockApi();api.begin=vi.fn(async()=>reply);await expect(beginNativeCapture(callbacks(api))).rejects.toThrow();
      expect(api.drain).not.toHaveBeenCalled();
    }
  });
  it("bounds missing replies and cancels late successful begin",async()=>{
    let resolve!: (value:unknown)=>void;const api=mockApi();api.begin=vi.fn(()=>new Promise(r=>{resolve=r;}));
    await expect(beginNativeCapture({...callbacks(api),timeoutMs:5})).rejects.toThrow('timed out');
    resolve(descriptor);await new Promise(r=>setTimeout(r,1));expect(api.cancel).toHaveBeenCalledExactlyOnceWith(identity);
  });
});
