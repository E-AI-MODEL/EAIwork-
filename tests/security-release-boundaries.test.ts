import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("product-proef mag niet terugvallen op voorgekookte code of code op de host uitvoeren",()=>{
  const source=readFileSync(new URL("./first-product-smoke.test.ts",import.meta.url),"utf8");
  assert.match(source,/discoverLocalOllamaModels\(/);
  assert.match(source,/new LocalCodeWorkspace\(/);
  assert.match(source,/await testAcceptedProduct\(/);
  assert.doesNotMatch(source,/spawnSync\(process\.execPath/);
  assert.doesNotMatch(source,/const replacements\s*:/);
  assert.doesNotMatch(source,/createServer\s*\(/);
});
test("product-proef gebruikt Docker en verifieert modelversie",()=>{
  const flow=readFileSync(new URL("../.github/workflows/first-product-proof.yml",import.meta.url),"utf8");
  assert.match(flow,/EAI_FIRST_PRODUCT_MODEL:/);
  assert.match(flow,/sha256sum -c -/);
  assert.match(flow,/node:22-alpine/);
  assert.match(flow,/npm run proof:first-product/);
  assert.doesNotMatch(flow,/curl\s+[^\n]*\|\s*sh/);
});
