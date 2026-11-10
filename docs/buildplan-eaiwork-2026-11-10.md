# EAIwork: bouwplan en uitgevoerde eerste uitbreiding
Datum: 10 november 2026. Status: in uitvoering, vastgelegd in een concept-PR. Geen productie-release.

## Waar EAIwork voor bedoeld is

Geef EAIwork een doel, randvoorwaarden en een gewenst eindproduct. Het systeem maakt fases, verdeelt die in kleine, controleerbare taken, legt afhankelijkheden vast, zoekt bronnen en kiest passende workers. Het voert uitvoerbare taken uit, controleert resultaten, voegt werk samen en plant gericht opnieuw totdat het doel bereikt is, de voortgang stokt of een grens is bereikt. Het bewaart uitvoeringen, bronversies, controles, kosten en toestemming.

Een ruime **workerbibliotheek** betekent niet dat iedere worker draait. De scheduler start alleen passende workers voor taken die gereed zijn. Workers zijn rollen met taakcontracten, tools, rechten en modelbeleid; niet noodzakelijk afzonderlijke modellen. Groot, middelgroot, klein en deterministische code zijn selecties op basis van contracttests, niet alleen op basis van de lengte van de taak.

## Definitieve procesvolgorde voor het product

1. Doel en grenzen vastleggen.
2. Opdracht opdelen in fases.
3. Fases opdelen in kleine controleerbare taken; behoud genoeg betekenis voor uitvoering.
4. Afhankelijkheden en parallel uitvoerbaar werk bepalen.
5. Worker Registry raadplegen en op gemeten taakgeschiktheid routeren.
6. Ontbrekende specialisatie: RepoSearch zoekt bestaande, passend geteste werkwijzen; Worker Builder hergebruikt, assembleert of maakt een kandidaat.
7. Taakcontract, lokale context, bronrechten, tools en uitvoeringsgrenzen aan de worker leveren.
8. Zoeken, analyseren en uitvoeren; resultaten met bron- en toolverwijzingen bewaren.
9. Resultaten onafhankelijk controleren (syntactische checks, testuitvoer, inhoudelijke beoordeling waar nodig).
10. Deelresultaten samenvoegen en afhankelijkheden opnieuw beoordelen.
11. Bij fouten, ontbrekend bewijs of nieuwe vragen gericht herplannen; waar nodig repareren of opschalen naar een andere worker.
12. Afronden, pauzeren of ter besluitvorming voorleggen. Alle voortgang en wijzigingen blijven beschikbaar.

Een worker mag niet zonder afzonderlijke bevoegdheid zijn eigen bewijsstatus verhogen, nieuwe externe rechten toekennen, publiceren of destructieve wijzigingen doorvoeren.

## Datacontracten die op elkaar aansluiten

- `WorkerContract`: id, versie, taaksoorten, invoer- en uitvoerschema, benodigde tools, gevraagde rechten, modelbeleid, testsuite, stopvoorwaarden.
- `WorkerRecord`: contract + lifecycle kandidaat, beschikbaar, quarantaine, uitgeschakeld; toelatingsbewijs.
- `QualityMeasurement`: worker-id en versie, dataset, testsuite-versie, taaksoort, cohort, meting, teller/noemer, kosten, duur, bronverwijzing.
- `Defect`: diagnose, ernst, worker en versie, open/herstel/menselijk besluit, pogingengeschiedenis.
- `RepairAttempt`: kandidaatversie, diagnose, wijziging, testsuite, resultaat, tijdstip, geslaagd/mislukt.
- `HITLDecision`: beslissing, motivering, beslisser, tijdstip; geen impliciete uitbreiding van bevoegdheid.
- Nog te realiseren: `Mission`, `Task`, `WorkerRun`, `TraceSpan`, `SourceRecord`, gescheiden budget- en schedulerrecords.

### Herstelbeleid

Een quality-probleem kan maximaal drie afzonderlijke, geteste herstelpogingen krijgen. Pogingen met identieke wijzigingen of kandidaatversies worden geweigerd. Bij een geslaagde proef sluit het defect, maar de werkerversie krijgt **niet automatisch** uitvoeringsrechten. Na de derde mislukking volgt quarantaine plus een HITL-besluit: vervangen, herbouwen, handmatig beoordelen, pauzeren of uitschakelen. Een veiligheidsprobleem mag onmiddellijk worden geblokkeerd. Een testresultaat van een bevoegde systemactor is een geregistreerde meetclaim, nog geen onafhankelijk bewijs dat de externe testomgeving eerlijk of veilig was.

### Kwaliteits- en driftcontrole

Geen universeel slagingscijfer voor alle workers. De eerste indicator vergelijkt uitsluitend dezelfde workerversie, taaksoort, metriek, dataset, testsuite-versie en cohort; bij te kleine groepen of één run volgt geen conclusie. Zelfs een grote daling is een signaal, geen causale diagnose. Bekijk modelupdates, bronnen, interfaces en veranderde invoer voordat je een worker repareert. Bewaar de ruwe teller/noemer en bewijsreferentie.

## Wat al bestond vóór dit bouwtraject

- `packages/core`: atoms, dependencylogica en op basis van bewijs afgeleide status.
- `packages/gateway`: geïsoleerde, begrensde lokale modelaanroepen en een broninterface.
- `packages/server`: bevoegdheden, serverchecks en een apart, ondertekend witness-journal voor het **bestaande atoomlog**.
- `packages/client`: basiswerkbank met atoomstatus en bewijsinspectie.
- Concept-PR #22 bevat onderzoeksproeven over decompositie. Die bewijzen nog geen betrouwbare autonome taakplanning.

## Uitgevoerd in deze PR

- `packages/operations/src/registry.ts`: getypeerde contracten, toelating, kwaliteitsmetingen, defecten, drie reparatiepogingen en HITL.
- `packages/operations/src/store.ts`: afzonderlijke persistente operations-journal met hashketen, head en één schrijver. **Nog niet onafhankelijk ondertekend, nog niet crash-transactioneel.**
- `packages/operations/src/quality.ts`: voorzichtige vergelijking van reproduceerbare meetseries.
- `packages/server/src/server.ts`: optionele operations-API `GET /ops/state`, `GET /ops/verify`, `POST /ops/events` uitsluitend met audittoegang; `GET /dashboard` voor statische productreferentie.
- `prototypes/dashboard/index.html`: productreferentie, apart scherm Contracten en registratie, live registry via same-origin API, voorbeeldregistratie en browserpreflight zonder modeldownload.
- `tests/operations*.test.ts` en `tests/dashboard-syntax.test.ts`: contract- en toegangscontroles, herstel en opslagintegriteit, API en UI-syntax.
- Websitebranch `E-AI-MODEL/website` [PR #152]: een traceerbare demo-snapshot als bron onder `content/eaiwork-dashboard/index.html`, door de generator gepubliceerd naar `/tools/eaiwork/`. Tests zijn aan de websiteworkflow toegevoegd.

## Nog te bouwen, in deze volgorde

### Fase A: contracten en registratie afmaken (eerste verticale proef)

Werkelijke server met geconfigureerde `EAI_OPERATIONS_DIR`, beveiligde toegang, end-to-end registerformulier, meerdere auditrollen, eventexport, logsignering en veilig herstel bij afgebroken writes. Het bestaande witness-journal mag niet onopgemerkt worden vervangen.

**Acceptatie:** contract kandidaat -> gemeten test -> menselijk vrijgeven -> versiegebonden dashboard; een model kan geen bevoegdheid verhogen; driemaal mislukt -> automatisch geblokkeerd -> menselijk besluit; herstart behoudt die geschiedenis. Negatieve API-tests slagen.

### Fase B: echte opdracht- en uitvoeringsregistratie

Maak een getypeerde `Mission`, `Task`, `WorkerRun` en geneste `TraceSpan`. Een trace koppelt opdracht -> fase -> taak -> worker -> model/tool/search -> uitkomst en controle, met latency, tokengebruik en prijs per span (waar beschikbaar), foutreden en artefactbron. Exporteer later eventueel OpenTelemetry. Het dashboard moet wachten, bezig, geslaagd, mislukt en toestemming nodig afzonderlijk tonen.

**Acceptatie:** één echte testrun met minimaal twee taken en één afhankelijkheid is volledig terug te vinden en reproduceerbaar.

### Fase C: planner, scheduler en lange loop

Maak een dependency-scheduler met begrensde paralleliteit, taakrechten, idempotente job-ID's, versieleases, checkpoints, budget en stopredenen. Plans worden eerst beoordeeld voordat een worker uitvoert; automatische taakontleding is een afzonderlijk te testen module. Herstart zonder dubbele externe acties. Grotere modellen alleen voor taken die ze aantoonbaar beter uitvoeren.

**Acceptatie:** na een onderbreking gaat een opdracht verder zonder reeds afgesloten wijzigingen dubbel uit te voeren; werk stopt bij budgetgrens, ongeldige afhankelijkheid of ontbrekende toestemming.

### Fase D: bronzoekers, RepoSearch en Worker Builder

Aansluitingen voor zoekmachine, kennisbank en repository met bronscope, versie, licentie en toegangsbeleid. RepoSearch levert candidate good practices met exact bestand/commit/tests, geen automatische kwalificatie als bewezen voor dit doel. Builder zoekt eerst hergebruik, assembleert indien mogelijk en genereert alleen in een sandbox met tests en menselijke vrijgave waar rechten veranderen.

**Acceptatie:** herleidbare bronophaling; nieuw gebouwde worker krijgt geen toegang buiten sandbox vóór toelating.

### Fase E: browsermodelproef (Project PiM)

Project PiM gebruikt lokale browsermodellen; de Qwen-rewrite-LLM daar is op dit moment **design-only**. Gebruik de WebGPU-preflight uit het dashboard als ingang. Test een klein, afgebakend taakcontract tegen een servermodel met dezelfde vaste cases; leg downloadomvang, token-/taaklatentie, energie/geheugendruk, foutpercentages, modelidentiteit, privacy, mobiele werking en onderbreking vast. Browsercontext is niet geschikt als garantie voor permanent lopende multiworker-jobs. Server blijft verantwoordelijk voor bevoegdheden en duurzame staat.

**Acceptatie:** per apparaat een aantoonbare vergelijking; bij geen model of geen WebGPU een eerlijke uitkomst in plaats van fictieve invoer.

### Fase F: website en productiedienst

EAIwork als eigen Node-dienst met beveiligde opslag en aanmeldvoorziening; dashboard bereikbaar op een HTTPS-subpad van eaimodel.nl via reverse proxy of op een afgescheiden subdomein. Theory7 publiceert nu alleen statische bestanden; GitHub beheert bron/CI en is geen doorlopende workerhost. Geef de publieke demoversie geen echte persoons- of dossiergegevens. Voorkom tokens in URL, localStorage en statische code. Controleer apart `www.eaimodel.nl`-routing en DNS. Publicatie vereist een expliciet releasebesluit.

**Acceptatie:** externe werkproef, beheerrollen, privacycheck, HTTPS, journaling, uitvalherstel en exacte releaseverificatie.

## Wat het AdminLTE-artikel ons leert

Het artikel [11 Best AI Agent Dashboards & Consoles (21 september 2026)](https://adminlte.io/blog/ai-agent-dashboards/) beschrijft drie belangrijke functies die bovenop de huidige demonstratie moeten komen:

1. **Geneste traces:** niet alleen een plat log, maar inzicht in de verhouding opdracht, taak, modelaanroep, toolaanroep en zoekactie.
2. **Kosten bij gedrag:** tokens, latency en kosten per taak/run/span naast resultaat en foutreden.
3. **Uitvoering én bevoegdheden:** wachtend, actief, vastgelopen, geslaagd, plus menselijk akkoord en audit; een worker met alleen een mooi percentage is niet voldoende.

Bekijk Langfuse of Opik voor tracing/evaluatie en Agno AgentOS voor de scheiding tussen runtime en controlepaneel. Niet direct een complete externe stack overnemen voordat duidelijk is welke eigen EAIwork-contracten die moet bewaren.

## Uitgifte en grenzen

- EAIwork PR #23 en website PR #152 blijven concept tot controles en review zijn afgerond.
- Deze eerste uitbreiding bouwt **geen** volledige automatische planner, websearch, RepoSearch, Worker Builder, modelrouting of permanente workers. Het dashboard toont hun eindontwerp met fictieve voorbeelden.
- Het operationslog gebruikt nog geen externe cryptografische witness, contrairement het bestaande atoomlog. Hash + head op hetzelfde opslagmedium is geen bewijs tegen een aanvaller die beide kan wijzigen.
- De website-HTML is een gepinde demonstratiesnapshot; vóór latere publicatie moet de bron- en doelversie weer exact worden vergeleken.
- De repositorylicenties waren in het eerdere onderzoek nog placeholders; vaststelling is nodig vóór openbare distributie als volwaardig herbruikbaar product.

## Releasecontrole

Technische basistests: `npm test`, serverauth negatieve routes, corruptiescenario's, repair 3/3, dashboard-JS-syntax. Website: `test_eaiwork_publish.py`, build-site, linkchecks, mobiele browsercontrole en exacte HTML-hash. Een groene CI is geen bewijs dat de autonome loop of een lokaal browsermodel al werkt.

Voor bronverwijzingen: https://github.com/E-AI-MODEL/EAIwork-/pull/23 en https://github.com/E-AI-MODEL/website/pull/152 .
