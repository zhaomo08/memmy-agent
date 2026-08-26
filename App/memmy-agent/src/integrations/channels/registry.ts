import { BaseChannel } from "./base.js";
import { WebSocketChannel } from "./websocket.js";

export type ChannelClass = new (...args: any[]) => BaseChannel;

const BUILTIN_CHANNELS: Readonly<Record<string, ChannelClass>> = Object.freeze({
  websocket: WebSocketChannel,
});

export function normalizeChannelName(name: string): string {
  return String(name).trim().toLowerCase().replaceAll("-", "_");
}

export function discoverChannelNames(): string[] {
  return Object.keys(BUILTIN_CHANNELS);
}

export function loadChannelClass(moduleName: string): ChannelClass {
  const normalized = normalizeChannelName(moduleName);
  const cls = BUILTIN_CHANNELS[normalized];
  if (!cls) throw new Error(`Unsupported internal channel: ${moduleName}`);
  return cls;
}

export function discoverEnabled(
  enabledNames: Set<string> | string[],
  { names = null }: { names?: string[] | null; includeAllExternal?: boolean } = {},
): Record<string, ChannelClass> {
  const enabled = new Set([...enabledNames].map(normalizeChannelName));
  const sourceNames = names ?? discoverChannelNames();
  const out: Record<string, ChannelClass> = {};
  for (const name of sourceNames) {
    const normalized = normalizeChannelName(name);
    if (enabled.has(normalized) && BUILTIN_CHANNELS[normalized]) {
      out[normalized] = BUILTIN_CHANNELS[normalized];
    }
  }
  return out;
}

export function discoverAll(): Record<string, ChannelClass> {
  return { ...BUILTIN_CHANNELS };
}

export function getChannel(name: string): ChannelClass | undefined {
  return BUILTIN_CHANNELS[normalizeChannelName(name)];
}

export function channelMetadata(): Array<Record<string, any>> {
  return Object.entries(BUILTIN_CHANNELS).map(([name, cls]) => ({
    name,
    className: cls.name,
    builtin: true,
  }));
}
