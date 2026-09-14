// Binary v1: "VCA1", little-endian metadata byte count, UTF-8 JSON, mono
// Float32 little-endian samples at 16 kHz. Metadata belongs in the body because
// canonical prefixes can exceed HTTP header limits.
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_AUDIO_SAMPLES = 16_000 * 600;

export function encodeAudioRequest(
  samples: Float32Array,
  previousCanonicalText = "",
): Uint8Array {
  if (samples.length === 0 || samples.length > MAX_AUDIO_SAMPLES) {
    throw new Error("Audio request must contain between one sample and 10 minutes.");
  }
  const metadata = new TextEncoder().encode(JSON.stringify({ previousCanonicalText }));
  if (metadata.length > MAX_METADATA_BYTES) {
    throw new Error("Canonical transcript exceeds the audio transport limit.");
  }
  const packet = new Uint8Array(8 + metadata.length + samples.byteLength);
  packet.set([0x56, 0x43, 0x41, 0x31]);
  const view = new DataView(packet.buffer);
  view.setUint32(4, metadata.length, true);
  packet.set(metadata, 8);
  // Linux targets are little-endian today, but keep the wire format explicit.
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  if (littleEndian) {
    packet.set(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength), 8 + metadata.length);
  } else {
    samples.forEach((sample, index) => view.setFloat32(8 + metadata.length + index * 4, sample, true));
  }
  return packet;
}
