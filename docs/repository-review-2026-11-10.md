# EAIwork: repositorycontrole van 10 november 2026

**Onderzocht:** `E-AI-MODEL/EAIwork-`, ontwikkellijn van concept-PR #23
tot en met #27. Momentopname: commit
`4bc3b8d402e78d2521773b05a64add0e4ba410c8`.
De Git-boom bevat op dat moment 176 items: 137 bestanden,
39 mappen, 34 testbestanden, 22 bestanden in `docs/` en vier workflows.

De boom en de actuele CI zijn opgehaald via de GitHub-verbinding.
Van de modules hieronder zijn de broncode, aanroepen en gerichte
regressietests gecontroleerd. Dit is **geen** onafhankelijke audit van
iedere regel code of een uitgevoerde productiebelastingstest.

## Wat er al werkt

- `packages/core/src/`: status is afgeleid uit events en bewijs.
  Modeluitvoer kan niet zelf de bewijsstatus verhogen.
- `packages/server/src/store.ts` en `witness.ts`: het bestaande
  bewijsspoor heeft een afzonderlijke, ondertekende witnessketen.
- `packages/operations/src/store.ts`: operations heeft een aparte,
  lokale hashketen met gesynchroniseerde writes, een exclusieve
  schrijver en beperkt crashherstel. Operations heeft nog **geen**
  onafhankelijke witness.
- `packages/operations/src/missions.ts` en `scheduler.ts`:
  opdrachten en afhankelijkheden worden bewaard; uitsluitend
  goedgekeurde lokale teksttaken kunnen beperkt automatisch starten.
  Ook bij hervatting blijft budget gelden.
- `packages/operations/src/registry.ts`, `quality.ts`,
  `selector.ts` en `builder.ts`: registratie, contracttests,
  een kleine ingebouwde samenstelling, kwaliteitsmetingen en
  read-only werkervoorkeuren. Een ontwerp in de catalogus is
  geen draaiende worker.
- `packages/operations/src/reposearch.ts`: zoekt in de vooraf
  geconfigureerde lokale repository en levert bestands-hashes en
  regelnummers. Er is geen algemene GitHub-, web- of documentcrawler.
- `packages/operations/src/planner.ts`, `preflight.ts` en
  `replan.ts`: de lokale modelplanner kan fasevoorstellen, open
  vragen en aanvullende taken voorleggen. De server valideert
  afhankelijkheden en eerder vastgelegde voorwaarden. Een voorstel
  is nooit toestemming voor uitvoering.
- `prototypes/dashboard/index.html` en `scripts/local-demo.ts`:
  de uitgebreide demonstratie en de tijdelijke server blijven
  afzonderlijk beschikbaar.

## Werkelijke beperkingen

**Omvang en snelheid.** `registry.ts::applyOps` controleert een nieuw
event-ID in de volledige historie en kopieert de bestaande toestand.
`store.ts::snapshot` maakt eveneens een kopie. Bij veel events kan
dit steeds duurder worden. Deze controle heeft geen representatieve
belastingmeting gedaan, dus er is geen onderbouwde grens in events
per seconde.

**Uitvoering.** De scheduler is proceslokaal en sequentieel.
Er zijn nog geen gedeelde taakclaims, meerdere uitvoerende
processen, procesisolatie voor willekeurige workers of algemeen
idempotente externe acties. De taakplannen zijn begrensd tot
32 taken. Een groene unit-/API-test bewijst geen grootschalige
autonome uitvoering.

**Planner.** Bronlocaties en faseregels worden structureel getoetst,
niet op semantische volledigheid. Een model kan expliciete regels
uit de opdracht missen. `missingInformation` is geen
onafhankelijk vastgestelde feitenlijst. Herplanning blijft
voorstel-only tot de oorspronkelijke missie-eigenaar goedkeurt.

**Bronnen en kwaliteit.** RepoSearch-matches zijn bronkandidaten,
geen gecontroleerd hergebruikbewijs. De workerselector controleert
beschikbaarheid en rechten, maar maakt nog geen kosten-/latentie-
of kwaliteitsschatting uit representatieve productieproeven.

**Beveiliging.** De eigen operations-hashketen bewijst geen
authenticiteit tegen een beheerder die alle lokale bestanden
kan wijzigen. De bestaande ondertekende witness geldt voor het
aparte evidence-log, niet automatisch voor operations. De
RepoSearch-naam- en inhoudfilters zijn een beperkte bescherming,
geen volledige geheimendetector.

**Dashboard.** De repository bevat tests voor JavaScript-syntaxis,
navigatie en API-koppeling. In deze controle is geen echte
browser-run, visuele vergelijking op mobiel of productiehost
uitgevoerd.

## Wijzigingslijn

- [#23](https://github.com/E-AI-MODEL/EAIwork-/pull/23):
  dashboard, lokale workers en beperkte automatische uitvoering
- [#24](https://github.com/E-AI-MODEL/EAIwork-/pull/24):
  veiligere lokale opslag en herstart
- [#25](https://github.com/E-AI-MODEL/EAIwork-/pull/25):
  versiegebonden planuitbreidingen
- [#26](https://github.com/E-AI-MODEL/EAIwork-/pull/26):
  fases, preflight en blokkeren van onopgeloste onzekerheden
- [#27](https://github.com/E-AI-MODEL/EAIwork-/pull/27):
  modelvoorstellen voor uitbreiding zonder herschrijven van oud werk

Alle vijf zijn afzonderlijke concept-PR's op elkaar gestapeld.
Niets is door deze controle naar `main` gemergd of op
`eaimodel.nl` gepubliceerd.

## Volgende technische proef

Maak een herhaalbare belastingproef met een oplopend aantal
operations-events en meerdere missies. Meet geheugengebruik,
hersteltijd en events per seconde. Ontwerp daarna een queue met
atomische claims, toegangscontrole, procesgrenzen en expliciete
herhaalregels. Pas dan meerdere gelijktijdige workers inschakelen.

Het einddoel blijft de al afgesproken opdracht met drie bestaande
GitHub-projecten: onderzoeken, vergelijken, verbeteren, testen en
controleerbaar opleveren. Die proef is nog niet door EAIwork
uitgevoerd.
