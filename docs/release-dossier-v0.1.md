# EAIwork: opleverdossier bij een afgeronde missie

**Stand:** concept-PR #38 boven op de bestaande productielijn. Geen publicatie en geen automatische softwarevrijgave.

Een gebruiker kan bij een technisch afgeronde opdracht een voorstel voor oplevering vastleggen. Het dossier bevat één exacte Git-commit, de SHA-256-hash en het pad van een kandidaatbestand, een verwijzing naar een GitHub Actions-run, de opgegeven testnamen en een licentieverwijzing.

De server controleert de vorm van de verwijzingen, of de CI-head-SHA overeenkomt met de opgegeven commit en of de missie bij de huidige revisie hoort. **De server haalt in deze versie geen CI-gegevens op en opent het kandidaatbestand niet.** De opgegeven hashes, testnamen en licentie zijn daarom nog niet onafhankelijk geverifieerd.

## Werkwijze in het dashboard

Na verbinding met de bestaande EAIwork-server verschijnt bij een voltooide missie **Opleverdossier indienen**. De indiener vult de exacte codeversie, het bestand, de hash, de CI-run, de tests en de licentieverwijzing in. De server legt het dossier vast als operations-event.

De reviewer gebruikt een ander persoonlijk token en kan de beoordeling vastleggen als **Externe verificatie nodig**. De oorspronkelijke indiener kan zichzelf niet beoordelen. Beide acties blijven in dezelfde gebeurtenisgeschiedenis als de opdracht.

De zichtbare productielijn laat daarna het dossier, de huidige revisie, de kandidaatversie en de beoordeling zien. Ze presenteert dit niet als een goedgekeurde release.

## API

- `POST /ops/missions/:id/release/submit` met `{expectedRevision,candidate}`.
- `POST /ops/missions/:id/release/review` met `{expectedRevision,decision,reason}`, waarbij `decision` `changes-requested` of `external-verification-needed` is.
- `GET /ops/production-line` met de geregistreerde status, zonder de taakinput.

Een dossier kan niet worden ingediend zolang taken nog lopen, mislukt zijn of nog in de wachtrij staan. Ook onopgeloste voorwaarden uit de oorspronkelijke opdracht blokkeren de indiening. Voor de huidige revisie is maar één kandidaatdossier toegestaan. Een latere uitbreiding van de opdracht maakt een eerder dossier verouderd.

De algemene eventsroute accepteert de twee nieuwe mutaties niet. Alleen de afzonderlijke API-routes kunnen ze vastleggen. De onafhankelijke reviewer moet een andere aangemelde persoon zijn dan de oorspronkelijke missie-eigenaar.

## Wat dit niet doet

- Er wordt geen GitHub Actions-run gecontroleerd op een werkelijk geslaagde uitvoering.
- Er wordt geen artifact opgehaald, gehasht, gebouwd of gepubliceerd.
- Er wordt geen repository gemergd of deployment uitgevoerd.
- De gebruiker kan met ingevulde metadata geen bewijsstatus verhogen.
- `publication.allowed` blijft altijd `false`, ook na een beoordeling.

De volgende stap is onafhankelijke broncontrole van de CI-run en de kandidaatbytes, gevolgd door een afzonderlijke releasebeslissing. Daarvoor zijn een gecontroleerde GitHub-verbinding en veilige artifactopslag nodig.

## Regressies

```sh
node --test tests/release-dossier.test.ts
npm test
```

De nieuwe tests dekken mislukte en onafgeronde taken, verkeerde revisies, onveranderde opdrachtvoorwaarden, onjuiste commit- of bestandshashes, gescheiden beoordelaars en de blijvende weigering van automatische publicatie. De testresultaten horen bij de exacte commit van de ontwikkelbranch.
