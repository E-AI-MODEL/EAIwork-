import {test} from "node:test";
import assert from "node:assert/strict";
import {amount} from "../src/amount.js";
import {total} from "../src/invoice.js";
test("factuur gebruikt de actuele bedragmodule",()=>assert.equal(total,amount*2));
