/**
 * Small, single-process scheduler for specifically approved local text tasks.
 * Each task start consumes one persisted budget unit before its adapter runs.
 * The scheduler never retries interrupted work or executes external actions.
 */
import {randomUUID} from "node:crypto";
import type {OpsStore} from "./store.ts";
import type {OpsEvent} from "./registry.ts";
import {missionProgress,type MissionRecord,type SchedulerStopReason} from "./missions.ts";
import {runMissionStep} from "./execution.ts";

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
    // Fail closed across process restart. A fresh human approval is required.
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
      if(m.automation?.enabled){
        this.stop(id,"interrupted");
        stopped++;
      }
    }
    return stopped;
  }
  tick():SchedulerTick {
    if(this.ticking)return {inspected:0,started:0,stopped:[]};
    this.ticking=true;
    const report:SchedulerTick={inspected:0,started:0,stopped:[]};
    try{
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
