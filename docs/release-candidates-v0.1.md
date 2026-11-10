# Releasekandidaten en menselijke beoordeling in EAIwork

**Status:** concept-PR #33 boven op de gecontroleerde dashboardverbinding
van PR #32. Dit is een werkende lokale registratie- en beoordelingsroute,
geen publicatie- of productievoorziening.

## Hoe de informatie loopt

De missie-eigenaar rondt de bestaande taken af. In het live-dashboard
kan die persoon een releasekandidaat indienen. Het formulier vraagt:

- repository in de vorm `eigenaar/project`;
- volledige Git-commit-SHA (40 hextekens);
- bestandsnaam zonder mapdelen en SHA-256 van het voorgestelde artefact;
- GitHub Actions-run van dezelfde repository.

Bij indienen controleert EAIwork de vorm, exacte missierevisie,
overeenkomende SHA's, taakstatussen en de oorspronkelijke voorwaarden.
De server legt het besluit vast in het duurzame operationslog, inclusief
de hashes van alle op dat moment afgeronde taakresultaten.

**Dit controleert niet dat de opgegeven CI-run werkelijk bij de commit hoort,
geslaagd is of dat het opgegeven artefact bestaat.** De SHA-256 is in
deze versie een door de gebruiker ingevulde waarde, geen berekende
hash van door de server opgehaalde bytes.

Een andere aangemelde persoon kan de kandidaat beoordelen, met een
toelichting. Twee besluiten zijn beschikbaar:

- `request-changes`: wijzigingen nodig;
- `accept-for-verification`: doorgaan naar een aparte technische controle.

Geen van beide besluiten geeft publicatie-, deploy- of releasebevoegdheid.
De server heeft hiervoor ook geen route. De productielijn blijft
`publication.allowed=false` tonen.

Een missierevisie maakt de oudere kandidaat `superseded`.
Een verouderde kandidaat kan niet alsnog worden beoordeeld. De
eventgeschiedenis blijft behouden.

## API

De onderstaande routes vragen bestaande operations-auditrechten.
In de lokale demo is er een apart tijdelijk reviewtoken.

```http
POST /ops/missions/<mission-id>/releases/candidates
Authorization: Bearer <missie-eigenaar-token>
Content-Type: application/json

{
  "id": "release-voorbeeld",
  "revision": 1,
  "repository": "E-AI-MODEL/EAIwork-",
  "commitSha": "<exacte 40-tekens SHA>",
  "artifactName": "resultaat.zip",
  "artifactSha256": "<exacte SHA-256>",
  "checkRunUrl": "https://github.com/E-AI-MODEL/EAIwork-/actions/runs/123",
  "checkCommitSha": "<dezelfde 40-tekens SHA>"
}
```

```http
POST /ops/missions/<mission-id>/releases/<candidate-id>/review
Authorization: Bearer <ander-reviewer-token>
Content-Type: application/json

{
  "decision": "accept-for-verification",
  "reason": "Voor verdere technische controle. Controle van CI-run en bestanden volgt."
}
```

Via `GET /ops/missions/:id/releases` is de historie zichtbaar.
`GET /ops/production-line` toont alleen de beperkte status,
niet de taakinput of inhoud van de artefacten.

## Afdwingbare grenzen

- De oorspronkelijke missie-eigenaar dient een kandidaat in.
- Een andere aangemelde persoon beoordeelt die kandidaat.
- Alleen volledig afgemaakte taken met opgeslagen outputhashes
  mogen in een kandidaat worden opgenomen.
- Een lopende automatische uitvoering of open bronvoorwaarde
  verhindert het indienen.
- De opgegeven GitHub-run moet naar dezelfde repository verwijzen.
- Een herhaald beoordelingsbesluit wordt geweigerd.
- De algemene `/ops/events`-route mag releasebesluiten niet vervalsen.
- Publicatie is niet geïmplementeerd en blijft uitgeschakeld.

## Wat nog gebouwd moet worden

Een betrouwbare releasecontrole moet de CI-run aan de exacte commit
koppelen via een vertrouwde GitHub-verbinding en de daadwerkelijk
verkregen artefactbytes hashen. Daarna zijn eventueel licentiecontroles,
een onafhankelijke releasebeoordeling, veilige opslag, ondertekende
attestatie en pas op het eind een afzonderlijk bevoegd publicatiepad
nodig. De lokale softwareproductielijn blijft tot die tijd
een demonstratie van begrensde opdrachtuitvoering en beoordeling.
