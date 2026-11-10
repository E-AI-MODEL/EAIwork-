import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
function section(from:string,to:string){
  const first=html.indexOf(from),last=html.indexOf(to,first+from.length);
  assert.ok(first>=0&&last>first,from+" section missing");
  return html.slice(first,last);
}
const step=(status:string,projectPreStatus:string|null)=>({
  index:0,path:"src/amount.js",testPath:"tests/amount.test.js",instruction:"Verander het bedrag",
  status,projectPreStatus,proposalId:"proposal-1",active:true
});
test("a code plan asks for one yes/no decision only after a matching successful test",()=>{
  const src=section("function orderedPlanPanel(){","function connectionsPanel(){");
  const item=step("review",null);
  const plan={id:"plan-1",title:"Proef",state:"active",suitePolicy:"project-node-v1",
    steps:[item]};
  const context={
    codePlans:[plan],selectedCodePlan:"plan-1",codeWorkspaceStatus:{worktree:"/tmp/example"},
    codeInspection:{sourceUnchanged:true,replacementHashMatches:true,preflight:{status:"passed"}},
    codeDraft:{id:"proposal-1"},h:(v:unknown)=>String(v??""),
    btn:(label:string,action:string)=>"<button data-action='"+action+"'>"+label+"</button>",
    badge:(v:string)=>v
  };
  const render=runInNewContext(src+"\norderedPlanPanel",context);
  let page=render();
  assert.match(page,/Test voorstel/);
  assert.match(page,/Eerst moet de test slagen/);
  assert.doesNotMatch(page,/Ja, pas wijziging toe/);
  item.projectPreStatus="passed";
  page=render();
  assert.match(page,/Mag EAIwork deze wijziging uitvoeren/);
  assert.match(page,/Ja, pas wijziging toe/);
  assert.match(page,/Nee, stop opdracht/);
  assert.doesNotMatch(page,/codePlanAccept/);
  context.codeDraft={id:"other-proposal"};
  page=render();
  assert.doesNotMatch(page,/Ja, pas wijziging toe/);
});
test("yes sends exact proposal and sha, no stops without applying code",async()=>{
  const src=section("async function runOrderedCodeAction(action){","async function loadCodeHistory(){");
  const sent:{path:string;payload:any}[]=[];
  const currentStep={...step("review","passed"),replacementSha256:"a".repeat(64)};
  const plan={id:"plan-1",suitePolicy:"project-node-v1",steps:[currentStep],state:"active"};
  const context={
    codePlans:[plan],selectedCodePlan:"plan-1",codeError:"",codeNotice:"",
    codeDraft:{id:"proposal-1",replacementSha256:"a".repeat(64)},
    codeInspection:{sourceUnchanged:true,replacementHashMatches:true,preflight:{status:"passed"}},
    window:{confirm:()=>{throw new Error("No extra confirmation dialog expected")}},
    postOps:async(path:string,payload:unknown)=>{
      sent.push({path,payload});
      return {result:{status:"passed"}};
    },
    loadCodeHistory:async()=>{},loadCodeProposal:async()=>{},
    checkCodeProposal:async()=>{},render:()=>{}
  };
  const run=runInNewContext(src+"\nrunOrderedCodeAction",context);
  await run("apply");
  assert.equal(sent[0].path,"/ops/code/plan/apply");
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].payload)),{
    planId:"plan-1",proposalId:"proposal-1",expectedSha256:"a".repeat(64),approve:true
  });
  context.codeInspection={sourceUnchanged:false,replacementHashMatches:true,preflight:{status:"passed"}};
  await run("apply");
  assert.equal(sent.length,1,"a stale source must never trigger another write");
  context.codeInspection={sourceUnchanged:true,replacementHashMatches:true,preflight:{status:"passed"}};
  await run("stop");
  assert.equal(sent.length,2);
  assert.equal(sent[1].path,"/ops/code/plan/stop");
  assert.deepEqual(JSON.parse(JSON.stringify(sent[1].payload)),{planId:"plan-1",approve:true});
});
test("declining a standalone proposal does not call the server or change files",()=>{
  const src=section("function dismissCodeProposal(){","async function restoreCodeProposal(){");
  let writes=0,renders=0;
  const context={
    codeDraft:{id:"one"},codeInspection:{canApply:true},codeError:"old",
    codeNotice:"",
    postOps:()=>{writes++},
    render:()=>{renders++}
  };
  runInNewContext(src+"\ndismissCodeProposal()",context);
  assert.equal(writes,0);
  assert.equal(renders,1);
  assert.equal(context.codeDraft,null);
  assert.equal(context.codeInspection,null);
  assert.match(context.codeNotice,/niets aangepast/);
  assert.doesNotMatch(html,/id="codePlanAccept"|id="codeAccept"/);
  assert.match(html,/case 'code-dismiss':dismissCodeProposal\(\)/);
});
test("standalone yes remains tied to server checks and needs no extra checkbox",async()=>{
  const src=section("async function approveCodeProposal(){","function dismissCodeProposal(){");
  const sent:{path:string;payload:any}[]=[];
  const context={
    codeInspection:{canApply:true},codeDraft:{id:"proposal-2",replacementSha256:"a".repeat(64)},
    codeError:"",codeNotice:"",
    postOps:async(path:string,payload:unknown)=>{
      sent.push({path,payload});
      return {path:"src/one.js",backupRef:"backup",proposalId:"proposal-2"};
    },
    loadCodeHistory:async()=>{},loadCodeProposal:async()=>{},render:()=>{},
    window:{confirm:()=>{throw new Error("No second confirmation should be necessary")}}
  };
  const approve=runInNewContext(src+"\napproveCodeProposal",context);
  await approve();
  assert.equal(sent.length,1);
  assert.equal(sent[0].path,"/ops/code/apply");
  assert.equal(sent[0].payload.approve,true);
  assert.equal(sent[0].payload.expectedSha256,"a".repeat(64));
  context.codeInspection={canApply:false};
  await approve();
  assert.equal(sent.length,1);
});
