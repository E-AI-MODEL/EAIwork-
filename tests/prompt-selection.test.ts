import {test} from "node:test";
import assert from "node:assert/strict";
import {Script} from "node:vm";
import {PROMPT_STARTERS,selectPromptStarters} from "../packages/cloud/src/prompt-starters.ts";
import {cloudRequestKind,validateCloudAction} from "../packages/cloud/src/controller.ts";
import {html,javascript} from "../packages/cloud/src/ui.ts";

const csv="Afdeling;Aantal\nNoord;12\nZuid;16";
test("Prompt filter catalog has unique, bounded and honest capability labels",()=>{
  assert.equal(PROMPT_STARTERS.length,5);
  assert.equal(new Set(PROMPT_STARTERS.map(p=>p.id)).size,PROMPT_STARTERS.length);
  assert.equal(selectPromptStarters("all","all").length,5);
  assert.equal(selectPromptStarters("data","all").length,2);
  assert.equal(selectPromptStarters("tekst","all").length,1);
  assert.equal(selectPromptStarters("software","available").length,0);
  assert.equal(selectPromptStarters("software","unavailable").length,2);
  assert.equal(selectPromptStarters("all","available").length,3);
  assert.deepEqual(selectPromptStarters("all","all","dashboard").map(p=>p.id),
    ["csv-dashboard","csv-overzicht"]);
  for(const p of PROMPT_STARTERS){
    assert.ok(p.title&&p.summary&&p.instruction);
    assert.ok(p.instruction.length<1500);
    assert.ok(p.summary.length<125);
    assert.ok(!/\b(api key|token|secret)\b/i.test(p.instruction));
  }
});
test("Selectable prompt words trigger only the actual native supported task routes",()=>{
  for(const p of PROMPT_STARTERS){
    if(p.source==="csv"){
      assert.equal(cloudRequestKind(p.instruction,csv),"csv-dashboard");
      assert.equal(validateCloudAction({type:"submit",instruction:p.instruction,
        sourceText:csv,executionPreference:"auto"}).type,"submit");
      assert.equal(cloudRequestKind(p.instruction,""),"request-review");
    }else if(p.source==="text"){
      assert.equal(cloudRequestKind(p.instruction,"Hallo wereld"),"text-inspect");
      assert.throws(()=>validateCloudAction({type:"submit",
        instruction:p.instruction}),/brontekst/);
    }else{
      assert.equal(p.supported,false);
      assert.equal(cloudRequestKind(p.instruction,""),"request-review");
      assert.equal(validateCloudAction({type:"submit",
        instruction:p.instruction}).type,"submit");
    }
  }
});
test("Mobile browser exposes selectable prompt filters, editable instruction and honest status",()=>{
  assert.doesNotThrow(()=>new Script(javascript));
  for(const group of ["all","data","tekst","software"])
    assert.match(html,new RegExp('data-group="'+group+'"'));
  for(const value of ["all","available","unavailable"])
    assert.match(html,new RegExp('<option value="'+value+'">'));
  assert.match(html,/id="prompt-results"/);
  assert.match(html,/id="prompt-feedback"/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/id="instruction" maxlength="1500"/);
  assert.match(html,/role="group" aria-label="Selecteer een voorbeeldopdracht"/);
  assert.match(javascript,/field\.value=p\.instruction/);
  assert.match(javascript,/selectedPromptId=p\.id;renderPromptChoices/);
  assert.match(javascript,/Deze prompt wordt bewaard, maar een geschikte uitvoerder ontbreekt nog/);
  assert.match(javascript,/const PROMPT_STARTERS=\[/);
  assert.doesNotMatch(javascript,/innerHTML|outerHTML|document\.write/);
});
test("My work has status and search filters that do not mutate the mission history",()=>{
  for(const filter of ["all","active","done","blocked"])
    assert.match(html,new RegExp('data-status="'+filter+'"'));
  assert.match(html,/id="mission-search"/);
  assert.match(javascript,/const ms=allMissions\.filter\(matchesMission\)/);
  assert.match(javascript,/m\.status==="done"/);
  assert.match(javascript,/setMissionFilter\("all"\)/);
  assert.match(javascript,/title\+" "\+\(m\.requestedOutcome\|\|""\)/);
  assert.doesNotMatch(javascript,/innerHTML/);
});
