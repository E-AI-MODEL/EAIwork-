# EAIwork: Orchestrator en Worker Builder

Status: **eerste volledige lokale Builder-proef, geen cloudagent of productiepublicatie**. Deze aanpassing vervangt de redundante `agent-loop.ts` uit de eerdere concept-PR. De bestaande scheduler en missie-uitvoering blijven de enige uitvoerders van reguliere taken.

## Welk probleem wordt opgelost?

Een missie kan wachten omdat geen geschikte en vrijgegeven worker beschikbaar is. EAIwork kon dat al signaleren via `selectWorker`. De losse Builder kon ook al een **vaste** lokale samenstelling voorstellen. Die twee routes waren nog niet verbonden met een werkelijke missie. Deze proef verbindt dat tekort aan registratie, een uitgevoerde fixturesuite, menselijke vrijgave en het voortzetten van dezelfde missie.

Dit is de eerste controleerbare bijdrage van de Orchestrator. De Orchestrator start **zelf geen taken** en krijgt geen extra rechten. De bestaande `runMissionStep`, scheduler, workerregistry en het operationslog blijven leidend.

## Bestaande onderdelen blijven behouden

- `packages/core` en `packages/evidence`: bewijsregels, bronherkomst en inhoudelijke status zijn gescheiden van technische werkuitvoering.
- `operations/missions.ts`, `planner.ts`, `preflight.ts`, `replan.ts`: opdrachtplannen, afhankelijke taken, voorwaarden en menselijke goedkeuring.
- `operations/catalog.ts`, `registry.ts`, `selector.ts`: 56 beschreven workerrollen, echte toegelaten contractversies en selectie op daadwerkelijk aanwezige adapters.
- `operations/builder.ts`: kandidaat uit twee bestaande lokale bewerkingen; geen willekeurige codegeneratie.
- `operations/execution.ts`: werkelijke ingebouwde adapter, nieuwe versie- en rechtencontrole per start, lokale fixtures.
- `operations/store.ts`: duurzaam operationslog met één schrijver.
- `operations/code-worker.ts`, `ordered-code-plans.ts`, `docker-project-suite.ts`: bestaande codevoorstellen en afgeschermde tests, nog niet door deze Builder-route aangestuurd.
- `operations/reposearch.ts`, `quality.ts`, `trace.ts`, `production-line.ts`: bestaand brononderzoek, kwaliteitsregistratie, geschiedenis en zichtbare voortgang.

De eerdere EAIgit-projectworkers `inventory`, `syntax` en `report` staan op een ander, begrensd uitvoerpad. Ze worden hier niet opnieuw gebouwd.

## Werkende verticale proef

**Voorwaarden:** een eerder door een persoon vastgelegde missie met een uitvoerbare lokale `text-inspect`-taak waarvoor nog geen worker is geregistreerd.

1. `GET /ops/missions/:id/worker-needs` leest de actuele missie, afhankelijkheden, beperkingen, workerregistry en beschikbare adapters. Geen taakinput of onnodige uitvoer in de reactie.
2. De bestaande live werkruimte toont **Controleer ontbrekende workers**. Alleen bij een werkelijk geschikte vacature verschijnt **Bouw en test kandidaat**.
3. `POST /ops/missions/:id/workers/prepare` accepteert alleen `{"taskId":"task-inspect","expectedRevision":1}`, met het echte taak-ID en de actuele revisie. De aanvrager moet de oorspronkelijke missie-eigenaar zijn.
4. De server gebruikt de bestaande `proposeComposedWorker` om een `text-inspector` te maken met het vaste, geteste recept `text-normalize → text-metrics`. Een onbekend of door een model aangeboden recept wordt geweigerd.
5. De server voert de *echte* lokale `evaluateBuiltin`-fixtures uit en legt registratie en meting met een apart check-actor vast in het bestaande operationslog.
6. De worker blijft `candidate`. Alleen een persoon kan met de bestaande `worker.release`-actie en exact testbewijs vrijgeven. Een verzonnen bewijsreferentie wordt geweigerd.
7. De oorspronkelijke missie blijft ongewijzigd en kan na toelating via de **bestaande** `POST /ops/missions/:id/run`-route worden vervolgd. De taskrun blijft `verification:"not-evaluated"` tot een afzonderlijke, passende inhoudelijke controle plaatsvindt.

De aanvraag wordt geweigerd bij een ontbrekende of verouderde missierevisie, niet-eigenaar, open voorwaarde, actieve scheduler, lopende of mislukte taak, externe actie, al bestaande kandidaat of ontbrekend ondersteund Builder-recept. Een tweede aanvraag kan geen dubbele worker registreren.

## Wat deze proef niet aantoont

- Dat de algemene `worker-assembler` uit de catalogus al zelfstandig nieuwe TypeScript-, Python-, document- of webworkers schrijft.
- Dat RepoSearch gevonden code inhoudelijk geschikt verklaart of uitvoerbaar maakt.
- Dat een model nieuwe uitvoerrechten, workercode of publicatierechten mag toekennen.
- Dat workerkwaliteit buiten de exacte fixtures, op echte taken of nieuwe gebruikersinvoer is vastgesteld.
- Dat een taakvoltooiing het eindresultaat controleert of een softwareversie vrijgeeft.
- Dat de website op eaimodel.nl een online agent of openbare API heeft.

De 56 rollen blijven grotendeels `design-only`. De volgende Builder-uitbreiding moet via dezelfde vacature-, test-, registratie- en vrijgaveketen **nieuwe sandbox-workers** kunnen voortbrengen, inclusief versiegebonden tests en een losse goedkeuring. Daarvoor moeten eerst de echte runtime en veilige isolatie van gegenereerde code worden toegevoegd.

## Controles

`node --test tests/orchestrator-builder-api.test.ts tests/orchestrator-ui.test.ts` is de gerichte regressieset. Controleer daarnaast `npm test`, CI, bestaande securitytests en een echte gebruikersproef op de actuele PR-head. Beschouw een groene unit- of mocktest niet als onafhankelijke acceptatie.

De publieke `/work/`-pagina blijft los van de echte lokale werkruimte.
