import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {inventory,syntax,syntaxAnnotations,combine,main} from "../packages/project-engine/src/engine.mjs";
async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),"eai-engine-"));
 try{return await fn(root)}finally{await rm(root,{recursive:true,force:true})}
}
test("inventariseert website en laat gebouwde bestanden intact",()=>fixture(async(root)=>{
 await mkdir(join(root,"dist"));await writeFile(join(root,"dist/index.html"),"<h1>demo</h1>");
 await writeFile(join(root,"README.md"),"Public test project");
 const data=await inventory(root,"site");
 assert.deepEqual(data.classification.startPaths,["dist/index.html"]);
 assert.equal(data.classification.hasReadme,true);
 assert.equal(data.executesProjectCode,false);
}));
test("herkent ZIP als los bestand en claimt niet dat GitHub uitpakt",()=>fixture(async(root)=>{
 await writeFile(join(root,"myproject.zip"),"fake fixture");
 const data=await inventory(root,"code");
 assert.ok(data.warnings.some(x=>x.includes("does not unpack")));
}));
test("gevoelige namen en symlinks blijven buiten uitvoer",()=>fixture(async(root)=>{
 await writeFile(join(root,".env"),"FAKE_SECRET=do_not_print");
 await symlink(join(root,".env"),join(root,"pointer.txt"));
 const data=await inventory(root,"code");
 assert.deepEqual(data.sensitivePaths,[".env"]);
 assert.ok(data.skipped.some(x=>x.reason==="symlink"));
 assert.ok(!JSON.stringify(data).includes("FAKE_SECRET"));
}));
test("parst scripts en dependencies zonder ze uit te voeren",()=>fixture(async(root)=>{
 await writeFile(join(root,"package.json"),JSON.stringify({dependencies:{vite:"*"},scripts:{test:"node unsafe.js"}}));
 const data=await inventory(root,"site");
 assert.equal(data.classification.framework,"vite");
 assert.deepEqual(data.classification.scriptNames,["test"]);
 assert.ok(!data.warnings.some(x=>x.includes("syntax errors")));
}));
test("syntaxiscontrole voert onbekende projectcode niet uit",()=>fixture(async(root)=>{
 await writeFile(join(root,"good.js"),'require("node:fs").writeFileSync("oops","executed");');
 await writeFile(join(root,"bad.js"),"function () {");
 await writeFile(join(root,"script.py"),'raise Exception("must never run")');
 const data=await syntax(root);
 assert.equal(data.executesProjectCode,false);
 assert.equal(data.failed,1);
 assert.equal(data.passed,2);
 assert.equal(data.files.find(x=>x.path==="bad.js").line,1);
 await assert.rejects(readFile(join(root,"oops"),"utf8"),{code:"ENOENT"});
}));
test("rapport toont niet-bewezen werking en afzonderlijke menselijke besluiten",()=>fixture(async(root)=>{
 await writeFile(join(root,"index.html"),"<!doctype html><html></html>");
 const result=combine(await inventory(root,"site"),await syntax(root));
 assert.equal(result.writes,false);
 assert.equal(result.published,false);
 assert.ok(result.markdown.includes("Wat is nog niet getest?"));
 assert.ok(result.markdown.includes("Verder met je project"));
 assert.equal(result.status,"needs-user-review");
}));
test("CLI produceert controleerbare JSON en markdown, niet alleen een mock",()=>fixture(async(root)=>{
 const project=join(root,"project");const out=join(root,"artifacts");
 await mkdir(project);
 await writeFile(join(project,"index.html"),"<p>web</p>");
 await main(["inventory",project,"site",join(out,"inventory.json")]);
 await main(["syntax",project,join(out,"syntax.json")]);
 await main(["report",join(out,"inventory.json"),join(out,"syntax.json"),out]);
 const result=JSON.parse(await readFile(join(out,"RESULTAAT.json"),"utf8"));
 assert.equal(result.project.count,1);assert.equal(result.checks.checked,0);
 assert.ok((await readFile(join(out,"ADVIES.md"),"utf8")).includes("geen standaard startbestand")===false);
}));


test("gebruikersantwoord is direct leesbaar met een concrete stap, ook bij ZIP-only",()=>fixture(async(root)=>{
 await writeFile(join(root,"project.zip"),"fixture: project files still inside archive");
 const report=combine(await inventory(root,"code"),await syntax(root));
 assert.match(report.markdown,/## Dit kun je nu doen/);
 assert.match(report.markdown,/Pak het ZIP-bestand uit/);
 assert.match(report.markdown,/niet vanzelf uit/);
 assert.match(report.markdown,/## Wat is nog niet getest\?/);
 assert.equal(report.writes,false);
}));
test("GitHub Actions toont het volledige advies direct in de samenvatting",async()=>{
 const workflow=await readFile(new URL("../.github/workflows/project-engine.yml",import.meta.url),"utf8");
 assert.ok(workflow.includes('cat rapport/ADVIES.md'));
 assert.ok(workflow.includes('"$GITHUB_STEP_SUMMARY"'));
 assert.ok(!workflow.includes('Download het artefact **eai-project-report**'));
 assert.ok(workflow.includes('Bewaar onderliggende gegevens voor controle'));
});
test("een syntaxfout geeft een herstelstap in het gebruikersantwoord",()=>fixture(async(root)=>{
 await writeFile(join(root,"index.html"),"<h1>Demo</h1>");
 await writeFile(join(root,"broken.js"),"function () {");
 const report=combine(await inventory(root,"site"),await syntax(root));
 assert.match(report.markdown,/Herstel de vastgestelde syntaxisfouten/);
 assert.equal(report.status,"needs-fix");
}));

test("Gebruikersantwoord: codefouten krijgen bestandslink en regelnummer",()=>fixture(async(root)=>{
 await writeFile(join(root,"broken.js"),"function () {");
 const project=await inventory(root,"code"),checks=await syntax(root);
 const result=combine(project,checks);
 assert.match(result.markdown,/Gevonden codefouten/);
 assert.match(result.markdown,/broken\.js/);
 assert.match(result.markdown,/regel 1/);
 assert.match(result.markdown,/Dit gaat goed/);
 assert.match(result.markdown,/Wat is nog niet getest/);
 assert.match(result.markdown,/Open EAIgit/);
 assert.match(result.markdown,/Verder met je project/);
 assert.match(result.markdown,/Syntaxisfout in/);
}));

test("GitHub-annotaties verwijzen veilig naar aangetroffen syntaxfouten",()=>fixture(async(root)=>{
 await writeFile(join(root,"bad.js"),"function () {\n");
 await writeFile(join(root,"good.js"),"console.log('ok');");
 const checked=await syntax(root),commands=syntaxAnnotations(checked);
 assert.equal(commands.length,1);
 assert.match(commands[0],/^::error file=bad\.js,line=1,title=EAIgit syntaxis::Syntaxisfout vastgesteld/);
 assert.ok(!commands[0].includes("function () {"));
 assert.deepEqual(syntaxAnnotations({schema:"eai-project-engine/syntax-v1",files:[
  {path:"weird%name\nother.js",status:"syntax-fail",line:2}
 ]}).map(x=>x.includes("%25")&&x.includes("%0A")),[true]);
}));
