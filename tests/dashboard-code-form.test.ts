import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
function excerpt(start:string,end:string){
  const first=html.indexOf(start),last=html.indexOf(end,first+start.length);
  assert.ok(first>=0&&last>first,"dashboard function is missing");
  return html.slice(first,last);
}

test("example worktree renders filled values, not misleading placeholders",()=>{
  const src=excerpt("function orderedPlanPanel(){","function codeWorkbench(){");
  const example={codePlans:[],selectedCodePlan:null,
    codeWorkspaceStatus:{worktree:"/Users/test/eaiwork-proef-Q123"},
    h:(value:string)=>value,btn:()=>""};
  const rendered=runInNewContext(src+"\norderedPlanPanel()",example);
  assert.match(rendered,/value="Proef met twee bestanden"/);
  assert.match(rendered,/src\/amount\.js \| tests\/amount\.test\.js \| Verander/);
  assert.match(rendered,/src\/invoice\.js \| tests\/invoice\.test\.js \| Voeg/);
  assert.match(rendered,/De voorbeeldopdracht staat al klaar/);
  const own=runInNewContext(src+"\norderedPlanPanel()",{
    ...example,codeWorkspaceStatus:{worktree:"/Users/test/my-code"}
  });
  assert.doesNotMatch(own,/value="Proef met twee bestanden"/);
  assert.doesNotMatch(own,/De voorbeeldopdracht staat al klaar/);
});

test("submit parses real line breaks into two separate ordered steps",async()=>{
  const src=excerpt("async function requestOrderedCodePlan(event){",
    "async function runOrderedCodeAction(action){");
  const exampleRows=[
    "src/amount.js | tests/amount.test.js | Verander amount",
    "src/invoice.js | tests/invoice.test.js | Behoud total"
  ].join(String.fromCharCode(10));
  const sent:{path:string;payload:any}[]=[];
  let renderCount=0,scrollCount=0;
  const context={
    codeError:"",codeNotice:"",selectedCodePlan:null as string|null,
    document:{getElementById:(id:string)=>{
      if(id==="orderedTitle")return {value:"Proef met twee bestanden"};
      if(id==="orderedSteps")return {value:exampleRows};
      if(id==="ordered-plan-card")return {scrollIntoView:()=>{scrollCount++}};
      return null;
    }},
    postOps:async(path:string,payload:unknown)=>{sent.push({path,payload});return {id:"plan-test"}},
    loadCodeHistory:async()=>{},
    render:()=>{renderCount++}
  };
  const run=runInNewContext(src+"\nrequestOrderedCodePlan",context);
  let prevented=false;
  await run({preventDefault:()=>{prevented=true}});
  assert.equal(prevented,true);
  assert.equal(context.codeError,"");
  assert.equal(context.selectedCodePlan,"plan-test");
  assert.equal(renderCount,1);
  assert.equal(scrollCount,1);
  assert.equal(sent.length,1);
  assert.equal(sent[0].path,"/ops/code/plans");
  assert.equal(sent[0].payload.title,"Proef met twee bestanden");
  assert.equal(sent[0].payload.suitePolicy,"project-node-v1");
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0].payload.steps)),[
    {path:"src/amount.js",testPath:"tests/amount.test.js",instruction:"Verander amount"},
    {path:"src/invoice.js",testPath:"tests/invoice.test.js",instruction:"Behoud total"}
  ]);
});
