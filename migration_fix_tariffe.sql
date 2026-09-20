-- ESEGUI UNA SOLA VOLTA nella Console D1 di Cloudflare.
-- 1) Aggiunge la tariffa "con doccia" mancante.
-- 2) Imposta i campi già presenti a 5 € senza doccia e 7 € con doccia.

ALTER TABLE fields ADD COLUMN shower_price_cents INTEGER NOT NULL DEFAULT 0;

UPDATE fields
SET price_cents = 500,
    shower_price_cents = 700;
