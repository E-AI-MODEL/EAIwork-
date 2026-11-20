/**
 * Local operations journal, separate from the signed atom evidence log.
 * Acknowledged writes are synced before an atomic head update. Exactly one
 * complete, replayable event left by a crash may be recovered on startup.
 * This remains a local hash chain, NOT a separately witnessed audit log.
 */
import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { stageOps, emptyOps, type OpsEnvelope, type OpsState } from "./registry.ts";

interface Line { seq: number; prev: string; hash: string; payload: OpsEnvelope }
const ZERO = "0".repeat(64);
const hash = (prev: string, envelope: OpsEnvelope) =>
  createHash("sha256").update(prev + JSON.stringify(envelope)).digest("hex");
const readLines = (filename: string): Line[] => {
  if(!existsSync(filename))return [];
  const raw=readFileSync(filename,"utf8");
  if(!raw)return [];
  if(!raw.endsWith("\n"))throw new Error("incomplete operations journal tail; manual review required");
  const entries=raw.slice(0,-1).split("\n");
  if(entries.some(x=>!x))throw new Error("invalid blank line in operations journal");
  return entries.map(s=>JSON.parse(s));
};
const syncDirectory=(file:string)=>{
  const fd=openSync(dirname(file),"r");
  try{fsyncSync(fd)}finally{closeSync(fd)}
};
const atomicHead=(file:string,seq:number,head:string)=>{
  const tmp=file+"."+randomUUID()+".tmp";
  const fd=openSync(tmp,"wx",0o600);
  try{
    writeFileSync(fd,JSON.stringify({seq,hash:head})+"\n");
    fsyncSync(fd);
  }finally{closeSync(fd)}
  renameSync(tmp,file);
  syncDirectory(file);
};
export class OpsStore {
  private journal: string;
  private anchor: string;
  private lock: string;
  private lockOwned = false;
  private poisoned = false;
  /** Fully written event recovered after an interrupted head update. */
  readonly recoveredTail: number;
  private lines: Line[] = [];
  /** Exact event IDs, reconstructed by verified replay on startup. */
  private eventIds = new Set<string>();
  private state: OpsState = emptyOps();
  private fingerprints: string[] = [];
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir,0o700);
    this.journal=join(dir,"worker-events.jsonl");
    this.anchor=join(dir,"worker-events.head");
    this.lock=join(dir,".operations-writer.lock");
    this.acquireWriter();
    let recovered=0;
    try {
      // Bootstrap an empty journal with an explicit committed head.
      if(!existsSync(this.anchor)&&!existsSync(this.journal))atomicHead(this.anchor,0,ZERO);
      const checked=this.verifyInternal(true);
      if (!checked.ok) throw new Error("worker operations journal failed integrity check: "+checked.reason);
      this.lines=checked.lines;
      this.eventIds=new Set(checked.lines.map(line=>line.payload.id));
      this.state=checked.state;
      recovered=checked.recovered;
      this.fingerprints=this.fileFingerprints();
    } catch(e) { this.close(); throw e; }
    this.recoveredTail=recovered;
  }
  private acquireWriter():void {
    const create=()=>{
      const fd=openSync(this.lock,"wx",0o600);
      try{
        writeFileSync(fd,JSON.stringify({pid:process.pid,host:hostname()})+"\n");
        fsyncSync(fd);
      }finally{closeSync(fd)}
      this.lockOwned=true;
    };
    try{create();return}catch(e:any){if(e.code!=="EEXIST")throw e}
    // Reclaim only a proven-dead process on this host. Never guess that a
    // process on another host has stopped. Only one recovery writer may try.
    const recovery=this.lock+".recovery";
    const fd=openSync(recovery,"wx",0o600);
    try{
      const raw=readFileSync(this.lock,"utf8").trim();
      const owner=raw.startsWith("{")?JSON.parse(raw):{pid:Number(raw),host:hostname()};
      if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||owner.host!==hostname())
        throw new Error("operations lock owner cannot be verified; manual review required");
      try{process.kill(owner.pid,0)}
      catch(e:any){
        if(e.code!=="ESRCH")throw e;
        unlinkSync(this.lock);
        create();
        return;
      }
      throw new Error("operations writer is already active");
    }finally{
      closeSync(fd);
      unlinkSync(recovery);
    }
  }
  private fingerprint(file: string): string {
    if (!existsSync(file)) return "missing";
    const s=statSync(file);
    return [s.dev,s.ino,s.size,s.ctimeMs,s.mtimeMs].join(":");
  }
  private fileFingerprints(): string[] { return [this.fingerprint(this.journal),this.fingerprint(this.anchor)]; }
  private verifyInternal(recover=false): {ok:true;lines:Line[];state:OpsState;recovered:number;reason?:never} | {ok:false;lines:Line[];state:OpsState;reason:string} {
    const state=emptyOps();
    try {
      const lines=readLines(this.journal);
      const anchored=existsSync(this.anchor)?JSON.parse(readFileSync(this.anchor,"utf8")):{seq:0,hash:ZERO};
      if(!Number.isSafeInteger(anchored.seq)||anchored.seq<0||
         typeof anchored.hash!=="string"||!(/^[a-f0-9]{64}$/.test(anchored.hash)))
        throw new Error("invalid operations head");
      let prev=ZERO, latest=state, committedHead=ZERO;
      const seen=new Set<string>();
      for(let i=0;i<lines.length;i++){
        const l=lines[i];
        if(l.seq!==i+1 || l.prev!==prev || l.hash!==hash(prev,l.payload)) return {ok:false,lines,state,reason:"invalid journal chain at "+(i+1)};
        const next=stageOps(latest,l.payload,seen,true);
        next.history.push(structuredClone(l.payload));
        seen.add(l.payload.id);
        latest=next;
        prev=l.hash;
        if(i+1===anchored.seq)committedHead=prev;
      }
      if(anchored.seq===lines.length && anchored.hash===prev)
        return {ok:true,lines,state:latest,recovered:0};
      // Only one fully valid and complete event after an intact committed
      // prefix may be replayed. Do not truncate anything automatically.
      if(recover && existsSync(this.anchor) &&
         lines.length===anchored.seq+1 && committedHead===anchored.hash){
        atomicHead(this.anchor,lines.length,prev);
        return {ok:true,lines,state:latest,recovered:1};
      }
      return {ok:false,lines,state,reason:"head does not match journal; manual review required"};
    }catch(e){return {ok:false,lines:[],state,reason:String(e)};}
  }
  verify(): {ok:boolean;reason?:string;entries?:number} {
    const v=this.verifyInternal();
    return {ok:v.ok,...(!v.ok?{reason:v.reason}:{}),
      ...(v.ok?{entries:v.lines.length,recoveredTail:this.recoveredTail}:{} )};
  }
  snapshot(): OpsState {
    if(this.poisoned)throw new Error("operations journal write failed; reopen and verify before continuing");
    if (this.fileFingerprints().join("|")!==this.fingerprints.join("|")) throw new Error("worker operations journal changed outside writer");
    return structuredClone(this.state);
  }
  append(envelope: OpsEnvelope): {seq:number;hash:string} {
    if(this.poisoned)throw new Error("operations journal write failed; reopen and verify before continuing");
    if (this.fileFingerprints().join("|")!==this.fingerprints.join("|")) throw new Error("worker operations journal changed outside writer");
    const next=stageOps(this.state,envelope,this.eventIds);
    const prev=this.lines.at(-1)?.hash??ZERO;
    const line={seq:this.lines.length+1,prev,hash:hash(prev,envelope),payload:envelope};
    try{
      const fd=openSync(this.journal,"a",0o600);
      try{
        writeFileSync(fd,JSON.stringify(line)+"\n");
        fsyncSync(fd);
      }finally{closeSync(fd)}
      atomicHead(this.anchor,line.seq,line.hash);
      chmodSync(this.journal,0o600);chmodSync(this.anchor,0o600);
    }catch(e){
      // A write of uncertain status must never be followed by another event.
      this.poisoned=true;
      throw e;
    }
    // The in-memory commit happens only after both durable write steps.
    next.history.push(structuredClone(envelope));
    this.eventIds.add(envelope.id);
    this.lines.push(line);this.state=next;this.fingerprints=this.fileFingerprints();
    return {seq:line.seq,hash:line.hash};
  }
  close():void {
    if(!this.lockOwned) return;
    this.lockOwned=false;
    try { unlinkSync(this.lock); } catch(e:any) { if(e.code!=="ENOENT") throw e; }
  }
}
