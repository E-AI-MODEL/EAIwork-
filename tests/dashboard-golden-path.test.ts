import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../prototypes/dashboard/index.html",import.meta.url),"utf8");
const client=readFileSync(new URL("../packages/client/index.html",import.meta.url),"utf8");
const between=(source:string,start:string,end:string)=>{
  const i=source.indexOf(start);assert.ok(i>=0,start);
  const j=source.indexOf(end,i);assert.ok(j>i,end);
  return source.slice(i,j);
};

test("a page refresh between test and approval keeps the decision available",()=>{
  // The approval block needs the inspection; it must be loaded together with the proposal.
  const loader=between(html,"async function loadCodeProposal(id){","async function requestCodeProposal");
  assert.match(loader,/codeInspection=await postOps\('\/ops\/code\/check',\{proposalId:codeDraft\.id\}\)/);
});

test("a proposal inside a running plan shows one test status, not a second contradicting one",()=>{
  assert.match(html,/const inPlan=!!draft&&codePlans\.some\(/);
  assert.match(html,/draft\.testPath&&!inPlan\?'<p class="smalltext"><b>Test:<\/b>/);
  assert.match(html,/\(inPlan\?'':draft\.testReport\?\.testsExecuted\?/);
});

test("the launcher link connects in one click and the token leaves the address bar",()=>{
  for(const page of [html,client]){
    const boot=between(page,"const match=/^#token=([0-9a-f]{64})$/.exec(location.hash);","})();");
    assert.match(boot,/history\.replaceState\(null,'',location\.pathname\+location\.search\)/);
  }
  for(const script of ["../scripts/local-ollama.ts","../scripts/local-demo.ts"]){
    assert.match(readFileSync(new URL(script,import.meta.url),"utf8"),/#token="\+/);
  }
  // The token is only ever placed in a fragment, never in a query string or a path.
  assert.doesNotMatch(html+client,/[?&]token=/);
});

test("the finished work shows its proof, and a new user is not stranded without text workers",()=>{
  const panel=between(html,"function codeEvidencePanel(){","async function loadCodeProposal");
  assert.match(panel,/Bewezen/);
  assert.match(panel,/Deze status is niet door jou of door het model gezet/);
  assert.match(html,/atoms\|\|\{\}\)\['a\.code\.tested'\]/);
  const add=between(html,"async function addBuiltinTextWorkers(){","document.addEventListener('click',e=>{if(e.target.closest('[data-action=\"add-text-workers\"]')");
  // Same three steps a person would take: register, server-side test, release only on a pass.
  assert.ok(add.indexOf("worker.register")<add.indexOf("/evaluate")&&add.indexOf("/evaluate")<add.indexOf("worker.release"));
  assert.match(add,/if\(!test\.passed\)throw/);
});

test("every sidebar icon is a valid SVG path and both pages still parse",()=>{
  const icons=between(html,"const ico=(n)=>{const a={","};");
  const arity:Record<string,number>={M:2,L:2,H:1,V:1,C:6,S:4,Q:4,T:2,A:7,Z:0};
  let count=0;
  for(const [,d] of icons.matchAll(/:'([^']+)'/g)){
    count++;
    assert.match(d,/^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]+$/,d);
    // Each command takes a whole number of argument groups; the old overview icon did not.
    for(const [,command,rest] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)){
      const numbers=rest.match(/-?\d*\.?\d+/g)??[];
      const need=arity[command.toUpperCase()];
      assert.ok(need===0?numbers.length===0:numbers.length>0&&numbers.length%need===0,command+rest+" in "+d);
    }
  }
  assert.ok(count>=6);
  assert.throws(()=>{
    const bad="m0 0 0 3 3";const numbers=bad.match(/-?\d*\.?\d+/g)!;assert.equal(numbers.length%2,0);
  });
  for(const page of [html,client]){
    const script=page.slice(page.lastIndexOf("<script>")+8,page.lastIndexOf("</script>"));
    assert.doesNotThrow(()=>new Function(script));
  }
});
