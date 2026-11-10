# EAIwork: taakclaims, leases en de lokale wachtrij

**Status:** ontwikkeling in concept-PR #30, op basis van de geteste
parallelle uitvoeringsroute van PR #29. Dit is nog geen gedeelde
wachtrij voor meerdere servers en geen productiepublicatie.

## Wat een gebruiker nu kan zien

De bestaande missieplannen vormen de bewaarde wachtrij. Een taak
blijft daarin staan als `queued`, `running`, `done` of `failed`.
De nieuwe, alleen-lezen route:

```http
GET /ops/queue
Authorization: Bearer <operations-token>
```

toont een afgeleide weergave met status per taak, afhankelijkheden,
fase, geldige of verlopen lease, run-ID en blokkades. De route geeft
geen invoerteksten, uitvoer of modelantwoorden terug. De gebruiker
heeft dezelfde operations-auditbevoegdheid nodig als voor andere
operationele overzichten.

De uitvoeringsroute blijft:
`POST /ops/missions/:id/parallel/run` met
`{"maxParallel":2}`. Dat is een door een persoon gestart verzoek,
geen nieuwe automatische workerplanner.

## Wat de server registreert

`task.lease.claim` is een duurzame taakstart met een unieke
`runId`, `leaseId`, uitvoerder en vervaltijd. De claim mag alleen
voor de twee vaste, bijwerkingsvrije tekstbewerkingen worden gebruikt.
Voor de taakstart gelden dezelfde eerder goedgekeurde afhankelijkheden
en beperkingen.

De server laat een geleased resultaat pas in het operationslog
toe wanneer zowel `runId` als `leaseId` nog overeenkomen en
de lease geldig is. Ook het tijdstip waarop het resultaat werkelijk
wordt opgeslagen telt mee. Een oude, achteraf aangepaste
`finishedAt` maakt een verlopen lease niet geldig.

De aparte `task.lease.renew`-overgang kan een nog geldige lease
binnen een beperkte tijd verlengen, maar deze versie gebruikt
nog geen automatische heartbeat van externe uitvoerders.

`task.lease.expire` legt een verlopen poging als mislukt vast.
Bij de opening van de server en tijdens schedulercontroles wordt
nagegaan of zo'n gebeurtenis moet worden geregistreerd.
Een verlopen taak wordt niet automatisch opnieuw gestart.
De bestaande handmatige herstelprocedure kan uitsluitend na
beoordeling een bijwerkingsvrije taak opnieuw in de rij zetten.

Het operationslog bewaart claims, verlengingen, verval en eerdere
pogingen. Directe lease-events via `POST /ops/events` worden
geweigerd.

## Wat de tests werkelijk afdekken

De GitHub-CI draait de eerdere server-, worker-, dashboard- en
bewijstests, plus tests voor:

- slechts één claim per taak;
- lease-ID en uitvoerdercontrole;
- een beperkte geldigheidsduur en verlenging;
- een late of vervalste voltooiing;
- een verlopen lease na het opnieuw openen van de opslag;
- handmatige beoordeling vóór herhaling;
- de alleen-lezen API zonder taakinhoud;
- twee onafhankelijke lokale subprocessen en dubbele HTTP-verzoeken.

Deze tests gebruiken lokale opslag en vaste voorbeeldtaken.
Ze bewijzen niet dat een machine met twee serverinstanties,
een netwerkpartitie of een crash op exact elk mogelijk moment
veilig wordt hersteld.

## Nog te bouwen

De huidige oplossing heeft één exclusieve operationsschrijver
in één serverproces. De wachtrij is duurzaam omdat taakstatus
uit het log wordt afgeleid, maar er is geen gedeelde database
met atomische claims of onafhankelijke workerverbindingen.

De volgende uitbreiding vraagt aparte uitvoerders met een
geverifieerde identiteit, een claimprotocol met fencing op
opslagtransacties, heartbeats, wachttijdlimieten, veilige
processcheiding en een expliciet protocol voor externe effecten.
Nieuwe workercontracten, webonderzoek en modelaanroepen mogen
niet automatisch de rechten van de twee vaste tekstworkers
overnemen. Een token, deadline of hash alleen is geen bewijs
van precies-één-keer uitvoeren.
