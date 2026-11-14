# Wijzigingen

## Nog niet uitgebracht

- **Uitvoering wordt bewijs via een regel.** Met een codewerkmap krijgt de bewijsweergave één extra vraag: heeft elke toegepaste codewijziging een geslaagde afgeschermde test voor precies de toegepaste bytes? Een vaste regel over het operationslog beantwoordt die. Klopt de regel, dan is de vraag `proven` met het operationslog als geregistreerde bron. Wordt er een ongeteste wijziging toegepast, dan vervalt het bewijs vanzelf; het komt terug zodra de regel weer klopt. Geen persoon en geen model zet die status.
- **Een controle heeft één actuele uitslag.** Naast `check.passed` bestaat nu `check.failed`. De laatste uitvoering van een controle vervangt de vorige, dus een mislukte controle trekt een bewijs in en een latere geslaagde zet het terug (vectors 029 en 030).
- **Geen nep-geslaagde tests meer.** Voorgestelde code die `assert` uitschakelt, het proces beëindigt of de testomgeving laadt, slaagde voorheen met een fout resultaat. Zulke code wordt nu geweigerd vóór er iets draait.
- Acht eenmalige preview-releaseworkflows met schrijfrechten zijn verwijderd; ze hoorden bij al samengevoegde branches.
- README: één overzicht om lokaal te starten. `docs/index.md` dekt alle documenten.


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
