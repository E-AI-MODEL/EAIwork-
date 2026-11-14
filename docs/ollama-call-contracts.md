# Ollama: uitvoer, tijdsbudget en metingen

Onderzocht vertrekpunt: `f12190d` op `main` (14 november 2026). De opdracht autoriseert gerichte reparaties, tests en een concept-PR. Merge en deployment vallen buiten deze uitvoering.

De actuele README, SECURITY.md, worker-isolation.md, atomic-claim-contract.md, providercode, aanroepende code, tests en CI zijn gecontroleerd. Er staan geen AGENTS.md of CLAUDE.md in deze checkout. Dit onderzoek betreft de hieronder genoemde modelpaden, geen volledige projectaudit.

## Gevonden en aangepast

| Pad | Aangetroffen gedrag | Aanpassing |
| --- | --- | --- |
| Atoomprovider | De eenmalige fallback bij een niet-ondersteunde `think`-optie maakte een nieuwe timeout aan. | Beide HTTP-pogingen delen hetzelfde AbortSignal en dus één totaalbudget, inclusief het lezen van de body. |
| Citatievoorstel | De instructie vroeg om alleen probabilities op het hoogste niveau, terwijl het schema `probabilities` en `references` vereiste. | De instructie noemt nu dezelfde vorm als het schema. Het gewone antwoordcontract blijft gelijk. |
| Vergelijkingsproef | De instructie combineerde het atoomcontract met een object per caseId. | Het batchcontract benoemt expliciet de uitvoer per caseId. Dit pad blijft uitsluitend voor evaluatie. |
| Lokale HTTP-paden | De atoomprovider, planner, comparator en modeldiscovery volgden redirects. | Redirects worden geweigerd; de codeworker deed dit al. |
| Responsverwerking | Atoomprovider en comparator lazen onbeperkte bodies. | Alle chatpaden lezen begrensd: atoom 100.000 bytes, planner 65.536, code 100.000 en comparator 1.000.000. De bestaande planner- en codegrenzen blijven behouden. |
| Envelope | Afgekapt antwoord kon doorgaan naar de inhoudsparser. | `done: false` en `done_reason: "length"` geven `incomplete-response`. Een ontbrekend done-veld blijft toegestaan voor bestaande compatibele antwoorden. |
| Metingen | De vergelijking mat wandtijd per arm en per atoom, zonder afzonderlijke HTTP-pogingen of Ollama-tellingen. | De chatadapters bieden een optionele `onCall`-observer. De vergelijkings-CLI bewaart de records in `calls` van het JSON-rapport. |

`ollama-chat.ts` deelt alleen transport en envelopeverwerking. De bestaande controle van probabilities, citatievormen, missieplannen, restrictiecitaten en codevoorstellen blijft bij de oorspronkelijke callers. Het tijdsbudget van de atoomprovider vereist nu een geheel aantal milliseconden tussen 1 en 600.000; standaardwaarden en bestaande budgets veranderen niet.

## Metingen gebruiken

`ollamaProvider`, `localOllamaPlanningModel`, `LocalCodeWorkspace` en `ollamaWholeTaskProvider` accepteren `onCall`. Deze synchrone callback krijgt één onveranderlijk record per daadwerkelijk gestarte HTTP-poging, ook bij fouten. Discovery van geïnstalleerde modellen is geen modelgeneratie en krijgt geen chatmeting. Zonder observer worden geen records opgeslagen of gepubliceerd.

Een record bevat het ingestelde model, soort operatie, pogingnummer, gemeten `elapsedMs`, HTTP-status indien beschikbaar en een vaste uitkomstcategorie. De optionele Ollama-velden `total_duration`, `load_duration`, `prompt_eval_duration` en `eval_duration` blijven in nanoseconden; `prompt_eval_count` en `eval_count` zijn tokentellingen. Alleen veilige, niet-negatieve gehele getallen worden overgenomen. Ontbrekende of ongeldige velden blijven afwezig, zonder geschatte nulwaarden. Prompts, bronfragmenten, gegenereerde tekst, reasoning en ruwe foutmeldingen ontbreken.

`success` betekent dat transport, envelope en de lokale inhoudsparser slaagden. Latere domeinvalidatie kan een voorstel alsnog afwijzen. Het record zegt niets over inhoudelijke juistheid, bewijsstatus of goedkeuring. Observerfouten wijzigen het antwoord niet en veroorzaken geen retry. Een observer moet kort werk doen; zijn eigen verwerkingstijd valt buiten `elapsedMs`.

Voor de bestaande, expliciet gestarte vergelijking:

```sh
EAI_BENCH_MODEL=<lokaal-model> node benchmarks/compare-model.ts <suite.json> <nieuw-rapport.json>
```

De rapporten behouden het onderscheid tussen één mislukte batchaanroep en de daardoor niet-beoordeelde cases. De nieuwe metingen komen niet in workerresponses, capsules, evidence of statusregels. Verse, eenmalige atoomsessies en de bodyloze schedulerresponse blijven behouden.

## Afweging rond llama.cpp

Niets veranderen zou de aangetroffen contracttegenstrijdigheden en het dubbele fallbackbudget laten bestaan. De gekozen ingreep repareert die binnen de bestaande Ollama-paden. Een aparte llama-server-adapter zou daarnaast endpointbeleid, uitvoerschema's, foutafhandeling, installatie en nieuwe integratieproeven vereisen.

Er is in de onderzochte actuele code en geschiedenis geen gemeten behoefte gevonden die zo'n extra backend rechtvaardigt. Eerdere llama.cpp-voorstellen blijven hypotheses; er is hier geen vergelijkende prestatietest uitgevoerd. Heroverweeg de adapter pas als een concrete gewenste functie ontbreekt of dezelfde lokale workload na deze reparaties een reproduceerbare beperking toont. Vergelijk dan dezelfde modellen, inputs, uitvoercontracten en budgets, met behoud van de workergrens. Een geldige, tijdige Ollama-uitkomst zou een hypothese dat een andere backend noodzakelijk is voor die workload ontkrachten.

## Validatie en terugdraaien

De gerichte tests controleren onder meer schema/instructie, gedeeld fallbackbudget, metingen per poging, ontbrekende gebruiksvelden, observerfouten, begrensde bodies, onvolledige envelopes, redirects en een timeout tijdens bodyontvangst. De bestaande integratie-, isolatie-, autorisatie- en conformancecontroles blijven gelden.

Er is geen echte Ollama-inferentie of modelprestatieverbetering gemeten in deze werkomgeving. De echte model- en Dockerproeven blijven afzonderlijke CI-controles. Bij een regressie in bestaande contracten of isolatie stopt review; de commit kan zonder datamigratie worden teruggedraaid.

Lokaal uitgevoerd op Node 24.22.1: `npm test` (285 geslaagd, 0 gefaald, 4 overgeslagen), inclusief conformance. De vier overgeslagen proeven zijn de echte Ollama-workerproef, de eerste volledige productproef en twee echte Dockerproeven. Verder geslaagd: alle packs linten, demo-replay met geweigerde modelstatusverhoging, de bestaande groeidiagnostiek voor 100/250/500 taken, controle op netwerkgebruik in core, bibliografietypen en `git diff --check`. CI gebruikt Node 22; de uitkomst daarvan moet aan de PR-head worden gecontroleerd.
