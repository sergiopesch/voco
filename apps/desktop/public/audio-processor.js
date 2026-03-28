class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._levelAccum = 0;
    this._levelSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    this.port.postMessage({ type: "samples", data: new Float32Array(samples) });

    for (let i = 0; i < samples.length; i++) {
      this._levelAccum += samples[i] * samples[i];
    }
    this._levelSamples += samples.length;

    if (this._levelSamples >= 4096) {
      const rms = Math.sqrt(this._levelAccum / this._levelSamples);
      this.port.postMessage({ type: "level", data: Math.min(1, rms * 8) });
      this._levelAccum = 0;
      this._levelSamples = 0;
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
