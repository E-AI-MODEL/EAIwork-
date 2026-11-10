# Lokaal werken met Ollama

Dit is een eerste **werkende koppeling voor planvoorstellen**. Ollama draait op je eigen computer. EAIwork bouwt de bestaande werkruimte en de tijdelijke lokale operationsregistratie op. Het model stelt plannen voor; het voert niet zelfstandig nieuwe opdrachten, softwarebuilds of externe acties uit.

## Starten op macOS, Windows of Linux

Installeer Node.js 22.18 of nieuwer en Ollama. Start de Ollama-dienst (op macOS doorgaans de Ollama-app, op Linux eventueel `ollama serve`). Download een model:

```sh
ollama pull qwen2.5:1.5b
ollama list
npm run local:ollama -- --model=qwen2.5:1.5b
```

Gebruik een ander **reeds geïnstalleerd** model met `--model=NAAM`. Bij precies één beschikbaar model kiest EAIwork dat automatisch. Bij meerdere modellen vraagt het om een expliciete keuze. Het programma haalt nooit ongemerkt modellen op.

Ollama draait standaard op `http://127.0.0.1:11434`, het dashboard op `http://127.0.0.1:8788/dashboard`. Een ander lokaal poortnummer kan met `--port=8789`. Je kunt de opslagmap apart kiezen met `--data-dir=/pad/naar/eaiwork`, buiten de broncodemap. Het Ollama-adres kan via `--host=http://127.0.0.1:11435` of `EAI_OLLAMA_HOST` worden veranderd. LAN-hosts en externe adressen worden geweigerd. Een langer modelverzoek kan met `--timeout-ms=110000` (maximaal 120 seconden).

## Een echte lokale planproef

Open het dashboardadres dat de terminal geeft. Kies **Meer > Contracten en registratie**. Kopieer het in dezelfde terminal getoonde tijdelijke toegangstoken naar het verbindingsveld. De statusbalk meldt het geconfigureerde lokale model. Deze melding bewijst nog niet dat het model al een goed antwoord heeft gegeven.

Open **Uitvoering** en vul onder **Taakvoorstel uit lokaal taalmodel** bijvoorbeeld in:

> Normaliseer de tekst "  Dit   is   een   proef  " en tel daarna het aantal woorden. Gebruik uitsluitend lokale tekstbewerkingen. Verwijder of publiceer niets.

De server stuurt deze opdracht naar `/api/chat` van de lokale Ollama-dienst met een gestructureerd uitvoercontract. EAIwork controleert het voorgestelde schema, afhankelijkheden en de expliciet gevonden beperkingen. Controleer de inhoud zelf. Goedkeuren is een afzonderlijke actie, geen gevolg van de modeluitvoer. Alleen toegelaten lokale workercontracten kunnen daarna taken uitvoeren.

Niet alle voorgestelde taken zijn uitvoerbaar: de aanwezige workers ondersteunen momenteel een beperkte groep vaste tekst- en repositoryfuncties. Een vrij taalmodel heeft nog geen algemene schrijf- of codeworker met toegang tot bestanden.

## Veiligheid en grenzen

- Het dashboard en modelendpoint gebruiken uitsluitend loopback. Er is geen cloudprovider of API-sleutel.
- De server zendt een opdracht alleen aan Ollama na een expliciet planverzoek. Tokens, missie-ID's uit het operationslog en andere opdrachten worden niet aan Ollama doorgegeven.
- Het token is alleen bedoeld voor je eigen machine. Behandel het als een wachtwoord en deel het niet.
- De verbinding met een lokaal model wordt in het dashboard als **geconfigureerd** getoond. Echte bereikbaarheid en modeluitvoer worden bij de planoproep vastgesteld.
- Planvoorstellen krijgen altijd `requires-human-review` en `constraintCoverage:not-evaluated`. Ze mogen geen zelfstandig publicatierecht of bewijsstatus aanmaken.
- De lokale sessie bewaart gegevens **blijvend**. Alle data staat in de opgegeven profielmap; maak zelf back-ups en gebruik geen vertrouwelijke leerling-, personeels- of klantgegevens tijdens deze ontwikkelfase.
- Voor productie ontbreken nog veilige sleutelrotatie, automatische back-ups, reproduceerbaar modelprofiel, verantwoord modelbudget, beproefde inhoudelijke checks en een generieke codeworker.

## Controles

```sh
node --test tests/local-ollama-first-run.test.ts
npm test
```

Deze tests gebruiken een echte loopback-HTTP-server met nagebootste Ollama-antwoorden. Dat bewijst de integratie en bevoegdheidsgrenzen, niet dat het gekozen model zelf goed kan plannen. Een real-modeltest moet op de eigen computer uitgevoerd worden met een geïnstalleerd model; vergelijk dan het bronplan, de voorstelstatus en de handmatige goedkeuring.

## Afgeschermde codeworker (ontwikkelproef)

Kies uitdrukkelijk een lokale projectmap waar EAIwork codevoorstellen mag voorbereiden:

```sh
npm run local:ollama -- --model=qwen2.5:1.5b --worktree=/pad/naar/een-project
```

Open de lokale werkruimte en kies **Meer > Codeworker**. Geef één **bestaand relatief bestand** op, bijvoorbeeld `src/main.ts`, en beschrijf de gewenste verandering. Ollama krijgt uitsluitend de opgegeven opdracht, dat bestand en een strak uitvoercontract. Het model levert de volledige vervangende inhoud en een toelichting.

- Zonder `--worktree` is de codeworker uitgeschakeld.
- Alleen kleine bestaande tekstbestanden met de ondersteunde extensies `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.css`, `.html`, `.md` of `.py` zijn toegestaan. Geen verborgen bestanden, symbolische links, directorytraversal of bestanden boven 32 KiB.
- EAIwork bewaart elk voorstel in `~/.eaiwork/local/code-proposals`. De werkmap wordt bij het voorstellen **niet** aangepast.
- Lees de voorgestelde code zelf na. Voor het toepassen is een aangevinkte bevestiging, een tweede expliciete bevestiging en een overeenkomende SHA-256 verplicht.
- De server controleert vóór het vervangen opnieuw de oorspronkelijke bestandsinhoud. Een gewijzigd bestand wordt niet overschreven. De oorspronkelijke tekst blijft als lokale back-up in de voorstelmap.
- De codeworker voert **geen code, tests of shellcommando's** uit. Hij kan niet uit zichzelf publiceren of een nieuwe map kiezen. De gewone missieplanner en operationsstatus blijven gescheiden van deze eerste handmatig beoordeelde bestandswijziging.

Deze eerste codeworker is nog geen algemene autonome softwareontwikkelaar. Er is geen OS-sandbox, geen automatische git-commit en geen testexecutor. Gebruik voor de proef uitsluitend een afzonderlijke werkmap met niet-vertrouwelijke broncode.

## Veranderde regels bekijken en terugzetten

Het Codeworker-scherm toont nu de regels die Ollama wil toevoegen of verwijderen. De volledige vervangende tekst blijft ook beschikbaar. Je kunt eerdere voorstellen na een herstart opnieuw openen. Het scherm toont of het geselecteerde bronbestand inmiddels veranderd is.

Voor `.json` controleert EAIwork of de voorgestelde tekst geldige JSON is. Voor `.js` laat EAIwork Node.js de syntaxis **alleen lezen**, zonder het programma uit te voeren. Een mislukte controle blokkeert het toepassen. Voor TypeScript, Python, CSS, HTML en Markdown staat expliciet **niet gecontroleerd**. Dit is geen bewijs dat de code correct werkt. De lokale werker voert nog geen eigen tests of scripts uit.

Na een goedgekeurde wijziging biedt hetzelfde voorstel **Herstel de eerdere versie** aan. Herstellen vraagt opnieuw een afzonderlijke bevestiging en werkt uitsluitend wanneer het bestand nog precies overeenkomt met de eerder toegepaste vervanging. De oorspronkelijke back-up wordt vóór het herstellen op SHA-256 gecontroleerd. Je kunt dezelfde wijziging maar één keer terugzetten. Werk dat je intussen zelf aan het bestand hebt gedaan, wordt niet overschreven.

De voorstelgeschiedenis staat in de bestaande lokale profielmap. Back-ups blijven lokaal; er is geen automatische back-up naar een andere schijf. De werkmap heeft nog geen geïsoleerde OS-sandbox, dus gebruik voorlopig een afzonderlijke kopie van je project.
