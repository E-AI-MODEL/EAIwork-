import type { ModelProvider, AtomCapsule } from "./gateway.ts";
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

/** A new stateless session per atom; only the capsule reaches the model. */
export function ollamaProvider(config: OllamaConfig): ModelProvider {
  const host = localOllamaHost(config.host);
  if (!config.model.trim()) throw new Error("Model is required");
  const timeoutMs = config.timeoutMs ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid timeout");
  return {
    id: "ollama:" + config.model,
    openSession: () => {
      let used = false;
      return {
        answer: async (capsule: AtomCapsule) => {
          if (used) throw new Error("Model session already used");
          used = true;
          const key = host + "::" + config.model;
          const send = async (withThink: boolean) => {
            const response = await fetch(host + "/api/chat", {
              method: "POST",
              headers: { "content-type": "application/json" },
              signal: AbortSignal.timeout(timeoutMs),
              body: JSON.stringify({
                model: config.model,
                stream: false,
                format: {
                  type: "object",
                  properties: Object.fromEntries(capsule.options.map(option => [option, { type: "number", minimum: 0 }])),
                  required: [...capsule.options],
                  additionalProperties: false,
                },
                options: { temperature: 0, num_predict: 220 },
                ...(withThink ? { think: false } : {}),
                messages: [{
                  role: "user",
                  content: JSON.stringify({
                    instruction: localDecisionInstruction(capsule.decision?.kind === "verify-claim"),
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
              const error = new Error("Ollama HTTP " + response.status) as Error & { status?: number; detail?: string };
              error.status = response.status;
              error.detail = raw.slice(0, 300);
              throw error;
            }
            let payload: { message?: { content?: string } };
            try { payload = JSON.parse(raw); } catch { throw new OllamaOutputError("non-json"); }
            if (!payload.message?.content) throw new OllamaOutputError("empty-content");
            return parseProbabilities(payload.message.content, capsule.options);
          };
          const withThink = !!config.disableThinking && !unsupportedThinking.has(key);
          try {
            return await send(withThink);
          } catch (error) {
            const e = error as Error & { status?: number; detail?: string };
            if (withThink && e.status === 400 && /think/i.test(e.detail ?? "")) {
              unsupportedThinking.add(key);
              return send(false);
            }
            throw error;
          }
        },
      };
    },
  };
}
