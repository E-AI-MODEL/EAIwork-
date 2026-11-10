# EAIwork: afzonderlijke tekstworker via localhost

**Status:** concept-PR #31, boven op PR #30. Deze proef werkt met één
server en afzonderlijke processen op dezelfde computer. Het is nog geen
gedeelde uitvoeringsdienst voor verschillende machines.

## Wat er gebeurt

Een missie-eigenaar keurt vooraf de uitvoering van maximaal een bepaald
aantal lokale teksttaken goed. De server bewaart dat besluit in het
operationslog en zet de gewone scheduler voor deze missie buiten spel.

Een afzonderlijke tekstworker meldt zich aan met een eigen tijdelijk
toegangstoken. De server kiest één gereedstaande taak, controleert
afhankelijkheden, verboden, toestemming en het workercontract en schrijft
eerst een lease naar het log. Pas daarna krijgt de worker de invoertekst.

De worker kan uitsluitend `text-normalize` of `text-metrics` uitvoeren.
Hij mag geen taak kiezen, code downloaden, modellen aanroepen of bestanden
doorzoeken. Hij ontvangt geen volledige opdracht, andere taken of bewijsstaat.

Bij het terugmelden controleert de server opnieuw de workeridentiteit,
de actuele lease en de toegestane worker. De uitkomst wordt met de
server-eigen vaste tekstbewerking opnieuw berekend. Een afwijkend
antwoord wordt niet als voltooid geregistreerd. De server legt een
afwijkend antwoord als mislukte poging vast, zonder de onbevestigde
inhoud in de taakuitvoer op te slaan. Een nieuwe poging vraagt
menselijke beoordeling.

## Zelf bekijken

Start op je eigen computer:

```sh
npm run demo:dashboard
```

De lokale demo toont een tijdelijk beheertoken en een apart token voor
de tekstworker. Gebruik het beheertoken alleen om uitvoering goed te
keuren:

```sh
curl -X POST http://127.0.0.1:8788/ops/missions/mission-demo-automatic/automation/start \
  -H "Authorization: Bearer <beheertoken>" \
  -H "Content-Type: application/json" \
  -d '{"maxStarts":2,"executionMode":"remote-text"}'
```

Voer daarna in een tweede terminal uit:

```sh
EAI_EXECUTOR_URL=http://127.0.0.1:8788 \
EAI_EXECUTOR_TOKEN="<tijdelijk-tekstworker-token>" \
node scripts/local-text-executor.ts --max-tasks=2
```

De worker pakt maximaal twee goedgekeurde taken achter elkaar op.
De tweede taak komt pas beschikbaar na voltooiing van de eerste.
Zonder `--max-tasks` voert het proces hoogstens één taak uit.
Je kunt ook twee aparte workerprocessen laten vragen om een taak.
De server staat maximaal twee actieve geleasede teksttaken toe.

Controleer de voortgang met je beheertoken via
`GET /ops/queue` en de bestaande `GET /ops/missions/:id/trace`.

## Toegestane HTTP-acties

| Route | Gedrag |
|---|---|
| `POST /executor/v1/claim` | Neemt alleen `{}` aan. Retourneert één taak of HTTP 204. |
| `POST /executor/v1/heartbeat` | Verlengt een nog geldige lease, met run- en lease-ID. |
| `POST /executor/v1/complete` | Laat één gecontroleerd resultaat registreren. |

Alle drie de routes vereisen een apart executor-token. Dat token geeft
geen toegang tot `/ops/state`, `/ops/queue` of het bewijslog.
Beheertokens kunnen geen taken claimen. De server neemt de workeridentiteit
uitsluitend uit zijn eigen tokenconfiguratie, nooit uit de requestbody.
Onjuiste leasegegevens en mislukte onafhankelijke resultaatscontrole
leiden tot afwijzing.

Het ophalen van werk gebeurt alleen voor missies met een expliciet
`executionMode:"remote-text"` en een nog niet verbruikt startbudget.
De toestemming, taakclaim, lease en voltooide resultaten zijn
replaybare operations-events. Een automatische herstart van een
geleasede taak is niet toegestaan.

## Grenzen van deze versie

De HTTP-route accepteert alleen verzoeken vanaf `127.0.0.1` of
`::1`. Het demo-token wordt tijdelijk aangemaakt en is niet bedoeld
voor gebruik op een openbaar netwerk. De worker voert vertrouwde code
uit en krijgt geen geïsoleerde OS-gebruiker of container.

Er is nog één exclusieve operationsschrijver. De nieuwe workerprocessen
delen geen opslag en leggen geen eigen autoriteit over taakstatus vast.
Twee machines, een reverse proxy, HTTPS, wederzijdse TLS-identiteit,
certificaatvernieuwing en gedistribueerde databaseclaims zijn niet
geconfigureerd of getest.

Een bestaande taskresultaatcontrole bewijst uitsluitend dat deze vaste
berekening technisch overeenkomstig het contract is uitgevoerd. De
bewijsstatus blijft `not-evaluated`; inhoudelijk leren of een externe
bron wordt hierdoor niet automatisch bewezen.

## Tests

```sh
node --test tests/loopback-executor.test.ts
npm test
```

De integratietests gebruiken afzonderlijke Node-processen en een
werkelijke lokale HTTP-server. Ze controleren taaktoestemming,
verschillende credentials, gelijktijdige claims, het hergebruik van
leases, de gevolgen van een ongeldig resultaat en de blijvende
scheiding met de gewone API. De CI-uitkomst hoort bij de exacte commit.
