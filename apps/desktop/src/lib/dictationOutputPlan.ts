import type { AppConfig } from "@/types";

/** Every automatic text result needs working text delivery; spoken replies do not. */
export function requiresVerifiedTextTarget(config: Pick<AppConfig, "transcriptTarget"> | null | undefined): boolean {
  return Boolean(config && config.transcriptTarget !== "openclaw-speech");
}
