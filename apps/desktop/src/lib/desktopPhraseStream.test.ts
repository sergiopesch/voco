import { describe, it, expect } from 'vitest';
import { DesktopPhraseQueue, DesktopPhraseSegmenter, DesktopPreviewCadence, stableDesktopPrefix } from './desktopPhraseStream';

describe('desktop phrase stream', () => {
  it('segments independently of callback size and never cuts continuous speech', () => {
    const audio = new Float32Array(48000);
    audio.fill(.05, 0, 16000); audio.fill(.05, 32000, 40000);
    const whole = new DesktopPhraseSegmenter(16000).append(audio);
    const split = new DesktopPhraseSegmenter(16000);
    const chunks: number[] = [];
    for (let i=0;i<audio.length;i+=137) chunks.push(...split.append(audio.slice(i,i+137)));
    expect(chunks).toEqual(whole);
    expect(whole).toEqual([23360, 47360]);
    expect(new DesktopPhraseSegmenter(16000).append(new Float32Array(16000*20).fill(.05))).toEqual([]);
    expect(new DesktopPhraseSegmenter(16000).append(new Float32Array(16000*20))).toEqual([]);
  });
  it('appends ordered phrases exactly once and does not repaste a final full transcript', async () => {
    const pasted: string[]=[]; const observed:string[]=[];
    const queue=new DesktopPhraseQueue(async a=>a[0]===1?'First phrase.':'Next phrase.',async t=>{pasted.push(t);},t=>observed.push(t));
    queue.enqueue(new Float32Array([1]));queue.enqueue(new Float32Array([2]));
    await queue.finish();await queue.finish();
    expect(pasted).toEqual(['First phrase.',' Next phrase.']);
    expect(observed[observed.length - 1]).toBe('First phrase. Next phrase.');
  });
  it('retains uncertain text and stops all queued output without retry', async () => {
    let calls=0;const observed:string[]=[];
    const queue=new DesktopPhraseQueue(async()=> 'Retained.',async()=>{calls++;throw new Error('uncertain');},t=>observed.push(t));
    queue.enqueue(new Float32Array([1]));queue.enqueue(new Float32Array([2]));
    await expect(queue.finish()).rejects.toThrow('uncertain');
    expect(calls).toBe(1);expect(observed).toEqual(['Retained.']);
  });
  it('suppresses late recognition after cancellation', async () => {
    let resolve!:(text:string)=>void;let calls=0;
    const queue=new DesktopPhraseQueue(()=>new Promise(r=>{resolve=r;}),async()=>{calls++;},()=>{});
    queue.enqueue(new Float32Array([1]));await Promise.resolve();queue.cancel();resolve('Late.');await queue.finish();expect(calls).toBe(0);
  });
});


describe('desktop recognition during continuous speech', () => {
  it('waits for decodable audio, establishes early agreement, then bounds steady work', () => {
    const cadence = new DesktopPreviewCadence(16000);
    const requests: number[] = [];
    const original: number[] = [];
    let regularEnd = 12800;
    for (let i = 128; i <= 16000 * 40; i += 128) {
      if (i >= 32000) cadence.settleStartup();
      if (cadence.due(i)) requests.push(i);
      if (i >= regularEnd && i <= 480000) {
        if (i >= 16000) original.push(i);
        regularEnd = i + 8000;
      }
    }
    expect(requests[0]).toBe(16000);
    const early = requests.filter(end => end < 32000);
    expect(early.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < early.length; i++) {
      expect(early[i]! - early[i - 1]!).toBeGreaterThanOrEqual(3872);
      expect(early[i]! - early[i - 1]!).toBeLessThanOrEqual(5000);
    }
    const steady = requests.filter(end => end >= 32000);
    for (let i = 1; i < steady.length; i++) expect(steady[i]! - steady[i - 1]!).toBeGreaterThanOrEqual(8000);
    expect(requests[requests.length - 1]).toBeLessThanOrEqual(480000);
    expect(requests.filter(end => original.includes(end))).toEqual(original);
    expect(requests.filter(end => !original.includes(end))).toHaveLength(2);
    expect(cadence.due(640000)).toBe(false);
    expect(cadence.takeLimitNotice(640000)).toBe(true);
    expect(cadence.takeLimitNotice(640001)).toBe(false);
    cadence.reset(640000);
    expect(cadence.takeLimitNotice(640000)).toBe(false);
    expect(cadence.due(652800)).toBe(false);
    expect(cadence.due(656000)).toBe(true);
  });
  it('keeps startup checks available for delayed speech but stops them after five seconds', () => {
    const cadence = new DesktopPreviewCadence(16000);
    const requests: number[] = [];
    for (let end = 128; end <= 16000 * 7; end += 128) if (cadence.due(end)) requests.push(end);
    const delayed = requests.filter(end => end >= 32000 && end < 64000);
    expect(delayed.length).toBeGreaterThan(6);
    const steady = requests.filter(end => end >= 80000);
    for (let i = 1; i < steady.length; i++) expect(steady[i]! - steady[i - 1]!).toBeGreaterThanOrEqual(8000);
  });
  it('does not catch up missed snapshots in a burst and reapplies startup relative to each phrase', () => {
    const cadence = new DesktopPreviewCadence(44100);
    expect(cadence.due(44100 * 8)).toBe(true);
    expect(cadence.due(44100 * 8)).toBe(false);
    expect(cadence.due(44100 * 8.49)).toBe(false);
    expect(cadence.due(44100 * 8.5)).toBe(true);
    cadence.reset(44100 * 9);
    expect(cadence.due(44100 * 9.8)).toBe(false);
    expect(cadence.due(44100 * 10)).toBe(true);
    expect(cadence.due(44100 * 10.25)).toBe(false);
    expect(cadence.due(44100 * 10.3)).toBe(true);
    expect(cadence.due(44100 * 10.54)).toBe(false);
    expect(cadence.due(44100 * 10.55)).toBe(true);
  });
  it('pastes agreement before finalization and appends only the final suffix', async () => {
    const outputs = ['These are words', 'These are words while speaking', 'These are words while speaking naturally.'];
    const pasted: string[] = []; const observed: string[] = [];
    const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async t => { pasted.push(t); }, t => observed.push(t));
    queue.preview(new Float32Array([1])); await queue.finish();
    expect(pasted).toEqual([]);
    queue.preview(new Float32Array([2])); await queue.finish();
    expect(pasted).toEqual(['These are words']);
    queue.enqueue(new Float32Array([3])); await queue.finish();
    expect(pasted).toEqual(['These are words', ' while speaking naturally.']);
    expect(observed[observed.length - 1]).toBe('These are words while speaking naturally.');
  });
  it('coalesces slow previews and discards a queued snapshot when Stop supplies final audio', async () => {
    let release!: (text: string) => void;
    const sizes: number[] = [];
    const queue = new DesktopPhraseQueue(async a => { sizes.push(a.length); return sizes.length === 1 ? new Promise<string>(r => { release = r; }) : 'Final words.'; }, async () => {}, () => {});
    queue.preview(new Float32Array(1)); await Promise.resolve();
    queue.preview(new Float32Array(2)); queue.preview(new Float32Array(3)); queue.preview(new Float32Array(4));
    queue.enqueue(new Float32Array(5)); release('Initial words'); await queue.finish();
    expect(sizes).toEqual([1, 5]);
  });
  it('never guesses an overlap when final recognition revises an inserted prefix', async () => {
    const outputs = ['Turn left at the corner', 'Turn left at the corner today', 'Turn right at the corner today.'];
    const pasted: string[] = []; const observed: string[] = [];
    const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async t => { pasted.push(t); }, t => observed.push(t));
    queue.preview(new Float32Array([1])); await queue.finish();
    queue.preview(new Float32Array([2])); await queue.finish();
    queue.enqueue(new Float32Array([3])); await expect(queue.finish()).rejects.toThrow('revised');
    expect(pasted).toEqual(['Turn left at the corner']);
    expect(observed[observed.length - 1]).toBe('Turn right at the corner today.');
  });
  it('does not repeat identical spoken phrases across finalized source ranges', async () => {
    const outputs = ['Go do you hear', 'Go do you hear me', 'Go do you hear me.', 'Go do you hear me.'];
    const pasted: string[] = [];
    const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async t => { pasted.push(t); }, () => {});
    queue.preview(new Float32Array([1])); await queue.finish();
    queue.preview(new Float32Array([2])); await queue.finish();
    queue.enqueue(new Float32Array([3])); queue.enqueue(new Float32Array([4])); await queue.finish();
    expect(pasted.join('')).toBe('Go do you hear me. Go do you hear me.');
  });
  it('suppresses a preview arriving after cancellation and retains final recovery after speculative failure', async () => {
    let release!: (text: string) => void; const pasted: string[] = [];
    let seeded = false;
    const cancelled = new DesktopPhraseQueue(async () => { if (!seeded) { seeded = true; return "Late words"; } return new Promise(r => { release = r; }); }, async t => { pasted.push(t); }, () => {});
    cancelled.preview(new Float32Array([1])); await cancelled.finish();
    cancelled.preview(new Float32Array([2])); await Promise.resolve(); cancelled.cancel(); release('Late words now'); await cancelled.finish();
    expect(pasted).toEqual([]);
    let first = true;
    const retry = new DesktopPhraseQueue(async () => { if (first) { first = false; throw new Error('speculative'); } return 'Final words.'; }, async t => { pasted.push(t); }, () => {});
    retry.preview(new Float32Array([1])); await retry.finish(); retry.enqueue(new Float32Array([2])); await retry.finish();
    expect(pasted).toEqual(['Final words.']);
  });
});


it('does not duplicate punctuation already dispatched at a normalized prefix boundary', async () => {
  for (const final of ['Hello, world today.', 'hello, world today.']) {
    const outputs = ['Hello,', 'Hello, world', final];
    const pasted: string[] = [];
    const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async t => { pasted.push(t); }, () => {});
    queue.preview(new Float32Array([1])); await queue.finish();
    queue.preview(new Float32Array([2])); await queue.finish();
    queue.enqueue(new Float32Array([3])); await queue.finish();
    expect(pasted.join('')).toBe('Hello, world today.');
  }
});


describe('desktop word agreement and routing', () => {
  it('keeps progressing despite punctuation and case changes at the beginning', async () => {
    const outputs = ['Amazing.', 'Amazing. I am testing speech', 'amazing, I am testing speech as it continues', 'Amazing. I am testing speech as it continues clearly', 'Amazing, I am testing speech as it continues clearly now.'];
    const pasted: string[] = [];
    const roles: string[] = [];
    const queue = new DesktopPhraseQueue(async (_audio, role) => { roles.push(role); return outputs.shift()!; }, async text => { pasted.push(text); }, () => {});
    for (let i=0; i<4; i++) { queue.preview(new Float32Array([i])); await queue.finish(); }
    queue.enqueue(new Float32Array([5])); await queue.finish();
    expect(roles).toEqual(['preview', 'preview', 'preview', 'preview', 'final']);
    expect(pasted).toEqual(['Amazing.', ' I am testing speech', ' as it continues', ' clearly now.']);
  });
  it('does not consider changed words, numbers, signs or contractions equivalent', async () => {
    for (const [before, after] of [['cat','cats'], ['1.5','15'], ['-3','3'], ["don't",'dont'], ['re-sign','resign']]) {
      const outputs = [before + ' now', before + ' now please', after + ' now please.'];
      const pasted: string[] = [];
      const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async text => { pasted.push(text); }, () => {});
      queue.preview(new Float32Array([1])); await queue.finish();
      queue.preview(new Float32Array([2])); await queue.finish();
      queue.enqueue(new Float32Array([3])); await expect(queue.finish()).rejects.toThrow('revised');
      expect(pasted).toEqual([before + ' now']);
    }
    expect(stableDesktopPrefix('Turn left now', 'Turn right now please')).toBe('Turn');
    expect(stableDesktopPrefix('Testing words', 'Testing wordsmith')).toBe('Testing');
    expect(stableDesktopPrefix('Only', 'Only')).toBe('');
    expect(stableDesktopPrefix('More words already', 'More words')).toBe('More');
  });
  it('records why previews wait and final work supersedes queued snapshots', async () => {
    const events: string[] = []; let release!: (text: string) => void;
    const queue = new DesktopPhraseQueue(async (_audio, role) => role === 'preview' ? new Promise(r => { release = r; }) : 'Final words.', async () => {}, () => {}, () => {}, event => events.push(event));
    queue.preview(new Float32Array([1])); await Promise.resolve();
    queue.preview(new Float32Array([2])); queue.preview(new Float32Array([3]));
    queue.enqueue(new Float32Array([4])); release('First words'); await queue.finish();
    expect(events).toEqual(['preview_wait', 'coalesced', 'superseded', 'superseded', 'recognized', 'final_wait']);
  });
});

it('uses agreed leading words when the decoder shortens its speculative tail', async () => {
  const outputs = ['Every elevation of the planet', 'Every elevation', 'Every elevation of the type man.'];
  const pasted: string[] = [];
  const queue = new DesktopPhraseQueue(async () => outputs.shift()!, async text => { pasted.push(text); }, () => {});
  queue.preview(new Float32Array([1])); await queue.finish();
  queue.preview(new Float32Array([2])); await queue.finish();
  expect(pasted).toEqual(['Every']);
  queue.enqueue(new Float32Array([3])); await queue.finish();
  expect(pasted.join('')).toBe('Every elevation of the type man.');
  expect(stableDesktopPrefix('Turn left now please', 'Turn right')).toBe('Turn');
  expect(stableDesktopPrefix('Only one word', 'Only')).toBe('');
  expect(stableDesktopPrefix('Wrong first word', 'Correct first')).toBe('');
});


it('does not commit an obsolete in-flight preview when final audio is already queued', async () => {
  let release!: (text: string) => void; let previews = 0;
  const pasted: string[] = [];
  const queue = new DesktopPhraseQueue(async (_audio, role) => {
    if (role === 'final') return 'Turn right at the corner.';
    if (++previews === 1) return 'Turn left at the corner';
    return new Promise(r => { release = r; });
  }, async text => { pasted.push(text); }, () => {});
  queue.preview(new Float32Array([1])); await queue.finish();
  queue.preview(new Float32Array([2])); await Promise.resolve();
  queue.enqueue(new Float32Array([3])); release('Turn left at the corner now');
  await queue.finish();
  expect(pasted).toEqual(['Turn right at the corner.']);
});
