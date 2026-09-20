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
function isWeekend(dateStr) {
  const day = getDayOfWeek(dateStr);
  return day === 0 || day === 6;
}
function effectivePricing(field, dateStr) {
  const weekend = isWeekend(dateStr);
  const standard = Number(field.price_cents || 0);
  const shower = Number(field.shower_price_cents || 0);
  const weekendStandard = Number(field.weekend_price_cents || 0);
  const weekendShower = Number(field.weekend_shower_price_cents || 0);
  return {
    price_cents: weekend && weekendStandard > 0 ? weekendStandard : standard,
    shower_price_cents: weekend && weekendShower > 0 ? weekendShower : shower,
    weekend
  };
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
function sqlDateRange(daysBack = 0, daysForward = 0) {
  return {
    from: daysBack ? `date('now','-${Number(daysBack)} day')` : `date('now')`,
    to: daysForward ? `date('now','+${Number(daysForward)} day')` : `date('now')`
  };
}

async function handleGet(request, env, url) {
  const action = url.searchParams.get('action') || 'public-centers';

  if (action === 'public-centers') {
    const { results } = await env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM fields f WHERE f.center_id = c.id AND f.active = 1) fields_count,
        (SELECT GROUP_CONCAT(DISTINCT f.sport) FROM fields f WHERE f.center_id = c.id AND f.active = 1) sports,
        (SELECT GROUP_CONCAT(DISTINCT f.surface) FROM fields f WHERE f.center_id = c.id AND f.active = 1 AND f.surface!='') surfaces,
        (SELECT COUNT(*) FROM fields f WHERE f.center_id = c.id AND f.active = 1 AND f.indoor=1) indoor_count,
        (SELECT COUNT(*) FROM fields f WHERE f.center_id = c.id AND f.active = 1 AND f.indoor=0) outdoor_count
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
    return ok({ field: { ...field, ...effectivePricing(field, date) }, date, slots });
  }

  if (action === 'media') {
    const key = url.searchParams.get('key') || '';
    if (!key || !env.MEDIA) return bad('Media non disponibile', 404);
    const object = await env.MEDIA.get(key);
    if (!object) return bad('File non trovato', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    return new Response(object.body, { headers });
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
        (SELECT COUNT(*) FROM fields f WHERE f.center_id=c.id AND f.active=1) active_fields,
        (SELECT COUNT(*) FROM bookings b WHERE b.center_id=c.id AND b.status='confirmed') bookings_count,
        (SELECT COUNT(*) FROM bookings b WHERE b.center_id=c.id AND b.status='confirmed' AND strftime('%Y-%m', b.date)=strftime('%Y-%m','now')) month_bookings,
        (SELECT ROUND(SUM((strftime('%s','2000-01-01 '||b.end_time)-strftime('%s','2000-01-01 '||b.start_time))/3600.0),1) FROM bookings b WHERE b.center_id=c.id AND b.status='confirmed' AND strftime('%Y-%m', b.date)=strftime('%Y-%m','now')) month_hours,
        (SELECT MAX(b.date) FROM bookings b WHERE b.center_id=c.id AND b.status='confirmed') last_booking
      FROM centers c ORDER BY c.id DESC
    `).all();
    const stats = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM centers) centers_total,
        (SELECT COUNT(*) FROM centers WHERE active=1) centers_active,
        (SELECT COUNT(*) FROM fields WHERE active=1) fields_active,
        (SELECT COUNT(*) FROM users WHERE role='manager' AND active=1) managers_active,
        (SELECT COUNT(*) FROM bookings WHERE status='confirmed' AND strftime('%Y-%m',date)=strftime('%Y-%m','now')) month_bookings,
        (SELECT COUNT(*) FROM bookings WHERE status='confirmed' AND date BETWEEN date('now','-6 day') AND date('now')) week_bookings,
        (SELECT ROUND(SUM((strftime('%s','2000-01-01 '||end_time)-strftime('%s','2000-01-01 '||start_time))/3600.0),1) FROM bookings WHERE status='confirmed' AND strftime('%Y-%m',date)=strftime('%Y-%m','now')) month_hours,
        (SELECT COUNT(*) FROM bookings WHERE status='cancelled' AND strftime('%Y-%m',date)=strftime('%Y-%m','now')) month_cancelled,
        (SELECT COUNT(*) FROM bookings WHERE status='confirmed' AND source='recurring' AND strftime('%Y-%m',date)=strftime('%Y-%m','now')) month_recurring
    `).first();
    return ok({ centers: results, stats });
  }

  if (action === 'admin-fields') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = Number(url.searchParams.get('center_id') || 0);
    if (!centerId) return bad('Centro non valido');
    const center = await env.DB.prepare(`SELECT id,name FROM centers WHERE id=?`).bind(centerId).first();
    if (!center) return bad('Centro non trovato', 404);
    const { results } = await env.DB.prepare(`SELECT * FROM fields WHERE center_id=? ORDER BY active DESC, id ASC`).bind(centerId).all();
    return ok({ center, fields: results });
  }

  if (action === 'admin-managers') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const { results } = await env.DB.prepare(`
      SELECT u.id, u.center_id, u.name, u.email, u.active, u.created_at, c.name center_name
      FROM users u LEFT JOIN centers c ON c.id = u.center_id
      WHERE u.role = 'manager'
      ORDER BY u.active DESC, u.id DESC
    `).all();
    return ok({ managers: results });
  }

  if (action === 'public-now') {
    const date = String(url.searchParams.get('date') || '');
    const time = String(url.searchParams.get('time') || '');
    if (!date || !time) return bad('Data e ora obbligatorie');
    const { results: fields } = await env.DB.prepare(`SELECT * FROM fields WHERE active=1 ORDER BY center_id,id`).all();
    const { results: busy } = await env.DB.prepare(`SELECT field_id,start_time,end_time FROM bookings WHERE date=? AND status IN ('confirmed','blocked')`).bind(date).all();
    const byCenter = {};
    for (const f of fields) {
      const step = Number(f.duration_minutes||60), startMin=Math.max(minutes(time),minutes(f.opening_time));
      let next=null;
      for(let m=startMin;m+step<=minutes(f.closing_time)&&m<=minutes(time)+180;m+=15){
        const st=timeFromMinutes(m), en=timeFromMinutes(m+step);
        if(!busy.some(b=>Number(b.field_id)===Number(f.id)&&st<b.end_time&&en>b.start_time)){ next=st; break; }
      }
      if(next && (!byCenter[f.center_id] || next<byCenter[f.center_id].time)) byCenter[f.center_id]={time:next,field_id:f.id,field_name:f.name};
    }
    return ok({ availability: byCenter });
  }

  if (action === 'public-bookings') {
    const centerId=Number(url.searchParams.get('center_id')||0), phone=String(url.searchParams.get('phone')||'').trim();
    if(!centerId||!phone) return bad('Centro e telefono obbligatori');
    const {results}=await env.DB.prepare(`SELECT b.*,f.name field_name FROM bookings b JOIN fields f ON f.id=b.field_id WHERE b.center_id=? AND b.customer_phone=? ORDER BY b.date DESC,b.start_time DESC LIMIT 100`).bind(centerId,phone).all();
    return ok({bookings:results});
  }

  if (action === 'manager-dashboard') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = s.center_id;
    const center = await env.DB.prepare(`SELECT * FROM centers WHERE id=?`).bind(centerId).first();
    const { results: fields } = await env.DB.prepare(`SELECT * FROM fields WHERE center_id=? ORDER BY id`).bind(centerId).all();
    const { results: bookings } = await env.DB.prepare(`
      SELECT b.*, f.name field_name, f.sport FROM bookings b JOIN fields f ON f.id=b.field_id
      WHERE b.center_id=? AND b.date BETWEEN date('now','-120 day') AND date('now','+180 day')
      ORDER BY b.date, b.start_time LIMIT 1200
    `).bind(centerId).all();
    const { results: conventions } = await env.DB.prepare(`
      SELECT cr.*, f.name field_name FROM convention_requests cr LEFT JOIN fields f ON f.id=cr.field_id
      WHERE cr.center_id=? ORDER BY cr.id DESC LIMIT 150
    `).bind(centerId).all();
    const { results: customers } = await env.DB.prepare(`
      SELECT customer_name, customer_phone,
             COUNT(*) bookings_count,
             MAX(date) last_booking,
             SUM(CASE WHEN date>=date('now','-30 day') THEN 1 ELSE 0 END) last30_count,
             COALESCE((SELECT note FROM customer_notes cn WHERE cn.center_id=? AND cn.phone=bookings.customer_phone LIMIT 1),'') customer_note
      FROM bookings
      WHERE center_id=? AND status='confirmed' AND source!='block' AND customer_phone!=''
      GROUP BY customer_phone
      ORDER BY bookings_count DESC, last_booking DESC
      LIMIT 100
    `).bind(centerId, centerId).all();
    const stats = await env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status='confirmed' AND date=date('now') THEN 1 ELSE 0 END) today_bookings,
        SUM(CASE WHEN status='confirmed' AND strftime('%Y-%m',date)=strftime('%Y-%m','now') THEN 1 ELSE 0 END) month_bookings,
        ROUND(SUM(CASE WHEN status='confirmed' AND strftime('%Y-%m',date)=strftime('%Y-%m','now') THEN (strftime('%s','2000-01-01 '||end_time)-strftime('%s','2000-01-01 '||start_time))/3600.0 ELSE 0 END),1) month_hours,
        SUM(CASE WHEN status='confirmed' AND payment_status='due' AND date>=date('now') THEN 1 ELSE 0 END) due_count,
        SUM(CASE WHEN status='blocked' AND date>=date('now') THEN 1 ELSE 0 END) future_blocks,
        SUM(CASE WHEN status='confirmed' AND source='recurring' AND strftime('%Y-%m',date)=strftime('%Y-%m','now') THEN 1 ELSE 0 END) recurring_month,
        SUM(CASE WHEN status='confirmed' AND source!='recurring' AND source!='block' AND strftime('%Y-%m',date)=strftime('%Y-%m','now') THEN 1 ELSE 0 END) single_month,
        SUM(CASE WHEN status='cancelled' AND strftime('%Y-%m',date)=strftime('%Y-%m','now') THEN 1 ELSE 0 END) cancelled_month
      FROM bookings WHERE center_id=?
    `).bind(centerId).first();
    const topDay = await env.DB.prepare(`
      SELECT strftime('%w',date) dow, COUNT(*) n FROM bookings
      WHERE center_id=? AND status='confirmed' AND date>=date('now','-90 day')
      GROUP BY dow ORDER BY n DESC LIMIT 1
    `).bind(centerId).first();
    const topHour = await env.DB.prepare(`
      SELECT substr(start_time,1,2) hour, COUNT(*) n FROM bookings
      WHERE center_id=? AND status='confirmed' AND date>=date('now','-90 day')
      GROUP BY hour ORDER BY n DESC LIMIT 1
    `).bind(centerId).first();
    const topField = await env.DB.prepare(`
      SELECT f.name, COUNT(*) n FROM bookings b JOIN fields f ON f.id=b.field_id
      WHERE b.center_id=? AND b.status='confirmed' AND b.date>=date('now','-90 day')
      GROUP BY b.field_id ORDER BY n DESC LIMIT 1
    `).bind(centerId).first();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth()+1, 0).getDate();
    const capacityHours = fields.reduce((sum,f)=>sum + Math.max(0,(minutes(f.closing_time)-minutes(f.opening_time))/60)*daysInMonth,0);
    stats.occupancy_pct = capacityHours>0 ? Math.round((Number(stats.month_hours||0)/capacityHours)*100) : 0;
    return ok({ center, fields, bookings, conventions, customers, stats, top_day: topDay, top_hour: topHour, top_field: topField });
  }

  if (action === 'manager-customer-history') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const phone = String(url.searchParams.get('phone') || '').trim();
    if (!phone) return bad('Telefono obbligatorio');
    const { results } = await env.DB.prepare(`
      SELECT b.*, f.name field_name FROM bookings b JOIN fields f ON f.id=b.field_id
      WHERE b.center_id=? AND b.customer_phone=? ORDER BY b.date DESC, b.start_time DESC LIMIT 100
    `).bind(s.center_id, phone).all();
    const note = await env.DB.prepare(`SELECT note FROM customer_notes WHERE center_id=? AND phone=?`).bind(s.center_id,phone).first();
    return ok({ bookings: results, note: note?.note || '' });
  }

  return bad('Azione non valida', 404);
}

async function handleUpload(request, env) {
  const s = await requireRole(request, env, ['admin']);
  if (!s) return bad('Non autorizzato', 401);
  if (!env.MEDIA) return bad('Binding R2 MEDIA non configurato', 500);
  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File) || !file.size) return bad('File non valido');
  if (!String(file.type || '').startsWith('image/')) return bad('Carica un’immagine');
  if (file.size > 8 * 1024 * 1024) return bad('Immagine troppo grande: massimo 8 MB');
  const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const key = `centers/${Date.now()}-${randomToken(6)}.${ext}`;
  await env.MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'image/jpeg' } });
  return ok({ key, url: `/api?action=media&key=${encodeURIComponent(key)}` });
}

async function handlePost(request, env, url) {
  const action = url.searchParams.get('action') || '';
  if (action === 'upload-media') return handleUpload(request, env);
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
    const pricing = effectivePricing(field, date);
    const r = await env.DB.prepare(`
      INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,customer_email,date,start_time,end_time,price_cents,source)
      VALUES(?,?,?,?,?,?,?,?,?,'app')
    `).bind(field.center_id,fieldId,name,phone,String(data.customer_email||''),date,start,end,pricing.price_cents).run();
    return ok({
      message: 'Prenotazione confermata',
      booking_id: r.meta.last_row_id,
      end_time: end,
      price_cents: pricing.price_cents,
      shower_price_cents: pricing.shower_price_cents
    });
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
    let galleryJson = '[]';
    try { const g = JSON.parse(String(data.gallery_json || '[]')); galleryJson = JSON.stringify(Array.isArray(g) ? g.filter(Boolean).slice(0,24) : []); } catch {}
    const values = [
      data.slug, data.name, data.logo_url||'', data.cover_url||'', data.favicon_url||'', galleryJson, data.accent_color||'#111827',
      data.phone||'', data.whatsapp||'', data.email||'', data.address||'', data.description||'', data.services_text||'', data.cancellation_rules||'', data.custom_domain||'',
      data.parking ? 1 : 0, data.showers ? 1 : 0, data.lighting ? 1 : 0,
      data.conventions_enabled ? 1 : 0, data.recurring_enabled ? 1 : 0, data.active === false ? 0 : 1
    ];
    if (id) {
      await env.DB.prepare(`UPDATE centers SET slug=?,name=?,logo_url=?,cover_url=?,favicon_url=?,gallery_json=?,accent_color=?,phone=?,whatsapp=?,email=?,address=?,description=?,services_text=?,cancellation_rules=?,custom_domain=?,parking=?,showers=?,lighting=?,conventions_enabled=?,recurring_enabled=?,active=? WHERE id=?`).bind(...values,id).run();
      return ok({ id });
    }
    const r = await env.DB.prepare(`INSERT INTO centers(slug,name,logo_url,cover_url,favicon_url,gallery_json,accent_color,phone,whatsapp,email,address,description,services_text,cancellation_rules,custom_domain,parking,showers,lighting,conventions_enabled,recurring_enabled,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...values).run();
    return ok({ id: r.meta.last_row_id });
  }

  if (action === 'admin-field-save') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = Number(data.center_id), id = Number(data.id || 0);
    if (!centerId || !data.name || !data.sport) return bad('Dati campo incompleti');
    const vals = [
      centerId, data.name, data.sport, data.surface||'', data.image_url||'', data.indoor?1:0, Number(data.duration_minutes||60),
      Math.round(Number(data.price_no_shower||0)*100), Math.round(Number(data.price_shower||0)*100),
      Math.round(Number(data.weekend_price_no_shower||0)*100), Math.round(Number(data.weekend_price_shower||0)*100),
      String(data.pricing_note||''), data.opening_time||'08:00', data.closing_time||'23:00', data.active===false?0:1
    ];
    if (id) {
      await env.DB.prepare(`UPDATE fields SET center_id=?,name=?,sport=?,surface=?,image_url=?,indoor=?,duration_minutes=?,price_cents=?,shower_price_cents=?,weekend_price_cents=?,weekend_shower_price_cents=?,pricing_note=?,opening_time=?,closing_time=?,active=? WHERE id=?`).bind(...vals,id).run();
      return ok({ id });
    }
    const r = await env.DB.prepare(`INSERT INTO fields(center_id,name,sport,surface,image_url,indoor,duration_minutes,price_cents,shower_price_cents,weekend_price_cents,weekend_shower_price_cents,pricing_note,opening_time,closing_time,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...vals).run();
    return ok({ id:r.meta.last_row_id });
  }

  if (action === 'admin-manager-create') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const centerId = Number(data.center_id);
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim().toLowerCase();
    const password = String(data.password || '');
    if (!centerId || !name || !email || !password) return bad('Compila tutti i campi');
    if (password.length < 6) return bad('La password deve avere almeno 6 caratteri');
    const center = await env.DB.prepare(`SELECT id FROM centers WHERE id=?`).bind(centerId).first();
    if (!center) return bad('Centro non trovato', 404);
    const exists = await env.DB.prepare(`SELECT id FROM users WHERE email=?`).bind(email).first();
    if (exists) return bad('Esiste già un accesso con questa email', 409);
    const salt = randomToken(16);
    const hash = await sha256(password + salt);
    const r = await env.DB.prepare(`INSERT INTO users(center_id,name,email,password_hash,password_salt,role,active) VALUES(?,?,?,?,?,'manager',1)`)
      .bind(centerId,name,email,hash,salt).run();
    return ok({ id: r.meta.last_row_id });
  }

  if (action === 'admin-manager-update') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const id = Number(data.id), centerId = Number(data.center_id);
    const name = String(data.name || '').trim(), email = String(data.email || '').trim().toLowerCase();
    const active = data.active === false ? 0 : 1;
    if (!id || !centerId || !name || !email) return bad('Dati gestore incompleti');
    const duplicate = await env.DB.prepare(`SELECT id FROM users WHERE email=? AND id<>?`).bind(email,id).first();
    if (duplicate) return bad('Questa email è già utilizzata da un altro accesso', 409);
    await env.DB.prepare(`UPDATE users SET center_id=?, name=?, email=?, active=? WHERE id=? AND role='manager'`).bind(centerId,name,email,active,id).run();
    if (!active) await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(id).run();
    return ok();
  }

  if (action === 'admin-manager-reset-password') {
    const s = await requireRole(request, env, ['admin']);
    if (!s) return bad('Non autorizzato', 401);
    const id = Number(data.id), password = String(data.password || '');
    if (!id || !password) return bad('Password obbligatoria');
    if (password.length < 6) return bad('La password deve avere almeno 6 caratteri');
    const user = await env.DB.prepare(`SELECT id FROM users WHERE id=? AND role='manager'`).bind(id).first();
    if (!user) return bad('Gestore non trovato', 404);
    const salt = randomToken(16), hash = await sha256(password + salt);
    await env.DB.prepare(`UPDATE users SET password_hash=?, password_salt=? WHERE id=?`).bind(hash,salt,id).run();
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id=?`).bind(id).run();
    return ok();
  }

  if (action === 'manager-customer-note') {
    const s=await requireRole(request,env,['manager']); if(!s)return bad('Non autorizzato',401);
    const phone=String(data.phone||'').trim(), note=String(data.note||''); if(!phone)return bad('Telefono obbligatorio');
    await env.DB.prepare(`INSERT INTO customer_notes(center_id,phone,note,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(center_id,phone) DO UPDATE SET note=excluded.note,updated_at=CURRENT_TIMESTAMP`).bind(s.center_id,phone,note).run();
    return ok();
  }

  if (action === 'manager-booking-update') {
    const s=await requireRole(request,env,['manager']); if(!s)return bad('Non autorizzato',401);
    const id=Number(data.id), field=await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first();
    if(!id||!field)return bad('Prenotazione o campo non valido');
    const current=await env.DB.prepare(`SELECT * FROM bookings WHERE id=? AND center_id=?`).bind(id,s.center_id).first(); if(!current)return bad('Prenotazione non trovata',404);
    const date=String(data.date||current.date), start=String(data.start_time||current.start_time), end=String(data.end_time||timeFromMinutes(minutes(start)+Number(field.duration_minutes||60)));
    if(await hasConflict(env,field.id,date,start,end,id))return bad('Conflitto con una prenotazione esistente',409);
    const pricing=effectivePricing(field,date);
    await env.DB.prepare(`UPDATE bookings SET field_id=?,customer_name=?,customer_phone=?,date=?,start_time=?,end_time=?,price_cents=?,payment_status=?,notes=? WHERE id=? AND center_id=?`).bind(field.id,data.customer_name||current.customer_name,data.customer_phone||'',date,start,end,pricing.price_cents,data.payment_status||current.payment_status,data.notes||'',id,s.center_id).run();
    return ok();
  }

  if (action === 'manager-block-update') {
    const s=await requireRole(request,env,['manager']); if(!s)return bad('Non autorizzato',401);
    const id=Number(data.id), current=await env.DB.prepare(`SELECT * FROM bookings WHERE id=? AND center_id=? AND source='block'`).bind(id,s.center_id).first(); if(!current)return bad('Chiusura non trovata',404);
    const field=await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id||current.field_id),s.center_id).first(); if(!field)return bad('Campo non valido');
    const date=String(data.date||current.date), start=data.full_day?field.opening_time:String(data.start_time||current.start_time), end=data.full_day?field.closing_time:String(data.end_time||current.end_time);
    if(await hasConflict(env,field.id,date,start,end,id))return bad('Conflitto con una prenotazione esistente',409);
    await env.DB.prepare(`UPDATE bookings SET field_id=?,date=?,start_time=?,end_time=?,notes=?,block_category=? WHERE id=? AND center_id=?`).bind(field.id,date,start,end,data.notes||'',data.block_category||'manutenzione',id,s.center_id).run();
    return ok();
  }

  if (action === 'manager-recurring-update') {
    const s=await requireRole(request,env,['manager']); if(!s)return bad('Non autorizzato',401);
    const group=String(data.recurring_group||''), fromDate=String(data.from_date||''); if(!group||!fromDate)return bad('Serie e data obbligatorie');
    const field=await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first(); if(!field)return bad('Campo non valido');
    const schedules=new Map((Array.isArray(data.schedules)?data.schedules:[]).map(x=>[Number(x.weekday),String(x.start_time||'')]));
    const {results:items}=await env.DB.prepare(`SELECT * FROM bookings WHERE center_id=? AND recurring_group=? AND source='recurring' AND status='confirmed' AND date>=? ORDER BY date,start_time`).bind(s.center_id,group,fromDate).all();
    const updated=[],conflicts=[];
    for(const b of items){const dow=getDayOfWeek(b.date),start=schedules.get(dow)||b.start_time,end=timeFromMinutes(minutes(start)+Number(field.duration_minutes||60));if(await hasConflict(env,field.id,b.date,start,end,b.id)){conflicts.push({id:b.id,date:b.date,start_time:start,end_time:end});continue;}const pricing=effectivePricing(field,b.date);await env.DB.prepare(`UPDATE bookings SET field_id=?,start_time=?,end_time=?,price_cents=? WHERE id=?`).bind(field.id,start,end,pricing.price_cents,b.id).run();updated.push(b.id)}
    return ok({updated,conflicts});
  }

  if (action === 'manager-booking') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first();
    if (!field) return bad('Campo non valido');
    const end = data.end_time || timeFromMinutes(minutes(data.start_time) + Number(field.duration_minutes));
    if (await hasConflict(env, field.id, data.date, data.start_time, end)) return bad('Conflitto con una prenotazione esistente', 409);
    const pricing = effectivePricing(field, data.date);
    await env.DB.prepare(`INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,date,start_time,end_time,price_cents,payment_status,status,source,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(s.center_id,field.id,data.customer_name||'Prenotazione manuale',data.customer_phone||'',data.date,data.start_time,end,pricing.price_cents,data.payment_status||'due',data.blocked?'blocked':'confirmed',data.blocked?'block':'manager',data.notes||'').run();
    return ok();
  }

  if (action === 'manager-block') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const dateFrom = String(data.date_from || data.date || '');
    const dateTo = String(data.date_to || dateFrom);
    if (!dateFrom || !dateTo) return bad('Periodo obbligatorio');
    if (dateTo < dateFrom) return bad('La data finale non può essere precedente a quella iniziale');
    const fieldId = Number(data.field_id || 0);
    const { results: fields } = fieldId
      ? await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(fieldId,s.center_id).all()
      : await env.DB.prepare(`SELECT * FROM fields WHERE center_id=? AND active=1`).bind(s.center_id).all();
    if (!fields.length) return bad('Nessun campo disponibile');
    if (!data.full_day && (!data.start_time || !data.end_time)) return bad('Indica orario di inizio e fine');
    const created = [], conflicts = [], blockGroup = randomToken(8);
    let guard = 0;
    for (let date = dateFrom; date <= dateTo; date = addDays(date, 1)) {
      if (++guard > 366) return bad('Il periodo massimo per una chiusura è di 366 giorni');
      for (const field of fields) {
        const start = data.full_day ? field.opening_time : String(data.start_time);
        const end = data.full_day ? field.closing_time : String(data.end_time);
        if (minutes(end) <= minutes(start)) return bad('L’orario di fine deve essere successivo a quello di inizio');
        if (await hasConflict(env, field.id, date, start, end)) {
          conflicts.push({ date, field_id: field.id, field_name: field.name, start_time: start, end_time: end });
          continue;
        }
        await env.DB.prepare(`INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,date,start_time,end_time,price_cents,payment_status,status,source,notes,block_category,block_group) VALUES(?,?,?,?,?,?,?,?,?,'blocked','block',?,?,?)`)
          .bind(s.center_id,field.id,'Chiusura / manutenzione','',date,start,end,0,'due',data.notes||'',data.block_category||'manutenzione',blockGroup).run();
        created.push({ date, field_id: field.id, field_name: field.name, start_time: start, end_time: end });
      }
    }
    return ok({ created, conflicts });
  }

  if (action === 'manager-recurring-preview' || action === 'manager-recurring') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    const center = await env.DB.prepare(`SELECT recurring_enabled FROM centers WHERE id=?`).bind(s.center_id).first();
    if (!center?.recurring_enabled) return bad('Prenotazioni ricorrenti disattivate');
    const field = await env.DB.prepare(`SELECT * FROM fields WHERE id=? AND center_id=?`).bind(Number(data.field_id),s.center_id).first();
    if (!field) return bad('Campo non valido');
    const startDate = String(data.start_date || ''), endDate = String(data.end_date || '');
    if (!startDate || !endDate) return bad('Compila il periodo');
    if (endDate < startDate) return bad('La data finale non può essere precedente a quella iniziale');

    let schedules = Array.isArray(data.schedules) ? data.schedules : [];
    if (!schedules.length && data.start_time !== undefined) schedules = [{ weekday: Number(data.weekday), start_time: data.start_time }];
    schedules = schedules
      .map(x => ({ weekday: Number(x.weekday), start_time: String(x.start_time || '') }))
      .filter(x => x.weekday >= 0 && x.weekday <= 6 && x.start_time);
    const seen = new Set();
    schedules = schedules.filter(x => {
      const k = `${x.weekday}|${x.start_time}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
    if (!schedules.length) return bad('Aggiungi almeno un giorno con orario');

    const available = [], conflicts = [];
    let guard = 0;
    for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
      if (++guard > 730) return bad('Il periodo massimo per le ricorrenze è di 730 giorni');
      const dow = getDayOfWeek(date);
      for (const schedule of schedules) {
        if (schedule.weekday !== dow) continue;
        const start = schedule.start_time;
        const end = timeFromMinutes(minutes(start) + Number(field.duration_minutes || 60));
        const item = { date, weekday: dow, start_time: start, end_time: end };
        if (await hasConflict(env, field.id, date, start, end)) conflicts.push(item);
        else available.push(item);
      }
    }
    if (action === 'manager-recurring-preview') return ok({ available, conflicts });

    const skip = new Set((data.skip_slots || []).map(String));
    const group = randomToken(8), created = [], finalConflicts = [...conflicts];
    for (const item of available) {
      const key = `${item.date}|${item.start_time}`;
      if (skip.has(key)) continue;
      if (await hasConflict(env, field.id, item.date, item.start_time, item.end_time)) {
        finalConflicts.push(item);
        continue;
      }
      const pricing = effectivePricing(field, item.date);
      await env.DB.prepare(`INSERT INTO bookings(center_id,field_id,customer_name,customer_phone,date,start_time,end_time,price_cents,payment_status,status,source,recurring_group,notes) VALUES(?,?,?,?,?,?,?,?,?,'confirmed','recurring',?,?)`)
        .bind(s.center_id,field.id,data.customer_name||data.group_name||'Convenzione',data.customer_phone||'',item.date,item.start_time,item.end_time,pricing.price_cents,data.payment_status||'due',group,data.notes||'').run();
      created.push(item);
    }
    return ok({ created, conflicts: finalConflicts, recurring_group: group });
  }


  if (action === 'manager-booking-bulk-cancel') {
    const s = await requireRole(request, env, ['manager']);
    if (!s) return bad('Non autorizzato', 401);
    let updated = 0;
    const group = String(data.recurring_group || '').trim();
    if (group) {
      const r = await env.DB.prepare(`
        UPDATE bookings SET status='cancelled'
        WHERE center_id=? AND recurring_group=? AND status!='cancelled'
      `).bind(s.center_id, group).run();
      updated = Number(r.meta?.changes || 0);
      return ok({ updated });
    }
    const ids = Array.isArray(data.ids) ? [...new Set(data.ids.map(Number).filter(Number.isFinite))].slice(0, 250) : [];
    if (!ids.length) return bad('Nessuna prenotazione selezionata');
    for (const id of ids) {
      const r = await env.DB.prepare(`
        UPDATE bookings SET status='cancelled'
        WHERE id=? AND center_id=? AND status!='cancelled'
      `).bind(id, s.center_id).run();
      updated += Number(r.meta?.changes || 0);
    }
    return ok({ updated });
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
