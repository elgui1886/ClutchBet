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

1. Definizione nodo LLM: i post vengono arcodati in 4/5 file di testo. L'obbiettivo qui è creare un Agente/Prompt che, dati questi post, ne crei uno in uscita in similitudine con quelli ricevuti in ingresso. Il post generato viene salvato in un file md per essere letto dal developer

2. I post non verranno più harcodati, ma si definirà un nodo che, dati n canali telegram, vada a pescarli da li e, una volta pescati, li passi in ingresso al nodo definito allo step 1

3. Il posto generato dalla AI verrà salvato su un profilo instagram predefinito, o in alternativa su un foglio di lavoro sul cloud.
