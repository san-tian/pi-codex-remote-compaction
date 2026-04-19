import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { COMPACTION_ERROR_PREFIX, RemoteCompactUnavailableError } from "./types.js";
import { isRecord } from "./utils.js";

const REMOTE_COMPACT_UNAVAILABLE_STATUSES = new Set([404, 405, 410, 501]);
const REMOTE_COMPACT_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const REMOTE_COMPACT_MAX_ATTEMPTS = 3;
const REMOTE_COMPACT_RETRY_DELAY_MS = 500;

function parseJsonBody(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function describeBody(json: unknown, text: string) {
  if (json !== undefined) return JSON.stringify(json).slice(0, 800);
  return text.trim().replace(/\s+/g, " ").slice(0, 800);
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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

  for (let attempt = 1; attempt <= REMOTE_COMPACT_MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal,
    });
    const text = await response.text();
    const json = parseJsonBody(text);
    if (!response.ok) {
      const body = describeBody(json, text);
      if (REMOTE_COMPACT_UNAVAILABLE_STATUSES.has(response.status)) {
        throw new RemoteCompactUnavailableError(
          `${COMPACTION_ERROR_PREFIX}: /responses/compact unavailable (HTTP ${response.status}${body ? ` ${body}` : ""})`,
        );
      }
      const retryable = REMOTE_COMPACT_RETRYABLE_STATUSES.has(response.status);
      if (retryable && attempt < REMOTE_COMPACT_MAX_ATTEMPTS) {
        await sleep(REMOTE_COMPACT_RETRY_DELAY_MS * attempt, signal);
        continue;
      }
      const retrySuffix = retryable ? ` after ${attempt} attempts` : "";
      throw new Error(`${COMPACTION_ERROR_PREFIX}: HTTP ${response.status}${body ? ` ${body}` : ""}${retrySuffix}`);
    }
    if (json === undefined) {
      throw new Error(`${COMPACTION_ERROR_PREFIX}: remote response was not valid JSON`);
    }
    if (!isRecord(json) || !Array.isArray(json.output)) {
      throw new Error(`${COMPACTION_ERROR_PREFIX}: missing output array in remote response`);
    }
    return json;
  }

  throw new Error(`${COMPACTION_ERROR_PREFIX}: remote compaction exhausted retries`);
}
