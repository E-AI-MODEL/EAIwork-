# Start hier: EAIwork op je eigen computer

EAIwork draait nu op je **eigen computer**, niet op eaimodel.nl. De publieke website toont een demonstratie. Deze gids gaat over de echte lokale werkruimte.

## Wat heb je nodig?

- **Node.js 22.18 of hoger** op je Mac, Windows- of Linuxcomputer.
- De map `EAIwork-` uit [GitHub](https://github.com/E-AI-MODEL/EAIwork-). Met Git kan dat eenmalig via `git clone https://github.com/E-AI-MODEL/EAIwork-.git`.
- Voor modelondersteuning: de **Ollama-app of -dienst**, met ten minste één lokaal gedownload model. Voor codeproeven in een Docker-container: daarnaast Docker en een vooraf gedownloade `node:22-alpine`-afbeelding.

Open Terminal (Mac/Linux) of PowerShell (Windows) **in de map EAIwork-**. Je hoeft geen server te installeren bij een internetprovider.

## Kies één startwijze

### Alleen kijken en oefenen

```sh
npm run demo:dashboard
```

Dit start de server met voorbeeldgegevens. **De gegevens worden bij normaal afsluiten verwijderd.** Geen Ollama nodig. Er verschijnt een volledige link met een tijdelijk toegangstoken.

### Echte lokale werkruimte met Ollama

Start Ollama op deze computer. Je kunt een klein model eenmalig installeren:

```sh
ollama pull qwen2.5:1.5b
ollama list
npm run local:ollama
```

EAIwork gebruikt een geïnstalleerd model voor planvoorstellen en vraagt bij meerdere modellen om een keuze. Het model wordt **niet** stilzwijgend gedownload. Je gegevens en de lokale werkgeschiedenis blijven in `~/.eaiwork/local` staan. De standaardlocatie van Ollama is `http://127.0.0.1:11434`.

Een specifiek model kiezen:

```sh
npm run local:ollama -- --model=qwen2.5:1.5b
```

### Codeworker testen op een afzonderlijk voorbeeldproject

```sh
docker pull node:22-alpine
npm run local:ollama -- --example
```

Dit maakt een tijdelijke voorbeeldwerkmap. Voor je eigen project gebruik je `--worktree=/pad/naar/project` in plaats van `--example`. De codeworker maakt voorstellen, controleert bronbestanden en kan met Docker afgesproken tests uitvoeren. Toepassen of herstellen vereist altijd jouw goedkeuring. Werk tijdens deze ontwikkelfase niet met vertrouwelijke leerling-, personeels- of klantgegevens.

## Waar open je het dashboard?

De terminal geeft een link die begint met:

`http://127.0.0.1:8788/dashboard#token=...`

**Open de complete link op dezelfde computer** waarop EAIwork draait. Het tijdelijke token wordt na het openen uit de adresbalk verwijderd. Deel deze link niet. Zonder automatische verbinding kun je `http://127.0.0.1:8788/dashboard` openen en het token uit Terminal invullen.

In het dashboard: **Overzicht** om te beginnen, **Uitvoering** voor een lokale teksttaak of missie, **Codeworker** voor een codevoorstel en **Meer functies** voor de technische onderdelen. Een worker is niet automatisch actief omdat hij in de bibliotheek staat.

## Stoppen en opnieuw starten

Laat Terminal open tijdens het werken. Met `Ctrl+C` stop je de server. Start later vanuit dezelfde map opnieuw met een van de commando's hierboven.

- `demo:dashboard` maakt bij een volgende start weer nieuwe voorbeeldgegevens.
- `local:ollama` hergebruikt de lokale profielmap.
- `127.0.0.1` betekent: **alleen op dit apparaat**. Je telefoon kan een server op je Mac niet via zijn eigen localhost-adres bereiken. Een online, beveiligde EAIwork-server is nog niet ingericht.

## Veelvoorkomende problemen

| Wat zie je? | Wat doe je? |
| --- | --- |
| `npm: command not found` | Installeer Node.js 22.18+ en open Terminal opnieuw |
| `Ollama reageert niet` | Start Ollama op dezelfde computer en controleer `ollama list` |
| `Geen Ollama-modellen gevonden` | Installeer een model met `ollama pull qwen2.5:1.5b` |
| `EADDRINUSE` / poort bezet | Stop een eerdere server of gebruik `npm run local:ollama -- --port=8789` |
| Dashboard vraagt een token | Open de volledige terminal-link of plak het tijdelijke token |
| Docker-test niet beschikbaar | Start Docker en voer `docker pull node:22-alpine` uit |

Meer uitleg: [Ollama en de lokale codeworker](local-ollama-first-run.md), [lokaal demonstratiepakket](local-demo-softwarepakket.md), [Builder en ontbrekende workers](orchestrator-builder.md), [alle documentatie](index.md).
