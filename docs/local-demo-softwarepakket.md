# EAIwork lokaal softwarepakket

De workflow `local-demo-package` maakt na geslaagde tests een ZIP-bestand als GitHub Actions-artifact. Dit is een **lokale demonstratie**, geen productieversie en geen publicatiebesluit.

## Gebruik

Download `eaiwork-local-demo-candidate` bij de geslaagde workflowrun en pak de ZIP uit. Installeer Node.js 22.18 of hoger. Open een terminal in de uitgepakte map en voer uit:

```sh
npm run demo:dashboard
```

Open het getoonde lokale dashboardadres en gebruik het tijdelijke token dat in de terminal verschijnt. Stop met Ctrl+C. De voorbeeldgegevens worden na normaal afsluiten verwijderd. Er is geen automatische installatie, achtergrondservice, gedeeld gebruikersbeheer of blijvende opslag ingericht.

## Wat controleert de workflow?

- De bestaande volledige testset op exact de uitgecheckte GitHub-commit.
- Voor ieder pakketbestand de SHA-256, bestandsgrootte en aanwezigheid in `DISTRIBUTION-MANIFEST.json`.
- Dat de ZIP geen dubbele bestanden, onveilige paden of symlinks bevat.
- Dat het dashboard uit het uitgepakte pakket via localhost een HTTP 200 geeft.

De bestanden worden niet gecompileerd tot een zelfstandig Windows- of macOS-programma. Een GitHub Actions-artifact kan na de retentietermijn verdwijnen. Het ZIP-bestand bevat de broncode, niet een onafhankelijke audit, licentieverklaring over alle mogelijke afhankelijkheden of een vrijgave voor productie.

Er worden geen branches gemergd en er wordt niets naar eaimodel.nl verzonden. Een latere release vraagt een apart menselijk besluit op basis van de exacte commit, controles, licenties en pakketinhoud.
