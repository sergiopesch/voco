import { describe, expect, it } from "vitest";
import config from "../../src-tauri/tauri.conf.json";

describe("native binary IPC CSP", () => {
  it("permits Tauri custom IPC origins without allowing arbitrary connections", () => {
    // Tauri 2's custom-protocol fetch must succeed. Its postMessage fallback
    // serializes Uint8Array into JSON, which intentionally fails VCA1's raw-body
    // boundary. Mocked invoke tests alone cannot catch a missing CSP origin.
    const directives = new Map(config.app.security.csp.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    }));
    const connections = directives.get("connect-src");
    expect(connections).toEqual(expect.arrayContaining(["'self'", "ipc:", "http://ipc.localhost"]));
    expect(connections).not.toContain("*");
    expect(connections).not.toContain("http:");
    expect(connections).not.toContain("https:");
  });
});
