// The everyday words My words warns about before teaching them
// (scripts/generate-everyday-words.py). The list loads on the first check, in
// its own chunk, so startup never reads it.
let loading: Promise<ReadonlySet<string>> | null = null;

export function loadEverydayWords(): Promise<ReadonlySet<string>> {
  loading ??= import("./everyday-words.txt?raw").then(({ default: text }) =>
    new Set(text.split("\n").filter(line => line && !line.startsWith("#"))));
  return loading;
}
