import { expect, it } from "vitest";
import { captureSampleLimit, errorMessage, MAX_CAPTURE_SAMPLES, sentence } from "./dictationRecovery";
it("bounds source memory and preserves structured target errors",()=>{
 expect(captureSampleLimit(16000)).toBe(9600000);expect(captureSampleLimit(48000)).toBe(28800000);
 expect(captureSampleLimit(192000)).toBe(MAX_CAPTURE_SAMPLES);
 expect(errorMessage({message:"Target may contain text."})).toBe("Target may contain text.");
});
it("ends interpolated messages with exactly one period",()=>{
 expect(sentence("Capture sample rate changed")).toBe("Capture sample rate changed.");
 expect(sentence("VOCO stopped transcribing.")).toBe("VOCO stopped transcribing.");
 expect(sentence(" Worker stopped.. ")).toBe("Worker stopped.");
 expect(sentence("Is the worker running?")).toBe("Is the worker running?");
 expect(sentence("")).toBe("");
});
