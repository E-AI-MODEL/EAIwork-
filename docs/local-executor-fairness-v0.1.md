# EAIwork: taakclaims verdelen tussen lokale missies

**Status:** concept-PR #36 boven op de specifieke uitvoerdertoestemming van PR #35.
Geen gedistribueerde queue en geen productiepublicatie.

## Wat de coördinator doet

Een ingelogde lokale tekstworker mag alleen taken ontvangen uit missies
waarvoor de missie-eigenaar zijn exacte `executorId` heeft goedgekeurd.
De server houdt maximaal twee leases gelijktijdig actief.

De oude claimvolgorde was alfabetisch op missie-ID. Een missie met veel
onafhankelijke taken kon daardoor herhaaldelijk als eerste een plaats krijgen.

De coördinator sorteert nu missies op de **oudste laatste leaseclaim**.
Daarbij leest hij alleen de bewaarde `run.startedAt`-waarden van huidige
en eerdere geleasede pogingen in de missiestaat. Een missie die nog nooit
een lease had, komt eerst. Bij gelijke waarden wordt op ID gesorteerd.
Daarna doorloopt hij per missie nog steeds de taken in de goedgekeurde
planvolgorde.

De keuze is een afgeleide van het bestaande operationslog. Er is geen
tweede, onafhankelijk te wijzigen wachtrijcursor. Een eerder vervallen
of beoordeelde lease telt mee voor de beurtvolgorde, maar geeft geen
nieuwe rechten of herhalingsbudget.

## Wat niet verandert

- Alleen `text-normalize` en `text-metrics` worden zo geclaimd.
- De bijbehorende executor moet uitdrukkelijk op `executorIds` staan.
- De missie moet zijn goedgekeurd en mag niet gepauzeerd zijn.
- Afhankelijkheden, brongebonden voorwaarden en workercontracten worden
  bij de keuze opnieuw gecontroleerd.
- Iedere claim wordt vóór vrijgave van taakinput blijvend vastgelegd.
- Leases verlopen en resultaten worden op run-ID, lease-ID en uitvoerder
  gecontroleerd. Een verlopen resultaat is geen geldige afronding.
- Een budget mag niet door een eerlijkheidsregel worden verhoogd.
- Er worden geen externe taken, modelrechten of publicatieacties toegevoegd.

## Proef

De integratietest `tests/executor-fair-claims.test.ts` gebruikt een
missie met drie onafhankelijke teksttaken en een tweede met één taak.
Beide zijn expliciet aan dezelfde tekstworker toegewezen. De eerste
claim gaat naar de eerste missie, de tweede naar de nog niet bediende
missie. De twee gelijktijdige leases vullen de capaciteit. Na hun
correcte voltooiing krijgt de eerste missie een volgende taak.

De test controleert ook dat een tweede, niet-aangewezen token geen
taakinhoud krijgt, de budgetten intact blijven en de journalverificatie
slaagt. De volledige bestaande CI draait mee.

## Grenzen

Dit is een eenvoudige lokale verdelingsregel, geen garantie voor
wachttijden of maximale doorlooptijd. Er zijn nog geen prioriteitsklassen,
per-executorcapaciteit, tenantquota's, hulp bij vastgelopen inhoudelijke
taken of gedeelde databaseclaims. De berekening gebruikt aanwezige
missies en rungegevens en is niet onder productiebelasting gemeten.

Een volledig autonoom systeem dat meerdere externe onderzoeks- en
bouwworkers veilig kan aansturen, vraagt verdergaande toestemming,
procesisolatie, achtergronduitvoering en idempotente externe acties.
