## Progetto

Il progetto contiene **tre workflow LangGraph** più utility commands all'interno di una singola codebase. Architettura: **TypeScript + LangGraph.js**.

| Workflow / Comando | Descrizione | Comando |
|---|---|---|
| **Generation** | Scraping Telegram → LLM genera post simili → pubblica | `npm run generation` |
| **Analysis** | Analisi storica di un canale Telegram → report MD | `npm run analysis` |
| **Content Generator** | Pipeline editoriale: profilo → dati reali → post → review → pubblica | `npm run content` |
| **Check Results** | Verifica risultati scommesse → genera recap | `npm run check-results` |
| **Watch Results** | Daemon che fa polling automatico dei risultati | `npm run watch-results` |
| **Parse Profile** | Converte profilo MD → YAML strutturato | `npm run parse-profile` |

> Per i dettagli architetturali, tech stack e diagrammi dei grafi, vedi `architecture.md`. Per la struttura dei file, vedi `project-structure.md`.

## Fasi del progetto

### Step 1: Definizione architettura

Capire anzitutto e in modo chiaro la migliore architettura per realizzare il desiderata.
Architettura scelta: **TypeScript + LangGraph.js** (vedi `architecture.md` per i dettagli).

### Step 2: MVP — Generation Workflow

1. ✅ **[COMPLETATA]** — Definizione nodo LLM: post hardcodati in N cartelle (una per sample). Ogni cartella contiene immagini + file di testo. L'Agente:
   - Analizza le immagini delle schedine tramite vision (GPT-4o)
   - Genera una nuova schedina ottimizzata (immagine)
   - Genera un testo accattivante

2. ✅ **[COMPLETATA]** — Scraper node: GramJS scraping + GPT-4o filter via `telegram-filter.md`. Solo post su calcio italiano + eventi attivi passano il filtro.

3. ✅ **[COMPLETATA]** — Publisher node: pubblica PNG + caption su Telegram. Gestisce il limite 1024 caratteri con messaggio di follow-up.

### Step 3: Analysis Workflow

4. ✅ **[COMPLETATA]** — Ristrutturazione codebase in 3 cartelle: `src/generation/`, `src/analysis/`, `src/shared/`. CLI dispatcher con `npm run generation` e `npm run analysis`.

5. ✅ **[COMPLETATA]** — History scraper: scarica lo storico di un canale con paginazione (100 msg per batch, 1.5s di pausa tra batch). Solo testo + metadata (no immagini).

6. ✅ **[COMPLETATA]** — Channel analyzer: analisi a chunk con GPT-4o (batch di ~50 post → summary parziali → meta-analisi finale). Produce documento MD strutturato.

7. ✅ **[COMPLETATA]** — Report writer: salva il documento in `output/analysis/<nome-canale>.md`.
   - Se `publishChannel` non è configurato, il passaggio viene saltato con un log

### Step 4: Content Generator Workflow

8. ✅ **[COMPLETATA]** — Profile parser: comando `npm run parse-profile -- <path-to-md>` che converte un profilo Markdown in un file YAML strutturato salvato in `config/profiles/`. Il YAML contiene: identità, tone of voice, format editoriali con template, regole di scheduling, e gestione delle perdite.

9. ✅ **[COMPLETATA]** — Data fetcher: nodo che interroga API-Football (free tier, 100 req/giorno) per ottenere le partite e le quote reali del giorno (Serie A). Include quote 1X2, Over/Under 2.5, Goal/NoGoal. Se `FOOTBALL_API_KEY` non è configurata, restituisce mock fixtures per lo sviluppo.

10. ✅ **[COMPLETATA]** — Scheduler: nodo che, dato il profilo YAML + le fixtures del giorno + il giorno della settimana, decide quali format editoriali generare oggi.

11. ✅ **[COMPLETATA]** — Content writer: nodo LLM che genera il testo di ogni post seguendo rigorosamente il tone of voice del profilo, il template del format, e i dati sportivi reali. Estrae anche le selezioni di scommessa strutturate per il tracking.

12. ✅ **[COMPLETATA]** — Reviewer (human-in-the-loop): nodo che mostra ogni post generato in console e chiede approvazione (sì / no / edit) prima della pubblicazione.

13. ✅ **[COMPLETATA]** — Publisher: nodo che pubblica i post approvati su Telegram a orari configurabili (`publish_time` per ogni format). Salva automaticamente le scommesse nel tracker per la verifica successiva.

14. ✅ **[COMPLETATA]** — Bet tracker: modulo condiviso (`bet-tracker.ts`) che gestisce un database SQLite (`data/clutchbet.db`) con tutte le scommesse pubblicate, **filtrate per profilo**. Supporta: salvataggio, aggiornamento risultati, calcolo statistiche settimanali e per periodo arbitrario (con breakdown per rubrica e tipo di selezione).

15. ✅ **[COMPLETATA]** — Check results: comando `npm run check-results` che verifica i risultati delle scommesse pendenti tramite API-Football, valuta automaticamente ogni selezione (1X2, Over/Under, Goal/NoGoal, Double Chance, Multigol), genera un post recap con LLM nel tono del profilo, e pubblica su Telegram con approvazione.
