# EAIwork: een bestaand plan laten aanvullen

**Status:** concept-PR #27, aanvullend op PR #23 t/m #26. Dit is geen
zelfstandig uitvoerende planner en geen productieversie.

Een bestaande opdracht kan later extra taken nodig hebben. De lokale
planner kan zulke taken nu voorstellen zonder de oorspronkelijke
opdracht, oude taken of afgeronde resultaten te herschrijven.

## Aanvraag

Een aangemelde missie-eigenaar gebruikt de beveiligde server:

```http
POST /ops/missions/<mission-id>/replan/propose
Authorization: Bearer <server-token>
Content-Type: application/json

{"expectedRevision":1,"reason":"Er ontbreekt een controle van de bronnen."}
```

De server controleert vooraf de eigenaar en het revisienummer. Het
model ontvangt de oorspronkelijke opdracht, doel, taak-ID's, titels,
afhankelijkheden, fases en oorspronkelijke voorwaarden. Het ontvangt
niet de eerdere uitvoer, de volledige eventgeschiedenis of extra
bevoegdheden.

Het model mag alleen nieuwe taken, nieuwe fases, extra voorwaarden
en open vragen teruggeven. De server voegt dit samen met het bewaarde
plan en gebruikt exact dezelfde validatie als bij een later door de
mens goedgekeurde uitbreiding.

- Oude taken, taakvolgorde, doel en oorspronkelijke opdracht blijven gelijk.
- Bestaande brongebonden voorwaarden gelden ook voor iedere nieuwe taak.
- Nieuwe bronvoorwaarden mogen alleen op de toegevoegde taken slaan en
  moeten een exacte passage uit de oorspronkelijke opdracht citeren.
- Een plan met fases mag alleen nieuwe fases toevoegen. Een eerdere
  fase of taak mag niet worden verplaatst.
- Een veranderd revisienummer tijdens de modelaanroep maakt het voorstel
  ongeldig. Er wordt niets automatisch bijgewerkt.
- Er wordt geen worker gestart, geen modelrecht verhoogd en geen
  externe handeling verricht.

## Review en uitvoering

De reactie heeft `requires-human-review`, de verwachte revisie, een
volledig planvoorstel en een read-only preflight. De preflight meldt
afhankelijkheidsniveaus, blokkades, mogelijk passende lokale workers
en onbeantwoorde vragen. Zij controleert geen inhoudelijke juistheid.

De eigenaar kan het voorstel afzonderlijk goedkeuren via de bestaande
`POST /ops/missions/:id/extend`-route. Die route valideert alles
opnieuw en bewaart de nieuwe revisie in het operationslog.

De lokale Ollama-planner heeft een afzonderlijke JSON-responsvorm voor
planuitbreidingen. Alleen een door de beheerder toegestane loopback-provider
kan hiervoor worden geconfigureerd. De tests gebruiken mockmodellen,
geen echte vergelijking van modelkwaliteit.

## Grenzen voor de volgende bouwstap

De planner kan nog niet zelfstandig beslissen of een voorgestelde taak
het oorspronkelijke doel werkelijk dient, of alle voorwaarden zijn
gevonden, of een worker inhoudelijk geschikt is en of een uitkomst
voldoende gecontroleerd is. Ontbrekende workers worden niet automatisch
gebouwd. De taakqueue is nog sequentieel.

Relevante tests:
`tests/replan-proposal.test.ts` en
`tests/replan-proposal-api.test.ts`. De CI-uitkomst hoort bij de exacte
GitHub-commit, niet bij alleen deze documentatie.
