# EAIwork-productielijn: leesbare status en sturing vanuit één server

**Status:** afgebakende conceptwijziging op de EAIwork-ontwikkelbranch.
Dit is geen import van de ShadowSeed-engine en geen productiepublicatie.

## Herkomst van de gekozen werkwijze

Vergelijking met ShadowSeed Pro (`E-AI-MODEL/shadowseed-pro`, huidige
`main` tijdens ontwerp) leverde drie bruikbare scheidingen op:

1. `src/shadowseed/application/orchestration.py` leidt de volgende
   menselijke of softwarehandeling af uit bestaande canonieke staat,
   zonder die zelf te veranderen.
2. `src/shadowseed/workbench/controller.py` houdt interfacebediening
   los van de regels voor bewijs, autorisatie en uitvoering.
3. `docs/architecture/production-acceptance.md` en
   `.github/workflows/release-workbench.yml` onderscheiden geslaagde
   technische tests van daadwerkelijke softwarevrijgave. Exacte
   commit-SHA, artefactverificatie, checks en bevoegdheden tellen mee.

ShadowSeed's seed/geheugen/Validation Gate is geen EAIwork-worker en wordt
niet overgenomen. Het grotere release-workflowcontract is nog niet
geïmplementeerd in EAIwork.

## Werkelijke gegevensstroom

```text
Opdracht + menselijke goedkeuring
  -> bestaande mission/worker-API
  -> OpsStore (duurzaam operationslog; één exclusieve schrijver)
  -> gecontroleerde snapshots en herleidbare taakstatus
  -> GET /ops/production-line  [audit-token vereist]
  -> bestaand dashboard /dashboard
  -> vijf stappen en de eerstvolgende menselijke handeling
  -> bestaande beveiligde actie-API (niet via statusprojectie)
  -> nieuwe gebeurtenis in hetzelfde operationslog
```

De nieuwe route is **read-only**. Ze verifieert het operationslog en
leest dezelfde opdracht- en workerregistratie als het dashboard. Een
ongeldig operationslog geeft HTTP 503 in plaats van een onbetrouwbare
status. De server retourneert geen taakinput, modeltekst, secrets of
uitvoerhashes in dit overzicht.

Het nieuwe dashboardpaneel gebruikt dezelfde toegang als
`/ops/state`. Bij verbinding en bij actieve uitvoering haalt de
browser het overzicht op via een relatieve, same-origin API-route.
Een zichtbare vervolgstap opent alleen de bestaande tab voor
uitvoering, workercontracten of menselijke beoordeling. Er wordt geen
privileged event via het paneel aangemaakt.

De afzonderlijke demo blijft synthetisch. De werkelijke productiestaat
verschijnt alleen bij verbinding met de EAIwork-server en een geldig
beheertoken. Bij een fout verschijnt een melding, geen fictieve
fallbackstatus.

## Betekenis van de vijf stappen

| Stap | Status komt uit | Wat het niet betekent |
| --- | --- | --- |
| Werkplan | goedgekeurde missierevisie | geen garantie dat de opdracht volledig begrepen is |
| Workers | geregistreerde, vrijgegeven contracten en beschikbare adapters | geen bewijs dat een model deze taak goed kan uitvoeren |
| Uitvoering | geclaimde, afgeronde of mislukte taakruns | geen inhoudelijke juistheid |
| Controle | open voorwaarden, mislukte runs en defecten | geen automatische inhoudelijke vrijgave |
| Vrijgave | momenteel geen EAIwork-software-releasecontract | altijd *niet gecontroleerd*, zelfs wanneer alle taken klaar zijn |

## Grenzen

- Statusprojectie is nooit een nieuwe bron van rechten.
- Een afgeleid label als `ready` geeft geen toestemming om iets te
  publiceren of externe effecten uit te voeren.
- Het bestaande operationslog heeft nog geen onafhankelijke
  externe witness; deze route suggereert die garantie niet.
- Er is nog geen CI-releaseafhandeling met controle van exacte SHA,
  publicatie-artefacten, checksums, licenties en goedkeuringsbesluit.
- De juiste vorm voor Ollama/andere lokale providers wordt apart
  gemeten op echte laptops. Een aangetroffen model is niet automatisch
  geschikt als planner of codeworker.
- De nieuwe projectie wordt getest met afgeleide status, autorisatie,
  privacy en regressies. Een groene CI-run bewijst niet dat zelfstandig
  complex softwarewerk al van begin tot eind kan worden afgehandeld.

## Daarna

De volgende veilige uitbreiding is een klein, expliciet releasecontract
dat een kandidaat-artefact aan één exacte commit, geslaagde checks,
broncode/licentie en een menselijke vrijgave koppelt. Begin met
rapporteren en weigeren bij onvolledige informatie, niet met
automatisch publiceren.
