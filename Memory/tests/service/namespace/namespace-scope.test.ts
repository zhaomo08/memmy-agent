import { describe, expect, it } from "vitest";
import { sessionScopeForOpenRequest } from "../../../src/service/namespace/namespace-scope.js";
import { resolveWorkspaceIdentity, workspaceIdFromPath } from "../../../src/utils/workspace.js";
import type { RuntimeNamespace, SessionOpenRequest } from "../../../src/types.js";

const namespace: RuntimeNamespace = { source: "claude_code", profileId: "default", userId: "local-user" };
const repoRoot = process.cwd().replace(/\/Memory$/, "");

describe("resolveWorkspaceIdentity", () => {
  it("canonicalises a subdirectory to its repository root", () => {
    const fromSubdir = resolveWorkspaceIdentity(`${repoRoot}/Memory/src/utils`);
    const fromRoot = resolveWorkspaceIdentity(repoRoot);

    expect(fromSubdir.workspaceId).toBe(fromRoot.workspaceId);
    expect(fromSubdir.workspacePath).toBe(fromRoot.workspacePath);
  });

  it("names a worktree after its parent repository", () => {
    // This checkout is itself a git worktree of memmy-agent.
    const identity = resolveWorkspaceIdentity(repoRoot);

    expect(identity.projectLabel).toBe("memmy-agent/memmy-agent-chatwise");
  });

  it("keeps the desktop agent's id for a non-git folder", () => {
    const identity = resolveWorkspaceIdentity("/Users/example/.memmy/workspace");

    expect(identity.workspaceId).toBe("a175da130cbe3a60");
    expect(identity.workspaceId).toBe(workspaceIdFromPath("/Users/example/.memmy/workspace"));
  });

  it("refuses to treat containers as projects", () => {
    expect(resolveWorkspaceIdentity("/")).toEqual({});
    expect(resolveWorkspaceIdentity("~", { homeDirectory: "/Users/example" })).toEqual({});
    expect(resolveWorkspaceIdentity("/Users/example", { homeDirectory: "/Users/example" })).toEqual({});
    expect(resolveWorkspaceIdentity("")).toEqual({});
    expect(resolveWorkspaceIdentity("relative/path")).toEqual({});
  });
});

describe("sessionScopeForOpenRequest", () => {
  it("derives project and workspace ids from a bare workspace path", () => {
    const scope = sessionScopeForOpenRequest(
      { sessionId: "s1", source: "claude_code", workspacePath: `${repoRoot}/Memory/src` } as SessionOpenRequest,
      namespace
    );

    expect(scope.workspaceId).toBe(resolveWorkspaceIdentity(repoRoot).workspaceId);
    expect(scope.projectId).toBe(scope.workspaceId);
  });

  it("keeps explicit ids ahead of the derived one", () => {
    const scope = sessionScopeForOpenRequest(
      { sessionId: "s2", projectId: "explicit-project", workspaceId: "explicit-ws", workspacePath: repoRoot } as SessionOpenRequest,
      namespace
    );

    expect(scope.projectId).toBe("explicit-project");
    expect(scope.workspaceId).toBe("explicit-ws");
  });

  it("leaves ids unset when there is no usable path", () => {
    const scope = sessionScopeForOpenRequest({ sessionId: "s3" } as SessionOpenRequest, namespace);

    expect(scope.workspaceId).toBeUndefined();
    expect(scope.projectId).toBeUndefined();
  });
});
