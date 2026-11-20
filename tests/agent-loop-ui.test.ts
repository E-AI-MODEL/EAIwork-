import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const dashboard=readFileSync("prototypes/dashboard/index.html","utf8");

test("native agent action exists only in the existing live mission controls",()=>{
  assert.match(dashboard,/btn\('Agent: maximaal 2 stappen','real-agent-cycle'/);
  assert.match(dashboard,/case 'real-agent-cycle':runNativeAgentCycle\(id\);return;/);
  assert.match(dashboard,/async function runNativeAgentCycle\(id\)/);
  assert.match(dashboard,/\/ops\/missions\/'.*'\/agent\/cycle'/);
  assert.match(dashboard,/maxStarts:2/);
  assert.match(dashboard,/result\.starts/);
  assert.match(dashboard,/selected\.automation\?\.enabled\?'disabled'/);
});
