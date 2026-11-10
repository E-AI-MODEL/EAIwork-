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

Ollama draait standaard op `http://127.0.0.1:11434`, het dashboard op `http://127.0.0.1:8788/dashboard`. Een ander lokaal poortnummer kan met `--port=8789`. Het Ollama-adres kan via `--host=http://127.0.0.1:11435` of `EAI_OLLAMA_HOST` worden veranderd. LAN-hosts en externe adressen worden geweigerd. Een langer modelverzoek kan met `--timeout-ms=110000` (maximaal 120 seconden).

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
- De sessie gebruikt nog een **tijdelijke demo-opslag** en verwijdert die bij normaal afsluiten. Niet gebruiken voor vertrouwelijke leerling-, personeels- of klantgegevens.
- Voor productie ontbreken nog blijvende lokaal beveiligde opslag, reproduceerbaar modelprofiel, verantwoord modelbudget, beproefde inhoudelijke checks en een generieke codeworker.

## Controles

```sh
node --test tests/local-ollama-first-run.test.ts
npm test
```

Deze tests gebruiken een echte loopback-HTTP-server met nagebootste Ollama-antwoorden. Dat bewijst de integratie en bevoegdheidsgrenzen, niet dat het gekozen model zelf goed kan plannen. Een real-modeltest moet op de eigen computer uitgevoerd worden met een geïnstalleerd model; vergelijk dan het bronplan, de voorstelstatus en de handmatige goedkeuring.
