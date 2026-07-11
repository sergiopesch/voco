export interface AudioCaptureBuffer {
  chunks: Float32Array[];
  sampleCount: number;
}

export function createAudioCaptureBuffer(): AudioCaptureBuffer {
  return {
    chunks: [],
    sampleCount: 0,
  };
}

export function clearAudioCaptureBuffer(buffer: AudioCaptureBuffer): void {
  buffer.chunks = [];
  buffer.sampleCount = 0;
}

export function appendAudioSamples(
  buffer: AudioCaptureBuffer,
  samples: Float32Array,
): void {
  if (samples.length === 0) {
    return;
  }

  buffer.chunks.push(samples);
  buffer.sampleCount += samples.length;
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
