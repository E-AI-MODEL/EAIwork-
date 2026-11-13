# Bouwronde bewijskern (13 november 2026)

- **Basis:** `main` op `69f5793`, branch `claude/gifted-babbage-hwh111`.
- **Vervolg op:** [alignment-rapport van 10 november](alignment-rapport-2026-11-10.md). De codes A1–D6 hieronder verwijzen naar dat rapport.
- **Afbakening:** deze ronde raakt alleen de bewijskern en haar documentatie. De uitvoeringslaag in de concept-PRs #23–#57 is niet aangeraakt.

## 1. De visie zoals ik die uit de repository lees

1. **Status wordt afgeleid, nooit gezet.** Wat iets waard is volgt uit bewijs en herkomst, niet uit wie het hardst roept.
2. **Asymmetrie.** Een model mag voorstellen, signaleren en twijfel melden. Het mag zijn eigen uitkomst nooit opwaarderen.
3. **Herkomst blijft zichtbaar.** Twee bevestigingen tellen pas als ze onafhankelijk zijn.
4. **Geen schijnzekerheid.** Geen totaalscore, geen "AI-confidence" als kopcijfer. "Niets gevonden" betekent "niet gedetecteerd", niet "veilig".
5. **Eerlijk over grenzen.** Elk document zegt wat het niet bewijst.
6. **Het uitvoerende systeem bouwt hierop.** De roadmap van 11 november zegt het letterlijk: de bewijsomgeving blijft behouden en een geslaagde Docker-test maakt nooit vanzelf iets `proven`.

De stapel raakt `packages/core`, `conformance/`, `spec/` en `SECURITY.md` niet aan. Juist daar deed de code minder dan de tekst beloofde. Daarom is hier gebouwd.

## 2. Wat er gebouwd is

| Bevinding | Wat er nu is |
|---|---|
| A3: "confidence verlagen" deed niets | Verlaagd vertrouwen verschijnt als reviewsignaal in `/state`, in de inspector en in `eai report`/`eai explain`. De status verandert niet (vector 020). De redenen horen bij één antwoordwaarde en vervallen als het antwoord verandert, net als bewijs. |
| A4: advies "vraag een persoon" werd genegeerd | Een modelvoorstel zonder bewijs komt in de reviewwachtrij als **needs a person** bij hoge impact, bij `unknown` als winnaar of bij een lage zelfgerapporteerde kans. Het signaal verdwijnt zodra een persoon bewijs toevoegt. De kans zelf wordt nergens als score getoond. |
| Herkomst van het antwoord ontbrak | De kern onthoudt wie het huidige antwoord voorstelde (`answeredBy`). `/explain` en de inspector tonen het. Het telt nooit mee voor de status. |
| Werkbank onbruikbaar zonder auditrecht | Een lezer zonder auditrecht kreeg alleen een foutmelding. Nu opent de werkbank, met de melding "log not verified for this token" in plaats van een onterecht "intact". |
| A1 en A2: "onafhankelijk" en `proven` | In de eerste ronde alleen eerlijk beschreven. In de tweede ronde opgelost, zie §4. |
| B1: vectors konden `valid_for_days` niet testen | De runner accepteert `validForDays`; vector 019 test het verlopen van bewijs. |
| B2: spec liep achter | De spec noemt nu autorisatie, worker-isolatie, logintegriteit en antwoordbereik, en zegt per punt wat normatief is en waar dat getest wordt. |
| C1, C2, C3, C5, D2 | Verouderde UMDT-alinea bijgewerkt, dode verwijzing vervangen door de commit in de git-historie, dubbele bullet weg, bronnen voor FEVER, DSPy en UMDT toegevoegd, PR-template aangevuld. |

## 3. Controle van de eerste ronde

- `npm test` na de eerste ronde: 95 tests, 94 geslaagd, 0 mislukt, 1 overgeslagen (opt-in live Ollama).
- De wijzigingen zijn als patch op de top van de stapel gezet (`feature/first-product-proof-v01-20261111`, `c268181`): geen conflicten, en de volledige testset daar blijft groen (263 tests, 259 geslaagd, 4 overgeslagen).
- De werkbank is in een headless browser geopend met een volledig en een beperkt token: reviewsignalen, de regel "Proposed by" en de integriteitsmelding verschijnen, zonder scriptfouten.

## 4. Tweede ronde: geen status zonder aanwijsbare onderbouwing

De eigenaar gaf richting: "onafhankelijk" en "proven" waren twijfelachtige stappen. Het systeem mag meer vertrouwen krijgen, maar alleen met een onderbouwing en zonder willekeur. Dat is uitgewerkt tot één principe: **een status heeft een aanwijsbare grond nodig en geldt zolang die grond geldt.** Het besluit staat in [proposal 0001](../../proposals/0001-independence-and-proven.md).

| Onderdeel | Was | Is nu |
|---|---|---|
| Onafhankelijk | Andere actor. Twee mensen met hetzelfde formulier gaven `checked`. | Geen gedeelde schakel: andere geregistreerde bron én andere waarnemer. Bewijs zonder geregistreerde bron ondersteunt wel, maar kan niets bevestigen. |
| Proven | Een check plus een willekeurige tweede herkomst. De check mocht een regel zijn die alleen het antwoord teruglas. | Een check die gegrond is: op een geregistreerde bron, op premissen die zelf uit eerste hand zijn, of met onafhankelijk bewijs ernaast. Zo'n check bewijst zonder persoon. Een check die alleen het antwoord herhaalt telt niet. |
| Houdbaarheid van een bewijs | Een check bleef gelden, ook als de waarden waarop hij steunde veranderden. | De server legt vast wat de check las. Verandert een waarde, dan vervalt de steun tot de check opnieuw draait. |
| Uitleg van een status | Een lijst redenen. | Elke status noemt de regel, het dragende bewijs en wat nodig is voor de volgende trede. |
| Modelvoorstel | Alleen het antwoord. | Vastgelegd wat het model kreeg: bronnen, inputwaarden en een hash van de capsule. Verouderde voorstellen komen in de wachtrij. |
| Werkbank | Alleen kijken. | Antwoord geven en bewijs toevoegen vanuit de inspector, met keuze van de geregistreerde bron. Ververs-knop. De onderbouwing staat bij elk bewijsstuk. |

De afleiding rekent premissen van onderaf door tot er niets meer verandert. Twee checks die alleen op elkaar leunen bewijzen daardoor niets, en de uitkomst hangt niet af van de volgorde van de vragen.

**Controle van deze ronde**

- `npm test`: 100 tests, 99 geslaagd, 0 mislukt, 1 overgeslagen (opt-in live Ollama). 28 vectors slagen, waarvan 9 nieuw of herschreven voor deze regels.
- Samengevoegd met de top van de stapel (`c268181`): geen conflicten, 268 tests, 264 geslaagd, 0 mislukt, 4 overgeslagen.
- De werkbank is in een headless browser doorlopen: bewijs toegevoegd met een geregistreerde bron, een tweede waarnemer met een andere bron gaf `checked`, een check op die premisse gaf `proven` op een modelvoorstel. Geen scriptfouten, geen horizontale scroll op telefoonbreedte.

## 5. Reflectie

**Wat dit oplevert.** De twee sterkste statussen betekenen nu wat een lezer erbij denkt. Tegelijk kan het systeem verder zonder mens: een modelvoorstel kan `proven` worden via een deterministische regel op premissen die uit eerste hand zijn, en iedereen kan zien waarop dat rust. Dat is de koppeling waar de uitvoeringslaag op kan bouwen: een Docker-test of artefactcontrole kan een check met een geregistreerde bron worden in plaats van een los logregeltje.

**Waar het op vertrouwt, en dus zwak kan zijn.**

- **De opgegeven bron van een check wordt geloofd.** De server kan niet nagaan of de checkcode die bron echt raadpleegt. Het vertrouwen verschuift naar het registreren van checks; dat gebeurt bij installatie en is te reviewen.
- **Een check op premissen is zo goed als zijn regel.** De werkbank toont de omschrijving en de gelezen waarden, maar beoordeelt de regel niet.
- **Oude logs kunnen zakken bij herberekening.** Bewijs zonder expliciet geregistreerde bron telt ook bij twee verschillende actoren niet meer als onafhankelijke bevestiging. Een check zonder vastgelegde grond bewijst evenmin iets. De regressies staan in vectoren 007, 008 en 029.
- **Packs moeten bronnen registreren.** Zonder bronnen is `checked` onbereikbaar. Hoe werkbaar dat is in echte dossiers is niet gemeten.
- **Beperkte, geaccepteerde onthulling:** een lezer van een vraag ziet óf een check nog klopt met zijn inputs, niet welke inputs of waarden. Dat staat in `SECURITY.md`.

**Nog niet gedaan.**

- Een worker kan via de server nog geen vertrouwen verlagen, en een persoon kan zo'n signaal nog niet afsluiten.
- Een persoonsantwoord zonder bewijs kan nog door een worker worden overschreven (A5); het is nu wel zichtbaar wie het antwoord gaf.
- De werkbank kan nog geen checks of workers starten en geen signalen afhandelen.
- Servergaranties zijn tests, geen afspeelbare vectors.
- Licentie, CODEOWNERS, CITATION en versienummer wachten op besluiten uit fase 5 van de roadmap.

## 6. Voorstel voor de volgende ronde

1. **De uitvoeringslaag aansluiten op de ladder.** De Docker-test en de artefactcontrole uit de stapel registreren als gegronde checks op atoms, zodat een geslaagde proef zichtbaar bewijs wordt met een houdbaarheid.
2. **Bronnen met een versie.** Een geregistreerde bron krijgt een hash of versie, zodat ook een gewijzigd document een bewijs laat vervallen.
3. **Signalen afhandelen in de werkbank**: check opnieuw draaien, worker opnieuw starten, verlaagd vertrouwen afsluiten.
4. **Dezelfde witness-garantie voor het operationslog.**
