/**
 * Een catalogus van mogelijke workers, GEEN actieve processen of geteste modellen.
 * Pas na registratie, metingen, toelating en afzonderlijke runtimebevoegdheden
 * kan een worker door een scheduler worden gekozen.
 */
import type { WorkerContract } from "./registry.ts";

export type WorkerStageGroup = "plannen" | "zoeken" | "analyseren" | "uitvoeren" | "controleren" | "samenvoegen";
export type ModelSize = "small" | "medium" | "large" | "deterministic" | "auto";
export interface WorkerBlueprint {
  id: string;
  name: string;
  group: WorkerStageGroup;
  specialization: string;
  taskKinds: string[];
  suggestedModel: ModelSize;
  requiredCapabilities: string[];
  lifecycle: "design-only";
}
type Row = readonly [string, string, string, string];
const GROUPS: Record<WorkerStageGroup, Row[]> = {
  plannen: [
    ["mission-planner", "Hoofdplanner", "mission-plan", "Doel, grenzen en werkplan bepalen"],
    ["phase-planner", "Faseplanner", "phase-plan", "Werk in betekenisvolle fases verdelen"],
    ["task-decomposer", "Taakontleder", "task-decompose", "Fases naar controleerbare taken vertalen"],
    ["dependency-mapper", "Afhankelijkheidsplanner", "dependency-map", "Taakafhankelijkheden zichtbaar maken"],
    ["resource-planner", "Capaciteitsplanner", "capacity-plan", "Budget en bezetting voorstellen"],
    ["risk-planner", "Risicoplanner", "risk-plan", "Gevoelige acties en stopgrenzen herkennen"],
    ["replan-specialist", "Herplanner", "mission-replan", "Plan aanpassen aan nieuwe informatie"],
    ["goal-reviewer", "Doelbeoordelaar", "goal-review", "Toetsen of resultaat bij opdracht past"],
    ["phase-integrator", "Fase-integrator", "phase-integrate", "Faseproducten samenbrengen"],
  ],
  zoeken: [
    ["websearch", "WebSearch", "web-search", "Openbare webbronnen vinden"],
    ["research-discovery", "Onderzoekszoeker", "research-search", "Onderzoekspublicaties vinden"],
    ["knowledge-search", "Kennisbankzoeker", "knowledge-search", "Toegestane interne bronnen ophalen"],
    ["repo-search", "RepoSearch", "repo-search", "Code en tests in repositories opsporen"],
    ["documentation-search", "Documentatiezoeker", "docs-search", "API- en productdocumentatie vinden"],
    ["legal-source-search", "Wetgevingszoeker", "legal-search", "Wetten en regelingen opsporen"],
    ["source-versioner", "Bronversiebeheer", "source-version", "Bronversie en vervaldatum vastleggen"],
    ["source-deduplicator", "Bronontdubbelaar", "source-dedupe", "Gelijke bronfamilies herkennen"],
    ["source-reranker", "Bronselectie", "source-rank", "Zoekresultaten ordenen met broncontext"],
  ],
  analyseren: [
    ["document-extractor", "Documentextractie", "document-extract", "Gerichte gegevens uit bestanden halen"],
    ["claim-extractor", "Beweringenextractie", "claim-extract", "Controleerbare uitspraken identificeren"],
    ["evidence-mapper", "Bronkoppeling", "evidence-map", "Uitspraken aan bronpassages koppelen"],
    ["contradiction-reviewer", "Tegenstrijdigheidsanalyse", "contradiction-review", "Onderlinge tegenspraak zoeken"],
    ["methodology-reviewer", "Onderzoeksmethode", "method-review", "Methoden en beperkingen vergelijken"],
    ["statistics-analyzer", "Statistische analyse", "stats-analyze", "Gegevens en berekeningen toetsen"],
    ["legal-analyst", "Juridische analyse", "legal-analyze", "Regels op casusvoorwaarden toepassen"],
    ["data-quality-analyst", "Datakwaliteit", "data-quality", "Missende, dubbele en onbetrouwbare data signaleren"],
    ["requirements-analyst", "Eisenanalyse", "requirements-analyze", "Eisen en randvoorwaarden herleiden"],
    ["architecture-analyst", "Architectuuranalyse", "architecture-analyze", "Technische afhankelijkheden onderzoeken"],
  ],
  uitvoeren: [
    ["api-integration", "API-integratie", "api-integrate", "Afgebakende API-adapters maken"],
    ["web-content", "Webcontent", "content-write", "Korte websiteonderdelen opstellen"],
    ["typescript-code", "TypeScript", "typescript-code", "TypeScript-functies schrijven"],
    ["python-code", "Python", "python-code", "Python-functies schrijven"],
    ["sql-code", "SQL", "sql-code", "SQL-queries opstellen"],
    ["html-css", "HTML/CSS", "html-css", "Semantische paginaonderdelen maken"],
    ["document-producer", "Documenten", "document-produce", "Documenten uit gestructureerde invoer maken"],
    ["spreadsheet-processor", "Spreadsheet", "spreadsheet-process", "Werkbladen bewerken en controleren"],
    ["test-author", "Testschrijver", "test-author", "Gerichte unit- en regressietests maken"],
    ["code-refactor", "Codeherstel", "code-refactor", "Afgebakende codewijzigingen uitvoeren"],
    ["repository-reuse", "Hergebruik", "repo-reuse", "Geverifieerde codepatronen aanpassen"],
    ["worker-assembler", "Worker Builder", "worker-assemble", "Workercontract en sandboxproef samenstellen"],
    ["worker-repair", "Repair Worker", "worker-repair", "Probleemgericht kandidaatherstel maken"],
    ["artifact-formatter", "Resultaatopmaak", "artifact-format", "Resultaten naar vereist formaat brengen"],
  ],
  controleren: [
    ["citation-check", "Citaatcontrole", "citation-check", "Letterlijke passages en verwijzingen controleren"],
    ["semantic-check", "Inhoudelijke broncontrole", "semantic-check", "Ondersteunt een bron de bewering?"],
    ["schema-check", "Schemavalidatie", "schema-check", "Invoer- en uitvoercontracten controleren"],
    ["unit-test-runner", "Unit-testuitvoering", "unit-test", "Afgebakende tests draaien"],
    ["security-review", "Beveiligingscontrole", "security-review", "Onbedoelde rechten en uitgaande gegevens toetsen"],
    ["license-review", "Licentiecontrole", "license-review", "Hergebruik en licentievoorwaarden toetsen"],
    ["accessibility-review", "Toegankelijkheid", "accessibility-check", "Interface op toegankelijkheid toetsen"],
    ["regression-review", "Regressiecontrole", "regression-check", "Oude en nieuwe resultaten vergelijken"],
    ["quality-measurement", "Kwaliteitsmeting", "quality-measure", "Meetresultaten per worker en versie registreren"],
  ],
  samenvoegen: [
    ["result-integrator", "Resultatenintegratie", "result-integrate", "Deelresultaten tot eindproduct maken"],
    ["consistency-checker", "Samenhangscontrole", "consistency-check", "Conflicten na samenvoegen signaleren"],
    ["provenance-reporter", "Bronverantwoording", "provenance-report", "Herkomst en beperkingen rapporteren"],
    ["delivery-check", "Oplevercontrole", "delivery-check", "Eindproduct tegen opdracht toetsen"],
    ["handoff-writer", "Overdrachtsnotitie", "handoff-write", "Open punten en vervolgwerk vastleggen"],
  ],
};
const preferred: Record<WorkerStageGroup, ModelSize> = {
  plannen:"large",zoeken:"medium",analyseren:"medium",
  uitvoeren:"small",controleren:"medium",samenvoegen:"large"
};
const modelOverride: Partial<Record<string, ModelSize>> = {
  "dependency-mapper":"deterministic","source-deduplicator":"deterministic",
  "source-versioner":"deterministic","schema-check":"deterministic",
  "unit-test-runner":"deterministic","quality-measurement":"deterministic",
  "legal-analyst":"large","methodology-reviewer":"large",
  "semantic-check":"large","worker-assembler":"medium","worker-repair":"medium",
  "test-author":"medium","architecture-analyst":"large",
  "web-content":"medium","repo-search":"medium","goal-reviewer":"large"
};
// Capabilities are requirements, not bundled tools. Operators configure adapters separately.
const capabilities: Partial<Record<string, string[]>> = {
  "websearch":["web.search"],"research-discovery":["web.search"],
  "knowledge-search":["knowledge.search"],"repo-search":["repo.search"],
  "documentation-search":["docs.search"],"legal-source-search":["web.search"],
  "source-versioner":["source.metadata"],"source-deduplicator":["source.read"],
  "source-reranker":["source.read"],"document-extractor":["file.read"],
  "evidence-mapper":["source.read"],"citation-check":["source.read"],
  "semantic-check":["source.read"],"legal-analyst":["source.read"],
  "statistics-analyzer":["data.calculate"],"data-quality-analyst":["data.read"],
  "typescript-code":["code.workspace"],"python-code":["code.workspace"],
  "sql-code":["database.schema"],"html-css":["code.workspace"],
  "api-integration":["code.workspace"],"test-author":["code.test"],
  "code-refactor":["code.workspace"],"unit-test-runner":["code.test"],
  "repository-reuse":["repo.search","code.workspace"],
  "worker-assembler":["repo.search","sandbox.build","sandbox.test"],
  "worker-repair":["sandbox.build","sandbox.test"],
  "spreadsheet-processor":["file.read","artifact.write"],
  "document-producer":["artifact.write"],"artifact-formatter":["artifact.write"],
  "security-review":["code.read"],"license-review":["repo.search"],
  "accessibility-review":["browser.inspect"],"regression-review":["code.test"]
};
const catalog: WorkerBlueprint[] = [];
for(const [group,rows] of Object.entries(GROUPS) as [WorkerStageGroup, Row[]][]) {
  for(const [id,name,taskKind,specialization] of rows){
    catalog.push(Object.freeze({
      id,name,group,specialization,taskKinds:[taskKind],
      suggestedModel:modelOverride[id]??preferred[group],
      requiredCapabilities:capabilities[id]??[],
      lifecycle:"design-only" as const,
    }));
  }
}
export const WORKER_BLUEPRINTS: readonly WorkerBlueprint[] = Object.freeze(catalog);
export const workerCatalog = () => WORKER_BLUEPRINTS.map(w=>structuredClone(w));
export const workerBlueprint = (id:string): WorkerBlueprint|undefined =>
  WORKER_BLUEPRINTS.find(w=>w.id===id);
export function draftContractFromBlueprint(id: string): WorkerContract {
  const w=workerBlueprint(id);
  if(!w)throw new Error("unknown blueprint");
  // Produces a *candidate* contract. No test results or permissions are granted.
  return {
    id:w.id,version:"0.1.0",name:w.name,specialization:w.specialization,
    taskKinds:[...w.taskKinds],
    inputSchema:{type:"object",properties:{input:{type:"object"}},required:["input"]},
    outputSchema:{type:"object",properties:{result:{type:"object"}},required:["result"]},
    tools:[...w.requiredCapabilities],requestedPermissions:[],
    modelPolicy:{preferred:w.suggestedModel},
    testSuite:"unconfigured:"+w.id,
    stopConditions:["no-usable-result","permission-required","budget-exceeded"],
  };
}
