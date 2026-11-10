# EAIwork: eerste volledige productproef
Datum: 11 november 2026. Status: werk in concept-PR, geen release.

## Wat we bouwen
EAIwork blijft één product. Het moet een opdracht in gewone taal omzetten naar werk dat zoveel mogelijk zelfstandig wordt uitgevoerd en gecontroleerd. De gebruiker krijgt een bruikbaar resultaat met de werkelijk uitgevoerde controles, de resterende onzekerheden en de momenten waarop een mens besliste.

De bestaande bewijsomgeving blijft behouden. Een geslaagde code- of Docker-test geeft nooit vanzelf het bewijslabel `proven` aan een inhoudelijke bewering.

## Bouwvolgorde

| Fase | Resultaat | Voorwaarde om door te gaan |
| --- | --- | --- |
| 1. Stabiliseren | Controleerbare ontwikkeltak, PR-afhankelijkheden in beeld, groene tests en échte eerste productproef | Nieuwe softwarewijziging plus onafhankelijke oplevercontrole slagen in Docker; afgetakte PR's zijn geïnventariseerd |
| 2. Werkruimte | Eén live dashboard met opdracht, volgende actie, actieve worker, echt resultaat en optionele details | Geen voorbeelddata in live; alle knoppen verwijzen naar werkelijk werkend gedrag |
| 3. Verbinden | Planner, workerkeuze, codewijziging, test en oplevering vormen één opdracht | De gebruiker hoeft niet dezelfde bedoeling opnieuw per bestand in te voeren |
| 4. Zelfstandigheid | Werkzaamheden en herstel mogen binnen vooraf afgesproken grenzen zelf doorgaan | Herstart en foutcondities veroorzaken geen dubbele of ongeoorloofde wijzigingen |
| 5. Uitgifte | Productbestanden, onafhankelijke acceptatie, historie en veilige vrijgave | Echte Mac-proef, securityreview, licentiebesluit en gecontroleerde merge/release |

Dit is een werkvolgorde. Groene CI betekent niet dat alle fasen afgerond zijn.

## Eerste volledige productproef: voorbeeldapplicatie

De opdracht is: **verander het bedrag in 12 en voeg `totalWithShipping(shipping = 0)` toe, met behoud van `total`.**

Het werk bestaat uit twee bronbestanden en twee bijbehorende tests. De tussenliggende Docker-tests controleren de onderdelen samen. Een afzonderlijke oplevercontrole controleert daarna de complete gebruikersvraag:
- `amount === 12`;
- `total === 24`;
- `totalWithShipping()` geeft `24`;
- `totalWithShipping(4)` geeft `28`.

De eindcontrole staat in `examples/multifile-smoke/acceptance/final-product.test.js`. Deze eindcontrole draait **niet** bij de tussenstappen, zodat een nog niet gebouwde tweede functie de eerste wijziging niet blokkeert.

### Twee onafhankelijke manieren om te testen

- `npm test`: test de gewone repositoryfunctionaliteit; de productproef met Docker wordt hierbij overgeslagen als Docker niet is aangezet.
- `npm run proof:first-product`: voert via de echte lokale HTTP-API de twee voorstel-, test- en akkoordstappen uit, gebruikt de bestaande Docker-runner, en controleert als laatste met een afzonderlijke Node-test het complete resultaat. Deze proef gebruikt een **nagebootst Ollama-antwoord** om de uitvoeringsroute herhaalbaar te testen. Dit is geen bewijs dat een lokaal AI-model de code zelfstandig correct maakt.

Het resultaat is een werkende voorbeeldapplicatie in een tijdelijke projectmap. De proef publiceert niets en verwijdert de tijdelijke testmap na afloop. Een werkelijk model en de Mac-interface worden apart beproefd.

## PR-inventaris: niet blind samenvoegen

De huidige hoofdlijn loopt via PR #23 t/m #32, daarna #38 t/m #47 en #49 t/m #57. Alle werk staat nog in concept-PR's. Deze inventaris volgt de **base-branch-relaties** van de PR's; individuele commits, conflicten en testdekking zijn nog niet integraal beoordeeld.

| PR | Stand ten opzichte van huidige hoofdlijn | Voorstel, nog geen merge-besluit |
| --- | --- | --- |
| #28 | **Wel in de doorlopende keten**: #29 heeft de branch van #28 als basis | Niet als verloren werk aanmerken; inhoudelijke review blijft nodig |
| #33 | Aftakking van #32: kandidaat voor aparte menselijke releasebeoordeling | Vergelijk met de bestaande uitgiftecontrole |
| #34 | Bouwt op #33 voort: hash van uitgiftebestanden | Vergelijk bron- en artefactcontrole en neem alleen passende verschillen mee |
| #35 | Aftakking van #33: scopes voor tekstworkers | Beoordeel toegangsgrenzen afzonderlijk |
| #36 | Bouwt op #35 voort: eerlijke verdeling van taakclaims | Samen met #35 beoordelen |
| #37 | Bouwt op #36 voort: gespecialiseerde lokale tekstworkers | Pas beoordelen na #35 en #36 |
| #48 | Aftakking van de lokale codeworker: extra controle en herstel | Vergelijk zorgvuldig met #49 t/m #57, voorkom verlies of dubbel herstel |

Deze inventaris is **geen bewijs** dat de afgetakte wijzigingen veilig geïntegreerd kunnen worden. Besluiten volgen na gerichte diff-review en tests. Er is geen toestemming om automatisch naar `main` te mergen.

## Wat de eerste proef nog niet bewijst

- Ollama genereert zelfstandig de juiste wijzigingen, inclusief inhoudelijke kwaliteit.
- EAIwork ontleedt een vrije opdracht zelfstandig in uitvoerbare taken.
- Het systeem kan nieuwe productstructuren vanaf nul maken.
- Onbeperkt autonoom herstellen, langdurig doorwerken of veilig publiceren.
- Het operationslog heeft dezelfde onafhankelijke ondertekening als het oorspronkelijke bewijslog.

Zolang dit niet is getest, mag het dashboard geen voltooiing of bewezen werking suggereren.

## Stopregels

Stop de productproef bij een mislukte Docker-test, ontbrekende modelreactie, ontbrekende menselijke toestemming of gewijzigde bronbestanden. Geen stilzwijgende publicatie en geen goedkeuring op basis van een voorgesteld, maar niet uitgevoerd, testresultaat.

## Volgende stap na de eerste groene proef

Op de eigen Mac één echte Ollama-run doorlopen met ditzelfde project. Leg vast: instructie, modelnaam, aangeboden code, Docker-resultaten, wijzigingen na akkoord, eindcontrole en wat de gebruiker daadwerkelijk in het dashboard zag. Bouw alleen aan ontbrekende verbindingen die deze proef zichtbaar maakt.
