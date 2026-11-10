import {test} from "node:test";
import assert from "node:assert/strict";
import {compareSource} from "../packages/operations/src/code-diff.ts";

test("line difference shows exact additions and removals",()=>{
  const value=compareSource("a\nb\nc","a\nB\nc\nd");
  assert.equal(value.added,2);
  assert.equal(value.removed,1);
  assert.ok(value.lines.some(r=>r.kind==="added"&&r.text==="B"));
  assert.ok(value.lines.some(r=>r.kind==="removed"&&r.text==="b"));
});
test("large source differences are bounded before display",()=>{
  const old=Array.from({length:2000},(_,i)=>"old"+i).join("\n");
  const next=Array.from({length:2000},(_,i)=>"new"+i).join("\n");
  const diff=compareSource(old,next);
  assert.equal(diff.truncated,true);
  assert.ok(diff.lines.length<=120);
  assert.equal(diff.added,2000);
  assert.equal(diff.removed,2000);
});
