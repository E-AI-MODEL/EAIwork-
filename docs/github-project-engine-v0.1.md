# EAIgit op GitHub, proefversie

Doel: een begrensde GitHub Actions-projectcontrole ontwikkelen die zonder AI bestanden inventariseert, code op syntaxis controleert en een concreet advies geeft. De huidige versie is een interne proef in EAIwork.

De engine gebruikt GitHub Actions. Hij draait **niet continu**: GitHub start jobs op basis van een gebeurtenis, zoals een handmatige workflowstart of een pull request. **Het gebruikersantwoord staat leesbaar in de GitHub Actions-run onder Summary.** Artefacten zijn niet de gebruikersinterface.

## Uitvoeringsroute

| Fase | Job | Controle | Menselijke handeling |
| --- | --- | --- | --- |
| Doel | invoer `goal` | site, app, code of docs | Gebruiker bepaalt wat hij wil bereiken |
| Onderzoeken | `inventory` | bestanden, projecttype, startbestand, gevoelige bestandsnamen, afhankelijkheden | Bestanden in eigen repo plaatsen, besluiten wat openbaar mag |
| Controleren | `syntax` | alleen JavaScript `node --check` en Python `ast.parse`, zonder uitvoeren | Geen handeling nodig |
| Beoordelen | `report` | bevindingen en niet bewezen aannames samenvoegen | Openstaande vragen en kwaliteitscontrole beoordelen |
| Wijzigen | niet aanwezig | geen toegang tot repositoryschrijfacties | Afzonderlijke toestemming vereist |
| Publiceren | niet aanwezig | geen deployment | Afzonderlijke toestemming en acceptatie vereist |

Inventarisatie en syntax kunnen **parallel** worden uitgevoerd. Het rapport is afhankelijk van beide.

## Status: interne projectcontrole

De GitHub Actions-workflow is voorlopig uitsluitend vanuit **EAIwork zelf** te starten, via `workflow_dispatch` of een PR die deze engine wijzigt. De tests en de analyse gebruiken exact de commit waarvoor de workflow draait. Dit voorkomt dat nieuwe code ongemerkt wordt beoordeeld met tests uit een oudere, vastgepinde engineversie.

De vier jobs zijn: engine-tests, inventarisatie, syntaxiscontrole en rapportage. Bestands- en syntaxiscontrole verwerken de actuele repository als gegevens, zonder projectafhankelijke scripts te installeren of uit te voeren. Het rapport verschijnt in de GitHub Actions-samenvatting. Er is geen wijzigings- of publicatierecht.

## Gebruik vanuit een andere repository

**Nog niet beschikbaar.** De workflow heeft bewust geen `workflow_call`-ingang. Een kopieerbare wrapper zou nu de indruk wekken dat gebruikers al een volledig geteste dienst krijgen.

Voor een latere openbare versie moeten we eerst een afzonderlijke versie vastleggen, de aangeroepen code en workflow vastpinnen op gereviewde commits en de volledige route testen vanuit ten minste één andere repository. Controleer daarbij een geldige JavaScript/Python-proef, een bewust fout bestand, een ZIP-only project, ongebruikelijke bestandsnamen, gevoelige paden, autorisatie, gebruikslimieten en de foutmelding bij een afgebroken job. Dit zijn voorwaarden voor een volgende release, geen uitgevoerde eindgebruikertests.

### Wat is er bewust niet?

- Geen ZIP-uploadservice of authenticatie op de publieke website.
- Geen rechtstreekse koppeling met een persoonlijke GitHub-account of privérepository.
- Geen willekeurige `npm install`, `npm test`, `pip install` of door de gebruiker aangeleverde scripts.
- Geen herziening van code via AI, geen zelfstandig committen of publiceren.
- Geen geteste koppeling van deze GitHub Actions-jobs aan de beveiligde EAI Work Operations-server.

## Fouten zichtbaar in EAIgit

De syntaxiswerker geeft vastgestelde JavaScript- en Python-syntaxisfouten als GitHub Actions-annotaties door. Per fout worden uitsluitend de bestandsnaam, het regelnummer (voor zover de checker dat weet) en een korte melding gepubliceerd. De broncode of foutuitvoer wordt niet in de annotatie overgenomen. De controle voert geen projectscript uit.

Een toekomstige openbare EAIgit-koppeling kan de controles van een openbare GitHub-repository lezen. De website moet dan onafhankelijk controleren dat een gevonden annotatie werkelijk bij de juiste repository, commit, run en bronbestandsnaam hoort. De huidige GitHub Actions-proef bewijst niet dat die volledige gebruikersroute werkt. Een groen vinkje is geen bewijs van werkende functies. De JSON-rapportages van de engine en privéresultaten zijn niet automatisch beschikbaar in de browser. Hiervoor is later een aparte, geautoriseerde koppeling nodig.

De Actions-controle is met lokale fixtures en GitHub Actions getest. Bij gebruik door derden zijn een afzonderlijke securityreview en een test vanuit een andere repository vereist. De wizard activeert de engine niet zelf en verandert geen repositories.

## Beveiliging en grenzen

De workflow heeft uitsluitend `contents: read`. Checkout bewaart geen credentials. Broncode wordt alleen als gegevens behandeld; symlinks en afhankelijkheidsmappen worden niet gevolgd. Scans hebben een bestands- en groottebeperking. De job geeft geen broninhoud door aan het eindrapport en toont geen teststderr met mogelijk vertrouwelijke tekst.

Deze code mag na interne tests als interne proef worden geïntegreerd, maar is **geen publieke release**. Voor een publiek platform dat automatisch met GitHub-repositories van onbekende gebruikers werkt, zijn aanvullende autorisatie, quota, invoerbeveiliging, kostenlimieten en een onafhankelijke securityreview nodig.

## Testacceptatie

`node --test tests/project-engine.test.mjs` test echte lokale fixtures, bestandspaden, ZIP-valkuil, geheimen, en het voorkomen van code-uitvoering. De GitHub Actions-workflow moet alle vier de jobs uitvoeren en een geldig resultaat opleveren. Dit test niet het project van een echte gebruiker.
