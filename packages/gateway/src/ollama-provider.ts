import type { ModelProvider, AtomCapsule, ModelProposal, LocalReferenceProposal } from "./gateway.ts";
import { localDecisionInstruction } from "./decision-contract.ts";

export interface OllamaConfig {
  host?: string;
  model: string;
  timeoutMs?: number;
  disableThinking?: boolean;
}

/** Fixed, non-sensitive diagnostics. Never place raw generated text in exception messages. */
export type OllamaOutputIssue =
  | "non-json"
  | "invalid-object"
  | "missing-option"
  | "invalid-probability"
  | "extra-option"
  | "zero-probability"
  | "empty-content";

export class OllamaOutputError extends Error {
  readonly code: OllamaOutputIssue;
  constructor(code: OllamaOutputIssue) {
    super("Invalid model response: " + code);
    this.name = "OllamaOutputError";
    this.code = code;
  }
}

const unsupportedThinking = new Set<string>();

/** Local-only by default. Remote model endpoints require a separately governed adapter. */
export function localOllamaHost(value = "http://127.0.0.1:11434"): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) ||
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error("Ollama host must be a local loopback endpoint");
  }
  return url.origin;
}

export async function discoverLocalOllamaModels(host?: string, timeoutMs = 5000): Promise<string[]> {
  const base = localOllamaHost(host);
  const response = await fetch(base + "/api/tags", { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error("Ollama model discovery failed: " + response.status);
  const data = await response.json() as { models?: Array<{ name?: string }> };
  if (!Array.isArray(data.models)) throw new Error("Invalid Ollama model list");
  return [...new Set(data.models.map(m => m.name).filter((v): v is string => typeof v === "string" && !!v))].sort();
}

function parseProbabilities(content: string, allowed: string[]): Record<string, number> {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new OllamaOutputError("non-json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new OllamaOutputError("invalid-object");
  const obj = parsed as Record<string, unknown>;
  const output: Record<string, number> = {};
  for (const option of allowed) {
    if (!Object.hasOwn(obj, option)) throw new OllamaOutputError("missing-option");
    const value = obj[option];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new OllamaOutputError("invalid-probability");
    }
    output[option] = value;
  }
  if (Object.keys(obj).some(k => !allowed.includes(k))) throw new OllamaOutputError("extra-option");
  if (Object.values(output).reduce((a, b) => a + b, 0) <= 0) throw new OllamaOutputError("zero-probability");
  return output;
}

/** Opt-in citation proposals have their own schema; the old numeric interface stays unchanged. */
function probabilitySchema(options: string[]) {
  return {
    type: "object", properties: Object.fromEntries(
      options.map(option => [option, { type: "number", minimum: 0 }]),
    ), required: [...options], additionalProperties: false,
  };
}

function proposalSchema(options: string[]) {
  return {
    type: "object",
    properties: {
      probabilities: probabilitySchema(options),
      references: {
        type: "array", maxItems: 12,
        items: {
          type: "object",
          properties: {
            contextIndex: { type: "integer", minimum: 0 },
            start: { type: "integer", minimum: 0 },
            end: { type: "integer", minimum: 1 },
            quote: { type: "string", minLength: 1, maxLength: 2000 },
          },
          required: ["contextIndex", "start", "end", "quote"],
          additionalProperties: false,
        },
      },
    },
    required: ["probabilities", "references"],
    additionalProperties: false,
  };
}

function parseProposal(content: string, allowed: string[]): ModelProposal {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new OllamaOutputError("non-json"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new OllamaOutputError("invalid-object");
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).some(k => k !== "probabilities" && k !== "references") ||
      !obj.probabilities || typeof obj.probabilities !== "object" ||
      Array.isArray(obj.probabilities) || !Array.isArray(obj.references) ||
      obj.references.length > 12) throw new OllamaOutputError("invalid-object");

  const references: LocalReferenceProposal[] = [];
  for (const item of obj.references) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).some(k => !["contextIndex", "start", "end", "quote"].includes(k)) ||
        !Number.isSafeInteger(item.contextIndex) || !Number.isSafeInteger(item.start) ||
        !Number.isSafeInteger(item.end) || typeof item.quote !== "string" ||
        !item.quote || item.quote.length > 2000) throw new OllamaOutputError("invalid-object");
    references.push({
      contextIndex: item.contextIndex, start: item.start, end: item.end, quote: item.quote,
    });
  }
  // This checks response shape, never whether the cited text supports the claim.
  return { probabilities: parseProbabilities(JSON.stringify(obj.probabilities), allowed), references };
}

/** A new stateless session per atom; extended citations are strictly opt-in. */
export function ollamaProvider(config: OllamaConfig): ModelProvider {
  const host = localOllamaHost(config.host);
  if (!config.model.trim()) throw new Error("Model is required");
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid timeout");
  return {
    id: "ollama:" + config.model,
    openSession: () => {
      let used = false;
      const run = async (capsule: AtomCapsule, withReferences: boolean): Promise<Record<string, number> | ModelProposal> => {
        if (used) throw new Error("Model session already used");
        used = true;
        const key = host + "::" + config.model;
        const send = async (withThink: boolean) => {
          const instruction = withReferences
            ? localDecisionInstruction(capsule.decision?.kind === "verify-claim") +
              " Respond with probabilities and an array of OPTIONAL exact citations. Each citation uses contextIndex, a zero-based index into the provided context array; start/end are UTF-16 offsets into that context item (end exclusive), and quote must match exactly. Use [] if no passage can be quoted. A citation is a proposal, not verified support."
            : localDecisionInstruction(capsule.decision?.kind === "verify-claim");
          const response = await fetch(host + "/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({
              model: config.model,
              stream: false,
              format: withReferences ? proposalSchema(capsule.options) : probabilitySchema(capsule.options),
              options: { temperature: 0, num_predict: withReferences ? 1200 : 220 },
              ...(withThink ? { think: false } : {}),
              messages: [{
                role: "user",
                content: JSON.stringify({
                  instruction,
                  ...(capsule.decision ? { decision: capsule.decision } : {}),
                  question: capsule.question,
                  options: capsule.options,
                  inputs: capsule.inputs,
                  context: capsule.context,
                }),
              }],
            }),
          });
          const raw = await response.text();
          if (!response.ok) {
            // Never embed raw provider output or source snippets in exception fields.
            const error = new Error("Ollama HTTP " + response.status) as Error & {
              status?: number; thinkUnsupported?: boolean;
            };
            error.status = response.status;
            error.thinkUnsupported = response.status === 400 && /think/i.test(raw);
            throw error;
          }
          let payload: { message?: { content?: string } };
          try { payload = JSON.parse(raw); } catch { throw new OllamaOutputError("non-json"); }
          if (!payload.message?.content) throw new OllamaOutputError("empty-content");
          return withReferences
            ? parseProposal(payload.message.content, capsule.options)
            : parseProbabilities(payload.message.content, capsule.options);
        };
        const withThink = !!config.disableThinking && !unsupportedThinking.has(key);
        try {
          return await send(withThink);
        } catch (error) {
          const e = error as Error & { thinkUnsupported?: boolean };
          if (withThink && e.thinkUnsupported) {
            unsupportedThinking.add(key);
            return send(false);
          }
          throw error;
        }
      };
      return {
        answer: (capsule: AtomCapsule) => run(capsule, false) as Promise<Record<string, number>>,
        propose: (capsule: AtomCapsule) => run(capsule, true) as Promise<ModelProposal>,
      };
    },
  };
}
