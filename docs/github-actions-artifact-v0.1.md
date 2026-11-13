# EAIwork: artifact uit een gecontroleerde GitHub-run

**Stand:** concept-PR #41, boven op de lokale bestandshash van PR #40. Er is geen automatische softwarepublicatie.

## Wat je in het dashboard doet

Bij een opleverdossier klik je eerst op **Controleer CI bij GitHub**. Die stap bevestigt een succesvolle GitHub Actions-run voor de exact opgegeven commit.

Vervolgens vul je onder **Controleer artifact uit GitHub** de naam van het Actions-artifact en het pad van het bestand binnen de ZIP in. Het pad moet overeenkomen met het kandidaatbestand uit het dossier. Is de uploadmap door GitHub weggelaten, dan mag je uitsluitend de exacte bestandsnaam gebruiken.

EAIwork vraagt de run direct opnieuw op, zoekt via de officiële GitHub-API naar precies één niet-verlopen artifact met die naam en volgt de door GitHub aangewezen downloadlocatie. De server voert de inhoud niet uit en schrijft deze niet naar schijf. Het ZIP-bestand wordt in geheugen begrensd gelezen.

De ZIP-controle weigert onveilige bestandsnamen, symlinks, dubbele of overlappende bestanden, te grote archieven, hoge compressieverhoudingen en beschadigde CRC-waarden. De parser ondersteunt alleen ZIP32, gewone ZIP-opslag en deflate. De standaardgrens is 16 MiB voor archief en geselecteerd bestand, maximaal 64 bestanden en 24 MiB aan opgegeven uitgepakte inhoud.

Alleen wanneer het gekozen bestand dezelfde SHA-256 oplevert als de eerder ingediende kandidaat, schrijft de server een controle-event. Het event bevat de GitHub-run, poging, artifact-ID, artifactnaam, bestandspad, archiefhash, bestandshash, grootte, commit en controletijd. De inhoud en de tijdelijke ondertekende downloadlink worden niet bewaard.

## Welke herkomst hiermee vaststaat

De uitgepakte bytes komen overeen met een artifact dat de GitHub Actions-API aan de gekozen workflowrun koppelt. EAIwork vergelijkt opnieuw de commit en de status van die run. Een lokale upload is voor deze stap niet nodig.

Een run kan opnieuw worden gestart. De huidige GitHub artifact-metadata koppelt niet ieder artifact betrouwbaar aan een specifiek pogingnummer. Daarom weigert deze versie de controle voor runpogingen hoger dan één. Een latere versie moet herkomst per poging apart kunnen vaststellen voordat reruns worden toegelaten.

Het artifact kan binnen de workflow zijn geüpload zonder dat de betreffende broncode daadwerkelijk is gebouwd. Een overeenkomende hash bewijst ook geen reproduceerbare build, licentie, veilige werking, testdekking of inhoudelijke juistheid.

De afzonderlijke gebruikersupload blijft bestaan als onafhankelijke bestandscontrole. Het dashboard laat beide metingen apart zien. Publicatie blijft geblokkeerd: `publication.allowed` is altijd `false`.

## Verbinding en rechten

Het lezen gaat via de officiële API-host `api.github.com`. Een afzonderlijk GitHub-token kan op de server worden ingesteld met `EAI_GITHUB_READ_TOKEN`. Die tokenwaarde gaat alleen naar de GitHub-API. De server weigert automatische redirects; alleen een expliciet toegelaten ondertekende GitHub-opslaglink wordt gevolgd, zonder API-token.

De nieuwe route `POST /ops/missions/:id/release/verify-github-artifact` accepteert uitsluitend de JSON-velden `artifactName` en `entryPath`, via een persoonlijk operations-audittoken. Worker-tokens kunnen de route niet gebruiken. De gewone eventsroute kan het vertrouwens-event niet vervalsen. Na de netwerkdownload controleert de server de missierevisie en het volledige dossier opnieuw voordat het event wordt opgeslagen.

## Testen en grenzen

De regressietests gebruiken een lokale vervangende HTTP-lezer, geen echte GitHub-download. Ze controleren succesvolle en mislukte runs, gemanipuleerde ZIP-bestanden, redirects, afwijkende hashes en geweigerde bevoegdheden. De echte download met een GitHub App- of fijnmazig access token moet in de uiteindelijke installatie apart worden uitgevoerd.

Start de tests met `node --test tests/github-artifact-provenance.test.ts` en `npm test`.

De downloadbestemmingen zijn bewust beperkt. Wanneer GitHub de artifactopslag naar een andere host verplaatst, wordt de download geweigerd totdat die host afzonderlijk is onderzocht en toegestaan.

## Daarna

De volgende stap is de afzonderlijke controle van de licentie, de testinhoud en de exacte releasebestanden. Pas daarna is een expliciete menselijke vrijgaveprocedure zinvol. De productielijn mag dit bewijs niet automatisch ophogen tot publicatierecht.
