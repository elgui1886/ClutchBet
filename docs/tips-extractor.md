# Tips Extractor

Tool che scarica i post storici di un canale Telegram di scommesse sportive, li classifica tramite LLM e salva i dati strutturati in un database SQLite.

---

## Come si usa

```bash
npm run tips-extractor
```

Il canale da analizzare e il numero di post per run si configurano in `config/analysis.yaml`:

```yaml
channel: "https://web.telegram.org/k/#-1013023602"
post_limit: 100
```

**Formati accettati per `channel`:**
- URL Telegram Web: `https://web.telegram.org/k/#-1001259302052`
- Link t.me: `https://t.me/channelname`
- Username: `@channelname`
- ID numerico: `1259302052`

---

## Come funziona

Il tool è implementato come grafo LangGraph a 3 nodi:

```
__start__
    │
history_scraper          ← scraping Telegram via GramJS
    │
    ├─ (nessun post) ──► __end__
    │
post_analyzer            ← classificazione LLM in batch da 15
    │
db_writer                ── salvataggio su SQLite
    │
__end__
```

### 1. `history_scraper`

Legge `MIN(telegram_msg_id)` dal DB per il canale corrente:
- **Prima run**: il valore è 0 → scarica i 100 post più recenti
- **Run successive**: usa il msg_id più vecchio già in DB come punto di partenza e va ulteriormente indietro nella storia

Questo permette di costruire la storia del canale incrementalmente senza re-scaricare post già processati.

### 2. `post_analyzer`

Invia i post all'LLM (configurato via `OPENAI_MODEL` nel `.env`) in batch da 15, usando il prompt in `prompts/tips-extractor.md`.

Per ogni post classifica:
- **`post_type`**: `tips_new` | `tips_update` | `interaction`
- **`is_tips`**: `true` solo per `tips_new`
- Metadati della giocata: timestamp primo evento, numero selezioni, quota totale, rubrica (es. "La Bomba")
- Lista delle selezioni singole (sport, competizione, evento, mercato, esito, quota)

In caso di errore su un batch, inserisce post placeholder di tipo `interaction` per mantenere la corrispondenza degli indici.

### 3. `db_writer`

Salva i dati in `data/tips-analysis.db`. La strategia è **per-canale**:
- Cancella i post già presenti per quel canale (identificato dal titolo del canale)
- Reinserisce tutto con `INSERT OR IGNORE` + indice univoco `(post_affiliate_name, telegram_msg_id)`
- I dati di altri canali nello stesso DB non vengono mai toccati

---

## Database: `data/tips-analysis.db`

### Tabella `post_db`

Ogni riga è un post Telegram analizzato.

| Colonna | Tipo | Descrizione |
|---|---|---|
| `post_id` | INTEGER PK | ID numerico globale progressivo |
| `telegram_msg_id` | INTEGER | ID nativo del messaggio Telegram |
| `post_affiliate_name` | TEXT | Titolo del canale Telegram (chiave di raggruppamento) |
| `post_publication_timestamp` | TEXT | Data/ora di pubblicazione (ISO 8601 UTC) |
| `post_type` | TEXT | `tips_new`, `tips_update` o `interaction` |
| `is_tips` | INTEGER | `1` se è una giocata nuova, `0` altrimenti |
| `post_text` | TEXT | Testo completo del post |
| `post_image` | INTEGER | `1` se il post contiene un'immagine |
| `tips_first_event_timestamp` | TEXT | Data/ora del primo evento (solo per `is_tips=1`) |
| `tips_distance_timestamp` | TEXT | Differenza in `HH:MM` tra pubblicazione e primo evento |
| `tips_event_count` | INTEGER | Numero di selezioni nella giocata |
| `tips_total_odds` | REAL | Quota totale della giocata |
| `tips_topic` | TEXT | Rubrica del canale (es. "La Bomba", "Daily") |

**Indice univoco:** `(post_affiliate_name, telegram_msg_id)` — garantisce idempotenza sui re-run.

---

### Tabella `selections_db`

Ogni riga è una singola selezione all'interno di una giocata. Una giocata (post) può avere N selezioni.

| Colonna | Tipo | Descrizione |
|---|---|---|
| `post_id` | INTEGER FK | Riferimento a `post_db.post_id` |
| `selections_id` | TEXT PK | ID univoco a 6 caratteri (alfabeto italiano: no J,K,W,X,Y) |
| `selections_sport` | TEXT | `football`, `tennis`, `basket`, `other` |
| `selections_competition` | TEXT | Nome completo della competizione (es. `Serie A`) |
| `selections_event` | TEXT | `TeamA - TeamB` (calcio) o `GiocA - GiocB` (tennis) |
| `selections_timestamp` | TEXT | Data/ora dell'evento (ISO 8601 UTC) |
| `selections_market` | TEXT | Mercato scommessa (es. `1X2`, `Over 2.5`, `Goal/NoGoal`) |
| `selections_outcome` | TEXT | Esito selezionato (es. `1`, `X`, `2`, `Over`) |
| `selections_odds` | REAL | Quota della selezione |

---

## Configurazione ambiente

| Variabile | Obbligatoria | Descrizione |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | GitHub Personal Access Token (`ghp_...`) |
| `OPENAI_BASE_URL` | ✅ | `https://models.github.ai` |
| `OPENAI_MODEL` | No | Modello LLM (default: `gpt-4o`). Consigliato: `gpt-4.1` |
| `TELEGRAM_API_ID` | ✅ | Ottenuto da [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_API_HASH` | ✅ | Ottenuto da [my.telegram.org](https://my.telegram.org) |
| `TELEGRAM_SESSION` | ✅ | Stringa di sessione generata da `npm run setup-telegram` |

Per rigenerare la sessione Telegram (se scaduta):

```bash
npm run setup-telegram
```

---

## Struttura dei file

```
src/tips-extractor/
├── index.ts              # Entry point: legge config e avvia il grafo
├── state.ts              # Definizione dello stato LangGraph + tipi
├── graph.ts              # Composizione del grafo a 3 nodi
└── nodes/
    ├── history-scraper.ts  # Scraping Telegram con paginazione incrementale
    ├── post-analyzer.ts    # Classificazione LLM in batch
    └── db-writer.ts        # Persistenza su SQLite

src/shared/
└── channel-scraper.ts    # Funzione scrapeChannelPage() condivisa

prompts/
└── tips-extractor.md     # Prompt LLM per classificazione post

config/
└── analysis.yaml         # channel e post_limit

data/
└── tips-analysis.db      # Database SQLite (generato automaticamente)
```

---

## Strategia di paginazione

Ogni run processa `post_limit` post alla volta, andando **indietro nel tempo**:

| Run | Comportamento |
|---|---|
| Run 1 (DB vuoto) | Fetcha i 100 post più recenti |
| Run 2 | Fetcha i 100 post prima del più vecchio già salvato |
| Run 3 | Fetcha i 100 post ancora più indietro |
| ... | Continua finché non ci sono più post |

Quando il canale è esaurito, il tool stampa `✅ No older posts found — channel history fully scraped.` e termina senza scrivere nulla.

---

## Multi-canale

Il DB supporta più canali nella stessa istanza. Ogni canale è identificato dal suo titolo (`post_affiliate_name`). I `post_id` sono globalmente univoci (basati su `MAX(post_id)+1`), mentre i `selections_id` sono codici a 6 caratteri senza collisioni garantite da un set in memoria durante la scrittura.
