# EAIwork: worker-versies en bronverwijzingen

Status: werkende ontwikkeling op concept-PR #23, 10 november 2026. Niet gepubliceerd.

## Worker-versies

Een worker behoudt een stabiel ID, bijvoorbeeld `text-normalize`. Elk contract heeft een eigen, onveranderlijke versiestring.

- `worker.register` registreert een nieuw kandidaatcontract. Bestaat al een toegelaten versie van hetzelfde ID, dan blijft die beschikbaar.
- `workerVersions[id][version]` bewaart contract, toelating, testverwijzing en status per versie. `workers[id]` verwijst naar de versie die nu actief is of, voor nieuwe workers, de eerste kandidaat.
- `quality.record` koppelt metingen aan de exacte versie en testsuite. Metingen van versie A bewijzen niets over versie B.
- `worker.release` kan met `version` een geteste kandidaat vrijgeven. De vorige actieve versie krijgt status `superseded`. Een andere versie zonder geslaagde controle kan niet actief worden.
- `worker.activate-version` zet met een persoonsgebonden motivatie een eerdere, reeds geteste en niet defecte versie terug. De uitvoerder moet vlak vóór elke taak opnieuw de actieve versie controleren.
- Een nieuwe contractversie erft **geen** runtime-rechten. Het bestaande serverrechtenmodel blijft van kracht.

### API

De bestaande route `POST /ops/workers/:id/evaluate` test de huidige kandidaat (voor nieuwe workers). Een latere kandidaat van dezelfde worker wordt getest met `POST /ops/workers/:id/versions/:version/evaluate`. Beide gebruiken een vaste, ingebouwde testsuite. Het verzoek kan geen code, modeluitvoer of testresultaat aanleveren.

Een release via `POST /ops/events` gebruikt:
```json
{"type":"worker.release","id":"text-normalize","version":"1.1.0","evidenceRef":"builtin-fixtures:<testref>"}
```
Een rollback gebruikt:
```json
{"type":"worker.activate-version","id":"text-normalize","version":"1.0.0","rationale":"Nieuwere versie faalde op controle"}
```
Het dashboard toont de geschiedenis, kandidaatversies, tests en toegelaten terugzetacties.

## Bewijsverwijzingen bij echte taken

Een taak kan nu `evidenceAtomIds` bevatten. Deze ID's verwijzen naar atomen uit het bestaande EAIwork-bewijssysteem. Het opslagmodel bewaart de verwijzing, niet automatisch de inhoud van een bron.

- Het bestaande pack bevat bijvoorbeeld `a.fin.016`. Daarom accepteert de validator ook punten in atoom-ID's.
- De server controleert of ieder opgegeven atoom bestaat én leesbaar is voor de aanvrager.
- De huidige operations-API is alleen voor auditgebruikers, maar heeft nog geen eigen rechten per missie. Zolang die ontbreekt, worden bewijslinks alleen geaccepteerd wanneer **alle auditgebruikers** het gekoppelde atoom mogen lezen. Dit voorkomt dat het ID via het gedeelde operationslog aan een andere auditgebruiker uitlekt.
- Een klik op een gekoppeld atoom in het dashboard vraagt de al bestaande `/state`- en `/explain/:atom`-API op. De server controleert die leesrechten opnieuw.
- De verwijzing heeft geen betekenis voor de bewijsstatus. `task.done` blijft iets anders dan inhoudelijke verificatie.

## Geteste grenzen

- Releasen zonder geslaagde test: weigeren.
- Een tweede versie registreren zonder de actieve versie te vervangen: toestaan.
- Versie 1.1.0 los testen en daarna via een persoon activeren: toestaan.
- Oude versie met gemotiveerde menselijke beslissing opnieuw activeren: toestaan.
- Een willekeurige of al geregistreerde versie opnieuw vrijgeven: weigeren.
- Een bewijs-ID dat niet bestaat: weigeren.
- Een bewijs-ID waarvoor niet iedereen met auditleesrechten bevoegd is: weigeren.

## Wat dit nog niet is

Geen volledige autonome workerbuilder, geen productieklare versiebeheer-UI met diff van contractwijzigingen, geen langdurige uitvoerder en geen gescheiden rechten op missieniveau. De lijst met 56 specialisaties bestaat grotendeels nog uit ontwerpen. De tests bewijzen het gedrag van de versie- en autorisatieregels voor deze gevallen, niet de betrouwbaarheid van een toekomstige AI-worker.

Zie [PR #23](https://github.com/E-AI-MODEL/EAIwork-/pull/23), `tests/operations.test.ts`, `tests/operations-api.test.ts` en `tests/missions-execution.test.ts`.
