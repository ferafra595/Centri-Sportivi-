-- Esegui UNA SOLA VOLTA nella Console D1 di Cloudflare.
-- Aggiunge la tariffa con doccia; price_cents viene riutilizzato come tariffa senza doccia.
ALTER TABLE fields ADD COLUMN shower_price_cents INTEGER NOT NULL DEFAULT 0;
