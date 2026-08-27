// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../../i18n/i18n-provider.js";
import { AgentLedgerPanel, planFor } from "../settings-agent-ledger.js";
import type { AgentLedgerClient } from "../../api/agent-ledger-client.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOT_MOUNTED = {
  kind: "not_mounted" as const,
  name: "pdf",
  targetId: "claude_code",
  targetDisplayName: "Claude Code",
  path: "/home/user/.claude/skills/pdf",
  detail: "declared for this agent but not linked"
};

const BLOCKED = {
  kind: "blocked" as const,
  name: "update-n8n-stack",
  targetId: "codex",
  targetDisplayName: "Codex",
  path: "/home/user/.codex/skills/update-n8n-stack",
  detail: "dead symlink to /Volumes/backup/n8n"
};

const FINDINGS = [NOT_MOUNTED, BLOCKED];

describe("AgentLedgerPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("reports both ledgers without writing anything on mount", async () => {
    const client = createClient();

    await render(client);

    expect(client.calls).toEqual(["getRuleStatus", "getSkillStatus"]);
    expect(container.textContent).toContain("/home/user/.agents/skills");
    expect(container.textContent).toContain("pdf");
    expect(container.textContent).toContain("update-n8n-stack");
  });

  it("needs two clicks before it rearranges the user's agent directories", async () => {
    const client = createClient();
    await render(client);

    const button = findButton("修复差异");
    expect(button).not.toBeNull();

    await click(button);
    expect(client.calls).not.toContain("reconcileSkills");
    expect(findButton("确认修复")).not.toBeNull();

    await click(findButton("确认修复"));
    expect(client.calls).toContain("reconcileSkills");
  });

  it("offers no fix button when nothing can be fixed automatically", async () => {
    const client = createClient({ findings: [BLOCKED] });

    await render(client);

    expect(findButton("修复差异")).toBeNull();
    expect(container.textContent).toContain("update-n8n-stack");
  });

  it("says the ledger matches when there is no drift", async () => {
    const client = createClient({ findings: [] });

    await render(client);

    expect(container.textContent).toContain("与账本完全一致");
  });

  it("surfaces a read failure instead of rendering an empty panel", async () => {
    const client = createClient();
    client.getSkillStatus = async () => {
      throw new Error("EACCES: permission denied");
    };

    await render(client);

    expect(container.textContent).toContain("EACCES: permission denied");
  });

  async function render(client: AgentLedgerClient) {
    await act(async () => {
      root.render(
        <I18nProvider language="zh-CN">
          <AgentLedgerPanel client={client} />
        </I18nProvider>
      );
    });
  }

  async function click(button: HTMLButtonElement | null) {
    if (!button) {
      throw new Error("button not found");
    }

    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }

  function findButton(label: string): HTMLButtonElement | null {
    return (
      [...container.querySelectorAll("button")].find((element) => element.textContent?.includes(label)) ?? null
    );
  }
});

describe("planFor", () => {
  it("separates what reconcile will do from what it will leave for a person", () => {
    expect(planFor(FINDINGS)).toEqual({ mount: 1, unmount: 0, skip: 1 });
  });

  it("counts an undeclared skill as something only a person can settle", () => {
    expect(
      planFor([{ kind: "undeclared", name: "x", targetId: null, targetDisplayName: null, path: null, detail: "" }])
    ).toEqual({ mount: 0, unmount: 0, skip: 1 });
  });
});

function createClient(overrides: { findings?: typeof FINDINGS } = {}) {
  const calls: string[] = [];
  const findings = overrides.findings ?? FINDINGS;

  return {
    calls,
    async getRuleStatus() {
      calls.push("getRuleStatus");
      return {
        rulesDirectory: "/home/user/.memmy/agent-rules",
        entries: [
          {
            ruleId: "heimdall",
            targetId: "codex",
            targetDisplayName: "Codex",
            filePath: "/home/user/.codex/AGENTS.md",
            state: "in_sync" as const
          }
        ],
        errors: [],
        unavailableTargetIds: []
      };
    },
    async applyRules() {
      calls.push("applyRules");
      return { written: [], removed: [], errors: [], unavailableTargetIds: [] };
    },
    async getSkillStatus() {
      calls.push("getSkillStatus");
      return {
        libraryPath: "/home/user/.agents/skills",
        manifestPath: "/home/user/.memmy/skill-manifest.yaml",
        managedNames: ["memmy-memory"],
        manifestMissing: false,
        observations: [
          {
            name: "pdf",
            targetId: "codex",
            targetDisplayName: "Codex",
            path: "/home/user/.codex/skills/pdf",
            state: "linked" as const
          }
        ],
        findings,
        unavailableTargetIds: []
      };
    },
    async reconcileSkills() {
      calls.push("reconcileSkills");
      return { mounted: [], unmounted: [], skipped: [], unavailableTargetIds: [] };
    },
    async freezeSkills() {
      calls.push("freezeSkills");
      return { manifestPath: "/home/user/.memmy/skill-manifest.yaml", declarations: 45 };
    }
  } satisfies AgentLedgerClient & { calls: string[] } & Record<string, unknown>;
}
