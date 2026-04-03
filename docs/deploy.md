# Deploy — Guida al deploy su VPS

Guida per mettere ClutchBet in produzione su un VPS (DigitalOcean, Hetzner, o qualsiasi server Linux).

## Cosa fa il daemon

Il daemon (`npm run daemon`) è un processo Node.js che resta attivo 24/7 e orchestra automaticamente il ciclo giornaliero:

```
┌─────────────────────────────────────────────────────────────────┐
│  npm run daemon                                                 │
│  (processo sempre attivo, gestito da pm2)                       │
└─────────────────────────────────────────────────────────────────┘
         │
         │  All'avvio:
         │  1. Legge tutti i profili da config/profiles/*.yaml
         │  2. Registra un cron job giornaliero (default: 08:00)
         │  3. Controlla se ci sono post non pubblicati da oggi    │
         │     → Se sì: riprende la pubblicazione (resume)        │
         │     → Scade i contenuti dei giorni precedenti          │
         │  4. Resta in attesa                                    │
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  CRON: ogni giorno alle 08:00 (configurabile)                   │
│                                                                 │
│  Per ogni profilo (es. il-capitano.yaml):                       │
│                                                                 │
│    0. CHECK: contenuti già generati oggi?                       │
│       → Sì, tutti pubblicati: skip                              │
│       → Sì, ma alcuni pending: resume (pubblica solo mancanti) │
│       → No: generazione normale (vedi sotto)                    │
│                                                                 │
│    1. CONTENT GENERATION                                        │
│       Scheduler → Data Fetcher → Content Writer → Publisher     │
│       I post vengono salvati nel DB (content_queue) PRIMA       │
│       della pubblicazione → sopravvivono a crash/restart        │
│       Le scommesse vengono salvate nel DB SQLite                │
│                                                                 │
│    2. RESULTS WATCHER (avviato 5 min dopo)                      │
│       Polling ogni ora su API-Football                          │
│       Quando le partite finiscono:                              │
│       → Valuta le scommesse (vinta/persa)                       │
│       → Genera un post di recap con LLM                         │
│       → Pubblica su Telegram                                    │
│                                                                 │
│  Il giorno dopo alle 08:00 → ripete tutto                       │
└─────────────────────────────────────────────────────────────────┘
```

### Giornata tipo

| Orario | Azione |
|---|---|
| 08:00 | Cron scatta → content generation per ogni profilo |
| 08:02 | Scheduler decide quali rubriche generare oggi |
| 08:03 | Data Fetcher scarica partite + quote da API-Football |
| 08:04 | Content Writer genera i post con LLM |
| 08:05 | Publisher pubblica (o attende gli orari definiti nel profilo) |
| 12:00 | Pubblica "Tip del Giorno" (esempio) |
| 18:00 | Pubblica "Multipla Serale" (esempio) |
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

### 9. Avvia il daemon con pm2

```bash
pm2 start ecosystem.config.cjs
```

Questo usa il file `ecosystem.config.cjs` nella root del progetto, che configura pm2 per eseguire il daemon correttamente (senza problemi con `.CMD` su Windows o path su Linux).

Verifica che sia in esecuzione:
```bash
pm2 status
```

Output atteso:
```
┌─────────┬────┬──────┬───────┬────────┬─────┬──────────┐
│ Name    │ id │ mode │ pid   │ status │ cpu │ memory   │
├─────────┼────┼──────┼───────┼────────┼─────┼──────────┤
│ clutchbet│ 0 │ fork │ 12345 │ online │ 0%  │ 50.0mb  │
└─────────┴────┴──────┴───────┴────────┴─────┴──────────┘
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
| `pm2 logs clutchbet` | Mostra i log in tempo reale |
| `pm2 logs clutchbet --lines 100` | Mostra le ultime 100 righe di log |
| `pm2 stop clutchbet` | Ferma il daemon |
| `pm2 start clutchbet` | Riavvia il daemon |
| `pm2 restart clutchbet` | Stop + start |
| `pm2 delete clutchbet` | Rimuove il daemon da pm2 |
| `pm2 status` | Stato di tutti i processi |
| `pm2 monit` | Monitoring interattivo (CPU, RAM, log) |

### Restart e persistenza

**Il restart è sicuro**. I contenuti generati vengono salvati nel database (`content_queue`) prima della pubblicazione. Al riavvio:

- I post già pubblicati non vengono ripubblicati
- I post in attesa (es. schedulati per il pomeriggio) vengono ripresi automaticamente
- I contenuti dei giorni precedenti vengono scaduti (non verranno mai ripubblicati)
- Le scommesse tracciate (tabella `bets`) non vengono perse — il watcher le rischedula

```bash
# Restart sicuro — riprende da dove era rimasto
pm2 restart clutchbet
```

### Aggiornare il codice

```bash
cd ClutchBet
git pull
npm install          # se ci sono nuove dipendenze
pm2 restart clutchbet
```

### Run immediato per test

Il daemon supporta il flag `--now` per triggerare un run immediato (utile per testare):

```bash
# In locale: avvia il daemon E lancia subito il ciclo giornaliero
npm run daemon -- --now

# Con pm2: ferma, lancia il test, poi riavvia normalmente
pm2 stop clutchbet
npm run daemon -- --now    # Ctrl+C quando finisce
pm2 start clutchbet
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
pm2 restart clutchbet
```

### Aggiungere un nuovo profilo

1. Crea il profilo Markdown
2. Parsalo: `npm run parse-profile -- output/profiles/nuovo-profilo.md`
3. Il file YAML viene salvato in `config/profiles/nuovo-profilo.yaml`
4. Configura la sezione `config:` nel YAML (publishChannel, league, ecc.)
5. Riavvia il daemon: `pm2 restart clutchbet`
6. Il daemon lo troverà automaticamente al prossimo ciclo

### Timezone

Il cron usa il timezone `Europe/Rome` (hardcoded nel daemon). Le ore nel cron sono quindi in orario italiano.

## Troubleshooting

### Il daemon non posta

1. Controlla i log: `pm2 logs clutchbet`
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
