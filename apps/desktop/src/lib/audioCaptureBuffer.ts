export interface AudioCaptureBuffer {
  chunks: Float32Array[];
  chunkStartSamples: number[];
  sampleCount: number;
}

export function createAudioCaptureBuffer(): AudioCaptureBuffer {
  return {
    chunks: [],
    chunkStartSamples: [],
    sampleCount: 0,
  };
}

export function clearAudioCaptureBuffer(buffer: AudioCaptureBuffer): void {
  buffer.chunks = [];
  buffer.chunkStartSamples = [];
  buffer.sampleCount = 0;
}

export function appendAudioSamples(
  buffer: AudioCaptureBuffer,
  samples: Float32Array,
): void {
  if (samples.length === 0) {
    return;
  }

  buffer.chunkStartSamples.push(buffer.sampleCount);
  buffer.chunks.push(samples);
  buffer.sampleCount += samples.length;
}

export function appendAudioSamplesUpTo(
  buffer: AudioCaptureBuffer,
  samples: Float32Array,
  maxSampleCount: number,
): { appendedSampleCount: number; reachedLimit: boolean } {
  const safeMaximum = Math.max(0, Math.floor(maxSampleCount));
  const remainingSamples = Math.max(0, safeMaximum - buffer.sampleCount);
  const appendSamples =
    samples.length <= remainingSamples
      ? samples
      : samples.subarray(0, remainingSamples);
  appendAudioSamples(buffer, appendSamples);
  return {
    appendedSampleCount: appendSamples.length,
    reachedLimit: buffer.sampleCount >= safeMaximum,
  };
}

export function collectRecentAudioSamples(
  buffer: AudioCaptureBuffer,
  maxSamples: number,
): Float32Array {
  if (buffer.sampleCount === 0 || maxSamples <= 0) {
    return new Float32Array();
  }

  const targetLength = Math.min(buffer.sampleCount, maxSamples);
  const result = new Float32Array(targetLength);
  let remaining = targetLength;
  let targetOffset = targetLength;

  for (
    let index = buffer.chunks.length - 1;
    index >= 0 && remaining > 0;
    index -= 1
  ) {
    const chunk = buffer.chunks[index];
    if (!chunk) {
      continue;
    }

    const copyLength = Math.min(chunk.length, remaining);
    targetOffset -= copyLength;
    result.set(chunk.subarray(chunk.length - copyLength), targetOffset);
    remaining -= copyLength;
  }

  return result;
}

export function collectAudioSamplesRange(
  buffer: AudioCaptureBuffer,
  startSample: number,
  maxSamples: number,
): Float32Array {
  const safeStart = Math.min(
    buffer.sampleCount,
    Math.max(0, Math.floor(startSample)),
  );
  const targetLength = Math.min(
    buffer.sampleCount - safeStart,
    Math.max(0, Math.floor(maxSamples)),
  );
  if (targetLength === 0) {
    return new Float32Array();
  }

  const result = new Float32Array(targetLength);
  const rangeEnd = safeStart + targetLength;
  let chunkIndex = findFirstChunkEndingAfter(buffer, safeStart);
  let targetOffset = 0;

  for (; chunkIndex < buffer.chunks.length; chunkIndex += 1) {
    const chunk = buffer.chunks[chunkIndex];
    if (!chunk) {
      continue;
    }
    const chunkStart = buffer.chunkStartSamples[chunkIndex] ?? 0;
    const chunkEnd = chunkStart + chunk.length;
    if (chunkStart >= rangeEnd) {
      break;
    }

    const copyStart = Math.max(safeStart, chunkStart);
    const copyEnd = Math.min(rangeEnd, chunkEnd);
    result.set(
      chunk.subarray(copyStart - chunkStart, copyEnd - chunkStart),
      targetOffset,
    );
    targetOffset += copyEnd - copyStart;
  }

  return result;
}

function findFirstChunkEndingAfter(
  buffer: AudioCaptureBuffer,
  sample: number,
): number {
  let low = 0;
  let high = buffer.chunks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const chunk = buffer.chunks[middle];
    const chunkStart = buffer.chunkStartSamples[middle] ?? 0;
    if (chunk && chunkStart + chunk.length <= sample) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

export function drainAudioCaptureBuffer(
  buffer: AudioCaptureBuffer,
): Float32Array {
  if (buffer.sampleCount === 0) {
    clearAudioCaptureBuffer(buffer);
    return new Float32Array();
  }

  const merged = new Float32Array(buffer.sampleCount);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  clearAudioCaptureBuffer(buffer);
  return merged;
}
