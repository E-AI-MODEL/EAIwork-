/**
 * A complete, non-publishing first-product proof:
 * two HTTP-approved code changes, real Docker checks on both stages,
 * and an independent final user-requirement test.
 * The Ollama chat response is stubbed; this proves the execution route,
 * not model quality or autonomous planning.
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {spawnSync} from "node:child_process";
import {cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname,resolve} from "node:path";
import type {AddressInfo} from "node:net";
import {fileURLToPath} from "node:url";
import {LocalCodeWorkspace} from "../packages/operations/src/code-worker.ts";
import {runIsolatedProjectSuite} from "../packages/operations/src/docker-project-suite.ts";
import {createDemoServer} from "../scripts/local-demo.ts";

const enabled=process.env.EAI_FIRST_PRODUCT_SMOKE==="1";
const example=fileURLToPath(new URL("../examples/multifile-smoke/",import.meta.url));
const steps=[
  {path:"src/amount.js",testPath:"tests/amount.test.js",
    instruction:"Verander de export amount van 10 naar 12. Behoud de naam amount."},
  {path:"src/invoice.js",testPath:"tests/invoice.test.js",
    instruction:"Voeg een export function totalWithShipping(shipping = 0) toe die amount * 2 + shipping teruggeeft. Behoud de export total."}
];
// Remove the parent node:test marker: otherwise a nested Node runner silently skips tests.
const acceptanceEnv=()=>Object.fromEntries(Object.entries(process.env)
  .filter(([key])=>key!=="NODE_TEST_CONTEXT"));
const replacements:Record<string,string>={
  "src/amount.js":"export const amount = 12;\n",
  "src/invoice.js":'import {amount} from "./amount.js";\nexport const total = amount * 2;\nexport function totalWithShipping(shipping = 0) {\n  return amount * 2 + shipping;\n}\n'
};
test("eerste volledige productproef: lokaal HTTP → voorstel → echte Docker-test → akkoord → eindproduct",{
  skip:enabled?false:"Deze proef draait apart met EAI_FIRST_PRODUCT_SMOKE=1 en Docker."
},async()=>{
  const root=mkdtempSync(join(tmpdir(),"eaiwork-first-product-"));
  const project=join(root,"project"),profile=join(root,"profile");
  cpSync(example,project,{recursive:true});
  mkdirSync(profile);
  const generated:string[]=[];
  const checks:Array<{step:number;phase:string;status:string;imageId:string|null;manifestSha256:string}>=[];
  const ollama=createServer(async(req,res)=>{
    if(req.method!=="POST"||req.url!=="/api/chat"){res.writeHead(404);res.end();return}
    let body="";
    for await(const chunk of req)body+=chunk;
    const call=JSON.parse(body);
    const input=JSON.parse(call.messages[0].content);
    const replacement=replacements[input.path];
    if(!replacement){res.writeHead(400);res.end();return}
    generated.push(input.path);
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({message:{content:JSON.stringify({
      replacement,explanation:"Voer de gevraagde wijziging door",
      checks:["Controleer de twee modules samen"]
    })}}));
  });
  await new Promise<void>(resolve=>ollama.listen(0,"127.0.0.1",resolve));
  const host="http://127.0.0.1:"+((ollama.address() as AddressInfo).port);
  const workspace=new LocalCodeWorkspace({workspaceDir:project,profileDir:profile,
    host,model:"lokale-test"});
  const app=createDemoServer({codeWorkspace:workspace,persistentDir:profile,
    schedulerIntervalMs:0,projectSuiteRunner:runIsolatedProjectSuite,
    seedDemoData:false,localLiveView:true});
  try{
    assert.ok(existsSync(join(project,"acceptance/final-product.test.js")));
    const premature=spawnSync(process.execPath,["--test","acceptance/final-product.test.js"],{
      cwd:project,encoding:"utf8",timeout:10000,env:acceptanceEnv()
    });
    assert.notEqual(premature.status,0,
      "De oplevercontrole moet vóór de wijzigingen mislukken.");
    assert.match(premature.stdout,/^# tests [1-9][0-9]*$/m,
      "De negatieve eindtest moet daadwerkelijk worden uitgevoerd.");
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
      const permission={planId:id,proposalId,
        expectedSha256:item.data.replacementSha256,approve:true};
      assert.equal((await call("/ops/code/plan/apply",permission)).status,409,
        "Een modelvoorstel mag niet zonder voorafgaande test worden toegepast.");
      const pre=await call("/ops/code/plan/test-project-pre",{planId:id,proposalId});
      assert.equal(pre.status,200,JSON.stringify(pre.data));
      assert.equal(pre.data.result.status,"passed",pre.data.result.output);
      assert.equal(pre.data.result.testsExecuted,true);
      assert.match(pre.data.result.imageId,/^sha256:[a-f0-9]{64}$/);
      checks.push({step:i+1,phase:"voor toepassing",status:pre.data.result.status,
        imageId:pre.data.result.imageId,manifestSha256:pre.data.result.manifestSha256});
      const applied=await call("/ops/code/plan/apply",permission);
      assert.equal(applied.status,200,JSON.stringify(applied.data));
      const post=await call("/ops/code/plan/test-project-post",{planId:id,proposalId});
      assert.equal(post.status,200,JSON.stringify(post.data));
      assert.equal(post.data.result.status,"passed",post.data.result.output);
      assert.equal(post.data.result.testsExecuted,true);
      checks.push({step:i+1,phase:"na toepassing",status:post.data.result.status,
        imageId:post.data.result.imageId,manifestSha256:post.data.result.manifestSha256});
      assert.equal(post.data.plan.steps[i].status,"done");
    }
    assert.deepEqual(generated,steps.map(step=>step.path),
      "Precies twee modelvoorstellen, in de opgegeven volgorde.");
    const plans=await call("/ops/code/plans");
    assert.equal(plans.status,200);
    const completed=plans.data.plans.find((p:any)=>p.id===id);
    assert.equal(completed?.state,"done","De codewerkopdracht moet afgerond zijn.");
    const final=spawnSync(process.execPath,["--test","acceptance/final-product.test.js"],{
      cwd:project,encoding:"utf8",timeout:10000,env:acceptanceEnv()
    });
    assert.equal(final.status,0,"Het opgeleverde product voldoet niet aan de vraag:\n"+final.stdout+"\n"+final.stderr);
    assert.match(final.stdout,/^# tests [1-9][0-9]*$/m,
      "Een lege of overgeslagen test mag nooit als geslaagde oplevering tellen.");
    assert.equal((await call("/ops/verify")).data.ok,true);
    const proof=(await call("/ops/code/plan?id="+encodeURIComponent(id))).data.proof;
    assert.equal(proof.status,"current");
    assert.equal(proof.scope,"planned-files-only");
    assert.match(proof.manifestSha256,/^[a-f0-9]{64}$/);
    const result={
      opdracht:"Eerste bruikbare product",status:"opgeleverd binnen deze afgebakende proef",
      model:"nagebootst Ollama-antwoord",docker:"werkelijk uitgevoerd",
      gecontroleerdeBestanden:steps.map(step=>step.path),
      eindtest:"geslaagd",publicatie:"niet uitgevoerd"
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
      const delivered=spawnSync(process.execPath,["--test","acceptance/final-product.test.js"],{
        cwd:target,encoding:"utf8",timeout:10000,env:acceptanceEnv()
      });
      assert.equal(delivered.status,0,"De gekopieerde oplevering werkt niet: "+delivered.stdout);
      assert.match(delivered.stdout,/^# tests [1-9][0-9]*$/m);
      writeFileSync(join(target,"OPLEVERING.md"),
        "# EAIwork eerste productproef\\n\\n"+
        "Dit is een klein JavaScript-voorbeeld, geen complete gebruikersapplicatie.\\n"+
        "Twee bestanden zijn via EAIwork gewijzigd en vóór en na het toepassen samen in Docker getest.\\n"+
        "De eindcontrole is apart uitgevoerd op het gekopieerde resultaat.\\n\\n"+
        "**Controleer zelf:** voer in deze map uit: \\n\\n"+
        "\\`\\`\\`sh\\nnode --test acceptance/final-product.test.js\\n\\`\\`\\`\\n\\n"+
        "De AI-antwoorden waren voor deze herhaalbare test nagebootst. Er is niets gepubliceerd.\\n");
      writeFileSync(join(target,"PROEFRESULTAAT.json"),JSON.stringify({
        ...result,tests:checks,acceptatietest:"geslaagd op gekopieerde bestanden",
        omvang:"twee bestanden, geen compleet product"
      },null,2)+"\\n");
      process.stdout.write("EAIwork bewijsbestanden opgeslagen in "+target+"\\n");
    }
    process.stdout.write("EAIwork eerste productproef: "+JSON.stringify(result)+"\\n");
  }finally{
    await app.close();
    await new Promise<void>(resolve=>ollama.close(()=>resolve()));
    rmSync(root,{force:true,recursive:true});
  }
});
