# EAIwork: duurzame lokale uitvoering en gecontroleerd herstel

**Status:** vervolg op concept-PR #23, in concept-PR #24. Geen productieversie.
De bestaande dashboarddemonstratie, het bewijslog en de workercontracten blijven ongewijzigd.

## Wat de server nu doet

Een goedgekeurde missie bestaat al als blijvende reeks `mission.create`,
`task.started`, `task.completed`, `task.failed` en andere operations-events.
Taken volgen de vastgelegde afhankelijkheden. Een taakstart telt vóór uitvoering
mee voor het goedgekeurde maximum.

De missie-eigenaar kan via de bestaande beveiligde API toestemming geven
om het **resterende lokale werk** na een serverherstart voort te zetten:

```http
POST /ops/missions/<mission-id>/automation/start
Content-Type: application/json

{"maxStarts":4,"resumeAfterRestart":true}
```

Zonder `resumeAfterRestart:true` blijft de oorspronkelijke regel gelden:
na een herstart wordt automatische toestemming ingetrokken. Een stop,
pauze, bereikt maximum, geblokkeerde voorwaarde of ontbrekende worker
wordt niet omzeild.

De scheduler verwerkt telkens één taak, uit een blijvend missieplan.
Alleen `text-normalize`, `text-metrics` en de vertrouwde vaste
`text-inspect`-samenstelling kunnen in deze automatische queue staan.
Workerstatus, contract, toestemming en afhankelijkheden worden vóór de
daadwerkelijke uitvoering opnieuw beoordeeld.

## Onderbroken start

Bij een herstart leest de server eerst het volledige operationslog.

- Een nog niet begonnen, gereedstaande taak mag onder dezelfde expliciete
  toestemming starten, binnen het resterende taakmaximum.
- Een al begonnen `text-normalize`- of `text-metrics`-berekening mag opnieuw
  in de queue worden gezet. Deze twee adapters lezen uitsluitend lokale
  invoer en hebben geen externe bijwerkingen. Het oude run-id blijft in
  de pogingengeschiedenis staan als `process-restart`. Een nieuwe start
  krijgt een nieuw run-id en telt opnieuw mee.
- Een onderbroken samengestelde, onbekende of externe worker wordt niet
  automatisch opnieuw uitgevoerd. Dat geldt ook bij een opgebruikt budget
  of na drie eerder bewaarde herhalingen. De missie stopt voor beoordeling.
- Een herstelvoorstel kan geen publicatierecht, nieuw model, externe
  schrijfrechten of extra taakbudget toekennen.

Een `task.recover`-event mag uitsluitend door de vertrouwde lokale scheduler
worden toegevoegd. De gewone API accepteert dit type gebeurtenis niet.
De herstelde poging is zichtbaar via `GET /ops/missions/:id/trace`.
Een afgeronde technische taak krijgt hierdoor nog geen bewijsstatus.

## Opslag en crashvenster

Het aparte operationslog schrijft een complete gebeurtenis naar JSONL en
synchroniseert die naar schijf. Daarna wordt een tijdelijke logkop
gesynchroniseerd en atomisch op zijn plaats gezet.

Bij een herstart mag **precies één** complete en correct gehashte gebeurtenis
na een bestaande, geldige logkop worden hersteld. Bij een afgebroken regel,
een onverwacht verschil, twee extra regels of een ontbrekende kop stopt de
server voor handmatige controle. Een onzekere mislukte schrijfactie blokkeert
nieuwe writes in dat proces. Er wordt niets automatisch afgekapt.

Het schrijversslot laat geen tweede schrijver toe. Een achtergebleven slot
wordt alleen automatisch opgeheven wanneer de vorige PID aantoonbaar niet
meer bestaat op dezelfde host. Onbekende eigenaars blijven geblokkeerd.

**Grenzen:** de operations-hashketen heeft nog geen externe, ondertekende
witness. Een beheerder met toegang tot alle lokale bestanden kan gegevens
wijzigen zonder dat dit mechanisme authenticiteit bewijst. De vergrendeling
is niet geschikt voor meerdere machines of een gedeelde netwerkmap.
De nieuwe tests bootsen een crashvenster na; ze zijn geen bewijs voor alle
schijf-, stroom- en filesystemstoringen. Er is nog geen transactionele outbox
of protocol voor herhaling van externe writes.

## Tests

```sh
node --test tests/operations-durability.test.ts tests/scheduler.test.ts tests/automation-api.test.ts
npm test
```

De controles dekken schijflogheropening, één geldig herstelbaar event,
afwijzing van beschadiging, exclusieve writes, achtergebleven locks,
toestemming bij herstart, doorlopende afhankelijkheden, beperkte
automatische herhaling en weigering van vervalste recoveries. De CI-uitkomst
moet bij de actuele commit worden gecontroleerd.

## Wat daarna nodig blijft

Dit is een **lokale, sequentiële duurzame missiequeue** binnen een
klein vooraf toegelaten aantal workers. De volgende stap is een algemene
jobqueue met expliciete claim-/lease-overgangen, procesisolatie,
heartbeats, distributieve fencing en idempotency voor externe acties.
Pas daarna heeft gelijktijdige uitvoering op meerdere workers zin.

Vervolgens kan de zelfstandige planner fasen, taken, afhankelijkheden,
oorspronkelijke voorwaarden en revisies beheren. De volledige eindproef
met drie onderzochte GitHub-projecten, een gebouwde verbetering en
gecontroleerde oplevering is hiermee nog niet uitgevoerd.
