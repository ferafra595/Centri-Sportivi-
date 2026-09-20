# Sport Booking Platform

Piattaforma multi-centro per prenotazioni di campi sportivi, pensata per Cloudflare Pages + D1 e GitHub.

## Struttura semplice

```text
sport-booking-platform/
├── index.html
├── schema.sql
├── wrangler.toml
├── README.md
├── assets/
│   ├── app.css
│   └── app.js
└── functions/
    └── api.js
```

## Nuova logica

- `/` = portale pubblico con tutti i centri aderenti.
- `/?center=campizzi` = app personalizzata del singolo centro.
- `/?view=login&type=manager` = accesso gestore.
- `/?view=login&type=admin` = accesso ADMIN.
- `/?view=manager` = pannello gestore dopo il login.
- `/?view=admin` = dashboard ADMIN dopo il login.

Il portale pubblico legge automaticamente tutti i centri attivi dal database D1. Non è necessario aggiungere manualmente le schede in HTML.

## Come aggiungere Mesoraca, Botricello, Catanzaro ecc.

Entra in ADMIN e crea un centro. Nel campo `Località / indirizzo` inserisci ad esempio:

- `Mesoraca, CZ`
- `Botricello, CZ`
- `Catanzaro, CZ`

La località verrà mostrata automaticamente sulla scheda premium nella Home.

## Cloudflare D1

Il binding deve chiamarsi:

```text
DB
```

Nel file `wrangler.toml` deve esserci il vero `database_id` del database D1.

Se il database è già stato configurato con la versione precedente NON devi ricrearlo: questa versione usa le stesse tabelle.

## Variabili Cloudflare

Imposta nel progetto Pages:

```text
ADMIN_EMAIL
ADMIN_PASSWORD
```

Queste credenziali vengono usate soltanto per l'ADMIN centrale. I gestori vengono creati dalla dashboard ADMIN.

## Deploy

1. Sostituisci i file del repository GitHub con quelli di questa cartella.
2. Fai commit/push.
3. Cloudflare Pages esegue automaticamente il nuovo deploy.
4. Apri il dominio senza parametri: vedrai la Home con i centri aderenti.

## Database

`schema.sql` serve per una nuova installazione. Se il database D1 esiste già e contiene le tabelle create dalla prima versione, non è necessario rilanciare lo schema per questo aggiornamento.
