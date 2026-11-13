# Beveiligingscontrole EAIwork

Datum: 13 november 2026. Onderzocht: integratie van een echte Ollama-codeworker, de eerste productproef, serverrechten, Docker-uitvoering en GitHub Actions. Werkversie: [PR #61](https://github.com/E-AI-MODEL/EAIwork-/pull/61). Dit is een gerichte technische controle en zelfreview, geen onafhankelijke pentest.

## Aangetroffen en aangepast

| Risico | Waarneming in oorspronkelijke code | Reparatie | Toets |
| --- | --- | --- | --- |
| Hoog: uitvoeren van onbetrouwbare code op GitHub-runner | `tests/first-product-smoke.test.ts` gebruikte `spawnSync(process.execPath, ["--test", ...])` vóór en na de codewijziging, ook voor de artifactkopie. De voorgestelde code werd rechtstreeks door host-Node ingeladen. | Acceptatie en negatieve controle draaien nu in de bestaande netwerkloze, alleen-lezen Docker-testsuite, met expliciete bestanden. | `tests/security-release-boundaries.test.ts`, `tests/project-suite.test.ts`, echte Docker-proef |
| Hoog: externe Docker-daemon kon broncode krijgen | `docker-code-test.ts` en `docker-project-suite.ts` namen `DOCKER_HOST` en `DOCKER_CONFIG` over. Een remote daemon had de geteste code als mount ontvangen. | Alleen een geverifieerde lokale Unix-socket; geen Docker-context of remote transport doorgeven. | `tests/docker-local-transport.test.ts`, Docker-workflow |
| Hoog: te brede rechten voor lokale code | De bestaande `/ops/code/*`-routes vereisten een audittoken, maar geen afzonderlijke codebevoegdheid. Ook een persoon met alleen auditleesrechten kon ermee werken. | Nieuwe, expliciete `code: true`-bevoegdheid, alleen voor auditpersonen. Audittokens zonder die bevoegdheid krijgen 403. | `tests/security-code-permissions.test.ts`, normale CI |
| Testkwaliteit: nagebootst model maskeerde fouten | De productproef leverde vaste vervangende code aan in plaats van een echt modelantwoord. | Verplichte lokale Ollama-connectie en beschikbaar model. De proef bewaart modelnaam, versie, digest en codehashes, en faalt bij fout of timeout. | `.github/workflows/first-product-proof.yml`; uitsluitend een groene echte workflow geldt als slaging |
| Supply-chain: automatisch installeren uit een script | De oude Ollama-smoke gebruikte een pipe naar de installer. | De nieuwe productproef gebruikt een vastgezette Ollama-release en controleert de SHA-256 van het pakket vóór uitpakken. | Workflow en `tests/security-release-boundaries.test.ts` |

## Bekende grenzen

- De eerste productproef keurt voorbeeldwijzigingen automatisch goed via een tijdelijke testidentiteit. Dit is **geen** echte menselijke beoordeling van AI-code. In gewone werkruimtes blijft voorafgaande menselijke goedkeuring gelden.
- Een SHA-256 en correcte Docker-test tonen de geteste bytes en omstandigheden, niet algemene functionele juistheid of veiligheid.
- De lokale Docker-socket is geen bescherming tegen een gecompromitteerde host of een lokale proxy die verbindingen doorstuurt.
- Het operationslog heeft een eigen hashketen, maar niet dezelfde externe Ed25519-witness als het bewijslog. Herstel en manipulatie met hostrechten vragen een afzonderlijke toets.
- De CodeQL-workflow is toegevoegd met de uitgebreide JavaScript/TypeScript-beveiligingsregels. Een geslaagde workflow bewijst alleen dat de analyse draaide. De volledige alertlijst moet nog afzonderlijk in GitHub Security worden beoordeeld.
- Een echte Mac-proef en een onafhankelijke securityreview door een andere beoordelaar zijn hier nog niet uitgevoerd.

## Vrijgavevoorwaarde

Niet mergen als de **actuele PR-head** geen groene CI, Docker-tests, CodeQL en productproef met een echt Ollama-model heeft. De eerste geslaagde proef moet aantonen dat beide modelvoorstellen via de server zijn gemaakt, vóór en na toepassen in Docker getest en afzonderlijk als geheel in Docker beoordeeld. Bij een mislukte of niet uitgevoerde check blijft de PR open.
