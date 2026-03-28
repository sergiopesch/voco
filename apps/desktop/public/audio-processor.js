class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffers = [];
    this._sampleCount = 0;
    // Report audio level every ~93ms (4096 samples at 44.1kHz)
    this._levelInterval = 4096;
    this._levelAccum = 0;
    this._levelSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    this.port.postMessage({ type: "samples", data: new Float32Array(samples) });

    // Accumulate RMS for level metering
    for (let i = 0; i < samples.length; i++) {
      this._levelAccum += samples[i] * samples[i];
    }
    this._levelSamples += samples.length;

    if (this._levelSamples >= this._levelInterval) {
      const rms = Math.sqrt(this._levelAccum / this._levelSamples);
      const level = Math.min(1, rms * 8);
      this.port.postMessage({ type: "level", data: level });
      this._levelAccum = 0;
      this._levelSamples = 0;
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
