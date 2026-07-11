export function samplesToPcm16Base64(samples: Float32Array): string {
  let binary = "";

  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    binary += String.fromCharCode(
      value & 0xff,
      (value >> 8) & 0xff,
    );
  }

  return btoa(binary);
}

export function pcm16Base64ToSamples(audio: string): Float32Array {
  const binary = atob(audio);
  const samples = new Float32Array(Math.floor(binary.length / 2));

  for (let i = 0; i < samples.length; i += 1) {
    const offset = i * 2;
    let value =
      binary.charCodeAt(offset) | (binary.charCodeAt(offset + 1) << 8);
    if (value >= 0x8000) {
      value -= 0x10000;
    }
    samples[i] = value / 0x8000;
  }

  return samples;
}
