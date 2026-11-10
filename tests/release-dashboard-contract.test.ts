import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const dashboard=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
test("release forms belong to the existing live dashboard, not the synthetic demo",()=>{
  assert.match(dashboard,/release-candidate-open/);
  assert.match(dashboard,/release-review-open/);
  assert.match(dashboard,/release-artifact-open/);
  assert.match(dashboard,/id="releaseCandidateForm"/);
  assert.match(dashboard,/id="releaseReviewForm"/);
  assert.match(dashboard,/id="releaseArtifactForm"/);
  assert.match(dashboard,/function submitReleaseCandidate\(/);
  assert.match(dashboard,/function submitReleaseReview\(/);
  assert.match(dashboard,/function verifyReleaseArtifact\(/);
  assert.match(dashboard,/function liveProductionLine\(/);
  assert.match(dashboard,/s\.productionLine=line/);
});
test("release actions use authenticated relative routes and no publish endpoint",()=>{
  assert.match(dashboard,/postOps\('\/ops\/missions\/'.*'\/releases\/candidates'/);
  assert.ok(dashboard.includes("encodeURIComponent(m.candidateId)+'/review'"));
  assert.match(dashboard,/verify-artifact/);
  assert.match(dashboard,/Content-Type':'application\/octet-stream'/);
  assert.match(dashboard,/onExecutionServer\(\)\|\|!opsToken/);
  assert.match(dashboard,/Een ingediende releasekandidaat en menselijke beoordeling geven geen publicatierecht/);
  assert.doesNotMatch(dashboard,/data-action="release-publish"/);
  assert.doesNotMatch(dashboard,/fetch\(['"]https?:\/\//);
});
