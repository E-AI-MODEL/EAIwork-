# Twee lokale teksttaken gelijktijdig uitvoeren

**Stand:** aparte ontwikkel-PR #29 boven op de groei- en claimcontrole
van PR #28. Dit is een beperkte uitvoeringsproef, geen algemene
workerhost of online productievoorziening.

## Gebruiken

Start de bestaande lokale proef:

```sh
npm run demo:dashboard
```

Maak met het tijdelijke token een missie met twee onafhankelijke,
al toegelaten teksttaken. Vervolgens:

```http
POST /ops/missions/<mission-id>/parallel/run
Authorization: Bearer <server-token>
Content-Type: application/json

{"maxParallel":2}
```

De reactie bevat `claimed`, `completed`, `failed`, `blocked`
en de bijgewerkte voortgang. De uitvoeringsgeschiedenis is via de
bestaande missie-trace te bekijken. Een run met een correcte
technische uitkomst behoudt `verification:"not-evaluated"`.

## Wat daadwerkelijk wordt afgedwongen

- Alleen een aangemelde persoon met operationsbevoegdheid kan
  de route gebruiken. De route aanvaardt geen willekeurige
  commando's, modelprompts of eigen uitvoercode.
- Iedere taak moet als gereed zijn aangemerkt door de
  bestaande taak- en constraintcontrole. Een expliciet verbod
  wordt niet door de nieuwe route opgeheven.
- Alleen `text-normalize` en `text-metrics` kunnen zo draaien.
  Ze hebben geen externe bijwerkingen en zijn al gekoppeld aan
  gecontroleerde, vast ingebouwde adapters.
- De server controleert vóór iedere start de workerregistratie,
  versie, toestemming en vaste contractfixtures.
- Voor ieder kindproces wordt eerst een `task.started`-event
  naar het synchrone operationslog geschreven. Dat event bevat
  een uniek run-ID, invoerhash, worker-ID en versie.
- Daarna wordt voor iedere taak een afzonderlijk Node-proces
  gestart met alleen de betreffende tekst en de vaste taaksoort.
  De server geeft geen toegangstoken of overige omgevingsvariabelen
  aan dit proces door.
- De lokale limiet is twee gelijktijdige childprocessen per
  serverproces, met een uitvoerdeadline, begrensde invoer/uitvoer
  en een begrensde Node-heap.
- Voor het resultaat opnieuw wordt geregistreerd, controleert
  de server de oorspronkelijke claim, de workerstatus,
  de versie en of de missie nog mag doorgaan.
- Een tweede start van dezelfde taak, een verouderd resultaat
  of hergebruik van een oud run-ID wordt geweigerd.

## Veiligheidsgrenzen

Deze childprocessen starten alleen vertrouwde, vaste code.
Een aparte Node-heap en een timeout zijn **geen** volledige
beveiligingssandbox voor willekeurige of door modellen
gegenereerde workers. Het proces heeft nog dezelfde OS-rechten
als de hoofdserver. Er zijn geen containers, cgroups,
netwerkisolatie of externe schedulerleases ingericht.

De huidige server heeft één exclusieve schrijver. De capaciteit
geldt per Node-serverproces, niet voor een cluster. De gewone
scheduler blijft sequentieel en de nieuwe route wordt alleen
door een persoon aangeroepen. De route ondersteunt geen
RepoSearch, samengestelde workers, externe schrijftaken,
publicatie, modelcalls of automatische workerbouw.

Een onderbroken lokale taak blijft zichtbaar in het
operationslog. Herhaling kan uitsluitend via de bestaande
veilige herstel- of menselijke retryroute en verbruikt bij
automatische voortzetting opnieuw budget. Een externe actie
mag niet op basis van deze proef opnieuw worden uitgevoerd.

## Testen

```sh
node --test tests/parallel-local.test.ts tests/mission-retry.test.ts
npm test
```

De integratietests starten de bestaande lokale demonstratieserver,
laten twee echte childprocessen tekst bewerken, controleren de
resulterende hashes, run-IDs en bewijsstatus en blokkeren
dubbele verzoeken en verboden taken. De CI-uitkomst van de
exacte commit moet worden gecontroleerd.

De volgende uitbreiding is niet automatisch méér paralleliteit.
Eerst zijn expliciete taakleases, backpressure, isolatie en
herstel onder meerdere uitvoerders nodig. Pas daarna kan de
scheduler capaciteit op basis van workercontracten en gemeten
kosten over meerdere processes verdelen.
