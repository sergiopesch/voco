import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../apps/desktop/public/audio-processor.js', import.meta.url), 'utf8');
function capture() {
  const messages = [];
  const transfers = [];
  let Processor;
  class AudioWorkletProcessor {
    constructor() {
      this.port = { postMessage(message, transfer = []) {
        if (message.type === 'samples') {
          assert.equal(transfer.length, 1);
          assert.equal(transfer[0], message.data.buffer);
          transfers.push(transfer[0]);
        }
        messages.push(structuredClone(message, { transfer }));
      } };
    }
  }
  vm.runInNewContext(source, { AudioWorkletProcessor, registerProcessor(name, type) {
    assert.equal(name, 'audio-capture-processor'); Processor = type;
  } });
  const processor = new Processor();
  return { messages, transfers,
    input(data) { assert.equal(processor.process([[data]]), true); },
    missing(input = []) { assert.equal(processor.process(input), true); },
    flush() { processor.port.onmessage({ data: { type: 'flush' } }); },
    bytes() { return Buffer.concat(messages.filter(m => m.type === 'samples')
      .map(m => Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength))); },
    types() { return messages.filter(m => m.type !== 'level').map(m => m.type); },
  };
}
const samples = count => Float32Array.from({ length: count }, (_, i) => (i % 127 - 63) / 128);
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

test('leading missing and empty inputs are allowed; present zeros are retained', () => {
  const c = capture(); c.missing(); c.missing([[]]); c.input(new Float32Array());
  const zero = new Float32Array(3000); c.input(zero); c.flush();
  assert.deepEqual(c.bytes(), bytes(zero));
  assert.deepEqual(c.types(), ['samples', 'samples', 'flushed']);
  assert.deepEqual(c.messages.at(-1), { type: 'flushed', complete: true });
});

for (const [label, gap] of [['missing bus', []], ['missing channel', [[]]], ['empty channel', [[new Float32Array()]]]]) {
  test(`${label} seals a short prefix; interruption precedes its transfer`, () => {
    const c = capture(); const prefix = samples(137);
    c.input(prefix); c.missing(gap);
    assert.deepEqual(c.types(), ['capture-interrupted', 'samples']);
    c.input(samples(8192)); c.missing(); c.flush(); c.flush();
    assert.deepEqual(c.bytes(), bytes(prefix));
    assert.deepEqual(c.types(), ['capture-interrupted', 'samples', 'flushed', 'flushed']);
    assert.deepEqual(c.messages.slice(-2), [{ type: 'flushed', complete: false }, { type: 'flushed', complete: false }]);
    assert.ok(c.transfers.every(buffer => buffer.byteLength === 0));
  });
}

test('previously transferred full batches and final interrupted remainder stay exact once', () => {
  const c = capture(); const prefix = samples(5001);
  c.input(prefix); c.missing(); c.flush();
  assert.deepEqual(c.bytes(), bytes(prefix));
  assert.deepEqual(c.types(), ['samples', 'samples', 'capture-interrupted', 'samples', 'flushed']);
  assert.deepEqual(c.messages.filter(m => m.type === 'samples').map(m => m.data.length), [2048, 2048, 905]);
});

test('healthy flush seals before later gaps or samples; repeated ACK stays healthy', () => {
  const c = capture(); const prefix = samples(2049);
  c.input(prefix); c.flush(); c.missing(); c.input(samples(4096)); c.flush();
  assert.deepEqual(c.bytes(), bytes(prefix));
  assert.deepEqual(c.types(), ['samples', 'samples', 'flushed', 'flushed']);
  assert.deepEqual(c.messages.slice(-2), [{ type: 'flushed', complete: true }, { type: 'flushed', complete: true }]);
});

test('flush before any input is terminal without a false interruption', () => {
  const c = capture(); c.flush(); c.input(samples(128)); c.missing(); c.flush();
  assert.deepEqual(c.types(), ['flushed', 'flushed']);
  assert.equal(c.bytes().length, 0);
  assert.ok(c.messages.every(m => m.complete === true));
});

test('variable quanta and duplicate values do not infer loss', () => {
  const c = capture(); const parts = [samples(1), samples(128), samples(128), new Float32Array(2048), samples(5000)];
  for (const part of parts) c.input(part); // No wall clock or required quantum cadence in the contract.
  c.flush();
  assert.deepEqual(c.bytes(), Buffer.concat(parts.map(bytes)));
  assert.equal(c.messages.some(m => m.type === 'capture-interrupted'), false);
});
