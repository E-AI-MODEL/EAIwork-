# EAIwork met Ollama testen op je Mac

Je hebt **Ollama**, Git en Node.js 22.18 of nieuwer nodig. Open Ollama en zorg dat er minstens één model is geïnstalleerd. Hieronder staan de terminalcommando's, ook voor het installeren van Docker.

## Kopieer deze terminalcommando's

**1. Installeer Docker Desktop via Terminal (eenmalig)**

Controleer eerst of je Homebrew hebt:

```sh
brew --version
```

Geeft dit `command not found`? Installeer dan eerst Homebrew:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Volg de aanwijzingen in Terminal, vooral de eventuele stappen om `brew` aan je `PATH` toe te voegen. Open daarna zo nodig Terminal opnieuw.

Installeer Docker Desktop en start de app:

```sh
brew install --cask docker-desktop
open -a Docker
```

Bij de eerste start kan Docker vragen om de voorwaarden te accepteren. Controleer zodra Docker is opgestart of de engine bereikbaar is:

```sh
docker info
```

Staat Docker Desktop al op je Mac? Sla de installatie over. `open -a Docker` en `docker info` zijn voldoende.

**2. Download de Docker-testomgeving**

```sh
docker pull node:22-alpine
```

**3. Haal EAIwork op**

```sh
git clone -b feature/easy-local-ollama-start-v01-20261110 https://github.com/E-AI-MODEL/EAIwork-.git ~/EAIwork-test
cd ~/EAIwork-test
```

**4. Start EAIwork met een veilig voorbeeldproject**

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

**5. Open je lokale dashboard**

Open [http://127.0.0.1:8788/dashboard](http://127.0.0.1:8788/dashboard), of gebruik het adres dat Terminal aangeeft. Kopieer het **toegangstoken** uit Terminal naar **Contracten en registratie**. Open daarna **Codeworker**.

**6. Leg de voorbeeldopdracht vast**

De naam **Proef met twee bestanden** en de twee opdrachtregels staan in de voorbeeldmodus al ingevuld. Je hoeft niets te plakken. Klik **Leg volgorde vast**.

Je ziet nu bovenaan het scherm je opgeslagen plan met `src/amount.js` als eerste bestand. Klik op **Maak voorstel voor dit bestand**. Ollama maakt een voorstel. Verderop onder **Controleer het voorstel** staan de code en de verschillen.

Klik daarna bovenaan op **Test alle bestanden vóór toepassing**. Pas vanaf die knop gebruikt EAIwork Docker. Controleer de uitslag. Bij `passed` kun je de wijziging aanvinken en **Pas deze stap toe** kiezen. Klik vervolgens op **Test alle bestanden na toepassing**. Na een geslaagde test kun je naar `src/invoice.js`.

**Niets te zien na Leg volgorde vast?** Controleer of bovenaan **Proef met twee bestanden** staat met twee echte opdrachtregels. Grijze voorbeeldtekst in een leeg veld telt niet als invoer. De functie **Los bestandsvoorstel** verder naar beneden hoort niet bij deze proef.

**Docker controleren:** open een tweede Terminal-venster terwijl EAIwork draait:

```sh
docker info
docker image inspect node:22-alpine
```

Beide commando's moeten gegevens zonder verbindingsfout tonen. Het eerste bevestigt dat de Docker-engine bereikbaar is; het tweede dat de testafbeelding lokaal staat.

**Stoppen:** druk in Terminal op **Ctrl+C**.

Bij een mislukte test stopt het plan. De eerdere wijziging wordt niet vanzelf teruggedraaid. Deze proef gebruikt alleen de gemaakte voorbeeldmap.

## Werkt het niet?

- **Geen modellen gevonden:** open Ollama en zorg dat er minstens één model is gedownload. Controleer eventueel met `ollama list`.
- **Docker niet bereikbaar:** voer `open -a Docker` uit en wacht totdat Docker gestart is. Controleer met `docker info` en probeer daarna stap 2 opnieuw.
- **`brew: command not found`:** voer eerst de Homebrew-installatie uit stap 1 uit. Volg ook de getoonde instructie om Homebrew aan je `PATH` toe te voegen.
- **Map bestaat al:** gebruik een andere mapnaam in stap 3, bijvoorbeeld `~/EAIwork-test2`, en ga daarna naar die map.
- **Dashboard niet zichtbaar:** controleer de URL die Terminal toont.

Docker Desktop is voor persoonlijk gebruik en onderwijs doorgaans gratis volgens de voorwaarden van Docker. Voor beheerde schoolcomputers kan installatie door ICT nodig zijn. Zie [Docker-installatie voor Mac](https://docs.docker.com/desktop/setup/install/mac-install/) en [Homebrew Docker Desktop](https://formulae.brew.sh/cask/docker-desktop).

Een echte proef met jouw Ollama-model moet nog worden uitgevoerd. De GitHub-tests controleren de route met nagebootste modelantwoorden en een aparte echte Docker-test.
