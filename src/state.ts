import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { CachedTemplate } from "./types.js";

export const templateCache = new Map<string, CachedTemplate>();
export const pendingUserInputCache = new Map<string, unknown[]>();
export const synthesizedWrapperCache = new Map<string, unknown[]>();

export const sessionKey = (ctx: ExtensionContext) => ctx.sessionManager.getSessionFile() ?? `memory:${ctx.cwd}`;

export function resetSessionState(ctx: ExtensionContext) {
  const key = sessionKey(ctx);
  templateCache.delete(key);
  pendingUserInputCache.delete(key);
  synthesizedWrapperCache.delete(key);
}
