# EAIwork: echte GitHub-artifactproef van 10 november 2026

## Wat werkelijk is uitgevoerd

Op de aparte ontwikkelbranch `feature/artifact-real-run-smoke-v01-20261110`
is een kleine JavaScript-module vanuit `examples/artifact-proof/source.mjs`
gebouwd. De module normaliseert tekst en telt woorden. De buildcontrole
heeft de functies werkelijk aangeroepen en de gegenereerde bestanden
onder `dist/` getest.

De workflow `.github/workflows/artifact-real-proof.yml` is beperkt tot
deze ontwikkelbranch. De workflow gebruikt vastgepinde GitHub Actions,
`contents:read` en `actions:read`. Het testartifact wordt tijdelijk
bewaard, zonder deployment of softwarepublicatie.

De **eerste voltooide workflowrun** heeft het bestand opgeslagen:

- Build-run: [42838252981](https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42838252981)
- Exacte commit: `9231aed23787a088e453f83b0a084446f11f0b9c`
- Artifact: `eaiwork-real-proof`, GitHub artifact-ID `13774327802`
- Bestand: `eaiwork-proof.mjs` (in het dossier `dist/eaiwork-proof.mjs`)
- Bestandsgrootte: 444 bytes
- Bestands-SHA-256: `e420202433078de64e5770ad640f3b289f6e1ff5a38aa76ce70e1cfc017ad5a2`

De eerste run kon zijn eigen artifact niet als een afgeronde run beoordelen.
De volledige proef volgde in de **tweede workflowrun**:

- End-to-end-run: [42838490242](https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42838490242)
- Exacte testcommit: `3783eceabd31a2fcf49adf6fcfdcfbdea92ca951`
- Resultaat in de workflowlogs: `ECHTE PROEF GESLAAGD`

Die tweede run heeft via de officiële GitHub API de eerste, voltooide
workflowrun gelezen. Vervolgens heeft EAIwork een tijdelijke lokale server
gestart en het bestaande releaseprotocol uitgevoerd:

1. Een proefmissie vastgelegd en de teksttaak technisch afgerond.
2. Een opleverdossier vastgelegd met repository, volledige commit, bestands-SHA en runnummer.
3. De daadwerkelijke GitHub Actions-run opnieuw opgehaald en als geslaagd gecontroleerd.
4. Het unieke artifact van die run opgezocht en het ZIP-archief gedownload.
5. Eén vooraf bepaald bestand uit het ZIP-archief gecontroleerd met CRC en SHA-256.
6. Een afzonderlijke waarneming vastgelegd in het operationslog.
7. Het productieoverzicht en het operationslog gecontroleerd; vrijgave bleef uitgeschakeld.

De volledige gewone EAIwork-testreeks is op de tweede commit geslaagd:
[GitHub CI 42838499247](https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42838499247).

## Wat deze proef wel en niet aantoont

**Aangetoond op deze GitHub-run:** EAIwork kan een werkelijk geüpload
GitHub-artifact van een voltooide run terugvinden, downloaden,
veilig begrensd inspecteren en het gekozen bestand vergelijken met
de SHA-256 van het geregistreerde kandidaatbestand. De server heeft
deze waarneming zonder publicatierechten opgeslagen.

**Nog niet aangetoond:** reproductie van een willekeurige build op
een andere machine, toereikende testdekking, correcte licenties,
veiligheid van gedownloade software, werkende installaties of een
volledige autonome softwarebouwopdracht. De test gebruikte één
kleine module en twee gekoppelde GitHub-workflowruns.

De volledige GitHub-artefactcontrole accepteert nog geen rerun
met een pogingnummer hoger dan één. Downloads boven 16 MiB,
niet-toegestane opslaghosts, complexe ZIP-formaten en onduidelijke
artifactnamen blijven geblokkeerd.

Deze proef geeft geen toestemming voor merge, release of deployment.
`publication.allowed` blijft `false`.

## Herhalen

Maak na een succesvolle build-run een tweede push naar dezelfde
ontwikkelbranch. De workflow bouwt opnieuw een klein testbestand en
controleert in de daaropvolgende stap het artifact van een vorige,
afgeronde workflowrun. Ontbreekt een eerdere geslaagde run, dan
faalt de tweede fase in plaats van een positieve uitslag te verzinnen.

De test heeft `GITHUB_TOKEN` met `actions:read` nodig. Het token
wordt uitsluitend gebruikt bij GitHub API-verzoeken. Het wordt niet
doorgegeven aan de ondertekende opslagdownload, de uitvoerende
tekstworker of de publieke dashboardpagina.

Verwijder of vervang deze branchspecifieke workflow vóór een
eventuele productie-release. Voor een algemene releaseproef is een
apart acceptatieproces nodig, met echte pakketinhoud en expliciete
menselijke vrijgave.
