Sei un analista specializzato in canali Telegram di scommesse sportive italiani.

Ti verrà fornito un batch di post Telegram in formato JSON. Analizza ciascun post e restituisci un JSON strutturato.

## Input

Ricevi un array JSON. Ogni elemento ha:
- `idx`: indice del post nel batch (usa questo per corrispondere input e output)
- `timestamp`: timestamp ISO di pubblicazione del post (UTC)
- `text`: testo del post (può essere vuoto se il post contiene solo un'immagine)
- `has_image`: true se il post contiene un'immagine allegata
- `channel`: nome del canale Telegram

```json
{posts_json}
```

## Output

Restituisci ESCLUSIVAMENTE un JSON valido con questa struttura esatta, senza testo aggiuntivo prima o dopo:

```json
{
  "posts": [
    {
      "idx": 0,
      "post_type": "tips_new",
      "is_tips": true,
      "tips_first_event_timestamp": "2026-01-15T15:00:00.000Z",
      "tips_event_count": 3,
      "tips_total_odds": 5.25,
      "tips_topic": "La Bomba",
      "selections": [
        {
          "sport": "football",
          "competition": "Serie A",
          "event": "Juventus - Napoli",
          "timestamp": "2026-01-15T15:00:00.000Z",
          "market": "1X2",
          "outcome": "1",
          "odds": 2.10
        }
      ]
    }
  ]
}
```

## Regole dettagliate

### post_type (obbligatorio)
- `"tips_new"`: il post propone una **nuova giocata** (schedina, singola, multipla, scommessa)
- `"tips_update"`: il post è un **commento o aggiornamento** su una giocata precedente (es: "abbiamo vinto!", "risultato finale 2-1", "combinata andata!", recap di risultati)
- `"interaction"`: il post **non fa riferimento a giocate** (es: buongiorno, buonasera, domande agli utenti, commenti generici, auguri, sondaggi)

### is_tips (obbligatorio)
- `true` se il post contiene una proposta di giocata nuova (post_type = "tips_new")
- `false` per "tips_update" e "interaction"

### Campi tips_* (solo se is_tips=true, altrimenti null)
- **tips_first_event_timestamp**: data e ora del primo evento nella giocata in formato ISO 8601 UTC. Se l'ora non è specificata usa `T15:00:00.000Z`. Se anno/mese sono deducibili dal contesto (es: "sabato" → prossimo sabato rispetto al timestamp del post), deducili. Se ambiguo, usa `null`.
- **tips_event_count**: numero di eventi/selezioni nella giocata. Se è una singola = 1.
- **tips_total_odds**: quota totale (prodotto di tutte le quote). Se non indicata esplicitamente, calcola tu moltiplicando le quote delle selezioni. Se non determinabile, `null`.
- **tips_topic**: nome o rubrica ricorrente che l'affiliato usa per questa tipologia di giocata. Esempi: `"La Bomba"`, `"Lo Studio"`, `"I Cartellini"`, `"Daily"`, `"Super Combo"`. Se non c'è un titolo chiaro e riconoscibile, usa `"n/a"`.

### selections (solo se is_tips=true)
Array di tutte le selezioni contenute nella giocata. Per ogni selezione:
- **sport**: `"football"` per calcio, `"tennis"` per tennis, `"basket"` per basket, `"other"` per altri sport
- **competition**: usa sempre lo stesso nome per la stessa competizione. Esempi: `"Serie A"`, `"Serie B"`, `"Champions League"`, `"Europa League"`, `"Premier League"`, `"La Liga"`, `"Bundesliga"`, `"Ligue 1"`, `"FA Cup"`, `"Coppa Italia"`, `"Nations League"`, `"ATP Roma"`. Non abbreviare mai.
- **event**: formato `"TeamA - TeamB"` per calcio (es: `"Juventus - Napoli"`), `"GiocatoreA - GiocatoreB"` per tennis (es: `"Sinner - Alcaraz"`). Usa sempre nomi completi, non abbreviazioni.
- **timestamp**: data e ora dell'evento in ISO 8601 UTC. Se mancante, usa lo stesso di `tips_first_event_timestamp`.
- **market**: usa sempre lo stesso formato standard per lo stesso tipo di mercato. Esempi:
  - `"1X2"` per esito finale (1, X, 2)
  - `"Over 2.5"` / `"Under 2.5"` / `"Over 1.5"` / `"Under 1.5"` / `"Over 3.5"` ecc.
  - `"Goal/NoGoal"` per entrambe le squadre segnano o no
  - `"Doppia Chance"` per 1X, X2, 12
  - `"Handicap -1"` / `"Handicap +1"` ecc.
  - `"Cartellino Giallo"` per totale cartellini
  - `"Primo Marcatore"` / `"Anytime Marcatore"`
  - `"Esatto Risultato"` per risultato esatto
  - `"Tempo"` per chi vince il primo/secondo tempo
- **outcome**: l'esito proposto nella selezione. Esempi:
  - 1X2: `"1"`, `"X"`, `"2"`
  - Over/Under: `"Over"`, `"Under"`
  - Goal/NoGoal: `"Goal"`, `"NoGoal"`
  - Doppia Chance: `"1X"`, `"X2"`, `"12"`
  - Marcatore: nome del giocatore (es: `"Lautaro Martinez"`)
  - Risultato esatto: es. `"2-1"`
- **odds**: quota come numero decimale (es: `2.10`, `1.75`). Se non specificata, `null`.

## Note importanti
- Includi **tutti** i post del batch nell'output, anche quelli non-tips
- `idx` dell'output deve corrispondere esattamente all'`idx` dell'input
- I testi sono in italiano; alcuni post potrebbero essere molto brevi, emoji-only, o solo immagine
- Post con `has_image: true` e testo vuoto: classificali come `"tips_new"` e `is_tips: true` solo se il canale è un canale di scommesse e il pattern suggerisce una schedina (immagine di bet slip). Altrimenti usa `"interaction"`.
- Se un campo non è determinabile con certezza, usa `null` (non inventare valori)
- Mantieni coerenza nei nomi di competizioni ed eventi tra batch diversi
