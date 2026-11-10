# EAIwork met Ollama testen op je Mac

Zorg dat **Ollama** en **Docker Desktop** openstaan. Je hebt ook Git en Node.js 22.18 of nieuwer nodig. Er moet minstens één Ollama-model op je Mac staan.

## Kopieer deze terminalcommando's

**1. Haal de testversie op**

```sh
git clone -b feature/easy-local-ollama-start-v01-20261110 https://github.com/E-AI-MODEL/EAIwork-.git ~/EAIwork-test
cd ~/EAIwork-test
```

**2. Maak Docker klaar**

```sh
docker pull node:22-alpine
```

**3. Start EAIwork met een veilig voorbeeldproject**

```sh
npm run local:ollama -- --example
```

Je ziet bijvoorbeeld dit in Terminal (de modellen op jouw Mac kunnen anders zijn):

```text
Kies je lokale Ollama-model:
  1. llama3.2:3b
  2. qwen2.5-coder:7b
  3. deepseek-r1:8b

Typ het nummer en druk op Enter:
```

**Typ alleen een nummer.** Je hoeft nergens een modelnaam in te vullen. Met één geïnstalleerd model slaat EAIwork de keuze automatisch over.

EAIwork maakt zelf een nieuwe, aparte voorbeeldmap. Je eigen projecten blijven ongewijzigd.

**4. Open je lokale dashboard**

Open [http://127.0.0.1:8788/dashboard](http://127.0.0.1:8788/dashboard), of gebruik het adres dat Terminal aangeeft. Kopieer het **toegangstoken** uit Terminal naar **Contracten en registratie**. Open daarna **Codeworker**.

**5. Plak deze twee regels in het nieuwe codeplan**

```text
src/amount.js | tests/amount.test.js | Verander de export amount van 10 naar 12. Behoud de naam amount.
src/invoice.js | tests/invoice.test.js | Voeg een export function totalWithShipping(shipping = 0) toe die amount * 2 + shipping teruggeeft. Behoud de export total.
```

Klik **Leg volgorde vast**. Controleer per bestand het voorstel, voer de gezamenlijke Docker-test uit, keur de wijziging goed en test daarna opnieuw. De volgende stap wordt alleen vrijgegeven na een geslaagde test.

**Stoppen:** druk in Terminal op **Ctrl+C**.

Bij een mislukte test stopt het plan. De eerdere wijziging wordt niet vanzelf teruggedraaid. Deze proef gebruikt alleen de gemaakte voorbeeldmap.

## Werkt het niet?

- **Geen modellen gevonden:** open Ollama en zorg dat er minstens één model is gedownload. Controleer eventueel met `ollama list`.
- **Docker niet bereikbaar:** start Docker Desktop en probeer opdracht 2 opnieuw.
- **Map bestaat al:** gebruik een andere mapnaam in opdracht 1, bijvoorbeeld `~/EAIwork-test2`, en ga daarna naar die map.
- **Dashboard niet zichtbaar:** controleer de URL die Terminal toont.

Een echte proef met jouw Ollama-model moet nog worden uitgevoerd. De GitHub-tests controleren de route met nagebootste modelantwoorden en een aparte echte Docker-test.
