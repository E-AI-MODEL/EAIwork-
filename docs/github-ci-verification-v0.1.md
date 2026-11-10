# EAIwork: GitHub Actions controleren bij een opleverdossier

**Status:** concept-PR #39. Bouwt voort op het opleverdossier van PR #38.

De indiener of een andere bevoegde gebruiker kan vanuit het EAIwork-dashboard op **Controleer CI bij GitHub** klikken. De server vraagt dan via de officiële GitHub API de opgegeven Actions-run op. Dit gebeurt niet bij het laden van het dashboard of op de achtergrond.

De server controleert de naam van de repository, het runnummer, de volledige commit-SHA, de status `completed`, de conclusie `success` en het pogingnummer. De opgevraagde run moet overeenkomen met het eerder vastgelegde dossier. De URL wordt uitsluitend door de server uit de gevalideerde GitHub-repository en het runnummer samengesteld.

De netwerklezing gaat alleen naar `https://api.github.com`, met een deadline, een antwoordlimiet en zonder redirects. Voor publieke repositories is geen extra token nodig. Voor private repositories kan de serverbeheerder `EAI_GITHUB_READ_TOKEN` configureren. Dit token wordt niet naar het dashboard of naar workers gestuurd.

Bij een overeenkomstige geslaagde run bewaart de server een `mission.release.ci.observe`-gebeurtenis. De gebruiker kan dit event niet rechtstreeks via `POST /ops/events` plaatsen. Een inmiddels veranderd dossier of een nieuwe missierevisie maakt de controle ongeldig. De productielijn toont daarna **GitHub Actions bevestigd** met het waargenomen pogingnummer.

## Wat de controle niet aantoont

Een GitHub Actions-run die `success` rapporteert bewijst dat GitHub die run als geslaagd registreert. EAIwork controleert in deze stap nog niet afzonderlijk de inhoud en dekking van alle tests, de gegenereerde artifactbytes, de licentie of de overeenstemming met de oorspronkelijke functionele opdracht.

De SHA-256-hash van het kandidaatbestand is nog een door de indiener opgegeven waarde. Er is geen automatische download, verificatie of publicatie van het bestand.

**`publication.allowed` blijft `false`.** Ook een afgeronde GitHub-controle geeft geen toestemming om te mergen, te deployen of een release vrij te geven.

## API en tests

```http
POST /ops/missions/<mission-id>/release/verify-ci
Authorization: Bearer <audit-token>
Content-Type: application/json

{}
```

Tests gebruiken een vaste lokale HTTP-stub en geen live GitHub-run. Ze controleren afwijzing van afwijkende commits, onjuiste repositories, niet-voltooide of mislukte runs, foutieve runnummers, te grote antwoorden, worker-tokens en vervalste controle-events. Een echte GitHub-run moet afzonderlijk in de beoogde deploymentomgeving worden getest.
