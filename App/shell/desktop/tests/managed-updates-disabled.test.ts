import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * This fork is built and installed by hand, so the managed background updater must stay
 * off: left on, it fetches the upstream release and swaps the local build on quit or next
 * boot, discarding the fork's own fixes. Upstream syncs touch this area, so the gate is
 * pinned here rather than left to review.
 */
const mainSource = readFileSync(join(__dirname, "..", "src", "main", "main.ts"), "utf8");

function shouldManageRequiredUpdatesBody(): string {
  const start = mainSource.indexOf("function shouldManageRequiredUpdates(): boolean {");
  expect(start).toBeGreaterThan(-1);
  return mainSource.slice(start, mainSource.indexOf("\n}", start));
}

describe("managed background updates", () => {
  it("is gated off unconditionally", () => {
    const body = shouldManageRequiredUpdatesBody();

    expect(body).toContain("return false;");
    expect(body).not.toContain("app.isPackaged");
    expect(body).not.toContain("isInstalledApplicationsApp()");
    expect(body).not.toContain('process.platform === "win32"');
  });

  it("still routes every automatic update entry point through that gate", () => {
    // If a sync adds an entry point that skips the gate, this count drifts and the test fails.
    const guarded = mainSource.match(/shouldManageRequiredUpdates\(\)/g) ?? [];

    expect(guarded.length).toBe(5); // 4 call sites + the definition
  });
});
