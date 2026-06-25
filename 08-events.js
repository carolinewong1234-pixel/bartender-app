// ═══ EVENT MANAGEMENT ═══
// Event categories, presets, creation flow, menu step management,
// event library CRUD, status tracking, save/load

const STATUS_CONFIG = {
  draft:     { label:'📝 Draft',     color:'#888',    bg:'#f5f5f0' },
  sent:      { label:'📤 Sent',      color:'#2156b8', bg:'#e8f0fd' },
  confirmed: { label:'✅ Confirmed', color:'#1a7a4a', bg:'#edfaf3' },
  completed: { label:'🎉 Completed', color:'#1a7a4a', bg:'#d4f5e4' },
  cancelled: { label:'❌ Cancelled', color:'#c0392b', bg:'#fdf0ef' },
  rejected:  { label:'🚫 Rejected',  color:'#888',    bg:'#f5f5f0' }
};

function getStatusConfig(status){
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
}

function updateStatusBadge(){
  const status = v('quoteStatus') || 'draft';
  const cfg = getStatusConfig(status);
  const badge = el('statusBadge');
  if(badge){
    badge.textContent = cfg.label;
    badge.style.background = cfg.bg;
    badge.style.color = cfg.color;
    badge.style.display = status !== 'draft' ? '' : 'none'; // hide when draft (default)
  }
}

function renderEventsTab(){
  const filterStatus = v('evFilterStatus') || 'all';
  const query = (v('evlibSearch') || '').toLowerCase().trim();

  const filtered = eventLibrary.filter(e => {
    const matchStatus = filterStatus === 'all' || (e.status || 'draft') === filterStatus;
    const matchQuery = !query ||
      (e.label || '').toLowerCase().includes(query) ||
      (e.eventDate || '').includes(query);
    return matchStatus && matchQuery;
  });

  // Status metrics
  const counts = {};
  eventLibrary.forEach(e => {
    const s = e.status || 'draft';
    counts[s] = (counts[s] || 0) + 1;
  });
  const confirmedRevenue = eventLibrary
    .filter(e => (e.status||'draft') === 'confirmed' || (e.status||'draft') === 'completed')
    .reduce((s,e) => s + (e.quotedTotal || 0), 0);

  shtml('evStatusMetrics', `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:1rem;">
      ${Object.entries(STATUS_CONFIG).map(([k,cfg]) => `
        <div style="text-align:center;padding:8px;border-radius:8px;background:${cfg.bg};cursor:pointer;"
          onclick="sv('evFilterStatus','${k}');renderEventsTab()">
          <div style="font-size:18px;margin-bottom:2px;">${counts[k]||0}</div>
          <div style="font-size:10px;color:${cfg.color};font-weight:500;">${cfg.label.replace(/^[^ ]+ /,'')}</div>
        </div>`).join('')}
    </div>
    ${confirmedRevenue > 0 ? `<div style="font-size:13px;background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;color:#1a7a4a;margin-bottom:1rem;">
      ✅ Confirmed pipeline: <strong>$${confirmedRevenue.toFixed(2)} CAD</strong> across ${(counts.confirmed||0)+(counts.completed||0)} event(s)
    </div>` : ''}`);

  // Multi-event shopping banner (confirmed events only)
  const confirmedEvents = eventLibrary.filter(e => (e.status||'draft') === 'confirmed');
  if(confirmedEvents.length > 1){
    shtml('multiShopBanner', `
      <div style="background:#e8f0fd;border:1px solid #b5d4f4;border-radius:10px;padding:10px 14px;">
        <div style="font-size:13px;font-weight:600;color:#2156b8;margin-bottom:4px;">
          🛒 ${confirmedEvents.length} confirmed events — combine shopping lists?
        </div>
        <div style="font-size:12px;color:#2156b8;margin-bottom:8px;">
          ${confirmedEvents.map(e => e.label).join(' + ')} — reduce shopping trips by buying for all at once.
        </div>
        <div id="combinedDeadlineLine" style="font-size:12px;color:#2156b8;margin-bottom:8px;font-weight:500;"></div>
        <button class="btn btn-sm" onclick="exportCombinedShoppingList()" style="font-size:12px;background:#fff;border-color:#b5d4f4;color:#2156b8;">
          📱 Export combined shopping list
        </button>
      </div>`);
    el('multiShopBanner').style.display = 'block';
  } else {
    shtml('multiShopBanner', '');
    const b = el('multiShopBanner');
    if(b) b.style.display = 'none';
  }

  if(!eventLibrary.length){
    shtml('eventsTabList', '<div class="empty" style="padding:2rem;text-align:center;color:#aaa;">No saved events yet — build an event and click 💾 Save event to add it here.</div>');
    return;
  }
  if(!filtered.length){
    shtml('eventsTabList', '<div style="padding:1.5rem;text-align:center;color:#aaa;font-size:13px;">No events match that filter.</div>');
    return;
  }

  renderShoppingDeadline();
  shtml('eventsTabList', filtered.map(e => {
    const cfg = getStatusConfig(e.status || 'draft');
    const dateStr = e.eventDate
      ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})
      : '—';
    const savedStr = new Date(e.savedAt).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
    const isActive = v('eventLabel') === e.label;
    return `<div style="border:${isActive?'2px solid #1a7a4a':'1px solid #e5e5e0'};border-radius:10px;background:${isActive?'#f0faf5':'#fff'};padding:12px 14px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:14px;">${e.label}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;background:${cfg.bg};color:${cfg.color};">${cfg.label}</span>
          ${isActive ? '<span style="font-size:10px;background:#1a7a4a;color:#fff;padding:2px 7px;border-radius:20px;">current</span>' : ''}
        </div>
        <div style="font-size:12px;color:#aaa;">${dateStr} · ${e.guests||'—'} guests · ${e.cocktailCount||0} cocktails${e.quotedTotal?' · $'+e.quotedTotal.toFixed(2)+' CAD':''} · saved ${savedStr}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;min-width:100px;">
        <select onchange="updateEventStatus('${e.id}',this.value)" style="font-size:11px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">
          ${Object.entries(STATUS_CONFIG).map(([k,sc]) => `<option value="${k}"${(e.status||'draft')===k?' selected':''}>${sc.label}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" data-id="${e.id}" onclick="loadEventFromLibrary(this.dataset.id)" style="font-size:11px;">Load</button>
        <button class="btn btn-sm btn-danger" data-id="${e.id}" onclick="deleteEventFromLibrary(this.dataset.id)" style="font-size:11px;">✕ Delete</button>
      </div>
    </div>`;
  }).join(''));
}

// updateEventStatus — defined later in this file (full version with toast + state sync)

const DEFAULT_CATEGORIES = [
  {
    id: 'wedding', name: 'Wedding', icon: '💑',
    desc: 'Full reception bar service — custom cocktail menu, His & Hers',
    defaults: { gc:100, eventHrs:5, drinksPerPerson:6, bufferPct:0, hr:120, mp:50, tf:75 },
    notes: 'Includes full bar setup/breakdown, custom cocktail menu, all equipment and garnishes.'
  },
  {
    id: 'cocktail_hour', name: 'Cocktail hour', icon: '🥂',
    desc: 'Pre-dinner drinks service — shorter, lighter menu',
    defaults: { gc:60, eventHrs:2, drinksPerPerson:3, bufferPct:0, hr:100, mp:45, tf:50 },
    notes: 'Cocktail hour service — setup, 2hr service, and breakdown included.'
  },
  {
    id: 'corporate', name: 'Corporate event', icon: '🏢',
    desc: 'Corporate cocktail party or end-of-year celebration',
    defaults: { gc:80, eventHrs:3, drinksPerPerson:4, bufferPct:0, hr:110, mp:45, tf:60 },
    notes: 'Corporate bar service — professional setup, cocktail menu as quoted.'
  },
  {
    id: 'birthday', name: 'Birthday / private party', icon: '🎂',
    desc: 'Private home or venue party',
    defaults: { gc:40, eventHrs:4, drinksPerPerson:5, bufferPct:0, hr:100, mp:40, tf:40 },
    notes: 'Private event bar service — all equipment and supplies included.'
  },
  {
    id: 'flair_show', name: 'Flair show + bar', icon: '🔥',
    desc: 'Premium flair bartending performance with full bar',
    defaults: { gc:75, eventHrs:3, drinksPerPerson:4, bufferPct:0, hr:150, mp:60, tf:75 },
    notes: 'Premium flair bartending service — custom show, full bar, all equipment.'
  },
  {
    id: 'brunch', name: 'Brunch / daytime', icon: '🍊',
    desc: 'Brunch cocktails, mimosas, Bloody Marys — lighter spirits',
    defaults: { gc:30, eventHrs:2, drinksPerPerson:3, bufferPct:0, hr:90, mp:40, tf:30 },
    notes: 'Brunch bar service — fresh juices, light cocktails, all supplies included.'
  }
];

// User-customizable categories stored in localStorage
let eventCategories = [];

function loadEventCategories(){
  try {
    const stored = localStorage.getItem('bartender_categories_v1');
    if(stored) eventCategories = JSON.parse(stored);
    else eventCategories = DEFAULT_CATEGORIES.map(c => ({...c})); // seed from defaults
  } catch(e){ eventCategories = DEFAULT_CATEGORIES.map(c => ({...c})); }
}

function saveEventCategories(){
  try { localStorage.setItem('bartender_categories_v1', JSON.stringify(eventCategories)); }
  catch(e){}
}

function openNewEventDialog(){
  cnManuallyEdited = false;
  renderCategoryPicker();
  // Clear name input and focus it
  const inp = el('newEvName');
  if(inp){ inp.value = ''; }
  el('newEventModalBg').classList.add('open');
  setTimeout(() => { if(inp) inp.focus(); }, 150);
}

function showBufferExplainer(e){
  if(e) e.stopPropagation();
  const pct = vf('bufferPct') || 0;
  const dpp = vf('drinksPerPerson') || 5;
  const guests = vi('gc') || 50;
  const base = dpp * guests;
  const extra = Math.round(base * pct / 100);
  const total = base + extra;
  showToast(
    pct + '% buffer = ' + extra + ' extra drinks on top of ' + base + ' base → ' + total + ' total. Covers spillage, generous pours & last-minute guests.',
    'success'
  );
}


const EVENT_PRESETS = {
  wedding_large:   { label:'Wedding', guests:120, hrs:7, rate:110, margin:65, travel:80,  dpg:6, buffer:10, notes:'Includes cocktail hour, dinner service, late night bar' },
  wedding_small:   { label:'Wedding', guests:45,  hrs:6, rate:100, margin:60, travel:60,  dpg:5, buffer:10, notes:'Intimate ceremony and reception' },
  corporate:       { label:'Corporate event', guests:80, hrs:4, rate:100, margin:60, travel:60, dpg:3, buffer:5,  notes:'Professional service, non-alcoholic options required' },
  birthday:        { label:'Birthday party', guests:40, hrs:5, rate:90,  margin:55, travel:40, dpg:5, buffer:8,  notes:'Signature cocktail + classics' },
  bachelorette:    { label:'Bachelorette', guests:15, hrs:4, rate:85,  margin:55, travel:40, dpg:6, buffer:5,  notes:'Customized cocktail experience' },
  pop_up:          { label:'Pop-up bar', guests:150,hrs:6, rate:100, margin:65, travel:0,  dpg:2, buffer:15, notes:'High volume, fast service' },
  private:         { label:'Private party', guests:30, hrs:4, rate:90,  margin:55, travel:40, dpg:4, buffer:5,  notes:'' },
};
let selectedPreset = null;

function confirmNewEvent(){
  const name = (el('newEvName') ? el('newEvName').value.trim() : '') || 'New event';

  // ── Always save current event first (even if no cocktails yet) ──
  const currentLabel = v('eventLabel');
  if(currentLabel && currentLabel.trim() && currentLabel !== 'Untitled event'){
    saveEventToLibrary(true); // silent save
  }

  // ── Reset currentEventId so new event gets a fresh ID ──
  currentEventId = null;

  // ── Reset to blank state ──
  cocktails = [];
  nIng = [];
  staffList = [];
  sv('eventLabel', name);
  sv('quoteStatus', 'draft');
  sv('cn', '');
  sv('ed', '');
  // Apply preset if selected, otherwise use defaults
  const _p = selectedPreset ? (EVENT_PRESETS[selectedPreset]||{}) : {};
  sv('gc',           String(_p.guests     || 50));
  sv('eventHrs',     String(_p.hrs        || 4));
  sv('hr',           String(_p.rate       || 100));
  sv('mp',           String(_p.margin     || 35));
  sv('tf',           String(_p.travel     || 0));
  sv('drinksPerPerson', String(_p.dpg     || 5));
  sv('bufferPct',    String(_p.buffer     || 0));
  sv('discountAmt',  '0');
  sv('discountPct',  '0');
  sv('depositAmt',   '0');
  sv('qn',           _p.notes || '');
  selectedPreset = null; // reset for next time
  cnManuallyEdited = false;
  closeNewEventDialog();
  syncSettings();
  rC(); rNI(); rShop(); rQ();
  updateStatusBadge();
  updateMpEquiv();

  // ── Save new event immediately as draft ──
  saveEventToLibrary(true); // sets currentEventId

  // ── Update lastSavedState so no false unsaved-changes warning ──
  if(typeof getSimpleState === 'function') lastSavedState = getSimpleState();

  showToast(name + ' created ✓', 'success');
  // Switch to menu tab and show the type selector (step 1)
  const menuBtn = el('st-menu');
  if(menuBtn) sw('menu', menuBtn);
  // Pre-fill name field in inline selector
  const menuName = el('menuEvName');
  if(menuName) menuName.value = name;
  // Show step 1 (type selector) directly
  menuEventActive = 'selecting';
  updateMenuStep();
  renderEventLibrary();
}

function selectEventPreset(type, btn){
  selectedPreset = type;
  // Highlight selected button
  el('eventTypePresets').querySelectorAll('.qb').forEach(b => b.classList.remove('active-lib-filter'));
  if(btn) btn.classList.add('active-lib-filter');

  const p = EVENT_PRESETS[type];
  if(!p) return;

  // Update name placeholder
  const nameInp = el('newEvName');
  if(nameInp && !nameInp.value.trim()) nameInp.placeholder = p.label + ' · ' + new Date().getFullYear();

  // Show summary
  const summary = el('presetSummary');
  if(summary){
    summary.style.display = '';
    summary.innerHTML = '📋 <strong>Prefill:</strong> ' + p.guests + ' guests · ' + p.hrs + 'h · $' + p.rate + '/h · ' + p.margin + '% margin'
      + (p.travel > 0 ? ' · $' + p.travel + ' travel' : '')
      + (p.notes ? '<br>📝 ' + p.notes : '');
  }
}

// ── Menu step management ──
function saveAndStartMenu(){
  // ── Sync ALL fields needed by getState() / PDF / save ──

  // From step1 shadow inputs
  const s1gc     = el('s1gc');     if(s1gc     && s1gc.value)     sv('gc',           s1gc.value);
  const s1hrs    = el('s1hrs');    if(s1hrs    && s1hrs.value)    sv('eventHrs',     s1hrs.value);
  const s1rate   = el('s1rate');   if(s1rate   && s1rate.value)   sv('hr',           s1rate.value);
  const s1margin = el('s1margin'); if(s1margin && s1margin.value) sv('mp',           s1margin.value);
  const s1travel = el('s1travel'); if(s1travel && s1travel.value) sv('tf',           s1travel.value);
  const s1client = el('s1client'); if(s1client && s1client.value) sv('cn',           s1client.value);

  // Event name from step1 name input
  const menuEvName = el('menuEvName');
  if(menuEvName && menuEvName.value.trim()) sv('eventLabel', menuEvName.value.trim());

  // Event date from step1 date input
  const menuEvDate = el('menuEvDate');
  if(menuEvDate && menuEvDate.value) sv('ed', menuEvDate.value);

  // Apply preset notes if not already set
  const p = (typeof EVENT_PRESETS !== 'undefined' && window._selectedEventType)
    ? EVENT_PRESETS[window._selectedEventType] : null;
  if(p && p.notes && !v('qn')) sv('qn', p.notes);

  // Ensure defaults for fields getState() / PDF rely on
  if(!v('quoteStatus'))    sv('quoteStatus',    'draft');
  if(!v('drinksPerPerson'))sv('drinksPerPerson', p ? String(p.dpg||5) : '5');
  if(!v('bufferPct'))      sv('bufferPct',       p ? String(p.buffer||0) : '0');
  if(!v('discountAmt'))    sv('discountAmt',     '0');
  if(!v('discountPct'))    sv('discountPct',     '0');
  if(!v('depositAmt'))     sv('depositAmt',      '0');

  syncSettings();

  const _saveResult = ErrorBoundary.wrap(
    function(){ saveEventToLibrary(false); },
    { context: 'saveAndStartMenu', label: qv('eventLabel') }
  );
  if(!_saveResult.ok){
    showToast('Save error: ' + _saveResult.error.message, 'error');
    Logger.error('saveAndStartMenu: save failed', {}, _saveResult.error);
    return;
  }

  // ③ Go through applyState with the saved state — same path as loading a saved event
  // This guarantees DOM fields match saved state, no divergence between new/loaded events
  // Transition to step2 — direct and explicit, no applyState complexity
  menuEventActive = true;
  
  // Hide step1 elements
  const _slot = el('step1SettingsSlot'); if(_slot) _slot.style.display = 'none';
  const _nextBtn = el('menuStep1Next'); if(_nextBtn) _nextBtn.style.display = 'none';
  const _esCard = el('eventSettingsCard'); if(_esCard) _esCard.style.display = 'none';

  // Render step2 content
  syncSettings();
  rC();
  rNI();
  rQ();
  renderMyLibrarySection();
  renderEventLibrary();

  // Show step2
  updateMenuStep();

  Logger.info('saveAndStartMenu: complete', { currentEventId, menuEventActive });
}

function updateMenuStep(){
  const step0 = el('menuStep0');
  const step1 = el('menuStep1');
  const step2 = el('menuStep2');
  if(!step0||!step1||!step2) return;

  // Helper: show/hide shared chrome
  function setChrome(showBack, showActions, showSubs){
    const hbb = el('headerBackBtn');   if(hbb)  hbb.style.display  = showBack    ? '' : 'none';
    const eha = el('eventHeaderActions'); if(eha) eha.style.display = showActions ? 'flex' : 'none';
    const sub = el('subtabs-event');   if(sub)  sub.style.display  = showSubs   ? 'flex' : 'none';
  }

  if(!menuEventActive){
    step0.style.display = ''; step1.style.display = 'none'; step2.style.display = 'none';
    // Force-hide settings card — never show on welcome screen
    const _sc = el('eventSettingsCard'); if(_sc) _sc.style.display = 'none';
    const _sb = el('settingsSaveCTA'); if(_sb) _sb.style.display = 'none';
    const _sl = el('step1SettingsSlot'); if(_sl) _sl.style.display = 'none';
    toggleEventSettings(false);
    setChrome(false, false, false);

  } else if(menuEventActive === 'selecting'){
    step0.style.display = 'none'; step1.style.display = ''; step2.style.display = 'none';
    // Always reset step1 to clean type-picker state when re-entering
    const _sc1 = el('eventSettingsCard'); if(_sc1) _sc1.style.display = 'none';
    const _slot1 = el('step1SettingsSlot'); if(_slot1) _slot1.style.display = 'none';
    const _cta1 = el('settingsSaveCTA'); if(_cta1) _cta1.style.display = 'none';
    const _stBtn1 = el('eventSettingsToggleBtn'); if(_stBtn1) _stBtn1.style.display = '';
    toggleEventSettings(false);
    setChrome(true, false, false);

  } else if(menuEventActive === 'settings'){
    // Show settings card prominently, menu hidden
    step0.style.display = 'none'; step1.style.display = 'none'; step2.style.display = 'none';
    const card = el('eventSettingsCard');
    if(card) card.style.display = '';
    const body = el('eventSettingsBody');
    if(body) body.style.display = 'block';
    const stBtn = el('eventSettingsToggleBtn');
    if(stBtn) stBtn.style.display = 'none'; // hide the collapse toggle in this mode
    // Show a prominent save CTA inside settings card
    const saveRow = el('settingsSaveCTA');
    if(saveRow) saveRow.style.display = '';
    setChrome(true, false, false);
    updateMenuHeader();
    window.scrollTo({top:0, behavior:'smooth'});

  } else {
    // true — active event with menu
    step0.style.display = 'none'; step1.style.display = 'none'; step2.style.display = '';
    const card = el('eventSettingsCard');
    if(card) card.style.display = 'none'; // hidden until user taps ⚙️ Event details
    const stBtn = el('eventSettingsToggleBtn');
    if(stBtn) stBtn.style.display = '';
    const saveRow = el('settingsSaveCTA');
    if(saveRow) saveRow.style.display = 'none';
    setChrome(true, true, true);
    updateMenuHeader();
  }
}

function resetToStep0(){
  // Save current event state before going back
  if(currentEventId && v('eventLabel')) saveEventToLibrary(true);
  menuEventActive = false;
  // Also reset step1 UI so next "Create new event" starts clean
  document.querySelectorAll('#inlineEventTypePresets .qb')
    .forEach(function(b){ b.classList.remove('active-lib-filter'); });
  const slot = el('step1SettingsSlot');
  if(slot) slot.style.display = 'none';
  const nextBtn = el('menuStep1Next');
  if(nextBtn) nextBtn.style.display = 'none';
  const summary = el('inlinePresetSummary');
  if(summary) summary.style.display = 'none';
  const card = el('eventSettingsCard');
  if(card) card.style.display = 'none';
  updateMenuStep();
}

function startFreshEvent(){
  // Reset data
  cocktails = []; nIng = []; staffList = [];
  currentEventId = null;
  window._selectedEventType = null;

  // Reset real settings fields
  sv('eventLabel',''); sv('cn',''); sv('ed','');
  sv('gc','50'); sv('eventHrs','4'); sv('hr','100'); sv('mp','35');
  sv('tf','0'); sv('drinksPerPerson','5'); sv('bufferPct','0');
  sv('discountAmt','0'); sv('discountPct','0'); sv('depositAmt','0'); sv('qn','');

  // Reset step1 UI completely
  document.querySelectorAll('#inlineEventTypePresets .qb')
    .forEach(function(b){ b.classList.remove('active-lib-filter'); });

  const els = {
    inlinePresetSummary: { display:'none' },
    menuStep1Next:       { display:'none' },
    step1SettingsSlot:   { display:'none' },
  };
  Object.keys(els).forEach(function(id){
    const el2 = el(id);
    if(el2) el2.style.display = els[id].display;
  });

  // Reset step1 shadow inputs
  ['s1gc','s1hrs','s1rate','s1margin','s1travel','s1client'].forEach(function(id){
    const inp = el(id); if(inp) inp.value = '';
  });
  const s1preview = el('s1quotePreview');
  if(s1preview) s1preview.innerHTML = '';

  // Reset name/date inputs
  const nameInp = el('menuEvName');
  if(nameInp){ nameInp.value = ''; nameInp.placeholder = 'e.g. Smith Wedding · June 2026'; }
  const dateInp = el('menuEvDate');
  if(dateInp) dateInp.value = '';

  // Hide settings card (it may have been shown from previous event)
  const card = el('eventSettingsCard');
  if(card) card.style.display = 'none';
  const stBtn = el('eventSettingsToggleBtn');
  if(stBtn) stBtn.style.display = '';

  menuEventActive = 'selecting';
  syncSettings(); rC(); rNI(); rQ();
  updateMenuStep();
  setTimeout(function(){ const n=el('menuEvName'); if(n) n.focus(); }, 100);
}

function updateMenuHeader(){
  const title = el('menuEventTitle');
  const meta  = el('menuEventMeta');
  if(title) title.textContent = v('eventLabel') || 'Untitled event';
  if(meta){
    const guests = vi('gc') || 50;
    const date   = v('ed');
    const dateStr = date ? new Date(date+'T12:00:00').toLocaleDateString('fr-CA',{month:'long',day:'numeric',year:'numeric'}) : '';
    meta.textContent = [guests + ' guests', dateStr].filter(Boolean).join(' · ');
  }
}

function applyInlinePreset(type, btn){
  // Highlight button
  document.querySelectorAll('#inlineEventTypePresets .qb').forEach(b => b.classList.remove('active-lib-filter'));
  if(btn) btn.classList.add('active-lib-filter');

  if(type === 'custom'){
    el('inlinePresetSummary').style.display = 'none';
    el('menuStep1Next').style.display = '';
    return;
  }

  const p = (typeof EVENT_PRESETS !== 'undefined' && EVENT_PRESETS[type]) || {};
  if(!p.guests) { el('menuStep1Next').style.display = ''; return; }

  // Apply preset values
  sv('gc',    String(p.guests || 50));
  sv('eventHrs', String(p.hrs || 4));
  sv('hr',    String(p.rate  || 100));
  sv('mp',    String(p.margin|| 35));
  sv('tf',    String(p.travel|| 0));
  sv('drinksPerPerson', String(p.dpg || 5));
  sv('bufferPct', String(p.buffer || 0));
  if(p.notes && !v('qn')) sv('qn', p.notes);

  // Show summary
  const summary = el('inlinePresetSummary');
  if(summary){
    summary.style.display = '';
    summary.innerHTML = '✓ <strong>Prefilled:</strong> '
      + p.guests + ' guests · ' + p.hrs + 'h · $' + p.rate + '/h · ' + p.margin + '% margin'
      + (p.travel > 0 ? ' · $' + p.travel + ' travel' : '')
      + (p.notes ? '<br><span style="color:var(--text3);">📝 Notes added</span>' : '');
  }

  // Prefill event name — always update if value looks like a previous preset
  const nameInp = el('menuEvName');
  if(nameInp){
    const yr = new Date().getFullYear();
    const suggested = p.label + ' · ' + yr;
    const currentVal = nameInp.value.trim();
    // Check if current value is a preset-generated name (matches "Anything · YYYY")
    const isPresetName = !currentVal || /^.+ · \d{4}$/.test(currentVal);
    if(isPresetName) nameInp.value = suggested;
    nameInp.placeholder = suggested;
    // Also show the ✓ Start button
    const nb = el('menuStep1Next');
    if(nb) nb.style.display = '';
  }

  window._selectedEventType = type;
  el('menuStep1Next').style.display = '';
  syncSettings();
}

function showStep1Settings(){
  const name = (el('menuEvName') ? el('menuEvName').value.trim() : '') || 'New event';
  sv('eventLabel', name);
  syncSettings();

  // Fill inline fields from current sv values
  const gc = document.getElementById('gc');
  const hrs = document.getElementById('eventHrs');
  const rate = document.getElementById('hr');
  const margin = document.getElementById('mp');
  const travel = document.getElementById('tf');
  const client = document.getElementById('cn');

  const s1gc = el('s1gc'); if(s1gc) s1gc.value = gc ? gc.value : '50';
  const s1hrs = el('s1hrs'); if(s1hrs) s1hrs.value = hrs ? hrs.value : '4';
  const s1rate = el('s1rate'); if(s1rate) s1rate.value = rate ? rate.value : '100';
  const s1margin = el('s1margin'); if(s1margin){ s1margin.value = margin ? margin.value : '35'; } updateS1MarginInfo();
  const s1travel = el('s1travel'); if(s1travel) s1travel.value = travel ? travel.value : '0';
  const s1client = el('s1client'); if(s1client) s1client.value = client ? client.value : '';

  // Update quote preview
  updateS1QuotePreview();

  // Show slot, hide next button
  const slot = el('step1SettingsSlot');
  if(slot){ slot.style.display = ''; slot.scrollIntoView({behavior:'smooth', block:'start'}); }
  const nextBtn = el('menuStep1Next');
  if(nextBtn) nextBtn.style.display = 'none';
}

function updateS1QuotePreview(){
  const hrs  = parseFloat(el('s1hrs') ? el('s1hrs').value : vi('eventHrs')) || 4;
  const rate = parseFloat(el('s1rate') ? el('s1rate').value : vi('hr')) || 100;
  const travel = parseFloat(el('s1travel') ? el('s1travel').value : vi('tf')) || 0;
  const guests = parseInt(el('s1gc') ? el('s1gc').value : vi('gc')) || 50;
  const labor = hrs * rate;
  const total = labor + travel;
  const perGuest = guests > 0 ? (total/guests).toFixed(0) : '—';
  const prev = el('s1quotePreview');
  if(prev) prev.innerHTML = '<strong>Estimate: $' + total.toFixed(0) + ' CAD</strong> · $' + perGuest + '/guest'
    + '<span style="color:var(--text3);margin-left:8px;">$' + labor.toFixed(0) + ' labor'
    + (travel > 0 ? ' · $' + travel.toFixed(0) + ' travel' : '') + '</span>';
}

function confirmInlineEvent(){
  try {
    const name = (el('menuEvName') ? el('menuEvName').value.trim() : '') || 'New event';
    const date = el('menuEvDate') ? el('menuEvDate').value : '';
    sv('eventLabel', name);
    if(date) sv('ed', date);
    syncSettings();
    rC();
    rQ();
    menuEventActive = 'settings'; // show event details before menu
    updateMenuStep();
  } catch(err){
    console.error('confirmInlineEvent error:', err);
    // Force step 2 even if something errored
    menuEventActive = true;
    updateMenuStep();
  }
}

function closeNewEventDialog(){
  el('newEventModalBg').classList.remove('open');
}

function renderCategoryPicker(){
  const listEl = el('catPickerList');
  if(!listEl) return;
  listEl.innerHTML = eventCategories.map(cat => `
    <div class="cat-card" onclick="startEventFromCategory('${cat.id}')">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;">${cat.icon}</span>
        <div style="flex:1;">
          <div class="cat-name">${cat.name}</div>
          <div class="cat-meta">${cat.desc}</div>
          <div class="cat-meta" style="margin-top:3px;">
            ${cat.defaults.gc} guests · ${cat.defaults.eventHrs}h · ${cat.defaults.drinksPerPerson} drinks/person · $${cat.defaults.hr}/hr · ${cat.defaults.mp}% margin
          </div>
        </div>
        <span style="font-size:18px;color:#aaa;">›</span>
      </div>
    </div>`).join('');
}

function startEventFromCategory(catId){
  const cat = eventCategories.find(c => c.id === catId);
  if(!cat) return;
  closeNewEventDialog();
  // Clear current event first
  if(cocktails.length || v('eventLabel')){
    if(!confirm('Start a new ' + cat.name + ' event? Current unsaved changes will be lost.')) return;
  }
  // Reset everything
  cocktails=[]; nIng=[];
  ['eventLabel','cn','ed','qn','nn','p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>sv(id,''));
  ['p1dpg','p2dpg'].forEach(id=>sv(id,1));
  sc('taxEnabled',false);
  rcManualOverride=false;
  staffList=[];
  postEventData={};
  editingCocktailId=null;
  editIngredients=[];

  // Apply category defaults
  const d = cat.defaults;
  sv('gc', d.gc || 50);
  sv('eventHrs', d.eventHrs || 4);
  sv('drinksPerPerson', d.drinksPerPerson || 5);
  sv('bufferPct', d.bufferPct !== undefined ? d.bufferPct : 0);
  sv('hr', d.hr || 100);
  sv('mp', d.mp || 35);
  sv('tf', d.tf || 0);
  sv('depositAmt', 0);
  sv('discountAmt', 0);
  sv('discountPct', 0);
  sv('quoteStatus', 'draft');
  sv('qn', cat.notes || '');

  // Set event label to category name as a starting point
  sv('eventLabel', cat.name);

  updateStatusBadge();
  renderStaff();
  rNI(); rC(); rShop(); rQ();
  syncSettings();
  renderShoppingDeadline();
  showToast(cat.icon + ' ' + cat.name + ' event started — update the client name and date', 'success');
}

// ════════════════════════════════════════════════════════════
function saveQuoteToLibrary(asRevision){
  // Get the rendered HTML from the modal
  const contentEl = el('clientPDFContent');
  const html = contentEl ? contentEl.innerHTML : '';
  if(!html || html.trim().length < 50){
    showToast('Open the quote preview first, then save', 'error');
    // Auto-open the preview
    openClientPDF();
    setTimeout(() => showToast('Now click 💾 Save quote', 'success'), 800);
    return;
  }

  const label = v('eventLabel');
  if(!label){ showToast('Set an event name first', 'error'); return; }

  const idx = eventLibrary.findIndex(e => e.label === label || e.id === currentEventId);
  if(idx === -1){
    showToast('Save the event first', 'error');
    return;
  }

  const entry = eventLibrary[idx];
  const snapshot = {
    html,
    total: 0,
    savedAt: new Date().toISOString(),
    eventLabel: label,
    revision: null
  };

  if(asRevision && entry.quoteSnapshot){
    // Keep previous as history, save new as current + link back
    if(!entry.quoteHistory) entry.quoteHistory = [];
    entry.quoteHistory.unshift({
      ...entry.quoteSnapshot,
      revision: (entry.quoteHistory.length + 1)
    });
    snapshot.revision = entry.quoteHistory.length + 1;
    showToast('Quote revision ' + snapshot.revision + ' saved', 'success');
  } else {
    showToast('Quote saved to event library ✓', 'success');
  }

  entry.quoteSnapshot = snapshot;
  entry.quoteSentAt = new Date().toISOString();
  if((entry.status||'draft') === 'draft'){
    entry.status = 'sent';
    sv('quoteStatus', 'sent');
    updateStatusBadge();
  }
  saveEventLibraryStore();
  renderEventLibrary();
}

function saveDocSnapshot(type, html, total){
  // Find the current event in the library and attach snapshot
  const label = v('eventLabel');
  if(!label) return;
  const idx = eventLibrary.findIndex(e =>
    e.label === label || e.id === currentEventId
  );
  if(idx === -1) return;

  // Store as object with metadata
  const snapshot = {html, total: parseFloat(total)||0, savedAt: new Date().toISOString(), invoiceNum:(el('pdfInvoiceNum')||{}).value||'', eventLabel:label};

  if(type === 'quote'){
    eventLibrary[idx].quoteSnapshot = snapshot;
    eventLibrary[idx].quoteSentAt = new Date().toISOString();
    // Auto-advance status to 'sent' if still draft
    if((eventLibrary[idx].status||'draft') === 'draft'){
      eventLibrary[idx].status = 'sent';
      sv('quoteStatus','sent');
      updateStatusBadge();
    }
  } else {
    eventLibrary[idx].invoiceSnapshot = snapshot;
    eventLibrary[idx].invoiceFinalAt = new Date().toISOString();
    eventLibrary[idx].invoiceTotal = parseFloat(total)||0;
    // Auto-advance to completed
    if(['confirmed','sent'].includes(eventLibrary[idx].status||'')){
      eventLibrary[idx].status = 'completed';
      sv('quoteStatus','completed');
      updateStatusBadge();
    }
  }
  saveEventLibraryStore();
  showToast(type === 'quote' ? '📄 Quote saved to event library' : '🧾 Invoice saved to event library', 'success');
}

function saveEventToLibrary(silent){
  const s = getState();
  const rawLabel = s.eventLabel || '';
  // Also check the menuEvName input directly as a fallback
  const menuEvNameEl = el('menuEvName');
  const menuEvNameVal = menuEvNameEl ? menuEvNameEl.value.trim() : '';
  const label = rawLabel || menuEvNameVal || 'New event';
  // If we got a label from menuEvName but not from eventLabel, sync it
  if(!rawLabel && menuEvNameVal) sv('eventLabel', menuEvNameVal);
  const date = s.quote && s.quote.eventDate ? s.quote.eventDate : '';
  const guests = s.guestCount || 0;
  const cocktailCount = (s.cocktails || []).length;
  const now = new Date().toISOString();

  // Check for existing entry with same label+date — offer to overwrite
  // Match priority: 1) currentEventId, 2) label+date, 3) label only
  let existingIdx = currentEventId
    ? eventLibrary.findIndex(e => e.id === currentEventId)
    : eventLibrary.findIndex(e => e.label === label && e.eventDate === date);
  if(existingIdx === -1)
    existingIdx = eventLibrary.findIndex(e => e.label === label);

  // Calculate quoted total for display (works even without a cocktail menu)
  let quotedTotal = 0;
  try {
    if(cocktails.length > 0){
      const qGuests = s.guestCount || 50;
      const qItems = getIM(qGuests);
      const qPurchase = qItems.reduce((sum,i)=>sum+i.purchaseCost,0);
      const qMp = qvf('mp') || 35;
      const qMkup = qMp < 100 ? (qMp/(100-qMp))*100 : qMp;
      const qMked = qPurchase*(1+qMkup/100);
      const qLabor = qvf('eventHrs') * qvf('hr');
      quotedTotal = qMked + qLabor + qvf('tf');
    } else {
      // No menu yet — save labor + travel only
      quotedTotal = qvf('eventHrs') * qvf('hr') + qvf('tf');
    }
  } catch(e){}

  const existing = existingIdx >= 0 ? eventLibrary[existingIdx] : {};
  const entry = makeEventEntry({
    id:           existing.id,
    label,
    eventDate:    date,
    guestCount:   guests,
    cocktailCount,
    status:       qv('quoteStatus') || 'draft',
    eventType:    existing.eventType || window._selectedEventType || null,
    totalQuoted:  quotedTotal,
    savedAt:      now,
    state:        s,
  }, existing);

  // Push snapshot to history on every save (manual or auto)
  try { if(s && entry.stateHistory !== undefined){
    const snapshot = {
      savedAt: now,
      isAuto: !!silent,
      label: generateHistoryLabel(s, existing),
      state: JSON.parse(JSON.stringify(s))
    };
    // Prepend (newest first), cap at 50 versions
    entry.stateHistory = [snapshot, ...(existing.stateHistory||[])].slice(0, 50);
  } } catch(eHist){ console.warn('stateHistory snapshot failed:', eHist); }

  try {
    if(existingIdx >= 0){
      eventLibrary[existingIdx] = entry;
      if(!silent) showSaveNotification(label, false);
    } else {
      eventLibrary.unshift(entry); // newest first
      if(!silent) showSaveNotification(label, true);
    }
  } catch(ePush){
    console.error('eventLibrary push failed:', ePush);
  }

  // Always sync currentEventId so subsequent saves update the same entry
  currentEventId = entry.id;
  try { saveEventLibraryStore(); } catch(eStore){ console.error('localStorage save failed:', eStore); }
  renderEventLibrary(); // always refresh
  if(!silent) flashSaved();

  // Auto-add unique ingredients to My Ingredients when event is confirmed
  if((s.quoteStatus === 'confirmed' || s.quote?.status === 'confirmed') && s.cocktails && s.cocktails.length){
    let ingAdded = 0;
    s.cocktails.forEach(ct => {
      (ct.ing || []).forEach(ing => {
        if(!ing.n || !ing.n.trim()) return;
        const exists = myIngredients.some(mi => mi.name.toLowerCase() === ing.n.toLowerCase());
        if(!exists && ing.c > 0){
          myIngredients.push({
            name: ing.n, unit: ing.u || 'oz', c: ing.c,
            note: 'From: ' + (label || 'event'),
            retailer: '', cat: '🏠 My custom ingredients',
            addedAt: new Date().toISOString(), flavorTags: []
          });
          ingAdded++;
        }
      });
    });
    if(ingAdded > 0){ saveMyDB(); if(!silent) showToast(ingAdded + ' ingredient' + (ingAdded>1?'s':'') + ' added to your library', 'success'); }
  }

  // Refresh event library display
  renderEventLibrary();

  // Flash the header save indicator
  if(!silent) flashSaved();
}

function exportFullBackup(){
  const timestamp = new Date().toISOString().split('T')[0];
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    label: 'Full backup — ' + timestamp,
    // Event data
    currentEvent: getState(),
    eventLibrary: eventLibrary,
    // Ingredient + pricing data
    myIngredients: myIngredients,
    retailerPrices: retailerPrices,
    priceHistory: priceHistory,
    storeOverrides: storeOverrides,
    customRetailers: customRetailers,
    currentStock: currentStock,
    // Recipe library
    recipeLibrary: recipeLibrary,
    // Receipts
    receipts: receipts,
    // Post-event data
    postEventData: postEventData || {}
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bartender_backup_' + timestamp + '.json';
  a.click();
  showToast('✓ Full backup downloaded — ' + Object.keys(backup).length + ' data sets', 'success');
}

function importFullBackup(file){
  if(!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if(!data.version || !data.exportedAt) throw new Error('Not a valid backup file');
      if(!confirm('This will restore ALL data from ' + (data.label||data.exportedAt) + '.\n\nYour current data will be replaced. Continue?')) return;
      // Restore everything
      if(data.eventLibrary) { eventLibrary = data.eventLibrary; saveEventLibraryStore(); }
      if(data.myIngredients) { myIngredients = data.myIngredients; saveMyDB(); }
      if(data.retailerPrices) { retailerPrices = data.retailerPrices; saveRetailerPrices(); }
      if(data.priceHistory) { priceHistory = data.priceHistory; localStorage.setItem('bartender_price_history', JSON.stringify(priceHistory)); }
      if(data.storeOverrides) { storeOverrides = data.storeOverrides; localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides)); }
      if(data.customRetailers) { customRetailers = data.customRetailers; saveRetailers(); }
      if(data.currentStock) { currentStock = data.currentStock; localStorage.setItem('bartender_stock', JSON.stringify(currentStock)); }
      if(data.recipeLibrary) { recipeLibrary = data.recipeLibrary; saveRecipeLibraryStore(); }
      if(data.receipts) { receipts = data.receipts; localStorage.setItem('bartender_receipts', JSON.stringify(receipts)); }
      if(data.currentEvent && data.currentEvent.version) applyState(data.currentEvent);
      showToast('✓ Backup restored successfully', 'success');
      renderEventLibrary();
      renderRecipeLibrary();
      renderMyLibrarySection();
    } catch(err) {
      showToast('Could not restore backup: ' + err.message, 'error');
    }
  };
  fr.readAsText(file);
}

function exportEventJSON(){
  // Explicit JSON export — only when user wants it from ⋯ menu
  const s = getState();
  const label = s.eventLabel || 'event';
  const lbl = label.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  dl(JSON.stringify(s,null,2),'application/json',lbl+'_bartender.json');
  showToast('JSON exported', 'success');
}

function saveEvent(){
  // Keep the old export-only save for backwards compat
  const s=getState(), lbl=(s.eventLabel||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase()||'event';
  dl(JSON.stringify(s,null,2),'application/json',lbl+'_bartender.json');
  flashSaved();
}

function openEventLibrary(){
  renderEventLibrary();
  el('evlibModalBg').classList.add('open');
}

function closeEventLibrary(){
  el('evlibModalBg').classList.remove('open');
}

function loadEventFromLibrary(id){
  currentEventId = id;
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) { showToast('Event not found', 'error'); return; }
  const state = entry.state || entry.fullState;
  if(!state) { showToast('Event has no saved data', 'error'); return; }
  // Auto-save current event before loading (no disruptive confirm dialog)
  cnManuallyEdited = false;
  menuEventActive = true;
  applyState(state);
  closeEventLibrary();
  // Switch to menu tab
  const menuBtn = el('st-menu');
  if(menuBtn) sw('menu', menuBtn);
  showToast((entry.label||'Event') + ' loaded ✓', 'success');
}

function previewDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap || !snap.html){
    showToast('No ' + type + ' saved for this event yet', 'error');
    return;
  }
  const w = window.open('','_blank');
  if(w){ w.document.write(snap.html); w.document.close(); }
  else { showToast('Pop-up blocked — allow pop-ups to preview', 'error'); }
}

function reprintDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap || !snap.html){
    showToast('No ' + type + ' saved for this event yet', 'error');
    return;
  }
  const w = window.open('','_blank');
  if(w){
    w.document.write(snap.html);
    w.document.close();
    w.focus();
    setTimeout(() => { try{ w.print(); }catch(e){} }, 500);
  } else {
    // Fallback: download as HTML
    const blob = new Blob([snap.html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (entry.label||'event').replace(/[^a-z0-9]/gi,'_') + '_' + type + '.html';
    a.click();
  }
}

function updatePaymentStatus(id, field, value){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry[field] = value;
  // Auto-set paymentStatus based on amounts
  if(field === 'paidAmount' || field === 'depositAmount'){
    const total = entry.invoiceTotal || entry.totalQuoted || 0;
    const paid = parseFloat(entry.paidAmount||0);
    const dep  = parseFloat(entry.depositAmount||0);
    if(paid >= total && total > 0) entry.paymentStatus = 'paid';
    else if(paid > 0) entry.paymentStatus = 'partial';
    else if(dep > 0) entry.paymentStatus = 'deposit';
    else entry.paymentStatus = 'unpaid';
  }
  if(field === 'paymentStatus' && value === 'paid' && !entry.paidDate)
    entry.paidDate = new Date().toISOString().split('T')[0];
  saveEventLibraryStore();
  renderEventLibrary();
  if(field === 'paymentStatus')
    showToast('Payment status → ' + value, 'success');
}

function promptDepositEntry(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const current = entry.depositAmount ? parseFloat(entry.depositAmount).toFixed(2) : '';
  const val = prompt('Deposit amount received (leave blank to clear):', current);
  if(val === null) return; // cancelled
  const amt = parseFloat(val);
  if(val.trim() === ''){
    // Clear deposit
    entry.depositAmount = null;
    entry.depositDate   = null;
    if(entry.paymentStatus === 'deposit') entry.paymentStatus = 'unpaid';
  } else if(!isNaN(amt) && amt >= 0){
    entry.depositAmount = amt;
    entry.depositDate   = entry.depositDate || new Date().toISOString().split('T')[0];
    const total = parseFloat(entry.invoiceTotal||entry.totalQuoted||0);
    if(amt >= total && total > 0) entry.paymentStatus = 'paid';
    else if(amt > 0) entry.paymentStatus = 'deposit';
  } else {
    showToast('Invalid amount', 'error'); return;
  }
  saveEventLibraryStore();
  renderEventLibrary();
  if(val.trim() !== '') showToast('Deposit $' + (parseFloat(val)||0).toFixed(2) + ' saved', 'success');
}

function deleteDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const label = type === 'quote' ? 'quote' : 'invoice';
  if(!confirm('Delete the saved ' + label + ' for "' + (entry.label||'Event') + '"?')) return;
  if(type === 'quote'){
    entry.quoteSnapshot = null;
    entry.quoteSentAt   = null;
    entry.quoteHistory  = [];
    // Revert to draft if was sent
    if(entry.status === 'sent'){ entry.status = 'draft'; }
  } else {
    entry.invoiceSnapshot = null;
    entry.invoiceFinalAt  = null;
    entry.invoiceTotal    = null;
  }
  saveEventLibraryStore();
  renderEventLibrary();
  showToast(label.charAt(0).toUpperCase() + label.slice(1) + ' deleted', 'success');
}

function resetPayment(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  if(!confirm('Reset payment for "' + (entry.label||'Event') + '"?\nThis will clear paid status, amounts and dates.')) return;
  entry.paymentStatus = 'unpaid';
  entry.paidAmount    = null;
  entry.paidDate      = null;
  entry.depositAmount = null;
  entry.depositDate   = null;
  entry.paymentMethod = null;
  entry.proofOfPayment = null;
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Payment reset to unpaid', 'success');
}

function uploadProofOfPayment(id){
  const note = prompt('Enter payment reference (e-transfer confirmation #, cheque #, note, etc.):');
  if(note === null) return;
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry.proofOfPayment = note;
  if(!entry.paidDate) entry.paidDate = new Date().toISOString().split('T')[0];
  if((parseFloat(entry.paidAmount||0) >= (entry.invoiceTotal||entry.totalQuoted||0)) || !entry.paidAmount)
    entry.paymentStatus = 'paid';
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Payment reference saved', 'success');
}

function updateEventStatus(id, newStatus){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry.status = newStatus;
  if(entry.state) entry.state.quoteStatus = newStatus;
  saveEventLibraryStore();
  // Update status badge if this is the current event
  if(currentEventId === id){
    sv('quoteStatus', newStatus);
    updateStatusBadge();
  }
  showToast((entry.label||'Event') + ' → ' + newStatus, 'success');
}

function deleteEventFromLibrary(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  if(!confirm('Delete "' + (entry.label||'Event') + '" from the library?')) return;
  eventLibrary = eventLibrary.filter(e => e.id !== id);
  saveEventLibraryStore();
  renderEventLibrary();
  showToast((entry.label||'Event') + ' deleted', 'success');
}

function clearEventLibrary(){
  eventLibrary = [];
  saveEventLibraryStore();
  renderEventLibrary();
}

function renderEventLibrary(){
  const listEl = el('evlibList');
  const countEl = el('evlibCount');
  if(!listEl) return;

  const filterStatus = v('evFilterStatus') || 'all';
  const query = (v('evlibSearch') || '').toLowerCase().trim();

  const filtered = eventLibrary.filter(e => {
    const matchStatus = filterStatus === 'all' || (e.status||'draft') === filterStatus;
    const matchQuery  = !query || (e.label||'').toLowerCase().includes(query) || (e.eventDate||'').includes(query);
    return matchStatus && matchQuery;
  });

  if(countEl) countEl.textContent = eventLibrary.length + ' event' + (eventLibrary.length!==1?'s':'') + ' saved';

  if(!eventLibrary.length){
    listEl.innerHTML = '<div style="padding:2.5rem;text-align:center;color:var(--text3);font-size:13px;">No saved events yet — click 💾 Save to add the current event.</div>';
    return;
  }
  if(!filtered.length){
    listEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:13px;">No events match that search.</div>';
    return;
  }

  const STATUS_LABELS = {draft:'📝 Draft',sent:'📤 Sent',confirmed:'✅ Confirmed',completed:'🎉 Done',cancelled:'❌ Cancelled',rejected:'🚫 Rejected'};
  const STATUS_COLORS = {draft:'var(--text3)',sent:'var(--accent)',confirmed:'var(--green)',completed:'#059669',cancelled:'var(--red)',rejected:'var(--red)'};

  const PAY_LABELS = {unpaid:'💳 Unpaid', deposit:'⬇️ Deposit received', partial:'⏳ Partial', paid:'✅ Paid in full'};
  const PAY_BG     = {unpaid:'#fff5f5',deposit:'#fff8e6',partial:'#fff8e6',paid:'#f0fdf4'};
  const PAY_COLOR  = {unpaid:'var(--red)',deposit:'var(--amber)',partial:'var(--amber)',paid:'var(--green)'};

  const rows = filtered.map(e => {
    const dateStr = e.eventDate
      ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric',year:'numeric'})
      : '—';
    const cocktailStr = e.cocktailCount ? e.cocktailCount + ' cocktail' + (e.cocktailCount!==1?'s':'') : '';
    const guestStr = (e.guestCount||e.guests) ? (e.guestCount||e.guests)+' guests' : '';
    const metaStr  = [cocktailStr, guestStr].filter(Boolean).join(' · ');
    const totalStr = e.totalQuoted ? ' · $' + parseFloat(e.totalQuoted).toFixed(0) : '';
    const st = e.status || 'draft';
    const stColor = STATUS_COLORS[st]||'var(--text3)';
    const ps = e.paymentStatus || 'unpaid';

    const selectOpts = Object.entries(STATUS_LABELS).map(([val, lbl]) =>
      '<option value="'+val+'"'+(st===val?' selected':'')+'>'+lbl+'</option>'
    ).join('');

    // ── Quote / Invoice doc strip ──
    const qDate  = e.quoteSentAt   ? new Date(e.quoteSentAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : null;
    const iDate  = e.invoiceFinalAt? new Date(e.invoiceFinalAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : null;
    const iTotal = e.invoiceTotal  ? ' · $' + parseFloat(e.invoiceTotal).toFixed(2) : '';

    const docStrip = (qDate || iDate) ? (
      '<div style="display:flex;gap:6px;padding:8px 14px;border-top:1px solid var(--surface2);flex-wrap:wrap;align-items:center;">'
      + '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-right:2px;">Docs:</span>'
      + (qDate
          ? '<span style="display:inline-flex;align-items:center;gap:4px;">'
            + '<button onclick="viewEventDocument(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c5d8f8;background:var(--accent-bg);color:var(--accent);cursor:pointer;font-family:var(--font);font-weight:500;">📋 Quote · '+qDate+ (e.quoteHistory && e.quoteHistory.length ? ' · v'+(e.quoteHistory.length+1) : '') +'</button>'
            + (e.quoteHistory && e.quoteHistory.length ? '<button onclick="viewQuoteHistory(\''+e.id+'\')" style="font-size:11px;padding:3px 9px;border-radius:20px;border:1.5px solid #c5d8f8;background:var(--surface);color:var(--accent);cursor:pointer;font-family:var(--font);" title="View previous quote versions">🕐 History ('+e.quoteHistory.length+')</button>' : '')
            + '<button onclick="saveDocToComputer(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Save to computer">💾</button>'
            + '<button onclick="deleteDocSnapshot(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid #fcc;background:#fff5f5;color:var(--red);cursor:pointer;font-family:var(--font);" title="Delete quote">✕</button>'
            + '</span>'
          : '<span style="font-size:11px;color:var(--text3);font-style:italic;">No quote saved</span>')
      + (iDate
          ? '<button onclick="viewEventDocument(\''+e.id+'\',\'invoice\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c8e6d4;background:var(--green-bg);color:var(--green);cursor:pointer;font-family:var(--font);font-weight:500;">🧾 Invoice'+iTotal+' · '+iDate+'</button>'
          + '<button onclick="saveDocToComputer(\''+e.id+'\',\'invoice\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Save to computer">💾</button>'
          : '')
      + '</div>'
    ) : '';

    // ── Payment strip ──
    const paidAmt   = parseFloat(e.paidAmount||0);
    const depAmt    = parseFloat(e.depositAmount||0);
    const total     = parseFloat(e.invoiceTotal||e.totalQuoted||0);
    const outstanding = total > 0 ? Math.max(0, total - paidAmt - depAmt) : null;

    const payStrip = '<div style="display:flex;gap:8px;padding:8px 14px 10px;border-top:1px solid var(--surface2);flex-wrap:wrap;align-items:center;background:'+PAY_BG[ps]+';">'
      // Payment status pill + quick-select
      + '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">'
      +   '<span style="font-size:12px;font-weight:700;color:'+PAY_COLOR[ps]+';">'+PAY_LABELS[ps]+'</span>'
      +   (outstanding !== null && ps !== 'paid'
            ? '<span style="font-size:11px;color:var(--red);font-weight:600;background:var(--red-bg);padding:1px 8px;border-radius:20px;">$'+outstanding.toFixed(2)+' outstanding</span>'
              + (depAmt > 0 ? '<span style="font-size:11px;color:var(--amber);background:var(--amber-bg);padding:1px 8px;border-radius:20px;">$'+depAmt.toFixed(2)+' deposit received</span>' : '')
            : ps === 'paid' ? '<span style="font-size:11px;color:var(--green);font-weight:500;">$'+paidAmt.toFixed(2)+' received</span>' : '')
      +   (e.proofOfPayment ? '<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:1px 8px;border-radius:20px;border:1px solid var(--border);" title="Payment ref">🧾 '+e.proofOfPayment+'</span>' : '')
      + '</div>'
      // Quick action buttons
      + '<div style="display:flex;gap:5px;flex-wrap:wrap;">'
      + (ps !== 'paid'
          ? '<button onclick="updatePaymentStatus(\''+e.id+'\',\'paymentStatus\',\'paid\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c8e6d4;background:var(--green-bg);color:var(--green);cursor:pointer;font-family:var(--font);font-weight:600;">✅ Mark paid</button>'
          : '<button onclick="resetPayment(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text3);cursor:pointer;font-family:var(--font);font-weight:500;" title="Undo — reset payment to unpaid">↩ Undo payment</button>')
      + (ps !== 'paid'
          ? '<button onclick="promptDepositEntry(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--amber-bg);background:var(--amber-bg);color:var(--amber);cursor:pointer;font-family:var(--font);font-weight:500;">'+(depAmt>0?'✏️ Edit deposit ($'+depAmt.toFixed(2)+')':'⬇️ Log deposit')+'</button>'
          : '')
      + '<button onclick="uploadProofOfPayment(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Add payment reference">📎 Add ref</button>'
      + '<select onchange="updatePaymentStatus(\''+e.id+'\',\'paymentMethod\',this.value)" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);font-family:var(--font);cursor:pointer;">'
      +   '<option value="">💳 Method</option>'
      +   ['cash','etransfer','card','cheque'].map(m =>
            '<option value="'+m+'"'+(e.paymentMethod===m?' selected':'')+'>'+{cash:'💵 Cash',etransfer:'📲 e-Transfer',card:'💳 Card',cheque:'📝 Cheque'}[m]+'</option>'
          ).join('')
      + '</select>'
      + '</div>'
      + '</div>';

    return '<div class="evlib-card" style="border-left:3px solid '+stColor+';">'
      // ── Main row ──
      + '<div style="display:grid;grid-template-columns:2fr 1fr 1.5fr auto;gap:10px;padding:12px 14px;align-items:center;">'
      +   '<div>'
      +     '<div class="evlib-name">'+( e.label||'Untitled')+'</div>'
      +     (metaStr ? '<div class="evlib-meta">'+metaStr+'</div>' : '')
      +   '</div>'
      +   '<div style="font-size:12px;color:var(--text2);font-weight:500;">'+dateStr+'</div>'
      +   '<select data-id="'+e.id+'" onchange="updateEventStatus(this.dataset.id,this.value)"'
      +     ' style="font-size:12px;padding:4px 8px;border-radius:20px;border:1.5px solid '+stColor+'33;background:var(--surface);cursor:pointer;color:'+stColor+';font-weight:600;font-family:var(--font);">'
      +     selectOpts
      +   '</select>'
      +   '<div style="display:flex;gap:5px;flex-shrink:0;">'
      +     (e.status==='confirmed'||e.status==='completed'?'<button class="btn btn-sm btn-success" style="font-size:11px;padding:4px 11px;" data-id="'+e.id+'" onclick="loadAndInvoice(this.dataset.id)">🧾 Invoice</button>':'')      +   '<button class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 11px;" data-id="'+e.id+'" onclick="loadEventFromLibrary(this.dataset.id)">Load</button>'
      +   '<button class="btn btn-sm" style="font-size:11px;padding:4px 9px;" data-id="'+e.id+'" onclick="viewStateHistory(this.dataset.id)" title="Version history">🕐'+(e.stateHistory&&e.stateHistory.length?' ('+e.stateHistory.length+')':'')+'</button>'
      +     '<button class="btn btn-sm btn-danger" style="font-size:11px;padding:4px 9px;" data-id="'+e.id+'" onclick="deleteEventFromLibrary(this.dataset.id)">✕</button>'
      +   '</div>'
      + '</div>'
      + docStrip
      + payStrip
      + '</div>';
  }).join('');

  listEl.innerHTML = rows;
}
function loadEvent(e){
  const file=e.target.files[0];if(!file)return;
  const r=new FileReader();r.onload=ev=>{try{applyState(JSON.parse(ev.target.result));}catch{alert('Could not read file.');}};
  r.readAsText(file);e.target.value='';
}
function newEvent(){
  if(!confirm('Start a new event? Unsaved changes will be lost.'))return;
  cocktails=[];nIng=[];
  ['eventLabel','cn','ed','qn','nn','p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>sv(id,''));
  ['p1dpg','p2dpg'].forEach(id=>sv(id,1));
  ['cn','ed','qn'].forEach(id=>sv(id,''));
  sv('eventHrs',4);
  sv('drinksPerPerson',5);
  sv('bufferPct',0);
  sv('depositAmt',0);
  sv('gc',50);
  sv('hr',100);
  sv('mp',35);
  sv('discountAmt',0);
  sv('discountPct',0);
  sv('quoteStatus','draft');
  updateStatusBadge();
  sv('tf',0);
  rcManualOverride=false;
  staffList=[];
  postEventData={};
  editingCocktailId=null;
  editIngredients=[];
  renderStaff();
  // Note: receipts are kept in localStorage — they persist across events by design
  renderReceipts();
  sc('taxEnabled',false);
  sv('gc',50);
  sv('eventHrs',4);sv('hr',100);
  sv('mp',35);
  sv('tf',0);sv('ndpg',1);
  rNI();rC();rShop();rQ();
}
function clearMyLibSearch(){
  const inp = el('myLibSearch');
  if(inp){ inp.value = ''; inp.focus(); }
  const cb = el('myLibSearchClear');
  if(cb) cb.style.display = 'none';
  myLibActiveQuery = '';
  renderMyLibCards(undefined, '');
}

function closeEvLibModal(){
  const bg = el('evlibModalBg');
  if(bg) bg.classList.remove('open');
}

function dismissAutosave(){
  const banner = el('autosaveRestoreBanner');
  if(banner) banner.style.display = 'none';
}

function restoreAutosave(){
  try {
    const saved = localStorage.getItem('bartender_autosave_v1');
    if(!saved) return;
    const data = JSON.parse(saved);
    if(data && data.state) {
      applyState(data.state);
      showToast('Event restored from autosave', 'success');
    }
  } catch(e) {
    showToast('Could not restore autosave', 'error');
  }
  dismissAutosave();
}

function revertToSaved(){
  if(!currentEventId){
    showToast('No saved version to revert to', 'error');
    return;
  }
  const entry = eventLibrary.find(e => e.id === currentEventId);
  if(!entry || !entry.state){
    showToast('No saved version found', 'error');
    return;
  }
  if(!confirm('Discard all unsaved changes and reload "' + (entry.label||'Event') + '" from last save?')) return;
  applyState(entry.state);
  lastSavedState = getSimpleState();
  const revertBtn = el('revertBtn');
  if(revertBtn) revertBtn.style.display = 'none';
  showToast('Reverted to last saved version ✓', 'success');
}

