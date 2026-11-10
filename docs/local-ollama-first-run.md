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
- De codeworker voert **geen voorgestelde code en geen unittests** uit. Hij kan wel vóór goedkeuring de syntaxis van `.js`, `.ts` en `.json` controleren. Deze controle draait met een vaste parser, niet met de door Ollama gegenereerde code. Andere bestandstypen krijgen `not-evaluated`.
- In het lokale dashboard staat een knop **Controleer voorstel opnieuw**. EAIwork vergelijkt de actuele bron met het oorspronkelijke bestand en berekent de syntaxisstatus opnieuw. Een voorstel met een syntaxisfout wordt geweigerd. Het toepassen controleert dezelfde gegevens nogmaals.
- De syntaxisuitslag bewijst niet dat de code correct werkt. Alleen een door de gebruiker gekozen JavaScript-test kan optioneel in Docker worden uitgevoerd. Terminalcommando's uit het model en publicatie worden niet gestart. De codeworker wordt nu ook zichtbaar in het lokale operationslog; hij krijgt geen zelfstandige uitvoerings- of publicatierechten.

Deze eerste codeworker is nog geen algemene autonome softwareontwikkelaar. Er is geen OS-sandbox, geen automatische git-commit en geen testexecutor. Gebruik voor de proef uitsluitend een afzonderlijke werkmap met niet-vertrouwelijke broncode.

## JavaScript-test in Docker (aparte proef)

Voor deze functie moet Docker lokaal beschikbaar zijn. Start Docker Desktop (macOS) of de Docker-daemon (Linux) en download een keer de testafbeelding:

```sh
docker pull node:22-alpine
```

EAIwork downloadt de Docker-afbeelding niet tijdens een codeaanvraag. Het programma controleert welke versie lokaal staat en bewaart de exacte afbeelding-ID bij de uitslag. Windows is voor deze eerste testroute nog niet gecontroleerd.

Gebruik de Codeworker met een gewone `.js`-bron en een apart, al bestaand `.test.js`-bestand. Het testbestand moet zelfstandig kunnen werken met de voorgestelde bron en de standaardmodules van Node.js. Bijvoorbeeld `src/counter.js` en `tests/counter.test.js`. EAIwork kopieert uitsluitend de voorgestelde vervangende bron en dit testbestand naar een tijdelijke map. Het originele project wordt niet in Docker gemount.

In het dashboard:

1. Geef het bronbestand en desgewenst het testbestand op bij het maken van het voorstel.
2. Gebruik **Test in Docker**. De test draait alleen binnen de container, met uitgeschakeld netwerk, een alleen-lezen kopie, een niet-bevoorrechte gebruiker en grenzen voor CPU, geheugen, processen en looptijd.
3. Lees de testuitslag. EAIwork bewaart de SHA-256 van het voorstel, de SHA-256 van het gebruikte testbestand en de Docker-afbeelding-ID.
4. Klik **Controleer voorstel opnieuw**. De knop om het bestand toe te passen wordt pas beschikbaar nadat de bron en het voorstel nog overeenkomen, en de opgegeven test is geslaagd. Ook daarna is jouw expliciete toestemming nodig.

Een mislukte of niet-uitgevoerde Docker-test blokkeert het toepassen **wanneer een testbestand is opgegeven**. Zonder testbestand is er geen automatische runtime-test; de bestaande syntaxis- en menselijke controles blijven bestaan. Een geslaagde test zegt uitsluitend iets over die meegeleverde test, niet over alle functionaliteit of veiligheid.

Er worden geen scripts uit `package.json` gestart, geen dependencies geïnstalleerd en geen opdrachten van het model als shellcommando uitgevoerd. De eerste versie is beperkt tot JavaScript met Node.js `node:test`. Docker zelf blijft een krachtige lokale dienst; dit is nog geen algemeen bewezen beveiligingsomgeving voor willekeurige vijandige code.

## Eerdere codevoorstellen vergelijken en herstellen

Het lokale Codeworker-scherm toont de toegevoegde en verwijderde regels naast de volledige voorgestelde vervanging. De geschiedenis blijft in dezelfde lokale opslagmap aanwezig na een herstart. Je kunt een voorstel opnieuw openen, de syntaxiscontrole bekijken en, bij een opgegeven testbestand, de Docker-teststatus opnieuw bekijken.

Na een goedgekeurde wijziging kan **Herstel vorige versie** de opgeslagen originele inhoud terugzetten. Daarvoor is opnieuw een afzonderlijke bevestiging nodig. Het gewijzigde bestand moet nog precies gelijk zijn aan het eerder toegepaste voorstel. EAIwork weigert herstel bij een latere handmatige wijziging. De back-up wordt op SHA-256 gecontroleerd en maar één keer toegepast.

De bestaande Node-/TypeScript-syntaxiscontroles en optionele Docker-test blijven verplicht waar ze waren ingesteld. Een diff is een vergelijking, geen bewijs dat het programma correct werkt. De lokale Docker-proef blijft beperkt tot één voorgesteld JavaScript-bestand met één gekozen testbestand. Er is geen projectbrede autonome bouwloop.

## Codeacties terugvinden in het EAIwork-operationslog

Onder **Meer > Codeworker** staat nu ook **Operationslog van de codeworker**. De server registreert het voorstel, de uitslag van een aangevraagde Docker-test, het handmatig toepassen en het herstellen in de bestaande lokale operationsketen. Je ziet de datum, de handelende persoon of controle, het bestandsnaam, de uitkomst en een verkorte bestands-hash.

De volledige code, Ollama-opdracht, toegangstoken en testuitvoer worden **niet** in deze operationsgebeurtenissen gekopieerd. Voorstellen en volledige testinformatie blijven apart in `code-proposals` in de lokale profielmap. Via `GET /ops/code/activity` kunnen gebruikers met auditrechten de geregistreerde gebeurtenissen opvragen. `proposalId` is een optionele filter. Niemand kan zelf een `code.activity`-event aanbieden via `POST /ops/events`.

Voorstellen uit oudere previews komen niet met een verzonnen oorspronkelijke auteur in het log. Bij de eerstvolgende gecontroleerde handeling worden ze herkenbaar als `legacy-unverified` opgenomen.

**Beperking:** het vervangen van een bestand en het wegschrijven naar het operationslog zijn nog twee afzonderlijke schrijfacties. Een fout tijdens het registreren kan optreden nadat het bestand al is gewijzigd. De API meldt dit expliciet en vraagt om inspectie. De nieuwe logregistratie bewijst dat een gebeurtenis door deze server is vastgelegd, niet dat de code inhoudelijk goed is of dat er nooit een onderbreking is geweest. Er is nog geen automatische herstelprocedure voor zo'n onvolledige registratie.
