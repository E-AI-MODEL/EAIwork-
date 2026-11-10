import {test} from "node:test";
import assert from "node:assert/strict";
import {runIsolatedProjectSuite,projectManifestSha256} from "../packages/operations/src/docker-project-suite.ts";

test("real Docker runs related modules and both tests without network or write access",
  {skip:process.env.EAI_DOCKER_SMOKE!=="1"},async()=>{
    const input={files:[
      {path:"src/math.js",content:"export const value = 2;\n"},
      {path:"src/view.js",content:'import {value} from "./math.js";\nexport const total = value * 2;\n'},
      {path:"tests/math.test.js",content:
        'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {writeFileSync} from "node:fs";\nimport {value} from "../src/math.js";\ntest("value",()=>assert.equal(value,2));\ntest("read-only project",()=>assert.throws(()=>writeFileSync("src/math.js","not allowed")));\ntest("offline",async()=>assert.rejects(fetch("http://1.1.1.1",{signal:AbortSignal.timeout(1500)})));\n'},
      {path:"tests/view.test.js",content:
        'import {test} from "node:test";\nimport assert from "node:assert/strict";\nimport {total} from "../src/view.js";\ntest("imported total",()=>assert.equal(total,4));\n'}
    ],testPaths:["tests/math.test.js","tests/view.test.js"]};
    const good=await runIsolatedProjectSuite(input);
    assert.equal(good.status,"passed",JSON.stringify(good));
    assert.equal(good.testsExecuted,true);
    assert.equal(good.manifestSha256,projectManifestSha256(input));
    assert.match(good.imageId||"",/^sha256:[0-9a-f]{64}$/);
    const changed={...input,files:input.files.map(file=>file.path==="src/math.js"?
      {...file,content:"export const value = 3;\n"}:file)};
    const broken=await runIsolatedProjectSuite(changed);
    assert.equal(broken.status,"failed",JSON.stringify(broken));
    assert.equal(broken.testsExecuted,true);
    assert.notEqual(broken.manifestSha256,good.manifestSha256);
  });
