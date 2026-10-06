import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Actor, EaiEvent } from "../../core/src/index.ts";
import type { AnchorVerifier, AnchorWitness } from "./witness.ts";

interface Line { seq: number; prev: string; hash: string; event: EaiEvent }
export interface Rejection {
  at: string;
  actor: Actor;
  attempted: unknown;
  reason: string;
}
interface RejectionLine { seq: number; prev: string; hash: string; rejection: Rejection }
export interface Anchor { seq: number; hash: string }

const GENESIS = "0".repeat(64);
const emptyAnchor = (): Anchor => ({ seq: 0, hash: GENESIS });
const digest = (prev: string, payload: unknown) =>
  createHash("sha256").update(prev + JSON.stringify(payload)).digest("hex");
const linesFrom = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const anchorFrom = (file: string): Anchor =>
  existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : emptyAnchor();
const fingerprint = (file: string) => {
  if (!existsSync(file)) return "missing";
  const s = statSync(file);
  return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
};

/** Append-only logs plus sidecar head anchors so suffix deletion remains detectable after restart. */
export class Store {
  private file: string;
  private rejectionFile: string;
  private eventHeadFile: string;
  private rejectionHeadFile: string;
  private expectedEventHead: Anchor;
  private expectedRejectionHead: Anchor;
  private witness?: AnchorVerifier;
  private verifiedFingerprints = new Map<string, string>();
  private hasVerifiedBaseline = false;
  lines: Line[] = [];
  rejectionLines: RejectionLine[] = [];

  constructor(dir: string, witness?: AnchorVerifier) {
    mkdirSync(dir, { recursive: true });
    this.witness = witness;
    this.file = join(dir, "events.jsonl");
    this.rejectionFile = join(dir, "rejections.jsonl");
    this.eventHeadFile = join(dir, "events.head");
    this.rejectionHeadFile = join(dir, "rejections.head");
    this.lines = linesFrom<Line>(this.file);
    this.rejectionLines = linesFrom<RejectionLine>(this.rejectionFile);
    this.expectedEventHead = anchorFrom(this.eventHeadFile);
    this.expectedRejectionHead = anchorFrom(this.rejectionHeadFile);
  }

  get events(): EaiEvent[] { return this.lines.map((l) => l.event); }
  get rejections(): Rejection[] { return this.rejectionLines.map((l) => l.rejection); }
  next(): number { return this.lines.length + 1; }

  private trackedFiles() {
    return [this.file, this.rejectionFile, this.eventHeadFile, this.rejectionHeadFile];
  }

  private refreshVerifiedFingerprints(): void {
    for (const file of this.trackedFiles()) this.verifiedFingerprints.set(file, fingerprint(file));
  }

  private localFilesUnchanged(): boolean {
    if (!this.hasVerifiedBaseline) return false;
    return this.trackedFiles().every((file) => this.verifiedFingerprints.get(file) === fingerprint(file));
  }

  private writeAnchor(file: string, anchor: Anchor): void {
    writeFileSync(file, JSON.stringify(anchor) + "\n");
  }

  private invalidateBaseline(message: string): never {
    this.hasVerifiedBaseline = false;
    throw new Error(message);
  }

  private assertVerifiedBaselineUnchanged(): void {
    if (!this.hasVerifiedBaseline) return;
    for (const file of this.trackedFiles()) {
      if (this.verifiedFingerprints.get(file) !== fingerprint(file)) {
        this.invalidateBaseline("tracked store file changed outside the verified write path");
      }
    }
  }

  private acceptOwnWrite(changedFiles: string[]): void {
    if (!this.hasVerifiedBaseline) return;
    const changed = new Set(changedFiles);

    for (const file of this.trackedFiles()) {
      if (changed.has(file)) continue;
      if (this.verifiedFingerprints.get(file) !== fingerprint(file)) {
        this.invalidateBaseline("tracked store file changed while committing a local write");
      }
    }

    for (const file of changed) this.verifiedFingerprints.set(file, fingerprint(file));
  }

  append(event: EaiEvent): Line {
    this.assertVerifiedBaselineUnchanged();
    const prev = this.lines.at(-1)?.hash ?? GENESIS;
    const line: Line = { seq: this.next(), prev, hash: digest(prev, event), event };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
    this.lines.push(line);
    this.expectedEventHead = { seq: line.seq, hash: line.hash };
    this.writeAnchor(this.eventHeadFile, this.expectedEventHead);
    if (this.witness && "record" in this.witness) {
      (this.witness as AnchorWitness).record("events", this.expectedEventHead);
    }
    this.acceptOwnWrite([this.file, this.eventHeadFile]);
    return line;
  }

  recordRejection(rejection: Rejection): RejectionLine {
    this.assertVerifiedBaselineUnchanged();
    const prev = this.rejectionLines.at(-1)?.hash ?? GENESIS;
    const line: RejectionLine = {
      seq: this.rejectionLines.length + 1,
      prev,
      hash: digest(prev, rejection),
      rejection,
    };
    appendFileSync(this.rejectionFile, JSON.stringify(line) + "\n");
    this.rejectionLines.push(line);
    this.expectedRejectionHead = { seq: line.seq, hash: line.hash };
    this.writeAnchor(this.rejectionHeadFile, this.expectedRejectionHead);
    if (this.witness && "record" in this.witness) {
      (this.witness as AnchorWitness).record("rejections", this.expectedRejectionHead);
    }
    this.acceptOwnWrite([this.rejectionFile, this.rejectionHeadFile]);
    return line;
  }

  /** Full replay-grade verification. Use at startup, for audits and after external file changes. */
  verify(): { ok: boolean; badAt?: number; log?: "events" | "rejections"; reason?: string } {
    let events: Line[];
    let rejections: RejectionLine[];
    let eventAnchor: Anchor;
    let rejectionAnchor: Anchor;
    try {
      events = linesFrom<Line>(this.file);
      rejections = linesFrom<RejectionLine>(this.rejectionFile);
      eventAnchor = anchorFrom(this.eventHeadFile);
      rejectionAnchor = anchorFrom(this.rejectionHeadFile);
    } catch {
      return { ok: false, badAt: 1, log: "events" };
    }

    const verifyChain = <T extends { seq: number; prev: string; hash: string }>(
      disk: T[],
      cached: T[],
      payload: (line: T) => unknown,
      anchor: Anchor,
      expectedAnchor: Anchor,
      log: "events" | "rejections",
    ): { ok: boolean; badAt?: number; log?: "events" | "rejections"; reason?: string } => {
      let prev = GENESIS;
      for (let i = 0; i < disk.length; i++) {
        const line = disk[i];
        if (line.prev !== prev || line.hash !== digest(prev, payload(line)) || line.seq !== i + 1) {
          return { ok: false, badAt: line.seq || i + 1, log };
        }
        prev = line.hash;
      }
      const diskHead = disk.at(-1)?.hash ?? GENESIS;
      const cachedHead = cached.at(-1)?.hash ?? GENESIS;
      if (anchor.seq !== expectedAnchor.seq || anchor.hash !== expectedAnchor.hash) {
        return { ok: false, badAt: Math.min(anchor.seq, expectedAnchor.seq) + 1, log };
      }
      if (disk.length !== anchor.seq || diskHead !== anchor.hash) {
        return { ok: false, badAt: Math.min(disk.length, anchor.seq) + 1, log };
      }
      if (disk.length !== cached.length || diskHead !== cachedHead) {
        return { ok: false, badAt: Math.min(disk.length, cached.length) + 1, log };
      }
      return { ok: true };
    };

    const eventResult = verifyChain(
      events, this.lines, (line) => line.event, eventAnchor, this.expectedEventHead, "events",
    );
    if (!eventResult.ok) return eventResult;
    if (this.witness) {
      const witnessed = this.witness.verify("events", eventAnchor);
      if (!witnessed.ok) return { ok: false, badAt: eventAnchor.seq || 1, log: "events", reason: witnessed.reason };
    }

    const rejectionResult = verifyChain(
      rejections, this.rejectionLines, (line) => line.rejection,
      rejectionAnchor, this.expectedRejectionHead, "rejections",
    );
    if (!rejectionResult.ok) return rejectionResult;
    if (this.witness) {
      const witnessed = this.witness.verify("rejections", rejectionAnchor);
      if (!witnessed.ok) return { ok: false, badAt: rejectionAnchor.seq || 1, log: "rejections", reason: witnessed.reason };
    }

    this.hasVerifiedBaseline = true;
    this.refreshVerifiedFingerprints();
    return { ok: true };
  }

  /**
   * Fast fail-closed verification for the request path.
   * It is O(1) while files match the last full verification/accepted local write.
   * Any external file change falls back to full verification.
   */
  verifyCurrent(): { ok: boolean; badAt?: number; log?: "events" | "rejections"; reason?: string } {
    if (!this.localFilesUnchanged()) return this.verify();

    if (this.witness) {
      const eventWitness = this.witness.verifyCurrent("events", this.expectedEventHead);
      if (!eventWitness.ok) {
        return { ok: false, badAt: this.expectedEventHead.seq || 1, log: "events", reason: eventWitness.reason };
      }
      const rejectionWitness = this.witness.verifyCurrent("rejections", this.expectedRejectionHead);
      if (!rejectionWitness.ok) {
        return { ok: false, badAt: this.expectedRejectionHead.seq || 1, log: "rejections", reason: rejectionWitness.reason };
      }
    }
    return { ok: true };
  }

  bootstrapWitness(witness: AnchorWitness): { ok: boolean; badAt?: number; log?: "events" | "rejections"; reason?: string } {
    if (this.witness) throw new Error("witness already configured");
    const local = this.verify();
    if (!local.ok) return local;
    witness.record("events", this.expectedEventHead);
    witness.record("rejections", this.expectedRejectionHead);
    this.witness = witness;
    return this.verify();
  }
}
