/** Tools actions tests. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/http.js";
import type { IntegrationsClient } from "../../api/integrations-client.js";
import type { ToolsAction } from "../tools-slice.js";
import { toolsActions } from "../app-actions.js";

describe("toolsActions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("加载连接遇到 composio_not_configured 时静默忽略集成错误", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createFailingIntegrationsClient(
      new ApiRequestError("尚未配置 Composio 鉴权服务", 400, "composio_not_configured", "req-1")
    );

    await toolsActions.loadConnections(client, dispatch);

    expect(dispatch).toHaveBeenCalledWith({ type: "tools/loadStart" });
    expect(dispatch).toHaveBeenCalledWith({
      type: "tools/loadSuccess",
      connections: []
    });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "tools/loadFailure" }));
    expect(warn).toHaveBeenCalledWith(
      "[tools] integration setup diagnostic hidden from product UI:",
      expect.objectContaining({ code: "composio_not_configured" })
    );
  });

  it("首次加载只读取连接列表，工具目录不依赖 Cloud 能力清单", async () => {
    const dispatch = vi.fn<(action: ToolsAction) => void>();
    const client: IntegrationsClient = {
      authorize: vi.fn(async () => ({ connectUrl: "https://backend.composio.dev/api/v3/s/github-test", connectionId: "conn-github" })),
      listCapabilities: vi.fn(async () => ({ toolkits: ["github"] })),
      listConnections: vi.fn(async () => ({
        connections: [{ id: "conn-github", toolkit: "github", status: "ACTIVE" }]
      })),
      deleteConnection: vi.fn(async () => undefined)
    };

    await toolsActions.loadConnections(client, dispatch);

    expect(client.listCapabilities).not.toHaveBeenCalled();
    expect(client.listConnections).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "tools/loadSuccess",
      connections: [{ id: "conn-github", toolkit: "github", status: "ACTIVE", surface: "integration" }]
    });
  });
});

/** Creates create failing integrations client. */
function createFailingIntegrationsClient(error: unknown): IntegrationsClient {
  return {
    authorize: vi.fn(async () => {
      throw error;
    }),
    listCapabilities: vi.fn(async () => {
      throw error;
    }),
    listConnections: vi.fn(async () => {
      throw error;
    }),
    deleteConnection: vi.fn(async () => undefined)
  };
}
