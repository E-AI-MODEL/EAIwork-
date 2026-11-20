# EAIwork: eigen agentbesturing, voortbouwen op het bestaande product

**Status:** bouwstap in concept. Geen zelfstandige cloudagent en geen publicatie op eaimodel.nl. Geen Codex SDK, geen externe agent-runtime en geen nieuwe workerbibliotheek naast EAIwork.

## Wat al bestaat in de huidige code

| Onderdeel | Code | Bestaande rol |
| --- | --- | --- |
| Bewijs en herkomst | `packages/core`, `packages/evidence`, `packages/server` | Atomen, bronherkomst, onafhankelijke checks, apart ondertekend bewijslog en begrensde modelclaims |
| Werkplannen | `operations/missions.ts`, `planner.ts`, `preflight.ts`, `replan.ts` | Fases, taakafhankelijkheden, bronpassages met voorwaarden, planvoorstellen en append-only revisies |
| Workerleger | `catalog.ts`, `registry.ts`, `selector.ts` | 56 beschreven specialisaties, echt geteste en toegelaten contractsversies, selectie op feitelijk beschikbare adapters |
| Uitvoering | `execution.ts`, `scheduler.ts`, `parallel.ts`, `queue.ts`, `executor-channel.ts` | Lokale workers, goedgekeurde budgets, leases, twee parallelle teksttaken, afzonderlijke uitvoerders met beperkte rechten |
| Code | `code-worker.ts`, `ordered-code-plans.ts`, `docker-project-suite.ts` | Codevoorstellen en meerstapsplannen, gescheiden testen, expliciete menselijke toepassing en herstel |
| Brononderzoek | `reposearch.ts` | Begrensd zoeken in een beheerdersgestuurde lokale repository |
| Kwaliteit | `quality.ts`, registerdefecten en reparatie-events | Versiegebonden metingen, driftwaarschuwingen, quarantaine en maximaal drie geregistreerde herstelpogingen |
| Resultaat en oplevering | `trace.ts`, `production-line.ts`, release- en GitHub-artifactmodules | Afgeleide voortgang, echte geschiedenis, CI-/artifactcontrole en een niet-automatische uitgiftebeoordeling |
| Interface | `prototypes/dashboard/index.html`, `packages/client` | Bestaande live lokale werkruimte en afzonderlijke browserdemonstratie |
| Opslag | `operations/store.ts` en bewijsjournal | Duurzame, replaybare events, verschillende vertrouwensgrenzen voor werk en bewijs |

De bestaande interfaces en workercontracten zijn dus leidend. De 56 specialisaties zijn **niet** 56 actieve agents. Een geslaagde Docker-test is geen bewijs dat een eindproduct inhoudelijk klopt. De operations-journal heeft nog geen onafhankelijke externe witness zoals het bewijslog.

## Wat de nieuwe bouwstap wel doet

`packages/operations/src/agent-loop.ts` voert een gecontroleerde cyclus uit over een **bestaand, door een persoon goedgekeurd** missieplan:

1. Bekijk de actuele taakstatus, afhankelijkheden en open voorwaarden.
2. Stop bij een actieve scheduler, lopende of mislukte taak, pauze of ontbrekende toestemming.
3. Start maximaal één goedgekeurde lokale worker per beslissing via de bestaande `runMissionStep`. De runner controleert contract, versie, adapter, bron en taakstatus opnieuw.
4. Controleer dat de uitkomst is geregistreerd. Technische afronding krijgt geen extra bewijsstatus.
5. Stop bij het afgesproken maximum (1-8 per expliciet verzoek), voltooiing of blokkade.
6. Een optioneel taalmodel mag bij een niet-veiligheidsgerelateerde blokkade een **niet-toegepaste** revisie voorstellen. Alleen de missie-eigenaar kan de versie via de bestaande route goedkeuren.

De route `POST /ops/missions/:id/agent/cycle` gebruikt de bestaande serveridentiteit en auditbevoegdheid. Het is geen tweede authsysteem. In het **bestaande live dashboard** onder Uitvoering staat nu de knop `Agent: maximaal 2 stappen`. De knop vraagt één afgebakende uitvoering aan, haalt de echte voortgang opnieuw op en gebruikt dezelfde productielijn. Hij verschijnt niet als werkende knop op de publieke website; daar staat alleen de losse demonstratie.

## Wat deze code nog niet verbindt

Deze eerste agent-cyclus gebruikt alleen de bestaande, lokale mission-runner. Hij bestuurt **nog niet** zelfstandig RepoSearch, de Codeworker, Docker, Worker Builder, herstel, de releaseketen of de browserinterface. Ze bestaan wel als afzonderlijke, deels werkende routes en contracten. We voegen hiervoor geen parallelle implementaties toe.

De nieuwe route geeft ook de bestaande `productionLineView` terug, zodat werkplan, workers, uitvoering, beoordeling en vrijgave niet in een tweede statusadministratie belanden. De volgende *volledige* productverbinding moet precies deze overgangen koppelen:

- Vraag -> planvoorstel -> bronvoorwaarden controleren -> expliciete goedkeuring
- Plan -> Worker Registry en RepoSearch -> geschikte beschikbare uitvoerder -> beperkte uitvoering
- Voor code: bestaande meerstaps-codeplannen -> voorstel -> Docker-projecttest -> menselijke goedkeuring -> status
- Na fouten: diagnose / gemeten defect -> geteste herstelkandidaat -> hoogstens drie pogingen -> menselijke beslissing
- Resultaat -> bron- en outputcontrole -> vrijgavedossier -> onafhankelijke verificatie en besluit

De regellus **mag niet** zelf beslissen dat een worker is toegelaten, een nieuwe versie productierijp is, een bron semantisch bewijs levert of een opdracht gepubliceerd mag worden. De ontbrekende koppelingen worden zichtbaar als `needs-review` of `blocked`, niet als verzonnen voltooiing.

## Controle

`node --test tests/agent-loop.test.ts tests/agent-loop-api.test.ts tests/agent-loop-ui.test.ts` test de nieuwe beperkte cyclus met echte server en operationslog, maar geen extern model. `npm test`, de Docker-CI en een afzonderlijke modelproef zijn nodig voordat we over een geslaagde integratie kunnen spreken.

De eerste publieke ingang op `eaimodel.nl/work/` blijft informatief. De statische pagina is niet geschikt om secrets of een lokale codeworker rechtstreeks vanuit een browser beschikbaar te maken.
