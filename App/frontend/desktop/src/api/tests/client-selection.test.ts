import type { RuntimeConfig } from "@memmy/local-api-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppClients } from "../client-types.js";

const runtimeConfig: RuntimeConfig = {
  baseUrl: "http://127.0.0.1:18100",
  localToken: "token",
  memory: { baseUrl: "http://127.0.0.1:18960" }
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("frontend API client selection", () => {
  it("requires runtime config and returns real HTTP clients without mock flag", () => {
    expect(() => createAppClients({ runtimeConfig: null })).toThrow("Runtime config is required.");

    const clients = createAppClients({ runtimeConfig });
    expect("isMock" in clients).toBe(false);
    expect(clients.runtimeConfig.memory?.baseUrl).toBe("http://127.0.0.1:18960");
  });
});
