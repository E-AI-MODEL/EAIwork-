# EAIwork lokaal softwarepakket

De workflow `local-demo-package` maakt na geslaagde tests een ZIP-bestand als GitHub Actions-artifact. Dit is een **lokale demonstratie**, geen productieversie en geen publicatiebesluit.

## Gebruik

Download de [gepubliceerde EAIwork v0.2.0-preview.1](https://github.com/E-AI-MODEL/EAIwork-/releases/tag/v0.2.0-preview.1), pak `eaiwork-local-demo.zip` uit en controleer desgewenst de meegeleverde `SHA256SUMS`. De preview is gebouwd vanaf exact commit `2e1a7c9f8a6227b6c34eb060e2af44adae3b86ff`. Installeer Node.js 22.18 of hoger. Open een terminal in de uitgepakte map en voer uit:

```sh
npm run demo:dashboard
```

Open het getoonde lokale dashboardadres en gebruik het tijdelijke token dat in de terminal verschijnt. Stop met Ctrl+C. De voorbeeldgegevens worden na normaal afsluiten verwijderd. Er is geen automatische installatie, achtergrondservice, gedeeld gebruikersbeheer of blijvende opslag ingericht. De meegeleverde broncode valt onder PolyForm Noncommercial 1.0.0. De documentatie valt onder CC BY 4.0.

## Wat controleert de workflow?

- De bestaande volledige testset op exact de uitgecheckte GitHub-commit.
- Voor ieder pakketbestand de SHA-256, bestandsgrootte en aanwezigheid in `DISTRIBUTION-MANIFEST.json`.
- Dat de ZIP geen dubbele bestanden, onveilige paden of symlinks bevat.
- Dat het dashboard uit het uitgepakte pakket via localhost een HTTP 200 geeft.

De bestanden worden niet gecompileerd tot een zelfstandig Windows- of macOS-programma. Een GitHub Actions-artifact kan na de retentietermijn verdwijnen. Het ZIP-bestand bevat de broncode, niet een onafhankelijke audit, licentieverklaring over alle mogelijke afhankelijkheden of een vrijgave voor productie.

Deze preview is gepubliceerd als GitHub-prerelease. De openbare dashboarddemonstratie staat afzonderlijk in de website-repository op `/tools/eaiwork/`; er wordt geen uitvoeringsserver op eaimodel.nl gehost. Een latere release vraagt een apart menselijk besluit op basis van de exacte commit, controles, licenties en pakketinhoud.
