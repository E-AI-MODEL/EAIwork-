# EAIwork: fases en plancontrole vóór uitvoering

Status: geteste ontwikkelstap in concept-PR #26, boven op de versiegebonden plannen in PR #25.

Een opdracht kan nu expliciete fases bevatten. Elke taak moet precies één fase
hebben. De afhankelijkheden moeten naar dezelfde of een eerdere fase wijzen.
Een bestaand plan zonder fases blijft geldig; de inspectie toont dan
afhankelijkheidsniveaus als afgeleide fases.

## Een plan controleren

```http
POST /ops/plans/preflight
Authorization: Bearer <server-token>
Content-Type: application/json

{"plan":{"id":"mission-voorbeeld","title":"Bronnen controleren","goal":"Werk een concept uit","tasks":[{"id":"task-start","title":"Tekst opschonen","taskKind":"text-normalize","dependsOn":[],"input":{"text":"  Concept  "}}],"phases":[{"id":"phase-begin","title":"Voorbereiden","taskIds":["task-start"]}]}}
```

De route controleert de structuur, taakafhankelijkheden, geregistreerde workers,
beschikbare adapters en huidige runtimebevoegdheden. Zij retourneert
`requires-human-review`, `approvalGranted:false` en `canExecute:false`.
Beschikbare workers zijn slechts kandidaten. Een later uitvoeringsverzoek
controleert de rechten en contracten opnieuw.

De endpoint registreert geen opdracht, start geen taak en geeft geen
toestemming. Het opslaan en goedkeuren gebeurt uitsluitend via de bestaande
beveiligde missie-API. Bronlinks worden op leesrechten gecontroleerd.

## Onopgeloste vragen

De lokale modelplanner mag vragen en fases voorstellen. Een bronpassage met
een expliciete onzekerheid blokkeert vanaf deze versie de betrokken taak.
De originele missie-eigenaar mag die onzekerheid pas na beoordeling met een
vastgelegde bewijsverwijzing oplossen.

Een exacte bronquote bewijst niet dat het model de opdracht juist interpreteert.
De inspectie controleert ook niet of álle ontbrekende voorwaarden zijn
gevonden. Ze biedt inzicht vóór goedkeuring, geen inhoudelijke certificering.

## Testgrenzen

De automatische CI controleert fase-indeling, ontbrekende en dubbele taken,
foutieve afhankelijkheden, het bewaren van bestaande fases bij uitbreiding,
onopgeloste onzekerheden en een read-only HTTP-preflight. Deze tests gebruiken
vaste voorbeelddata en een lokale demo. Er is nog geen test met een grote,
langlopende opdracht of echte modelgestuurde herplanning.

Voor een grote taak blijven algemene externe idempotency, procesisolatie,
grote opslagschalen en een echte multi-workerqueue nog te bouwen.
