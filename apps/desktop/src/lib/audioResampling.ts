export const TRANSCRIPTION_RESAMPLE_CHUNK_SECONDS = 30;

export type AudioResampler = (
  input: Float32Array,
  fromRate: number,
  toRate: number,
) => Promise<Float32Array>;

export async function resampleAudioBuffer(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Promise<Float32Array> {
  const duration = input.length / fromRate;
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * toRate), toRate);
  const buffer = offlineCtx.createBuffer(1, input.length, fromRate);
  buffer.getChannelData(0).set(input);
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

export async function resampleAudioForTranscription(
  input: Float32Array,
  fromRate: number,
  toRate: number,
  resampler: AudioResampler = resampleAudioBuffer,
): Promise<Float32Array> {
  const maxInputChunkLength = Math.round(
    fromRate * TRANSCRIPTION_RESAMPLE_CHUNK_SECONDS,
  );
  if (input.length <= maxInputChunkLength) {
    return resampler(input, fromRate, toRate);
  }

  const outputLength = Math.ceil((input.length / fromRate) * toRate);
  const merged = new Float32Array(outputLength);
  let targetOffset = 0;
  for (let offset = 0; offset < input.length; offset += maxInputChunkLength) {
    const resampled = await resampler(
      input.subarray(offset, offset + maxInputChunkLength),
      fromRate,
      toRate,
    );
    const remaining = merged.length - targetOffset;
    const copyLength = Math.min(resampled.length, remaining);
    merged.set(resampled.subarray(0, copyLength), targetOffset);
    targetOffset += copyLength;
  }
  return targetOffset === merged.length ? merged : merged.slice(0, targetOffset);
}
