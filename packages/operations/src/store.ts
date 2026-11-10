/**
 * Early operations journal. This is distinct from the signed evidence log in
 * packages/server. Its local hash chain detects accidental corruption, but is
 * NOT independently witnessed or crash-transactional. Do not describe it as a
 * production audit log.
 */
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { applyOps, emptyOps, type OpsEnvelope, type OpsState } from "./registry.ts";

interface Line { seq: number; prev: string; hash: string; payload: OpsEnvelope }
const ZERO = "0".repeat(64);
const hash = (prev: string, envelope: OpsEnvelope) =>
  createHash("sha256").update(prev + JSON.stringify(envelope)).digest("hex");
const readLines = (filename: string): Line[] =>
  existsSync(filename) ? readFileSync(filename,"utf8").split("\n").filter(Boolean).map(s=>JSON.parse(s)) : [];
export class OpsStore {
  private journal: string;
  private anchor: string;
  private lock: string;
  private lockOwned = false;
  private lines: Line[] = [];
  private state: OpsState = emptyOps();
  private fingerprints: string[] = [];
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir,0o700);
    this.journal=join(dir,"worker-events.jsonl");
    this.anchor=join(dir,"worker-events.head");
    this.lock=join(dir,".operations-writer.lock");
    const fd=openSync(this.lock,"wx",0o600);
    try { writeFileSync(fd,String(process.pid)); } finally { closeSync(fd); }
    this.lockOwned=true;
    try {
      const checked=this.verifyInternal();
      if (!checked.ok) throw new Error("worker operations journal failed integrity check: "+checked.reason);
      this.lines=checked.lines;
      this.state=checked.state;
      this.fingerprints=this.fileFingerprints();
    } catch(e) { this.close(); throw e; }
  }
  private fingerprint(file: string): string {
    if (!existsSync(file)) return "missing";
    const s=statSync(file);
    return [s.dev,s.ino,s.size,s.ctimeMs,s.mtimeMs].join(":");
  }
  private fileFingerprints(): string[] { return [this.fingerprint(this.journal),this.fingerprint(this.anchor)]; }
  private verifyInternal(): {ok:true;lines:Line[];state:OpsState;reason?:never} | {ok:false;lines:Line[];state:OpsState;reason:string} {
    const state=emptyOps();
    try {
      const lines=readLines(this.journal);
      const anchored=existsSync(this.anchor)?JSON.parse(readFileSync(this.anchor,"utf8")):{seq:0,hash:ZERO};
      let prev=ZERO, latest=state;
      for(let i=0;i<lines.length;i++){
        const l=lines[i];
        if(l.seq!==i+1 || l.prev!==prev || l.hash!==hash(prev,l.payload)) return {ok:false,lines,state,reason:"invalid journal chain at "+(i+1)};
        latest=applyOps(latest,l.payload);
        prev=l.hash;
      }
      if(anchored.seq!==lines.length || anchored.hash!==prev) return {ok:false,lines,state,reason:"head does not match journal"};
      return {ok:true,lines,state:latest};
    }catch(e){return {ok:false,lines:[],state,reason:String(e)};}
  }
  verify(): {ok:boolean;reason?:string;entries?:number} {
    const v=this.verifyInternal();
    return {ok:v.ok,...(!v.ok?{reason:v.reason}:{}),...(v.ok?{entries:v.lines.length}:{})};
  }
  snapshot(): OpsState {
    if (this.fileFingerprints().join("|")!==this.fingerprints.join("|")) throw new Error("worker operations journal changed outside writer");
    return structuredClone(this.state);
  }
  append(envelope: OpsEnvelope): {seq:number;hash:string} {
    if (this.fileFingerprints().join("|")!==this.fingerprints.join("|")) throw new Error("worker operations journal changed outside writer");
    const next=applyOps(this.state,envelope);
    const prev=this.lines.at(-1)?.hash??ZERO;
    const line={seq:this.lines.length+1,prev,hash:hash(prev,envelope),payload:envelope};
    appendFileSync(this.journal,JSON.stringify(line)+"\n",{mode:0o600});
    writeFileSync(this.anchor,JSON.stringify({seq:line.seq,hash:line.hash})+"\n",{mode:0o600});
    chmodSync(this.journal,0o600);chmodSync(this.anchor,0o600);
    this.lines.push(line);this.state=next;this.fingerprints=this.fileFingerprints();
    return {seq:line.seq,hash:line.hash};
  }
  close():void {
    if(!this.lockOwned) return;
    this.lockOwned=false;
    try { unlinkSync(this.lock); } catch(e:any) { if(e.code!=="ENOENT") throw e; }
  }
}
