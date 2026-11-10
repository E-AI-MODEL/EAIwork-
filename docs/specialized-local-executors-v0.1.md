# Twee extra vaste tekstspecialisaties in EAIwork

**Status:** ontwikkel-PR #37, gebouwd boven op de lokale executor en de
missiegebonden toegangscontrole in PR #36. Geen algemene workerhost of
productieversie.

## Wat de uitvoerder nu kan

De afzonderlijke lokale executor kan vier vaste taaksoorten verwerken:

| Taaksoort | Geregistreerde worker | Wat hij levert |
|---|---|---|
| `text-normalize` | `text-normalize` | Opgeschoonde tekst en een wijzigingsvlag |
| `text-metrics` | `text-metrics` | Woorden, tekens en regels |
| `text-inspect` | `text-inspector` | Vaste combinatie van normaliseren en tellen |
| `reference-extract` | `reference-extract` | Herkende Markdown-links, maximaal acht voorbeelden, totaal en afkapping |

De vierde taak opent geen websites en controleert niet of een bron bestaat,
betrouwbaar, relevant of inhoudelijk ondersteunend is. Het veld `review`
blijft altijd `links-not-verified`. Links zijn alleen gevonden tekst.
Een ongewenste URL kan in de bron staan; geen onderdeel van deze worker
bezoekt of opent dat adres.

## Een opdracht uitvoeren

Start de lokale demonstratieserver met `npm run demo:dashboard`. Maak via
de missie-API een plan met uitsluitend deze vaste taaksoorten. De
missie-eigenaar geeft toestemming voor het gekozen aantal starts en
een of meer expliciet aangewezen uitvoerders:

```http
POST /ops/missions/<mission-id>/automation/start
Authorization: Bearer <beheertoken>
Content-Type: application/json

{"maxStarts":4,"executionMode":"remote-text","executorIds":["executor-local-demo"]}
```

Start daarna de afzonderlijke, vaste tekstexecutor:

```sh
EAI_EXECUTOR_URL=http://127.0.0.1:8788 \
EAI_EXECUTOR_TOKEN="<tijdelijk-tekstworker-token>" \
node scripts/local-text-executor.ts --max-tasks=4
```

De server kiest het werk op grond van het plan, de afhankelijkheden,
de nog geldige toestemming en het toegelaten workercontract. Hij bewaart
een lease vóór hij taakinhoud terugstuurt. Het aparte proces ontvangt
alleen de tekst, taaksoort en claiminformatie. Een resultaat wordt op
de server opnieuw met de vaste deterministische adapter berekend.
Een afwijkende uitkomst wordt geregistreerd als mislukte poging.

De extra specialisaties veranderen geen atom-bewijsstatus.
`verification:not-evaluated` blijft staan totdat een afzonderlijk
bevoegd en inhoudelijk proces het resultaat heeft beoordeeld.

## Wat is getest

- De vier specialisaties volgen elkaar op binnen één missie, waarbij
  een afhankelijkheid pas beschikbaar komt na een voltooide voorganger.
- De bestaande `text-inspector` blijft gekoppeld aan precies het
  toegelaten samenstellingscontract.
- De linkherkenner houdt twee syntactisch gevonden links uit elkaar,
  zonder inhoudelijke claims over de bronnen.
- De server weigert een poging om `review` te vervalsen tot
  `verified`, en bewaart het onbevestigde antwoord niet als taakresultaat.
- De worker met een ander token krijgt ondanks dezelfde vier
  toegestane specialisaties geen invoer uit deze missie.
- Een afzonderlijk Node-proces kan de twee nieuwe specialisaties
  uitvoeren met het bestaande HTTP-protocol.
- De bestaande tests voor leases, herstel, bewijsregistratie,
  toegangscontrole en het dashboard draaien mee in CI.

Testbestanden: `tests/specialized-executors.test.ts`,
`tests/loopback-executor.test.ts`, `tests/local-demo.test.ts`.
De status van CI moet aan de exacte commit worden gekoppeld.

## Wat niet wordt beweerd

Deze stap bevat geen algemene nieuwe codegeneratie, geen nieuwe
modelkeuze, geen internetonderzoek en geen GitHub-broninzameling.
`repo-search` blijft bewust uitsluitend in de reeds geconfigureerde
serveromgeving, zodat een executortoken geen vrije toegang tot de
repository krijgt. Er is nog geen netwerk-, OS- of containerisolatie
voor willekeurige worker-code.

De route maakt gespecialiseerde, goedgekeurde bewerkingen mogelijk.
Een vervolg kan bronverzameling toevoegen achter een aparte,
bevoegde broker met controleerbare bestanden en versies. Die broker
mag geen modelsuggestie als gecontroleerde bron presenteren.
