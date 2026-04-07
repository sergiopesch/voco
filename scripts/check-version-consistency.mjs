import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectMatch(relativePath, pattern, description) {
  const content = read(relativePath);
  const match = content.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not read ${description} from ${relativePath}`);
  }
  return match[1];
}

const sources = [
  {
    label: "workspace package.json",
    value: JSON.parse(read("package.json")).version,
  },
  {
    label: "desktop package.json",
    value: JSON.parse(read("apps/desktop/package.json")).version,
  },
  {
    label: "package-lock.json",
    value: JSON.parse(read("package-lock.json")).version,
  },
  {
    label: "desktop Cargo.toml",
    value: expectMatch(
      "apps/desktop/src-tauri/Cargo.toml",
      /^version = "([^"]+)"/m,
      "Cargo version",
    ),
  },
  {
    label: "tauri.conf.json",
    value: JSON.parse(read("apps/desktop/src-tauri/tauri.conf.json")).version,
  },
  {
    label: "install entrypoint",
    value: expectMatch("install", /^VERSION="([^"]+)"/m, "install script version"),
  },
  {
    label: "AppStream release",
    value: expectMatch(
      "packaging/flatpak/com.sergiopesch.voco.metainfo.xml",
      /<release version="([^"]+)"/,
      "AppStream release version",
    ),
  },
  {
    label: "snapcraft.yaml",
    value: expectMatch("snap/snapcraft.yaml", /^version:\s+'([^']+)'/m, "Snap version"),
  },
];

const expectedVersion = sources[0].value;
const mismatches = sources.filter((source) => source.value !== expectedVersion);

if (mismatches.length > 0) {
  console.error(`Version mismatch detected. Expected ${expectedVersion}.`);
  for (const source of sources) {
    console.error(`- ${source.label}: ${source.value}`);
  }
  process.exit(1);
}

console.log(`Version metadata is consistent at ${expectedVersion}.`);
