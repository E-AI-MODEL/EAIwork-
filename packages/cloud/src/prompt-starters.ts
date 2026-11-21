/**
 * Curated EAIwork prompt starters. These are user-facing instructions only:
 * no privilege, worker, model or evidence authority follows from selection.
 * Availability is scoped to the current browser pilot.
 */
export type PromptGroup="data"|"tekst"|"software";
export type PromptSource="csv"|"text"|"none";
export type PromptStarter={
  id:string;
  title:string;
  group:PromptGroup;
  instruction:string;
  summary:string;
  source:PromptSource;
  supported:boolean;
};
export const PROMPT_STARTERS:readonly PromptStarter[]=Object.freeze([
  {id:"csv-dashboard",title:"Interactief dashboard",group:"data",
   instruction:"Bouw een interactief dashboard met zoeken, categoriefilter, staafdiagram en gegevensoverzicht van deze CSV-gegevens.",
   summary:"CSV, zoeken, filter, grafiek en tabel",source:"csv",supported:true},
  {id:"csv-overzicht",title:"Gegevensoverzicht",group:"data",
   instruction:"Maak een dashboard met een tabel, aantallen, categoriefilter en grafiek van deze CSV-gegevens.",
   summary:"Dezelfde geteste CSV-template met alle onderdelen",source:"csv",supported:true},
  {id:"tekstcontrole",title:"Tekstinspectie",group:"tekst",
   instruction:"Tel de woorden, tekens en regels in deze tekst.",
   summary:"Vaste telling met de vrijgegeven tekstworker",source:"text",supported:true},
  {id:"webapp",title:"Webapp ontwikkelen",group:"software",
   instruction:"Bouw een eenvoudige webapp met een duidelijke gebruikersinterface. Onderzoek bestaande code, stel een plan op, laat tests zien en vraag toestemming voor toepassing.",
   summary:"Voorstel bewaren, Codeworker nog niet gekoppeld",source:"none",supported:false},
  {id:"repo-review",title:"Repository onderzoeken",group:"software",
   instruction:"Onderzoek de structuur van een GitHub-repository en geef een onderbouwd voorstel voor hergebruik, wijzigingen en benodigde tests. Voer geen wijzigingen uit zonder mijn toestemming.",
   summary:"Nog geen online RepoSearch-worker gekoppeld",source:"none",supported:false},
]);
/** Data-only filtering, does not select workers or start execution. */
export function selectPromptStarters(group:"all"|PromptGroup,
  availability:"all"|"available"|"unavailable",query=""):PromptStarter[]{
  const q=query.toLocaleLowerCase("nl-NL").trim();
  return PROMPT_STARTERS.filter(p=>
    (group==="all"||p.group===group)&&
    (availability==="all"||(availability==="available"&&p.supported)||
      (availability==="unavailable"&&!p.supported))&&
    (!q||[p.title,p.summary,p.instruction].some(s=>
      s.toLocaleLowerCase("nl-NL").includes(q))));
}
