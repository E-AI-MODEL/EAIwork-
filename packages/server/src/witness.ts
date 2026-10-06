import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { join } from "node:path";

export type WitnessLog = "events" | "rejections";
export interface Anchor { seq: number; hash: string }

export interface AnchorVerifier {
  /** Full journal verification. Used at startup, audit and CLI verification. */
  verify(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string };
  /** O(1) when the already-verified journal file has not changed externally. */
  verifyCurrent(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string };
}

export interface AnchorWitness extends AnchorVerifier {
  record(log: WitnessLog, anchor: Anchor): void;
}

interface SignedEnvelope {
  version: 1;
  log: WitnessLog;
  seq: number;
  hash: string;
  keyId: string;
  prevWitness: string;
  signature: string;
}

interface JournalCache {
  fingerprint: string;
  last?: SignedEnvelope;
  lastLineDigest: string;
}

const WITNESS_GENESIS = "0".repeat(64);
const payload = (envelope: Omit<SignedEnvelope, "signature">) => JSON.stringify(envelope);
const lineDigest = (line: string) => createHash("sha256").update(line).digest("hex");
const fingerprint = (file: string) => {
  if (!existsSync(file)) return "missing";
  const s = statSync(file);
  return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
};

export class SignedFileAnchorVerifier implements AnchorVerifier {
  protected dir: string;
  protected publicKey: ReturnType<typeof createPublicKey>;
  protected keyId: string;
  private cache = new Map<WitnessLog, JournalCache>();

  constructor(dir: string, publicKeyPem: string) {
    this.dir = dir;
    this.publicKey = createPublicKey(publicKeyPem);
    const exported = this.publicKey.export({ type: "spki", format: "pem" }).toString();
    this.keyId = createHash("sha256").update(exported).digest("hex").slice(0, 16);
  }

  protected file(log: WitnessLog) { return join(this.dir, `${log}.anchor.witness.jsonl`); }

  protected scanJournal(log: WitnessLog): { ok: true; cache: JournalCache } | { ok: false; reason: string } {
    const file = this.file(log);
    if (!existsSync(file)) {
      const cache = { fingerprint: "missing", lastLineDigest: WITNESS_GENESIS };
      this.cache.set(log, cache);
      return { ok: true, cache };
    }

    try {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      let previousWitness = WITNESS_GENESIS;
      let previousSeq: number | undefined;
      let last: SignedEnvelope | undefined;

      for (const line of lines) {
        const envelope = JSON.parse(line) as SignedEnvelope;
        if (
          envelope.version !== 1 ||
          envelope.log !== log ||
          envelope.keyId !== this.keyId ||
          envelope.prevWitness !== previousWitness ||
          !Number.isInteger(envelope.seq) ||
          envelope.seq < 0 ||
          typeof envelope.hash !== "string"
        ) return { ok: false, reason: `invalid witness journal structure for ${log}` };

        if (previousSeq !== undefined && envelope.seq !== previousSeq + 1) {
          return { ok: false, reason: `non-monotonic witness sequence for ${log}` };
        }

        const unsigned = {
          version: envelope.version,
          log: envelope.log,
          seq: envelope.seq,
          hash: envelope.hash,
          keyId: envelope.keyId,
          prevWitness: envelope.prevWitness,
        } as const;
        const validSignature = verify(
          null,
          Buffer.from(payload(unsigned)),
          this.publicKey,
          Buffer.from(envelope.signature, "base64"),
        );
        if (!validSignature) return { ok: false, reason: `invalid witness signature for ${log}` };

        previousWitness = lineDigest(line);
        previousSeq = envelope.seq;
        last = envelope;
      }

      const cache: JournalCache = {
        fingerprint: fingerprint(file),
        last,
        lastLineDigest: previousWitness,
      };
      this.cache.set(log, cache);
      return { ok: true, cache };
    } catch {
      return { ok: false, reason: `unreadable external witness for ${log}` };
    }
  }

  private matchesAnchor(cache: JournalCache, log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string } {
    if (!cache.last) {
      return anchor.seq === 0
        ? { ok: true }
        : { ok: false, reason: `missing external witness for ${log}` };
    }
    if (cache.last.seq !== anchor.seq || cache.last.hash !== anchor.hash) {
      return { ok: false, reason: `external witness does not match ${log} head` };
    }
    return { ok: true };
  }

  private currentCache(log: WitnessLog): { ok: true; cache: JournalCache } | { ok: false; reason: string } {
    const cached = this.cache.get(log);
    if (!cached) return this.scanJournal(log);
    if (fingerprint(this.file(log)) !== cached.fingerprint) return this.scanJournal(log);
    return { ok: true, cache: cached };
  }

  verify(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string } {
    const scanned = this.scanJournal(log);
    if (!scanned.ok) return scanned;
    return this.matchesAnchor(scanned.cache, log, anchor);
  }

  verifyCurrent(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string } {
    const current = this.currentCache(log);
    if (!current.ok) return current;
    return this.matchesAnchor(current.cache, log, anchor);
  }

  protected cachedJournal(log: WitnessLog) {
    return this.currentCache(log);
  }

  protected updateCacheAfterAppend(log: WitnessLog, line: string, envelope: SignedEnvelope) {
    this.cache.set(log, {
      fingerprint: fingerprint(this.file(log)),
      last: envelope,
      lastLineDigest: lineDigest(line),
    });
  }
}

export class SignedFileAnchorWitness extends SignedFileAnchorVerifier implements AnchorWitness {
  private privateKey: ReturnType<typeof createPrivateKey>;

  constructor(dir: string, privateKeyPem: string, publicKeyPem: string) {
    super(dir, publicKeyPem);
    mkdirSync(dir, { recursive: true });
    this.privateKey = createPrivateKey(privateKeyPem);
    const probe = Buffer.from("eai-witness-key-pair-check");
    const probeSignature = sign(null, probe, this.privateKey);
    if (!verify(null, probe, this.publicKey, probeSignature)) {
      throw new Error("witness private/public key pair does not match");
    }
  }

  record(log: WitnessLog, anchor: Anchor): void {
    const current = this.cachedJournal(log);
    if (!current.ok) throw new Error(current.reason);
    if (current.cache.last && anchor.seq === current.cache.last.seq && anchor.hash === current.cache.last.hash) {
      return;
    }
    if (current.cache.last && anchor.seq !== current.cache.last.seq + 1) {
      throw new Error(`witness sequence must advance by one for ${log}`);
    }

    const unsigned = {
      version: 1 as const,
      log,
      seq: anchor.seq,
      hash: anchor.hash,
      keyId: this.keyId,
      prevWitness: current.cache.lastLineDigest,
    };
    const envelope: SignedEnvelope = {
      ...unsigned,
      signature: sign(null, Buffer.from(payload(unsigned)), this.privateKey).toString("base64"),
    };
    const line = JSON.stringify(envelope);
    appendFileSync(this.file(log), line + "\n", { encoding: "utf8", mode: 0o600 });
    this.updateCacheAfterAppend(log, line, envelope);
  }
}
