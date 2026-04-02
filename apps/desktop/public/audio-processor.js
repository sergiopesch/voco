class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._levelSum = 0;
    this._levelSquareSum = 0;
    this._levelSamples = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const samples = input[0];
    this.port.postMessage({ type: "samples", data: new Float32Array(samples) });

    for (let i = 0; i < samples.length; i++) {
      this._levelSum += samples[i];
      this._levelSquareSum += samples[i] * samples[i];
    }
    this._levelSamples += samples.length;

    if (this._levelSamples >= 1024) {
      const mean = this._levelSum / this._levelSamples;
      const variance = Math.max(
        0,
        this._levelSquareSum / this._levelSamples - mean * mean,
      );
      const rms = Math.sqrt(variance);
      const decibels = 20 * Math.log10(Math.max(rms, 0.0001));
      const normalized = Math.min(1, Math.max(0, (decibels + 44) / 42));
      const scaled = Math.pow(normalized, 1.9);
      this.port.postMessage({
        type: "level",
        data: scaled,
      });
      this._levelSum = 0;
      this._levelSquareSum = 0;
      this._levelSamples = 0;
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
