import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { observeLocalEvidence, type LocalEvidenceObservationInput } from "../packages/evidence/src/observe.ts";

const source = "Approved by budget holder for request R-28. No other request included.";
const quote = "Approved by budget holder for request R-28.";
const start = source.indexOf(quote);
const basic = (): LocalEvidenceObservationInput => ({
  claim: "The budget holder approved R-28.",
  answer: "yes",
  authorizedHandles: ["s.only"],
  sources: [{ handle: "s.only", content: source }],
  proposedReferences: [{ handle: "s.only", start, end: start + quote.length, quote }],
});

test("exact local citation is anchored but NEVER promoted to proven, checked, or semantically supported", () => {
  const got = observeLocalEvidence(basic());
  assert.equal(got.observation, "ANCHORED_UNVERIFIED");
  assert.equal(got.route, "SEMANTIC_REVIEW_REQUIRED");
  assert.equal(got.semanticSupport, "NOT_EVALUATED");
  assert.equal(got.authorityRaised, false);
  assert.equal(got.checked.length, 1);
  assert.deepEqual(got.rejected, []);
  assert.equal(got.checked[0].quotedSpanSha256, createHash("sha256").update(quote).digest("hex"));
  assert.equal(JSON.stringify(got).includes("Approved by budget holder"), false);
});

test("authorized but irrelevant valid source quote is NOT treated as semantic support", () => {
  const irrelevant = { ...basic(), sources: [{ handle: "s.only", content: "The weather is clear." }],
    proposedReferences: [{ handle: "s.only", start: 0, end: 21, quote: "The weather is clear." }] };
  const got = observeLocalEvidence(irrelevant);
  assert.equal(got.route, "SEMANTIC_REVIEW_REQUIRED");
  assert.equal(got.semanticSupport, "NOT_EVALUATED");
  assert.equal(got.authorityRaised, false);
});

test("claim assertion with no citation must ask for source even at high model confidence", () => {
  const got = observeLocalEvidence({ ...basic(), proposedReferences: [] });
  assert.equal(got.observation, "NO_REFERENCES");
  assert.equal(got.route, "ASK_FOR_SOURCE");
  assert.equal(got.authorityRaised, false);
});

test("unknown atom abstention is observed, never silently converted to no", () => {
  const got = observeLocalEvidence({ ...basic(), answer: "unknown", proposedReferences: [] });
  assert.equal(got.observation, "NO_ASSERTION");
  assert.equal(got.route, "OBSERVE_ONLY");
  assert.ok(got.flags.includes("MODEL_ABSTAINED"));
});

test("rejects unauthorized sources even if controller also passed that source in memory", () => {
  const data = basic();
  const got = observeLocalEvidence({
    ...data, sources: [...data.sources, { handle: "s.other.atom", content: "approved" }],
    proposedReferences: [{ handle: "s.other.atom", start: 0, end: 8, quote: "approved" }],
  });
  assert.equal(got.route, "ROUTE_TO_HUMAN");
  assert.equal(got.rejected[0].issue, "SOURCE_UNAUTHORIZED");
  assert.equal(got.authorityRaised, false);
});

test("rejects quote tampering and mismatched offsets with non-sensitive reasons", () => {
  const data = basic();
  const tampered = observeLocalEvidence({ ...data, proposedReferences: [{ ...data.proposedReferences[0], quote: "approved (fabricated)" }] });
  assert.equal(tampered.route, "ROUTE_TO_HUMAN");
  assert.equal(tampered.rejected[0].issue, "QUOTE_MISMATCH");
  const outOfRange = observeLocalEvidence({ ...data, proposedReferences: [{ ...data.proposedReferences[0], start: -1 }] });
  assert.equal(outOfRange.rejected[0].issue, "INVALID_RANGE");
  const missingSource = observeLocalEvidence({ ...data, sources: [] });
  assert.equal(missingSource.rejected[0].issue, "SOURCE_NOT_FOUND");
});

test("duplicate source references cannot become independent corroboration", () => {
  const data = basic();
  const got = observeLocalEvidence({ ...data, proposedReferences: [data.proposedReferences[0], data.proposedReferences[0]] });
  assert.equal(got.checked.length, 1);
  assert.equal(got.rejected[0].issue, "DUPLICATE_REFERENCE");
  assert.equal(got.route, "ROUTE_TO_HUMAN");
});

test("trusted external conflict and high-impact review take precedence over model certainty", () => {
  assert.equal(observeLocalEvidence({ ...basic(), policy: { independentConflictReported: true } }).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence({ ...basic(), policy: { impact: "high" } }).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence({ ...basic(), policy: { mode: "observe", impact: "high" } }).route, "OBSERVE_ONLY");
  assert.equal(observeLocalEvidence({ ...basic(), policy: { disallowAutomatedReview: true } }).route, "OBSERVE_ONLY");
});

test("bad source policy, oversized input, and malformed data are fail-closed", () => {
  assert.equal(observeLocalEvidence({ ...basic(), authorizedHandles: ["s.only", "s.only"] }).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence({ ...basic(), sources: [basic().sources[0], basic().sources[0]] }).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence({ ...basic(), proposedReferences: Array(13).fill(basic().proposedReferences[0]) }).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence(null as any).route, "ROUTE_TO_HUMAN");
  assert.equal(observeLocalEvidence({ ...basic(), answer: "maybe" as any }).route, "ROUTE_TO_HUMAN");
});

test("determinism and non-leakage: equal inputs yield exactly equal audit data", () => {
  const one = observeLocalEvidence(basic());
  const two = observeLocalEvidence(basic());
  assert.deepEqual(one, two);
  const serialized = JSON.stringify(one);
  assert.equal(serialized.includes(source), false);
  assert.equal(serialized.includes(quote), false);
  assert.equal(serialized.includes(basic().claim), false);
});
