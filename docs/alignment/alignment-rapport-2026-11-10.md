# Alignment-rapportage EAIwork (overkoepelend)

- **Datum:** 2026-11-10
- **Rol:** overkoepelende alignment-controle. **Dit rapport informeert en adviseert. Het besluit niets.** Alle keuzes hieronder liggen bij de eigenaar/maintainers.
- **Basis:** branch `claude/gifted-babbage-hwh111` op commit `69f5793` (gelijk aan de laatste merge, PR #21).
- **Vraag:** sluiten README, specificatie, conformance vectors, schema, docs, code, tests, CI en governance-bestanden op elkaar aan? Waar lopen ze uiteen?

---

## 1. Methode

1. Alle 91 bestanden in de repository geïnventariseerd. Volledig gelezen: README, spec, SECURITY, templates, schema, de hele `packages/core`, `server.ts`, `authz.ts`, `gateway.ts` en de relevante delen van `ollama-provider.ts` en `observe.ts`, alle docs, de bibliografie, CITATION en de workflows.
2. Gedraaid: `npm test` (**89 geslaagd, 0 mislukt, 1 overgeslagen**: de opt-in live Ollama-test), `npm run lint:pack` (ok) en `npm run replay:demo` (gedraagt zich zoals de README beschrijft).
3. Vier randgevallen van de statusafleiding nagespeeld met een los replay-script buiten de repository (zie §3, A1–A3).
4. Niet gedaan: geen code gewijzigd, geen echte modelruns, geen GitHub-instellingen bekeken (teams, branch protection, Actions-uitkomsten).

## 2. Samenvatting

| Gebied | Oordeel | Kern |
|---|---|---|
| Veiligheidsgrenzen (auth, scoping, workers, log/witness) | 🟢 goed aligned | Code, tests en SECURITY.md zeggen hetzelfde |
| Evaluatie-docs (DEV/frozen/after-action) | 🟢 goed aligned | Eerlijk over hun grenzen; geen overclaims gevonden |
| Kernsemantiek van de statusladder | 🟠 deels | De woorden "origin", "proven" en "lower confidence" betekenen in de code iets smallers dan in de README en spec |
| Normatieve bron (spec ↔ vectors ↔ schema) | 🟠 deels | De README noemt de vectors normatief, maar die dekken alleen de core |
| Documentonderling | 🟡 kleine breuken | Eén verouderde doc, één dode verwijzing, één dubbele bullet |
| Governance/proces | 🟡 onaf | CODEOWNERS, PR-template, CITATION en versiebeheer lopen achter op de inhoud |

**Belangrijkste boodschap:** de technische *autoriteitsgrens* (een model kan zijn eigen status niet verhogen) is consistent ingericht en wordt goed getest. De afwijkingen zitten vooral in wat de *woorden* beloven tegenover wat de code precies doet. Daarnaast is onduidelijk welk document leidend is.

---

## 3. Bevindingen

Ernst: **H** = hoog (kan tot verkeerde vertrouwensclaims leiden), **M** = middel, **L** = laag.
Elke bevinding noemt opties. De keuze is aan de eigenaar.

### A. Kernsemantiek

**A1 (H): "Onafhankelijke origin" betekent in de server "andere actor".**
- Spec §3/§5 spreekt van lineage als *origin chain*. De README spreekt van "independent origins".
- De server zet lineage altijd op `actor:<kind>:<id>` (`packages/server/src/server.ts`, `canonicalEvidence`).
- Nagespeeld: twee personen die elk hetzelfde ondertekende formulier als `observed` bijvoegen, maken samen **`checked`**. Twee personen die dezelfde bron citeren tellen dus als twee onafhankelijke bronnen.
- Vector 006 test alleen "dezelfde lineage-string", niet "dezelfde onderliggende bron".
- *Opties:* (a) de huidige betekenis expliciet documenteren als "onafhankelijke waarnemers"; (b) lineage server-side laten afleiden van bron/herkomst (bijv. een broker-bronhandle); (c) een vector toevoegen die het gekozen gedrag vastlegt.

**A2 (H): Wanneer `proven` ontstaat, staat in de docs anders beschreven dan in de code.**
- README: *"A deterministic server-registered check can create proven status."*
- De code (`derive.ts`) vraagt een deterministische check **en** ten minste twee lineages. Nagespeeld:
  - alleen een check → **`observed`**, niet `proven`;
  - één persoon met alleen `reported` (= claim) plus een check → **`proven`**. Er is dan geen tweede `observed` waarnemer nodig en de trede `checked` wordt overgeslagen.
- Vector 008 dekt alleen de route met een `observed` persoon.
- *Opties:* (a) de README/spec-tekst laten aansluiten op de code; (b) de regel aanscherpen (bijv. `proven` alleen bovenop `checked`); (c) in beide gevallen vectors toevoegen voor "alleen check" en "reported + check".

**A3 (M): "Een model mag confidence verlagen" heeft geen merkbaar effect.**
- README, spec §4 en de release notes beloven dit.
- `confidence.lowered` wordt opgeslagen in `AtomState.lowered`, maar `derive()` gebruikt het niet en de client toont het niet. Nagespeeld: na `confidence.lowered` blijft de status `observed`.
- *Opties:* (a) documenteren als "alleen audit-signaal"; (b) een effect definiëren (bijv. een review-signaal of plafond) met een conformance vector; (c) het tonen in de evidence inspector.

**A4 (M): De routeringsadviezen van de calibratiestap worden niet afgedwongen.**
- `route()` in `calibrate.ts` (*"high impact goes to a person"*) wordt door `executeAtomWorker` berekend. De server negeert `result.route` en schrijft een geldig modelantwoord altijd weg als `answer.proposed`.
- `docs/zai-lessons-and-evaluation.md` spreekt over de "accept-as-assumption route" alsof die in runtime bestaat.
- De status blijft `assumption`, dus de autoriteitsgrens houdt. Een atom met `impact: high` krijgt echter geen menselijke route.
- *Opties:* (a) documenteren dat route alleen informatief is; (b) een review-signaal of flag toevoegen voor `ask-person`; (c) high-impact worker-uitkomsten in een wachtrij zetten.

**A5 (L): Een modelworker kan het antwoord van een persoon zonder evidence overschrijven.**
- `validate.ts` blokkeert dit alleen als er niet-model-evidence is. Een persoon die "yes" invult zonder evidence kan dus stil worden overschreven door een worker-"no".
- Dit is consistent met de ladder (beide zijn `assumption`), maar wordt nergens benoemd.
- *Optie:* expliciet beslissen en documenteren.

### B. Normatieve bron: spec, vectors en schema

**B1 (H): Wat volgens de README normatief is, dekt de belangrijkste garanties niet.**
- README en spec: *"The normative behavior lives in `conformance/vectors/`."*
- De vectors (`conformance/run.ts`) testen alleen `replay()` uit de core. Server-garanties staan alleen in `tests/`, niet in de vectors. Het gaat om server-afgeleide lineage, `check.passed` alleen door de server, scoping, verbod op model-tokens, worker-isolatie en witness.
- De runner geeft geen `validForDays` door, dus `valid_for_days` is niet met een vector te testen.
- *Opties:* (a) "normatief" beperken tot de core-semantiek en de server-garanties als tweede normatieve laag benoemen; (b) een HTTP-conformanceformaat toevoegen; (c) de runner uitbreiden met pack-context.

**B2 (M): De spec loopt achter op de README en de code.**
- `spec/README.md` (9 punten) noemt geen autorisatie, worker-isolatie/AtomCapsule, het `verify-claim`-contract of de witness/rollback-garantie. De README en SECURITY.md doen dat wel.
- *Optie:* kiezen welk document leidend is en de andere daarnaar laten verwijzen.

**B3 (L): Het schema is een placeholder.**
- `schema/v0.1/event.schema.json` beschrijft alleen top-level velden, valideert `evidence`/`value`/`probabilities` niet, gebruikt `$id` op `example.org` en wordt door geen code gebruikt.
- De README zegt dit eerlijk ("not yet enforced"). Toch staat het schema in CODEOWNERS en in het PR-template als volwaardig onderdeel.
- *Optie:* markeren als concept, of aanvullen en in CI valideren.

### C. Consistentie tussen documenten

**C1 (M): `docs/umdt-inspired-evidence-gate.md` is verouderd.**
- Er staat *"Not yet wired… that provider currently returns only a probability distribution"*.
- Sinds PR #21 heeft de Ollama-provider `propose()` (`ollama-provider.ts:204`) en `docs/model-capability-neutral.md` beschrijft dat als geïmplementeerd.
- *Advies:* de non-goals-sectie bijwerken.

**C2 (M): Dode verwijzing.**
- `docs/atomic-claim-contract.md` verwijst naar `benchmarks/archive/evidence-controls.v0.1.dev.json`. Die map en dat bestand bestaan niet. Het doc noemt dat bestand als bewaard archief van een gemeten fout.
- *Advies:* het bestand terugzetten of de verwijzing vervangen door een commit-hash.

**C3 (L):** In `SECURITY.md` staat de regel over worker-input-orakels twee keer met bijna dezelfde tekst.

**C4 (L): Taal.** `docs/worker-isolation.md` is Nederlands, de rest Engels.
- *Optie:* een taalbeleid kiezen.

**C5 (M): De bibliografie en de docs zijn niet gekoppeld.**
- Het PR-template eist een bibliografie-entry voor elke onderzoeksclaim. Toch hebben FEVER, DSPy, UMDT en het Z.ai/GLM-prototype geen entry.
- Omgekeerd verwijst geen enkel doc naar de bestaande ids (`huang-2023`, `guo-2017`, …).
- `nine-judges-2026` (arXiv 2605.29800, één auteur) heb ik niet kunnen verifiëren.
- *Advies:* de verwijzingen aanvullen en een CI-check overwegen.

**C6 (L): De vervolgmeting staat open.**
- `docs/validation-3b-7b-after-action.md` kondigt een herhaalrun aan voor 7B whole (langere timeout). Een vastgelegde uitkomst daarvan staat niet in de repository.
- *Advies:* de uitkomst toevoegen of de status expliciet "open" maken.

**C7 (L): Mogelijke overclaim in de release notes.**
- `docs/releases/v0.1.0.md`: *"cached constant-time integrity verification"*. Feitelijk gaat het om een gecachte head plus file-fingerprints, dus geamortiseerd O(1) en niet "constant-time" in cryptografische zin.
- *Advies:* de formulering aanpassen.

### D. Governance en proces

**D1 (M): CODEOWNERS werkt vermoedelijk niet.** Het bestand verwijst naar `@eai-work/maintainers` en `@eai-work/security`, terwijl de repository-eigenaar `E-AI-MODEL` is. Niet bestaande teams leiden niet tot verplichte reviews. Dit heb ik niet in GitHub geverifieerd.
- *Advies:* controleren en zo nodig aanpassen.

**D2 (L): Het PR-template is onvolledig.** De checkboxes noemen alleen spec/schema/core/pack/docs. Server, gateway, evidence, evaluation, client en CI ontbreken, terwijl de recente PRs (#9–#21) juist daar zitten.

**D3 (L): CITATION.cff is onvolledig** (*"Set date-released… before first publication"*), terwijl v0.1.0 al is uitgebracht.

**D4 (L): Versiebeheer.** `package.json` staat nog op `0.1.0`, terwijl na de release de gateway, de Ollama-provider, evaluatie en de evidence observer zijn toegevoegd. Er is geen changelog sinds v0.1.0.

**D5 (M): Reproduceerbaarheid van de frozen validatie.**
- Het protocol eist versie-gepinde code. De workflows installeren Ollama via `curl … | sh` (niet gepind) en modellen via een tag (`qwen2.5:7b`) zonder digest.
- Een herhaalrun kan dus op andere gewichten en een andere runtime draaien zonder dat het rapport dat laat zien.
- *Advies:* de Ollama-versie en de model-digest pinnen of in het rapport vastleggen.

**D6 (L): De demo van de quickstart kan geen workers draaien en geen `proven` bereiken.** `npm run serve` configureert geen workers of checks, dus `/workers/*` geeft 503 en `/checks/*` 404. Dat klopt technisch, maar de README vermeldt het niet.

---

## 4. Wat goed aligned is

- **De model-asymmetrie wordt op meerdere plekken bewaakt:** `validate.ts`, model-evidence wordt uitgesloten in `derive.ts`, publieke tokens mogen geen modellen vertegenwoordigen en de worker-route is execute-only met 204. Vectors 001–004 en 017 en de servertests dekken dit.
- **Autorisatie (default-deny, write ⊆ read, gescope'de checks en workers) doet in de code precies wat SECURITY.md beschrijft.**
- **De worker-isolatie in `docs/worker-isolation.md` sluit één-op-één aan op `buildAtomCapsule` en de servercontroles,** inclusief de consistentiecontrole tijdens generatie.
- **De evaluatie-docs zijn uitgesproken voorzichtig:** DEV ≠ holdout, geen modelpromotie, een timeout telt niet als modelfout. Ik vond geen claims die verder gaan dan de data.
- **CI bewaakt dat de core geen netwerk gebruikt en dat elke bibliografie-entry een type heeft.**

## 5. Beslispunten voor de eigenaar

Alleen geïnventariseerd, zonder voorkeur afgedwongen:

1. **Wat betekent "onafhankelijk"?** Andere actor of andere onderliggende bron? (A1)
2. **Wat is de exacte regel voor `proven`?** En moet die bovenop `checked` liggen? (A2)
3. **Moet `confidence.lowered` iets doen, of is het alleen audit?** (A3)
4. **Moet `route = ask-person` in de runtime iets afdwingen?** (A4)
5. **Welk document is leidend: spec, README of vectors?** En horen server-garanties bij de normatieve laag? (B1, B2)
6. **Taalbeleid voor docs en de rol van het schema.** (B3, C4)
7. **Governance:** CODEOWNERS-teams, PR-template, CITATION, versie/changelog en het pinnen van modellen. (D1–D5)

## 6. Grenzen van dit rapport

- Statische controle plus lokale tests. Geen echte modelruns en geen inzage in GitHub Actions-uitkomsten of repository-instellingen.
- De randgevallen in A1–A3 zijn nagespeeld via `replay()` in de core, met dezelfde lineage-vorm die de server toekent. Ze zijn niet via HTTP afgespeeld.
- Onderzoeksreferenties zijn niet inhoudelijk op juistheid gecontroleerd.
