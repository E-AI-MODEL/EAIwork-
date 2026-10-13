/**
 * Deterministic and read-only local evidence observation.
 *
 * Inspired by UMDT's pure observe -> classify -> route pipeline, NOT by its
 * misconception scoring heuristics. A structurally valid citation is not
 * semantic support for a proposition and never grants evidence authority.
 *
 * These inputs must be assembled by an authorized controller/broker. Do not
 * expose parent-project context, other atom work, or scoring labels to workers.
 */
import { createHash } from "node:crypto";

export type LocalAnswer = "yes" | "no" | "unknown";
export type EvidenceObservation =
  | "NO_ASSERTION"
  | "NO_REFERENCES"
  | "INVALID_REFERENCES"
  | "CONFLICT_REPORTED"
  | "ANCHORED_UNVERIFIED";
export type EvidenceRoute =
  | "OBSERVE_ONLY"
  | "ASK_FOR_SOURCE"
  | "ROUTE_TO_HUMAN"
  | "SEMANTIC_REVIEW_REQUIRED";

export type ReferenceIssue =
  | "SOURCE_UNAUTHORIZED"
  | "SOURCE_NOT_FOUND"
  | "INVALID_RANGE"
  | "QUOTE_MISMATCH"
  | "DUPLICATE_REFERENCE"
  | "INVALID_INPUT";

export interface AuthorizedSource {
  /** A broker-owned local handle; not a remote URL or arbitrary filesystem path. */
  handle: string;
  /** A version-pinned excerpt that the controller actually made available. */
  content: string;
}

export interface ProposedReference {
  handle: string;
  /** UTF-16 offsets into the exact authorized source excerpt. */
  start: number;
  end: number;
  /** The purported exact quote; never retained in the output or audit. */
  quote: string;
}

export interface LocalEvidenceObservationInput {
  /** A claim belonging to ONE atom, not the global task or project. */
  claim: string;
  answer: LocalAnswer;
  /** Explicit allowlist from the controller's source policy, not from a model. */
  authorizedHandles: readonly string[];
  sources: readonly AuthorizedSource[];
  /** Untrusted citation proposals; may have been produced by a model. */
  proposedReferences: readonly ProposedReference[];
  /** Controller-defined policy, NEVER a model-supplied instruction. */
  policy?: {
    mode?: "observe" | "review";
    impact?: "low" | "high";
    /** Only a trusted independent checker or a person may set this signal. */
    independentConflictReported?: boolean;
    disallowAutomatedReview?: boolean;
  };
}
export interface CheckedReference {
  handle: string;
  start: number;
  end: number;
  /** SHA-256 for audit binding; neither proof of truth nor independently validated origin. */
  excerptSha256: string;
  quotedSpanSha256: string;
}
export interface EvidenceObservationResult {
  observation: EvidenceObservation;
  route: EvidenceRoute;
  /** Non-sensitive machine-readable reason codes only. */
  flags: string[];
  checked: CheckedReference[];
  rejected: { index: number; issue: ReferenceIssue }[];
  /** Explicitly distinguishes citation integrity from epistemic justification. */
  semanticSupport: "NOT_EVALUATED";
  authorityRaised: false;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const limits = { sources: 24, references: 12, maxExcerptChars: 50000, maxQuoteChars: 2000 };

export function observeLocalEvidence(input: LocalEvidenceObservationInput): EvidenceObservationResult {
  const checked: CheckedReference[] = [];
  const rejected: EvidenceObservationResult["rejected"] = [];
  const flags: string[] = [];
  const result = (observation: EvidenceObservation, route: EvidenceRoute): EvidenceObservationResult =>
    ({ observation, route, flags: [...flags], checked: [...checked], rejected: [...rejected],
       semanticSupport: "NOT_EVALUATED", authorityRaised: false });

  if (!input || typeof input.claim !== "string" || !input.claim.trim() ||
      !["yes", "no", "unknown"].includes(input.answer) ||
      !Array.isArray(input.authorizedHandles) || !Array.isArray(input.sources) ||
      !Array.isArray(input.proposedReferences)) {
    flags.push("INVALID_INPUT");
    return result("INVALID_REFERENCES", "ROUTE_TO_HUMAN");
  }

  if (input.sources.length > limits.sources ||
      input.proposedReferences.length > limits.references ||
      input.authorizedHandles.length > limits.sources ||
      input.claim.length > 2000) {
    flags.push("INPUT_LIMIT_EXCEEDED");
    return result("INVALID_REFERENCES", "ROUTE_TO_HUMAN");
  }

  if (input.policy !== undefined && (
      !input.policy || typeof input.policy !== "object" || Array.isArray(input.policy) ||
      (input.policy.mode !== undefined && !["observe", "review"].includes(input.policy.mode)) ||
      (input.policy.impact !== undefined && !["low", "high"].includes(input.policy.impact)) ||
      (input.policy.independentConflictReported !== undefined &&
        typeof input.policy.independentConflictReported !== "boolean") ||
      (input.policy.disallowAutomatedReview !== undefined &&
        typeof input.policy.disallowAutomatedReview !== "boolean") ||
      Object.keys(input.policy).some(k => !["mode", "impact", "independentConflictReported", "disallowAutomatedReview"].includes(k))
    )) {
    flags.push("INVALID_REVIEW_POLICY");
    return result("INVALID_REFERENCES", "ROUTE_TO_HUMAN");
  }

  const allowed = new Set<string>();
  for (const handle of input.authorizedHandles) {
    if (typeof handle !== "string" || !handle || allowed.has(handle)) {
      flags.push("INVALID_SOURCE_POLICY");
      return result("INVALID_REFERENCES", "ROUTE_TO_HUMAN");
    }
    allowed.add(handle);
  }
  const sources = new Map<string, string>();
  for (const s of input.sources) {
    if (!s || typeof s.handle !== "string" || !s.handle ||
        typeof s.content !== "string" || s.content.length > limits.maxExcerptChars ||
        sources.has(s.handle)) {
      flags.push("INVALID_SOURCE_SET");
      return result("INVALID_REFERENCES", "ROUTE_TO_HUMAN");
    }
    sources.set(s.handle, s.content);
  }

  const seen = new Set<string>();
  input.proposedReferences.forEach((ref, index) => {
    if (!ref || typeof ref.handle !== "string" ||
        !Number.isSafeInteger(ref.start) || !Number.isSafeInteger(ref.end) ||
        typeof ref.quote !== "string" || !ref.quote.length ||
        ref.quote.length > limits.maxQuoteChars) {
      rejected.push({ index, issue: "INVALID_INPUT" });
      return;
    }
    if (!allowed.has(ref.handle)) {
      rejected.push({ index, issue: "SOURCE_UNAUTHORIZED" });
      return;
    }
    const content = sources.get(ref.handle);
    if (content === undefined) {
      rejected.push({ index, issue: "SOURCE_NOT_FOUND" });
      return;
    }
    if (ref.start < 0 || ref.end <= ref.start || ref.end > content.length ||
        ref.end - ref.start > limits.maxQuoteChars) {
      rejected.push({ index, issue: "INVALID_RANGE" });
      return;
    }
    const identity = ref.handle + "\u0000" + ref.start + "\u0000" + ref.end;
    if (seen.has(identity)) {
      rejected.push({ index, issue: "DUPLICATE_REFERENCE" });
      return;
    }
    seen.add(identity);
    const span = content.slice(ref.start, ref.end);
    if (span !== ref.quote) {
      rejected.push({ index, issue: "QUOTE_MISMATCH" });
      return;
    }
    checked.push({
      handle: ref.handle, start: ref.start, end: ref.end,
      excerptSha256: sha256(content), quotedSpanSha256: sha256(span),
    });
  });

  // The policy is supplied outside the model. Invalid source references never
  // become verified merely because the model says "yes" with confidence 1.0.
  if (rejected.length) {
    flags.push("REFERENCE_INTEGRITY_FAILED");
    return result("INVALID_REFERENCES", input.policy?.mode === "observe" ? "OBSERVE_ONLY" : "ROUTE_TO_HUMAN");
  }
  if (input.policy?.mode === "observe" || input.policy?.disallowAutomatedReview) {
    flags.push("OBSERVE_POLICY");
    return result(input.answer === "unknown" ? "NO_ASSERTION" :
      checked.length ? "ANCHORED_UNVERIFIED" : "NO_REFERENCES", "OBSERVE_ONLY");
  }
  if (input.policy?.independentConflictReported) {
    flags.push("INDEPENDENT_CONFLICT");
    return result("CONFLICT_REPORTED", "ROUTE_TO_HUMAN");
  }
  if (input.answer === "unknown") {
    flags.push("MODEL_ABSTAINED");
    return result("NO_ASSERTION", "OBSERVE_ONLY");
  }
  if (!checked.length) {
    flags.push("NO_CITATION");
    return result("NO_REFERENCES", "ASK_FOR_SOURCE");
  }
  if (input.policy?.impact === "high") {
    flags.push("HIGH_IMPACT");
    return result("ANCHORED_UNVERIFIED", "ROUTE_TO_HUMAN");
  }
  flags.push("SEMANTIC_SUPPORT_UNVERIFIED");
  return result("ANCHORED_UNVERIFIED", "SEMANTIC_REVIEW_REQUIRED");
}
