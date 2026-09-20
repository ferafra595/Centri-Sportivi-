# Sport Booking Platform — MVP Cloudflare Pages + D1

Piattaforma multi-centro con:
- App cliente personalizzata per ogni centro
- Dashboard ADMIN centrale
- Pannello gestore
- Campi multipli
- Disponibilità e prenotazioni
- Prenotazioni telefoniche/manuali
- Blocchi campo
- Stato pagamento (pagamento fuori piattaforma)
- Convenzioni sportive
- Prenotazioni ricorrenti con controllo conflitti

## Struttura volutamente semplice

```
/
├─ index.html
├─ schema.sql
├─ wrangler.toml
├─ README.md
├─ assets/
│  ├─ app.css
│  └─ app.js
└─ functions/
   └─ api.js
```

## 1. GitHub

Crea un repository e carica questi file mantenendo esattamente la struttura.

## 2. Crea il database D1

Cloudflare Dashboard → Storage & Databases → D1 → Create database.
Nome consigliato: `sport-booking-db`.

Esegui `schema.sql` nella console D1, oppure con Wrangler:

```bash
npx wrangler d1 execute sport-booking-db --remote --file=./schema.sql
```

## 3. Collega D1 a Pages

Nel progetto Cloudflare Pages:
Settings → Bindings → Add binding → D1 database.

- Variable name: `DB`
- Database: `sport-booking-db`

Dopo aver aggiunto il binding, fai un nuovo deploy.

Se usi `wrangler.toml`, sostituisci `INSERISCI_QUI_DATABASE_ID` con l'ID reale del D1.

## 4. Variabili ADMIN

Cloudflare Pages → Settings → Variables and Secrets.

Aggiungi:
- `ADMIN_EMAIL` = la tua email di accesso ADMIN
- `ADMIN_PASSWORD` = una password forte

Impostale almeno in Production. Per Preview puoi usare credenziali diverse.

## 5. Collega GitHub a Cloudflare Pages

Pages → Create project → Connect to Git → scegli il repository.

Questo progetto non richiede build frontend.
- Framework preset: None
- Build command: lascia vuoto
- Build output directory: `.`

Le Pages Functions usano la cartella `/functions` alla root.

## 6. URL principali

App demo:
```
https://tuodominio.it/?center=demo-sport
```

Login gestionale:
```
https://tuodominio.it/?view=login
```

ADMIN:
```
https://tuodominio.it/?view=admin
```

Gestore:
```
https://tuodominio.it/?view=manager
```

L'ADMIN crea i centri, i campi e gli accessi dei gestori.

## 7. Come funziona il multi-centro

Ogni centro ha uno `slug` univoco. Esempi:
- `?center=campizzi`
- `?center=sport-village`
- `?center=padel-club`

È sempre lo stesso codice. Logo, colore, copertina, campi, contatti e prenotazioni vengono letti dal database.

## 8. Foto e logo

Per l'MVP i campi `logo_url` e `cover_url` accettano URL pubblici. In una fase successiva conviene collegare Cloudflare R2 per caricare le immagini direttamente dalla ADMIN.

## Nota sicurezza

- Password gestori salvate con salt + SHA-256.
- Sessioni casuali salvate in D1 e cookie HttpOnly/Secure/SameSite=Lax.
- Query dinamiche D1 usano prepared statements/bind.
- La password ADMIN resta una secret Cloudflare e non finisce nel repository.

Per produzione, il passo successivo consigliato è aggiungere rate limiting login/prenotazioni e recupero password gestore.
