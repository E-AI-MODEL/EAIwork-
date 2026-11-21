# EAIwork in de browser: eerste besloten Cloudflare-versie

**Status:** besloten eerste cloudproef online op `https://eaiwork.vis-c9d.workers.dev/`. De eigenaar heeft de browserlogin gebruikt en vijf tekstinspecties afgerond. Verdere onafhankelijke beveiligings- en inhoudscontroles zijn nog niet uitgevoerd. De gegevensbeschermingscontrole voor vertrouwelijke informatie is nog niet afgerond. Geen Terminal, Docker of Ollama op de computer van de gebruiker.

Deze service is een **apart** Cloudflare Worker-project, `eaiwork`, binnen het bestaande Cloudflare-account voor `eaimodel.nl`. De bestaande Theory7-site, DNS, e-mail en Worker `eai-html-galerij` veranderen **niet**. De service heeft een eigen `workers.dev`-URL, zonder route op het hoofddomein. Preview-URLs blijven uit.

## Bewust afgebakende werkproef

De eigenaar kiest per nieuwe opdracht `auto`, `local` of `cloud`. Die
keuze wordt opgeslagen in de bestaande missie en verleent zelf geen
uitvoerrechten. De cloudtekstworker is aangesloten. Een lokale executor is
nog niet gekoppeld, en cloudcode-uitvoering is niet ingericht. Een verzoek
voor een ontbrekende uitvoerplek blijft staan: geen automatische fallback
tegen de keuze van de gebruiker in. Zie
[Uitvoering lokaal of cloud](execution-local-cloud.md) voor contract,
beveiligingsafspraken en de nog ontbrekende uitvoerverbindingen.

Vanuit één rustige browserpagina kun je:

1. Een opdracht in gewone taal vastleggen, met optioneel brontekst. De oorspronkelijke instructie wordt ongewijzigd in de bestaande missie bewaard. Dit is **geen LLM-aanroep**. Alleen expliciete tekstinspecties met brontekst vallen onder de vaste, uitvoerbare tekstbewerking. Andere opdrachten krijgen een **geblokkeerde, niet-afgeronde** missie.
2. Een ontbrekende `text-inspector` laten samenstellen met de **bestaande EAIwork Builder**, uit de vaste recepten `text-normalize` en `text-metrics`.
3. Drie echte vaste fixtures laten uitvoeren. De reducer registreert kandidaat en meting afzonderlijk met een vertrouwde check-actor.
4. De kandidaat **zelf** vrijgeven. De EAIwork-workerregistratie valideert de exacte workerversie en het meetbewijs.
5. Een tekstinspectie starten. Bij een al vrijgegeven worker kan een nieuwe expliciete tekstinspectie direct worden uitgevoerd. De native taakrunner registreert start en resultaat. De status blijft `verification: not-evaluated`. De werkruimte toont één geselecteerde opdracht met voortgang, eenvoudige getallen en technische details alleen op verzoek.

De controller importeert rechtstreeks de EAIwork-modules `missions.ts`, `registry.ts`, `selector.ts`, `worker-needs.ts`, `execution-site.ts`, `builder.ts` en `pure-text.ts`. De Node-Orchestrator gebruikt exact dezelfde pure `worker-needs.ts` om tekorten aan uitvoerbare workers te herkennen. Er komt **geen tweede agent of scheduler** bij. De Node-runner en Cloudflare gebruiken dezelfde vaste tekstadapters. Buildercode krijgt geen shell, filesystem, publicatie, internettoegang of extra werkermap.

Een vrij geformuleerde aanvraag zoals 'bouw een dashboard' wordt dus **niet** stilletjes omgezet in een teksttelling en ook niet als uitgevoerd gemarkeerd. De aanvraag wordt bewaard; de workerbehoefte is zichtbaar. Dat is een registratie en selectie, geen automatische planvorming of codegeneratie.

Wat **niet** online is: de bestaande generieke Codeworker, Docker-projecttests, RepoSearch in een lokale checkout, Ollama, een geauthenticeerde verbinding met een lokale executor, een cloud-Codeworker, algemene workerbouw en automatische GitHub-merge. Containers zijn in het huidige Cloudflare-account niet beschikbaar; de API verwijst naar Workers Paid. Die mogen niet als werkend worden gepresenteerd.

## Beveiliging

- Een onbeschermde app mag **niets** uitvoeren of tonen. De Worker vereist een door Cloudflare geverifieerde Access-identiteit met exact dezelfde audience (`EAI_ACCESS_AUD`) én het afzonderlijk toegestane e-mailadres (`EAI_ALLOWED_EMAIL`).
- Geen toegang via alleen browserheaders, URL-token of eigen wachtwoordformulier.
- Alle acties vereisen same-origin JSON. De gebruiker geeft apart toestemming voor worker-vrijgave en taakuitvoering.
- De Durable Object-opslag heeft per eigenaar een besloten, replaybaar EAIwork-eventlog met hashketen; dit is **geen onafhankelijk ondertekend bewijslog**.
- De app toont alleen gegevens aan de toegestane Cloudflare Access-gebruiker. Voor echte persoonsgegevens en schoolgegevens is nog geen afgeronde gegevensbeschermingsbeoordeling gemaakt. **Gebruik alleen onschuldige testgegevens.**
- Standaard `EAI_ACCESS_AUD` en `EAI_ALLOWED_EMAIL` **niet ingesteld** betekent altijd HTTP 403, zelfs als iemand de URL weet.
- Dit is een beperkte privéproef, geen goedgekeurde productieomgeving voor vertrouwelijke data. Een niet-ingelogde sessie is getest; een onafhankelijke test met een tweede identiteit, opslagcontrole, datalocatie en operationele kosten zijn nog niet afgerond.

## Eerder aangetroffen accountstatus (21 november 2026)

- Cloudflare-zone `eaimodel.nl` actief. De website verwijst naar Theory7.
- Een Worker `eai-html-galerij`, geen aparte `eaimodel.nl` Worker-routes.
- Cloudflare Zero Trust Free is inmiddels ingeschakeld. De zelfgehoste Access-app beveiligt alleen `eaiwork.vis-c9d.workers.dev` en laat voorlopig alleen het ingeschreven account `vis@emmauscollege.nl` toe. Niet-ingelogde verzoeken worden naar het Access-inlogscherm gestuurd.
- Geen reden om DNS, de huidige Worker of de FTP-publicatie aan te passen.

## Huidige toegang en nog open controles

De beheerinrichting is uitgevoerd via Cloudflare. Nog te toetsen voordat echt werk kan worden toegelaten:

1. Cloudflare Access is actief en beperkt de URL tot het toegestane e-mailadres. De twee secret bindings zijn ingesteld. Preview-URLs zijn uitgezet.
2. Een niet-ingelogde aanvraag krijgt het Access-inlogscherm. De eigenaar heeft via de browser de vaste tekstworker gebruikt.
3. Controle met een afwijkende identiteit, foutief Access-audience, opslaglocatie, bewaring en kosten moet nog onafhankelijk plaatsvinden.
4. Een later routevoorstel voor `eaimodel.nl/work` vereist afzonderlijke controle; de bestaande Theory7-pagina mag niet worden overschreven.

De repo bevat de Cloudflare-configuratie `cloudflare.config.ts` volgens de actuele **cf**-CLI-indeling, met een SQLite-backed Durable Object. Cloudflare Builds volgt de gekoppelde `main`-branch. Pull requests worden niet automatisch naar de publieke werkruimte uitgerold. Na samenvoegen en een geslaagde deploy moet de bestaande toegangscontrole opnieuw gecontroleerd worden. Een ingelogde browserproef blijft nodig. Gebruik geen losse Worker die de Accesscontrole omzeilt.

## Controles

`node --test tests/cloud-workspace.test.ts` test de echte EAIwork-overgangen en beperkingen, met dezelfde reducer als de lokale software. Het reguliere `npm test` toetst ook de bestaande werking. Een aparte Cloudflare runtime-build controleert of bundeling en Durable Object-registratie geldig zijn. Groene unit-tests bewijzen niet dat Access, opslag of de online dienst al werkt.

Vervolg: een geïsoleerde Codeworker-run via Cloudflare Sandbox of een gecontroleerde externe runner. Dat vereist apart mandaat, versie-/contracttest en menselijke vrijgave. Er wordt geen model of externe agent als vervanger van EAIwork ingevoerd.
