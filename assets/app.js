const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const app = $('#app');
const state = { center:null, fields:[], selectedField:null, selectedSlot:null, me:null, manager:null, centers:[] };
const money = c => new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format((c||0)/100);
const qs = new URLSearchParams(location.search);
const view = qs.get('view') || 'home';
const centerSlug = qs.get('center') || '';
const esc = s => String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'}[c]));
const today = () => new Date().toISOString().slice(0,10);

async function api(action, options={}){
  const res = await fetch(`/api?action=${action}`, {
    credentials:'include',
    ...options,
    headers:{'content-type':'application/json', ...(options.headers||{})}
  });
  const data = await res.json().catch(()=>({ok:false,error:'Risposta non valida'}));
  if(!res.ok || data.ok===false) throw new Error(data.error || 'Errore');
  return data;
}
function toast(message,type='ok'){
  const el=document.createElement('div');
  el.className=`notice toast ${type}`;
  el.textContent=message;
  document.body.append(el);
  setTimeout(()=>el.remove(),3200);
}
function setAccent(c){
  document.documentElement.style.setProperty('--accent',c||'#101828');
  document.querySelector('meta[name=theme-color]')?.setAttribute('content',c||'#101828');
}
function locationLabel(address=''){
  if(!address) return 'Centro sportivo';
  return address.split(',')[0].trim() || address;
}
function sportsLabel(sports=''){
  return String(sports||'').split(',').filter(Boolean).slice(0,3).join(' · ');
}

async function loadHome(){
  setAccent('#101828');
  const data = await api('public-centers');
  state.centers = data.centers || [];
  renderHome();
}
function renderHome(){
  app.innerHTML=`
    <main class="portal-shell">
      <header class="portal-header">
        <a class="portal-brand" href="/">
          <div class="portal-mark">S</div>
          <div><strong>Sport Booking</strong><span>Prenota il tuo campo</span></div>
        </a>
        <button class="btn ghost" id="accessBtn">Area riservata</button>
      </header>

      <section class="portal-hero">
        <div class="hero-kicker">PRENOTAZIONI SPORTIVE</div>
        <h1>Il tuo campo.<br><span>Quando vuoi.</span></h1>
        <p>Scegli il centro sportivo, controlla gli orari disponibili e prenota in pochi secondi.</p>
        <div class="search-wrap">
          <span class="search-icon">⌕</span>
          <input id="centerSearch" placeholder="Cerca centro, località o disciplina..." autocomplete="off">
        </div>
      </section>

      <section class="portal-section">
        <div class="section-head premium-head">
          <div><span class="eyebrow">CENTRI DISPONIBILI</span><h2>Scegli dove giocare</h2></div>
          <span class="counter">${state.centers.length} ${state.centers.length===1?'centro':'centri'}</span>
        </div>
        <div id="centerGrid" class="center-grid">${centerCards(state.centers)}</div>
      </section>

      <section class="access-section" id="accessSection">
        <div class="access-copy"><span class="eyebrow">AREA RISERVATA</span><h2>Gestisci la piattaforma</h2><p>L’accesso operativo è separato dall’esperienza di prenotazione degli utenti.</p></div>
        <div class="access-grid">
          <a class="access-card" href="/?view=login&type=manager"><div class="access-icon">G</div><div><strong>Pannello gestore</strong><span>Calendario, prenotazioni, blocchi e convenzioni.</span></div><b>→</b></a>
          <a class="access-card dark" href="/?view=login&type=admin"><div class="access-icon">A</div><div><strong>ADMIN piattaforma</strong><span>Centri, campi, accessi e configurazioni.</span></div><b>→</b></a>
        </div>
      </section>

      <footer class="portal-footer"><span>Sport Booking</span><span>Prenotazioni semplici. Gestione centralizzata.</span></footer>
    </main>`;

  $('#centerSearch').oninput = e => {
    const q=e.target.value.trim().toLowerCase();
    const filtered=state.centers.filter(c=>[c.name,c.address,c.sports,c.description].join(' ').toLowerCase().includes(q));
    $('#centerGrid').innerHTML=centerCards(filtered);
  };
  $('#accessBtn').onclick=()=>$('#accessSection').scrollIntoView({behavior:'smooth'});
}
function centerCards(list){
  if(!list.length) return `<div class="empty premium-empty">Nessun centro trovato.</div>`;
  return list.map(c=>`
    <a class="center-premium-card" href="/?center=${encodeURIComponent(c.slug)}">
      <div class="center-cover" ${c.cover_url?`style="background-image:url('${esc(c.cover_url)}')"`:''}>
        <div class="center-cover-shade"></div>
        <div class="location-badge">⌖ ${esc(locationLabel(c.address))}</div>
        <div class="center-logo">${c.logo_url?`<img src="${esc(c.logo_url)}" alt="">`:'S'}</div>
      </div>
      <div class="center-card-body">
        <div class="center-card-title"><div><h3>${esc(c.name)}</h3><p>${esc(c.address||'')}</p></div><span class="arrow-circle">→</span></div>
        <div class="center-meta"><span>${Number(c.fields_count||0)} ${Number(c.fields_count||0)===1?'campo':'campi'}</span>${c.sports?`<span>${esc(sportsLabel(c.sports))}</span>`:''}</div>
      </div>
    </a>`).join('');
}

async function loadPublic(){
  if(!centerSlug) return loadHome();
  const data=await api(`center&slug=${encodeURIComponent(centerSlug)}`);
  state.center=data.center; state.fields=data.fields;
  setAccent(state.center.accent_color);
  renderPublic();
}
function renderPublic(){
  const c=state.center;
  app.innerHTML=`<main class="center-app">
    <header class="center-topbar">
      <a class="back-home" href="/">← <span>Tutti i centri</span></a>
      <div class="center-brand"><div class="logo">${c.logo_url?`<img src="${esc(c.logo_url)}" alt="">`:'S'}</div><div><strong>${esc(c.name)}</strong><span>${esc(locationLabel(c.address))}</span></div></div>
      <a class="btn primary desktop-book" href="#book">Prenota</a>
    </header>

    <section class="center-hero" ${c.cover_url?`style="background-image:url('${esc(c.cover_url)}')"`:''}>
      <div class="center-hero-overlay"></div>
      <div class="center-hero-content">
        <span class="hero-chip">${esc(locationLabel(c.address))}</span>
        <h1>${esc(c.name)}</h1>
        <p>${esc(c.description||'Scegli il campo, controlla gli orari disponibili e prenota.')}</p>
        <div class="hero-actions"><a class="btn light" href="#book">Prenota un campo</a>${c.conventions_enabled?'<button class="btn glass" data-scroll="conventions">Convenzioni</button>':''}</div>
      </div>
    </section>

    <section class="center-section">
      <div class="section-head premium-head"><div><span class="eyebrow">CAMPI</span><h2>Scegli il tuo campo</h2></div></div>
      <div class="field-grid">${state.fields.length?state.fields.map(f=>`
        <article class="field-premium-card">
          <div class="field-top"><span class="sport-chip">${esc(f.sport)}</span><span class="field-state">Disponibile</span></div>
          <h3>${esc(f.name)}</h3>
          <p>${esc(f.surface||'Superficie non specificata')} · ${f.indoor?'Coperto':'Scoperto'}</p>
          <div class="field-bottom"><div><strong>${money(f.price_cents)}</strong><span>${f.duration_minutes} min</span></div><button class="round-action" data-book-field="${f.id}">→</button></div>
        </article>`).join(''):'<div class="empty">Nessun campo disponibile.</div>'}</div>
    </section>

    <section class="booking-premium" id="book">
      <div class="booking-intro"><span class="eyebrow">PRENOTAZIONE</span><h2>Prenota in pochi secondi</h2><p>Seleziona campo, giorno e orario. Il pagamento avviene direttamente con il gestore.</p></div>
      <div class="booking-panel">
        <div class="form-grid">
          <div class="field"><label>Campo</label><select class="input" id="fieldSelect"><option value="">Seleziona un campo</option>${state.fields.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.sport)}</option>`).join('')}</select></div>
          <div class="field"><label>Data</label><input class="input" type="date" id="bookingDate" min="${today()}"></div>
        </div>
        <div id="slots" class="slots premium-slots"></div>
        <div id="customerFields" class="customer-step hidden">
          <div class="selected-time" id="selectedTime"></div>
          <div class="form-grid">
            <div class="field"><label>Nome</label><input class="input" id="customerName" placeholder="Nome e cognome"></div>
            <div class="field"><label>Telefono</label><input class="input" id="customerPhone" inputmode="tel" placeholder="Numero di telefono"></div>
            <div class="field full"><label>Email <span class="muted">(facoltativa)</span></label><input class="input" id="customerEmail" type="email" placeholder="Email"></div>
            <div class="field full"><button class="btn primary full-btn" id="confirmBooking">Conferma prenotazione</button></div>
          </div>
        </div>
      </div>
    </section>

    ${c.conventions_enabled?`<section class="center-section" id="conventions">
      <div class="convention-box">
        <div class="convention-copy"><span class="eyebrow">GRUPPI E SQUADRE</span><h2>Convenzioni sportive</h2><p>Per utilizzi ricorrenti puoi inviare una richiesta al gestore indicando giorni, orari e periodo.</p><div class="row">${c.whatsapp?`<a class="btn primary" target="_blank" href="https://wa.me/${String(c.whatsapp).replace(/\D/g,'')}?text=${encodeURIComponent('Ciao, vorrei informazioni sulle convenzioni sportive.')}">WhatsApp</a>`:''}${c.phone?`<a class="btn" href="tel:${esc(c.phone)}">Chiama</a>`:''}</div></div>
        <form class="convention-form" id="conventionForm">
          <div class="form-grid"><div class="field"><label>Gruppo / squadra</label><input class="input" name="group_name" required></div><div class="field"><label>Referente</label><input class="input" name="contact_name" required></div><div class="field"><label>Telefono</label><input class="input" name="phone" required></div><div class="field"><label>Campo</label><select class="input" name="field_id"><option value="">Da concordare</option>${state.fields.map(f=>`<option value="${f.id}">${esc(f.name)}</option>`).join('')}</select></div><div class="field"><label>Giorni preferiti</label><input class="input" name="preferred_days" placeholder="Es. mercoledì"></div><div class="field"><label>Orario</label><input class="input" name="preferred_times" placeholder="Es. 20:00–21:00"></div><div class="field"><label>Frequenza</label><input class="input" name="frequency" placeholder="Es. ogni settimana"></div><div class="field"><label>Periodo</label><input class="input" name="period_text" placeholder="Es. ottobre–maggio"></div><div class="field full"><label>Note</label><textarea class="input" name="notes" rows="3"></textarea></div><div class="field full"><button class="btn primary full-btn">Invia richiesta</button></div></div>
        </form>
      </div>
    </section>`:''}

    <footer class="center-footer"><div><strong>${esc(c.name)}</strong><span>${esc(c.address||'')}</span></div><div class="row">${c.phone?`<a href="tel:${esc(c.phone)}">${esc(c.phone)}</a>`:''}${c.email?`<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`:''}</div></footer>
    <nav class="customer-mobile-nav"><a href="/">Centri</a><a class="active" href="#book">Prenota</a>${c.conventions_enabled?'<a href="#conventions">Convenzioni</a>':''}</nav>
  </main>`;
  bindPublic();
}
function bindPublic(){
  $$('[data-scroll]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));
  $$('[data-book-field]').forEach(b=>b.onclick=()=>{ $('#fieldSelect').value=b.dataset.bookField; $('#book').scrollIntoView({behavior:'smooth'}); $('#bookingDate').focus(); loadSlots(); });
  $('#fieldSelect').onchange=loadSlots;
  $('#bookingDate').onchange=loadSlots;
  $('#confirmBooking').onclick=confirmBooking;
  $('#conventionForm')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.currentTarget));
    try{await api('convention',{method:'POST',body:JSON.stringify({...fd,center_id:state.center.id})});e.currentTarget.reset();toast('Richiesta inviata al gestore');}catch(err){toast(err.message,'error')}
  });
}
async function loadSlots(){
  const fieldId=$('#fieldSelect').value,date=$('#bookingDate').value;
  state.selectedSlot=null;
  $('#customerFields').classList.add('hidden');
  $('#selectedTime').textContent='';
  if(!fieldId||!date){$('#slots').innerHTML='';return}
  try{
    const data=await api(`availability&field_id=${fieldId}&date=${date}`);
    state.selectedField=data.field;
    $('#slots').innerHTML=`<div class="slots-label">Orari disponibili</div>${data.slots.map(s=>`<button class="slot" ${s.available?'':'disabled'} data-slot="${s.start}" data-end="${s.end}">${s.start}</button>`).join('')}`;
    $$('.slot:not(:disabled)').forEach(b=>b.onclick=()=>{
      $$('.slot').forEach(x=>x.classList.remove('selected'));
      b.classList.add('selected');
      state.selectedSlot=b.dataset.slot;
      $('#selectedTime').textContent=`${state.selectedField.name} · ${date.split('-').reverse().join('/')} · ${b.dataset.slot}–${b.dataset.end}`;
      $('#customerFields').classList.remove('hidden');
      $('#customerFields').scrollIntoView({behavior:'smooth',block:'nearest'});
    });
  }catch(e){toast(e.message,'error')}
}
async function confirmBooking(){
  if(!state.selectedSlot) return;
  const payload={
    field_id:Number($('#fieldSelect').value), date:$('#bookingDate').value, start_time:state.selectedSlot,
    customer_name:$('#customerName').value, customer_phone:$('#customerPhone').value, customer_email:$('#customerEmail').value
  };
  try{
    await api('booking',{method:'POST',body:JSON.stringify(payload)});
    toast('Prenotazione confermata');
    await loadSlots();
    $('#customerName').value=''; $('#customerPhone').value=''; $('#customerEmail').value='';
  }catch(e){toast(e.message,'error')}
}

function renderLogin(){
  const type=qs.get('type')||'manager';
  const isAdmin=type==='admin';
  setAccent('#101828');
  app.innerHTML=`<div class="login-page">
    <a class="login-back" href="/">← Torna ai centri</a>
    <div class="login-shell">
      <div class="login-copy"><div class="portal-mark">S</div><span class="eyebrow">AREA RISERVATA</span><h1>${isAdmin?'ADMIN piattaforma':'Pannello gestore'}</h1><p>${isAdmin?'Gestisci centri, campi, accessi e configurazioni della piattaforma.':'Gestisci calendario, prenotazioni, blocchi e richieste del tuo centro.'}</p></div>
      <form class="login-card" id="loginForm"><h2>Accedi</h2><p class="muted">Inserisci le tue credenziali.</p><div class="stack"><div class="field"><label>Email</label><input class="input" type="email" name="email" required autocomplete="username"></div><div class="field"><label>Password</label><input class="input" type="password" name="password" required autocomplete="current-password"></div><button class="btn primary full-btn">Accedi</button></div></form>
    </div>
  </div>`;
  $('#loginForm').onsubmit=async e=>{
    e.preventDefault();
    const fd=Object.fromEntries(new FormData(e.currentTarget));
    try{const r=await api('login',{method:'POST',body:JSON.stringify(fd)});location.href=r.role==='admin'?'/?view=admin':'/?view=manager';}catch(err){toast(err.message,'error')}
  };
}
async function loadMe(){try{const r=await api('me');state.me=r.session;return r.session}catch{return null}}
function layout(role,title,content){return `<div class="app-layout"><aside class="sidebar"><a class="side-brand" href="/"><div class="logo">S</div><div><strong>Sport Booking</strong><span>${role==='admin'?'ADMIN':'GESTORE'}</span></div></a><nav class="side-nav"><button class="active">${role==='admin'?'Centri':'Dashboard'}</button><a href="/">Apri portale</a><button id="logoutBtn">Esci</button></nav></aside><main class="workspace"><div class="workspace-top"><div><span class="eyebrow">${role==='admin'?'PIATTAFORMA':'PANNELLO GESTORE'}</span><h1>${esc(title)}</h1></div><button class="btn" id="logoutTop">Esci</button></div>${content}</main></div>`}
function bindLogout(){['#logoutBtn','#logoutTop'].forEach(id=>$(id)?.addEventListener('click',async()=>{await api('logout',{method:'POST',body:'{}'});location.href='/'}))}
function modal(html){const el=document.createElement('div');el.className='modal';el.innerHTML=`<div class="modal-card">${html}</div>`;document.body.append(el);return el}

async function loadAdmin(){
  const me=await loadMe(); if(!me||me.role!=='admin') return renderLogin();
  const d=await api('admin-centers'); state.centers=d.centers;
  const active=d.centers.filter(c=>c.active).length;
  const content=`<div class="row admin-actions"><button class="btn primary" id="newCenter">+ Nuovo centro</button><button class="btn" id="newManager">+ Gestore</button><button class="btn" id="newField">+ Campo</button></div>
    <div class="stats"><div class="card stat"><span class="muted">Centri</span><strong>${d.centers.length}</strong></div><div class="card stat"><span class="muted">Attivi</span><strong>${active}</strong></div><div class="card stat"><span class="muted">Campi</span><strong>${d.centers.reduce((a,c)=>a+Number(c.fields_count||0),0)}</strong></div><div class="card stat"><span class="muted">Prenotazioni</span><strong>${d.centers.reduce((a,c)=>a+Number(c.bookings_count||0),0)}</strong></div></div>
    <section class="card admin-list"><div class="section-head"><div><h2>Centri sportivi</h2><p class="muted">Ogni centro ha la propria app e il proprio gestore.</p></div></div><div class="stack">${d.centers.length?d.centers.map(c=>`<div class="admin-center-row"><div class="center-card"><div class="logo">${c.logo_url?`<img src="${esc(c.logo_url)}">`:'S'}</div><div><strong>${esc(c.name)}</strong><div class="muted">${esc(c.address||'Località non impostata')} · ${c.fields_count} campi</div></div></div><div class="spacer"></div><span class="status ${c.active?'confirmed':'cancelled'}">${c.active?'Attivo':'Disattivato'}</span><a class="btn small" target="_blank" href="/?center=${encodeURIComponent(c.slug)}">Apri app</a><button class="btn small" data-edit-center="${c.id}">Modifica</button></div>`).join(''):'<div class="empty">Nessun centro.</div>'}</div></section>`;
  app.innerHTML=layout('admin','Centri sportivi',content); bindLogout(); bindAdmin();
}
function bindAdmin(){
  $('#newCenter').onclick=()=>centerForm();
  $('#newManager').onclick=()=>managerForm();
  $('#newField').onclick=()=>fieldForm();
  $$('[data-edit-center]').forEach(b=>b.onclick=()=>centerForm(state.centers.find(c=>c.id==b.dataset.editCenter)));
}
function centerForm(c={}){
  const m=modal(`<div class="section-head"><h2>${c.id?'Modifica centro':'Nuovo centro'}</h2><button class="btn small" data-close>Chiudi</button></div><form id="centerForm" class="form-grid"><input type="hidden" name="id" value="${c.id||''}"><div class="field"><label>Nome centro</label><input class="input" name="name" value="${esc(c.name||'')}" required></div><div class="field"><label>Slug</label><input class="input" name="slug" value="${esc(c.slug||'')}" placeholder="campizzi" required></div><div class="field"><label>Colore</label><input class="input color-input" type="color" name="accent_color" value="${c.accent_color||'#111827'}"></div><div class="field"><label>Località / indirizzo</label><input class="input" name="address" value="${esc(c.address||'')}" placeholder="Es. Mesoraca, CZ"></div><div class="field"><label>Logo URL</label><input class="input" name="logo_url" value="${esc(c.logo_url||'')}"></div><div class="field"><label>Copertina URL</label><input class="input" name="cover_url" value="${esc(c.cover_url||'')}"></div><div class="field"><label>Telefono</label><input class="input" name="phone" value="${esc(c.phone||'')}"></div><div class="field"><label>WhatsApp</label><input class="input" name="whatsapp" value="${esc(c.whatsapp||'')}"></div><div class="field full"><label>Email</label><input class="input" name="email" value="${esc(c.email||'')}"></div><div class="field full"><label>Descrizione</label><textarea class="input" name="description" rows="3">${esc(c.description||'')}</textarea></div><label class="check"><input type="checkbox" name="conventions_enabled" ${c.conventions_enabled!==0?'checked':''}> Convenzioni</label><label class="check"><input type="checkbox" name="recurring_enabled" ${c.recurring_enabled!==0?'checked':''}> Ricorrenti</label><label class="check"><input type="checkbox" name="active" ${c.active!==0?'checked':''}> Centro attivo</label><div class="field full"><button class="btn primary full-btn">Salva centro</button></div></form>`);
  $('[data-close]',m).onclick=()=>m.remove();
  $('#centerForm',m).onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.currentTarget));fd.id=Number(fd.id||0);fd.conventions_enabled=e.currentTarget.conventions_enabled.checked;fd.recurring_enabled=e.currentTarget.recurring_enabled.checked;fd.active=e.currentTarget.active.checked;try{await api('admin-center-save',{method:'POST',body:JSON.stringify(fd)});m.remove();toast('Centro salvato');loadAdmin()}catch(err){toast(err.message,'error')}};
}
function managerForm(){
  const m=modal(`<div class="section-head"><h2>Nuovo gestore</h2><button class="btn small" data-close>Chiudi</button></div><form id="managerForm" class="form-grid"><div class="field full"><label>Centro</label><select class="input" name="center_id">${state.centers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>Nome</label><input class="input" name="name" required></div><div class="field"><label>Email</label><input class="input" name="email" type="email" required></div><div class="field full"><label>Password iniziale</label><input class="input" name="password" required></div><div class="field full"><button class="btn primary full-btn">Crea accesso</button></div></form>`);
  $('[data-close]',m).onclick=()=>m.remove();
  $('#managerForm',m).onsubmit=async e=>{e.preventDefault();try{await api('admin-manager-create',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });m.remove();toast('Gestore creato')}catch(err){toast(err.message,'error')}};
}
function fieldForm(){
  const m=modal(`<div class="section-head"><h2>Nuovo campo</h2><button class="btn small" data-close>Chiudi</button></div><form id="fieldForm" class="form-grid"><div class="field full"><label>Centro</label><select class="input" name="center_id">${state.centers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div class="field"><label>Nome campo</label><input class="input" name="name" required></div><div class="field"><label>Disciplina</label><input class="input" name="sport" placeholder="Padel, calcio a 7..." required></div><div class="field"><label>Superficie</label><input class="input" name="surface"></div><div class="field"><label>Prezzo €</label><input class="input" type="number" step=".01" name="price" required></div><div class="field"><label>Durata (min)</label><input class="input" type="number" name="duration_minutes" value="60"></div><div class="field"><label>Apertura</label><input class="input" type="time" name="opening_time" value="08:00"></div><div class="field"><label>Chiusura</label><input class="input" type="time" name="closing_time" value="23:00"></div><label class="check"><input type="checkbox" name="indoor"> Coperto</label><div class="field full"><button class="btn primary full-btn">Aggiungi campo</button></div></form>`);
  $('[data-close]',m).onclick=()=>m.remove();
  $('#fieldForm',m).onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.currentTarget));fd.indoor=e.currentTarget.indoor.checked;try{await api('admin-field-save',{method:'POST',body:JSON.stringify(fd)});m.remove();toast('Campo creato');loadAdmin()}catch(err){toast(err.message,'error')}};
}

async function loadManager(){
  const me=await loadMe(); if(!me||me.role!=='manager') return renderLogin();
  const d=await api('manager-dashboard'); state.manager=d; setAccent(d.center.accent_color);
  const t=today(), upcoming=d.bookings.filter(b=>b.date>=t&&b.status!=='cancelled');
  const content=`<div class="row admin-actions"><button class="btn primary" id="manualBooking">+ Prenotazione</button>${d.center.recurring_enabled?'<button class="btn" id="recurringBooking">+ Ricorrente</button>':''}<a class="btn" target="_blank" href="/?center=${encodeURIComponent(d.center.slug)}">Apri app centro</a></div>
    <div class="stats"><div class="card stat"><span class="muted">Prossime</span><strong>${upcoming.length}</strong></div><div class="card stat"><span class="muted">Oggi</span><strong>${upcoming.filter(b=>b.date===t).length}</strong></div><div class="card stat"><span class="muted">Da incassare</span><strong>${upcoming.filter(b=>b.payment_status==='due'&&b.status==='confirmed').length}</strong></div><div class="card stat"><span class="muted">Convenzioni</span><strong>${d.conventions.filter(x=>x.status==='new').length}</strong></div></div>
    <section class="card"><div class="section-head"><div><h2>Calendario prenotazioni</h2><div class="muted">Prenotazioni app, telefoniche e ricorrenti.</div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Data</th><th>Ora</th><th>Campo</th><th>Cliente</th><th>Pagamento</th><th>Stato</th><th></th></tr></thead><tbody>${d.bookings.map(b=>`<tr><td>${b.date}</td><td>${b.start_time}–${b.end_time}</td><td>${esc(b.field_name)}</td><td>${esc(b.customer_name)}<div class="muted">${esc(b.customer_phone)}</div></td><td><span class="status ${b.payment_status}">${b.payment_status==='paid'?'Pagato':'Da pagare'}</span></td><td><span class="status ${b.status}">${b.status}</span></td><td><div class="row"><button class="btn small" data-paid="${b.id}">${b.payment_status==='paid'?'Da pagare':'Segna pagato'}</button>${b.status!=='cancelled'?`<button class="btn small danger" data-cancel="${b.id}">Annulla</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></section>
    ${d.center.conventions_enabled?`<section class="card section"><div class="section-head"><div><h2>Richieste convenzione</h2><div class="muted">Gestisci le richieste prima di creare la ricorrenza.</div></div></div><div class="stack">${d.conventions.length?d.conventions.map(x=>`<div class="card"><div class="row"><div><strong>${esc(x.group_name)}</strong><div class="muted">${esc(x.contact_name)} · ${esc(x.phone)} · ${esc(x.field_name||'Campo da concordare')}</div><div style="margin-top:8px">${esc(x.preferred_days)} ${esc(x.preferred_times)} · ${esc(x.frequency)} · ${esc(x.period_text)}</div></div><div class="spacer"></div><select class="input compact" data-conv="${x.id}"><option value="new" ${x.status==='new'?'selected':''}>Nuova</option><option value="negotiating" ${x.status==='negotiating'?'selected':''}>In trattativa</option><option value="accepted" ${x.status==='accepted'?'selected':''}>Accettata</option><option value="rejected" ${x.status==='rejected'?'selected':''}>Rifiutata</option></select></div></div>`).join(''):'<div class="empty">Nessuna richiesta.</div>'}</div></section>`:''}`;
  app.innerHTML=layout('manager',d.center.name,content); bindLogout(); bindManager();
}
function bindManager(){
  $('#manualBooking').onclick=()=>bookingModal(false);
  $('#recurringBooking')?.addEventListener('click',()=>bookingModal(true));
  $$('[data-paid]').forEach(b=>b.onclick=async()=>{const row=state.manager.bookings.find(x=>x.id==b.dataset.paid);await api('manager-booking-status',{method:'POST',body:JSON.stringify({id:row.id,payment_status:row.payment_status==='paid'?'due':'paid'})});loadManager()});
  $$('[data-cancel]').forEach(b=>b.onclick=async()=>{if(!confirm('Annullare questa prenotazione?'))return;await api('manager-booking-status',{method:'POST',body:JSON.stringify({id:Number(b.dataset.cancel),status:'cancelled'})});loadManager()});
  $$('[data-conv]').forEach(s=>s.onchange=async()=>{await api('manager-convention-status',{method:'POST',body:JSON.stringify({id:Number(s.dataset.conv),status:s.value})});toast('Stato aggiornato')});
}
function bookingModal(recurring){
  const d=state.manager;
  const m=modal(`<div class="section-head"><h2>${recurring?'Prenotazione ricorrente':'Nuova prenotazione'}</h2><button class="btn small" data-close>Chiudi</button></div><form id="bookingForm" class="form-grid"><div class="field full"><label>Campo</label><select class="input" name="field_id">${d.fields.filter(f=>f.active).map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.sport)}</option>`).join('')}</select></div><div class="field"><label>Nome cliente / gruppo</label><input class="input" name="customer_name" required></div><div class="field"><label>Telefono</label><input class="input" name="customer_phone"></div>${recurring?`<div class="field"><label>Dal</label><input class="input" type="date" name="start_date" required></div><div class="field"><label>Al</label><input class="input" type="date" name="end_date" required></div><div class="field full"><label>Giorno</label><select class="input" name="weekday"><option value="1">Lunedì</option><option value="2">Martedì</option><option value="3">Mercoledì</option><option value="4">Giovedì</option><option value="5">Venerdì</option><option value="6">Sabato</option><option value="0">Domenica</option></select></div>`:`<div class="field full"><label>Data</label><input class="input" type="date" name="date" required></div>`}<div class="field"><label>Dalle</label><input class="input" type="time" name="start_time" required></div><div class="field"><label>Alle <span class="muted">(facoltativo)</span></label><input class="input" type="time" name="end_time"></div><div class="field"><label>Prezzo €</label><input class="input" type="number" step=".01" name="price"></div><div class="field"><label>Pagamento</label><select class="input" name="payment_status"><option value="due">Da pagare</option><option value="paid">Pagato</option></select></div>${!recurring?'<label class="check"><input type="checkbox" name="blocked"> Blocca orario (chiusura/manutenzione)</label>':''}<div class="field full"><label>Note</label><textarea class="input" name="notes"></textarea></div><div class="field full"><button class="btn primary full-btn">${recurring?'Controlla e crea ricorrenza':'Salva prenotazione'}</button></div></form>`);
  $('[data-close]',m).onclick=()=>m.remove();
  $('#bookingForm',m).onsubmit=async e=>{e.preventDefault();const fd=Object.fromEntries(new FormData(e.currentTarget));if(!recurring)fd.blocked=e.currentTarget.blocked.checked;try{const r=await api(recurring?'manager-recurring':'manager-booking',{method:'POST',body:JSON.stringify(fd)});m.remove();if(recurring&&r.conflicts?.length)toast(`${r.created.length} date create, ${r.conflicts.length} conflitti saltati`);else toast('Prenotazione salvata');loadManager()}catch(err){toast(err.message,'error')}};
}

(async()=>{
  try{
    if(view==='login') renderLogin();
    else if(view==='admin') await loadAdmin();
    else if(view==='manager') await loadManager();
    else if(centerSlug) await loadPublic();
    else await loadHome();
  }catch(e){
    app.innerHTML=`<div class="login-wrap"><div class="login-card"><h1>Errore</h1><p class="muted">${esc(e.message)}</p><a class="btn" href="/">Torna alla Home</a></div></div>`;
  }
})();
