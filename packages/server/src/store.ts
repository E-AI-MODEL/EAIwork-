import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EaiEvent } from "../../core/src/index.ts";

interface Line { seq: number; prev: string; hash: string; event: EaiEvent }
const GENESIS = "0".repeat(64);
const h = (prev: string, ev: EaiEvent) => createHash("sha256").update(prev + JSON.stringify(ev)).digest("hex");

/** Append-only log; each line commits to the previous one, so edits or deletions are detectable. */
export class Store {
  private file: string;
  lines: Line[] = [];
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "events.jsonl");
    if (existsSync(this.file)) this.lines = readFileSync(this.file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }
  get events(): EaiEvent[] { return this.lines.map((l) => l.event); }
  next(): number { return this.lines.length + 1; }
  append(event: EaiEvent): Line {
    const prev = this.lines.at(-1)?.hash ?? GENESIS;
    const line: Line = { seq: this.next(), prev, hash: h(prev, event), event };
    appendFileSync(this.file, JSON.stringify(line) + "\n");
    this.lines.push(line);
    return line;
  }
  verify(): { ok: boolean; badAt?: number } {
    let prev = GENESIS;
    for (const l of this.lines) {
      if (l.prev !== prev || l.hash !== h(prev, l.event) || l.seq !== this.lines.indexOf(l) + 1) return { ok: false, badAt: l.seq };
      prev = l.hash;
    }
    return { ok: true };
  }
}
