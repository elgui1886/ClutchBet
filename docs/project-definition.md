## Progetto

Il progetto contiene **due workflow LangGraph** all'interno di una singola codebase:

### Workflow 1: Generation
Workflow automatizzato che:
- Fa scraping su Telegram tra una lista di canali configurabili degli ultimi post pubblicati relativi a un tema pre-stabilito
- Filtra i post per attinenza (calcio italiano, eventi attivi) tramite GPT-4o
- I post filtrati vengono dati in pasto a un LLM che genera un nuovo post (immagine + testo) costruito in similitudine
- Il post generato viene pubblicato su un canale Telegram dedicato

### Workflow 2: Analysis
Tool one-off per l'analisi di un singolo canale Telegram:
- Legge lo storico di un canale su un arco temporale configurabile (es. 3-4 mesi)
- Analizza i post tramite GPT-4o con strategia a chunk (batch analysis → meta-analysis)
- Produce un documento Markdown con: tone of voice, piano editoriale, pattern ricorrenti, frequenza di pubblicazione, stile dei contenuti

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
