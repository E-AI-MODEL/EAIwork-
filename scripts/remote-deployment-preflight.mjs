#!/usr/bin/env node
/**
 * Fail-closed preflight for putting EAIwork behind a public reverse proxy.
 * This does not deploy, start a server, or validate the external access policy.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function auditRemoteDeployment({ env = process.env, read = readFileSync, stat = statSync } = {}) {
  const failures = [];
  const warnings = [];
  const required = (name) => {
    const value = String(env[name] ?? "").trim();
    if (!value) failures.push(`${name}: ontbreekt`);
    return value;
  };
  const origin = required("EAI_PUBLIC_ORIGIN");
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        failures.push("EAI_PUBLIC_ORIGIN: gebruik een publiek HTTPS-origin zonder pad, credentials of query");
      }
    } catch { failures.push("EAI_PUBLIC_ORIGIN: ongeldige URL"); }
  }
  const audience = required("EAI_ACCESS_AUDIENCE");
  if (audience && !/^[0-9a-f-]{36}$/i.test(audience)) failures.push("EAI_ACCESS_AUDIENCE: verwacht een UUID van de Access-applicatie");
  const issuer = required("EAI_ACCESS_ISSUER");
  if (issuer) {
    try {
      const url = new URL(issuer);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".cloudflareaccess.com") || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        failures.push("EAI_ACCESS_ISSUER: verwacht HTTPS-teamdomein van Cloudflare Access");
      }
    } catch { failures.push("EAI_ACCESS_ISSUER: ongeldige URL"); }
  }
  const tokenPath = required("EAI_TOKEN_FILE");
  if (tokenPath) {
    try {
      const absolute = resolve(tokenPath);
      const info = stat(absolute);
      if (!info.isFile()) failures.push("EAI_TOKEN_FILE: geen regulier bestand");
      if (info.mode & 0o077) failures.push("EAI_TOKEN_FILE: rechten zijn te ruim; gebruik chmod 600");
      const tokens = JSON.parse(read(absolute, "utf8"));
      if (!tokens || typeof tokens !== "object" || Array.isArray(tokens) || !Object.keys(tokens).length) failures.push("EAI_TOKEN_FILE: geen tokenregistratie");
      else for (const token of Object.keys(tokens)) {
        if (!/^[0-9a-f]{64}$/i.test(token)) failures.push("EAI_TOKEN_FILE: een token heeft niet het vereiste formaat van 64 hextekens");
      }
    } catch { failures.push("EAI_TOKEN_FILE: niet leesbaar of ongeldige JSON"); }
  }
  if (env.EAI_BIND_HOST !== "127.0.0.1") failures.push("EAI_BIND_HOST: moet 127.0.0.1 zijn; publiceer uitsluitend via beveiligde proxy");
  if (env.EAI_ACCESS_POLICY_VERIFIED !== "yes") failures.push("EAI_ACCESS_POLICY_VERIFIED: controleer Access-policy met een geweigerde en een toegestane gebruiker");
  if (env.EAI_ORIGIN_LOCKED !== "yes") failures.push("EAI_ORIGIN_LOCKED: blokkeer directe toegang buiten de proxy");
  if (env.EAI_BACKUP_RESTORE_VERIFIED !== "yes") failures.push("EAI_BACKUP_RESTORE_VERIFIED: hersteltest ontbreekt");
  if (env.EAI_TOKEN_ROTATION_VERIFIED !== "yes") failures.push("EAI_TOKEN_ROTATION_VERIFIED: rotatietest ontbreekt");
  if (env.EAI_MODEL_EGRESS_REVIEWED !== "yes") failures.push("EAI_MODEL_EGRESS_REVIEWED: beoordeel modeluitgaand verkeer en gegevensverwerking");
  warnings.push("Deze controle bewijst geen identiteit, proxyconfiguratie of daadwerkelijke netwerkisolatie. Test die afzonderlijk.");
  return { ready: failures.length === 0, failures, warnings };
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const result = auditRemoteDeployment();
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.ready ? 0 : 1;
}
