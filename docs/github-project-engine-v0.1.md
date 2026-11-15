# Project Engine op GitHub, proefversie

Doel: iemand kan na het uitpakken van een ZIP zijn projectbestanden in een eigen GitHub-repository onderbrengen en vervolgens, zonder AI of aparte server, een controleerbare **read-only** analyse uitvoeren.

De engine gebruikt GitHub Actions. Hij draait **niet continu**: GitHub start jobs op basis van een gebeurtenis, zoals een handmatige workflowstart of een pull request. **Het gebruikersantwoord staat leesbaar in de GitHub Actions-run onder Summary.** Artefacten zijn niet de gebruikersinterface.

## Uitvoeringsroute

| Fase | Job | Controle | Menselijke handeling |
| --- | --- | --- | --- |
| Doel | invoer `goal` | site, app, code of docs | Gebruiker bepaalt wat hij wil bereiken |
| Onderzoeken | `inventory` | bestanden, projecttype, startbestand, gevoelige bestandsnamen, afhankelijkheden | Bestanden in eigen repo plaatsen, besluiten wat openbaar mag |
| Controleren | `syntax` | alleen JavaScript `node --check` en Python `ast.parse`, zonder uitvoeren | Geen handeling nodig |
| Beoordelen | `report` | bevindingen en niet bewezen aannames samenvoegen | Openstaande vragen en kwaliteitscontrole beoordelen |
| Wijzigen | niet aanwezig | geen toegang tot repositoryschrijfacties | Afzonderlijke toestemming vereist |
| Publiceren | niet aanwezig | geen deployment | Afzonderlijke toestemming en acceptatie vereist |

Inventarisatie en syntax kunnen **parallel** worden uitgevoerd. Het rapport is afhankelijk van beide.

## Werkwijze bij een gebruikersrepository

1. De gebruiker pakt zijn ZIP uit en controleert op wachtwoorden, sleutels en privébestanden.
2. Hij zet de projectbestanden in een eigen GitHub-repository. Niet uitsluitend het ZIP-bestand.
3. Hij beoordeelt de workflow die hij aan de eigen repository wil toevoegen.
4. GitHub Actions toont het volledige persoonlijke advies rechtstreeks bovenaan bij de workflow-run, met één concrete vervolgstap. De gebruiker hoeft geen ZIP te downloaden of uit te pakken. De artefacten bewaren alleen controleerbare gegevens voor technisch onderzoek.
5. Daarna moeten nog echte gebruikstests volgen. Een groene syntaxcheck bewijst niet dat het project werkt.

### Wrapper voor de gebruikersrepository

De aanroepende repository krijgt uiteindelijk een minimale workflow zoals:

```yaml
name: Controleer mijn project
on:
  workflow_dispatch:
  pull_request:
permissions:
  contents: read
jobs:
  projectcontrole:
    uses: E-AI-MODEL/EAIwork-/.github/workflows/project-engine.yml@<VASTGEPINDE_COMMIT_SHA>
    with:
      goal: site
```

**Belangrijk:** vervang `<VASTGEPINDE_COMMIT_SHA>` pas door de gecontroleerde commit SHA na merge en review. De ontwikkelworkflow haalt de engine momenteel op via een **verplaatsbare ontwikkeltak**. Dit moet naar een onveranderlijke releaseverwijzing worden omgezet vóór gebruik door derden.

### Wat is er bewust niet?

- Geen ZIP-uploadservice of authenticatie op de publieke website.
- Geen rechtstreekse koppeling met een persoonlijke GitHub-account of privérepository.
- Geen willekeurige `npm install`, `npm test`, `pip install` of door de gebruiker aangeleverde scripts.
- Geen herziening van code via AI, geen zelfstandig committen of publiceren.
- Geen geteste koppeling van deze GitHub Actions-jobs aan de beveiligde EAI Work Operations-server.

## Beveiliging en grenzen

De workflow heeft uitsluitend `contents: read`. Checkout bewaart geen credentials. Broncode wordt alleen als gegevens behandeld; symlinks en afhankelijkheidsmappen worden niet gevolgd. Scans hebben een bestands- en groottebeperking. De job geeft geen broninhoud door aan het eindrapport en toont geen teststderr met mogelijk vertrouwelijke tekst.

De ontwikkeltak is **geen release**. Voor een publiek platform dat automatisch met GitHub-repositories van onbekende gebruikers werkt, zijn aanvullende autorisatie, quota, invoerbeveiliging, kostenlimieten en een onafhankelijke securityreview nodig.

## Testacceptatie

`node --test tests/project-engine.test.mjs` test echte lokale fixtures, bestandspaden, ZIP-valkuil, geheimen, en het voorkomen van code-uitvoering. De GitHub Actions-workflow moet daarnaast alle drie de jobs uitvoeren en een geldig resultaat opleveren. Dit test niet het daadwerkelijke project van Pieter.
