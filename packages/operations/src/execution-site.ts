/** Pure EAIwork execution-site selection. A request preference is never
 * runtime authority. The trusted host advertises actual connected sites;
 * the normal worker registry, permissions, contract and release still gate runs.
 * The mode does not change the meaning of MissionTask.effect ("local" is
 * side-effect classification, not a device/network location).
 */
export type ExecutionPreference="auto"|"local"|"cloud";
export type ExecutionSite="local"|"cloud";
export type ExecutionSiteInfo={
  id:ExecutionSite;
  connected:boolean;
  /** Only trusted host adapters that were actually checked, not catalog roles. */
  taskKinds:readonly string[];
};
export type ExecutionDecision={
  requested:ExecutionPreference;
  site:ExecutionSite|null;
  status:"routable"|"site-unavailable"|"worker-unavailable";
  reason:string;
};
const order:readonly ExecutionSite[]=["local","cloud"];
/** Selection is read-only and fail-closed: never cross an explicit preference. */
export function chooseExecutionSite(
  taskKind:string,
  requested:ExecutionPreference,
  sites:readonly ExecutionSiteInfo[],
):ExecutionDecision {
  if(!["auto","local","cloud"].includes(requested)||
     typeof taskKind!=="string"||!taskKind.trim()||
     !Array.isArray(sites)||
     new Set(sites.map(x=>x.id)).size!==sites.length||
     sites.some(s=>!s||!order.includes(s.id)||typeof s.connected!=="boolean"||
       !Array.isArray(s.taskKinds)||s.taskKinds.some(k=>typeof k!=="string"||!k.trim())))
    throw new Error("Ongeldige keuze of uitvoerregistratie");
  const available=sites.filter(s=>s.connected&&s.taskKinds.includes(taskKind));
  // Prefer local only if the trusted host confirms it is actually connected.
  const selected=(requested==="auto"
    ?order.map(id=>available.find(s=>s.id===id)).find(Boolean)
    :available.find(s=>s.id===requested))??null;
  if(selected)return {requested,site:selected.id,status:"routable",
    reason:"Uitvoeromgeving gekoppeld; uitvoerrechten en workercontract worden vóór de start opnieuw gecontroleerd."};
  if(requested==="local"&&!sites.some(s=>s.id==="local"&&s.connected))
    return {requested,site:null,status:"site-unavailable",
      reason:"Er is geen lokale uitvoerder veilig gekoppeld aan deze browserwerkruimte."};
  if(requested==="cloud"&&!sites.some(s=>s.id==="cloud"&&s.connected))
    return {requested,site:null,status:"site-unavailable",
      reason:"Er is geen cloud-uitvoerder gekoppeld."};
  return {requested,site:null,status:"worker-unavailable",
    reason:requested==="auto"
      ?"Geen verbonden uitvoeromgeving ondersteunt deze taak. Er wordt niets op een ander apparaat gestart."
      :"De gekozen uitvoeromgeving heeft geen toegelaten adapter voor dit soort werk."};
}
export const CLOUD_PILOT_SITES:readonly ExecutionSiteInfo[]=Object.freeze([
  {id:"local",connected:false,taskKinds:[]},
  {id:"cloud",connected:true,taskKinds:["text-inspect","csv-dashboard"]},
]);
