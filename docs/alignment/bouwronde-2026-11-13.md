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
| A2: regel voor `proven` stond anders in de README | README en spec beschrijven nu de regel zoals de code hem toepast. Vector 018 legt vast dat een check alleen `observed` geeft. |
| A1: "onafhankelijk" was dubbelzinnig | README en spec zeggen nu expliciet: onafhankelijk betekent vandaag "andere actor". De keuze zelf staat open in [proposal 0001](../../proposals/0001-independence-and-proven.md). |
| B1: vectors konden `valid_for_days` niet testen | De runner accepteert `validForDays`; vector 019 test het verlopen van bewijs. |
| B2: spec liep achter | De spec noemt nu autorisatie, worker-isolatie, logintegriteit en antwoordbereik, en zegt per punt wat normatief is en waar dat getest wordt. |
| C1, C2, C3, C5, D2 | Verouderde UMDT-alinea bijgewerkt, dode verwijzing vervangen door de commit in de git-historie, dubbele bullet weg, bronnen voor FEVER, DSPy en UMDT toegevoegd, PR-template aangevuld. |

## 3. Controle

- `npm test` op deze branch: 95 tests, 94 geslaagd, 0 mislukt, 1 overgeslagen (opt-in live Ollama). Alle 20 vectors slagen.
- De wijzigingen zijn als patch op de top van de stapel gezet (`feature/first-product-proof-v01-20261111`, `c268181`): geen conflicten, en de volledige testset daar blijft groen (263 tests, 259 geslaagd, 4 overgeslagen).
- De werkbank is in een headless browser geopend met een volledig en een beperkt token: reviewsignalen, de regel "Proposed by" en de integriteitsmelding verschijnen, zonder scriptfouten.

## 4. Reflectie

**Wat goed uitpakt.** De twee beloftes uit de asymmetrieregel die alleen op papier bestonden, zijn nu zichtbaar zonder dat een model er iets mee kan opwaarderen. De wijziging is klein (één functie in de kern, twee velden in de server) en botst niet met de stapel.

**Wat ik bewust niet heb gedaan.**

- **Geen keuze over "onafhankelijk" en `proven`.** Beide veranderen de status van bestaande logs. Dat is een eigenaarsbesluit; proposal 0001 zet de opties naast elkaar.
- **Geen weg voor een worker om via HTTP vertrouwen te verlagen.** Dat signaal kan nu alleen uit de kern of uit een ingelezen log komen. Een worker die het oneens is met een bewezen antwoord wordt nog steeds alleen afgewezen. Dat koppelen kan pas goed als een persoon zo'n signaal ook kan afsluiten, en dat vraagt een nieuw eventtype.
- **Geen bescherming van een persoonsantwoord zonder bewijs** tegen overschrijven door een worker (A5). `answeredBy` maakt het nu wel zichtbaar.
- **Geen licentie, CODEOWNERS, CITATION of versienummer.** Die hangen aan besluiten die de roadmap in fase 5 legt.
- **De falende test uit mijn vorige observatie** is op de stapel zelf al hersteld (`7c082c8`).

**Zwakke plekken in deze bouw.**

- Verlaagd vertrouwen kan niet worden afgesloten zolang het antwoord gelijk blijft. Bij veel signalen wordt dat ruis.
- De drempel voor "lage kans" is de bestaande vaste 0,8 uit `calibrate.ts`. Die is niet gekalibreerd op echte data.
- Servergaranties zijn nog steeds tests, geen vectors. De spec zegt dat nu eerlijk, maar een tweede implementatie kan ze niet automatisch controleren.

## 5. Voorstel voor een volgende ronde

1. Besluit over proposal 0001, daarna de bijbehorende vectors.
2. Een eventtype waarmee een persoon een verlaagd-vertrouwen-signaal afsluit, en daarna de worker-route die het signaal kan geven.
3. Servergaranties als afspeelbare HTTP-vectors.
4. Dezelfde witness-garantie voor het operationslog van de stapel (staat ook in de roadmap als nog niet bewezen).
