# Operations: groei, schrijfveiligheid en claims

**Stand:** ontwikkel-PR #28, basis voor de afzonderlijke parallelle
proef in PR #29. Niet gemergd, geen productie-eindmeting.

## Waarom dit is aangepast

De operationsstore paste bij iedere gebeurtenis de zuivere reducer
`applyOps` toe. Die kopieerde alle bestaande geschiedenis en
zocht een nieuwe gebeurtenis-ID lineair op. Bij een groeiend log
werd dit steeds duurder.

De publieke reducer is behouden voor losse controles. De interne
`OpsStore` gebruikt een aparte `stageOps`-overgang die alleen
het betrokken domein kopieert. Bij missiegebeurtenissen kopieert
de code de missie-index en uitsluitend de betreffende missie.
Een index van event-ID's wordt bij de geverifieerde herstart
opnieuw opgebouwd.

Het operationslog blijft de bron van de opgeslagen toestand.
Een gebeurtenis komt pas in het geheugen nadat de logregel naar
schijf is gesynchroniseerd en de logkop atomisch is vervangen.
Bij een mislukte validatie verandert de actieve toestand niet.
Bij een onzekere schrijffout weigert die procesinstantie nieuwe
writes totdat het log opnieuw is gecontroleerd.

## Gemeten uitkomst

`benchmarks/operations-growth.ts` vergelijkt binnen één Node-proces
de oorspronkelijke pure reducer met de nieuwe interne overgang
op exact dezelfde synthetische `mission.create`-events.
Daarnaast meet het een afzonderlijk, fsync-backed operationslog,
een nieuwe opening en een verificatie. Er geldt bewust geen
automatisch slaag-/faalcriterium voor snelheid.

GitHub Actions [run 42773219160](https://github.com/E-AI-MODEL/EAIwork-/actions/runs/42773219160),
commit `4046d6b18ba3da3bb61ec9bea625ec3e5432c516`,
Node v22.23.4 op Linux x64:

| Events | Oude reducer ms | Nieuwe staged reducer ms | Schrijfduur ms | Heropening ms |
|---:|---:|---:|---:|---:|
| 100 | 62.05 | 2.16 | 127.67 | 2.96 |
| 250 | 284.20 | 6.22 | 328.26 | 8.13 |
| 500 | 1091.02 | 30.10 | 679.16 | 20.10 |

Bij 500 gebeurtenissen nam de in-memory berekening op die runner
ongeveer 36 keer minder tijd in beslag. De gemeten schrijfduur
bevat ook fsync en bestandssysteemkosten. Er is maar één meetrun;
hardware-, cache- en schommelingsverschillen zijn niet gekalibreerd.
Dit zijn geen latentiepercentielen en er is geen productiebelasting
nagebootst.

Herhaal de diagnose:

```sh
node benchmarks/operations-growth.ts --counts=100,250,500
```

## Geteste veiligheidsregels

- Unieke event-ID's blijven ook na herstart geweigerd bij hergebruik.
- Een afgewezen transitie past niets aan.
- Een durable `task.started`-event claimt de taak vóór de adapter draait.
- Een tweede start wordt afgewezen, ook na opnieuw openen van de store.
- Een voltooiing met een afwijkend run-ID wordt afgewezen.
- Historie, missie- en workerregistratie blijven identiek aan de
  oorspronkelijke pure reducer op langere testreeksen.
- Bestaande beschadigings- en hersteltests blijven onderdeel van CI.

## Nog niet aangetoond

Dit is geen gedeelde queue, geen multi-instance lease of fencing
en geen algemene exactly-once-garantie. De operations-hashketen
heeft nog geen onafhankelijk witness. Externe acties hebben een
afzonderlijke, transactionele outbox en idempotency-protocol nodig
voordat herhalen of gedistribueerd claimen veilig is.

Voor productie zijn metingen met lange opdrachten, variërende
eventgroottes, gelijktijdige verzoeken en volledige herstelproeven
nodig. Geheugen wordt nog onder meer gebruikt door de eventhistorie,
de geladen logregels en de resultaatprojectie. De huidige meting
is daarvoor te beperkt.
