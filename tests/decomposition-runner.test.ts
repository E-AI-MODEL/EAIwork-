import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt, runSuite } from "../experiments/decomposition/runner.ts";
import { normalizeModelOutput } from "../experiments/decomposition/spec.ts";
const task = {id:"demo",domain:"education",text:"Maak een concept, maar verstuur niets."};
const returned = (kind: string, quote: string) => ({content:{spans:[{kind,quote}],candidates:[]},output_tokens:10});
test("A/B/C/D use 1/1/2/3 independent requests", async () => {
  for(const [arm,n] of [["A",1],["B",1],["C",2],["D",3]] as const) {
    const visited:string[]=[];
    const results = await runSuite([task],arm,async(_t,stage,prompt)=>{
      visited.push(stage);
      assert.ok(prompt.includes(task.text));
      assert.ok(!prompt.includes("GOLD_LABEL"));
      if(stage==="probe")return {content:{spans:[],candidates:[{text:"extra permission may be needed",status:"hypothesis",reason:"not in text"}]}};
      return returned("action","Maak een concept");
    });
    assert.equal(results[0].calls,n); assert.equal(visited.length,n);
    assert.deepEqual(results[0].spans.map(s=>s.quote),["Maak een concept"]);
    assert.equal(results[0].candidates.length,arm==="D"?1:0);
  }
});
test("D rejects attempt to promote a blindspot into an asserted fact",async()=>{
  const result=await runSuite([task],"D",async(_t,stage)=>{
    if(stage==="probe")return returned("action","Maak een concept");
    return returned("action","Maak een concept");
  });
  assert.equal(result[0].failure,"invalid-promotion");
  assert.deepEqual(result[0].spans,[]);
});
test("runtime failures are preserved and not converted into unknowns",async()=>{
  const output=await runSuite([task],"A",async()=>{throw new Error("timeout");});
  assert.equal(output[0].failure,"timeout");
  assert.equal(output[0].spans.length,0);
});
test("quoted model offsets are derived from unambiguous task source",()=>{
  const output=normalizeModelOutput(task,{spans:[{kind:"prohibition",quote:"verstuur niets"}]});
  const span=output.spans[0];
  assert.equal(task.text.slice(span.start,span.end),span.quote);
});
