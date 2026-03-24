## Progetto

Il progetto prevede di creare workflow che performi questi step:
- scraping su telegram tra una lista di profili configurabili dell'ultimo post pubblicato relativo ad un tema pre-stabilito
Esempio: su questi canali, cerca l'ultimo post che parla di calcio, o che parla di basket;

- una volta collezionati n post, questi vengono dati in pasto ad un LLM con un prompt preciso, e l'agente sputa fuori un altro post costruito in similitudine ai post che ha ricevuto
Esempio: collezioni n posti di betting sulla decima giornata di campionato italiano, tiro fuori un post di betting sulla decima giornata di campionato italiano, costruito sulla base dei post visti

- il post generato, viene poi pubblicato su un profilo instagram dedicato.

## Fasi del progetto

### Step 1: Definizione architettura

Capire anzitutto e in modo chiaro la migliore architettura per realizzare il desiderata.
Alcuni opzioni possibili potrebbero essere:
- utilizzo di una skill che definisca il workflow (nodi) del processo, e orchestri ad alto livello il processo
- utilizzo di LangChain o LangGraph, definendo nodi, workflow, ecc ecc
- utilizzo di N8N
- altre ipotesi

Si chiede quindi inizalmente di discutere delle possibili architetture, capire quale potrebbe essere la migliore per ottenere il risultato richiesto

### Step 2: MVP

Una volta definita l'architettura, l'obbiettivo è creare non un prodotto finito inizialmente ma un MVP.
L'MVP passa per diverse release incrementali, quali:

1. Definizione nodo LLM: i post vengono hardcodati in N cartelle (una per sample). Ogni cartella contiene:
   - **1 o più immagini** (screenshot di schedine scommesse con partite, quote, marcatori, ecc.)
   - **1 file di testo** (testo promozionale/accattivante che accompagna l'immagine nel post Telegram)
   
   L'obiettivo è creare un Agente/Prompt che, dati questi post multimediali:
   - **Analizzi le immagini** delle schedine tramite vision (GPT-4o) per estrarre le scommesse proposte
   - **Generi in uscita una nuova schedina ottimizzata** (immagine) combinando e ottimizzando le scommesse delle schedine in ingresso
   - **Generi un testo accattivante** in similitudine con i testi ricevuti in ingresso, che invoglia a giocare
   
   Il post generato (immagine + testo) viene salvato in una cartella output per essere rivisto dal developer.

2. ✅ **[COMPLETATA]** I post non vengono più hardcodati. È stato definito un nodo `scraper` che, dati N canali Telegram configurati in `channels.yaml`, preleva gli ultimi 5 post per canale (immagine + testo) tramite GramJS (Telegram Client API). Ogni post viene filtrato da GPT-4o tramite un prompt dedicato (`telegram-filter.md`) che verifica:
   - se il post riguarda il **calcio italiano** (Serie A, Serie B, Coppa Italia, Nazionale)
   - se l'evento è ancora **attivo** (non concluso)
   
   Solo i post rilevanti vengono passati al nodo LLM. Se nessun post supera il filtro, il workflow si ferma con un log.

3. Il post generato dalla AI verrà salvato su un profilo instagram predefinito, o in alternativa su un foglio di lavoro sul cloud.
