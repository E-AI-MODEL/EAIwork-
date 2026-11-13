# Wijzigingen

## 0.2.0-rc.1 (13 november 2026, kandidaatversie)

- De bewijsstatus wordt opnieuw berekend uit herleidbare bronnen, waarnemers, expliciete controle-invoer en geldigheid. Oude logregels zonder geregistreerde bron tellen niet als onafhankelijke bevestiging.
- Het dashboard toont de onderbouwing van een status, verlopen controles en voorstellen die een persoon moet bekijken.
- De lokale ontwikkelstapel voegt afgebakende opdrachten, codevoorstellen, menselijke goedkeuring, Docker-controles en een aparte productproef toe.
- Een lege of overgeslagen Node-test mag niet als geslaagd Docker-bewijs worden geregistreerd.
- De codeplan-API toont een controleerbare, beperkte testverklaring voor de exacte geplande bron- en testbestanden. Een ongeteste wijziging maakt die verklaring ongeldig.
- De gewone CI voert ook echte Docker-proeven uit. De eerste productproef gebruikt een nagebootst Ollama-antwoord; zij meet niet of een echt model zelfstandig goede code schrijft.

Dit is een releasekandidaat, geen publicatie of bewijs dat alle ontwikkelfasen voltooid zijn. De niet-lineaire aftakkingen van de concept-PR's zijn niet automatisch samengevoegd.

## 0.1.0 (6 oktober 2026)

Eerste uitgave van de bewijsgerichte werkbank met gevalideerde events, afgeleide status, beperkte toegangsrechten en ondertekende logankers. Zie [releaseverslag](docs/releases/v0.1.0.md).
