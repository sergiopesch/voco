import { describe, expect, it } from "vitest";
import { formatLocalModelTestStatus } from "@/lib/localModelStatus";

describe("local model status copy", () => {
  it("includes the exact endpoint on success", () => {
    expect(
      formatLocalModelTestStatus("http://127.0.0.1:8080/v1/chat/completions", {
        ok: true,
        detail: "Local model endpoint responded.",
      }),
    ).toBe("Connected to http://127.0.0.1:8080/v1/chat/completions.");
  });

  it("includes the exact endpoint and failure detail on error", () => {
    expect(
      formatLocalModelTestStatus("http://127.0.0.1:8080/v1/chat/completions", {
        ok: false,
        detail: "connection refused",
      }),
    ).toBe(
      "Could not reach http://127.0.0.1:8080/v1/chat/completions: connection refused",
    );
  });
});
