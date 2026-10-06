import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { join } from "node:path";

export type WitnessLog = "events" | "rejections";
export interface Anchor { seq: number; hash: string }

export interface AnchorVerifier {
  verify(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string };
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

const WITNESS_GENESIS = "0".repeat(64);
const payload = (envelope: Omit<SignedEnvelope, "signature">) => JSON.stringify(envelope);
const lineDigest = (line: string) => createHash("sha256").update(line).digest("hex");

export class SignedFileAnchorVerifier implements AnchorVerifier {
  protected dir: string;
  protected publicKey: ReturnType<typeof createPublicKey>;
  protected keyId: string;

  constructor(dir: string, publicKeyPem: string) {
    this.dir = dir;
    this.publicKey = createPublicKey(publicKeyPem);
    const exported = this.publicKey.export({ type: "spki", format: "pem" }).toString();
    this.keyId = createHash("sha256").update(exported).digest("hex").slice(0, 16);
  }

  protected file(log: WitnessLog) { return join(this.dir, `${log}.anchor.witness.jsonl`); }

  protected readAndVerifyJournal(log: WitnessLog): { ok: true; lines: string[]; last?: SignedEnvelope } | { ok: false; reason: string } {
    const file = this.file(log);
    if (!existsSync(file)) return { ok: true, lines: [] };

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
      return { ok: true, lines, last };
    } catch {
      return { ok: false, reason: `unreadable external witness for ${log}` };
    }
  }

  verify(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string } {
    const journal = this.readAndVerifyJournal(log);
    if (!journal.ok) return journal;
    if (!journal.last) {
      return anchor.seq === 0
        ? { ok: true }
        : { ok: false, reason: `missing external witness for ${log}` };
    }
    if (journal.last.seq !== anchor.seq || journal.last.hash !== anchor.hash) {
      return { ok: false, reason: `external witness does not match ${log} head` };
    }
    return { ok: true };
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
    const journal = this.readAndVerifyJournal(log);
    if (!journal.ok) throw new Error(journal.reason);
    if (journal.last && anchor.seq === journal.last.seq && anchor.hash === journal.last.hash) {
      return;
    }
    if (journal.last && anchor.seq !== journal.last.seq + 1) {
      throw new Error(`witness sequence must advance by one for ${log}`);
    }

    const prevWitness = journal.lines.length
      ? lineDigest(journal.lines.at(-1)!)
      : WITNESS_GENESIS;
    const unsigned = {
      version: 1 as const,
      log,
      seq: anchor.seq,
      hash: anchor.hash,
      keyId: this.keyId,
      prevWitness,
    };
    const envelope: SignedEnvelope = {
      ...unsigned,
      signature: sign(null, Buffer.from(payload(unsigned)), this.privateKey).toString("base64"),
    };
    appendFileSync(this.file(log), JSON.stringify(envelope) + "\n", { encoding: "utf8", mode: 0o600 });
  }
}
