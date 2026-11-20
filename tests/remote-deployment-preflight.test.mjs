import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRemoteDeployment } from "../scripts/remote-deployment-preflight.mjs";

const token = "a".repeat(64);
const good = {
  EAI_PUBLIC_ORIGIN: "https://work.example.org",
  EAI_ACCESS_AUDIENCE: "123e4567-e89b-12d3-a456-426614174000",
  EAI_ACCESS_ISSUER: "https://team.cloudflareaccess.com",
  EAI_TOKEN_FILE: "/private/tokens.json",
  EAI_BIND_HOST: "127.0.0.1",
  EAI_ACCESS_POLICY_VERIFIED: "yes",
  EAI_ORIGIN_LOCKED: "yes",
  EAI_BACKUP_RESTORE_VERIFIED: "yes",
  EAI_TOKEN_ROTATION_VERIFIED: "yes",
  EAI_MODEL_EGRESS_REVIEWED: "yes",
};
const dependencies = {
  read: () => JSON.stringify({ [token]: { actor: { kind: "person", id: "person:test" }, access: { read: "*" } } }),
  stat: () => ({ isFile: () => true, mode: 0o100600 }),
};

test("remote deployment is blocked by default", () => {
  const result = auditRemoteDeployment({ env: {}, ...dependencies });
  assert.equal(result.ready, false);
  assert.ok(result.failures.length >= 8);
});

test("a fully attested configuration passes only the static preflight", () => {
  const result = auditRemoteDeployment({ env: good, ...dependencies });
  assert.equal(result.ready, true, result.failures.join("\n"));
  assert.ok(result.warnings.some((item) => item.includes("geen identiteit")));
});

test("rejects HTTP and publicly bound EAIwork", () => {
  const result = auditRemoteDeployment({ env: { ...good, EAI_PUBLIC_ORIGIN: "http://work.example.org", EAI_BIND_HOST: "0.0.0.0" }, ...dependencies });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /HTTPS-origin/);
  assert.match(result.failures.join(" "), /127.0.0.1/);
});

test("rejects readable token file and placeholder token", () => {
  const result = auditRemoteDeployment({
    env: good,
    read: () => JSON.stringify({ REPLACE_ME: { access: {} } }),
    stat: () => ({ isFile: () => true, mode: 0o100644 }),
  });
  assert.equal(result.ready, false);
  assert.match(result.failures.join(" "), /rechten zijn te ruim/);
  assert.match(result.failures.join(" "), /64 hextekens/);
});

test("rejects missing access verification", () => {
  const result = auditRemoteDeployment({ env: { ...good, EAI_ACCESS_POLICY_VERIFIED: "no" }, ...dependencies });
  assert.equal(result.ready, false);
});
