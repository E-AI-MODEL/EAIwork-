/**
 * Standalone, fail-closed Cloudflare entrypoint.
 * No public execution API. No dependence on the Mac, Docker or Ollama.
 * Reuses native EAIwork reducers, the fixed Builder and pure text adapters.
 */
import {DurableObject} from "cloudflare:workers";
import {applyOps,type OpsEnvelope} from "../../operations/src/registry.ts";
import {cloudTransition,cloudView,digest,digestBytes,emptyOps} from "./controller.ts";
import {renderCsvDashboardHtml,type CsvDashboard} from "../../operations/src/csv-dashboard.ts";
import {html,javascript} from "./ui.ts";

interface LedgerEntry {previous:string;hash:string;envelope:OpsEnvelope}
const ZERO="0".repeat(64);
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{
  "cache-control":"no-store","x-content-type-options":"nosniff",
}});
async function replay(entries:LedgerEntry[]) {
  if(!Array.isArray(entries)||entries.length>160)throw Error("invalid private journal size");
  let previous=ZERO, state=emptyOps();
  for(const row of entries){
    if(row.previous!==previous)throw Error("journal chain mismatch");
    const expected=await digest(previous+JSON.stringify(row.envelope));
    if(row.hash!==expected)throw Error("journal hash mismatch");
    state=applyOps(state,row.envelope);
    previous=row.hash;
  }
  return {state,previous};
}
export class CloudWorkspace extends DurableObject {
  async fetch(request:Request):Promise<Response> {
    const url=new URL(request.url);
    try{
      if(request.method==="GET"&&url.pathname==="/api/state"){
        const entries=await this.ctx.storage.get<LedgerEntry[]>("journal")??[];
        const {state}=await replay(entries);
        return response(cloudView(state));
      }
      if(request.method==="GET"&&url.pathname==="/api/artifact"){
        const id=url.searchParams.get("missionId")??"";
        const mode=url.searchParams.get("mode")??"download";
        if(!/^mission-[a-z0-9-]{8,55}$/.test(id)||
           !["download","preview"].includes(mode)||
           [...url.searchParams.keys()].some(k=>!["missionId","mode"].includes(k)))
          return response({error:"Ongeldig artifactverzoek"},400);
        const entries=await this.ctx.storage.get<LedgerEntry[]>("journal")??[];
        const {state}=await replay(entries);
        const mission=state.missions[id],task=mission?.tasks["task-inspect"];
        const result=task?.run?.output;
        if(!mission||!task||task.status!=="done"||
           task.spec.taskKind!=="csv-dashboard"||
           result?.kind!=="csv-dashboard-v1"||
           typeof result.artifactSha256!=="string")
          return response({error:"Geen afgerond HTML-artifact beschikbaar"},404);
        const html=renderCsvDashboardHtml(result as unknown as CsvDashboard);
        if(await digestBytes(html)!==result.artifactSha256)
          return response({error:"De opgeslagen artifacthash komt niet overeen"},503);
        const fileName="eaiwork-dashboard-"+id.slice(-12)+".html";
        return new Response(html,{headers:{
          "content-type":"text/html; charset=utf-8",
          "cache-control":"private, no-store",
          "x-content-type-options":"nosniff",
          "referrer-policy":"no-referrer",
          "content-disposition":mode==="download"?
            'attachment; filename="'+fileName+'"':'inline',
          "content-security-policy":"sandbox allow-scripts; default-src 'none'; "+
            "script-src 'unsafe-inline'; style-src 'unsafe-inline'; "+
            "connect-src 'none'; img-src 'none'; font-src 'none'; "+
            "form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
        }});
      }
      if(request.method!=="POST"||url.pathname!=="/api/action")
        return response({error:"Onbekende route"},404);
      if(request.headers.get("content-type")?.split(";")[0]!=="application/json")
        return response({error:"JSON vereist"},415);
      const raw=await request.text();
      if(raw.length>12500)return response({error:"Invoer te lang"},413);
      let input:unknown;
      try{input=JSON.parse(raw)}catch{return response({error:"Ongeldige JSON"},400)}
      const actorId=request.headers.get("x-eai-owner");
      if(actorId!=="person:cloud-owner")return response({error:"Onbevoegde route"},403);
      const outcome=await this.ctx.storage.transaction(async txn=>{
        const entries=await txn.get<LedgerEntry[]>("journal")??[];
        const {state,previous}=await replay(entries);
        const changed=await cloudTransition(state,input,actorId);
        if(entries.length+changed.events.length>160)throw Error("journal limit reached");
        let last=previous;
        const newRows:LedgerEntry[]=[];
        for(const envelope of changed.events){
          const hash=await digest(last+JSON.stringify(envelope));
          newRows.push({previous:last,hash,envelope});
          last=hash;
        }
        await txn.put("journal",entries.concat(newRows));
        return {result:changed.result,state:cloudView(changed.next)};
      });
      return response(outcome);
    }catch(error){
      // Error messages are bounded and never include the supplied text.
      const msg=error instanceof Error?error.message:"Onbekende fout";
      if(/journal chain|journal hash|invalid private journal/.test(msg))
        return response({error:"Werklog niet verifieerbaar. Bewerken gestopt."},503);
      if(/input|type|script|code|runtime|Cloudflare/.test(msg))
        return response({error:"Opdracht geweigerd. Controleer de invoer."},422);
      return response({error:msg.slice(0,180)},422);
    }
  }
}
async function authorized(env:Record<string,unknown>,ctx:any):Promise<boolean> {
  // Cloudflare Access does the authentication, not a browser header or query.
  // Neither a missing Access integration nor a missing allowlisted account
  // must ever produce a usable web app.
  const audience=env.EAI_ACCESS_AUD,email=env.EAI_ALLOWED_EMAIL;
  if(typeof audience!=="string"||!audience.trim()||
     typeof email!=="string"||!email.includes("@")||
     !ctx?.access||ctx.access.aud!==audience)return false;
  try{
    const identity=await ctx.access.getIdentity();
    return typeof identity?.email==="string"&&
      identity.email.trim().toLowerCase()===email.trim().toLowerCase();
  }catch{return false}
}
export default {
  async fetch(request:Request,env:Record<string,unknown>,ctx:any):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/healthz")
      return response({ok:true,service:"eaiwork-cloud",access:"required"});
    if(!(await authorized(env,ctx)))
      return new Response("Deze besloten EAIwork-werkruimte is nog niet vrijgegeven via Cloudflare Access.",{
        status:403,headers:{"content-type":"text/plain; charset=utf-8","cache-control":"no-store"}});
    const headers={
      "cache-control":"no-store","x-content-type-options":"nosniff",
      "x-frame-options":"DENY","referrer-policy":"no-referrer",
      "strict-transport-security":"max-age=31536000; includeSubDomains",
    };
    if(request.method==="GET"&&url.pathname==="/")
      return new Response(html,{headers:{...headers,"content-type":"text/html; charset=utf-8",
        "content-security-policy":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
    if(request.method==="GET"&&url.pathname==="/app.js")
      return new Response(javascript,{headers:{...headers,"content-type":"text/javascript; charset=utf-8"}});
    if(!["/api/state","/api/action","/api/artifact"].includes(url.pathname))
      return response({error:"Onbekende route"},404);
    if(request.method==="POST"){
      if(url.pathname!=="/api/action")return response({error:"Niet toegestaan"},405);
      // Same-origin JSON writes only. Access cookies never authorize a
      // cross-origin form or a request with no Origin.
      if(request.headers.get("origin")!==url.origin)
        return response({error:"Ongeldige herkomst van de aanvraag"},403);
    }else if(request.method!=="GET"||!["/api/state","/api/artifact"].includes(url.pathname)){
      return response({error:"Methode niet toegestaan"},405);
    }
    if(!ctx?.exports?.CloudWorkspace)
      return response({error:"Beveiligde opslag ontbreekt"},503);
    const stub=ctx.exports.CloudWorkspace.get(ctx.exports.CloudWorkspace.idFromName("solo-workspace-v1"));
    const internal=new Request("https://eaiwork.internal"+url.pathname+
      (url.pathname==="/api/artifact"?url.search:""),{
      method:request.method,
      headers:{"content-type":"application/json","x-eai-owner":"person:cloud-owner"},
      ...(request.method==="POST"?{body:await request.text()}:{})});
    const res=await stub.fetch(internal);
    const outHeaders=new Headers(res.headers);
    for(const [key,value]of Object.entries(headers))outHeaders.set(key,value);
    return new Response(res.body,{status:res.status,headers:outHeaders});
  },
};
