import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  buildEffectiveContextInput,
  filterRemoteOutputForCodexParity,
  getLastUserInputFromBranch,
  getLatestCodexCompaction,
} from "./src/codex-input.js";
import { writeDebugFile } from "./src/debug.js";
import { buildOverriddenPayload, captureTemplate } from "./src/provider-request.js";
import { callRemoteCompact } from "./src/remote-client.js";
import { pendingUserInputCache, resetSessionState, sessionKey, templateCache } from "./src/state.js";
import {
  COMPACTION_ERROR_PREFIX,
  DETAILS_VERSION,
  PLACEHOLDER_SUMMARY,
  type CodexRemoteCompactionDetails,
} from "./src/types.js";
import { isRecord, stripTransientFields, toErrorMessage } from "./src/utils.js";
import { buildSynthesizedUserWrapper, ensureUserWrapper } from "./src/wrapper.js";

export default function (pi: ExtensionAPI) {
  pi.on("input", async (event, ctx) => {
    const items = [
      {
        role: "user",
        content: [
          { type: "input_text", text: event.text },
          ...((event.images ?? []).map((image) => ({ type: "input_image", image_url: stripTransientFields(image.source ?? image) }))),
        ],
      },
    ];
    pendingUserInputCache.set(sessionKey(ctx), items);
    return { action: "continue" };
  });

  pi.registerCommand("codex-compact-probe", {
    description: "Probe the configured /responses/compact endpoint for Codex-remote compaction support",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      if (!model) {
        ctx.ui.notify(`${COMPACTION_ERROR_PREFIX}: no active model selected`, "error");
        return;
      }
      const request = {
        model: model.id,
        instructions: ctx.getSystemPrompt(),
        input: [
          { role: "user", content: [{ type: "input_text", text: "probe" }] },
          { type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "probe", annotations: [] }] },
        ],
        tools: [],
        parallel_tool_calls: true,
      };
      try {
        const result = await callRemoteCompact(ctx, request, AbortSignal.timeout(30000));
        await writeDebugFile("probe-response", result);
        ctx.ui.notify("Codex remote compact endpoint responded successfully", "success");
      } catch (error) {
        const message = toErrorMessage(error);
        await writeDebugFile("probe-error", { error: message });
        ctx.ui.notify(message, "error");
      }
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    resetSessionState(ctx);
  });

  pi.on("before_provider_request", async (event, ctx) => {
    const key = sessionKey(ctx);
    if (!isRecord(event.payload)) return;
    templateCache.set(key, captureTemplate(event.payload));

    const branch = ctx.sessionManager.getBranch();
    const latest = getLatestCodexCompaction(branch);
    if (!latest || !Array.isArray(event.payload.input)) {
      await writeDebugFile("provider-payload", { sessionKey: key, payload: event.payload });
      return;
    }

    const synthesizedWrapper = await buildSynthesizedUserWrapper(ctx);
    const overridden = buildOverriddenPayload({
      payload: event.payload,
      branch,
      latestId: latest.id,
      details: latest.details,
      synthesizedWrapper,
      cachedPrefix: templateCache.get(key)?.remotePrefixInput,
      pendingInput: pendingUserInputCache.get(key) ?? [],
    });
    pendingUserInputCache.delete(key);
    await writeDebugFile("provider-payload", { sessionKey: key, payload: overridden, overridden: true });
    return overridden;
  });

  pi.on("session_before_compact", async (event, ctx) => {
    const key = sessionKey(ctx);
    try {
      const template = templateCache.get(key);
      if (!template) {
        throw new Error(`${COMPACTION_ERROR_PREFIX}: no cached provider request template available yet`);
      }
      const model = ctx.model;
      if (!model) throw new Error(`${COMPACTION_ERROR_PREFIX}: no active model selected`);
      const input = buildEffectiveContextInput(event.branchEntries);
      const synthesizedWrapper = await buildSynthesizedUserWrapper(ctx);
      const prefixInput = ensureUserWrapper(template.remotePrefixInput, synthesizedWrapper);
      const request: Record<string, unknown> = {
        model: model.id,
        input: [...prefixInput, ...input],
        instructions: ctx.getSystemPrompt(),
        tools: template.tools ?? [],
        parallel_tool_calls: template.parallelToolCalls ?? true,
      };
      if (template.reasoning) request.reasoning = template.reasoning;
      if (template.text) request.text = template.text;
      await writeDebugFile("compact-request", {
        sessionKey: key,
        request,
        meta: {
          version: DETAILS_VERSION,
          customInstructions: event.customInstructions,
          isIdle: ctx.isIdle(),
          hasPendingMessages: ctx.hasPendingMessages(),
          branchTailTypes: event.branchEntries.slice(-6).map((entry) => entry.type),
        },
      });
      const remoteResult = await callRemoteCompact(ctx, request, event.signal);
      await writeDebugFile("compact-response", { sessionKey: key, remoteResult });
      const normalizedOutput = filterRemoteOutputForCodexParity((remoteResult as { output: unknown[] }).output);
      const details: CodexRemoteCompactionDetails = {
        version: DETAILS_VERSION,
        inputBase: normalizedOutput,
        retryInput: getLastUserInputFromBranch(event.branchEntries),
        source: {
          provider: model.provider,
          modelId: model.id,
          baseUrl: model.baseUrl ?? "",
          createdAt: Date.now(),
          tokensBefore: event.preparation.tokensBefore,
        },
        remoteRequest: request,
        remoteResult,
      };
      return {
        compaction: {
          summary: PLACEHOLDER_SUMMARY,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          tokensBefore: event.preparation.tokensBefore,
          details,
        },
      };
    } catch (error) {
      const message = toErrorMessage(error);
      await writeDebugFile("compact-error", { sessionKey: key, error: message });
      if (ctx.hasUI) ctx.ui.notify(message, "error");
      return { cancel: true };
    }
  });
}
