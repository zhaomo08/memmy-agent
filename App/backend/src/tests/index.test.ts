/** Index tests. */
import { AppBootstrapResponseSchema } from "@memmy/local-api-contracts";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import YAML from "yaml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CloudClient } from "../adapters/outbound/cloud-client/index.js";
import type { MemoryClient } from "../adapters/outbound/memory-client/index.js";
import { createLocalBackend, readMemoryLayerConfig, type LocalBackend } from "../index.js";
import { createAppStateStore } from "../infrastructure/app-state-store/index.js";
import { createMockCloudClient } from "./support/mock-cloud-client.js";
import { createMockMemoryClient } from "./support/mock-memory-client.js";

let tempDir: string | undefined;
let backend: LocalBackend | undefined;
let integrationServer: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  if (integrationServer) {
    await new Promise<void>((resolve, reject) => {
      integrationServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    integrationServer = undefined;
  }

  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("local api", () => {
  it("requires an explicit Memmy config path instead of using the user's home directory", async () => {
    const previousMemmyConfig = process.env.MEMMY_CONFIG;
    delete process.env.MEMMY_CONFIG;
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-config-path-"));

    try {
      await expect(
        createLocalBackend({
          databasePath: join(tempDir, "app.sqlite"),
          runtimeConfigPath: join(tempDir, "runtime.json"),
          localToken: "test-token",
          memoryClient: createMockMemoryClient(),
          cloudClient: createMockCloudClient()
        })
      ).rejects.toThrow("memmyConfigPath or MEMMY_CONFIG is required");
    } finally {
      restoreOptionalEnv("MEMMY_CONFIG", previousMemmyConfig);
    }
  });

  it("reloads Memory config when the desktop backend starts", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-startup-reload-"));
    const baseClient = createMockMemoryClient();
    const reloadReasons: unknown[] = [];
    const memoryClient: MemoryClient = {
      ...baseClient,
      async reloadConfig(input) {
        reloadReasons.push(input);
        return baseClient.reloadConfig(input);
      }
    };

    backend = await createLocalBackend({
      databasePath: join(tempDir, "app.sqlite"),
      runtimeConfigPath: join(tempDir, "runtime.json"),
      localToken: "test-token",
      memoryBaseUrl: "http://127.0.0.1:18960",
      memoryClient,
      cloudClient: createMockCloudClient(),
      memmyConfigPath: join(tempDir, "config.yaml")
    });

    expect(reloadReasons).toEqual([{ reason: "desktop_startup" }]);
    expect(backend.runtimeConfig.memory).toEqual({ baseUrl: "http://127.0.0.1:18960" });
  });

  it("does not block local API startup while managed Memory is still initializing", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-memory-ready-"));
    const baseClient = createMockMemoryClient();
    const reloadReasons: unknown[] = [];
    let markMemoryReady: (() => void) | undefined;
    const memoryReady = new Promise<void>((resolveReady) => {
      markMemoryReady = resolveReady;
    });
    const memoryClient: MemoryClient = {
      ...baseClient,
      async reloadConfig(input) {
        reloadReasons.push(input);
        return baseClient.reloadConfig(input);
      }
    };

    backend = await createLocalBackend({
      databasePath: join(tempDir, "app.sqlite"),
      runtimeConfigPath: join(tempDir, "runtime.json"),
      localToken: "test-token",
      memoryBaseUrl: "http://127.0.0.1:18960",
      memoryReady,
      memoryClient,
      cloudClient: createMockCloudClient(),
      memmyConfigPath: join(tempDir, "config.yaml")
    });

    expect(reloadReasons).toEqual([]);
    markMemoryReady?.();
    await vi.waitFor(() => expect(reloadReasons).toEqual([{ reason: "desktop_startup" }]));
  });

  it("uses the built-in default Cloud client when MEMMY_CLOUD_URL is missing", async () => {
    const previousCloudUrl = process.env.MEMMY_CLOUD_URL;
    delete process.env.MEMMY_CLOUD_URL;
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-"));

    try {
      backend = await createLocalBackend({
        databasePath: join(tempDir, "app.sqlite"),
        runtimeConfigPath: join(tempDir, "runtime.json"),
        localToken: "test-token",
        memoryClient: createMockMemoryClient(),
        memmyConfigPath: join(tempDir, "config.yaml")
      });

      expect(backend.runtimeConfig.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      restoreOptionalEnv("MEMMY_CLOUD_URL", previousCloudUrl);
    }
  });

  it("keeps send-code available when the installation id cannot be read", async () => {
    const previousCloudUrl = process.env.MEMMY_CLOUD_URL;
    let deviceId: string | undefined;
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-device-id-unavailable-"));
    const databasePath = join(tempDir, "app.sqlite");
    const preparedStore = createAppStateStore({ databasePath });
    preparedStore.db.exec("ALTER TABLE app_settings DROP COLUMN installation_id");
    preparedStore.close();

    integrationServer = createServer(async (request, response) => {
      if (
        request.method === "POST" &&
        request.url === "/api/agentUser/sendEmailVerification"
      ) {
        deviceId = request.headers["x-memmy-device-id"] as string | undefined;
        sendJson(response, { code: 0, message: "ok", data: true });
        return;
      }

      sendJson(response, { code: 40000, message: "not found", data: null }, 404);
    });
    await listen(integrationServer);
    const address = integrationServer.address();
    if (!address || typeof address === "string") {
      throw new Error("Mock Cloud server did not bind to a port");
    }
    process.env.MEMMY_CLOUD_URL = `http://127.0.0.1:${address.port}`;

    try {
      backend = await createLocalBackend({
        databasePath,
        runtimeConfigPath: join(tempDir, "runtime.json"),
        localToken: "test-token",
        memoryClient: createMockMemoryClient(),
        memmyConfigPath: join(tempDir, "config.yaml")
      });

      const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/account/send-code`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memmy-local-token": "test-token"
        },
        body: JSON.stringify({
          channel: "email",
          email: "hello@example.com",
          locale: "zh"
        })
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true, resendAfterSec: 60 });
      expect(deviceId).toBeUndefined();
    } finally {
      restoreOptionalEnv("MEMMY_CLOUD_URL", previousCloudUrl);
    }
  });

  it("fails fast when no real Memory Layer or local SQLite memory source is configured", async () => {
    const previousMemoryLayerUrl = process.env.MEMMY_MEMORY_LAYER_URL;
    const previousMemoryDbPath = process.env.MEMMY_MEMORY_DB_PATH;
    const previousMemosDbPath = process.env.MEMMY_MEMOS_DB_PATH;
    const previousDisableSqlite = process.env.MEMMY_DISABLE_MEMOS_SQLITE;
    delete process.env.MEMMY_MEMORY_LAYER_URL;
    delete process.env.MEMMY_MEMORY_DB_PATH;
    delete process.env.MEMMY_MEMOS_DB_PATH;
    process.env.MEMMY_DISABLE_MEMOS_SQLITE = "1";
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-"));

    try {
      await expect(
        createLocalBackend({
          databasePath: join(tempDir, "app.sqlite"),
          runtimeConfigPath: join(tempDir, "runtime.json"),
          localToken: "test-token",
          cloudClient: createMockCloudClient(),
          memmyConfigPath: join(tempDir, "config.yaml")
        })
      ).rejects.toThrow("MEMMY_MEMORY_LAYER_URL or a local Memmy memory SQLite source is required");
    } finally {
      restoreOptionalEnv("MEMMY_MEMORY_LAYER_URL", previousMemoryLayerUrl);
      restoreOptionalEnv("MEMMY_MEMORY_DB_PATH", previousMemoryDbPath);
      restoreOptionalEnv("MEMMY_MEMOS_DB_PATH", previousMemosDbPath);
      restoreOptionalEnv("MEMMY_DISABLE_MEMOS_SQLITE", previousDisableSqlite);
    }
  });

  it("uses a 20s default timeout for Memory Layer HTTP clients", () => {
    expect(readMemoryLayerConfig({
      MEMMY_MEMORY_LAYER_URL: " http://127.0.0.1:18960 "
    } as NodeJS.ProcessEnv)).toMatchObject({
      baseUrl: "http://127.0.0.1:18960",
      timeoutMs: 20_000
    });
  });

  it("accepts Memory service URL aliases for the writable Memory Layer client", () => {
    expect(readMemoryLayerConfig({
      MEMMY_MEMORY_URL: " http://127.0.0.1:18960 ",
      MEMMY_MEMORY_TOKEN: "memory-token"
    } as NodeJS.ProcessEnv)).toMatchObject({
      baseUrl: "http://127.0.0.1:18960",
      token: "memory-token"
    });
    expect(readMemoryLayerConfig({
      MEMORY_SERVICE_URL: " http://127.0.0.1:18888 ",
      MEMORY_SERVICE_TOKEN: "service-token"
    } as NodeJS.ProcessEnv)).toMatchObject({
      baseUrl: "http://127.0.0.1:18888",
      token: "service-token"
    });
  });

  it("returns a schema-valid bootstrap response", async () => {
    backend = await createTempBackend();

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "test-token"
      }
    });

    expect(response.status).toBe(200);
    const parsed = AppBootstrapResponseSchema.parse(await response.json());
    expect(parsed.onboarding.completed).toBe(false);
    expect(parsed.health).toMatchObject({
      localApi: "ok",
      memory: "ok",
      cloud: "mock"
    });
    // When the default mock does not deliver legal agreement links, bootstrap omits legal and the frontend falls back to the local table.
    expect(parsed.legal).toBeUndefined();
  });

  it("surfaces cloud-delivered legal agreement urls in bootstrap", async () => {
    const legal = {
      terms: {
        "zh-CN": "https://legal.memtensor.cn/terms?lang=zh-CN",
        "en-US": "https://legal.memtensor.cn/terms?lang=en-US"
      },
      data: {
        "zh-CN": "https://legal.memtensor.cn/data?lang=zh-CN",
        "en-US": "https://legal.memtensor.cn/data?lang=en-US"
      }
    };
    backend = await createTempBackend({ cloudClient: createMockCloudClient({ legal }) });

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "test-token"
      }
    });

    expect(response.status).toBe(200);
    const parsed = AppBootstrapResponseSchema.parse(await response.json());
    expect(parsed.legal).toEqual(legal);
  });

  it("exposes app settings and records the launch mode for the desktop shell", async () => {
    backend = await createTempBackend();

    expect(backend.getAppSettings().lastLaunchMode).toBe("full");

    const updated = backend.recordLaunchMode("pet");

    expect(updated.lastLaunchMode).toBe("pet");
    expect(backend.getAppSettings().lastLaunchMode).toBe("pet");
  });

  it("hydrates app-state from runtime YAML before the first bootstrap response", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-"));
    const databasePath = join(tempDir, "app.sqlite");
    const memmyConfigPath = join(tempDir, ".memmy", "config.yaml");
    const store = createAppStateStore({ databasePath });
    store.repositories.bootstrap.updateAppSettings({ userMode: "byok" });
    store.close();
    mkdirSync(join(tempDir, ".memmy"), { recursive: true });
    writeFileSync(
      memmyConfigPath,
      [
        "app:",
        "  cloudUuid: cloud.login.uuid",
        "  userId: user-1",
        "agents:",
        "  defaults:",
        "    provider: memmy_account",
        "    model: agent_chat",
        "providers:",
        "  memmy_account:",
        `    apiBase: ${process.env.MEMMY_CLOUD_SERVICE}/api/agentExternal/v1`,
        "    apiKey: cloud.login.uuid",
        "memmyMemory:",
        "  activeProfile: account",
        ""
      ].join("\n"),
      "utf8"
    );

    backend = await createLocalBackend({
      databasePath,
      runtimeConfigPath: join(tempDir, "runtime.json"),
      localToken: "test-token",
      memoryClient: createMockMemoryClient(),
      cloudClient: createMockCloudClient(),
      memmyConfigPath
    });

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "test-token"
      }
    });

    expect(response.status).toBe(200);
    const parsed = AppBootstrapResponseSchema.parse(await response.json());
    expect(parsed.app.userMode).toBe("account");
  });

  it("uses MEMMY_CONFIG as the shared startup sync and settings writer path", async () => {
    const previousMemmyConfig = process.env.MEMMY_CONFIG;
    tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-"));
    const memmyConfigPath = join(tempDir, ".memmy", "config.yaml");
    mkdirSync(join(tempDir, ".memmy"), { recursive: true });
    writeFileSync(
      memmyConfigPath,
      [
        "agents:",
        "  defaults:",
        "    provider: openai",
        "    model: gpt-4o",
        "providers:",
        "  openai:",
        "    apiBase: https://api.openai.example/v1",
        "    apiKey: sk-main",
        "memmyMemory:",
        "  activeProfile: byok",
        ""
      ].join("\n"),
      "utf8"
    );
    process.env.MEMMY_CONFIG = memmyConfigPath;

    try {
      backend = await createLocalBackend({
        databasePath: join(tempDir, "app.sqlite"),
        runtimeConfigPath: join(tempDir, "runtime.json"),
        localToken: "test-token",
        memoryClient: createMockMemoryClient(),
        cloudClient: createMockCloudClient()
      });

      const bootstrapResponse = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
        method: "GET",
        headers: {
          "x-memmy-local-token": "test-token"
        }
      });
      const modelConfigResponse = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/model-config`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-memmy-local-token": "test-token"
        },
        body: JSON.stringify({
          provider: "openai_compatible",
          baseUrl: "https://api.changed.example/v1",
          modelId: "gpt-4.1-mini",
          apiKey: "sk-changed"
        })
      });

      expect(bootstrapResponse.status).toBe(200);
      await expect(bootstrapResponse.json()).resolves.toMatchObject({
        app: {
          userMode: "byok"
        }
      });
      expect(modelConfigResponse.status).toBe(200);
      const parsedConfig = YAML.parse(readFileSync(memmyConfigPath, "utf8")) as any;
      expect(parsedConfig.agents.defaults).toEqual({
        provider: "openai",
        model: "gpt-4.1-mini"
      });
      expect(parsedConfig.providers.openai).toMatchObject({
        apiBase: "https://api.changed.example/v1",
        apiKey: "sk-changed"
      });
    } finally {
      restoreOptionalEnv("MEMMY_CONFIG", previousMemmyConfig);
    }
  });

  it("uses Memory and Cloud clients for bootstrap health", async () => {
    backend = await createTempBackend({
      memoryClient: createMockMemoryClient({
        health: {
          ok: false,
          version: "test-0.0.0",
          uptimeMs: 0,
          mode: "dev",
          storage: {
            backend: "sqlite",
            schemaVersion: "test",
            ready: false
          },
          capabilities: {
            routes: [],
            tools: [],
            memoryLayers: ["L1", "L2", "L3", "Skill"],
            supportsCli: false
          },
          serverTime: new Date().toISOString()
        }
      }),
      cloudClient: createMockCloudClient({
        health: {
          status: "ok",
          checkedAt: new Date().toISOString(),
          message: "cloud reachable"
        }
      })
    });

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "test-token"
      }
    });

    expect(response.status).toBe(200);
    const parsed = AppBootstrapResponseSchema.parse(await response.json());
    expect(parsed.health).toMatchObject({
      localApi: "ok",
      memory: "unavailable",
      cloud: "ok"
    });
  });

  it("rejects local api requests with an invalid runtime token", async () => {
    backend = await createTempBackend();

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "wrong-token"
      }
    });

    expect(response.status).toBe(401);
  });

  it("allows renderer preflight requests for local api calls", async () => {
    backend = await createTempBackend();

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-memmy-local-token"
      }
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:5173");
    expect(response.headers.get("access-control-allow-headers")).toContain("x-memmy-local-token");
  });

  it("rejects browser requests from non-local origins", async () => {
    backend = await createTempBackend();

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/app/bootstrap`, {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-memmy-local-token"
      }
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("streams connected and heartbeat SSE events", async () => {
    backend = await createTempBackend({
      heartbeatIntervalMs: 20
    });

    const controller = new AbortController();
    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/events?token=test-token`, {
      signal: controller.signal
    });
    const text = await readStreamUntil(response, "app.heartbeat");
    controller.abort();

    expect(text).toContain("event: app.connected");
    expect(text).toContain("event: app.heartbeat");
  });

  it("writes runtime config and exposes the runtime search endpoint", async () => {
    backend = await createTempBackend();

    const runtimeConfig = JSON.parse(readFileSync(join(tempDir ?? "", "runtime.json"), "utf8")) as unknown;
    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/v1/memory/search`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-memmy-local-token": "test-token"
      },
      body: JSON.stringify({
        adapterId: "test-cli",
        requestId: "req-1",
        query: "desktop"
      })
    });

    expect(runtimeConfig).toEqual(backend.runtimeConfig);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      injectedContext: ""
    });
  });

  it("exposes only the Codex and Claude Code built-in sources in registry order", async () => {
    backend = await createTempBackend();

    const response = await fetch(`${backend.runtimeConfig.baseUrl}/api/agent-sources`, {
      method: "GET",
      headers: {
        "x-memmy-local-token": "test-token"
      }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({ sourceId: "claude_code", displayName: "Claude Code" }),
      expect.objectContaining({ sourceId: "codex", displayName: "Codex" })
    ]);
  });
});

async function createTempBackend(
  options: {
    heartbeatIntervalMs?: number;
    memoryClient?: MemoryClient;
    cloudClient?: CloudClient;
  } = {}
): Promise<LocalBackend> {
  tempDir = mkdtempSync(join(tmpdir(), "memmy-backend-"));
  return createLocalBackend({
    databasePath: join(tempDir, "app.sqlite"),
    runtimeConfigPath: join(tempDir, "runtime.json"),
    localToken: "test-token",
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    memoryClient: options.memoryClient ?? createMockMemoryClient(),
    cloudClient: options.cloudClient ?? createMockCloudClient(),
    memmyConfigPath: join(tempDir, "config.yaml")
  });
}

/**
 * Restores an optional environment variable.
 *
 * @param key The environment variable name.
 * @param value The original value; undefined means delete it.
 */
function restoreOptionalEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

async function readStreamUntil(response: Response, expected: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Expected readable response body");
  }

  const decoder = new TextDecoder();
  let text = "";
  const timeoutAt = Date.now() + 2_000;

  while (!text.includes(expected)) {
    if (Date.now() > timeoutAt) {
      throw new Error(`Timed out waiting for ${expected}`);
    }

    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    text += decoder.decode(chunk.value, { stream: true });
  }

  await reader.cancel();
  return text;
}


/**
 * Starts the test HTTP server.
 *
 * @param serverToListen The server to start.
 */
function listen(serverToListen: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    serverToListen.once("error", reject);
    serverToListen.listen({ host: "127.0.0.1", port: 0 }, () => {
      serverToListen.off("error", reject);
      resolve();
    });
  });
}

/**
 * Reads the JSON request body.
 *
 * @param request The HTTP request.
 * @returns The parsed JSON object.
 */
async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/**
 * Sends a JSON response.
 *
 * @param response The HTTP response.
 * @param body The response body.
 * @param status The HTTP status code.
 */
function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
