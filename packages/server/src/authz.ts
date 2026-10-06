import type { Actor, Pack } from "../../core/src/index.ts";

export type Scope = "*" | string[];

export interface AccessPolicy {
  read: Scope;
  write: Scope;
  checks?: Scope;
  audit?: boolean;
}

export interface Principal {
  actor: Actor;
  access: AccessPolicy;
}

const inScope = (scope: Scope | undefined, id: string) =>
  scope === "*" || (Array.isArray(scope) && scope.includes(id));

export const canRead = (principal: Principal, atom: string) => inScope(principal.access.read, atom);
export const canWrite = (principal: Principal, atom: string) => inScope(principal.access.write, atom);
export const canRunCheck = (principal: Principal, id: string) => inScope(principal.access.checks, id);
export const canAudit = (principal: Principal) => principal.access.audit === true;

const validateScope = (scope: unknown, allowed: Set<string>, label: string, required: boolean) => {
  if (scope === undefined && !required) return;
  if (scope === "*") return;
  if (!Array.isArray(scope)) throw new Error(`${label} scope must be "*" or an array`);
  for (const id of scope) {
    if (typeof id !== "string" || !allowed.has(id)) throw new Error(`${label} scope contains unknown id ${String(id)}`);
  }
};

export function validatePrincipals(
  tokens: Record<string, Principal>,
  pack: Pack,
  checkIds: string[],
  actorKinds: Set<string>,
) {
  const entries = Object.entries(tokens);
  if (!entries.length) throw new Error("at least one access token is required");
  const atoms = new Set(pack.atoms.map((atom) => atom.id));
  const checks = new Set(checkIds);

  for (const [token, principal] of entries) {
    if (token.length < 32) throw new Error("access tokens must be at least 32 characters");
    if (/^(REPLACE_|dev-token-)/.test(token)) throw new Error("placeholder or example access tokens are not allowed");
    if (!principal?.actor || !actorKinds.has(principal.actor.kind) || typeof principal.actor.id !== "string" || !principal.actor.id.trim()) {
      throw new Error("every token must map to a valid principal actor");
    }
    if (!principal.access || typeof principal.access !== "object") throw new Error("every principal needs an access policy");
    validateScope(principal.access.read, atoms, "read", true);
    validateScope(principal.access.write, atoms, "write", true);
    validateScope(principal.access.checks, checks, "checks", false);
    if (principal.access.audit !== undefined && typeof principal.access.audit !== "boolean") {
      throw new Error("audit permission must be boolean");
    }
  }
}
