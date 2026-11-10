# Uitvoerbare EAIwork-proef: missies en lokale workers

Stand: experimenteel, in PR #23. Bestaande atom-/bewijslogica blijft ongewijzigd.

## Wat er werkelijk gebeurt

Een persoon registreert een plan met één tot 32 kleine taken. Iedere taak heeft een taaksoort, invoer of een verwijzing naar de tekstuitvoer van een voorafgaande taak, en expliciete afhankelijkheden. Het plan wordt gecontroleerd op ontbrekende taken, dubbele namen, ongeldige invoer en kringverwijzingen.

De eerste uitvoeringslaag bevat twee **echte, lokale en deterministische** hulpmiddelen:

- \`text-normalize\`: Unicode NFC, CRLF naar LF, opeenvolgende spaties normaliseren en de buitenste witruimte weghalen.
- \`text-metrics\`: tellen van tekens, woorden en regels in de aangeleverde tekst.

Dit zijn geen AI-taalmodellen, geen websearchworkers en geen willekeurige uitvoerbare plugins. Een contract met dezelfde naam kan niet zomaar het gereedschap aanpassen. Voor iedere uitvoering worden de vaste tests opnieuw gecontroleerd.

## Van kandidaat tot uitvoering

1. Registreer een contract voor \`text-normalize\` of \`text-metrics\` met versie, \`taskKinds\`, modelbeleid \`deterministic\`, \`testSuite=builtin-fixture-v1\`, lege tools en lege gevraagde rechten.
2. Voer via \`POST /ops/workers/:id/evaluate\` de afgesloten fixtures uit. De server registreert zelf de uitslagen met een check-actor. De server accepteert geen door de aanvrager aangeleverde testuitkomsten voor deze route.
3. Een mens geeft de kandidaat vrij met een verwijzing naar het geregistreerde testresultaat. De registry bewaart dit als een afzonderlijk besluit. Er worden geen extra serverrechten verleend.
4. Een mens maakt via \`POST /ops/missions\` een goedgekeurd taakplan. Dit gebruikt geen automatische LLM-planner.
5. De server controleert afhankelijkheden en selecteert een daadwerkelijk toegelaten worker, uitsluitend wanneer bijbehorende runtime-adapter, modeltype, rechten en tools beschikbaar zijn.
6. \`POST /ops/missions/:id/step\` verwerkt maximaal vier reeds uitvoerbare taken in de huidige ronde. \`POST /ops/missions/:id/run\` doorloopt binnen één verzoek maximaal 32 zulke rondes en stopt zodra het werk is afgerond of niet verder kan.
7. Voor iedere verwerking worden inputhash, worker, workerversie, adapter, resultaat, outputhash en duur geregistreerd. Er wordt geen semantische waarheidsstatus toegekend. Een geldige technische transformatie is niet automatisch een goede inhoudelijke uitkomst.
8. Een mens kan via \`POST /ops/missions/:id/pause\` en \`resume\` de verdere uitvoering tegenhouden of vrijgeven.

## API-overzicht

| Methode | Route | Toegang | Betekenis |
|---|---|---|---|
| GET | \`/dashboard\` | Openbare statische HTML | Interface zonder private data |
| GET | \`/ops/state\` | Auth + audit | Workerregister, metingen, missies |
| GET | \`/ops/catalog\` | Auth + audit | Catalogus tegenover werkelijke registraties |
| GET | \`/ops/missions\` | Auth + audit | Missies en voortgang |
| POST | \`/ops/events\` | Auth + audit, actorvoorwaarden | Werkerevents; GEEN missie- of uitvoeringsgebeurtenissen |
| POST | \`/ops/workers/:id/evaluate\` | Persoon + audit | Vaste lokale testset |
| POST | \`/ops/missions\` | Persoon + audit | Goedgekeurd plan |
| POST | \`/ops/missions/:id/step\` | Persoon + audit | Een begrensde uitvoeringsronde |
| POST | \`/ops/missions/:id/run\` | Persoon + audit | Max. 32 rondes in hetzelfde verzoek |
| POST | \`/ops/missions/:id/pause\` | Persoon + audit | Verdere uitvoering pauzeren |
| POST | \`/ops/missions/:id/resume\` | Persoon + audit | Verdergaan na pauze |

Alle mutaties vereisen de al bestaande serverauthenticatie én controle van de onderliggende bewijsjournal. Er is geen CORS-toegang voor externe websites toegevoegd. De statische kopie op eaimodel.nl is uitsluitend een demonstratie en verwerkt geen servertoegangstokens. De live interface werkt alleen vanaf het eigen EAIwork-serverpad \`/dashboard\`.

## Voorbeeldplan

\`\`\`json
{
  "id": "mission-test",
  "title": "Tekstcontrole",
  "goal": "Controleer de lokale tekstverwerking",
  "tasks": [
    {
      "id": "task-clean",
      "title": "Tekst opschonen",
      "taskKind": "text-normalize",
      "dependsOn": [],
      "input": { "text": "  Hallo  wereld\\nNu  " }
    },
    {
      "id": "task-count",
      "title": "Tekst tellen",
      "taskKind": "text-metrics",
      "dependsOn": ["task-clean"],
      "textFrom": "task-clean"
    }
  ]
}
\`\`\`

De browser biedt een formulier voor precies dit tweetrapsplan. In de API mag een persoon een uitgebreider geldig plan aanleveren; alleen twee ingebouwde taaksoorten hebben op dit moment een uitvoeradapter.

## Metingen, beperkingen en herstel

De uitvoer wordt bewaard in het afzonderlijke operationslog. De opslagtabel gebruikt een lokale hashketen en een headbestand; deze zijn **niet** extern ondertekend, niet transactioneel tegen plotselinge uitval en geen productieproof van integriteit. De bestaande afzonderlijk ondertekende atom-journal blijft intact.

Een onderbreking ná \`task.started\`, maar vóór \`task.completed\` of \`task.failed\`, laat een taak bewust op \`running\` staan. Automatisch opnieuw uitvoeren zou anders onbedoeld werk kunnen herhalen. Er is nog geen veilige herstelroute voor zulke onderbroken taken. De eerste twee lokale hulpmiddelen hebben geen externe bijwerkingen, maar dat is geen algemene garantie voor latere adapters.

De 'run'-route is **begrensd en synchroon**. Hij is geen achtergrondworker en hij biedt nog geen echte parallelle modeluitvoering. Dit bewijst geen urenlange zelfstandige loop. Worker Builder, RepoSearch, autonome planner, externe tooladapters, claimsupportcontrole, opslag-anker voor operations, timeouts en onafhankelijke inhoudelijke validatie moeten nog volgen.

Tests: \`tests/missions-execution.test.ts\` en bestaande \`tests/operations*.test.ts\`. De test doorloopt de hele route met twee toegelaten lokale workers, controleert afhankelijke resultaten, herhaalde uitvoering, rechten, pauze/hervatten en herstart.
