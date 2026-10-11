import { describe, expect, it } from "vitest";
import {
  MY_WORDS_MAX_HEARD, MY_WORDS_MAX_TERMS, entryOf, heardVersion, judgeCheck, keptVersions, myWordProblem, myWordsKey,
  termWords, tidyMyWord, versionsOf, withoutEntry,
} from "@/lib/myWords";
import type { HeardVersion } from "@/types";

describe("My words rules", () => {
  it("matches entries the way the worker does: without case, accents or separators", () => {
    expect(myWordsKey("Git Hub")).toBe(myWordsKey("github"));
    expect(myWordsKey("Zoë")).toBe(myWordsKey("zoe"));
    expect(myWordsKey("Straße")).toBe(myWordsKey("STRASSE"));
    expect(myWordsKey("Jean-Luc")).toBe(myWordsKey("jean luc"));
    expect(myWordsKey("O'Neill")).not.toBe(myWordsKey("ONeill"));
    expect(myWordsKey("O’Neill")).toBe(myWordsKey("o'neill"));
  });

  it("tidies typed text into an entry", () => {
    expect(tidyMyWord("  Pipe   Wire ")).toBe("Pipe Wire");
    expect(tidyMyWord("Ma\u0301laga")).toBe("Málaga");
  });

  it("accepts what the worker accepts and says why it refuses the rest", () => {
    for (const term of ["GitHub", "New Zealand", "O'Neill", "St. Ives", "Jean-Luc", "Acme Inc.", "R2D2", "x".repeat(40)]) {
      expect(myWordProblem(term, [])).toBeNull();
    }
    expect(myWordProblem("C++", [])).toMatch(/^Use letters, digits/);
    expect(myWordProblem("one two three four five", [])).toMatch(/^Keep each entry/);
    expect(myWordProblem("x".repeat(41), [])).toMatch(/^Keep each entry/);
    expect(myWordProblem("strasse", ["Straße"])).toBe("“Straße” is already in My words.");
    const full = Array.from({ length: MY_WORDS_MAX_TERMS }, (_, index) => `term${index}`);
    expect(myWordProblem("Kubernetes", full)).toMatch(/^My words holds up to 100 entries/);
  });

  it("handles NFD and NFC accents alike after normalization", () => {
    const nfd_siobhan = "Siobha\u0301n Kelly";
    const nfc_siobhan = "Siobhán Kelly";
    expect(myWordProblem(nfd_siobhan, [])).toBeNull();
    expect(myWordProblem(nfc_siobhan, [])).toBeNull();
    expect(myWordsKey(nfd_siobhan)).toBe(myWordsKey(nfc_siobhan));
    
    const nfd_zoe = "Zoe\u0308";
    const nfc_zoe = "Zoë";
    expect(myWordProblem(nfd_zoe, [])).toBeNull();
    expect(myWordProblem(nfc_zoe, [])).toBeNull();
    expect(myWordsKey(nfd_zoe)).toBe(myWordsKey(nfc_zoe));
    
    const yoruba = "Adé\u1e63\u1ecd\u0300lá";
    expect(myWordProblem(yoruba, [])).not.toBeNull();
  });

  it("shared fixture validates NFC and NFD alike", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const fixturePath = resolve(process.cwd(), "../../tests/fixtures/mywords/entries.json");
    const cases = JSON.parse(readFileSync(fixturePath, "utf8"));
    for (const testCase of cases) {
      const result = myWordProblem(testCase.input, []);
      if (testCase.expectedVerdict === "accept") {
        expect(result).toBeNull();
        if (testCase.expectedWordCount !== null) {
          expect(termWords(testCase.input).length).toBe(testCase.expectedWordCount);
        }
      } else {
        expect(result).not.toBeNull();
      }
    }
  });
});

describe("Say it", () => {
  const everyday = (word: string) => ["tiger", "my", "raid", "hand", "well", "the", "is", "shown"].includes(word);
  const judge = (transcript: string, words: string[], heard: HeardVersion[] = [], index = 0) =>
    judgeCheck(transcript, words, heard, index, everyday);

  it("says VOCO got it when the recognizer's text holds the entry as listed", () => {
    expect(judge("Siobhán.", ["Siobhán"])).toEqual({ kind: "right" });
    expect(judge("Siobhán's here", ["Siobhán"])).toEqual({ kind: "right" });
    expect(judge("I said Siobhán Kelly, yes.", ["Siobhán Kelly"])).toEqual({ kind: "right" });
    // A lower-case entry starts a sentence with a capital.
    expect(judge("Router.", ["router"])).toEqual({ kind: "right" });
    expect(judge("Siobhánne", ["Siobhán"]).kind).toBe("teach");
  });

  it("proposes the version VOCO heard, without the punctuation around it", () => {
    expect(judge("Shivon.", ["Siobhán"])).toEqual({
      kind: "teach", heard: "Shivon", teaching: { heard: "Shivon", writes: "Siobhán", everyday: false },
    });
    expect(judge("  “Shi-von!” ", ["Siobhán"])).toMatchObject({ teaching: { heard: "Shi-von", writes: "Siobhán" } });
    // A pause doesn't stop VOCO learning the one word it misheard, which the worker matches across it.
    expect(judge("Shivon, Kelly.", ["Siobhán Kelly"])).toMatchObject({ heard: "Shivon, Kelly", teaching: { heard: "Shivon", writes: "Siobhán" } });
    // A version never spans a pause, which the worker wouldn't join across.
    expect(judge("Shivon, Kellie.", ["Siobhán Kelly"])).toEqual({ kind: "unclear", heard: "Shivon, Kellie", pause: true });
    expect(judge("Pes, Kira Labs", ["Peskera Labs"])).toEqual({ kind: "unclear", heard: "Pes, Kira Labs", pause: true });
  });

  it("teaches the one word VOCO misheard, unless that word is an everyday one", () => {
    expect(judge("Siobhán Kellie", ["Siobhán Kelly"])).toMatchObject({ teaching: { heard: "Kellie", writes: "Kelly", everyday: false } });
    expect(judge("Pes Kira Labs", ["Peskera Labs"])).toMatchObject({ teaching: { heard: "Pes Kira", writes: "Peskera" } });
    // "My raid" said on its own would change everyday words, so the whole name is taught.
    expect(judge("My raid Kelly.", ["Mairéad Kelly"])).toMatchObject({
      teaching: { heard: "My raid Kelly", writes: "Mairéad Kelly", everyday: false },
    });
    // Two words wrong: the whole entry.
    expect(judge("Shivon Kellie", ["Siobhán Kelly"])).toMatchObject({ teaching: { heard: "Shivon Kellie", writes: "Siobhán Kelly" } });
  });

  it("warns before teaching a version made only of everyday words", () => {
    expect(judge("Tiger.", ["Tadhg"])).toMatchObject({ kind: "teach", teaching: { heard: "Tiger", writes: "Tadhg", everyday: true } });
    expect(judge("hand well", ["Hanwell"])).toMatchObject({ teaching: { everyday: true } });
  });

  it("asks for the entry again when VOCO heard its words with a pause between them", () => {
    expect(judge("Siobhán, Kelly.", ["Siobhán Kelly"])).toEqual({ kind: "unclear", heard: "Siobhán, Kelly", pause: true });
  });

  it("teaches a version without the possessive VOCO heard on it", () => {
    expect(judge("Shivon's.", ["Siobhán"])).toMatchObject({ kind: "teach", heard: "Shivon's", teaching: { heard: "Shivon", writes: "Siobhán" } });
    expect(judge("Shivon Kelly's", ["Siobhán Kelly"])).toMatchObject({ teaching: { heard: "Shivon", writes: "Siobhán" } });
    // An entry that ends in 's keeps it.
    expect(judge("Shivon's", ["Siobhán's"])).toMatchObject({ teaching: { heard: "Shivon's", writes: "Siobhán's" } });
  });

  it("counts a version against the entry it will belong to", () => {
    const five = Array.from({ length: MY_WORDS_MAX_HEARD }, (_, index) => ({ heard: `version${index}`, writes: "Siobhán" }));
    // Taught while checking the longer entry, "Shivon" writes "Siobhán", which belongs to the entry of that name.
    expect(judge("Shivon Kelly", ["Siobhán Kelly", "Siobhán"], five, 0)).toEqual({ kind: "full", heard: "Shivon Kelly" });
    expect(judge("Siobhán Kellie", ["Siobhán Kelly", "Siobhán"], five, 0)).toMatchObject({ kind: "teach" });
  });

  it("asks again when VOCO heard nothing, only part of the entry, or more than a version can hold", () => {
    expect(judge("", ["Siobhán"])).toEqual({ kind: "nothing" });
    expect(judge("(no speech detected)", ["Siobhán"])).toEqual({ kind: "nothing" });
    expect(judge("Kelly.", ["Siobhán Kelly"])).toEqual({ kind: "partial", heard: "Kelly" });
    expect(judge("Shi. Von.", ["Siobhán"])).toEqual({ kind: "unclear", heard: "Shi. Von." });
    expect(judge("one two three four five", ["Siobhán"])).toMatchObject({ kind: "unclear" });
  });

  it("won't teach a version another entry or version already writes, or a sixth one", () => {
    expect(judge("Sean.", ["Shaun", "Sean"])).toEqual({ kind: "taken", heard: "Sean", other: "Sean" });
    expect(judge("Shivon", ["Siobhán", "Shauna"], [{ heard: "shi von", writes: "Shauna" }])).toEqual({ kind: "taken", heard: "Shivon", other: "Shauna" });
    const five = Array.from({ length: MY_WORDS_MAX_HEARD }, (_, index) => ({ heard: `version${index}`, writes: "Siobhán" }));
    expect(judge("Shivon", ["Siobhán"], five)).toEqual({ kind: "full", heard: "Shivon" });
    // A version of one word stands for it inside the whole entry, and that mustn't clash either.
    const names = ["Foo", "José García", "José Kelly"];
    expect(judge("Hosay Garcia", names, [{ heard: "Hosay", writes: "José" }], 0))
      .toEqual({ kind: "taken", heard: "Hosay Garcia", other: "José García" });
    expect(judge("Hosay Garcia", names, [{ heard: "Hosay Garcia", writes: "Foo" }], 1))
      .toEqual({ kind: "taken", heard: "Hosay Garcia", other: "Foo" });
    expect(judge("Hosay Garcia", ["José García", "Hosay Garcia"], [], 0))
      .toEqual({ kind: "taken", heard: "Hosay Garcia", other: "Hosay Garcia" });
  });
});

describe("Taught versions", () => {
  const words = ["Siobhán Kelly", "GitHub"];
  const heard = [{ heard: "Shivon", writes: "Siobhán" }, { heard: "get hub", writes: "GitHub" }, { heard: "Kellie", writes: "Kelly" }];

  it("belong to the entry they write, whole or one word of", () => {
    expect(entryOf(words, "Siobhán")).toBe(0);
    expect(entryOf(words, "GitHub")).toBe(1);
    expect(entryOf(words, "Nobody")).toBe(-1);
    expect(versionsOf(words, heard, 0)).toEqual([heard[0], heard[2]]);
    expect(versionsOf(words, heard, 1)).toEqual([heard[1]]);
  });

  it("go with their entry", () => {
    expect(keptVersions(["GitHub"], heard)).toEqual([heard[1]]);
    // A version belongs to the entry it writes whole, and goes with that one.
    const both = ["Siobhán Kelly", "Siobhán"];
    expect(entryOf(both, "Siobhán")).toBe(1);
    expect(withoutEntry(both, [heard[0]!, heard[2]!], 1)).toEqual({ words: ["Siobhán Kelly"], heard: [heard[2]] });
    expect(withoutEntry(both, [heard[0]!, heard[2]!], 0)).toEqual({ words: ["Siobhán"], heard: [heard[0]] });
  });

  it("block an entry VOCO already writes for a version", () => {
    expect(myWordProblem("shivon", words, heard)).toBe("VOCO already writes “Siobhán” when it hears “Shivon”.");
  });

  it("are the recognizer's words, as a version the worker accepts", () => {
    expect(heardVersion("Shivon.")).toEqual({ shown: "Shivon", text: "Shivon" });
    expect(heardVersion("Shivon, Kelly!")).toEqual({ shown: "Shivon, Kelly", text: "Shivon Kelly" });
    expect(heardVersion("O’Neill's")).toEqual({ shown: "O’Neill's", text: "O’Neill's" });
    expect(heardVersion("St. Ives")).toBeNull();
    expect(heardVersion("x".repeat(41))).toBeNull();
    expect(heardVersion("...")).toBeNull();
  });
});
