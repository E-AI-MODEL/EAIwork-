# EAIwork buiten de eigen computer: voorwaarden voor een proef

**Status: niet gepubliceerd.** De huidige EAIwork-server is ontworpen voor lokaal gebruik op `127.0.0.1`. De publieke website op `/work/` is alleen een informatiepagina. Een Cloudflare Access-login alleen maakt de bestaande server nog niet geschikt voor productie.

## Voorgestelde opzet

- Houd de bestaande EAIwork-server op `127.0.0.1`. Gebruik geen publieke luisterpoort.
- Plaats een afzonderlijke, afgeschermde proxy of Cloudflare Tunnel voor de server, met een Access-applicatie die uitsluitend expliciet toegestane accounts accepteert.
- Verifieer Access-tokens en de bedoelde doelgroep **op de vertrouwensgrens**. Alleen een doorgestuurde gebruikersheader is niet voldoende. Blokkeer directe toegang tot de origin.
- Gebruik de bestaande EAIwork-tokens en fijnmazige autorisatie daarnaast. Access is niet hetzelfde als de `read`, `write`, `workers`, `checks`, `audit` en `code`-rechten van EAIwork.
- Bewaar tokens en sleutels uitsluitend server-side, buiten GitHub en buiten de publieke HTML. Gebruik afzonderlijke identiteiten voor de operator en eventuele uitvoerende processen.
- Laat code-uitvoering alleen plaatsvinden in een afzonderlijke geïsoleerde runtime met vaste projectscope en een verplichte test- en goedkeuringsstap. Een Cloudflare Worker is geen vervanging voor de bestaande lokale Docker-proef.
- Bewaar logboeken, werkbestanden en back-ups buiten de publieke site. Test herstel en sleutelrotatie. Voer een beoordeling van modelverkeer en persoonsgegevens uit voordat echte gegevens worden gebruikt.

## Preflight

`node scripts/remote-deployment-preflight.mjs` controleert verplichte configuratievelden en handmatig afgetekende veiligheidsvoorwaarden. Het programma **wijzigt niets**, start geen server en is standaard blokkerend. De vereiste velden:

| Variabele | Betekenis |
| --- | --- |
| `EAI_PUBLIC_ORIGIN` | HTTPS-adres van de beoogde besloten werkruimte |
| `EAI_ACCESS_AUDIENCE` | Audience-ID van de Access-applicatie |
| `EAI_ACCESS_ISSUER` | HTTPS-teamdomein van Access |
| `EAI_TOKEN_FILE` | Pad naar bestaande EAIwork-tokenregistratie (chmod 600) |
| `EAI_BIND_HOST` | Moet `127.0.0.1` zijn |
| `EAI_ACCESS_POLICY_VERIFIED` | `yes` na succesvolle allow/deny-test |
| `EAI_ORIGIN_LOCKED` | `yes` na netwerkcontrole |
| `EAI_BACKUP_RESTORE_VERIFIED` | `yes` na hersteltest |
| `EAI_TOKEN_ROTATION_VERIFIED` | `yes` na rotatietest |
| `EAI_MODEL_EGRESS_REVIEWED` | `yes` na beoordeling uitgaand modelverkeer |

De `yes`-velden zijn verklaringen van de beheerder, geen automatisch bewijs. De controle **verifieert niet** of Access daadwerkelijk is ingesteld, of de JWT-verificatie correct werkt, of de origin ontoegankelijk is, of een backup echt teruggezet kan worden. Ook een geslaagde preflight is **geen toestemming om te publiceren**.

## Wat nog gebouwd en getest moet worden

1. Een afzonderlijke, beveiligde gateway met server-side JWT-validatie en expliciete autorisatie. Geen directe browsertoegang tot de bestaande lokale API zonder aanvullende bescherming.
2. Hosting voor de gateway, de EAIwork-server en een geïsoleerde code-executor. De exacte hostingkeuze volgt pas na verificatie van de beschikbare Cloudflare-voorzieningen.
3. End-to-end-tests met toegestane en geweigerde gebruikers, herstart, tokenrotatie, back-upherstel en een ongeldige agentactie.
4. Een proef met onze eigen EAIwork-agent in een wegwerp-werkruimte: opdracht, bestaand taakplan, workerkeuze, uitgevoerde stap, controle, zo nodig een herplanvoorstel en menselijke goedkeuring. Geen autonome rechtenuitbreiding, merge of publicatie. Een taalmodel is optioneel en alleen een begrensde plannings- of taakadapter; de agent-loop zelf is eigen EAIwork-code.

Deze notitie verandert de huidige lokale uitvoering niet en introduceert geen publieke API.
