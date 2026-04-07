# Deploy — Guida al deploy su VPS

Guida per mettere ClutchBet in produzione su un VPS (DigitalOcean, Hetzner, o qualsiasi server Linux).

## Architettura di processo

ClutchBet usa **un processo pm2 indipendente per ogni profilo**. Ogni processo gestisce autonomamente il ciclo completo del suo profilo: generazione contenuti, pubblicazione schedulata, monitoraggio risultati.

```
pm2 start ecosystem.config.cjs
  ├─ il-capitano   (--profile=config/profiles/il-capitano.yaml)
  ├─ il-mago       (--profile=config/profiles/il-mago.yaml)
  └─ ...           (auto-discovered da config/profiles/*.yaml)
```

Ogni processo pm2:
- È **completamente isolato** dagli altri
- Può essere stoppato/riavviato singolarmente senza intaccare gli altri
- Ha i propri log separati
- Gestisce il proprio watcher dei risultati come child process

### Ciclo giornaliero (per profilo)

```
┌─────────────────────────────────────────────────────────────┐
│  pm2: il-capitano                                           │
│  daemon.ts --profile=config/profiles/il-capitano.yaml       │
└─────────────────────────────────────────────────────────────┘
         │
         │  All'avvio:
         │  1. Controlla se ci sono post non pubblicati da oggi
         │     → Se sì: riprende la pubblicazione (resume con await)
         │     → Scade i contenuti dei giorni precedenti
         │  2. Registra un cron job giornaliero (default: 08:00)
         │  3. Resta in attesa
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  CRON: ogni giorno alle 08:00 (configurabile)               │
│                                                             │
│  1. CONTENT GENERATION                                      │
│     Scheduler → Data Fetcher → Content Writer → Publisher   │
│     I post vengono salvati nel DB (content_queue) PRIMA     │
│     della pubblicazione → sopravvivono a crash/restart      │
│     Le scommesse vengono salvate nel DB SQLite              │
│                                                             │
│  2. RESULTS WATCHER (avviato 5 min dopo)                    │
│     Polling ogni ora su API-Football                        │
│     Quando le partite finiscono:                            │
│     → Valuta le scommesse (vinta/persa)                     │
│     → Genera un post di recap con LLM                       │
│     → Pubblica su Telegram                                  │
│                                                             │
│  Il giorno dopo alle 08:00 → ripete tutto                   │
└─────────────────────────────────────────────────────────────┘
```

### Giornata tipo

| Orario | Azione |
|---|---|
| 08:00 | Cron scatta → content generation |
| 08:02 | Scheduler decide quali rubriche generare oggi |
| 08:03 | Data Fetcher scarica partite + quote da API-Football |
| 08:04 | Content Writer genera i post con LLM + immagini AI |
| 08:05 | Publisher pubblica (o attende gli orari definiti nel profilo) |
| 14:30 | Pubblica "Giocata del Giorno" (esempio) |
| 15:00 | Pubblica "Cartellino Tattico" (esempio) |
| 08:10 | Results Watcher avviato — schedula i check per ogni partita |
| ~22:15 | Partite finite → valuta scommesse → genera e pubblica recap |
| 08:00 domani | Ripete tutto da capo |

## Prerequisiti sul VPS

- **OS**: Ubuntu 22.04+ / Debian 12+ (consigliato)
- **RAM**: minimo 1 GB (2 GB consigliati per Puppeteer)
- **Node.js**: 18 o superiore
- **pm2**: process manager per tenere vivo il daemon (`npm install -g pm2`)

> **Nota Windows**: per test in locale su Windows, gli stessi comandi pm2 funzionano. Il file `ecosystem.config.cjs` risolve le incompatibilità tra pm2 e gli script `.CMD` di Windows (npm/npx).

## Setup passo per passo

### 1. Connettiti al VPS

```bash
ssh utente@indirizzo-ip-del-vps
```

### 2. Installa Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo bash -
sudo apt install -y nodejs
```

Verifica:
```bash
node --version   # v18.x.x o superiore
npm --version    # 9.x.x o superiore
```

### 3. Installa pm2

```bash
npm install -g pm2
```

### 4. Clona il progetto

```bash
git clone https://github.com/elgui1886/ClutchBet.git
cd ClutchBet
```

### 5. Installa le dipendenze

```bash
npm install
```

> **Nota su Puppeteer**: su server Linux servono le librerie di sistema per Chrome headless.
> Senza queste, Puppeteer fallirà con errori tipo `libnspr4.so: cannot open shared object file`.
> ```bash
> sudo apt update && sudo apt install -y \
>   libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
>   libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
>   libxdamage1 libxrandr2 libgbm1 libpango-1.0-0 \
>   libcairo2 libasound2 libxshmfence1 fonts-liberation
> ```

### 6. Configura le variabili d'ambiente

Crea il file `.env` nella root del progetto con le stesse chiavi che usi in locale:

```bash
nano .env
```

Contenuto:
```env
TELEGRAM_API_ID=tuo_api_id
TELEGRAM_API_HASH=tuo_api_hash
TELEGRAM_SESSION=tua_stringa_di_sessione

OPENAI_API_KEY=tua_chiave_openai

FOOTBALL_API_KEY=tua_chiave_api_football

# Opzionale: orario del cron (default: 08:00 ogni giorno)
# Formato: cron standard (minuto ora giorno mese giorno_settimana)
# DAEMON_CONTENT_CRON=0 8 * * *
```

### 7. Verifica che i profili siano configurati

```bash
ls config/profiles/
# Deve contenere almeno un file .yaml (es. il-capitano.yaml)

# Verifica che il profilo abbia la sezione config:
grep -A5 'config:' config/profiles/il-capitano.yaml
# Deve mostrare: publishChannel, league, ecc.
```

### 8. Test manuale (opzionale)

Prima di attivare il daemon, puoi testare singolarmente:

```bash
# Testa la generazione contenuti
npm run content -- --profile=config/profiles/il-capitano.yaml

# Testa il watcher
npm run watch-results -- --profile=config/profiles/il-capitano.yaml
```

### 9. Avvia i daemon con pm2

```bash
pm2 start ecosystem.config.cjs
```

Il file `ecosystem.config.cjs` auto-scopre tutti i profili YAML in `config/profiles/` e crea un processo pm2 separato per ciascuno. Ogni processo ha il nome del profilo (es. `il-capitano`).

Verifica che siano in esecuzione:
```bash
pm2 status
```

Output atteso:
```
┌──────────────┬────┬──────┬───────┬────────┬─────┬──────────┐
│ Name         │ id │ mode │ pid   │ status │ cpu │ memory   │
├──────────────┼────┼──────┼───────┼────────┼─────┼──────────┤
│ il-capitano  │ 0  │ fork │ 12345 │ online │ 0%  │ 50.0mb  │
│ il-mago      │ 1  │ fork │ 12346 │ online │ 0%  │ 48.0mb  │
└──────────────┴────┴──────┴───────┴────────┴─────┴──────────┘
```

### 10. Configura auto-start al reboot

```bash
pm2 startup
```

Questo comando stampa un'istruzione. **Copiala e incollala nel terminale** (sarà qualcosa come `sudo env PATH=... pm2 startup systemd ...`).

Poi salva la configurazione:
```bash
pm2 save
```

Da questo momento, se il server si riavvia, pm2 rilancia automaticamente il daemon.

## Gestione del daemon

### Comandi pm2

| Comando | Cosa fa |
|---|---|
| `pm2 logs il-capitano` | Mostra i log in tempo reale per un profilo |
| `pm2 logs il-capitano --lines 100` | Mostra le ultime 100 righe di log |
| `pm2 stop il-capitano` | Ferma un singolo profilo (gli altri continuano) |
| `pm2 start il-capitano` | Riavvia un singolo profilo |
| `pm2 restart il-capitano` | Stop + start di un singolo profilo |
| `pm2 delete il-capitano` | Rimuove un profilo da pm2 |
| `pm2 status` | Stato di tutti i processi |
| `pm2 monit` | Monitoring interattivo (CPU, RAM, log) |
| `pm2 start ecosystem.config.cjs` | Registra/avvia tutti i profili |
| `pm2 start ecosystem.config.cjs --only il-mago` | Registra/avvia un solo profilo |

### Restart e persistenza

**Il restart è sicuro**. I contenuti generati vengono salvati nel database (`content_queue`) prima della pubblicazione. Al riavvio:

- I post già pubblicati non vengono ripubblicati
- I post in attesa (es. schedulati per il pomeriggio) vengono ripresi automaticamente
- I contenuti dei giorni precedenti vengono scaduti (non verranno mai ripubblicati)
- Le scommesse tracciate (tabella `bets`) non vengono perse — il watcher le rischedula

```bash
# Restart sicuro — riprende da dove era rimasto
pm2 restart il-capitano
```

### Aggiornare il codice

```bash
cd ClutchBet
git pull
npm install          # se ci sono nuove dipendenze
pm2 restart all      # riavvia tutti i profili
# oppure: pm2 restart il-capitano   # riavvia solo uno specifico
```

### Run immediato per test

Il daemon supporta il flag `--now` per triggerare un run immediato (utile per testare):

```bash
# In locale: avvia il daemon per un profilo E lancia subito il ciclo giornaliero
npx tsx src/daemon.ts --profile=config/profiles/il-capitano.yaml --now

# Con pm2: ferma, lancia il test, poi riavvia normalmente
pm2 stop il-capitano
npx tsx src/daemon.ts --profile=config/profiles/il-capitano.yaml --now    # Ctrl+C quando finisce
pm2 start il-capitano
```

## Configurazione avanzata

### Cambiare l'orario del cron

Modifica la variabile d'ambiente `DAEMON_CONTENT_CRON` nel `.env`:

```env
# Ogni giorno alle 09:30
DAEMON_CONTENT_CRON=30 9 * * *

# Solo giorni feriali alle 08:00
DAEMON_CONTENT_CRON=0 8 * * 1-5

# Ogni giorno alle 07:00 e alle 14:00
DAEMON_CONTENT_CRON=0 7,14 * * *
```

Dopo la modifica:
```bash
pm2 restart all    # o un profilo specifico: pm2 restart il-capitano
```

### Aggiungere un nuovo profilo

1. Crea il profilo Markdown
2. Parsalo: `npm run parse-profile -- output/profiles/nuovo-profilo.md`
3. Il file YAML viene salvato in `config/profiles/nuovo-profilo.yaml`
4. Configura la sezione `config:` nel YAML (publishChannel, league, ecc.)
5. Registra il nuovo profilo in pm2: `pm2 start ecosystem.config.cjs --only nuovo-profilo`
6. Gli altri processi pm2 non vengono toccati

### Timezone

Il cron usa il timezone `Europe/Rome` (hardcoded nel daemon). Le ore nel cron sono quindi in orario italiano.

## Troubleshooting

### Il daemon non posta

1. Controlla i log: `pm2 logs il-capitano`
2. Verifica che `reviewBeforePublish: false` nella sezione `config:` del profilo YAML
3. Verifica che `publishChannel` sia configurato nella sezione `config:` del profilo YAML
4. Verifica che `FOOTBALL_API_KEY` sia nel `.env` (senza: usa dati fittizi)

### Puppeteer non funziona sul server

```bash
# Installa le dipendenze di Chrome
sudo apt install -y ca-certificates fonts-liberation libasound2 \
  libatk-bridge2.0-0 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
  libexpat1 libfontconfig1 libgbm1 libgcc1 libglib2.0-0 libgtk-3-0 \
  libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
  libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
  lsb-release wget xdg-utils
```

### Il watcher non verifica i risultati

1. Controlla che `FOOTBALL_API_KEY` sia configurata
2. Verifica che ci siano scommesse pendenti: controlla il database `data/clutchbet.db`
3. Il watcher si avvia 5 minuti dopo la generazione contenuti

### Errore "No profiles found"

```bash
ls config/profiles/
# Se vuoto, genera un profilo:
npm run parse-profile -- output/profiles/il-capitano.md
```
