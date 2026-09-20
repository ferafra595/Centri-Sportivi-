-- Eseguire una sola volta su Cloudflare D1
ALTER TABLE centers ADD COLUMN gallery_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE fields ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
