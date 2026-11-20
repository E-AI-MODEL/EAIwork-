import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const dashboard=readFileSync("prototypes/dashboard/index.html","utf8");
const server=readFileSync("packages/server/src/server.ts","utf8");

test("live workbench connects missing worker to existing builder without extra task scheduler",()=>{
  assert.match(dashboard,/btn\('Controleer ontbrekende workers','worker-needs'/);
  assert.match(dashboard,/btn\('Bouw en test kandidaat','worker-prepare'/);
  assert.match(dashboard,/case 'worker-needs':inspectMissionWorkerNeeds\(id\);return;/);
  assert.match(dashboard,/case 'worker-prepare':prepareMissionWorker\(id\);return;/);
  assert.match(dashboard,/expectedRevision:needs\.revision/);
  assert.match(dashboard,/taskId:task\.taskId/);
  assert.match(dashboard,/worker-needs/);
  assert.match(dashboard,/workers\/prepare/);
  assert.doesNotMatch(dashboard,/real-agent-cycle|runNativeAgentCycle/);
  assert.doesNotMatch(server,/runAgentCycle|agent\/cycle/);
});

test("server only serves vacancy inspection and human requested Builder",()=>{
  assert.match(server,/inspectMissionWorkerNeeds/);
  assert.match(server,/prepareMissingWorker/);
  assert.match(server,/only mission owners may request worker preparation/);
  assert.match(server,/expectedRevision,taskId/);
});
