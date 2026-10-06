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
  signature: string;
}

const payload = (log: WitnessLog, anchor: Anchor) =>
  JSON.stringify({ version: 1, log, seq: anchor.seq, hash: anchor.hash });

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

  verify(log: WitnessLog, anchor: Anchor): { ok: boolean; reason?: string } {
    const file = this.file(log);
    if (!existsSync(file)) {
      return anchor.seq === 0
        ? { ok: true }
        : { ok: false, reason: `missing external witness for ${log}` };
    }

    try {
      const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
      const envelope = JSON.parse(lines.at(-1) ?? "{}") as SignedEnvelope;
      if (
        envelope.version !== 1 ||
        envelope.log !== log ||
        envelope.seq !== anchor.seq ||
        envelope.hash !== anchor.hash ||
        envelope.keyId !== this.keyId
      ) return { ok: false, reason: `external witness does not match ${log} head` };

      const ok = verify(
        null,
        Buffer.from(payload(log, anchor)),
        this.publicKey,
        Buffer.from(envelope.signature, "base64"),
      );
      return ok ? { ok: true } : { ok: false, reason: `invalid external witness signature for ${log}` };
    } catch {
      return { ok: false, reason: `unreadable external witness for ${log}` };
    }
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
    const body = payload(log, anchor);
    const envelope: SignedEnvelope = {
      version: 1,
      log,
      seq: anchor.seq,
      hash: anchor.hash,
      keyId: this.keyId,
      signature: sign(null, Buffer.from(body), this.privateKey).toString("base64"),
    };
    appendFileSync(this.file(log), JSON.stringify(envelope) + "\n", { encoding: "utf8", mode: 0o600 });
  }
}
