import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireSqliteServerLock, memoryServerAuthOptions } from "../src/server/index.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Memory server sqlite lock", () => {
  it("rejects a second live server for the same sqlite path", () => {
    const root = mkdtempSync(join(tmpdir(), "mindock-memory-server-lock-"));
    roots.push(root);
    const sqlitePath = join(root, "memory.sqlite");
    const first = acquireSqliteServerLock({
      sqlitePath,
      host: "127.0.0.1",
      port: 18960
    });

    expect(() => acquireSqliteServerLock({
      sqlitePath,
      host: "127.0.0.1",
      port: 18991
    })).toThrow(/already served by pid/);

    first?.release();
    const second = acquireSqliteServerLock({
      sqlitePath,
      host: "127.0.0.1",
      port: 18991
    });
    second?.release();
  });

  it("replaces stale sqlite lock files", () => {
    const root = mkdtempSync(join(tmpdir(), "mindock-memory-server-stale-lock-"));
    roots.push(root);
    const sqlitePath = join(root, "memory.sqlite");
    const lockPath = `${sqlitePath}.server.lock`;
    writeFileSync(lockPath, JSON.stringify({
      pid: 0,
      host: "127.0.0.1",
      port: 18960
    }), "utf8");

    const lock = acquireSqliteServerLock({
      sqlitePath,
      host: "127.0.0.1",
      port: 18991
    });
    const payload = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; port: number };

    expect(payload.pid).toBe(process.pid);
    expect(payload.port).toBe(18991);
    lock?.release();
  });
});

describe("Memory server authentication policy", () => {
  it("requires authentication on loopback and non-loopback listeners", () => {
    expect(() => memoryServerAuthOptions("127.0.0.1")).toThrow(/authentication token is required/);
    expect(() => memoryServerAuthOptions("0.0.0.0")).toThrow(/non-loopback host 0\.0\.0\.0/);
    expect(() => memoryServerAuthOptions("::", undefined)).toThrow(/non-loopback host ::/);
  });

  it("accepts an authenticated non-loopback listener", () => {
    expect(memoryServerAuthOptions("0.0.0.0", "service-token")).toEqual({
      localServiceToken: "service-token"
    });
  });
});
