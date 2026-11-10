# EAIwork: werkende ontwikkelproef en wat nog ontbreekt

Datum: 10 november 2026. **Concept-PR #23, geen productie-installatie.**
De oorspronkelijke bewijsomgeving blijft bestaan. Een voltooide taak is nooit automatisch een bevestigde bewering.

## Wat kan nu daadwerkelijk worden uitgevoerd?

| Onderdeel | Werkelijk gedrag | Begrenzing |
| --- | --- | --- |
| Opdrachten en afhankelijkheden | Mensen registreren een goedgekeurd plan. De server valideert taken, afhankelijkheden en cycli. | Maximaal 32 taken; geen autonome langdurige scheduler. |
| Oorspronkelijke voorwaarden | Een plan bewaart tekst en exacte vindplaatsen van verboden, toestemming, voorwaarden en deadlines. | Structureel gecontroleerde vindplaatsen bewijzen niet dat de planner *alle* beperkingen heeft gevonden. |
| Menselijke toestemming | Een aangewezen persoon registreert een besluit; verboden blijven blokkeren. | Dit geeft geen directe externe uitvoeringsrechten. |
| Lokale planner via Ollama | Optioneel model maakt een taakplan als **voorstel**. | Alleen met \`EAI_PLAN_MODEL\`; niet zelf-goedkeurend; geen browsermodel van PIM. |
| Worker Registry | Contracten, immutabele versies, vrijgave op basis van vaste tests, rollback, quarantaine. | Een contract schept geen extra runtimebevoegdheden. |
| \`text-normalize\` | Voert Unicode- en witruimte-normalisatie lokaal uit. | Deterministisch en zonder externe tools. |
| \`text-metrics\` | Telt regels, woorden en tekens. | Geen semantische beoordeling. |
| \`repo-search\` | Zoekt werkelijk in een door de beheerder ingestelde lokale checkout. Retourneert bestand, regel, fragment, SHA-256 en waar beschikbaar Git-revisie. | Geen web/GitHubzoekactie, broninterpretatie, tests of automatische code-import. |
| Vaste Worker Builder | Stelt \`text-normalize\` en \`text-metrics\` samen tot \`text-inspect\`. Daarna kandidaatregistratie, serverfixtures en menselijke vrijgave. | Geen modelgegenereerde code, geen algemene assembler of sandbox voor onbekende code. |
| Uitvoering | Start maximaal vier gereedstaande taken per *sequentiële* ronde; synchrone loop begrensd op 32 rondes. | Niet daadwerkelijk parallel, geen duurzame achtergrondjobs. |
| Herstel | Een mens kan een onderbroken/mislukte **lokale** taak opnieuw inplannen. Eerdere pogingen blijven in de geschiedenis. | Externe en destructieve acties niet automatisch opnieuw uitvoeren. |
| Kwaliteitsmonitor | Slaat meetrecords en defecten op; vergelijkt meetseries voorzichtig en telt tot drie herstelpogingen. | Nog geen zelfstandig reparerende agent of inhoudelijk sluitende kwaliteitscontrole. |
| HITL | Na drie mislukte pogingen vereist het register een menselijk besluit. Veiligheidsdefecten blokkeren direct. | Besluiten sturen nog geen algemene scheduler of Builder aan. |
| Oorspronkelijke bewijsinspectie | Onderdeel van live dashboard: atoomstatus, bronnen, herkomst, tegenbewijs en afzonderlijke bewijsgeschiedenis. | Bronverwijzing is geen semantische onderbouwing. |

## Bestaande systemen die bewust zijn behouden

- \`packages/core\`: atomen, bewijsstatus, dependencies, validatie en replay.
- \`packages/gateway\`: minimale \`AtomCapsule\` voor controleerbare claims, \`SourceBroker\`, modelprovider en Ollama-transport.
- \`packages/evidence\`: exacte brontekst, bronhandle en offsets; \`semanticSupport\` wordt niet verzonnen.
- \`packages/evaluation\`: meetprotocol en diagnose voor model- en taakvergelijkingen.
- \`packages/server\`: bestaande auth, server-side actor en externe witness voor het **oorspronkelijke atomlog**.
- \`packages/client\`: oorspronkelijke bewijsinspectie. De nieuwe dashboardomgeving gebruikt dezelfde beveiligde \`/state\`- en \`/explain/:atom\`-API's.

De planner van concept-PR #22 bevat bruikbare experimenten voor bronverankerde opdrachtontleding. Dat werk is nog niet zomaar geïntegreerd of bewezen als betrouwbare autonome planner.

## API voor de werkende onderdelen

| Methode | Route | Betekenis |
| --- | --- | --- |
| GET | \`/dashboard\` | Beveiligd gekoppelde UI, alleen bij de eigen server |
| GET | \`/ops/state\` | Register, versies, metingen, missies en operations-events |
| GET | \`/ops/catalog\` | 56 ontwerp-specialisaties en werkelijke beschikbaarheid |
| GET | \`/ops/missions\` | Missies en afgeleide voortgang |
| GET | \`/ops/missions/:id/trace\` | Werkelijke uitvoeringspogingen, fouten en status zonder ruwe taakinhoud |
| POST | \`/ops/missions\` | Door een mens goedgekeurd taakplan |
| POST | \`/ops/missions/:id/step\` | Maximaal vier reeds uitvoerbare taken, sequentieel |
| POST | \`/ops/missions/:id/run\` | Maximaal 32 synchrone rondes |
| POST | \`/ops/missions/:id/pause\`, \`resume\` | Uitvoering pauzeren/hervatten |
| POST | \`/ops/missions/:id/tasks/:taskId/retry\` | Menselijk gemotiveerde herstart, uitsluitend lokaal |
| POST | \`/ops/missions/:id/gates/:gateId/resolve\` | Vastleggen menselijke toestemming of beoordeling |
| POST | \`/ops/workers/:id/evaluate\` | Vaste serverfixtures voor eerste kandidaat |
| POST | \`/ops/workers/:id/versions/:version/evaluate\` | Afzonderlijk testen van een nieuwe versie |
| POST | \`/ops/events\` | Toegestane workerevents en beslissingen; geen vervalste meet- of uitvoeringsevents |
| POST | \`/ops/reposearch\` | Zoek in servergestuurde lokale checkout |
| POST | \`/ops/plans/propose\` | Optioneel lokaal Ollama-taakvoorstel, zonder uitvoering |
| POST | \`/ops/builders/compose\` | Voorstel voor vaste samenstelling uit twee bestaande handelingen |

API-routes vereisen de bestaande authenticatie en auditbevoegdheid. Uitvoeringsroutes, vrijgave en menselijke besluiten toetsen de actor extra. De zichtbare openbare **websiteversie** van het dashboard doet geen API-login en verwerkt geen servertoegangstokens.

## Opstarten van de lokale proef

Voor de server zijn een atompack, de bestaande witness-configuratie en bevoegd ingestelde tokens vereist, zoals beschreven in de oorspronkelijke serverdocumentatie.

Optionele variabelen:

- \`EAI_OPERATIONS_DIR\`: afzonderlijke werkregistratie, standaard niet geactiveerd als deze ontbreekt.
- \`EAI_REPO_SEARCH_ROOT\`: uitsluitend een door de beheerder gekozen lokale repository. Geen door de gebruiker opgegeven willekeurig bestandspad.
- \`EAI_PLAN_MODEL\`: naam van een vooraf geïnstalleerd lokaal Ollama-model. De planner verzendt geen modelinvoer naar een publieke modelservice en heeft een ingestelde timeout.

De HTML van het dashboard heeft geen werkende server op \`eaimodel.nl\` nodig om de expliciet gemarkeerde demo te tonen. Voor echte uitvoering is een actieve EAIwork-server nodig. **De websitebranch en PR #23 zijn niet gemergd of in productie uitgerold.**

## Wat niet geclaimd mag worden

De \`run\`-route draait binnen één HTTP-verzoek. Er zijn geen duurzame queues, echte parallelle workers, workerleases, heartbeats, modelkostenmetingen, betrouwbare capaciteitplanning, langlopende autonome loop of algemene achtergrondherstart. De huidige \`OpsStore\` gebruikt een lokale hashketen, maar heeft geen afzonderlijk ondertekende witness, geen crash-transactionele outbox en geen algemene idempotency voor externe acties.

Er bestaat nog geen algemene autonome Worker Builder, die uit zoekresultaten nieuwe onbetrouwbare code kan schrijven, in een gesandboxte omgeving toetsen en veilig activeren. De huidige Builder assembleert slechts één vast bekend recept. De 56 workers uit de bibliotheek zijn voor het grootste deel **ontwerpen**, geen werkende instanties.

RepoSearch zoekt een lokale checkout en kan fragmenten vinden. Dit is geen onafhankelijk beoordeeld hergebruikadvies: licentie, tests en compatibiliteit blijven te onderzoeken. Externe web-, kennisbank- en GitHub-API-adapters ontbreken in de uitvoeringslaag. Een browser-LLM zoals PIM is nog niet verbonden.

De gemeten looptijd is niet hetzelfde als inhoudelijke kwaliteit. Kosten en tokengebruik staan waar onbekend ook werkelijk op onbekend.

## Verificatie en regressies

- \`tests/missions-execution.test.ts\`: echte afhankelijke taken, herstart en bewaren van uitvoer, actorrechten, fout- en stopgedrag.
- \`tests/mission-constraints.test.ts\`: brongebonden verboden, toestemming, herstart uitsluitend lokaal.
- \`tests/planner.test.ts\`: alleen-taakvoorstel, constraintvalidatie, beperkte lokale providerconfiguratie.
- \`tests/reposearch.test.ts\`: bronverwijzing, limieten, symlink/secret-uitsluiting.
- \`tests/worker-builder.test.ts\`: vaste samenstelling, fixtures, vrijgave en uitvoering.
- \`tests/operations-api.test.ts\`: gecontroleerde API-registratie, samengestelde worker, bronzoeker, onafhankelijke versies.
- \`tests/mission-trace.test.ts\`: historie en controlegrenzen.
- \`tests/dashboard-syntax.test.ts\`: syntaxis van de zelfstandige interface en aanwezigheid van live schermen.

Deze tests bewijzen specifieke gedragingen van een ontwikkelproef. Ze maken nog geen productie-release of autonome werkdienst betrouwbaar.

Zie ook \`docs/hergebruik-audit-2026-11-10.md\`, \`docs/worker-versions-and-evidence-links.md\` en [PR #23](https://github.com/E-AI-MODEL/EAIwork-/pull/23).
