# EAIwork dashboard: productcontract v0.1

**Status:** bevroren ontwerpdoel en interactieve demonstratie, geen productieapplicatie. 10 november 2026.

Deze documenten leggen vast wat de gebruiker uiteindelijk met EAIwork moet kunnen doen. De HTML-demonstratie vormt de visuele en gedragsmatige referentie. Alle cijfers, gebeurtenissen, workers en opdrachten in de demonstratie zijn fictief. Interactie verandert alleen tijdelijke voorbeeldgegevens in de browser. Er worden geen externe AI-modellen, services, repositories, bestanden of medewerkers benaderd.

## Doel

Een gebruiker moet opdrachten kunnen starten en volgen terwijl EAIwork deze opdeelt in fases, uitvoerbare deeltaken en afhankelijkheden, geschikte workers toewijst, bronnen doorzoekt, taken uitvoert, resultaten controleert en gericht verder werkt. Niet elke worker is voortdurend actief. De uitvoering is hervatbaar en begrensd door kwaliteit, rechten, budget en toestemming.

## Vaste navigatie

1. **Overzicht:** opdrachten, actieve workers, kwaliteitsafwijkingen, menselijke beslissingen, werkverdeling en gebeurtenissen.
2. **Opdrachten:** doel, randvoorwaarden, fasering en voortgang. Nieuwe opdrachten moeten een bewerkbaar plan opleveren.
3. **Planner en taken:** fase-indeling, kleine controleerbare taken, afhankelijkheden, toegewezen workers, paralleliteit en herplanning.
4. **Workerleger:** registry met specialisatie, contract, model, tools, rechten, versie, prestaties, drift en status.
5. **Worker Builder:** ontbrekende specialisaties zoeken, hergebruiken, samenstellen, sandbox-testen en pas na toelating beschikbaar stellen.
6. **Kwaliteit en drift:** contracttests, metingen op vergelijkbare opdrachten, signalering, diagnose, afzonderlijke herstelpogingen en regressiecontrole.
7. **Menselijke beslissingen:** HITL voor acties buiten mandaat en na drie mislukte reparatiepogingen; keuzes en motivering vastleggen.
8. **Bronnen en RepoSearch:** web, kennisbanken, documenten en repositories met herkomst, bronversies, licenties, toegangsgrenzen en hergebruikbewijs.
9. **Logboek:** zichtbare en herleidbare werk-, bewijs-, controle-, reparatie- en beslisgeschiedenis.
10. **Instellingen:** budget, parallelle capaciteit, bevoegdheden, stopregels en herstelbeleid.

## Niet-onderhandelbare ontwerpregels

- **Nul fictieve productiegegevens.** Voorbeeldwaarden zijn als fictief gemarkeerd. Echte backenddata krijgen expliciete herkomst. Niet-beschikbare metrics worden niet verzonnen.
- **Beschikbaarheid is niet activiteit.** De registry mag honderden workers bevatten terwijl er nul of enkele actieve instanties zijn.
- **Twee soorten taakcontracten.** Een atom is een kleine, verifieerbare beslissing met minimale context. Uitvoeringstaken kunnen uitgebreidere geautoriseerde context en tools nodig hebben. Houd deze contracten gescheiden.
- **Worker is niet hetzelfde als model.** Workerrol, tools, contract en bevoegdheden worden apart van het modeltype beheerd. Groot, middel, klein of deterministische code wordt per taak en op basis van tests geselecteerd.
- **Planner, scheduler, workers, controle en registratie zijn aparte verantwoordelijkheden.** De scheduler bepaalt welke taken gereed zijn, bewaakt paralleliteit en voorkomt onnodig dubbel werk.
- **Bronnen worden zelfstandig gezocht en opnieuw onderzocht.** RepoSearch prioriteert bewezen compatibel hergebruik, dan aanpassingen, dan nieuwe code. Een test in een ander project is geen productiebewijs voor het huidige project.
- **Iedere worker heeft een versiegebonden kwaliteitsprofiel.** Geslaagde tests, fouttypen, testpopulatie, kosten, duur, drift en historie worden traceerbaar opgeslagen. Een globale score alleen volstaat niet.
- **Drift is taakgebonden.** Vergelijk prestaties op gelijkwaardige en bekende testgroepen. Controleer ook externe wijzigingen in model, tools, bronnen en invoer voordat de worker wordt gerepareerd.
- **Herstel is begrensd.** Een Repair Controller telt maximaal drie afzonderlijke mislukte, geteste reparaties voor hetzelfde probleem. De poging wordt vooraf gekoppeld aan een diagnose en na afloop aan een testverslag. Na de derde mislukking wordt automatisch herstel stilgezet en komt een HITL-besluit. Ernstige beveiligingsproblemen blokkeren direct.
- **Zelfcontrole is geen onafhankelijke bevestiging.** Workeruitvoer, letterlijke citaten, inhoudelijke ondersteuning, deterministische tests en menselijke validatie blijven gescheiden.
- **Bevoegdheden komen nooit uit workerprompts.** Nieuwe workers krijgen geen productierechten door een geslaagde test; publiceren, verzenden of destructief wijzigen vereist apart mandaat.
- **Een loop moet kunnen stoppen.** Bij bereikt doel, onvoldoende voortgang, kostenlimiet, timeout, blokkering of benodigde toestemming stopt of pauzeert het systeem veilig. Het bewaart voortgang en voorkomt dubbele externe acties na hervatting.

## Belangrijkste gegevenscontracten (voor latere API-implementatie)

`Mission`: id, title, goal, constraints, owner, state, budget, phases, tasks, outputTargets, createdAt, updatedAt.

`Task`: id, missionId, phaseId, kind, objective, inputRefs, dependencies, workerContractId, assignedWorkerId, status, attempt, artifactRefs, evidenceRefs, checks, timing, cost.

`WorkerDefinition`: id, version, specialization, supportedTaskKinds, inputSchema, outputSchema, requiredTools, permissions, modelPolicy, tests, stopConditions, lifecycleStatus.

`WorkerRun`: runId, workerDefinitionId, workerVersion, modelRevision, taskId, inputFingerprint, start, end, toolCalls, tokenUse, cost, status, artifacts, checks.

`QualityMeasurement`: id, workerId, workerVersion, testSuiteVersion, datasetVersion, cohort, metricDefinition, sampleSize, numerator, denominator, baseline, measuredAt, failures, sourceRefs.

`RepairAttempt`: id, defectId, workerId, fromVersion, candidateVersion, attemptNumber (1..3), diagnosis, changeSet, testSuiteVersion, results, outcome, timestamp.

`HITLDecision`: id, reason, affectedScope, repairAttempts, options, supportingEvidence, actor, decision, rationale, decidedAt, permissionsGranted.

`SourceRecord`: id, sourceKind, locator, revision, license, retrievedAt, sourceOwner, allowedScopes, fragmentRefs, evidenceStrength, expiry.

`AuditEvent`: id, actor, action, objectRef, previousHash, hash, timestamp, outcome, reason, evidenceRefs.

**Let op:** de bestaande EAIwork-events zijn atoomgebonden. Bovenstaande types zijn een voorstel voor aanvullende opslag. Het huidige eventlog mag niet worden overgeschreven of zonder migratie worden hergebruikt als universeel joblog.

## Wanneer geldt de demonstratie als gerealiseerd?

- Alle pagina's tonen echte, bevoegd gefilterde backenddata of melden eerlijk dat gegevens ontbreken.
- Een opdracht kan via de interface worden gemaakt, gefaseerd, gesplitst, gepland, uitgevoerd, gecontroleerd en hervat.
- Kleine, onafhankelijke taken kunnen gelijktijdig draaien binnen instelbare grenzen; inactieve workers kosten geen rekenwerk.
- Worker Builder kan een kandidaat maken, RepoSearch kan bestaande werkwijzen traceerbaar aanleveren, en tests bepalen toelating.
- Herstelpoging 1, 2 en 3 zijn afzonderlijk geregistreerd. Na een derde mislukking kan de gebruiker kiezen; de scheduler respecteert die keuze.
- Werkelijk gemeten kwaliteit is per workerversie, taaktype en testpopulatie beschikbaar. Baselines zijn reproduceerbaar.
- Werkerrechten, logcontrole, dataherkomst en herstel na onderbrekingen zijn getest, ook met negatieve scenario's.
- Desktop en mobiel ondersteunen alle kritieke acties. De demonstratie blijft een visuele regressiereferentie.

## Openstaande ontwikkeling

- Scheduler en langdurig hervatbare uitvoeringsloop.
- Task/decomposer en hiërarchische planners.
- Registry, modelrouter, Worker Builder, RepoSearch.
- Kwaliteitstelemetrie, driftvergelijkingen, herstelcontroller en HITL-beheer.
- Live UI-koppeling met de juiste rechten en de echte opslag.

### Al aanwezig in de huidige repository

`packages/core/src/derive.ts`, `replay.ts`, `packages/gateway/src/gateway.ts`, `packages/evidence/src/observe.ts`, `packages/server/src/server.ts`, `store.ts`, `witness.ts`, `packages/client/index.html` bevatten al de atoomstructuur, geïsoleerde modelaanroepen, bronfragmenten, statusafleiding, toegangscontrole en controleerbare eventgeschiedenis. Deze functies moeten behouden blijven.

Bron: https://github.com/E-AI-MODEL/EAIwork-/ . Experimentele decompositie: https://github.com/E-AI-MODEL/EAIwork-/pull/22 .
## Workerbibliotheek en taakselectie: uitbreiding 10 november 2026

- De productreferentie bevat een aparte bibliotheek met 56 **voorgestelde** specialisaties in zes groepen. Catalogusstatus, geregistreerde toestand en actieve uitvoering worden nooit als één status getoond.
- Iedere specialisatie vermeldt mogelijke taaksoort, voorlopig modeltype en benodigde tools. De Registry blijft de enige plek waar echte workerversies en kwaliteitsgegevens staan.
- Een gebruiker kan een voorbeeld uit de bibliotheek kiezen en als **kandidaatcontract** voorbereiden. Dat contract geeft geen rechten en er is geen proces gestart.
- De eerste selector mag pas een geregistreerde worker voorstellen na toelating, beschikbaarheid van een adapter, capabilities en rechten. Hij maakt geen uitvoeringsbesluit; de scheduler moet vóór uitvoering opnieuw controleren.
- Nieuwe specialisaties buiten de bibliotheek moeten via RepoSearch en Worker Builder kunnen ontstaan. Deze functies zijn nog niet uitgevoerd.
- Demo-aantallen zijn niet gelijk aan aantallen actieve workers. Ontbrekende uitvoeringsgegevens krijgen de tekst *niet meetbaar*.
