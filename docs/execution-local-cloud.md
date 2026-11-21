# Uitvoering lokaal of in de cloud, één EAIwork

**Status 21 november 2026:** de browser bewaart de uitvoerkeuze per missie en
de vertrouwde controller kiest alleen echt aangesloten uitvoerplaatsen.
De bekende cloudtekstworker voert tekstinspecties uit. **Er is nog geen
gekoppelde lokale executor en nog geen uitvoerbare cloud-Codeworker.**
De keuze in de UI is geen bewijs dat een executor bestaat.

## Afspraken uit de bestaande repository

- Eén originele gebruikersopdracht en één bestaande `MissionPlan`. De
  oorspronkelijke instructie, actor, scope, werkerversies, gebeurtenissen,
  afhankelijkheden en controles blijven dezelfde, ongeacht de plaats.
- `executionPreference` (`auto | local | cloud`) is een opdrachtvoorkeur,
  **geen toestemming** om een worker uit te voeren of bestanden te veranderen.
- `MissionTask.effect: local` betekent geen externe neveneffecten. Het woord
  local in dat bestaande type gaat niet over de computer waarop een taak draait.
- `selectWorker` en `inspectMissionWorkerNeedsWithInventory` blijven
  verantwoordelijk voor toegelaten contracten, gemeten fixtures,
  toolcapaciteiten, modeltype en rechten. De pure nieuwe
  `chooseExecutionSite` bepaalt uitsluitend een geschikte uitvoerplek.
- De Orchestrator organiseert; de bestaande scheduler/uitvoering beslist opnieuw
  over rechten en contracten vóór de start. Geen tweede agent-loop.
- Modelvrijheid en toestemming zijn gescheiden. Modeluitvoer blijft voorstel;
  onafhankelijke tests, bronherkomst, menselijke vrijgave en de bewijsregels
  mogen niet door de planner of de uitvoerplek worden overgeslagen.
- Een Codeworker-voorstel is niet gelijk aan een geteste wijziging. Een groene
  Docker-test is niet automatisch een inhoudelijk geverifieerd product,
  geslaagde uitgifte of bewijsstatus `proven`.

## Wat deze wijziging nu doet

De browser biedt **Automatisch**, **Lokaal** en **Cloud**. Het backend bewaart
de keuze bij het aanmaken in `mission.create.plan.executionPreference`.
Oude missies zonder veld blijven afspeelbaar en krijgen alleen bij weergave
de standaardkeuze `auto`. De gebeurtenisgeschiedenis wordt niet herschreven.

`packages/operations/src/execution-site.ts` is een kleine, pure selector.
De vertrouwde host levert een inventory van daadwerkelijk gekoppelde
uitvoerplaatsen en de taaksoorten die zij ondersteunen. De browser kan geen
verbonden executor, extra rechten of geslaagde test claimen.

- `auto` kiest alleen een bestaande verbonden uitvoerplek. Als een lokale
  uitvoerder later werkelijk gekoppeld is, krijgt die voorrang. Zonder lokale
  verbinding kan een toegelaten cloudadapter worden gebruikt.
- `local` is **geen** automatische terugval naar de cloud; deze aanvraag
  blijft staan zolang geen lokale executor aan EAIwork is gekoppeld.
- `cloud` is **geen** terugval naar een lokaal programma.
- Code- en dashboardopdrachten blijven geblokkeerd, ook in `auto`, zolang
  er geen geautoriseerde Codeworker-adapter en geïsoleerde testomgeving zijn.
- De bestaande cloudtekstworker kan bij `auto` of `cloud` werken. Zijn
  contract, actorcontroles, menselijke vrijgave en `not-evaluated`-uitvoer
  blijven ongewijzigd.

Een verzoek voor uitvoering van een niet gekoppelde plaats levert
**geen** `task.started`, `task.completed`, modelaanroep, codewijziging
of automatische publicatie op. Zelfs een rechtstreeks `run`- of
`prepare`-verzoek wordt opnieuw gecontroleerd.

## Wat werkelijk nodig is voor de lokale Codeworker

De bestaande `LocalCodeWorkspace`, `OrderedCodePlans`,
`runIsolatedNodeTest` en `runIsolatedProjectSuite` zijn afhankelijk van
Node, vooraf gekozen echte bestanden, een modelprovider en de geïsoleerde
Docker-test. De Cloudflare Worker kan die lokale interfaces niet direct
importeren of veilig vervangen.

De juiste vervolgaansluiting is een **uitgaand verbonden lokale executor**:

1. De gebruiker koppelt op zijn eigen computer expliciet één werkmap en
   een aparte executor-identiteit. Het browserdashboard blijft de plek
   waar opdrachten worden gegeven en resultaten worden gezien.
2. De lokale executor meldt zich via een apart, beperkt kanaal bij de
   bestaande opdrachtservice. De computer hoeft geen inkomende poort te openen.
   De huidige localhost-executorproef is nog geen geauthenticeerd internetkanaal.
3. De centrale operations-controller kent uitsluitend na toestemming,
   workerselectie en scopecontrole een begrensde taaklease toe. De executor
   krijgt geen algemene missiegeschiedenis, bronarchief, cloudsecrets of
   publicatierechten.
4. Voor code: bestaande codewerkmap, voorstel, exacte versies, syntaxcontrole,
   geïsoleerde containerproef, review van het voorstel, toepassen,
   hercontrole. Het resultaat en de hashverwijzingen worden in dezelfde
   missiegeschiedenis teruggeschreven.
5. Bij herstart of time-out: verlopen lease eerst controleren. Externe of
   destructieve handelingen worden nooit blind herhaald. Een menselijke
   beslissing blijft nodig vóór toepassen of publiceren.

De bestaande `/executor/v1/claim`-route ondersteunt voorlopig alleen
localhost en begrensde teksttaken. Die route mag **niet** ongewijzigd
openbaar worden gezet. De veilige toegang, identity binding, beperkte
claims en aflevering van codewerk moeten eerst worden getest.

## Wat nodig is voor de cloud-Codeworker

Cloudflare Sandbox / Containers biedt in beginsel een Linux-omgeving voor
codebouw en geïsoleerde tests. Dat is een andere uitvoerplek, niet een
nieuwe Orchestrator, Builder of bewijsautoriteit. Een Cloudflare-container
mag geen Cloudflare Access-secrets, repository-schrijftokens of publicatie-
bevoegdheid meekrijgen. De feitelijke versies en testbytes moeten aan het
bestaande codecontract worden gebonden. Tests mogen hun eigen bewijs niet
verklaren.

**Accountbeperking:** de Cloudflare Containers API meldt momenteel dat
Containers niet beschikbaar zijn en dat het Workers Paid-abonnement vereist
is. Er is **geen abonnement gewijzigd of betaalde Container gestart**.
Voor een cloud-Codeworker zijn nog nodig: toestemming voor kosten, een
geïsoleerde runtime, modeltransport met afgebakende toegang,
bewaar-/privacycontrole, limieten, versiegebonden tests en een
gecontroleerde eindgebruikersproef.

Officiële documenten:
[Cloudflare Sandbox](https://developers.cloudflare.com/sandbox/),
[Security](https://developers.cloudflare.com/sandbox/concepts/security/).

## Acceptatievoorwaarden voordat de echte koppeling live mag

- Dezelfde missie kan expliciet `local` of `cloud` kiezen; de keuze wordt
  niet stilzwijgend veranderd. `auto` kiest alleen na vertrouwde
  runtime-registratie en hernieuwde worker-/rechtencontrole.
- Een browser op mobiel kan een geautoriseerde **andere computer** aansturen;
  het apparaat zelf hoeft geen Docker of model te draaien.
- Mislukte verbinding, ontbrekend model, verouderde workerversie, onjuist
  actor-/lease-ID, gewijzigde bronbestanden en testuitslagen met een andere
  hash worden geweigerd en blijven zichtbaar.
- Code wordt niet rechtstreeks op een Cloudflare Worker uitgevoerd;
  ongecontroleerde code wordt alleen in de daarvoor geïsoleerde omgeving
  getest. Een person-gebonden toestemming is nodig vóór wijzigen.
- Geen zelfbeoordeling of verhoging van epistemische bewijsstatus door een model,
  de uitvoerder, het dashboard of het operationslog.
- Geen automatische GitHub-merge, externe verzending of publicatie.
- Bij ontbreken van een verbinding toont het dashboard een geblokkeerde
  uitvoerstap, niet `Afgerond` of een fictieve test.
