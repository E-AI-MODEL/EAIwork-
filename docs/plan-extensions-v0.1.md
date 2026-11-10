# EAIwork: plannen aanvullen zonder oud werk kwijt te raken

**Status:** eerste planneruitbreiding in concept-PR #25. Bouwt op herstel-PR #24.
Geen autonome planner en geen productiepublicatie.

## Wat er nu werkt

Een missie begint met planrevisie 1. De missie-eigenaar kan via de beveiligde
API nieuwe taken toevoegen. Een eerder uitgevoerde taak blijft in het
operationslog en houdt zijn oorspronkelijke run-id, uitvoer en bronverwijzing.

```http
POST /ops/missions/<mission-id>/extend
Content-Type: application/json

{
  "expectedRevision": 1,
  "plan": {
    "id": "mission-voorbeeld",
    "title": "Ongewijzigde titel",
    "goal": "Ongewijzigd doel",
    "sourceInstruction": "Exact dezelfde oorspronkelijke opdracht",
    "tasks": [
      "<alle bestaande taken, ongewijzigd en in dezelfde volgorde>",
      "<een of meer nieuwe taken>"
    ],
    "constraints": [
      "<alle bestaande voorwaarden, ook toegepast op nieuwe taken>"
    ]
  }
}
```

De API valideert het volledige plan inclusief afhankelijkheden en kringlopen.
Een verouderde revisie, een verdwenen taak, een gewijzigd oud taakcontract,
een veranderde oorspronkelijke opdracht of het weglaten van bestaande
voorwaarden wordt geweigerd. Bestaande verboden en goedkeuringsvoorwaarden
moeten ook nieuwe taken omvatten. Het systeem wijzigt geen plan terwijl
de scheduler actief is of een taak nog loopt.

Eerder gegeven toestemming wordt bij een uitbreiding **opnieuw gevraagd**.
Dat is bewust: een akkoord voor de eerdere taken geldt niet vanzelf voor
nieuw werk. Een ontbrekende of onbevoegde goedkeurder blijft een blokkade.

## Planner en onzekerheid

De optionele lokale Ollama-planner kan nu afzonderlijke open vragen
retourneren in `missingInformation`. Die vragen zijn modelvoorstellen.
EAIwork beweert niet dat ze volledig of inhoudelijk juist zijn.
Het oorspronkelijke verzoek en exacte bronpassages blijven bepalend.

Het model kan nog **geen** planuitbreiding zelfstandig registreren of
goedkeuren. Het moet de feitelijke instructies en ontbrekende informatie
eerst aan de aangewezen persoon voorleggen.

## Getest gedrag

- Een afgeronde normalisatietaak blijft intact nadat een tweede, afhankelijke
  teksttaak is toegevoegd. Die nieuwe taak gebruikt daarna de bewaarde uitvoer.
- Een oude revisie, gewijzigde opdracht, verwijderde voorwaarden of
  herschreven taak wordt geweigerd.
- Alleen de oorspronkelijke missie-eigenaar kan een nieuwe versie goedkeuren.
- Een wijziging tijdens automatische uitvoering wordt geweigerd.
- De algemene `/ops/events`-route kan geen planversie vervalsen.
- De modelplanner blijft op `requires-human-review` staan en bewaart open
  vragen uitsluitend als onbeoordeelde voorstellen.

Relevante tests:

```sh
node --test tests/mission-extension.test.ts tests/mission-extension-api.test.ts tests/planner.test.ts
npm test
```

## Nog nodig voor zelfstandig plannen

Dit is alleen **append-only planuitbreiding**. De algemene planner moet nog
fases herkennen, opsplitsen, onafhankelijk uitvoerbare taken selecteren,
bewijs voor open vragen zoeken, gericht een nieuwe versie voorstellen en
een geschikte worker kiezen. Er is nog geen bewijs dat een model alle
voorwaarden uit een complexe opdracht betrouwbaar herkent.

Een toekomstige planner mag de uitvoering van reeds goedgekeurde, lokale
taken binnen het vastgestelde mandaat zelf inplannen. Publiceren,
externe schrijfacties, nieuwe rechten en inhoudelijke goedkeuringen mogen
niet stilzwijgend worden toegestaan.
