import {test} from "node:test";
import assert from "node:assert/strict";
import {amount} from "../src/amount.js";
test("gevraagd bedrag is precies 12",()=>assert.equal(amount,12));
