import {test} from "node:test";
import assert from "node:assert/strict";
import {amount} from "../src/amount.js";
test("bedrag blijft tussen 1 en 20",()=>assert.ok(amount>=1&&amount<=20));
