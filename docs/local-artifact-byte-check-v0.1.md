# EAIwork: lokaal kandidaatbestand vergelijken

**Status:** concept-PR #40, boven op opleverdossier en GitHub CI-controle. Geen publicatierechten.

## Wat de gebruiker doet

Bij een bestaand opleverdossier staat in het beveiligde dashboard **Vergelijk bestandshash**. Kies het kandidaatbestand op de laptop. De browser stuurt de bytes naar de eigen EAIwork-server. De server berekent zelf de SHA-256 en vergelijkt die met de vooraf geregistreerde hash.

Bij een overeenkomst legt EAIwork een `mission.release.artifact.observe`-event in het operationslog vast. Het bevat de gemeten hash, omvang, tijd, dossierpad en de identiteit van de gebruiker. De bestandsinhoud wordt niet opgeslagen, uitgepakt of uitgevoerd.

De upload heeft een limiet van 16 MiB, of een strengere lokale limiet. De server controleert bestandsnaam, contenttype en missierevisie. Na de upload controleert hij opnieuw of het dossier nog hetzelfde is. Dubbele verificaties worden geweigerd.

## Wat werkelijk wordt bewezen

**Wel:** de aangeleverde bytes leveren dezelfde SHA-256 op als de eerder opgegeven waarde in het opleverdossier.

**Niet:** dat de bytes uit de genoemde GitHub Actions-run komen. Het bestand is door een persoon aangeleverd. Ook de herkomst van de oorspronkelijk opgegeven hash is niet zelfstandig vastgesteld. GitHub CI-controle en lokale bestandshash zijn dus twee afzonderlijke waarnemingen, nog geen volledig releasebewijs.

Licentie, testdekking, veiligheid en inhoudelijke bruikbaarheid zijn niet gecontroleerd. `publication.allowed` blijft `false`.

## API

- POST `/ops/missions/<mission-id>/release/verify-bytes` met de ruwe bytes als `application/octet-stream`.
- Header `X-EAI-Artifact-Name` is de bestandsnaam uit het dossier, zonder mappen.
- Header `X-EAI-Mission-Revision` bevat de actuele dossier- en missierevisie.
- Alleen een persoonlijk operations-audittoken is toegestaan. Worker-tokens kunnen geen bestandswaarnemingen registreren.
- Het verificatie-event kan niet via de algemene eventsroute worden vervalst.

## Testen

Gebruik `node --test tests/local-artifact-bytes.test.ts` en `npm test`. De tests controleren streaminghash, limieten, verkeerde bytes, bestandsnaam, revisie, toestemming, dubbele verificatie en de blijvende blokkade op publicatie.

## Volgende stap

Een afzonderlijke GitHub-artefactlezer moet de bytes rechtstreeks bij de gecontroleerde workflowrun ophalen. Daarvoor zijn expliciete downloadrechten en veilige begrensde ZIP-verwerking nodig. De lokale upload vervangt die stap niet.
