/**
 * A complete, non-publishing first-product proof:
 * two HTTP-approved code changes, real Docker checks on both stages,
 * and an independent final user-requirement test.
 * A real locally running Ollama model must propose the code. No canned answers,
 * fallback replacements or silent pass when the model is unavailable.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname,resolve} from "node:path";
import type {AddressInfo} from "node:net";
import {fileURLToPath} from "node:url";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {runIsolatedProjectSuite} from "../packages/operations/src/docker-project-suite.ts";
import {createDemoServer} from "../scripts/local-demo.ts";
import {localOllamaHost,discoverLocalOllamaModels} from "../packages/gateway/src/ollama-provider.ts";

const enabled=process.env.EAI_FIRST_PRODUCT_SMOKE==="1";
const example=fileURLToPath(new URL("../examples/multifile-smoke/",import.meta.url));
const steps=[
  {path:"src/amount.js",testPath:"tests/amount.test.js",
    instruction:"Verander de export amount van 10 naar 12. Behoud de naam amount."},
  {path:"src/invoice.js",testPath:"tests/invoice.test.js",
    instruction:"Voeg een export function totalWithShipping(shipping = 0) toe die amount * 2 + shipping teruggeeft. Behoud de export total."}
];
/** Run the independent acceptance file inside the same networkless, read-only
 * Docker boundary as the code tests. Never execute model-generated code on host.
 */
const acceptancePaths=["tests/amount.test.js","tests/invoice.test.js","acceptance/final-product.test.js"];
const acceptanceFiles=["src/amount.js","src/invoice.js",...acceptancePaths];
async function testAcceptedProduct(project:string){
  return runIsolatedProjectSuite({
    files:acceptanceFiles.map(path=>({path,content:readFileSync(join(project,path),"utf8")})),
    testPaths:acceptancePaths
  });
}
test("eerste volledige productproef: lokaal HTTP → voorstel → echte Docker-test → akkoord → eindproduct",{
  skip:enabled?false:"Deze proef draait apart met EAI_FIRST_PRODUCT_SMOKE=1 en Docker."
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"eaiwork-first-product-"));
  const project=join(root,"project"),profile=join(root,"profile");
  cpSync(example,project,{recursive:true});
  mkdirSync(profile);
  const model=process.env.EAI_FIRST_PRODUCT_MODEL?.trim();
  assert.ok(model,"Productproef vereist EAI_FIRST_PRODUCT_MODEL: er is geen nagebootst model.");
  const host=localOllamaHost(process.env.EAI_FIRST_PRODUCT_OLLAMA_HOST);
  const models=await discoverLocalOllamaModels(host,10000);
  assert.ok(models.includes(model),"Het echte Ollama-model staat niet klaar: "+model);
  const tagsResponse=await fetch(host+"/api/tags",{signal:AbortSignal.timeout(10000)});
  assert.equal(tagsResponse.ok,true,"Ollama kan de gebruikte modelversie niet bevestigen");
  const tags=await tagsResponse.json() as any;
  const modelDigest=tags.models?.find((item:any)=>item.name===model)?.digest;
  assert.match(modelDigest||"",/^[a-f0-9]{64}$/,"Onbekende modelhash");
  const versionResponse=await fetch(host+"/api/version",{signal:AbortSignal.timeout(10000)});
  assert.equal(versionResponse.ok,true);
  const ollamaVersion=(await versionResponse.json() as any).version;
  assert.equal(typeof ollamaVersion,"string");
  const generated:Array<{path:string;sha256:string}>=[];
  const checks:Array<{step:number;phase:string;status:string;imageId:string|null;manifestSha256:string}>=[];
  const workspace=new LocalCodeWorkspace({workspaceDir:project,profileDir:profile,
    host,model,timeoutMs:120000});
  const app=createDemoServer({codeWorkspace:workspace,persistentDir:profile,
    schedulerIntervalMs:0,projectSuiteRunner:runIsolatedProjectSuite,
    seedDemoData:false,localLiveView:true});
  try{
    assert.ok(existsSync(join(project,"acceptance/final-product.test.js")));
    const premature=await testAcceptedProduct(project);
    assert.equal(premature.status,"failed",
      "De geïsoleerde oplevercontrole moet vóór de wijzigingen mislukken.");
    assert.equal(premature.testsExecuted,true,
      "De negatieve eindtest moet daadwerkelijk in Docker zijn uitgevoerd.");
    assert.equal(readFileSync(join(project,"src/amount.js"),"utf8"),"export const amount = 10;\n");
    await new Promise<void>(resolve=>app.server.listen(0,"127.0.0.1",resolve));
    const origin="http://127.0.0.1:"+((app.server.address() as AddressInfo).port);
    const call=async(path:string,body?:unknown,token=app.token)=>{
      const response=await fetch(origin+path,{
        method:body===undefined?"GET":"POST",
        headers:{Authorization:"Bearer "+token,
          ...(body===undefined?{}:{"content-type":"application/json"})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      });
      return {status:response.status,data:await response.json()};
    };
    assert.notEqual((await call("/ops/code/plans",undefined,"wrong-token")).status,200);
    const created=await call("/ops/code/plans",{
      title:"Eerste bruikbare product",steps,suitePolicy:"project-node-v1"
    });
    assert.equal(created.status,200,JSON.stringify(created.data));
    const id=created.data.id;
    assert.equal(created.data.nextStep,0);
    for(let i=0;i<steps.length;i++){
      const proposed=await call("/ops/code/plan/propose",{planId:id});
      assert.equal(proposed.status,200,JSON.stringify(proposed.data));
      const proposalId=proposed.data.proposalId;
      const item=await call("/ops/code/proposal?id="+proposalId);
      assert.equal(item.status,200);
      assert.equal(item.data.path,steps[i].path);
      assert.match(item.data.replacementSha256,/^[a-f0-9]{64}$/);
      generated.push({path:item.data.path,sha256:item.data.replacementSha256});
      const permission={planId:id,proposalId,
        expectedSha256:item.data.replacementSha256,approve:true};
      assert.equal((await call("/ops/code/plan/apply",permission)).status,409,
        "Een modelvoorstel mag niet zonder voorafgaande test worden toegepast.");
      const pre=await call("/ops/code/plan/test-project-pre",{planId:id,proposalId});
      assert.equal(pre.status,200,JSON.stringify(pre.data));
      assert.equal(pre.data.result.status,"passed",pre.data.result.output);
      assert.equal(pre.data.result.testsExecuted,true);
      assert.equal(pre.data.result.proofFormat,"tap-named-v2");
      assert.match(pre.data.result.imageId,/^sha256:[a-f0-9]{64}$/);
      checks.push({step:i+1,phase:"voor toepassing",status:pre.data.result.status,
        imageId:pre.data.result.imageId,manifestSha256:pre.data.result.manifestSha256});
      const applied=await call("/ops/code/plan/apply",permission);
      assert.equal(applied.status,200,JSON.stringify(applied.data));
      const post=await call("/ops/code/plan/test-project-post",{planId:id,proposalId});
      assert.equal(post.status,200,JSON.stringify(post.data));
      assert.equal(post.data.result.status,"passed",post.data.result.output);
      assert.equal(post.data.result.testsExecuted,true);
      assert.equal(post.data.result.proofFormat,"tap-named-v2");
      checks.push({step:i+1,phase:"na toepassing",status:post.data.result.status,
        imageId:post.data.result.imageId,manifestSha256:post.data.result.manifestSha256});
      assert.equal(post.data.plan.steps[i].status,"done");
    }
    assert.deepEqual(generated.map(item=>item.path),steps.map(step=>step.path),
      "Precies twee echte Ollama-voorstellen, in de opgegeven volgorde.");
    const plans=await call("/ops/code/plans");
    assert.equal(plans.status,200);
    const completed=plans.data.plans.find((p:any)=>p.id===id);
    assert.equal(completed?.state,"done","De codewerkopdracht moet afgerond zijn.");
    const final=await testAcceptedProduct(project);
    assert.equal(final.status,"passed",
      "Het opgeleverde product voldoet niet aan de vraag: "+final.output);
    assert.equal(final.testsExecuted,true,
      "Een lege of overgeslagen test mag nooit als geslaagde oplevering tellen.");
    assert.equal((await call("/ops/verify")).data.ok,true);
    const proof=(await call("/ops/code/plan?id="+encodeURIComponent(id))).data.proof;
    assert.equal(proof.status,"current");
    assert.equal(proof.scope,"planned-files-only");
    assert.match(proof.manifestSha256,/^[a-f0-9]{64}$/);
    const result={
      opdracht:"Eerste bruikbare product",status:"opgeleverd binnen deze afgebakende proef",
      model,modelDigest,ollamaVersion,modelCalls:generated.length,
      generated,docker:"werkelijk uitgevoerd",
      gecontroleerdeBestanden:steps.map(step=>step.path),
      eindtest:"geslaagd in afgeschermde Docker-container",
      acceptanceManifestSha256:final.manifestSha256,publicatie:"niet uitgevoerd"
    };
    const output=process.env.EAI_FIRST_PRODUCT_OUTPUT_DIR;
    if(output){
      if(output.startsWith("/")||output.includes("..")||
         !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(output))
        throw new Error("Gebruik alleen een relatieve, veilige uitvoermap.");
      const target=resolve(output);
      if(existsSync(target))throw new Error("De uitvoermap bestaat al: "+target);
      mkdirSync(dirname(target),{recursive:true});
      cpSync(project,target,{recursive:true});
      const delivered=await testAcceptedProduct(target);
      assert.equal(delivered.status,"passed","De gekopieerde oplevering werkt niet: "+delivered.output);
      assert.equal(delivered.testsExecuted,true);
      writeFileSync(join(target,"OPLEVERING.md"),
        "# EAIwork eerste productproef\\n\\n"+
        "Dit is een klein JavaScript-voorbeeld, geen complete gebruikersapplicatie.\\n"+
        "Twee bestanden zijn via EAIwork gewijzigd en vóór en na het toepassen samen in Docker getest.\\n"+
        "De eindcontrole is apart uitgevoerd op het gekopieerde resultaat.\\n\\n"+
        "**Controleer zelf:** voer in deze map uit: \\n\\n"+
        "\\`\\`\\`sh\\nnode --test acceptance/final-product.test.js\\n\\`\\`\\`\\n\\n"+
        "Alle codevoorstellen kwamen van het genoemde echte Ollama-model. Er is niets gepubliceerd.\\n");
      writeFileSync(join(target,"PROEFRESULTAAT.json"),JSON.stringify({
        ...result,tests:checks,
        acceptatietest:{status:"geslaagd in Docker op gekopieerde bestanden",
          manifestSha256:delivered.manifestSha256,imageId:delivered.imageId,
          testsExecuted:delivered.testsExecuted},
        omvang:"twee bestanden, geen compleet product"
      },null,2)+"\\n");
      process.stdout.write("EAIwork bewijsbestanden opgeslagen in "+target+"\\n");
    }
    process.stdout.write("EAIwork eerste productproef: "+JSON.stringify(result)+"\\n");
  }finally{
    await app.close();
    rmSync(root,{force:true,recursive:true});
  }
});
