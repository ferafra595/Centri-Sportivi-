const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});
const ok = (data = {}, status = 200, headers = {}) => json({ ok: true, ...data }, status, headers);
const bad = (message, status = 400) => json({ ok: false, error: message }, status);

function parseCookies(request) {
  const raw = request.headers.get('cookie') || '';
  return Object.fromEntries(raw.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return [x.slice(0, i), decodeURIComponent(x.slice(i + 1))];
  }));
}
function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function minutes(t) {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function timeFromMinutes(v) {
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function getDayOfWeek(dateStr) {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay();
}
async function body(request) {
  try { return await request.json(); } catch { return {}; }
}
async function getSession(request, env) {
  const token = parseCookies(request).sport_session;
  if (!token) return null;
  return await env.DB.prepare(`
    SELECT s.*, u.name user_name, u.email user_email
    FROM sessions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')
  `).bind(token).first();
}
async function requireRole(request, env, roles) {
  const session = await getSession(request, env);
  if (!session || !roles.includes(session.role)) return null;
  return session;
}
async function publicCenter(env, slug) {
  const center = await env.DB.prepare(`SELECT * FROM centers WHERE slug = ? AND active = 1`).bind(slug).first();
  if (!center) return null;
  const { results: fields } = await env.DB.prepare(`SELECT * FROM fields WHERE center_id = ? AND active = 1 ORDER BY id`).bind(center.id).all();
  return { center, fields };
}
async function hasConflict(env, fieldId, date, startTime, endTime, ignoreId = 0) {
  const row = await env.DB.prepare(`
    SELECT id FROM bookings
    WHERE field_id = ? AND date = ? AND status IN ('confirmed','blocked')
      AND id != ? AND start_time < ? AND end_time > ?
    LIMIT 1
  `).bind(fieldId, date, ignoreId, endTime, startTime).first();
  return !!row;
}

async function handleGet(request, env, url) {
  const action = url.searchParams.get('action') || 'public-centers';

  if (action === 'public-centers') {
    const { results } = await env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM fields f WHERE f.center_id = c.id AND f.active = 1) fields_count,
        (SELECT GROUP_CONCAT(DISTINCT f.sport) FROM fields f WHERE f.center_id = c.id AND f.active = 1) sports
      FROM centers c
      WHERE c.active = 1
      ORDER BY c.name COLLATE NOCASE
    `).all();
    return ok({ centers: results });
  }

  if (action === 'center') {
    const slug = url.searchParams.get('slug');
    if (!slug) return bad('Centro non specificato');
    const data = await publicCenter(env, slug);
    return data ? ok(data) : bad('Centro non trovato', 404);
  }

  if (action === 'availability') {
    const fieldId = Number(url.searchParams.get('field_id'));
    const date = url.searchParams.get('date');
    if (!fieldId || !date) return bad('Campo e data obbligatori');
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id = ? AND active = 1`).bind(fieldId).first();
    if (!field) return bad('Campo non trovato', 404);
    const { results: busy } = await env.DB.prepare(`
      SELECT start_time, end_time FROM bookings
      WHERE field_id = ? AND date = ? AND status IN ('confirmed','blocked')
    `).bind(fieldId, date).all();
    const slots = [];
    const step = Number(field.duration_minutes || 60);
    for (let m = minutes(field.opening_time); m + step <= minutes(field.closing_time); m += step) {
      const start = timeFromMinutes(m), end = timeFromMinutes(m + step);
      const occupied = busy.some(b => start < b.end_time && end > b.start_time);
      slots.push({ start, end, available: !occupied });
    }
    return ok({ field, date, slots });
  }

  if (action === 'me') {
    const session = await getSession(request, env);
    return ok({ session: session ? {
      role: session.role,
      center_id: session.center_id,
      name: session.user_name || 'Admin',
      email: session.user_email || ''
    } : null });
  }

  if (action === 'admin-centers') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const { results } = await env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM fields f WHERE f.center_id=c.id) fields_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.center_id=c.id AND b.status='confirmed') bookings_count
      FROM centers c ORDER BY c.id DESC
    `).all();
    return ok({ centers: results });
  }

  if (action === 'manager-dashboard') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = s.center_id;
    const center = await env.DB.prepare(`SELECT * FROM centers WHERE id=?`).bind(centerId).first();
    const { results: fields } = await env.DB.prepare(`SELECT * FROM fields WHERE center_id=? ORDER BY id`).bind(centerId).all();
    const { results: bookings } = await env.DB.prepare(`
      SELECT b.*, f.name field_name, f.sport FROM bookings b JOIN fields f ON f.id=b.field_id
      WHERE b.center_id=? AND b.date >= date('now','-1 day')
      ORDER BY b.date, b.start_time LIMIT 250
    `).bind(centerId).all();
    const { results: conventions } = await env.DB.prepare(`
      SELECT cr.*, f.name field_name FROM convention_requests cr LEFT JOIN fields f ON f.id=cr.field_id
      WHERE cr.center_id=? ORDER BY cr.id DESC LIMIT 100
    `).bind(centerId).all();
    return ok({ center, fields, bookings, conventions });
  }

  return bad('Azione non valida', 404);
}

async function handlePost(request, env, url) {
  const action = url.searchParams.get('action') || '';
  const data = await body(request);

  if (action === 'login') {
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!email || !password) return bad('Inserisci email e password');

    let role, userId = null, centerId = null;
    if (email === String(env.ADMIN_EMAIL || 'admin@local').toLowerCase() && password === String(env.ADMIN_PASSWORD || '')) {
      role = 'admin';
    } else {
      const user = await env.DB.prepare(`SELECT * FROM users WHERE email=? AND active=1`).bind(email).first();
      if (!user) return bad('Credenziali non valide', 401);
      const digest = await sha256(password + user.password_salt);
      if (digest !== user.password_hash) return bad('Credenziali non valide', 401);
      role = 'manager'; userId = user.id; centerId = user.center_id;
    }

    const token = randomToken();
    const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString();
    await env.DB.prepare(`INSERT INTO sessions(token,user_id,role,center_id,expires_at) VALUES(?,?,?,?,?)`).bind(token,userId,role,centerId,expires).run();
    return ok({ role, center_id: centerId }, 200, {
      'set-cookie': `sport_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`
    });
  }

  if (action === 'logout') {
    const token = parseCookies(request).sport_session;
    if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token=?`).bind(token).run();
    return json({ ok: true }, 200, {
      'set-cookie': 'sport_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0'
    });
  }

  if (action === 'booking') {
    const fieldId = Number(data.field_id);
    const date = String(data.date || '');
    const start = String(data.start_time || '');
    const name = String(data.customer_name || '').trim();
    const phone = String(data.customer_phone || '').trim();
    if (!fieldId || !date || !start || !name || !phone) return bad('Compila tutti i campi obbligatori');
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND active=1`).bind(fieldId).first();
    if (!field) return bad('Campo non disponibile', 404);
    const end = timeFromMinutes(minutes(start) + Number(field.duration_minutes));
    if (await hasConflict(env, fieldId, date, start, end)) return bad('Questo orario non è più disponibile', 409);
    await env.DB.prepare(`
      INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,customer_email,date,start_time,end_time,price_cents,source)
      VALUES(?,?,?,?,?,?,?,?,?,'app')
    `).bind(field.center_id,fieldId,name,phone,String(data.customer_email||''),date,start,end,field.price_cents).run();
    return ok({ message: 'Prenotazione confermata', end_time: end });
  }

  if (action === 'convention') {
    const centerId = Number(data.center_id);
    if (!centerId || !data.group_name || !data.contact_name || !data.phone) return bad('Compila i campi obbligatori');
    const center = await env.DB.prepare(`SELECT conventions_enabled FROM centers WHERE id=? AND active=1`).bind(centerId).first();
    if (!center || !center.conventions_enabled) return bad('Convenzioni non disponibili');
    await env.DB.prepare(`
      INSERT INTO convention_requests(center_id,field_id,group_name,contact_name,phone,preferred_days,preferred_times,frequency,period_text,notes)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).bind(centerId, data.field_id || null, data.group_name, data.contact_name, data.phone, data.preferred_days || '', data.preferred_times || '', data.frequency || '', data.period_text || '', data.notes || '').run();
    return ok({ message: 'Richiesta inviata' });
  }

  if (action === 'admin-center-save') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const id = Number(data.id || 0);
    if (!data.slug || !data.name) return bad('Nome e slug sono obbligatori');
    const values = [
      data.slug, data.name, data.logo_url||'', data.cover_url||'', data.accent_color||'#111827',
      data.phone||'', data.whatsapp||'', data.email||'', data.address||'', data.description||'',
      data.conventions_enabled ? 1 : 0, data.recurring_enabled ? 1 : 0, data.active === false ? 0 : 1
    ];
    if (id) {
      await env.DB.prepare(`UPDATE centers SET slug=?,name=?,logo_url=?,cover_url=?,accent_color=?,phone=?,whatsapp=?,email=?,address=?,description=?,conventions_enabled=?,recurring_enabled=?,active=? WHERE id=?`).bind(...values,id).run();
      return ok({ id });
    }
    const r = await env.DB.prepare(`INSERT INTO centers(slug,name,logo_url,cover_url,accent_color,phone,whatsapp,email,address,description,conventions_enabled,recurring_enabled,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...values).run();
    return ok({ id: r.meta.last_row_id });
  }

  if (action === 'admin-field-save') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = Number(data.center_id), id = Number(data.id || 0);
    if (!centerId || !data.name || !data.sport) return bad('Dati campo incompleti');
    const vals = [centerId,data.name,data.sport,data.surface||'',data.indoor?1:0,Number(data.duration_minutes||60),Math.round(Number(data.price||0)*100),data.opening_time||'08:00',data.closing_time||'23:00',data.active===false?0:1];
    if (id) {
      await env.DB.prepare(`UPDATE fields SET center_id=?,name=?,sport=?,surface=?,indoor=?,duration_minutes=?,price_cents=?,opening_time=?,closing_time=?,active=? WHERE id=?`).bind(...vals,id).run();
      return ok({ id });
    }
    const r = await env.DB.prepare(`INSERT INTO fields(center_id,name,sport,surface,indoor,duration_minutes,price_cents,opening_time,closing_time,active) VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
    return ok({ id:r.meta.last_row_id });
  }

  if (action === 'admin-manager-create') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    if (!data.center_id || !data.name || !data.email || !data.password) return bad('Compila tutti i campi');
    const salt = randomToken(16);
    const hash = await sha256(String(data.password) + salt);
    await env.DB.prepare(`INSERT INTO users(center_id,name,email,password_hash,password_salt,role) VALUES(?,?,?,?,?,'manager')`)
      .bind(Number(data.center_id),data.name,String(data.email).toLowerCase(),hash,salt).run();
    return ok();
  }

  if (action === 'manager-booking') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first();
    if (!field) return bad('Campo non valido');
    const end = data.end_time || timeFromMinutes(minutes(data.start_time) + Number(field.duration_minutes));
    if (await hasConflict(env, field.id, data.date, data.start_time, end)) return bad('Conflitto con una prenotazione esistente', 409);
    await env.DB.prepare(`INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,date,start_time,end_time,price_cents,payment_status,status,source,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(s.center_id,field.id,data.customer_name||'Prenotazione manuale',data.customer_phone||'',data.date,data.start_time,end,Math.round(Number(data.price ?? field.price_cents/100)*100),data.payment_status||'due',data.blocked?'blocked':'confirmed',data.blocked?'block':'manager',data.notes||'').run();
    return ok();
  }

  if (action === 'manager-recurring') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const center = await env.DB.prepare(`SELECT recurring_enabled FROM centers WHERE id=?`).bind(s.center_id).first();
    if (!center?.recurring_enabled) return bad('Prenotazioni ricorrenti disattivate');
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first();
    if (!field) return bad('Campo non valido');
    const weekday = Number(data.weekday);
    const startDate = data.start_date, endDate = data.end_date, start = data.start_time;
    const end = data.end_time || timeFromMinutes(minutes(start) + Number(field.duration_minutes));
    const group = randomToken(8);
    const conflicts = [], created = [];
    for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
      if (getDayOfWeek(d) !== weekday) continue;
      if (await hasConflict(env, field.id, d, start, end)) { conflicts.push(d); continue; }
      await env.DB.prepare(`INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,date,start_time,end_time,price_cents,payment_status,status,source,recurring_group,notes) VALUES(?,?,?,?,?,?,?,?,?,'confirmed','recurring',?,?)`)
        .bind(s.center_id,field.id,data.customer_name||data.group_name||'Convenzione',data.customer_phone||'',d,start,end,Math.round(Number(data.price ?? field.price_cents/100)*100),data.payment_status||'due',group,data.notes||'').run();
      created.push(d);
    }
    return ok({ created, conflicts, recurring_group: group });
  }

  if (action === 'manager-booking-status') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const booking = await env.DB.prepare(`SELECT * FROM bookings WHERE id=? AND center_id=?`).bind(Number(data.id),s.center_id).first();
    if (!booking) return bad('Prenotazione non trovata',404);
    await env.DB.prepare(`UPDATE bookings SET status=?, payment_status=? WHERE id=?`).bind(data.status || booking.status, data.payment_status || booking.payment_status, booking.id).run();
    return ok();
  }

  if (action === 'manager-convention-status') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    await env.DB.prepare(`UPDATE convention_requests SET status=? WHERE id=? AND center_id=?`).bind(data.status,Number(data.id),s.center_id).run();
    return ok();
  }

  return bad('Azione non valida', 404);
}

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return bad('Binding D1 DB non configurato', 500);
  const url = new URL(request.url);
  try {
    if (request.method === 'GET') return await handleGet(request, env, url);
    if (request.method === 'POST') return await handlePost(request, env, url);
    return bad('Metodo non supportato', 405);
  } catch (e) {
    console.error(e);
    return bad(e?.message || 'Errore interno', 500);
  }
}
