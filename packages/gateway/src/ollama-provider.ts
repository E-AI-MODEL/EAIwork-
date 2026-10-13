import type { ModelProvider, AtomCapsule } from "./gateway.ts";

export interface OllamaConfig {
  host?: string;
  model: string;
  timeoutMs?: number;
  disableThinking?: boolean;
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
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid model response");
  const obj = parsed as Record<string, unknown>;
  const output: Record<string, number> = {};
  for (const option of allowed) {
    const value = obj[option];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error("Missing or invalid probability for " + option);
    }
    output[option] = value;
  }
  if (Object.keys(obj).some(k => !allowed.includes(k))) throw new Error("Model returned an unapproved option");
  if (Object.values(output).reduce((a, b) => a + b, 0) <= 0) throw new Error("Empty probability distribution");
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
                format: "json",
                ...(withThink ? { think: false } : {}),
                messages: [{
                  role: "user",
                  content: JSON.stringify({
                    instruction: "Return only a JSON object with a nonnegative numeric probability for each listed option. No other keys.",
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
            const payload = JSON.parse(raw) as { message?: { content?: string } };
            if (!payload.message?.content) throw new Error("Empty Ollama response");
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
