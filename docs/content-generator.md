# Content Generator — Guida Operativa

Guida pratica per configurare e utilizzare il workflow di generazione automatica di contenuti editoriali per un canale Telegram di scommesse sportive.

## Prerequisiti

1. **Node.js** ≥ 18
2. **Dipendenze installate**: `npm install`
3. **Build compilata**: `npm run build`
4. **Variabili d'ambiente** nel file `.env`:

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `TELEGRAM_API_ID` | Sì | API ID da my.telegram.org |
| `TELEGRAM_API_HASH` | Sì | API Hash da my.telegram.org |
| `TELEGRAM_SESSION` | Sì | Stringa di sessione (genera con `npm run setup-telegram`) |
| `OPENAI_API_KEY` | Sì | Chiave API OpenAI per la generazione dei contenuti |
| `FOOTBALL_API_KEY` | No | Chiave API-Football (api-sports.io). Senza chiave: mock fixtures per sviluppo |

## Setup iniziale (una tantum)

### 1. Sessione Telegram

Se non hai ancora configurato la sessione Telegram:

```bash
npm run setup-telegram
```

Segui le istruzioni per autenticarti e salva la stringa di sessione nel `.env`.

### 2. Creare il profilo YAML da un file Markdown

Parti da un profilo editoriale in formato Markdown (es. `output/profiles/il-capitano.md`) e convertilo in YAML strutturato:

```bash
npm run parse-profile -- output/profiles/il-capitano.md
```

Questo comando:

- Legge il file Markdown
- Lo invia all'LLM con il prompt `prompts/profile-parser.md`
- Genera un file YAML in `config/profiles/<nome>.yaml`
- Il YAML contiene: tono di voce, rubriche con template e orari di pubblicazione, regole di scheduling, principi di gestione delle perdite

> **Nota**: questo va fatto una sola volta per profilo. Il YAML risultante può essere modificato manualmente.

### 3. Configurare il profilo YAML

Dopo il parse, verifica e personalizza il file `config/profiles/<nome>.yaml`. In fondo al file troverai la sezione `config:` con le impostazioni di pubblicazione:

```yaml
config:
  publishChannel: "https://t.me/nomedelcanale"   # canale Telegram
  reviewBeforePublish: false                      # true = approvazione manuale per ogni post
  league:
    id: 135          # Serie A (vedi documentazione API-Football per altri campionati)
    season: 2025
    country: "Italy"
```

Ogni profilo è autosufficiente: contiene tono di voce, rubriche, scheduling, E la configurazione di pubblicazione. Non serve un file di configurazione separato.

## Flusso giornaliero

### Generare i contenuti del giorno

```bash
npm run content -- --profile=config/profiles/il-capitano.yaml
```

Il workflow esegue nell'ordine:

1. **Scheduler** — Determina quali rubriche generare in base al giorno della settimana e alle regole del profilo
2. **Data Fetcher** — Recupera le partite del giorno e le quote reali da API-Football. Se non ci sono partite, rimuove le rubriche che dipendono da dati live
3. **Content Writer** — Genera un post per ogni rubrica usando l'LLM, rispettando tono, template e quote reali. Estrae le scommesse strutturate dal testo generato (per il tracking)
4. **Reviewer** — Mostra ogni post in console. L'operatore può:
   - `s` = approva
   - `n` = rifiuta
   - `e` = modifica (incolla testo corretto)
5. **Publisher** — Pubblica i post approvati su Telegram **rispettando gli orari di pubblicazione** definiti nel profilo. Se l'orario non è ancora arrivato, il processo attende. Le scommesse contenute nei post vengono salvate nel database SQLite (`data/clutchbet.db`) per il tracking

### Verificare i risultati delle scommesse

```bash
npm run check-results -- --profile=config/profiles/il-capitano.yaml
```

Questo comando:

1. Legge le scommesse pendenti dal database SQLite (`data/clutchbet.db`)
2. Interroga API-Football per i risultati delle partite (solo quelle terminate)
3. Valuta ogni scommessa: 1X2, Doppia Chance, Over/Under, Goal/NoGoal, Multigol
4. Genera un post di recap tramite LLM, usando il tono del profilo e i principi di gestione delle perdite
5. Mostra il recap per approvazione umana
6. Pubblica su Telegram

> Va lanciato dopo che le partite si sono concluse. Può essere eseguito più volte — elabora solo le scommesse non ancora verificate.

### Monitoraggio automatico dei risultati

```bash
npm run watch-results -- --profile=config/profiles/il-capitano.yaml
```

Alternativa a `check-results` per un uso hands-off:

- Avviare prima del fischio d'inizio
- Esegue polling ogni ora su API-Football
- Quando le partite terminano, valuta le scommesse, genera il recap e pubblica
- Retry automatico (max 3 tentativi, 30 minuti tra un tentativo e l'altro)
- Si ferma quando tutte le scommesse pendenti sono state risolte

## Schema riassuntivo

```
┌─────────────────────────────────────────────────────────────┐
│  SETUP (una tantum)                                         │
│                                                             │
│  1. npm run setup-telegram         → sessione Telegram      │
│  2. npm run parse-profile -- X.md  → config/profiles/X.yaml │
│  3. Configurare config: nel profilo YAML                     │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  QUOTIDIANO                                                 │
│                                                             │
│  4. npm run content --profile=X    → genera + pubblica post │
│     (mattina/pomeriggio, prima degli orari di pubblicazione)│
│                                                             │
│  5a. npm run check-results --profile=X  → verifica + recap  │
│      (sera, dopo le partite — one-shot)                     │
│                                                             │
│  5b. npm run watch-results --profile=X  → verifica + recap  │
│      (alternativa: daemon con polling automatico)            │
└─────────────────────────────────────────────────────────────┘
```
```

## Struttura dei file generati

| Percorso | Contenuto |
|---|---|
| `config/profiles/<nome>.yaml` | Profilo editoriale strutturato + config pubblicazione |
| `data/clutchbet.db` | Database SQLite (scommesse, risultati, analytics) |
| `data/content-history/<profilo>_<format>.json` | Storico topic per deduplicazione |

## Reset

Per ripartire da zero (svuota DB + content-history):

```bash
npm run reset
```

## Note operative

- **Orari di pubblicazione**: il publisher attende automaticamente l'orario definito nel profilo per ogni rubrica. Lanciare `npm run content` con anticipo
- **Senza API-Football**: il sistema funziona in modalità mock con partite e quote fittizie. Utile per test e sviluppo
- **Free tier API-Football**: 100 richieste/giorno, sufficiente per uso singolo canale
- **Modifiche al profilo**: modificare direttamente il file YAML in `config/profiles/`. Non serve rieseguire il parse
- **Bet tracking**: le scommesse vengono tracciate solo per i post che contengono effettivamente pronostici (il content-writer li estrae automaticamente)
