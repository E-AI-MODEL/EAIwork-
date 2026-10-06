# Atom worker isolation

> **Document in ontwikkeling.** Dit document beschrijft de huidige implementatiegrens voor atom-workers. De aanduiding gaat over de documentatie, niet over de technische status van EAIwork.

## Doel

Een LLM-worker mag niet vanuit de volledige taak terugredeneren naar zijn deelvraag. De anatomie wordt vooraf door het pack bepaald. Daarna werkt iedere modelworker uitsluitend binnen één vooraf begrensde atom-capsule.

De harde ontwerpregel is:

> **No worker has enough interface-level information to reconstruct the parent task.**

Dit is geen promptinstructie. De runtime beperkt welke informatie überhaupt aan het model wordt aangeboden.

## Rollen

### Pack builder

De pack builder ziet het geheel en bepaalt vooraf:

- de atoms;
- dependencies;
- toegestane worker-inputs;
- toegestane bronhandles;
- contextlimieten;
- de server-side runtime.

### Atom worker

De atom worker ziet uitsluitend:

- de lokale vraag;
- vaste antwoordopties;
- gealiaste waarden van expliciet toegestane dependencies;
- begrensde tekstsnippets uit expliciet toegestane bronhandles.

De worker ziet niet:

- pack-id of domein;
- cluster;
- atom-id;
- sibling-atoms;
- dependency-id's;
- status of evidence van andere atoms;
- lineage;
- globale state;
- rules;
- downstream gebruik;
- projectdoel;
- bronhandles;
- caller prompt/context;
- andere workers of hun chatgeschiedenis.

### Assembler / EAIwork core

De assembler ziet de atom-resultaten en afgeleide status. Hij mag geen workerantwoord aanpassen omdat het globale resultaat een andere uitkomst wenselijk maakt.

## Pack policy

Een atom kan een workerpolicy krijgen:

```json
{
  "id": "a.fin.017",
  "question": "Is the budget approved by the budget holder?",
  "type": "yesno",
  "depends_on": ["a.fin.016"],
  "worker": {
    "runtime": "default",
    "reads": [
      { "atom": "a.fin.016", "as": "request_filed" }
    ],
    "sources": ["s.fin.approval"],
    "max_context_items": 3,
    "max_context_chars": 4000
  }
}
```

Worker-reads mogen alleen verwijzen naar reeds gedeclareerde directe dependencies. Het model krijgt de alias en waarde, niet het echte atom-id.

Bronnen worden als opaque handles gedeclareerd:

```json
{
  "sources": [
    { "id": "s.fin.approval" }
  ]
}
```

Een handle bevat in het pack geen URI, query of dossierpad. De server-side source broker bepaalt hoe het handle wordt opgelost.

## AtomCapsule

De modelprovider ontvangt exact dit soort object:

```ts
interface AtomCapsule {
  question: string;
  options: string[];
  inputs: Record<string, string | null>;
  context: string[];
}
```

Geen andere pack- of statevelden worden doorgestuurd.

## Source broker

Een source broker heeft één smalle interface:

```ts
interface SourceBroker {
  read(handle: string): Promise<string[]> | string[];
}
```

De broker krijgt niet:

- de volledige pack;
- het target atom-id;
- de globale onderzoeksvraag;
- sibling-state.

EAIwork roept alleen handles aan die vooraf in de workerpolicy staan.

De broker moet bronhandles zelf ook atomisch ontwerpen. Een handle als `s.all_project_documents` maakt de technische isolatie inhoudelijk waardeloos en hoort niet in een pack.

## Geen caller-context

De HTTP-route is:

```text
POST /workers/:atom
{}```

De body moet een leeg object zijn. Een caller kan dus niet meesturen:

- extra prompt;
- context;
- source list;
- system instruction;
- memory;
- sibling result.

De server bouwt de capsule zelf.

## Geen publieke modeltokens

Een `model` actor kan geen publiek API-token krijgen.

Een model-event ontstaat alleen nadat EAIwork zelf een worker uitvoert. Daardoor kan een externe agent niet eerst `/state` lezen en daarna onder modelidentiteit een atom beantwoorden.

## Geen gedeelde swarm-chat

Iedere atomuitvoering opent een nieuwe `ModelSession`.

```ts
interface ModelProvider {
  id: string;
  openSession(): ModelSession;
}
```

Een sessie wordt na één atomuitvoering gesloten. Provideradapters mogen geen conversation history tussen sessies hergebruiken.

Er is geen EAIwork-API voor:

- worker-to-worker messaging;
- shared scratchpads;
- swarm blackboards;
- worker memory;
- child-agent creation.

Als later een dergelijke feature wordt toegevoegd, moet zij als nieuwe trust boundary worden behandeld en mag ze de atomcapsule niet omzeilen.

## Autorisatie

Een orchestrator heeft expliciet `workers`-recht nodig:

```json
{
  "actor": { "kind": "system", "id": "system:worker-orchestrator" },
  "access": {
    "read": [],
    "write": [],
    "workers": "*"
  }
}
```

De worker-capability staat los van gewone state-toegang. Een execute-only orchestrator kan daarom een worker starten zonder `/state` te kunnen lezen en zonder gewone `/events` te kunnen schrijven.

De server haalt de gedeclareerde dependencywaarden zelf uit state en bouwt daarmee de capsule. Een afgehandelde worker-run antwoordt met HTTP `204 No Content`, ook wanneer het modelresultaat intern door de evidence-regels wordt geweigerd. De scheduler krijgt dus geen state, event-hash, modeluitkomst, probabilities of accept/reject-signaal terug.

## Consistentie tijdens generatie

De server onthoudt bij de start van een worker-call de huidige targetwaarde en de waarden van alle gedeclareerde worker-inputs. Na de modelcall controleert hij die opnieuw. Is één van deze waarden tijdens de generatie veranderd, dan wordt het modelresultaat niet gecommit. De scheduler ziet nog steeds alleen een bodyloze `204`; de afwijzing blijft intern zichtbaar in het rejection log.

## Output

Een worker kan uitsluitend probabilities over de vaste antwoordopties teruggeven.

Vrije tekst van het model wordt niet als antwoordcontract gebruikt. Onbekende opties worden weggegooid.

Het model kan via de workerroute niet:

- evidence toevoegen;
- lineage kiezen;
- status verhogen;
- flags dismissen;
- nieuwe atoms maken;
- nieuwe bronnen aanvragen;
- eigen dependencies toevoegen.

## Wat deze grens wel en niet garandeert

De runtime voorkomt dat EAIwork zelf globale structuur aan een worker meegeeft.

De runtime kan niet voorkomen dat een toegestane brontekst zelf globale context bevat. Dat is de verantwoordelijkheid van de source-handle-ontwerper. Bronhandles moeten daarom smal en atom-specifiek zijn.

Een in-process provideradapter is onderdeel van de trusted computing base. De externe modelrequest die de adapter verstuurt hoort alleen de `AtomCapsule` te bevatten.

## Regressie-eisen

Wijzigingen aan workers moeten blijven aantonen dat:

- een worker geen atom-id ziet;
- een worker geen pack/cluster ziet;
- sibling-atoms ontbreken;
- evidence/status/lineage ontbreken;
- alleen gedeclareerde dependencywaarden aanwezig zijn;
- alleen gedeclareerde bronhandles worden opgevraagd;
- contextitems en tekens hard begrensd zijn;
- caller-context wordt geweigerd;
- publieke modeltokens worden geweigerd;
- iedere uitvoering een verse modelsessie krijgt;
- output beperkt blijft tot de vaste atomopties;
- de orchestrator geen state hoeft te kunnen lezen of gewone events hoeft te kunnen schrijven;
- een succesvolle workerresponse volledig bodyloos is en geen modeluitkomst of event-commitment teruglekt naar de scheduler.

Deze eisen horen bij de architectuur, niet bij een specifieke provider.
