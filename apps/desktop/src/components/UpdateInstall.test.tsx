import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateInstallView } from "@/components/UpdateInstall";
import { IDLE_INSTALL, reduceInstall, startingInstall, type UpdateInstallState } from "@/lib/updateInstall";

const noop = () => {};
const render = (state: UpdateInstallState, overrides: Partial<Parameters<typeof UpdateInstallView>[0]> = {}) =>
  renderToStaticMarkup(
    <UpdateInstallView state={state} available availableVersion="2026.0.66" releaseUrl="https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.66"
      dictating={false} onStart={noop} onCancel={noop} onClose={noop} onOpenReleasePage={async () => {}} {...overrides} />,
  );

describe("Install update's window", () => {
  it("offers Install update only for a newer release on an installation that can take it", () => {
    expect(render(IDLE_INSTALL)).toContain(">Install update<");
    expect(render(IDLE_INSTALL, { available: false })).toBe("");
    expect(render(IDLE_INSTALL, { availableVersion: null })).toBe("");
    const dictating = render(IDLE_INSTALL, { dictating: true });
    expect(dictating).toMatch(/<button[^>]*disabled=""[^>]*>Install update</);
    expect(dictating).toContain("Finish dictating first.");
  });

  it("shows the download's progress with a Cancel", () => {
    const state = reduceInstall(startingInstall("2026.0.66"),
      { stage: "downloading", version: "2026.0.66", file: 3, files: 3, received: 350 * 1024 * 1024, total: 700 * 1024 * 1024 });
    const markup = render(state);
    expect(markup).toContain("Downloading VOCO 2026.0.66…");
    expect(markup).toContain('aria-valuenow="50"');
    expect(markup).toContain("350 MB of 700 MB");
    expect(markup).toContain(">Cancel<");
  });

  it("offers no Cancel once the password prompt is up", () => {
    const markup = render({ ...startingInstall("2026.0.66"), stage: "authorizing", reached: "install" });
    expect(markup).not.toContain(">Cancel<");
    expect(markup).toContain("VOCO never sees it.");
    expect(markup).toContain('data-status="active"><span class="voco-update-steps__dot" aria-hidden="true"></span><span>Install</span>');
  });

  it("explains a failure and keeps the manual way to update", () => {
    const markup = render({ ...startingInstall("2026.0.66"), stage: "failed", message: "The password prompt was dismissed, so nothing was installed.", reached: "install" });
    expect(markup).toContain("The update didn’t install");
    expect(markup).toContain("The password prompt was dismissed");
    expect(markup).toContain(">Try again<");
    expect(markup).toContain(">Open release page<");
    expect(markup).toContain(">Close<");
    expect(markup).not.toContain(">Cancel<");
  });
});
