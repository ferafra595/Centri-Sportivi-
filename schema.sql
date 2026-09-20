PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  logo_url TEXT DEFAULT '',
  cover_url TEXT DEFAULT '',
  accent_color TEXT DEFAULT '#111827',
  phone TEXT DEFAULT '',
  whatsapp TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  description TEXT DEFAULT '',
  conventions_enabled INTEGER NOT NULL DEFAULT 1,
  recurring_enabled INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  sport TEXT NOT NULL,
  surface TEXT DEFAULT '',
  indoor INTEGER NOT NULL DEFAULT 0,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  price_cents INTEGER NOT NULL DEFAULT 0,
  opening_time TEXT NOT NULL DEFAULT '08:00',
  closing_time TEXT NOT NULL DEFAULT '23:00',
  active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY(center_id) REFERENCES centers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('manager')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(center_id) REFERENCES centers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER,
  role TEXT NOT NULL CHECK(role IN ('admin','manager')),
  center_id INTEGER,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(center_id) REFERENCES centers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER NOT NULL,
  field_id INTEGER NOT NULL,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  price_cents INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'due' CHECK(payment_status IN ('due','paid')),
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled','blocked')),
  source TEXT NOT NULL DEFAULT 'app' CHECK(source IN ('app','manager','recurring','block')),
  recurring_group TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(center_id) REFERENCES centers(id) ON DELETE CASCADE,
  FOREIGN KEY(field_id) REFERENCES fields(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bookings_field_date ON bookings(field_id, date, status);
CREATE INDEX IF NOT EXISTS idx_bookings_center_date ON bookings(center_id, date, status);

CREATE TABLE IF NOT EXISTS convention_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id INTEGER NOT NULL,
  field_id INTEGER,
  group_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  preferred_days TEXT DEFAULT '',
  preferred_times TEXT DEFAULT '',
  frequency TEXT DEFAULT '',
  period_text TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','negotiating','accepted','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(center_id) REFERENCES centers(id) ON DELETE CASCADE,
  FOREIGN KEY(field_id) REFERENCES fields(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO centers (id, slug, name, accent_color, phone, whatsapp, address, description)
VALUES (1, 'demo-sport', 'Demo Sport Center', '#111827', '+39 333 0000000', '393330000000', 'Via dello Sport 1', 'Prenota il tuo campo in pochi secondi.');

INSERT OR IGNORE INTO fields (id, center_id, name, sport, surface, indoor, duration_minutes, price_cents, opening_time, closing_time)
VALUES
  (1, 1, 'Campo 1', 'Calcio a 7', 'Sintetico', 0, 60, 6000, '17:00', '23:00'),
  (2, 1, 'Campo 2', 'Calcio a 5', 'Sintetico', 0, 60, 5000, '17:00', '23:00');
