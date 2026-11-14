import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  coverage, derive, distribution, lintPack, optionsFor, propagate, replay, reviewSignals, runRules, validate, weakestLink,
  type Actor, type EaiEvent, type Pack, type State,
} from "../../core/src/index.ts";
import { Store } from "./store.ts";
import { OpsStore } from "../../operations/src/store.ts";
import type { OpsEnvelope } from "../../operations/src/registry.ts";
import {localStateWithoutDemo} from "../../operations/src/legacy-demo-view.ts";
import { catalogOverview } from "../../operations/src/selector.ts";
import { runMissionStep, runMissionUntilBlocked, evaluateBuiltin, builtinInventoryForState } from "../../operations/src/execution.ts";
import {runParallelPureText} from "../../operations/src/parallel.ts";
import {expireLocalLeases} from "../../operations/src/leases.ts";
import {projectLocalQueue} from "../../operations/src/queue.ts";
import {productionLineView} from "../../operations/src/production-line.ts";
import {verifyGitHubActionsRun,type GitHubReader} from "../../operations/src/github-actions.ts";
import {measureArtifactBytes,preflightArtifactUpload,ArtifactInputError} from "../../operations/src/artifact-bytes.ts";
import {verifyGitHubRunArtifact,checkArtifactSelection} from "../../operations/src/github-artifact.ts";
import {claimTextJob,heartbeatTextJob,completeTextJob,validateJobReference,
  validateExecutorIdentities,type ExecutorIdentity,type JobReference} from "../../operations/src/executor-channel.ts";
import { missionProgress, validateMissionPlan, type MissionPlan } from "../../operations/src/missions.ts";
import {LocalMissionScheduler} from "../../operations/src/scheduler.ts";
import { buildMissionTrace } from "../../operations/src/trace.ts";
import { searchLocalRepository } from "../../operations/src/reposearch.ts";
import {proposeMissionPlan,localOllamaPlanningModel,type PlanningModel} from "../../operations/src/planner.ts";
import type {LocalCodeWorkspace} from "../../operations/src/code-worker.ts";
import {probeDockerConnection,type DockerConnectionStatus} from "../../operations/src/local-docker-status.ts";
import {OrderedCodePlans} from "../../operations/src/ordered-code-plans.ts";
import type {ProjectTestInput,ProjectTestResult} from "../../operations/src/docker-project-suite.ts";
import {inspectMissionPlan} from "../../operations/src/preflight.ts";
import {proposeMissionRevision} from "../../operations/src/replan.ts";
import {proposeComposedWorker} from "../../operations/src/builder.ts";
import { executeAtomWorker, type ModelProvider, type SourceBroker } from "../../gateway/src/gateway.ts";
import { canAudit, canManageCode, canRead, canRunCheck, canRunWorker, canWrite, validatePrincipals, type Principal } from "./authz.ts";
import { SignedFileAnchorWitness, type AnchorWitness } from "./witness.ts";

export interface DeterministicCheck {
  atom: string;
  reads: string[];
  /**
   * Registered pack sources this check consults outside the atom state. A check that declares
   * one is grounded in that source and can prove on its own; one that declares none must build
   * on first-hand premises or stand next to independent evidence.
   */
  sources?: string[];
  source: string;
  allowedActorId: string;
  /**
   * Run this check by itself after operations events, as the check's own actor. With `answer`
   * the server also proposes that answer as a system actor when the check passes on an atom
   * nobody has answered. This is how recorded work becomes visible evidence without a person.
   */
  auto?: { answer?: string };
  /** `operations` is the read-only history of the operations journal, when one is configured. */
  run(input: { pack: Pack; state: State; operations?: readonly OpsEnvelope[] }): boolean;
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
  /** Dedicated local executor credentials, never general API tokens. */
  executorTokens?: Record<string,ExecutorIdentity>;
  /** Optional read-only GitHub token for private repositories. Never sent to workers. */
  githubReadToken?:string;
  /** Test-only injection of GitHub HTTP transport. */
  githubActionReader?:GitHubReader;
  /** Optional smaller local upload limit used in deterministic tests. */
  maxArtifactBytes?:number;
  witness: AnchorWitness;
  checks?: Record<string, DeterministicCheck>;
  workers?: Record<string, WorkerRuntime>;
  /** Optional separate operations journal. Existing evidence logs stay unchanged. */
  operationsDir?: string;
  /** Hide only seed records from old local demo launches; preserve the original journal. */
  localLiveView?:boolean;
  /** 0 disables timer for deterministic testing; default 100 milliseconds. */
  schedulerIntervalMs?: number;
  /** Administrator-allowlisted checkout; never taken from a caller or model. */
  repoSearchRoot?: string;
  /** Optional local planning model; drafts always require human approval. */
  planningModel?: PlanningModel;
  /** Optional, operator-approved local code worktree. No shell or arbitrary file writes. */
  codeWorkspace?: LocalCodeWorkspace;
  /** Test-only override for the non-writing Docker availability check. */
  dockerConnectionProbe?:()=>DockerConnectionStatus;
  /** Test-only injection for deterministic multi-file checks; production uses Docker. */
  projectSuiteRunner?: (input:ProjectTestInput)=>Promise<ProjectTestResult>;
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

/**
 * A source that feeds a worker is as visible as the atoms it feeds. A source no worker uses is
 * general. This keeps source names from hinting at atoms a principal cannot read.
 */
function sourceScope(pack: Pack) {
  const feeds = new Map<string, string[]>();
  for (const atom of pack.atoms) for (const source of atom.worker?.sources ?? []) {
    feeds.set(source, [...(feeds.get(source) ?? []), atom.id]);
  }
  return (principal: Principal) => (pack.sources ?? []).filter((source) => {
    const atoms = feeds.get(source.id);
    return !atoms || atoms.some((atom) => canRead(principal, atom));
  });
}

function canonicalEvidence(raw: any, actor: Actor, eventId: string, citable: Set<string>) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(422, "evidence must be an object");
  const mode = raw.mode;
  if (mode !== "reported" && mode !== "observed") throw new HttpError(422, "evidence mode must be reported or observed");
  if (typeof raw.supports !== "boolean") throw new HttpError(422, "evidence supports must be boolean");
  if (raw.valid_until !== undefined && (typeof raw.valid_until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.valid_until))) {
    throw new HttpError(422, "valid_until must be an ISO date");
  }
  if (raw.source_ref !== undefined && (typeof raw.source_ref !== "string" || !citable.has(raw.source_ref))) {
    throw new HttpError(422, "source_ref must be a registered source available to this principal");
  }
  // Origin comes from a registered source when one is cited. Without one the item still
  // supports the answer, but it is marked so that it can never count as corroboration.
  const origin = raw.source_ref
    ? { lineage: `source:${raw.source_ref}`, source_ref: raw.source_ref as string }
    : { lineage: `actor:${actor.kind}:${actor.id}`, origin_unverified: true };
  return {
    id: `${eventId}:evidence`,
    source: requiredString(raw.source, "evidence source", 2048),
    observer: actor,
    mode,
    ...origin,
    supports: raw.supports,
    ...(raw.valid_until ? { valid_until: raw.valid_until } : {}),
  };
}

export function makeServer(cfg: Config) {
  const problems = lintPack(cfg.pack);
  if (problems.length) throw new Error("pack is invalid:\n" + problems.join("\n"));
  const atoms = new Map(cfg.pack.atoms.map((a) => [a.id, a]));
  const sourceIds = new Set((cfg.pack.sources ?? []).map((source) => source.id));
  const sourcesFor = sourceScope(cfg.pack);
  validatePrincipals(cfg.tokens, cfg.pack, Object.keys(cfg.checks ?? {}), ACTOR_KINDS);
  validateExecutorIdentities(cfg.executorTokens,new Set(Object.keys(cfg.tokens)));

  for (const [id, check] of Object.entries(cfg.checks ?? {})) {
    if (
      !id.trim() ||
      !atoms.has(check.atom) ||
      !Array.isArray(check.reads) ||
      !check.reads.length ||
      !check.reads.includes(check.atom) ||
      check.reads.some((atom) => !atoms.has(atom)) ||
      (check.sources !== undefined && (!Array.isArray(check.sources) || check.sources.some((source) => !sourceIds.has(source)))) ||
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
  try{
    // Expired child leases become recorded failures, not automatic retries.
    // Do this before the scheduler inspects the persisted missions.
    if(operations)expireLocalLeases(operations);
    scheduler=operations?new LocalMissionScheduler(operations,cfg.schedulerIntervalMs??100):null;
  }catch(e){operations?.close();store.close();throw e}
  const initialIntegrity = store.verify();
  if (!initialIntegrity.ok) {
    scheduler?.close();operations?.close();store.close();
    throw new Error(`event log integrity check failed at ${initialIntegrity.log ?? "events"} seq ${initialIntegrity.badAt ?? "?"}`);
  }

  const codePlans=cfg.codeWorkspace?new OrderedCodePlans(cfg.codeWorkspace,{suiteRunner:cfg.projectSuiteRunner}):null;
  const readableOps=()=>{
    if(!operations)throw new Error("Operations not configured");
    const full=operations.snapshot();
    return cfg.localLiveView?localStateWithoutDemo(full):full;
  };
  const today = cfg.today ?? (() => new Date().toISOString().slice(0, 10));
  const validFor = Object.fromEntries(cfg.pack.atoms.filter((a) => a.valid_for_days).map((a) => [a.id, a.valid_for_days!]));
  const maxBodyBytes = cfg.maxBodyBytes ?? 64 * 1024;
  const maxArtifactBytes=cfg.maxArtifactBytes??16*1024*1024;
  if(!Number.isSafeInteger(maxArtifactBytes)||maxArtifactBytes<1||
     maxArtifactBytes>16*1024*1024)
    throw new Error("artifact byte limit must be 1-16777216");
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

  /**
   * Run a registered check and record its verdict. A pass supports the answer; a failure is
   * recorded as contradicting evidence, so a proof is withdrawn the moment its rule stops holding.
   * The latest verdict of a check replaces its earlier ones; an unchanged verdict is not re-recorded.
   */
  const runCheck = (id: string, actor: Actor) => {
    const check = cfg.checks![id];
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
    const history = operations ? operations.snapshot().history : undefined;
    const passed = check.run({ pack: checkPack, state: structuredClone(checkState), ...(history ? { operations: history } : {}) }) === true;
    if (!(check.atom in r.state)) return { passed, line: null };

    const basis = {
      reads: Object.fromEntries(check.reads.map((atom) => [atom, r.state[atom]?.value ?? null])),
      ...(check.sources?.length ? { sources: check.sources } : {}),
    };
    const lineage = `check:${id}`;
    const previous = r.state[check.atom].evidence.find((e) => e.observer.kind === "check" && e.lineage === lineage);
    if (previous && previous.supports === passed && JSON.stringify(previous.basis?.reads) === JSON.stringify(basis.reads)) {
      return { passed, line: null };
    }
    // Nothing to withdraw: a failure on an atom this check never supported is not evidence against it.
    if (!passed && !previous) return { passed, line: null };
    const eventId = `ev-${randomUUID()}`;
    const event: EaiEvent = {
      id: eventId, at: today(), actor, type: passed ? "check.passed" : "check.failed", atom: check.atom,
      evidence: {
        id: `${eventId}:evidence`, source: check.source, observer: actor, mode: "observed",
        lineage, supports: passed, deterministic: true, basis,
      },
    };
    const v = validate(event, r.state);
    if (!v.ok) throw new HttpError(500, v.reason, false);
    return { passed, line: appendStateEvent(event) };
  };

  /** After operations events: let self-running checks re-evaluate. Never breaks the caller. */
  const runAutoChecks = () => {
    for (const [id, check] of Object.entries(cfg.checks ?? {})) {
      if (!check.auto) continue;
      try {
        if (!store.verifyCurrent().ok) return;
        const actor: Actor = { kind: "check", id: check.allowedActorId };
        const current = currentSnapshot().state[check.atom]?.value;
        if (check.auto.answer && optionsFor(atoms.get(check.atom)!).includes(check.auto.answer) &&
            (current === undefined || current === "unknown")) {
          const probe = check.run({ pack: cfg.pack, state: { [check.atom]: { value: check.auto.answer, evidence: [], flags: [], lowered: [] } }, ...(operations ? { operations: operations.snapshot().history } : {}) }) === true;
          if (!probe) continue;
          const answer: EaiEvent = {
            id: `ev-${randomUUID()}`, at: today(), actor: { kind: "system", id: "system:evidence-bridge" },
            type: "answer.proposed", atom: check.atom, value: check.auto.answer,
          };
          if (validate(answer, currentSnapshot().state).ok) appendStateEvent(answer);
        }
        runCheck(id, actor);
      } catch { /* the operations action already succeeded; evidence catches up on the next event */ }
    }
  };
  // Reconcile once at start. If the process stopped after an operations event was written but
  // before its check ran, a proof that no longer holds would otherwise survive the restart.
  runAutoChecks();

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
          options: optionsFor(a),
          writable: canWrite(principal, a.id),
          value: visibleState[a.id]?.value ?? null,
          ...(visibleDerived[a.id] ?? derive(undefined, snapshotDate)),
        }])),
        clusters: visiblePack.clusters,
        distribution: distribution(visiblePack, visibleDerived),
        flags: [...ruleFlags, ...actorFlags],
        shaky: propagate(visiblePack, visibleDerived),
        coverage: coverage(visiblePack, visibleState, visibleDerived),
        sources: sourcesFor(principal),
        review: reviewSignals(visiblePack, r.state, r.derived, undefined, (atom) => visible.has(atom)),
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
      const executor=cfg.executorTokens&&Object.prototype.hasOwnProperty.call(cfg.executorTokens,token)?
        cfg.executorTokens[token]:undefined;
      if (!principal&&!executor) return json(res, 401, { error: "missing or unknown token" });

      const nowMs = Date.now();
      const bucket = rate.get(token);
      if (!bucket || nowMs - bucket.started >= 60_000) rate.set(token, { started: nowMs, count: 1 });
      else if (++bucket.count > maxRequestsPerMinute) return json(res, 429, { error: "rate limit exceeded" });

      // A separate, loopback-only worker channel. Worker tokens never authorize
      // ordinary operations or evidence routes, and accept no task selection.
      if(url.pathname.startsWith("/executor/v1/")){
        if(!executor)return json(res,403,{error:"executor permission required"});
        const remote=req.socket.remoteAddress??"";
        if(!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote))
          return json(res,403,{error:"executor transport restricted to loopback"});
        if(req.method!=="POST")return json(res,405,{error:"POST required"});
        if(!operations)return json(res,503,{error:"operations unavailable"});
        requireWritableIntegrity();
        const raw=await readBody(req,Math.min(maxBodyBytes,20000));
        let body:unknown;
        try{body=JSON.parse(raw||"{}")}
        catch{throw new HttpError(400,"invalid executor JSON")}
        if(!body||typeof body!=="object"||Array.isArray(body))
          throw new HttpError(422,"expected executor request object");
        const obj=body as Record<string,unknown>;
        if(url.pathname==="/executor/v1/claim"){
          if(Object.keys(obj).length)throw new HttpError(422,"claim takes no task parameters");
          try{
            const job=claimTextJob(operations,executor);
            if(!job){res.writeHead(204,{"cache-control":"no-store"});return res.end()}
            return json(res,200,job);
          }catch{throw new HttpError(409,"no safe local claim available")}
        }
        if(url.pathname==="/executor/v1/heartbeat"||
           url.pathname==="/executor/v1/complete"){
          const completion=url.pathname.endsWith("/complete");
          if(Object.keys(obj).some(k=>!["missionId","taskId","runId","leaseId",
            ...(completion?["output"]:[])].includes(k))||
             (completion?!Object.prototype.hasOwnProperty.call(obj,"output"):
               Object.keys(obj).length!==4))
            throw new HttpError(422,"invalid executor fields");
          try{
            validateJobReference(obj);
            if(completion){
              if(!obj.output||typeof obj.output!=="object"||Array.isArray(obj.output))
                throw new HttpError(422,"invalid executor output");
              return json(res,200,completeTextJob(operations,executor,
                obj as unknown as JobReference & {output:Record<string,unknown>}));
            }
            return json(res,200,heartbeatTextJob(operations,executor,obj));
          }catch(e){
            if(e instanceof HttpError)throw e;
            throw new HttpError(409,"executor lease or result rejected");
          }
        }
        return json(res,404,{error:"executor route not found"});
      }
      if(!principal)return json(res,403,{error:"executor token cannot access regular API"});
      const actor=principal.actor;
      // A separate, authorized operations record. No model can raise atom evidence
      // through this endpoint; no worker receives authority to modify other logs.
      if (url.pathname.startsWith("/ops/")) {
        if (!operations) return json(res, 503, { error: "operations not configured" });
        if (!canAudit(principal)) return json(res, 403, { error: "operations access required" });
        if (url.pathname.startsWith("/ops/code/") && !canManageCode(principal))
          return json(res, 403, { error: "local code access required" });
        const recordCodeAction=(
          action:"proposed"|"tested"|"suite-tested"|"apply-started"|"applied"|"restore-started"|"restored"|"aborted",
          detail:{id:string;path:string;sourceSha256:string;replacementSha256:string;modelId:string},
          result:"review-required"|"passed"|"failed"|"unavailable"|"pending"|"applied"|"restored"|"aborted",
          testSha256?:string,projectManifestSha256?:string
        )=>{
          const exists=operations.snapshot().history.some(row=>
            row.event.type==="code.activity"&&row.event.proposalId===detail.id);
          const common={proposalId:detail.id,path:detail.path,
            sourceSha256:detail.sourceSha256,replacementSha256:detail.replacementSha256,
            modelId:detail.modelId};
          // A proposal created with an older preview has no operations entry.
          // Import it as legacy, never claim we witnessed its creation.
          if(!exists&&action!=="proposed"){
            operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
              actor:{kind:"system",id:"system:legacy-code-import"},
              event:{type:"code.activity",action:"imported",...common,result:"legacy-unverified"}});
          }
          const entry=operations.append({id:"ops-"+randomUUID(),
            at:new Date().toISOString(),
            actor:action==="tested"||action==="suite-tested"?
              {kind:"check" as const,id:action==="tested"?"check:docker-code-test":"check:docker-project-suite"}:actor,
            event:{type:"code.activity",action,...common,result,
              ...(testSha256?{testSha256}:{}),
              ...(projectManifestSha256?{projectManifestSha256}:{})}
          });
          runAutoChecks();
          return entry.seq;
        };
        const pendingCodeActions=()=>{
          const latest=new Map<string,{
            action:string;proposalId:string;path:string;sourceSha256:string;
            replacementSha256:string;modelId:string
          }>();
          for(const row of operations.snapshot().history){
            if(row.event.type==="code.activity")
              latest.set(row.event.proposalId,row.event);
          }
          return [...latest.values()].filter(e=>
            e.action==="apply-started"||e.action==="restore-started");
        };
        const requireNoPendingCodeAction=()=>{
          if(pendingCodeActions().length)
            throw new HttpError(409,"Er staat een onderbroken codewijziging open. Controleer die eerst onder Codeworker > Herstel.");
        };
        const requireIndependentCodeAction=()=>{
          if(codePlans?.list().some(plan=>plan.state==="active"||plan.state==="blocked"))
            throw new HttpError(409,"Er staat een codeplan open. Rond het plan af of stop het eerst.");
        };
        const requirePlan=()=>{
          if(!cfg.codeWorkspace||!codePlans)
            throw new HttpError(503,"Geen lokale codewerkmap ingesteld");
          return {workspace:cfg.codeWorkspace,plans:codePlans};
        };
        const codePlanRequest=async(fields:string[])=>{
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(key=>!fields.includes(key)))
            throw new HttpError(422,"Ongeldig codeplanverzoek");
          return input as Record<string,unknown>;
        };
        if(req.method==="GET"&&url.pathname==="/ops/code/plans"){
          const {plans}=requirePlan();
          try{return json(res,200,{plans:plans.list()})}
          catch{return json(res,503,{error:"Codeplannen zijn niet veilig leesbaar"})}
        }
        if(req.method==="GET"&&url.pathname==="/ops/code/plan"){
          const {plans}=requirePlan();
          try{return json(res,200,plans.view(url.searchParams.get("id")??""))}
          catch{return json(res,404,{error:"Codeplan ontbreekt of is niet veilig leesbaar"})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plans"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag een codeplan maken");
          const {plans}=requirePlan();
          requireNoPendingCodeAction();
          const request=await codePlanRequest(["title","steps","suitePolicy"]);
          try{return json(res,200,plans.create(request as any,actor.id))}
          catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plan/stop"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag een plan stoppen");
          const {plans}=requirePlan();
          const request=await codePlanRequest(["planId","approve"]);
          if(request.approve!==true||typeof request.planId!=="string")
            throw new HttpError(422,"Bevestig dat je het plan wilt stoppen");
          try{return json(res,200,plans.stop(request.planId,actor.id))}
          catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plan/propose"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag een voorstel aanvragen");
          const {workspace,plans}=requirePlan();
          const request=await codePlanRequest(["planId"]);
          if(typeof request.planId!=="string")throw new HttpError(422,"Geef een codeplan op");
          requireNoPendingCodeAction();
          try{
            return json(res,200,await plans.exclusive(async()=>{
              const current=plans.active(request.planId as string);
              if(current.status!=="waiting")throw new Error("Deze stap heeft al een voorstel");
              const relatedPaths=current.record.steps.map(step=>step.path)
                .filter(path=>path!==current.step.path);
              const proposed=await workspace.propose(current.step.path,current.step.instruction,
                current.step.testPath,relatedPaths);
              const journalSeq=recordCodeAction("proposed",proposed,"review-required");
              return {...plans.attachProposal(request.planId as string,proposed.id),proposalId:proposed.id,journalSeq};
            }));
          }catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plan/test-pre"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag tests starten");
          const {workspace,plans}=requirePlan();
          const request=await codePlanRequest(["planId","proposalId"]);
          if(typeof request.planId!=="string"||typeof request.proposalId!=="string")
            throw new HttpError(422,"Geef plan en voorstel op");
          requireNoPendingCodeAction();
          try{
            return json(res,200,await plans.exclusive(async()=>{
              plans.assertProposal(request.planId as string,request.proposalId as string,"review");
              const report=await workspace.runTests(request.proposalId as string);
              recordCodeAction("tested",workspace.inspect(request.proposalId as string),
                report.status,report.testSha256);
              return {report,plan:plans.view(request.planId as string)};
            }));
          }catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plan/apply"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag code toepassen");
          const {workspace,plans}=requirePlan();
          const request=await codePlanRequest(["planId","proposalId","expectedSha256","approve"]);
          if(typeof request.planId!=="string"||typeof request.proposalId!=="string"||
             typeof request.expectedSha256!=="string"||request.approve!==true)
            throw new HttpError(422,"Controleer het voorstel en bevestig de SHA-256");
          requireNoPendingCodeAction();
          try{
            return json(res,200,await plans.exclusive(async()=>{
              plans.assertProposal(request.planId as string,request.proposalId as string,"review");
              const pre=workspace.inspect(request.proposalId as string);
              const projectMode=plans.view(request.planId as string).suitePolicy==="project-node-v1";
              if(pre.replacementSha256!==request.expectedSha256||
                 (projectMode?
                   (!pre.sourceUnchanged||!pre.replacementHashMatches||
                    pre.preflight.status==="failed"||
                    !plans.projectPreApproved(request.planId as string,request.proposalId as string)):
                   (!pre.canApply||pre.testReport?.status!=="passed"||!pre.testReport.testsExecuted)))
                throw new Error("De vereiste tests en goedkeuring horen niet bij deze codeversie");
              recordCodeAction("apply-started",{id:pre.id,...pre},"pending");
              const applied=workspace.apply({
                proposalId:request.proposalId as string,
                expectedSha256:request.expectedSha256 as string,approve:true
              },actor.id,{projectSuiteApproved:projectMode});
              recordCodeAction("applied",{id:pre.id,...pre},"applied");
              return {applied,plan:plans.view(request.planId as string)};
            }));
          }catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/plan/test-post"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag de wijziging testen");
          const {workspace,plans}=requirePlan();
          const request=await codePlanRequest(["planId","proposalId"]);
          if(typeof request.planId!=="string"||typeof request.proposalId!=="string")
            throw new HttpError(422,"Geef plan en voorstel op");
          requireNoPendingCodeAction();
          try{
            return json(res,200,await plans.exclusive(async()=>{
              plans.assertProposal(request.planId as string,request.proposalId as string,"needs-post-test");
              const report=await workspace.runAppliedTests(request.proposalId as string);
              recordCodeAction("tested",workspace.inspect(request.proposalId as string),
                report.status,report.testSha256);
              const plan=plans.storePostTest(request.planId as string,request.proposalId as string,report);
              return {report,plan};
            }));
          }catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="POST"&&
           ["/ops/code/plan/test-project-pre","/ops/code/plan/test-project-post"].includes(url.pathname)){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen personen mogen projecttests aanvragen");
          const {workspace,plans}=requirePlan();
          const request=await codePlanRequest(["planId","proposalId"]);
          if(typeof request.planId!=="string"||typeof request.proposalId!=="string")
            throw new HttpError(422,"Geef een plan en een codevoorstel op");
          requireNoPendingCodeAction();
          const phase=url.pathname.endsWith("-pre")?"pre":"post";
          try{
            return json(res,200,await plans.exclusive(async()=>
              plans.runProjectSuite(request.planId as string,request.proposalId as string,
                phase,result=>{
                  const inspected=workspace.inspect(request.proposalId as string);
                  recordCodeAction("suite-tested",inspected,result.status,
                    undefined,result.manifestSha256);
                })));
          }catch(e){return json(res,409,{error:String((e as Error).message)})}
        }
        if(req.method==="GET"&&url.pathname==="/ops/code/recovery"){
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          try{
            const pending=pendingCodeActions().map(row=>{
              try{
                return cfg.codeWorkspace!.inspectPending(row.proposalId,
                  row.action as "apply-started"|"restore-started");
              }catch{
                return {proposalId:row.proposalId,path:row.path,action:row.action,
                  outcome:"manual-required",reason:"Voorstel of bestand is niet veilig leesbaar"};
              }
            });
            return json(res,200,{pending,blocked:pending.length>0,
              note:"Alleen na een expliciet herstelverzoek wordt het log afgerond. Bronbestanden worden bij het herstellen niet geschreven."});
          }catch{return json(res,503,{error:"Herstelstatus is niet beschikbaar"})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/recover"){
          if(actor.kind!=="person")throw new HttpError(403,"Alleen een persoon mag een onderbroken actie afronden");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(k=>!["proposalId","approve"].includes(k))||
             (input as any).approve!==true||typeof (input as any).proposalId!=="string")
            throw new HttpError(422,"Controleer het herstel en bevestig het voorstelnummer");
          const proposalId=(input as any).proposalId as string;
          let entry;
          try{entry=pendingCodeActions().find(e=>e.proposalId===proposalId)}
          catch{return json(res,503,{error:"Operationslog is niet beschikbaar"})}
          if(!entry)return json(res,409,{error:"Voor dit voorstel staat geen onafgeronde codeactie open"});
          const operation=entry.action as "apply-started"|"restore-started";
          let outcome;
          try{outcome=cfg.codeWorkspace.reconcilePending(proposalId,operation,actor.id)}
          catch{return json(res,409,{error:"Het voorstel of bronbestand kan niet veilig worden gecontroleerd"})}
          if(outcome.outcome==="manual-required")
            return json(res,409,{...outcome,error:"Bestandsinhoud is onduidelijk. Verander niets en controleer de bron en back-up handmatig."});
          try{
            const seq=recordCodeAction(outcome.outcome==="aborted"?"aborted":
              outcome.outcome==="applied"?"applied":"restored",
              {id:entry.proposalId,path:entry.path,sourceSha256:entry.sourceSha256,
                replacementSha256:entry.replacementSha256,modelId:entry.modelId},
              outcome.outcome);
            return json(res,200,{...outcome,journalSeq:seq});
          }catch{return json(res,503,{error:"Bronmetadata gecontroleerd, maar logafsluiting mislukt. Herhaal de herstelcontrole."})}
        }
        if(req.method==="GET"&&url.pathname==="/ops/code/activity"){
          try{
            const filter=url.searchParams.get("proposalId");
            if(filter&&(!/^[0-9a-f-]{36}$/.test(filter)))return json(res,422,{error:"Ongeldig voorstelnummer"});
            const events=operations.snapshot().history.filter(row=>
              row.event.type==="code.activity"&&
              (!filter||row.event.proposalId===filter))
              .slice(-60);
            return json(res,200,{events,source:"operations-hash-journal",
              note:"Geregistreerde gebeurtenissen, geen inhoudelijke codegoedkeuring."});
          }catch{return json(res,503,{error:"Operationslog is niet beschikbaar"})}
        }
        if (req.method === "GET" && url.pathname === "/ops/connections") {
          const model=cfg.codeWorkspace?
            await cfg.codeWorkspace.probeOllama():
            {status:"not-configured" as const,modelId:cfg.planningModel?.id??null,
             detail:"Geen codewerkmap met een controleerbare Ollama-verbinding ingesteld."};
          const docker=(cfg.dockerConnectionProbe??probeDockerConnection)();
          return json(res,200,{
            server:{status:"ready",detail:"Dashboard is aangemeld bij deze lokale EAIwork-server."},
            ollama:model,docker,checkedAt:new Date().toISOString(),
            note:"Ollama-bereikbaarheid bewijst nog geen geslaagde modeluitvoer. Een Docker-controle is nog geen geslaagde projecttest."
          });
        }
        if (req.method === "GET" && url.pathname === "/ops/code/workspace") {
          return json(res,200,{enabled:!!cfg.codeWorkspace,
            worktree:cfg.codeWorkspace?.root??null,
            modelId:cfg.codeWorkspace?.modelId??null,
            mode:"ordered-project-tests-available"});
        }
        if(req.method==="GET"&&url.pathname==="/ops/code/proposals"){
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          try{return json(res,200,{proposals:cfg.codeWorkspace.list(20)})}
          catch{return json(res,503,{error:"Codevoorstellen zijn niet beschikbaar"})}
        }
        if(req.method==="GET"&&url.pathname==="/ops/code/proposal"){
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          try{return json(res,200,cfg.codeWorkspace.inspect(url.searchParams.get("id")??""))}
          catch{return json(res,404,{error:"Codevoorstel is niet gevonden of kan niet worden gelezen"})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/propose"){
          requireIndependentCodeAction();
          if(actor.kind!=="person")throw new HttpError(403,"alleen personen kunnen codevoorstellen aanvragen");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
              Object.keys(input).some(k=>!["path","instruction","testPath"].includes(k)))
            throw new HttpError(422,"Vul een relatief bestand en opdracht in");
          const item=input as {path:string;instruction:string;testPath?:string};
          let proposed;
          try{proposed=await cfg.codeWorkspace.propose(item.path,item.instruction,item.testPath)}
          catch{return json(res,422,{error:"Codevoorstel kon niet veilig worden gemaakt"})}
          try{
            const journalSeq=recordCodeAction("proposed",proposed,"review-required");
            return json(res,200,{...proposed,journalSeq});
          }catch{return json(res,503,{error:"Voorstel is opgeslagen maar niet in het operationslog geregistreerd. Controleer de voorstelgeschiedenis."})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/check"){
          if(actor.kind!=="person")throw new HttpError(403,"alleen personen kunnen voorstellen controleren");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(k=>k!=="proposalId")||
             typeof (input as any).proposalId!=="string")
            throw new HttpError(422,"Geef een bestaand voorstelnummer op");
          try{return json(res,200,cfg.codeWorkspace.inspect((input as any).proposalId))}
          catch{return json(res,409,{error:"Codecontrole niet mogelijk: voorstel of bronbestand ontbreekt"})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/test"){
          requireIndependentCodeAction();
          if(actor.kind!=="person")throw new HttpError(403,"alleen personen kunnen Docker-tests starten");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(k=>k!=="proposalId")||
             typeof (input as any).proposalId!=="string")
            throw new HttpError(422,"Geef een bestaand voorstelnummer op");
          requireNoPendingCodeAction();
          const proposalId=(input as any).proposalId as string;
          // Verify and import older proposals before starting the Docker test.
          try{
            const beforeTest=cfg.codeWorkspace.inspect(proposalId);
            if(!operations.snapshot().history.some(row=>
               row.event.type==="code.activity"&&row.event.proposalId===proposalId)){
              operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
                actor:{kind:"system",id:"system:legacy-code-import"},
                event:{type:"code.activity",action:"imported",
                  proposalId,path:beforeTest.path,sourceSha256:beforeTest.sourceSha256,
                  replacementSha256:beforeTest.replacementSha256,
                  modelId:beforeTest.modelId,result:"legacy-unverified"}});
            }
          }catch{return json(res,503,{error:"Codevoorstel kan niet in de registratie worden opgenomen"})}
          let result;
          try{result=await cfg.codeWorkspace.runTests(proposalId)}
          catch{return json(res,409,{error:"Docker-test geweigerd: controleer voorstel, bron en testbestand"})}
          try{
            const inspected=cfg.codeWorkspace.inspect(proposalId);
            const journalSeq=recordCodeAction("tested",{id:proposalId,...inspected},result.status,result.testSha256);
            return json(res,200,{...result,journalSeq});
          }catch{return json(res,503,{error:"Docker-test uitgevoerd maar registratie mislukt. Controleer voorstel en operationslog."})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/apply"){
          requireIndependentCodeAction();
          if(actor.kind!=="person")throw new HttpError(403,"alleen personen kunnen codewijzigingen goedkeuren");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(k=>!["proposalId","expectedSha256","approve"].includes(k)))
            throw new HttpError(422,"Ongeldige goedkeuring");
          requireNoPendingCodeAction();
          const proposalId=(input as any).proposalId as string;
          // Import a legacy record BEFORE the file is changed.
          try{
            const pre=cfg.codeWorkspace.inspect(proposalId);
            if(!operations.snapshot().history.some(row=>
               row.event.type==="code.activity"&&row.event.proposalId===proposalId)){
              operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
                actor:{kind:"system",id:"system:legacy-code-import"},
                event:{type:"code.activity",action:"imported",proposalId,
                  path:pre.path,sourceSha256:pre.sourceSha256,
                  replacementSha256:pre.replacementSha256,modelId:pre.modelId,
                  result:"legacy-unverified"}});
            }
          }catch{return json(res,503,{error:"Registratie niet beschikbaar; code blijft ongewijzigd"})}
          try{
            const pre=cfg.codeWorkspace.inspect(proposalId);
            if((input as any).approve!==true||
               (input as any).expectedSha256!==pre.replacementSha256||!pre.canApply)
              return json(res,409,{error:"Codecontrole of goedkeuring is niet meer geldig"});
            recordCodeAction("apply-started",{id:proposalId,...pre},"pending");
          }catch{return json(res,503,{error:"Codewijziging niet gestart; de voorregistratie is mislukt"})}
          let applied;
          try{applied=cfg.codeWorkspace.apply(input as any,actor.id)}
          catch{return json(res,409,{error:"Codewijziging niet bevestigd. Bekijk de herstelstatus voordat je opnieuw probeert."})}
          try{
            const post=cfg.codeWorkspace.inspect(proposalId);
            const journalSeq=recordCodeAction("applied",{id:proposalId,...post},"applied");
            return json(res,200,{...applied,journalSeq});
          }catch{return json(res,503,{error:"Code is aangepast, maar registratie is mislukt. Controleer eerst de bestandsinhoud en het operationslog."})}
        }
        if(req.method==="POST"&&url.pathname==="/ops/code/restore"){
          requireIndependentCodeAction();
          if(actor.kind!=="person")throw new HttpError(403,"alleen personen kunnen code herstellen");
          if(!cfg.codeWorkspace)return json(res,503,{error:"Geen lokale codewerkmap ingesteld"});
          let input:unknown;
          try{input=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"Ongeldige JSON")}
          if(!input||typeof input!=="object"||Array.isArray(input)||
             Object.keys(input).some(k=>!["proposalId","expectedSha256","approve"].includes(k)))
            throw new HttpError(422,"Ongeldige herstelgoedkeuring");
          requireNoPendingCodeAction();
          const proposalId=(input as any).proposalId as string;
          try{
            const pre=cfg.codeWorkspace.inspect(proposalId);
            if(!operations.snapshot().history.some(row=>
               row.event.type==="code.activity"&&row.event.proposalId===proposalId)){
              operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
                actor:{kind:"system",id:"system:legacy-code-import"},
                event:{type:"code.activity",action:"imported",proposalId,
                  path:pre.path,sourceSha256:pre.sourceSha256,
                  replacementSha256:pre.replacementSha256,modelId:pre.modelId,
                  result:"legacy-unverified"}});
            }
          }catch{return json(res,503,{error:"Registratie niet beschikbaar; herstel niet gestart"})}
          try{
            const pre=cfg.codeWorkspace.inspect(proposalId);
            if((input as any).approve!==true||
               (input as any).expectedSha256!==pre.replacementSha256||!pre.canRestore)
              return json(res,409,{error:"Herstelcontrole of goedkeuring is niet meer geldig"});
            recordCodeAction("restore-started",{id:proposalId,...pre},"pending");
          }catch{return json(res,503,{error:"Herstel niet gestart; de voorregistratie is mislukt"})}
          let restored;
          try{restored=cfg.codeWorkspace.restore(input as any,actor.id)}
          catch{return json(res,409,{error:"Herstel niet bevestigd. Controleer eerst de openstaande herstelstatus."})}
          try{
            const post=cfg.codeWorkspace.inspect(proposalId);
            const journalSeq=recordCodeAction("restored",{id:proposalId,...post},"restored");
            return json(res,200,{...restored,journalSeq});
          }catch{return json(res,503,{error:"Bestand is hersteld maar registratie mislukt. Controleer de bestandsinhoud."})}
        }
        if (req.method === "GET" && url.pathname === "/ops/model") {
          return json(res,200,{
            configured:!!cfg.planningModel,
            modelId:cfg.planningModel?.id??null,
            role:"proposal-only",
            health:"not-checked",
          });
        }
        if (req.method === "GET" && url.pathname === "/ops/state") {
          try { return json(res, 200, readableOps()); }
          catch { return json(res, 503, { error: "operations journal changed or unavailable" }); }
        }
        if (req.method === "GET" && url.pathname === "/ops/production-line") {
          try {
            const integrity=operations.verify();
            if(!integrity.ok)return json(res,503,{error:"operations verification failed"});
            const current=readableOps();
            return json(res,200,productionLineView(current,
              builtinInventoryForState(current,cfg.repoSearchRoot),true));
          }catch{
            return json(res,503,{error:"production line unavailable"});
          }
        }
        if (req.method === "GET" && url.pathname === "/ops/queue") {
          try{return json(res,200,projectLocalQueue(readableOps()))}
          catch{return json(res,503,{error:"local queue unavailable"})}
        }
        if (req.method === "GET" && url.pathname === "/ops/catalog") {
          try { return json(res, 200, catalogOverview(readableOps())); }
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
        if(req.method==="POST"&&url.pathname==="/ops/plans/preflight"){
          if(actor.kind!=="person")throw new HttpError(403,"only people may inspect mission proposals");
          let raw:unknown;
          try{raw=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!raw||typeof raw!=="object"||Array.isArray(raw)||
             Object.keys(raw).some(k=>k!=="plan"&&k!=="missingInformation")||
             !Object.prototype.hasOwnProperty.call(raw,"plan"))
            throw new HttpError(422,"expected plan and optional missing information");
          try{
            const body=raw as {plan:MissionPlan;missingInformation?:string[]};
            validateMissionPlan(body.plan);
            const linked=[...new Set(body.plan.tasks.flatMap(task=>task.evidenceAtomIds??[]))];
            for(const atom of linked){
              if(!atoms.has(atom))throw new HttpError(422,"unknown evidence atom link");
              if(!canRead(principal,atom)||
                 Object.values(cfg.tokens).some(p=>canAudit(p)&&!canRead(p,atom)))
                throw new HttpError(403,"evidence atom link requires shared audit read access");
            }
            const state=operations.snapshot();
            return json(res,200,inspectMissionPlan(body.plan,{
              state,runtime:builtinInventoryForState(state,cfg.repoSearchRoot),
              missingInformation:body.missingInformation,
            }));
          }catch(e){
            if(e instanceof HttpError)throw e;
            throw new HttpError(422,"mission proposal needs correction before review");
          }
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
            const state=operations.snapshot();
            const preflight=inspectMissionPlan(proposal.plan,{
              state,runtime:builtinInventoryForState(state,cfg.repoSearchRoot),
              missingInformation:proposal.missingInformation,
            });
            return json(res,200,{...proposal,preflight});
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
        const replanProposal=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/replan\/propose$/.exec(url.pathname);
        if(req.method==="POST"&&replanProposal){
          if(actor.kind!=="person")throw new HttpError(403,"only a mission owner may propose revision");
          if(!cfg.planningModel?.proposeRevision)
            throw new HttpError(503,"local revision planner is not configured");
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||
             Object.keys(body).some(k=>k!=="reason"&&k!=="expectedRevision")||
             !Object.prototype.hasOwnProperty.call(body,"reason")||
             !Object.prototype.hasOwnProperty.call(body,"expectedRevision"))
            throw new HttpError(422,"expected revision and reason");
          const {reason,expectedRevision}=body as {reason:string;expectedRevision:number};
          if(typeof reason!=="string"||!reason.trim()||reason.length>600||
             !Number.isSafeInteger(expectedRevision))
            throw new HttpError(422,"invalid revision request");
          const before=operations.snapshot();
          const old=before.missions[replanProposal[1]];
          if(!old)throw new HttpError(404,"unknown mission");
          if(actor.id!==old.createdBy)throw new HttpError(403,"only mission owner can request revision");
          if(expectedRevision!==old.revision)throw new HttpError(409,"mission revision changed");
          let proposed:Awaited<ReturnType<typeof proposeMissionRevision>>;
          try{proposed=await proposeMissionRevision(old,cfg.planningModel,reason)}
          catch(e){
            if(/stale|invalid|revision|phase|plan|constraint|task|source|mission|guard|fields|dependenc|automation|running/.test(String(e)))
              throw new HttpError(422,"revision proposal requires correction");
            throw new HttpError(503,"local revision planner unavailable");
          }
          const after=operations.snapshot();
          if(after.missions[old.plan.id]?.revision!==expectedRevision||
             after.missions[old.plan.id]?.automation?.enabled||
             Object.values(after.missions[old.plan.id]?.tasks??{}).some(t=>t.status==="running"))
            throw new HttpError(409,"mission changed while proposal was being prepared");
          for(const atom of new Set(proposed.plan.tasks.flatMap(t=>t.evidenceAtomIds??[]))){
            if(!atoms.has(atom))throw new HttpError(422,"unknown evidence atom link");
            if(!canRead(principal,atom)||
               Object.values(cfg.tokens).some(p=>canAudit(p)&&!canRead(p,atom)))
              throw new HttpError(403,"evidence atom link requires shared audit read access");
          }
          const preflight=inspectMissionPlan(proposed.plan,{
            state:after,runtime:builtinInventoryForState(after,cfg.repoSearchRoot),
            missingInformation:proposed.missingInformation,
          });
          return json(res,200,{...proposed,preflight});
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
            const {missions}=readableOps();
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
        const missionExtend=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/extend$/.exec(url.pathname);
        if(req.method==="POST"&&missionExtend){
          if(actor.kind!=="person")throw new HttpError(403,"only the mission owner may approve a plan extension");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||
             Object.keys(body).some(k=>k!=="plan"&&k!=="expectedRevision")||
             !Object.prototype.hasOwnProperty.call(body,"plan")||
             !Object.prototype.hasOwnProperty.call(body,"expectedRevision"))
            throw new HttpError(422,"expected plan and revision");
          try{
            const {plan,expectedRevision}=body as {plan:MissionPlan;expectedRevision:number};
            validateMissionPlan(plan);
            if(plan.id!==missionExtend[1])throw new Error("mission id mismatch");
            for(const atom of new Set(plan.tasks.flatMap(t=>t.evidenceAtomIds??[]))){
              if(!atoms.has(atom))throw new HttpError(422,"unknown evidence atom link");
              if(!canRead(principal,atom)||
                 Object.values(cfg.tokens).some(p=>canAudit(p)&&!canRead(p,atom)))
                throw new HttpError(403,"evidence atom link requires shared audit read access");
            }
            const event={type:"mission.extend" as const,missionId:missionExtend[1],plan,expectedRevision};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId:plan.id,revision:expectedRevision+1,seq:entry.seq});
          }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(422,(e as Error).message)}
        }
        const verifyCi=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/release\/verify-ci$/.exec(url.pathname);
        if(req.method==="POST"&&verifyCi){
          if(actor.kind!=="person")throw new HttpError(403,"a person must request CI verification");
          requireWritableIntegrity();
          const body=(await readBody(req,Math.min(maxBodyBytes,256))).trim();
          if(body!=="{}")throw new HttpError(422,"CI verification takes no parameters");
          const missionId=verifyCi[1];
          const mission=operations.snapshot().missions[missionId];
          if(!mission)throw new HttpError(404,"unknown mission");
          if(!mission.releaseDossier||
             mission.releaseDossier.revision!==mission.revision||
             mission.releaseDossier.ciObservation)
            throw new HttpError(409,"no current release dossier awaiting CI verification");
          let observation:Awaited<ReturnType<typeof verifyGitHubActionsRun>>;
          try{
            observation=await verifyGitHubActionsRun(mission.releaseDossier.candidate,
              cfg.githubActionReader??fetch,cfg.githubReadToken);
          }catch{throw new HttpError(422,"GitHub Actions run could not be confirmed for this candidate")}
          // A GitHub call is asynchronous: verify that no new plan or
          // candidate was registered while the provider was responding.
          const updated=operations.snapshot().missions[missionId];
          if(!updated||updated.revision!==mission.revision||
             JSON.stringify(updated.releaseDossier)!==JSON.stringify(mission.releaseDossier))
            throw new HttpError(409,"release dossier changed during CI verification");
          try{
            const entry=operations.append({
              id:"ops-"+randomUUID(),at:new Date().toISOString(),
              actor:{kind:"check",id:"check:github-actions"},
              event:{type:"mission.release.ci.observe" as const,missionId,
                expectedRevision:mission.revision,observation},
            });
            return json(res,200,{observation,seq:entry.seq,publicationAllowed:false});
          }catch{throw new HttpError(409,"CI observation could not be saved")}
        }
        const verifyGitHubArtifact=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/release\/verify-github-artifact$/.exec(url.pathname);
        if(req.method==="POST"&&verifyGitHubArtifact){
          if(actor.kind!=="person")throw new HttpError(403,"a person must request GitHub artifact inspection");
          requireWritableIntegrity();
          let raw:unknown;
          try{raw=JSON.parse((await readBody(req,Math.min(maxBodyBytes,2048)))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!raw||typeof raw!=="object"||Array.isArray(raw)||
             Object.keys(raw).sort().join(",")!=="artifactName,entryPath")
            throw new HttpError(422,"supply artifact name and archive file path");
          const {artifactName,entryPath}=raw as Record<string,unknown>;
          const missionId=verifyGitHubArtifact[1];
          const before=operations.snapshot().missions[missionId];
          if(!before)throw new HttpError(404,"unknown mission");
          const dossier=before.releaseDossier;
          if(!dossier||dossier.revision!==before.revision||
             !dossier.ciObservation||dossier.githubArtifactObservation)
            throw new HttpError(409,"CI must be confirmed before checking one GitHub artifact");
          try{checkArtifactSelection(dossier.candidate,artifactName,entryPath)}
          catch{throw new HttpError(422,"invalid artifact or ZIP path for this candidate")}
          const prior=JSON.stringify(dossier);
          let observation:Awaited<ReturnType<typeof verifyGitHubRunArtifact>>;
          try{
            observation=await verifyGitHubRunArtifact(dossier,
              artifactName as string,entryPath as string,
              cfg.githubActionReader??fetch,cfg.githubReadToken);
          }catch{throw new HttpError(422,"GitHub artifact could not be matched and verified for this run")}
          const current=operations.snapshot().missions[missionId];
          if(!current||current.revision!==before.revision||
             JSON.stringify(current.releaseDossier)!==prior)
            throw new HttpError(409,"release dossier changed during artifact inspection");
          try{
            const entry=operations.append({
              id:"ops-"+randomUUID(),at:new Date().toISOString(),
              actor:{kind:"check",id:"check:github-artifact"},
              event:{type:"mission.release.github-artifact.observe" as const,
                missionId,expectedRevision:before.revision,observation},
            });
            return json(res,200,{observation,seq:entry.seq,
              origin:"artifact-uploaded-to-verified-github-run",
              publicationAllowed:false,buildReproducibilityVerified:false});
          }catch{throw new HttpError(409,"GitHub artifact observation could not be saved")}
        }
        const verifyArtifact=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/release\/verify-bytes$/.exec(url.pathname);
        if(req.method==="POST"&&verifyArtifact){
          if(actor.kind!=="person")throw new HttpError(403,"a person must supply the candidate file");
          requireWritableIntegrity();
          const missionId=verifyArtifact[1];
          const mission=operations.snapshot().missions[missionId];
          if(!mission)throw new HttpError(404,"unknown mission");
          const dossier=mission.releaseDossier;
          if(!dossier||dossier.revision!==mission.revision||
             dossier.artifactObservation)
            throw new HttpError(409,"no current release artifact awaiting byte verification");
          const submittedRevision=req.headers["x-eai-mission-revision"];
          if(submittedRevision!==String(mission.revision))
            throw new HttpError(409,"candidate revision has changed");
          const expectedName=dossier.candidate.artifactPath.split("/").at(-1)!;
          try{preflightArtifactUpload(req,maxArtifactBytes,expectedName)}
          catch(error){
            if(error instanceof ArtifactInputError)throw new HttpError(413,"artifact file is empty or too large");
            throw new HttpError(422,"artifact filename or content type invalid");
          }
          const before=JSON.stringify(dossier);
          let measured:Awaited<ReturnType<typeof measureArtifactBytes>>;
          try{measured=await measureArtifactBytes(req,maxArtifactBytes)}
          catch(error){
            if(error instanceof ArtifactInputError)
              throw new HttpError(error.code==="too-large"?413:422,"artifact bytes unavailable or outside limit");
            throw new HttpError(422,"artifact byte inspection failed");
          }
          if(measured.sha256.toLowerCase()!==dossier.candidate.artifactSha256.toLowerCase())
            throw new HttpError(422,"artifact SHA-256 does not match candidate");
          const current=operations.snapshot().missions[missionId];
          if(!current||current.revision!==mission.revision||
             JSON.stringify(current.releaseDossier)!==before)
            throw new HttpError(409,"release dossier changed while checking artifact");
          const observation={source:"local-file-upload" as const,
            sha256:measured.sha256,sizeBytes:measured.sizeBytes,
            artifactPath:dossier.candidate.artifactPath,
            checkedAt:new Date().toISOString(),checkedBy:actor.id};
          try{
            const entry=operations.append({
              id:"ops-"+randomUUID(),at:new Date().toISOString(),
              actor:{kind:"check",id:"check:artifact-bytes"},
              event:{type:"mission.release.artifact.observe" as const,
                missionId,expectedRevision:mission.revision,observation},
            });
            return json(res,200,{observation,seq:entry.seq,publicationAllowed:false,
              originVerified:false});
          }catch{throw new HttpError(409,"artifact observation could not be saved")}
        }
        const releaseRoute=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/release\/(submit|review)$/.exec(url.pathname);
        if(req.method==="POST"&&releaseRoute){
          if(actor.kind!=="person")throw new HttpError(403,"release dossier requires a person");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body))
            throw new HttpError(422,"expected release dossier request");
          const obj=body as Record<string,unknown>;
          const action=releaseRoute[2],missionId=releaseRoute[1];
          const validKeys=action==="submit"?
            ["candidate","expectedRevision"]:["decision","expectedRevision","reason"];
          if(Object.keys(obj).some(k=>!validKeys.includes(k))||
             validKeys.some(k=>!Object.prototype.hasOwnProperty.call(obj,k))||
             !Number.isSafeInteger(obj.expectedRevision))
            throw new HttpError(422,"release request fields invalid");
          const current=operations.snapshot(),mission=current.missions[missionId];
          if(!mission)throw new HttpError(404,"unknown mission");
          if(obj.expectedRevision!==mission.revision)
            throw new HttpError(409,"mission has changed");
          if(action==="submit"&&actor.id!==mission.createdBy)
            throw new HttpError(403,"only the mission creator can submit");
          if(action==="review"&&actor.id===mission.createdBy)
            throw new HttpError(403,"a separate person must review the dossier");
          // No automatic release can be derived from a user-supplied CI URL.
          if(action==="submit"&&Object.values(current.defects).some(d=>
             ["open","human-required"].includes(d.state)&&
             Object.values(mission.tasks).some(t=>t.run?.workerId===d.workerId)))
            throw new HttpError(422,"unresolved worker defects block a release dossier");
          const event=action==="submit"?
            {type:"mission.release.submit" as const,missionId,
              expectedRevision:obj.expectedRevision as number,
              candidate:obj.candidate as import("../../operations/src/missions.ts").ReleaseCandidate}:
            {type:"mission.release.review" as const,missionId,
              expectedRevision:obj.expectedRevision as number,
              decision:obj.decision as "changes-requested"|"external-verification-needed",
              reason:obj.reason as string};
          try{
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId,revision:mission.revision,seq:entry.seq,
              publicationAllowed:false,verification:"not-verified"});
          }catch(e){throw new HttpError(422,(e as Error).message)}
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
             (!Object.prototype.hasOwnProperty.call(body,"maxStarts") ||
               Object.keys(body).some(k=>k!=="maxStarts"&&k!=="resumeAfterRestart"&&k!=="executionMode") ||
               ("executionMode" in body &&
                !["local-scheduler","remote-text"].includes(
                  (body as {executionMode:string}).executionMode)) ||
               ("resumeAfterRestart" in body &&
                typeof (body as {resumeAfterRestart?:unknown}).resumeAfterRestart!=="boolean")))
            throw new HttpError(422,"expected automatic task budget");
          if(action==="stop"&&Object.keys(body).length)
            throw new HttpError(422,"stop requires an empty request");
          try{
            const event=action==="start"?
              {type:"mission.automation.start" as const,missionId,
                maxStarts:(body as {maxStarts:number}).maxStarts,
                ...("executionMode" in body?
                  {executionMode:(body as {executionMode:"local-scheduler"|"remote-text"}).executionMode}:{}),
                ...("resumeAfterRestart" in body?
                  {resumeAfterRestart:(body as {resumeAfterRestart:boolean}).resumeAfterRestart}:{})}:
              {type:"mission.automation.stop" as const,missionId,reason:"user-stopped" as const};
            const entry=operations.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),actor,event});
            return json(res,201,{missionId,action,seq:entry.seq,automation:operations.snapshot().missions[missionId].automation});
          }catch(e){throw new HttpError(422,(e as Error).message)}
        }
        const parallelLocal=/^\/ops\/missions\/([a-z][a-z0-9-]{2,63})\/parallel\/run$/.exec(url.pathname);
        if(req.method==="POST"&&parallelLocal){
          if(actor.kind!=="person")throw new HttpError(403,"only people can start parallel local work");
          requireWritableIntegrity();
          let body:unknown;
          try{body=JSON.parse((await readBody(req,maxBodyBytes))||"{}")}
          catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,"invalid JSON")}
          if(!body||typeof body!=="object"||Array.isArray(body)||
             Object.keys(body).some(k=>k!=="maxParallel")||
             !Number.isInteger((body as {maxParallel?:unknown}).maxParallel)||
             ![1,2].includes((body as {maxParallel:number}).maxParallel))
            throw new HttpError(422,"parallel local work accepts maxParallel 1 or 2 only");
          try{
            return json(res,200,await runParallelPureText(operations,parallelLocal[1],
              (body as {maxParallel:number}).maxParallel));
          }catch(e){
            if(/unknown mission/.test(String(e)))throw new HttpError(404,"unknown mission");
            if(/capacity exhausted|already started|claimed work/.test(String(e)))
              throw new HttpError(409,"parallel local work is already in progress");
            if(/pause|automatic|worker|timeout|capacity|unsupported/.test(String(e)))
              throw new HttpError(422,"parallel local execution is not allowed");
            throw new HttpError(503,"parallel local worker could not finish safely");
          }
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
          if ((raw as any).type==="code.activity")throw new HttpError(403,"code history must originate from the controlled code routes");
          if (["mission.create","mission.extend","mission.release.submit","mission.release.review","mission.release.ci.observe","mission.release.artifact.observe","mission.release.github-artifact.observe","mission.pause","mission.resume","mission.gate.resolve","task.started","task.lease.claim","task.lease.renew","task.lease.expire","task.completed","task.failed","task.retry","task.recover","mission.automation.start","mission.automation.stop"].includes((raw as any).type)) {
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
            event = { id: eventId, at: today(), actor, type: "evidence.attached", atom: raw.atom, evidence: canonicalEvidence(raw.evidence, actor, eventId, new Set(sourcesFor(principal).map((source) => source.id))) };
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
            basis: { reads: basis.reads, sources: atomDef.worker.sources ?? [], capsuleSha256: result.capsuleSha256 },
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

        let verdict;
        try {
          verdict = runCheck(id, actor);
        } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(500, "deterministic check failed", false);
        }
        if (!verdict.passed) return json(res, 422, { passed: false });
        const line = verdict.line;
        if (!line) return json(res, 201, { passed: true });
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
        // The footing of a check or a model proposal may name atoms this reader cannot see.
        const readable = (reads: Record<string, string | null>) =>
          Object.fromEntries(Object.entries(reads).filter(([atom]) => visible.has(atom)));
        const citable = new Set(sourcesFor(principal).map((source) => source.id));
        const answerBasis = r.state[id]?.answerBasis;
        return json(res, 200, {
          atom: id,
          ...(r.derived[id] ?? derive(undefined, snapshotDate)),
          evidence: (r.state[id]?.evidence ?? []).map((e) =>
            e.basis ? { ...e, basis: {
              reads: readable(e.basis.reads),
              ...(e.basis.sources ? { sources: e.basis.sources.filter((source) => citable.has(source)) } : {}),
            } } : e),
          flags: r.state[id]?.flags ?? [],
          answeredBy: r.state[id]?.answeredBy ?? null,
          answerBasis: answerBasis ? { ...answerBasis, reads: readable(answerBasis.reads) } : null,
          lowered: r.state[id]?.lowered ?? [],
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
    githubReadToken:process.env.EAI_GITHUB_READ_TOKEN,
    pack: JSON.parse(readFileSync(process.env.EAI_PACK ?? "packs/sow-demo/pack.json", "utf8")),
    tokens: JSON.parse(readFileSync(tokenFile, "utf8")),
    witness,
  });
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.EAI_HOST ?? "127.0.0.1";
  server.listen(port, host, () => console.log(`EAI server on http://${host}:${port}`));
}
