/** Agent rules and agent skills route tests. */
import { afterEach, describe, expect, it } from "vitest";
import { createProgressBus } from "../../../../services/progress-bus.js";
import { createLocalApiServer } from "../server.js";
import type { FastifyInstance } from "fastify";
import type { PermissionManager } from "../../../../permission/index.js";
import type { BackendServices } from "../../../../services/index.js";

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const SKILL_STATUS = {
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
      state: "linked",
      linkTarget: "../../.agents/skills/pdf"
    }
  ],
  findings: [
    {
      kind: "not_mounted",
      name: "pdf",
      targetId: "claude_code",
      targetDisplayName: "Claude Code",
      path: "/home/user/.claude/skills/pdf",
      detail: "declared for this agent but not linked"
    }
  ],
  unavailableTargetIds: []
};

const RULE_STATUS = {
  rulesDirectory: "/home/user/.memmy/agent-rules",
  entries: [
    { ruleId: "heimdall", targetId: "codex", targetDisplayName: "Codex", filePath: "/home/user/.codex/AGENTS.md", state: "in_sync" }
  ],
  errors: [],
  unavailableTargetIds: []
};

describe("agent skills routes", () => {
  it("reports the ledger, and reconcile and freeze act, each behind the runtime token", async () => {
    const calls: string[] = [];
    app = createServer({
      agentSkills: {
        async status() {
          calls.push("status");
          return SKILL_STATUS;
        },
        async reconcile() {
          calls.push("reconcile");
          return { mounted: SKILL_STATUS.findings, unmounted: [], skipped: [], unavailableTargetIds: [] };
        },
        async freeze() {
          calls.push("freeze");
          return { manifestPath: SKILL_STATUS.manifestPath, declarations: 45 };
        }
      }
    });

    const status = await injectJson("GET", "/api/v1/agent-skills");
    const reconciled = await injectJson("POST", "/api/v1/agent-skills/reconcile", {});
    const frozen = await injectJson("POST", "/api/v1/agent-skills/freeze", {});

    expect(status.json()).toEqual(SKILL_STATUS);
    expect(reconciled.json()).toEqual({
      mounted: SKILL_STATUS.findings,
      unmounted: [],
      skipped: [],
      unavailableTargetIds: []
    });
    expect(frozen.json()).toEqual({ manifestPath: SKILL_STATUS.manifestPath, declarations: 45 });
    expect(calls).toEqual(["status", "reconcile", "freeze"]);
  });

  it("carries managedNames through, so the caller can tell silence from an oversight", async () => {
    app = createServer();

    expect((await injectJson("GET", "/api/v1/agent-skills")).json()).toMatchObject({
      managedNames: ["memmy-memory"]
    });
  });

  it("never writes while reporting", async () => {
    const calls: string[] = [];
    app = createServer({
      agentSkills: {
        async status() {
          calls.push("status");
          return SKILL_STATUS;
        },
        async reconcile() {
          calls.push("reconcile");
          throw new Error("reconcile must not run for a read");
        },
        async freeze() {
          calls.push("freeze");
          throw new Error("freeze must not run for a read");
        }
      }
    });

    await injectJson("GET", "/api/v1/agent-skills");
    expect(calls).toEqual(["status"]);
  });

  it("refuses to mount or freeze over a GET, so a browsing client cannot change the disk", async () => {
    app = createServer();

    expect((await injectJson("GET", "/api/v1/agent-skills/reconcile")).statusCode).toBe(404);
    expect((await injectJson("GET", "/api/v1/agent-skills/freeze")).statusCode).toBe(404);
  });

  it("rejects every route without a valid runtime token", async () => {
    app = createServer();

    for (const [method, url] of [
      ["GET", "/api/v1/agent-skills"],
      ["POST", "/api/v1/agent-skills/reconcile"],
      ["POST", "/api/v1/agent-skills/freeze"]
    ] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode).toBe(401);
    }
  });

  it("wraps a reconciler failure in the error envelope instead of leaking a stack", async () => {
    app = createServer({
      agentSkills: {
        async status() {
          throw new Error("EACCES: permission denied, scandir '/home/user/.codex/skills'");
        },
        async reconcile() {
          return { mounted: [], unmounted: [], skipped: [], unavailableTargetIds: [] };
        },
        async freeze() {
          return { manifestPath: SKILL_STATUS.manifestPath, declarations: 0 };
        }
      }
    });

    const response = await injectJson("GET", "/api/v1/agent-skills");

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: { code: "internal" } });
  });
});

describe("agent rules routes", () => {
  it("reports the directory the writer actually read, not one the route resolved for itself", async () => {
    app = createServer();

    expect((await injectJson("GET", "/api/v1/agent-rules")).json()).toEqual(RULE_STATUS);
  });

  it("applies rules and reports what moved", async () => {
    const calls: string[] = [];
    app = createServer({
      agentRules: {
        async status() {
          calls.push("status");
          return RULE_STATUS;
        },
        async apply() {
          calls.push("apply");
          return { written: RULE_STATUS.entries, removed: [], errors: [], unavailableTargetIds: [] };
        }
      }
    });

    const applied = await injectJson("POST", "/api/v1/agent-rules/apply", {});

    expect(applied.json()).toEqual({ written: RULE_STATUS.entries, removed: [], errors: [], unavailableTargetIds: [] });
    expect(calls).toEqual(["apply"]);
  });

  it("rejects both routes without a valid runtime token", async () => {
    app = createServer();

    for (const [method, url] of [
      ["GET", "/api/v1/agent-rules"],
      ["POST", "/api/v1/agent-rules/apply"]
    ] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode).toBe(401);
    }
  });
});

async function injectJson(method: string, url: string, payload?: unknown) {
  if (!app) {
    throw new Error("Test server is not initialized");
  }

  return app.inject({
    method,
    url,
    headers: {
      "x-memmy-local-token": "test-token"
    },
    payload
  });
}

function createServer(overrides: Record<string, unknown> = {}): FastifyInstance {
  const services = {
    bootstrap: {
      async getBootstrap() {
        throw new Error("bootstrap not used");
      }
    },
    progressBus: createProgressBus(),
    agentSkills: {
      async status() {
        return SKILL_STATUS;
      },
      async reconcile() {
        return { mounted: [], unmounted: [], skipped: [], unavailableTargetIds: [] };
      },
      async freeze() {
        return { manifestPath: SKILL_STATUS.manifestPath, declarations: 45 };
      }
    },
    agentRules: {
      async status() {
        return RULE_STATUS;
      },
      async apply() {
        return { written: [], removed: [], errors: [], unavailableTargetIds: [] };
      }
    },
    ...overrides
  } as unknown as BackendServices;

  return createLocalApiServer({
    permissionManager: createPermissionManager(),
    services,
    heartbeatIntervalMs: 20
  });
}

function createPermissionManager(): PermissionManager {
  return {
    async getRuntimeToken() {
      return "test-token";
    },
    async verifyRuntimeToken(token) {
      return token === "test-token";
    },
    async getScanPermission() {
      return "scan_and_write_skill";
    },
    async setScanPermission() {
      return undefined;
    },
    async canDetectAgentSources() {
      return true;
    },
    async canScanAgentSource() {
      return true;
    },
    async canWriteAgentSkill() {
      return true;
    },
    async canSearchMemory() {
      return true;
    },
    async revokeAgentSource() {
      return undefined;
    }
  };
}
