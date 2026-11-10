# Lokale proef: twee bestanden samen testen met Ollama

Deze proef controleert de lokale EAIwork-codeworker met twee kleine JavaScript-modules. De bestanden importeren elkaar. Er worden geen bestanden uit een echt project gewijzigd.

## Voorbereiden

Gebruik de ontwikkelbranch `feature/combined-project-docker-tests-v01-20261110` van EAIwork. Hiervoor zijn Node.js 22.18 of nieuwer, Ollama, Docker en een al geïnstalleerd Ollama-model nodig.

Start Ollama en Docker. Controleer het aanwezige model en de Docker-afbeelding:

```sh
ollama list
docker pull node:22-alpine
```

Maak vanuit de hoofdmap van de EAIwork-repository een **afzonderlijke kopie** van het voorbeeldproject:

```sh
mkdir -p "$HOME/eaiwork-voorbeeld"
cp -R examples/multifile-smoke/. "$HOME/eaiwork-voorbeeld/"
```

Start de lokale EAIwork-server met een model dat al onder `ollama list` staat. Vervang `MODELNAAM` door die naam:

```sh
npm run local:ollama -- --model=MODELNAAM --worktree="$HOME/eaiwork-voorbeeld"
```

Open het lokale dashboardadres uit de terminal. Verbind met het lokale toegangstoken en ga naar **Codeworker**. Er is geen cloudfallback.

## Opdracht over twee bestanden

Maak een plan met twee regels:

```text
src/amount.js | tests/amount.test.js | Verander de export amount van 10 naar 12. Behoud de naam amount en schrijf een volledig geldig JavaScript-bestand.
src/invoice.js | tests/invoice.test.js | Voeg export function totalWithShipping(shipping = 0) toe die amount * 2 + shipping teruggeeft. Behoud de bestaande export total met de waarde amount * 2. Schrijf het volledige bestand.
```

EAIwork bewaart de bronversies en de volgorde. Voor ieder bestand:

1. Vraag een voorstel aan en controleer de verschillen en volledige vervangende code.
2. Kies **Test alle bestanden vóór toepassing**. Dit test de voorgestelde vervanging samen met de actuele andere module en beide testbestanden.
3. Bevestig de exacte wijziging. De goedkeuring geldt alleen voor deze versie.
4. Kies **Test alle bestanden na toepassing**. Pas na een geslaagde gezamenlijke test mag de volgende stap beginnen.

De testomgeving kopieert alleen de gekozen twee `.js`-bestanden en hun twee `.test.js`-bestanden, maakt daarin een minimaal `package.json` aan en voert een vaste `node --test` uit. De originele projectmap wordt niet in de container gemount. Het netwerk staat uit. Het model mag geen eigen commando's bepalen of tests uitschakelen.

## Waar let je op?

- Beide afzonderlijke modelvoorstellen moeten in het dashboard terug te lezen zijn, inclusief de oorspronkelijke en voorgestelde SHA-256.
- De projecttest hoort een manifesthash, Docker-afbeelding-ID, uitvoeringsstatus en testuitvoer te tonen.
- Bij een mislukte of ontbrekende projecttest mag EAIwork geen nieuw bestand aanpassen.
- Een gewijzigd test- of bronbestand moet oude testtoestemming ongeldig maken.
- Een nieuwe start van EAIwork moet het bestaande plan en de goedkeuringen terugvinden.
- Kijk in **Operationslog van de codeworker** of de gezamenlijke tests onder `suite-tested` zijn vastgelegd.

Een mislukte of ongeldige wijziging blijft geblokkeerd voor beoordeling. EAIwork draait eerder toegepaste bestanden niet automatisch terug. Test daarom uitsluitend met de kopie van dit voorbeeldproject.

## Testgrenzen

De gewone CI gebruikt nagebootste Ollama- en Docker-antwoorden om de volgorde, hashes en blokkades te controleren. De aparte Docker-smoketest gebruikt werkelijk Docker en twee gekoppelde modules. **Een echte Ollama-uitvoer op jouw laptop is nog niet getest.**

Deze uitvoering test alleen vooraf gekozen kleine JavaScript-bronnen en bijbehorende Node-tests. Het is geen algemene `npm test` over een volledig project en geen toestemming voor automatische commits, releases of publicatie.
