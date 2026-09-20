-- ESEGUI UNA SOLA VOLTA nella Console D1 prima di pubblicare la V3.
-- Aggiunge tariffe weekend e nota tariffaria ai campi.
ALTER TABLE fields ADD COLUMN weekend_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fields ADD COLUMN weekend_shower_price_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fields ADD COLUMN pricing_note TEXT NOT NULL DEFAULT '';
