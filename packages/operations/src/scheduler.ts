/**
 * Small, single-process scheduler for specifically approved local text tasks.
 * Each task start consumes one persisted budget unit before its adapter runs.
 * After explicit consent, it may requeue a crashed pure, deterministic
 * built-in with a new budgeted run. External actions are never retried.
 */
import {randomUUID} from "node:crypto";
import type {OpsStore} from "./store.ts";
import type {OpsEvent} from "./registry.ts";
import {missionProgress,type MissionRecord,type SchedulerStopReason} from "./missions.ts";
import {runMissionStep} from "./execution.ts";
import {expireLocalLeases} from "./leases.ts";

export interface SchedulerTick {
  inspected:number;
  started:number;
  stopped:{missionId:string;reason:SchedulerStopReason}[];
}
export class LocalMissionScheduler {
  private timer:ReturnType<typeof setInterval>|undefined;
  private ticking=false;
  private readonly store:OpsStore;
  constructor(store:OpsStore,intervalMs=100) {
    this.store=store;
    if(!Number.isInteger(intervalMs)||intervalMs<0||(intervalMs>0&&(intervalMs<25||intervalMs>5000)))
      throw new Error("scheduler interval must be zero (manual) or 25-5000 ms");
    // Resume only where prior human consent explicitly covers restart.
    // Record requeue decisions before performing any further work.
    this.recoverInterrupted();
    if(intervalMs>0){
      this.timer=setInterval(()=>{try{this.tick()}catch{
        // A failed journal read or write must not trigger an automatic retry.
        this.close();
      }},intervalMs);
      this.timer.unref();
    }
  }
  private emit(event:OpsEvent) {
    return this.store.append({id:"ops-"+randomUUID(),at:new Date().toISOString(),
      actor:{kind:"system",id:"system:mission-scheduler"},event});
  }
  private stop(id:string,reason:SchedulerStopReason) {
    this.emit({type:"mission.automation.stop",missionId:id,reason});
  }
  recoverInterrupted():number {
    const missions=this.store.snapshot().missions;
    let stopped=0;
    for(const [id,m] of Object.entries(missions)){
      if(!m.automation?.enabled)continue;
      if(!m.automation.resumeAfterRestart){
        this.stop(id,"interrupted");stopped++;continue;
      }
      // The only safe automatic recovery is a pure, deterministic local
      // calculation. Replay keeps the previous run and spends a new budget
      // unit if the calculation starts again. Any other case needs review.
      const running=Object.entries(m.tasks).filter(([,task])=>task.status==="running");
      if(running.length===1 && !m.paused && !Object.values(m.tasks).some(t=>t.status==="failed") &&
         m.automation.starts<m.automation.maxStarts){
        const [taskId,task]=running[0];
        if(task.run && (task.attempts?.length??0)<3 &&
           ["text-normalize","text-metrics"].includes(task.spec.taskKind) &&
           task.spec.effect!== "external-write" && task.spec.effect!=="publish" &&
           task.spec.effect!=="destructive" &&
           task.run.adapterId===task.spec.taskKind &&
           task.run.workerId===task.spec.taskKind){
          this.emit({type:"task.recover",missionId:id,taskId,runId:task.run.runId});
        }
      }
      const current=this.store.snapshot().missions[id];
      const progress=missionProgress(current);
      const reason:SchedulerStopReason|undefined=current.paused?"paused":
        progress.running||progress.failed?"needs-review":
        progress.status==="complete"?"complete":
        current.automation!.starts>=current.automation!.maxStarts?"budget-exhausted":
        !progress.ready?"blocked":undefined;
      if(reason){this.stop(id,reason);stopped++}
    }
    return stopped;
  }
  tick():SchedulerTick {
    if(this.ticking)return {inspected:0,started:0,stopped:[]};
    this.ticking=true;
    const report:SchedulerTick={inspected:0,started:0,stopped:[]};
    try{
      // Lease expiry is a durable terminal transition. This never schedules
      // a retry and does not use a model or any external write action.
      expireLocalLeases(this.store);
      const missionIds=Object.entries(this.store.snapshot().missions)
        .filter(([,m])=>m.automation?.enabled).map(([id])=>id);
      for(const id of missionIds){
        const m=this.store.snapshot().missions[id];
        if(!m?.automation?.enabled)continue;
        report.inspected++;
        const stop=(reason:SchedulerStopReason)=>{
          this.stop(id,reason);report.stopped.push({missionId:id,reason});
        };
        if(m.paused){stop("paused");continue}
        const progress=missionProgress(m);
        if(progress.status==="complete"){stop("complete");continue}
        if(progress.failed||progress.running){stop("needs-review");continue}
        if(m.automation.starts>=m.automation.maxStarts){stop("budget-exhausted");continue}
        if(progress.ready===0){stop("blocked");continue}
        // A single ready task per tick. The existing worker runner checks
        // admission, adapter, capability, version and dependency gates again.
        try{
          const result=runMissionStep(this.store,id,1);
          report.started+=result.started.length;
          const now=this.store.snapshot().missions[id];
          if(!now?.automation?.enabled)continue;
          const next=missionProgress(now);
          if(next.status==="complete")stop("complete");
          else if(result.failed.length||next.failed)stop("needs-review");
          else if(!result.started.length)stop("blocked");
          else if(now.automation.starts>=now.automation.maxStarts)stop("budget-exhausted");
          else if(next.ready===0)stop("blocked");
        }catch{
          // Do not repeat a task when the previous operation may have started.
          const current=this.store.snapshot().missions[id];
          if(current?.automation?.enabled)stop("needs-review");
        }
      }
      return report;
    }finally{this.ticking=false}
  }
  close():void{
    if(this.timer){clearInterval(this.timer);this.timer=undefined}
  }
}
