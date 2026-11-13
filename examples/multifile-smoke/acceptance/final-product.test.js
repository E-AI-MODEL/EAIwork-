import {test} from "node:test";
import assert from "node:assert/strict";
import {amount} from "../src/amount.js";
import {total,totalWithShipping} from "../src/invoice.js";

// This acceptance test is deliberately separate from the two stage tests.
// It runs only after both changes are applied and independently checks
// that the product meets the user's entire requested result.
test("de gevraagde app is daadwerkelijk opgeleverd",()=>{
  assert.equal(amount,12,"Het bedrag moet exact 12 zijn");
  assert.equal(total,24,"Het bestaande totaal moet blijven werken");
  assert.equal(typeof totalWithShipping,"function","De nieuwe functie moet bestaan");
  assert.equal(totalWithShipping(),24,"Zonder verzendkosten moet het totaal 24 zijn");
  assert.equal(totalWithShipping(4),28,"Verzendkosten moeten worden opgeteld");
  assert.equal(totalWithShipping(0),24);
});
