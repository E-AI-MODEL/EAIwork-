/** Shared HTTP mechanics only. Each caller retains its own prompt and output validator. */
/** Fixed, non-sensitive diagnostics. Never place raw generated text in exception messages. */
export type OllamaOutputIssue =
  | "non-json"
  | "invalid-object"
  | "missing-option"
  | "invalid-probability"
  | "extra-option"
  | "zero-probability"
  | "empty-content"
  | "response-too-large"
  | "incomplete-response";

export class OllamaOutputError extends Error {
  readonly code: OllamaOutputIssue;
  constructor(code: OllamaOutputIssue) {
    super("Invalid model response: " + code);
    this.name = "OllamaOutputError";
    this.code = code;
  }
}

export interface OllamaCallMetric {
  model: string;
  operation: "atom-answer" | "atom-proposal" | "whole-task" | "plan" | "revision" | "code";
  attempt: number;
  elapsedMs: number;
  outcome: "success" | "http" | "timeout" | "transport" | "invalid-response";
  status?: number;
  outputIssue?: OllamaOutputIssue;
  // Ollama reports durations in nanoseconds and counts in tokens. Missing stays missing.
  total_duration?: number;
  load_duration?: number;
  prompt_eval_duration?: number;
  eval_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}
export type OllamaCallObserver = (metric: Readonly<OllamaCallMetric>) => void;

export async function ollamaChat<T>(config: {
  host: string; model: string; signal: AbortSignal; maxResponseBytes: number;
  operation: OllamaCallMetric["operation"]; attempt?: number; onCall?: OllamaCallObserver;
}, body: Record<string, unknown>, parse: (content: string) => T): Promise<T> {
  config.signal.throwIfAborted();
  const started = performance.now();
  const metric: OllamaCallMetric = {
    model: config.model, operation: config.operation, attempt: config.attempt ?? 1,
    elapsedMs: 0, outcome: "transport",
  };
  let parsing = false;
  try {
    const response = await fetch(config.host + "/api/chat", {
      method: "POST", redirect: "error", signal: config.signal,
      headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    metric.status = response.status;
    if (Number(response.headers.get("content-length") || 0) > config.maxResponseBytes) {
      await response.body?.cancel();
      throw new OllamaOutputError("response-too-large");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new OllamaOutputError("empty-content");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > config.maxResponseBytes) {
          await reader.cancel();
          throw new OllamaOutputError("response-too-large");
        }
        chunks.push(item.value);
      }
    } finally { reader.releaseLock(); }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (!response.ok) {
      const error = new Error("Ollama HTTP " + response.status) as Error & {
        status: number; thinkUnsupported: boolean;
      };
      error.status = response.status;
      error.thinkUnsupported = response.status === 400 && /think/i.test(raw);
      throw error;
    }
    parsing = true;
    let envelope;
    try { envelope = JSON.parse(raw); } catch { throw new OllamaOutputError("non-json"); }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope))
      throw new OllamaOutputError("invalid-object");
    for (const key of ["total_duration", "load_duration", "prompt_eval_duration", "eval_duration",
      "prompt_eval_count", "eval_count"] as const) {
      const value = envelope[key];
      if (Number.isSafeInteger(value) && value >= 0) metric[key] = value;
    }
    if (envelope.done === false || envelope.done_reason === "length")
      throw new OllamaOutputError("incomplete-response");
    if (typeof envelope.message?.content !== "string" || !envelope.message.content.trim())
      throw new OllamaOutputError("empty-content");
    const result = parse(envelope.message.content);
    metric.outcome = "success";
    return result;
  } catch (error) {
    const e = error as { name?: string; status?: number };
    metric.outcome = config.signal.aborted || e?.name === "TimeoutError" || e?.name === "AbortError"
      ? "timeout" : error instanceof OllamaOutputError ? "invalid-response"
      : typeof e?.status === "number" ? "http" : "transport";
    if (error instanceof OllamaOutputError) metric.outputIssue = error.code;
    // A contract parser can retain its existing safe errors without leaking them into metrics.
    if (parsing && metric.outcome === "transport") metric.outcome = "invalid-response";
    throw error;
  } finally {
    metric.elapsedMs = Math.round(performance.now() - started);
    // Telemetry cannot change a model result, trigger retries or disclose raw response text.
    try { config.onCall?.(Object.freeze(metric)); } catch { /* observer failure is non-authoritative */ }
  }
}
