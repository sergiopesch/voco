import type { AppConfig, EnglishSpelling } from "@/types";

export type EnglishVariety = Exclude<EnglishSpelling, "as-recognised">;

/** The two choices onboarding offers. runtime/speech/test_spelling.py checks
 * that the converter turns each sample and example into the other's. */
export const ENGLISH_VARIETIES: Record<EnglishVariety, {
  label: string;
  flag: string;
  examples: readonly string[];
  sample: string;
  prompt: string;
}> = {
  british: {
    label: "British English",
    flag: "/flags/gb.svg",
    examples: ["colour", "organise", "travelling"],
    sample: "I've organised the theatre trip with my favourite neighbours.",
    prompt: "My favourite colour is blue.",
  },
  american: {
    label: "American English",
    flag: "/flags/us.svg",
    examples: ["color", "organize", "traveling"],
    sample: "I've organized the theater trip with my favorite neighbors.",
    prompt: "My favorite color is blue.",
  },
};

/** Until someone chooses, VOCO spells British, the default. */
export function englishSpelling(config: Pick<AppConfig, "englishSpelling">): EnglishSpelling {
  return config.englishSpelling ?? "british";
}

/** The words of a sample that differ between the varieties, for emphasis. */
export function differingWords(variety: EnglishVariety): Set<string> {
  const other = ENGLISH_VARIETIES[variety === "british" ? "american" : "british"].sample.split(" ");
  return new Set(ENGLISH_VARIETIES[variety].sample.split(" ").filter((word, index) => word !== other[index]));
}
