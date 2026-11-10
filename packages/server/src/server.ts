import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  coverage, derive, distribution, lintPack, optionsFor, propagate, replay, runRules, validate, weakestLink,
  type Actor, type EaiEvent, type Pack, type State,
} from "../../core/src/index.ts";
import { Store } from "./store.ts";
import { OpsStore } from "../../operations/src/store.ts";
import { catalogOverview } from "../../operations/src/selector.ts";
import { runMissionStep, runMissionUntilBlocked, evaluateBuiltin } from "../../operations/src/execution.ts";
import { missionProgress, validateMissionPlan, type MissionPlan } from "../../operations/src/missions.ts";
import {LocalMissionScheduler} from "../../operations/src/scheduler.ts";
import { buildMissionTrace } from "../../operations/src/trace.ts";
import { searchLocalRepository } from "../../operations/src/reposearch.ts";
import {proposeMissionPlan,localOllamaPlanningModel,type PlanningModel} from "../../operations/src/planner.ts";
import {proposeComposedWorker} from "../../operations/src/builder.ts";
import { executeAtomWorker, type ModelProvider, type SourceBroker } from "../../gateway/src/gateway.ts";
import { canAudit, canRead, canRunCheck, canRunWorker, canWrite, validatePrincipals, type Principal } from "./authz.ts";
import { SignedFileAnchorWitness, type AnchorWitness } from "./witness.ts";

export interface DeterministicCheck {
  atom: string;
  reads: string[];
  source: string;
  allowedActorId: string;
  run(input: { pack: Pack; state: State }): boolean;
}

export interface WorkerRuntime {
  provider: ModelProvider;
  broker: SourceBroker;
  temperature?: number;
}

export interface Config {
  dir: string;
  pack: Pack;
  /** token -> principal. Access is default-deny and explicit per atom/check. */
  tokens: Record<string, Principal>;
  witness: AnchorWitness;
  checks?: Record<string, DeterministicCheck>;
  workers?: Record<string, WorkerRuntime>;
  /** Optional separate operations journal. Existing evidence logs stay unchanged. */
  operationsDir?: string;
  /** 0 disables timer for deterministic testing; default 100 milliseconds. */
  schedulerIntervalMs?: number;
  /** Administrator-allowlisted checkout; never taken from a caller or model. */
  repoSearchRoot?: string;
  /** Optional local planning model; drafts always require human approval. */
  planningModel?: PlanningModel;
  maxBodyBytes?: number;
  maxRequestsPerMinute?: number;
  today?: () => string;
}

class HttpError extends Error {
  status: number;
  expose: boolean;
  constructor(status: number, message: string, expose = true) {
    super(message);
    this.status = status;
    this.expose = expose;
  }
}

const ACTOR_KINDS = new Set(["person", "system", "model", "check"]);
const PUBLIC_TYPES = new Set([
  "answer.proposed", "evidence.attached", "confidence.lowered",
  "flag.raised", "flag.dismissed", "status.raised",
]);

const ruleAtoms = (condition: any): string[] => {
  if (!condition || typeof condition !== "object") return [];
  if (Array.isArray(condition.all)) return condition.all.flatMap(ruleAtoms);
  if (Array.isArray(condition.any)) return condition.any.flatMap(ruleAtoms);
  if (condition.not) return ruleAtoms(condition.not);
  return typeof condition.atom === "string" ? [condition.atom] : [];
};

const visibleRules = (rules: any[] | undefined, visible: Set<string>) =>
  (rules ?? []).filter((rule) => ruleAtoms(rule.when).every((atom) => visible.has(atom)));

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
  });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage, maxBytes: number) =>
  new Promise<string>((ok, bad) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      bad(err);
    };
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        req.resume();
        return fail(new HttpError(413, "request body too large"));
      }
      body += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      ok(body);
    });
    req.on("error", fail);
  });

const requiredString = (value: unknown, field: string, max = 4096): string => {
  if (typeof value !== "string" || !value.trim()) throw new HttpError(422, `${field} must be a non-empty string`);
  if (value.length > max) throw new HttpError(422, `${field} is too long`);
  return value;
};

function normalizeProbabilities(value: unknown, allowed: string[]): Record<string, number> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(422, "probabilities must be an object");
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!allowed.includes(key)) throw new HttpError(422, `probability key ${key} is not an allowed option`);
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
      throw new HttpError(422, `probability for ${key} must be between 0 and 1`);
    }
    out[key] = raw;
  }
  return out;
}

function canonicalEvidence(raw: any, actor: Actor, eventId: string) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "evidence must be an object");
  const mode = raw.mode;
  if (mode !== "reported" && mode !== "observed") throw new HttpError(422, "evidence mode must be reported or observed");
  if (typeof raw.supports !== "boolean") throw new HttpError(422, "evidence supports must be boolean");
  if (raw.valid_until !== undefined && (typeof raw.valid_until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.valid_until))) {
    throw new HttpError(422, "valid_until must be an ISO date");
  }
  return {
    id: `${eventId}:evidence`,
    source: requiredString(raw.source, "evidence source", 2048),
    observer: actor,
    mode,
    lineage: `actor:${actor.kind}:${actor.id}`,
    supports: raw.supports,
    ...(raw.valid_until ? { valid_until: raw.valid_until } : {}),
  };
}

export function makeServer(cfg: Config) {
  const problems = lintPack(cfg.pack);
  if (problems.length) throw new Error("pack is invalid:\n" + problems.join("\n"));
  const atoms = new Map(cfg.pack.atoms.map((a) => [a.id, a]));
  validatePrincipals(cfg.tokens, cfg.pack, Object.keys(cfg.checks ?? {}), ACTOR_KINDS);

  for (const [id, check] of Object.entries(cfg.checks ?? {})) {
    if (
      !id.trim() ||
      !atoms.has(check.atom) ||
      !Array.isArray(check.reads) ||
      !check.reads.length ||
      !check.reads.includes(check.atom) ||
      check.reads.some((atom) => !atoms.has(atom)) ||
      typeof check.run !== "function" ||
      !check.source?.trim() ||
      !check.allowedActorId?.trim()
    ) {
      throw new Error(`invalid deterministic check configuration: ${id}`);
    }
  }

  const store = new Store(cfg.dir, cfg.witness, { exclusiveWriter: true });
  let operations: OpsStore | null = null;
  try { operations = cfg.operationsDir ? new OpsStore(cfg.operationsDir) : null; }
  catch (e) { store.close(); throw e; }
  let scheduler:LocalMissionScheduler|null=null;
  try{scheduler=operations?new LocalMissionScheduler(operations,cfg.schedulerIntervalMs??100):null}
  catch(e){operations?.close();store.close();throw e}
  const initialIntegrity = store.verify();
  if (!initialIntegrity.ok) {
    scheduler?.close();operations?.close();store.close();
    throw new Error(`event log integrity check failed at ${initialIntegrity.log ?? "events"} seq ${initialIntegrity.badAt ?? "?"}`);
  }

  const today = cfg.today ?? (() => new Date().toISOString().slice(0, 10));
  const validFor = Object.fromEntries(cfg.pack.atoms.filter((a) => a.valid_for_days).map((a) => [a.id, a.valid_for_days!]));
  const maxBodyBytes = cfg.maxBodyBytes ?? 64 * 1024;
  const maxRequestsPerMinute = cfg.maxRequestsPerMinute ?? 240;
  const rate = new Map<string, { started: number; count: number }>();

  let snapshotDate = today();
  let snapshot = replay(store.events, snapshotDate, validFor);
  const refreshSnapshot = () => {
    snapshotDate = today();
    snapshot = replay(store.events, snapshotDate, validFor);
  };
  const currentSnapshot = () => {
    if (today() !== snapshotDate) refreshSnapshot();
    return snapshot;
  };
  const requireWritableIntegrity = () => {
    const integrity = store.verifyCurrent();
    if (!integrity.ok) throw new HttpError(503, "event log integrity check failed");
  };

  const appendStateEvent = (event: EaiEvent) => {
    const before = store.events.length;
    try {
      return store.append(event);
    } finally {
      if (store.events.length !== before) refreshSnapshot();
    }
  };

  const scoped = (principal: Principal) => {
    const r = currentSnapshot();
    const visible = new Set(cfg.pack.atoms.filter((a) => canRead(principal, a.id)).map((a) => a.id));
    const visibleAtoms = cfg.pack.atoms
      .filter((a) => visible.has(a.id))
      .map((a) => ({ ...a, depends_on: (a.depends_on ?? []).filter((id) => visible.has(id)) }));
    const visiblePack: Pack = {
      ...cfg.pack,
      atoms: visibleAtoms,
      clusters: cfg.pack.clusters
        .map((cluster) => ({ ...cluster, atoms: cluster.atoms.filter((id) => visible.has(id)) }))
        .filter((cluster) => cluster.atoms.length > 0),
      rules: visibleRules(cfg.pack.rules, visible),
    };
    const visibleState = Object.fromEntries(Object.entries(r.state).filter(([id]) => visible.has(id)));
    const visibleDerived = Object.fromEntries(Object.entries(r.derived).filter(([id]) => visible.has(id)));
    const ruleFlags = runRules(visiblePack.rules ?? [], visibleState, visibleDerived);
    const actorFlags = Object.entries(visibleState).flatMap(([atom, atomState]) =>
      atomState.flags
        .filter((flag) => !flag.dismissed)
        .map((flag) => ({ rule: flag.id, flag: "info", message: flag.message, atom, by: flag.by })),
    );
    const checksum = createHash("sha256")
      .update(JSON.stringify(Object.entries(visibleDerived).map(([id, d]) => [id, d.status]).sort()))
      .digest("hex");

    return {
      r,
      visible,
      visiblePack,
      visibleState,
      visibleDerived,
      body: {
        asOf: snapshotDate,
        pack: { id: cfg.pack.pack, version: cfg.pack.version, domain: cfg.pack.domain ?? null },
        atoms: Object.fromEntries(visibleAtoms.map((a) => [a.id, {
          question: a.question,
          type: a.type,
          dependsOn: a.depends_on ?? [],
          impact: a.impact ?? null,
          validForDays: a.valid_for_days ?? null,
          value: visibleState[a.id]?.value ?? null,
          ...derive(visibleState[a.id], snapshotDate, { validForDays: validFor[a.id] }),
        }])),
        clusters: visiblePack.clusters,
        distribution: distribution(visiblePack, visibleDerived),
        flags: [...ruleFlags, ...actorFlags],
        shaky: propagate(visiblePack, visibleDerived),
        coverage: coverage(visiblePack, visibleState, visibleDerived),
        checksum,
        ...(canAudit(principal) && visible.size === cfg.pack.atoms.length ? { rejectedAttempts: store.rejections.length } : {}),
        note: "Nothing flagged means not detected, not safe.",
      },
    };
  };

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://x");
      if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true });
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        });
        return res.end(readFileSync(new URL("../../client/index.html", import.meta.url)));
      }

      if (req.method === "GET" && url.pathname === "/dashboard") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "x-frame-options": "DENY",
          "referrer-policy": "no-referrer",
          "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        });
        return res.end(readFileSync(new URL("../../../prototypes/dashboard/index.html", import.meta.url)));
      }
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const principal = Object.prototype.hasOwnProperty.call(cfg.tokens, token) ? cfg.tokens[token] : undefined;
      if (!principal) return json(res, 401, { error: "missing or unknown token" });
      const actor = principal.actor;

      const nowMs = Date.now();
      const bucket = rate.get(token);
      if (!bucket || nowMs - bucket.started >= 60_000) rate.set(token, { started: nowMs, count: 1 });
      else if (++bucket.count > maxRequestsPerMinute) return json(res, 429, { error: "rate limit exceeded" });

      // A separate, authorized operations record. No model can raise atom evidence
      // through this endpoint; no worker receives authority to modify other logs.
      if (url.pathname.startsWith("/ops/")) {
        if (!operations) return json(res, 503, { error: "operations not configured" });
        if (!canAudit(principal)) return json(res, 403, { error: "operations access required" });
        if (req.method === "GET" && url.pathname === "/ops/state") {
          try { return json(res, 200, operations.snapshot()); }
          catch { return json(res, 503, { error: "operations journal changed or unavailable" }); }
        }
        if (req.method === "GET" && url.pathname === "/ops/catalog") {
          try { return json(res, 200, catalogOverview(operations.snapshot())); }
          catch { return json(res, 503, { error: "operations journal changed or unavailable" }); }
        }
        if (req.method === "GET" && url.pathname === "/ops/verify") {
          return json(res, 200, operations.verify());
        }
        if(req.method==="POST"&&url.pathname==="/ops/builders/compose"){
          if(actor.kind!=="person")throw new HttpError(403,"only people may request worker contracts");
          let raw:unknown;
          try{raw=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!raw||typeof raw!=="object"||Array.isArray(raw)||
             Object.keys(raw).some(key=>key!=="id"&&key!=="name"))
            throw new HttpError(422,"expected name and worker id");
          try{
            const input=raw as {id:string;name:string};
            return json(res,200,proposeComposedWorker(input.id,input.name));
          }catch{return json(res,422,{error:"invalid or unsupported worker composition"})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/plans/propose"){
          if(actor.kind!=="person")throw new HttpError(403,"only people may request plan proposals");
          if(!cfg.planningModel)return json(res,503,{error:"local task planner is not configured"});
          let raw:unknown;
          try{raw=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(k=>k!=="instruction"))
            throw new HttpError(422,"expected only the original instruction");
          const instruction=(raw as {instruction?:unknown}).instruction;
          if(typeof instruction!=="string"||!instruction.trim()||instruction.length>8000)
            throw new HttpError(422,"invalid instruction");
          try{
            const proposal=await proposeMissionPlan(instruction,cfg.planningModel,"mission-"+randomUUID());
            return json(res,200,proposal);
          }catch(e){
            const reason=(e as Error).message;
            if(/invalid plan|unsupported plan fields|invalid task|constraint|cyclic|instruction|mission|dependencies|plan must|missing|source/.test(reason))
              throw new HttpError(422,"planner proposal needs correction and human review");
            throw new HttpError(503,"local planner unavailable");
          }
        }
        if(req.method==="POST"&&url.pathname==="/ops/reposearch"){
          if(!cfg.repoSearchRoot)return json(res,503,{error:"RepoSearch is not configured on this server"});
          let raw:unknown;
          try{raw=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!raw||typeof raw!=="object"||Array.isArray(raw)||Object.keys(raw).some(key=>key!=="query"))
            throw new HttpError(422,"expected repository search query");
          const query=(raw as {query?:unknown}).query;
          if(typeof query!=="string"||!query.trim()||query.length>120)throw new HttpError(422,"invalid search query");
          try{return json(res,200,searchLocalRepository(cfg.repoSearchRoot,query))}
          catch{return json(res,503,{error:"repository search unavailable"})}
        }
        const missionTrace=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/trace$/.exec(url.pathname);
        if(req.method==="GET"&&missionTrace){
          try{
            return json(res,200,buildMissionTrace(operations.snapshot(),missionTrace[1]));
          }catch(e){
            if(String(e).includes("unknown mission"))throw new HttpError(404,"unknown mission");
            throw new HttpError(503,"execution trace unavailable");
          }
        }
        if (req.method === "GET" && url.pathname === "/ops/missions") {
          try {
            const {missions}=operations.snapshot();
            return json(res,200,{missions:Object.fromEntries(Object.entries(missions).map(([id,m])=>
              [id,{...m,progress:missionProgress(m)}]))});
          } catch {throw new HttpError(503,"mission journal unavailable")}
        }
        if (req.method === "POST" && url.pathname === "/ops/missions") {
          if (actor.kind!=="person")throw new HttpError(403,"only people can approve mission plans");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||
             Object.keys(body).some(k=>k!=="plan"))throw new HttpError(422,"expected only plan");
          try {
            const plan=(body as {plan:MissionPlan}).plan;
            validateMissionPlan(plan);
            const linkedAtoms=[...new Set(plan.tasks.flatMap(t=>t.evidenceAtomIds??[]))];
            for(const atom of linkedAtoms){
              if(!atoms.has(atom))throw new HttpError(422,"unknown evidence atom link");
              // Until operations has per-mission authorization, audit principals
              // must all be permitted to see any linked evidence atom ID.
              if(!canRead(principal,atom)||
                 Object.values(cfg.tokens).some(p=>canAudit(p)&&!canRead(p,atom)))
                throw new HttpError(403,"evidence atom link requires shared audit read access");
            }
            const event={type:"mission.create" as const,plan};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId:event.plan.id,seq:entry.seq});
          }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(422,(e as Error).message)}
        }
        const builtinTest=/^\/ops\/workers\/([a-z][a-z0-9-]{2,63})(?:\/versions\/(\d+\.\d+\.\d+))?\/evaluate$/.exec(url.pathname);
        if(req.method==="POST"&&builtinTest){
          if(actor.kind!=="person")throw new HttpError(403,"person required to request worker evaluation");
          requireWritableIntegrity();
          const raw=await readBody(req,maxBodyBytes);
          if(raw.trim()&&raw.trim()!=="{}")throw new HttpError(422,"evaluation takes no arbitrary input");
          try{
            const id=builtinTest[1];
            if(id==="repo-search"&&!cfg.repoSearchRoot)throw new Error("repository search not configured");
            const current=operations.snapshot();
            const record=builtinTest[2]?
              current.workerVersions[id]?.[builtinTest[2]]:
              current.workers[id];
            if(!record||record.stage!=="candidate")throw new Error("worker is not an eligible candidate");
            const check=evaluateBuiltin(id,record.contract);
            const evidenceRef="builtin-fixtures:"+randomUUID();
            const measurement={
              id:"measurement-"+randomUUID(),workerId:id,version:record.contract.version,
              taskKind:check.taskKind,dataset:check.dataset,suiteVersion:check.suiteVersion,
              cohort:check.cohort,metric:check.metric,numerator:check.numerator,denominator:check.denominator,
              measuredAt:new Date().toISOString(),evidenceRef,
            };
            operations.append({
              id:"ops-"+randomUUID(),at:new Date().toISOString(),
              actor:{kind:"check",id:"check:builtins"},
              event:{type:"quality.record",measurement},
            });
            return json(res,200,{...check,evidenceRef,passed:check.numerator===check.denominator});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const missionAutomation=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/automation\/(start|stop)$/.exec(url.pathname);
        if(req.method==="POST"&&missionAutomation){
          if(actor.kind!=="person")throw new HttpError(403,"only a person can authorize or stop automatic tasks");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body))
            throw new HttpError(422,"invalid automation request");
          const missionId=missionAutomation[1],action=missionAutomation[2];
          if(action==="start" &&
             (Object.keys(body).length!==1||!Object.prototype.hasOwnProperty.call(body,"maxStarts")))
            throw new HttpError(422,"expected automatic task budget");
          if(action==="stop"&&Object.keys(body).length)
            throw new HttpError(422,"stop requires an empty request");
          try{
            const event=action==="start"?
              {type:"mission.automation.start" as const,missionId,maxStarts:(body as {maxStarts:number}).maxStarts}:
              {type:"mission.automation.stop" as const,missionId,reason:"user-stopped" as const};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId,action,seq:entry.seq,automation:operations.snapshot().missions[missionId].automation});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const missionStep=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/step$/.exec(url.pathname);
        if(req.method==="POST"&&missionStep){
          if(actor.kind!=="person")throw new HttpError(403,"only people can start execution");
          requireWritableIntegrity();
          const raw=await readBody(req,maxBodyBytes);
          if(raw.trim()&&raw.trim()!=="{}")throw new HttpError(422,"step does not accept an execution payload");
          try{
            if(operations.snapshot().missions[missionStep[1]]?.automation?.enabled)
              throw new Error("stop automatic execution before manual steps");
            return json(res,200,runMissionStep(operations,missionStep[1],4,cfg.repoSearchRoot));
          }
          catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const gateAction=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/gates\/([a-z][a-z0-9-]{2,63})\/resolve$/.exec(url.pathname);
        if(req.method==="POST"&&gateAction){
          if(actor.kind!=="person")throw new HttpError(403,"only designated people can resolve task gates");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(k=>k!=="evidenceRef"))
            throw new HttpError(422,"expected a gate evidence reference");
          try{
            const event={type:"mission.gate.resolve" as const,missionId:gateAction[1],
              constraintId:gateAction[2],evidenceRef:(body as {evidenceRef:string}).evidenceRef};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId:event.missionId,constraintId:event.constraintId,seq:entry.seq});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const retryTask=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/tasks\/([a-z][a-z0-9-]{2,63})\/retry$/.exec(url.pathname);
        if(req.method==="POST"&&retryTask){
          if(actor.kind!=="person")throw new HttpError(403,"a person must approve retry of interrupted work");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).some(x=>x!=="reason"))
            throw new HttpError(422,"expected retry justification");
          try{
            const event={type:"task.retry" as const,missionId:retryTask[1],taskId:retryTask[2],
              reason:(body as {reason:string}).reason};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId:event.missionId,taskId:event.taskId,seq:entry.seq});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const missionAction=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/(run|pause|resume)$/.exec(url.pathname);
        if(req.method==="POST"&&missionAction){
          if(actor.kind!=="person")throw new HttpError(403,"only a person may control mission execution");
          requireWritableIntegrity();
          const raw=await readBody(req,maxBodyBytes);
          if(raw.trim()&&raw.trim()!=="{}")throw new HttpError(422,"this route takes no arbitrary payload");
          const missionId=missionAction[1],action=missionAction[2];
          try{
            if(action==="run"){
              if(operations.snapshot().missions[missionId]?.automation?.enabled)
                throw new Error("stop automatic execution before manual runs");
              return json(res,200,runMissionUntilBlocked(operations,missionId,32,cfg.repoSearchRoot));
            }
            const event={type:action==="pause"?"mission.pause" as const:"mission.resume" as const,missionId};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,200,{missionId,action,seq:entry.seq});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        if (req.method === "POST" && url.pathname === "/ops/events") {
          requireWritableIntegrity();
          let raw: unknown;
          try { raw = JSON.parse((await readBody(req, maxBodyBytes)) || "{}"); }
          catch (e) {
            if (e instanceof HttpError) throw e;
            throw new HttpError(400, "invalid JSON");
          }
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw new HttpError(422, "operations event must be an object");
          }
          if ((raw as any).type==="quality.record")throw new HttpError(403,"quality measurements must originate from a server-side evaluator");
          if (["mission.create","mission.pause","mission.resume","mission.gate.resolve","task.started","task.completed","task.failed","task.retry","mission.automation.start","mission.automation.stop"].includes((raw as any).type)) {
            throw new HttpError(403,"mission transitions require their dedicated server route");
          }
          const envelope = {
            id: "ops-" + randomUUID(),
            at: new Date().toISOString(),
            actor,
            event: raw as import("../../operations/src/registry.ts").OpsEvent,
          };
          try {
            const outcome = operations.append(envelope);
            return json(res, 201, outcome);
          } catch (e) {
            if (String(e).includes("changed outside writer")) throw new HttpError(503, "operations journal changed");
            throw new HttpError(422, (e as Error).message);
          }
        }
      }
      if (req.method === "POST" && url.pathname === "/events") {
        requireWritableIntegrity();
        let raw: any;
        try {
          raw = JSON.parse((await readBody(req, maxBodyBytes)) || "{}");
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "invalid JSON");
        }

        const attempted = { ...raw, actor, at: today() };
        const reject = (reason: string) => {
          store.recordRejection({ at: today(), actor, attempted, reason });
          return json(res, 422, { rejected: true, reason });
        };

        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("event must be an object");
        if (!PUBLIC_TYPES.has(raw.type)) {
          if (raw.type === "check.passed") return reject("check.passed is server-generated only");
          return reject("unknown event type");
        }

        if (!canWrite(principal, raw.atom)) {
          store.recordRejection({ at: today(), actor, attempted, reason: "write access denied" });
          return json(res, 403, { error: "write access denied" });
        }
        const atomDef = atoms.get(raw.atom);
        if (!atomDef) return reject(`unknown atom ${raw.atom}`);
        const eventId = `ev-${randomUUID()}`;
        let event: EaiEvent;

        try {
          if (raw.type === "answer.proposed") {
            const value = requiredString(raw.value, "answer value", 256);
            const allowed = optionsFor(atomDef);
            if (!allowed.includes(value)) return reject(`value must be one of ${allowed.join(", ")}`);
            const probabilities = normalizeProbabilities(raw.probabilities, allowed);
            event = { id: eventId, at: today(), actor, type: "answer.proposed", atom: raw.atom, value, ...(probabilities ? { probabilities } : {}) };
          } else if (raw.type === "evidence.attached") {
            event = { id: eventId, at: today(), actor, type: "evidence.attached", atom: raw.atom, evidence: canonicalEvidence(raw.evidence, actor, eventId) };
          } else if (raw.type === "confidence.lowered") {
            event = { id: eventId, at: today(), actor, type: "confidence.lowered", atom: raw.atom, reason: requiredString(raw.reason, "reason") };
          } else if (raw.type === "flag.raised") {
            event = { id: eventId, at: today(), actor, type: "flag.raised", atom: raw.atom, message: requiredString(raw.message, "flag message") };
          } else if (raw.type === "flag.dismissed") {
            event = {
              id: eventId, at: today(), actor, type: "flag.dismissed", atom: raw.atom,
              flag: requiredString(raw.flag, "flag id", 256), reason: requiredString(raw.reason, "reason"),
            };
          } else {
            event = { id: eventId, at: today(), actor, type: "status.raised", atom: raw.atom, to: raw.to };
          }
        } catch (e) {
          if (e instanceof HttpError) return reject(e.message);
          throw e;
        }

        const v = validate(event, currentSnapshot().state);
        if (!v.ok) return reject(v.reason);
        const line = appendStateEvent(event);
        const fullAudit = canAudit(principal) && cfg.pack.atoms.every((atom) => canRead(principal, atom.id));
        if (fullAudit) return json(res, 201, { seq: line.seq, hash: line.hash });
        res.writeHead(201, {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname.startsWith("/workers/")) {
        requireWritableIntegrity();
        let body: any;
        try {
          body = JSON.parse((await readBody(req, maxBodyBytes)) || "{}");
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(400, "invalid JSON");
        }
        if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
          return json(res, 422, { error: "worker request body must be an empty object" });
        }

        const atomId = decodeURIComponent(url.pathname.slice("/workers/".length));
        if (!canRunWorker(principal, atomId)) return json(res, 403, { error: "worker access denied" });
        const atomDef = atoms.get(atomId);
        if (!atomDef?.worker) return json(res, 404, { error: "unknown or non-worker atom" });

        if (
          canRead(principal, atomId) &&
          (atomDef.worker.reads ?? []).some((read) => !canRead(principal, read.atom))
        ) {
          return json(res, 403, { error: "worker output read requires access to every worker input" });
        }

        const runtimeId = atomDef.worker.runtime ?? "default";
        const runtime = cfg.workers?.[runtimeId];
        if (!runtime) return json(res, 503, { error: "worker runtime unavailable" });

        const before = currentSnapshot();
        const basis = {
          target: before.state[atomId]?.value ?? null,
          reads: Object.fromEntries(
            (atomDef.worker.reads ?? []).map((read) => [read.atom, before.state[read.atom]?.value ?? null]),
          ),
        };
        const result = await executeAtomWorker(
          runtime.provider,
          atomDef,
          before.state,
          runtime.broker,
          { temperature: runtime.temperature },
        );

        const after = currentSnapshot();
        const changed =
          (after.state[atomId]?.value ?? null) !== basis.target ||
          (atomDef.worker.reads ?? []).some(
            (read) => (after.state[read.atom]?.value ?? null) !== basis.reads[read.atom],
          );
        const actor = { kind: "model", id: result.providerId } as const;

        if (changed) {
          store.recordRejection({
            at: today(),
            actor,
            attempted: { worker: atomId, value: result.value },
            reason: "worker inputs changed during execution",
          });
        } else {
          const event: EaiEvent = {
            id: `ev-${randomUUID()}`,
            at: today(),
            actor,
            type: "answer.proposed",
            atom: atomId,
            value: result.value,
            probabilities: result.probabilities,
          };
          const verdict = validate(event, after.state);
          if (!verdict.ok) {
            store.recordRejection({
              at: today(),
              actor,
              attempted: { worker: atomId, value: result.value },
              reason: verdict.reason,
            });
          } else {
            appendStateEvent(event);
          }
        }
        res.writeHead(204, {
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        return res.end();
      }

      if (req.method === "POST" && url.pathname.startsWith("/checks/")) {
        requireWritableIntegrity();
        await readBody(req, maxBodyBytes);
        if (actor.kind !== "check") return json(res, 403, { error: "check runner token required" });
        const id = decodeURIComponent(url.pathname.slice("/checks/".length));
        if (!canRunCheck(principal, id)) return json(res, 403, { error: "check access denied" });
        const check = cfg.checks?.[id];
        if (!check) return json(res, 404, { error: "unknown deterministic check" });
        if (check.reads.some((atom) => !canRead(principal, atom))) {
          return json(res, 403, { error: "check input read access denied" });
        }
        if (check.allowedActorId !== actor.id) return json(res, 403, { error: "check runner is not allowed for this check" });

        const r = currentSnapshot();
        const checkVisible = new Set(check.reads);
        const checkPack: Pack = {
          ...cfg.pack,
          atoms: cfg.pack.atoms
            .filter((atom) => checkVisible.has(atom.id))
            .map((atom) => ({ ...atom, depends_on: (atom.depends_on ?? []).filter((dep) => checkVisible.has(dep)) })),
          clusters: cfg.pack.clusters
            .map((cluster) => ({ ...cluster, atoms: cluster.atoms.filter((atom) => checkVisible.has(atom)) }))
            .filter((cluster) => cluster.atoms.length > 0),
          rules: visibleRules(cfg.pack.rules, checkVisible),
        };
        const checkState = Object.fromEntries(Object.entries(r.state).filter(([atom]) => checkVisible.has(atom)));
        let passed = false;
        try {
          passed = check.run({ pack: checkPack, state: structuredClone(checkState) }) === true;
        } catch {
          throw new HttpError(500, "deterministic check failed", false);
        }
        if (!passed) return json(res, 422, { passed: false });

        const eventId = `ev-${randomUUID()}`;
        const event: EaiEvent = {
          id: eventId,
          at: today(),
          actor,
          type: "check.passed",
          atom: check.atom,
          evidence: {
            id: `${eventId}:evidence`,
            source: check.source,
            observer: actor,
            mode: "observed",
            lineage: `check:${id}`,
            supports: true,
            deterministic: true,
          },
        };
        const v = validate(event, r.state);
        if (!v.ok) throw new HttpError(500, v.reason, false);
        const line = appendStateEvent(event);
        const fullAudit = canAudit(principal) && cfg.pack.atoms.every((atom) => canRead(principal, atom.id));
        if (fullAudit) return json(res, 201, { passed: true, seq: line.seq, hash: line.hash });
        return json(res, 201, { passed: true });
      }

      if (req.method === "GET" && url.pathname === "/state") {
        if (!cfg.pack.atoms.some((atom) => canRead(principal, atom.id))) {
          return json(res, 403, { error: "read access required" });
        }
        return json(res, 200, scoped(principal).body);
      }
      if (req.method === "GET" && url.pathname.startsWith("/explain/")) {
        const id = decodeURIComponent(url.pathname.slice(9));
        const { r, visible } = scoped(principal);
        if (!visible.has(id)) return json(res, 404, { error: "unknown or unavailable atom" });
        return json(res, 200, {
          atom: id,
          ...derive(r.state[id], snapshotDate, { validForDays: validFor[id] }),
          evidence: r.state[id]?.evidence ?? [],
          flags: r.state[id]?.flags ?? [],
        });
      }
      if (req.method === "GET" && url.pathname === "/weakest") {
        const goals = (url.searchParams.get("goal") ?? "").split(",").filter(Boolean);
        const { visiblePack, visibleDerived, visible } = scoped(principal);
        if (goals.some((id) => !visible.has(id))) return json(res, 404, { error: "unknown or unavailable atom" });
        return json(res, 200, weakestLink(visiblePack, visibleDerived, goals));
      }
      if (req.method === "GET" && url.pathname === "/log/verify") {
        if (!canAudit(principal)) return json(res, 403, { error: "audit access required" });
        return json(res, 200, store.verify());
      }
      return json(res, 404, { error: "not found" });
    } catch (e: any) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.expose ? e.message : "internal server error" });
      return json(res, 500, { error: "internal server error" });
    }
  });
  server.on("close", () => { scheduler?.close();store.close(); operations?.close(); });
  return { server, store, operations, scheduler };
}

// Run directly: EAI_TOKENS=./tokens.json EAI_DIR=./data node packages/server/src/server.ts
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const tokenFile = process.env.EAI_TOKENS;
  if (!tokenFile) throw new Error("EAI_TOKENS is required; the server never falls back to example credentials");
  const witnessDir = process.env.EAI_WITNESS_DIR;
  const privateKeyFile = process.env.EAI_WITNESS_PRIVATE_KEY;
  const publicKeyFile = process.env.EAI_WITNESS_PUBLIC_KEY;
  if (!witnessDir || !privateKeyFile || !publicKeyFile) {
    throw new Error("EAI_WITNESS_DIR, EAI_WITNESS_PRIVATE_KEY and EAI_WITNESS_PUBLIC_KEY are required");
  }
  const dataDir = resolve(process.env.EAI_DIR ?? "./data");
  const resolvedWitnessDir = resolve(witnessDir);
  const witnessRelativeToData = relative(dataDir, resolvedWitnessDir);
  if (witnessRelativeToData === "" || (!witnessRelativeToData.startsWith("..") && !isAbsolute(witnessRelativeToData))) {
    throw new Error("EAI_WITNESS_DIR must be outside EAI_DIR");
  }
  const witness = new SignedFileAnchorWitness(
    resolvedWitnessDir,
    readFileSync(privateKeyFile, "utf8"),
    readFileSync(publicKeyFile, "utf8"),
  );
  const { server } = makeServer({
    dir: dataDir,
    operationsDir: process.env.EAI_OPERATIONS_DIR ? resolve(process.env.EAI_OPERATIONS_DIR) : undefined,
    repoSearchRoot: process.env.EAI_REPO_SEARCH_ROOT ? resolve(process.env.EAI_REPO_SEARCH_ROOT) : undefined,
    planningModel: process.env.EAI_PLAN_MODEL ? localOllamaPlanningModel({model:process.env.EAI_PLAN_MODEL}) : undefined,
    pack: JSON.parse(readFileSync(process.env.EAI_PACK ?? "packs/sow-demo/pack.json", "utf8")),
    tokens: JSON.parse(readFileSync(tokenFile, "utf8")),
    witness,
  });
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.EAI_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`EAI server on http://${host}:${port}`));
}
