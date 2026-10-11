import { describe, expect, it } from "vitest";
import { MY_WORDS_MAX_TERMS, myWordProblem, myWordsKey, tidyMyWord } from "@/components/MyWords";

describe("My words rules", () => {
  it("matches entries the way the worker does: without case, accents or separators", () => {
    expect(myWordsKey("Git Hub")).toBe(myWordsKey("github"));
    expect(myWordsKey("Zoë")).toBe(myWordsKey("zoe"));
    expect(myWordsKey("Straße")).toBe(myWordsKey("STRASSE"));
    expect(myWordsKey("Jean-Luc")).toBe(myWordsKey("jean luc"));
    expect(myWordsKey("O'Neill")).not.toBe(myWordsKey("ONeill"));
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
});
