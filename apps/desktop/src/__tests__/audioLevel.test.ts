import { describe, expect, it } from "vitest";
import {
  createPanelLevelSender,
  calculateCenteredRms,
  calculateVisualAudioLevelFromSamples,
  calculateVisualAudioLevel,
} from "@/lib/audioLevel";

describe("createPanelLevelSender", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends silence once and the next sound without delay", async () => {
    let clock = 0;
    const sent: number[] = [];
    const sendLevel = createPanelLevelSender(async (level) => { sent.push(level); }, () => clock);
    const at = async (time: number, level: number) => { clock = time; sendLevel(level); await settle(); };
    await at(0, 0);
    await at(100, 0);
    // The zero skipped at 100 ms must not hold back this sound.
    await at(120, 0.4);
    await at(130, 0.5);
    await at(170, 0);
    await at(220, 0);
    expect(sent).toEqual([0, 0.4, 0]);
  });

  it("sends the next zero when the throttle dropped the first", async () => {
    let clock = 0;
    const sent: number[] = [];
    const sendLevel = createPanelLevelSender(async (level) => { sent.push(level); }, () => clock);
    const at = async (time: number, level: number) => { clock = time; sendLevel(level); await settle(); };
    await at(0, 0.2);
    await at(20, 0);
    await at(40, 0);
    await at(60, 0);
    expect(sent).toEqual([0.2, 0]);
  });

  it("sends the next zero when a send in flight dropped the first", async () => {
    let finish = () => {};
    const sent: number[] = [];
    let clock = 0;
    const sendLevel = createPanelLevelSender((level) => {
      sent.push(level);
      return new Promise<void>((resolve) => { finish = resolve; });
    }, () => clock);
    sendLevel(0.2);
    clock = 50;
    sendLevel(0);
    expect(sent).toEqual([0.2]);
    finish();
    await settle();
    clock = 60;
    sendLevel(0);
    expect(sent).toEqual([0.2, 0]);
  });

  it("drops levels while a send is still in flight", async () => {
    let finish = () => {};
    const sent: number[] = [];
    let clock = 0;
    const sendLevel = createPanelLevelSender((level) => {
      sent.push(level);
      return new Promise<void>((resolve) => { finish = resolve; });
    }, () => clock);
    sendLevel(0.3);
    clock = 100;
    sendLevel(0.6);
    expect(sent).toEqual([0.3]);
    finish();
    await settle();
    sendLevel(0.6);
    expect(sent).toEqual([0.3, 0.6]);
  });
});

describe("audioLevel", () => {
  it("ignores a constant DC offset when computing RMS", () => {
    const samples = new Float32Array([0.22, 0.22, 0.22, 0.22]);

    expect(calculateCenteredRms(samples)).toBeCloseTo(0, 6);
    expect(calculateVisualAudioLevelFromSamples(samples)).toBe(0);
  });

  it("preserves the AC component after removing DC offset", () => {
    const original = new Float32Array([0.12, -0.12, 0.12, -0.12]);
    const biased = new Float32Array([0.37, 0.13, 0.37, 0.13]);

    expect(calculateCenteredRms(biased)).toBeCloseTo(
      calculateCenteredRms(original),
      6,
    );
  });

  it("makes quiet speech visible while leaving silence still", () => {
    const levels = [-40, -32, -24, -12].map(db => calculateVisualAudioLevel(10 ** (db / 20)));
    expect(levels[0]).toBeGreaterThan(0.3);
    expect(levels[1]).toBeGreaterThan(0.55);
    expect(levels[2]).toBeGreaterThan(levels[1]!);
    expect(levels[3]).toBe(1);
    for (const rms of [0, -1, NaN, Infinity, 10 ** (-50 / 20)]) {
      expect(calculateVisualAudioLevel(rms)).toBe(0);
    }
  });
});
