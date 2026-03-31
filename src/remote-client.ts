import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { COMPACTION_ERROR_PREFIX } from "./types.js";
import { isRecord } from "./utils.js";

export async function callRemoteCompact(ctx: ExtensionContext, request: Record<string, unknown>, signal: AbortSignal) {
  const model = ctx.model;
  if (!model) throw new Error(`${COMPACTION_ERROR_PREFIX}: no active model selected`);
  if (model.api !== "openai-responses") {
    throw new Error(`${COMPACTION_ERROR_PREFIX}: current model api ${model.api} is not openai-responses`);
  }
  if (!model.baseUrl) {
    throw new Error(`${COMPACTION_ERROR_PREFIX}: current model has no baseUrl`);
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(`${COMPACTION_ERROR_PREFIX}: auth resolution failed: ${auth.error}`);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(auth.headers ?? {}),
  };
  if (auth.apiKey && !headers.Authorization) headers.Authorization = `Bearer ${auth.apiKey}`;
  const url = `${model.baseUrl.replace(/\/$/, "")}/responses/compact`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
    signal,
  });
  const text = await response.text();
  const json = JSON.parse(text) as unknown;
  if (!response.ok) {
    throw new Error(`${COMPACTION_ERROR_PREFIX}: HTTP ${response.status} ${JSON.stringify(json).slice(0, 800)}`);
  }
  if (!isRecord(json) || !Array.isArray(json.output)) {
    throw new Error(`${COMPACTION_ERROR_PREFIX}: missing output array in remote response`);
  }
  return json;
}
