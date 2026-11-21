# EAIwork in de browser: eerste besloten Cloudflare-versie

**Status:** besloten eerste cloudproef gepubliceerd op `https://eaiwork.vis-c9d.workers.dev/`; geslaagde aanmelden-en-uitvoeren-proef door de eigenaar nog niet bevestigd. De gegevensbeschermingscontrole voor vertrouwelijke informatie is nog niet afgerond. Geen Terminal, Docker of Ollama op de computer van de gebruiker.

Deze service is een **apart** Cloudflare Worker-project, `eaiwork`, binnen het bestaande Cloudflare-account voor `eaimodel.nl`. De bestaande Theory7-site, DNS, e-mail en Worker `eai-html-galerij` veranderen **niet**. De service heeft een eigen `workers.dev`-URL, zonder route op het hoofddomein. Preview-URLs blijven uit.

## Bewust afgebakende werkproef

Vanuit één rustige browserpagina kun je:

1. Een lokale tekstinspectie als missie vastleggen. Dit is **geen LLM-aanroep**.
2. Een ontbrekende `text-inspector` laten samenstellen met de **bestaande EAIwork Builder**, uit de vaste recepten `text-normalize` en `text-metrics`.
3. Drie echte vaste fixtures laten uitvoeren. De reducer registreert kandidaat en meting afzonderlijk met een vertrouwde check-actor.
4. De kandidaat **zelf** vrijgeven. De EAIwork-workerregistratie valideert de exacte workerversie en het meetbewijs.
5. De tekstinspectie expliciet starten. De vertrouwde taakrunner registreert start en resultaat. De status blijft `verification: not-evaluated`.

De controller importeert rechtstreeks de EAIwork-modules `missions.ts`, `registry.ts`, `selector.ts`, `builder.ts` en `pure-text.ts`. Er komt **geen tweede agent of scheduler** bij. De Node-runner en Cloudflare gebruiken dezelfde vaste tekstadapters. Buildercode krijgt geen shell, filesystem, publicatie, internettoegang of extra werkermap.

Wat **niet** online is: de bestaande generieke Codeworker, Docker-projecttests, RepoSearch in een lokale checkout, Ollama, algemene workerbouw en automatische GitHub-merge. Die mogen niet als werkend worden gepresenteerd.

## Beveiliging

- Een onbeschermde app mag **niets** uitvoeren of tonen. De Worker vereist een door Cloudflare geverifieerde Access-identiteit met exact dezelfde audience (`EAI_ACCESS_AUD`) én het afzonderlijk toegestane e-mailadres (`EAI_ALLOWED_EMAIL`).
- Geen toegang via alleen browserheaders, URL-token of eigen wachtwoordformulier.
- Alle acties vereisen same-origin JSON. De gebruiker geeft apart toestemming voor worker-vrijgave en taakuitvoering.
- De Durable Object-opslag heeft per eigenaar een besloten, replaybaar EAIwork-eventlog met hashketen; dit is **geen onafhankelijk ondertekend bewijslog**.
- De app toont alleen gegevens aan de toegestane Cloudflare Access-gebruiker. Voor echte persoonsgegevens en schoolgegevens is nog geen afgeronde gegevensbeschermingsbeoordeling gemaakt. **Gebruik alleen onschuldige testgegevens.**
- Standaard `EAI_ACCESS_AUD` en `EAI_ALLOWED_EMAIL` **niet ingesteld** betekent altijd HTTP 403, zelfs als iemand de URL weet.
- Geen productiepublicatie vóór een geslaagde onafhankelijke toegangstest met juiste en onjuiste gebruiker, en controles op opslag, datalocatie en operationele kosten.

## Eerder aangetroffen accountstatus (21 november 2026)

- Cloudflare-zone `eaimodel.nl` actief. De website verwijst naar Theory7.
- Een Worker `eai-html-galerij`, geen aparte `eaimodel.nl` Worker-routes.
- Cloudflare Zero Trust Free is inmiddels ingeschakeld. De zelfgehoste Access-app beveiligt alleen `eaiwork.vis-c9d.workers.dev` en laat voorlopig alleen het ingeschreven account `vis@emmauscollege.nl` toe. Niet-ingelogde verzoeken worden naar het Access-inlogscherm gestuurd.
- Geen reden om DNS, de huidige Worker of de FTP-publicatie aan te passen.

## Nog te controleren vóór een bruikbare online sessie

Dit is een beheerhandeling in de **Cloudflare-webinterface**, niet op de Mac van de gebruiker:

1. Cloudflare Access inschakelen voor het bestaande account, zonder een bestaand domein om te zetten. De accountbeheerder moet daarbij zo nodig de toegangvoorwaarden en kosten controleren.
2. De nieuwe Worker `eaiwork` uitsluitend via Cloudflare Access beschermen, met een toelatingsregel voor de gewenste gebruiker.
3. In de Workerconfiguratie `EAI_ACCESS_AUD` op de door Cloudflare uitgegeven audience en `EAI_ALLOWED_EMAIL` op het beoogde account zetten. Nog niet in een publiek repositorybestand.
4. De toegang toetsen met de juiste gebruiker, zonder sessie, via een andere gebruiker en met een andere Access audience.
5. Pas daarna de besloten URL beschikbaar stellen. Een later routevoorstel voor `eaimodel.nl/work` vereist afzonderlijke controle om de bestaande Theory7-pagina niet te overschrijven.

De repo bevat de Cloudflare-configuratie `cloudflare.config.ts` volgens de actuele **cf**-CLI-indeling, met een SQLite-backed Durable Object. Cloudflare Deploy gebeurt niet automatisch vanaf een PR. De code moet eerst bouwen en een testbare versie opleveren; daarna kan deze via een gemachtigde Cloudflare-deployment gepubliceerd worden. Gebruik geen losse Worker die de Accesscontrole omzeilt.

## Controles

`node --test tests/cloud-workspace.test.ts` test de echte EAIwork-overgangen en beperkingen, met dezelfde reducer als de lokale software. Het reguliere `npm test` toetst ook de bestaande werking. Een aparte Cloudflare runtime-build controleert of bundeling en Durable Object-registratie geldig zijn. Groene unit-tests bewijzen niet dat Access, opslag of de online dienst al werkt.

Vervolg: een geïsoleerde Codeworker-run via Cloudflare Sandbox of een gecontroleerde externe runner. Dat vereist apart mandaat, versie-/contracttest en menselijke vrijgave. Er wordt geen model of externe agent als vervanger van EAIwork ingevoerd.
