import { describe, expect, it, vi } from "vitest";
import { InboundMessage } from "../../src/core/runtime-messages/events.js";
import { registerBuiltinCommands } from "../../src/command/builtin.js";
import { CommandContext, CommandRouter } from "../../src/command/router.js";

function router(): CommandRouter {
  const r = new CommandRouter();
  registerBuiltinCommands(r);
  return r;
}

function fakeMsg(content: string): InboundMessage {
  return new InboundMessage({ channel: "websocket", chatId: "chat1", senderId: "user", content, metadata: {} });
}

describe("CommandRouter.isDispatchableCommand", () => {
  it("matches exact commands", () => {
    const r = router();
    for (const command of ["/new", "/help", "/model", "/dream", "/dream-log", "/dream-restore", "/goal"]) {
      expect(r.isDispatchableCommand(command)).toBe(true);
    }
  });

  it("matches prefix commands with arguments", () => {
    const r = router();
    for (const command of ["/dream-log abc123", "/dream-restore def456", "/model fast", "/goal migrate the database"]) {
      expect(r.isDispatchableCommand(command)).toBe(true);
    }
  });

  it("does not match priority commands", () => {
    const r = router();
    expect(r.isDispatchableCommand("/stop")).toBe(false);
    expect(r.isDispatchableCommand("/restart")).toBe(false);
  });

  it("does not match regular text", () => {
    const r = router();
    expect(r.isDispatchableCommand("hello")).toBe(false);
    expect(r.isDispatchableCommand("what is 2+2?")).toBe(false);
    expect(r.isDispatchableCommand("")).toBe(false);
  });

  it("is case-insensitive", () => {
    const r = router();
    expect(r.isDispatchableCommand("/NEW")).toBe(true);
    expect(r.isDispatchableCommand("/Help")).toBe(true);
  });

  it("strips surrounding whitespace", () => {
    const r = router();
    expect(r.isDispatchableCommand("  /new  ")).toBe(true);
  });

  it("does not match unknown slash commands", () => {
    const r = router();
    expect(r.isDispatchableCommand("/unknown")).toBe(false);
    expect(r.isDispatchableCommand("/foo bar")).toBe(false);
  });
});

describe("mid-turn command dispatch", () => {
  it("dispatches /new with session null", async () => {
    const r = router();
    const session = { messages: [], lastConsolidated: 0, clear: vi.fn(), key: "websocket:chat1" };
    const loop = {
      sessions: { getOrCreate: vi.fn(() => session), save: vi.fn(), invalidate: vi.fn() },
      scheduleBackground: vi.fn(),
      cancelActiveTasks: vi.fn(async () => 0),
    };
    const msg = fakeMsg("/new");
    const out = await r.dispatch(new CommandContext({ msg, session: null, key: "websocket:chat1", raw: "/new", loop }));
    expect(out?.content).toContain("New session");
    expect(loop.sessions.getOrCreate).toHaveBeenCalledWith("websocket:chat1");
  });

  it("dispatches /help with session null", async () => {
    const r = router();
    const msg = fakeMsg("/help");
    const out = await r.dispatch(new CommandContext({ msg, session: null, key: "websocket:chat1", raw: "/help", loop: {} }));
    expect(out).not.toBeNull();
  });

  it("populates args for prefix commands", async () => {
    const custom = new CommandRouter();
    const captured: string[] = [];
    custom.prefix("/test ", async (ctx) => {
      captured.push(ctx.args);
      return null;
    });
    await custom.dispatch(new CommandContext({ msg: fakeMsg("/test hello world"), key: "websocket:chat1", raw: "/test hello world", loop: {} }));
    expect(captured).toEqual(["hello world"]);
  });

  it("returns null for non-commands", async () => {
    const r = router();
    const out = await r.dispatch(new CommandContext({ msg: fakeMsg("hello world"), key: "websocket:chat1", raw: "hello world", loop: {} }));
    expect(out).toBeNull();
  });
});
