import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Actor, EaiEvent } from "../../core/src/index.ts";

interface Line { seq: number; prev: string; hash: string; event: EaiEvent }
export interface Rejection {
  at: string;
  actor: Actor;
  attempted: unknown;
  reason: string;
}
interface RejectionLine { seq: number; prev: string; hash: string; rejection: Rejection }

const GENESIS = "0".repeat(64);
const digest = (prev: string, payload: unknown) =>
  createHash("sha256").update(prev + JSON.stringify(payload)).digest("hex");
const linesFrom = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

/** Append-only logs; every line commits to the previous one, so edits, deletions and truncation are detectable. */
export class Store {
  private file: string;
  private rejectionFile: string;
  lines: Line[] = [];
  rejectionLines: RejectionLine[] = [];

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "events.jsonl");
    this.rejectionFile = join(dir, "rejections.jsonl");
    this.lines = linesFrom<Line>(this.file);
    this.rejectionLines = linesFrom<RejectionLine>(this.rejectionFile);
  }

  get events(): EaiEvent[] { return this.lines.map((l) => l.event); }
  get rejections(): Rejection[] { return this.rejectionLines.map((l) => l.rejection); }
  next(): number { return this.lines.length + 1; }

  append(event: EaiEvent): Line {
    const prev = this.lines.at(-1)?.hash ?? GENESIS;
    const line: Line = { seq: this.next(), prev, hash: digest(prev, event), event };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
    this.lines.push(line);
    return line;
  }

  recordRejection(rejection: Rejection): RejectionLine {
    const prev = this.rejectionLines.at(-1)?.hash ?? GENESIS;
    const line: RejectionLine = {
      seq: this.rejectionLines.length + 1,
      prev,
      hash: digest(prev, rejection),
      rejection,
    };
    appendFileSync(this.rejectionFile, JSON.stringify(line) + "\n");
    this.rejectionLines.push(line);
    return line;
  }

  verify(): { ok: boolean; badAt?: number; log?: "events" | "rejections" } {
    let events: Line[];
    let rejections: RejectionLine[];
    try {
      events = linesFrom<Line>(this.file);
      rejections = linesFrom<RejectionLine>(this.rejectionFile);
    } catch {
      return { ok: false, badAt: 1, log: "events" };
    }

    const verifyChain = <T extends { seq: number; prev: string; hash: string }>(
      disk: T[],
      cached: T[],
      payload: (line: T) => unknown,
      log: "events" | "rejections",
    ): { ok: boolean; badAt?: number; log?: "events" | "rejections" } => {
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
      if (disk.length !== cached.length || diskHead !== cachedHead) {
        return { ok: false, badAt: Math.min(disk.length, cached.length) + 1, log };
      }
      return { ok: true };
    };

    const eventResult = verifyChain(events, this.lines, (line) => line.event, "events");
    if (!eventResult.ok) return eventResult;
    return verifyChain(rejections, this.rejectionLines, (line) => line.rejection, "rejections");
  }
}
