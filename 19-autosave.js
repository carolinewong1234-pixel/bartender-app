// ═══ AUTOSAVE & SAVE STATUS ═══
// Autosave timers, crash recovery, save notifications

let autosaveTimer = null;
let libraryAutosaveTimer = null; // timer for library auto-save
let eventAutoSaveTimer = null;

let cnManuallyEdited = false; // true once user types directly in cn field

function syncCnFromLabel(){
  const label = v('eventLabel');
  // Update toolbar display always
  const dispEl = el('eventLabelDisplay');
  if(dispEl) dispEl.textContent = label || 'Untitled event';
  // Sync cn unless user has manually edited it
  if(!cnManuallyEdited){
    sv('cn', label);
  }
  // If event name cleared, also clear cn (unless manually edited)
  if(!label && !cnManuallyEdited){
    sv('cn', '');
  }
}

function scheduleEventAutosave(){
  if(eventAutoSaveTimer) clearTimeout(eventAutoSaveTimer);
  eventAutoSaveTimer = setTimeout(() => {
    const name = v('eventLabel').trim();
    if(!name || name === 'Untitled event') return;
    // Auto-save only if not already saved with same name
    const existing = eventLibrary.find(e => e.id === currentEventId);
    if(!existing && (cocktails.length > 0 || v('ed') || v('cn'))){
      saveEventToLibrary(true); // silent save
    } else if(existing){
      saveEventToLibrary(true); // silent update
    }
  }, 2500);
}
let lastSavedState = null;

function getSimpleState(){
  // Lightweight state fingerprint for change detection
  return JSON.stringify({
    label: v('eventLabel'),
    gc: v('gc'), ed: v('ed'),
    cocktailCount: cocktails.length,
    cocktailNames: cocktails.map(c2=>c2.name).join(','),
    recipeCount: recipeLibrary.length,
    ingCount: myIngredients.length,
    eventCount: eventLibrary.length,
    stockKeys: Object.keys(currentStock).length
  });
}

function generateHistoryLabel(state, existing){
  const parts = [];
  const prev = existing && existing.state;
  if(!prev) return 'Initial save';

  // Helper: read field from flat state or nested quote subobject
  const fld = (s, k) => s ? (s[k] !== undefined ? s[k] : (s.quote && s.quote[k] !== undefined ? s.quote[k] : undefined)) : undefined;

  const prevC = (prev.cocktails||[]).length;
  const newC  = (state.cocktails||[]).length;
  if(newC > prevC) parts.push('+'+(newC-prevC)+' cocktail'+(newC-prevC!==1?'s':''));
  else if(newC < prevC) parts.push('-'+(prevC-newC)+' cocktail'+(prevC-newC!==1?'s':''));

  const prevGuests = parseInt(fld(prev,'guestCount')||50);
  const newGuests  = parseInt(fld(state,'guestCount')||50);
  if(newGuests !== prevGuests) parts.push(newGuests+' guests');

  const prevHrs = parseFloat(fld(prev,'hoursOfService')||fld(prev,'eventHrs')||4);
  const newHrs  = parseFloat(fld(state,'hoursOfService')||fld(state,'eventHrs')||4);
  if(newHrs !== prevHrs) parts.push(newHrs+'h');

  const prevRate = parseFloat(fld(prev,'hourlyRate')||fld(prev,'hr')||100);
  const newRate  = parseFloat(fld(state,'hourlyRate')||fld(state,'hr')||100);
  if(newRate !== prevRate) parts.push('$'+newRate+'/h');

  const prevMargin = parseFloat(fld(prev,'marginPct')||fld(prev,'mp')||35);
  const newMargin  = parseFloat(fld(state,'marginPct')||fld(state,'mp')||35);
  if(newMargin !== prevMargin) parts.push(newMargin+'% margin');

  const prevStaff = (prev.staff||prev.staffList||[]).length;
  const newStaff  = (state.staff||state.staffList||[]).length;
  if(newStaff !== prevStaff) parts.push(newStaff+' staff');

  const prevCocktailNames = (prev.cocktails||[]).map(c=>c.name).sort().join(',');
  const newCocktailNames  = (state.cocktails||[]).map(c=>c.name).sort().join(',');
  if(newCocktailNames !== prevCocktailNames && newC === prevC) parts.push('menu updated');

  if(parts.length === 0) parts.push('Minor update');
  return parts.join(' · ');
}


function scheduleAutosave(){
  if(autosaveTimer) clearTimeout(autosaveTimer);
  showAutosaveDot('saving');
  autosaveTimer = setTimeout(() => {
    const currentState = getSimpleState();
    if(currentState !== lastSavedState){
      showSaveStatus('saving');
      try {
        // 1. Crash-recovery autosave (localStorage, instant restore on crash)
        localStorage.setItem('bartender_autosave_v1', JSON.stringify({
          savedAt: new Date().toISOString(),
          eventLabel: v('eventLabel'),
          cocktails, staffList,
          settings: {
            gc: v('gc'), ed: v('ed'), eventHrs: v('eventHrs'),
            hr: v('hr'), mp: v('mp'), tf: v('tf'),
            drinksPerPerson: v('drinksPerPerson'), qn: v('qn')
          }
        }));
        lastSavedState = currentState;
        showAutosaveDot('saved');
        showSaveStatus('autosaved');
        setTimeout(() => showAutosaveDot(''), 2000);
      } catch(e){ console.log('Autosave failed:', e); }

      // 2. Auto-save to event library silently (with version history)
      if(currentEventId && v('eventLabel')){
        if(libraryAutosaveTimer) clearTimeout(libraryAutosaveTimer);
        libraryAutosaveTimer = setTimeout(() => {
          saveEventToLibrary(true); // silent = true
        }, 180000); // 3 minutes after last change
      }
    } else {
      showAutosaveDot('');
      // No changes — hide the saving pill if it was shown
      const pill = el('saveStatusPill');
      if(pill && pill.textContent === '⏳ Saving…') pill.style.display = 'none';
    }
  }, 1500);
}

function showAutosaveDot(state){
  const dot = document.getElementById('autosaveDot');
  if(!dot) return;
  dot.className = 'autosave-dot' + (state ? ' ' + state : '');
}

function checkAutosaveRestore(){
  try {
    const saved = localStorage.getItem('bartender_autosave_v1');
    if(!saved) return;
    const data = JSON.parse(saved);
    const savedAt = new Date(data.savedAt);
    const mins = Math.round((Date.now() - savedAt) / 60000);
    if(mins < 60 && data.eventLabel && data.cocktails && data.cocktails.length > 0){
      // Only offer restore if different from current state
      if(data.eventLabel !== v('eventLabel') || data.cocktails.length !== cocktails.length){
        const msg = 'Unsaved session found from ' + mins + ' minute' + (mins!==1?'s':'') + ' ago ('
          + data.eventLabel + ' · ' + data.cocktails.length + ' cocktail' + (data.cocktails.length!==1?'s':'') + '). Restore it?';
        if(confirm(msg)){
          sv('eventLabel', data.eventLabel || '');
          cocktails = data.cocktails || [];
          staffList = data.staffList || [];
          if(data.settings){
            const s = data.settings;
            if(s.gc) sv('gc', s.gc);
            if(s.ed) sv('ed', s.ed);
            if(s.eventHrs) sv('eventHrs', s.eventHrs);
            if(s.hr) sv('hr', s.hr);
            if(s.mp) sv('mp', s.mp);
            if(s.tf) sv('tf', s.tf);
            if(s.drinksPerPerson) sv('drinksPerPerson', s.drinksPerPerson);
            if(s.qn) sv('qn', s.qn);
          }
          menuEventActive = true;
          rC(); rQ(); syncSettings(); updateMenuStep();
          showToast('Session restored from autosave', 'success');
        }
        localStorage.removeItem('bartender_autosave_v1');
      }
    }
  } catch(e){ console.log('Autosave restore failed:', e); }
}

// ═══════════════════════════════════════════════════════════
function markUnsaved(){
  const sf = document.getElementById('savedFlash');
  if(sf) sf.style.display='none';
  scheduleAutosave();
  // Debounced auto-save to event library (silent — no file download)
  if(window._evSaveTimer) clearTimeout(window._evSaveTimer);
  window._evSaveTimer = setTimeout(() => {
    if(v('eventLabel')) saveEventToLibrary(true); // silent = no download
  }, 3000);
  // Debounced auto-save cocktails to recipe library
  if(window._libSaveTimer) clearTimeout(window._libSaveTimer);
  window._libSaveTimer = setTimeout(autoSaveAllToLibrary, 2000);
}
function showSaveStatus(type){
  // type: 'saving' | 'autosaved' | 'manualsaved'
  const pill = el('saveStatusPill');
  if(!pill) return;
  if(window._saveStatusTimer) clearTimeout(window._saveStatusTimer);

  const configs = {
    saving:      { text: '⏳ Saving…',      bg: 'var(--amber-bg)',  color: 'var(--amber)' },
    autosaved:   { text: '⚡ Auto-saved',    bg: 'var(--surface2)',  color: 'var(--text3)' },
    manualsaved: { text: '✅ Saved',         bg: 'var(--green-bg)',  color: 'var(--green)' },
  };
  const cfg = configs[type] || configs.autosaved;
  pill.textContent = cfg.text;
  pill.style.background = cfg.bg;
  pill.style.color = cfg.color;
  pill.style.display = 'block';
  pill.style.opacity = '1';

  if(type !== 'saving'){
    window._saveStatusTimer = setTimeout(function(){
      pill.style.opacity = '0';
      setTimeout(function(){ pill.style.display = 'none'; pill.style.opacity = '1'; }, 400);
    }, type === 'manualsaved' ? 3000 : 4000);
  }
}

function showSaveNotification(label, isNew){
  // Remove any existing notification
  const existing = document.getElementById('saveNotifBanner');
  if(existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'saveNotifBanner';
  banner.style.cssText = [
    'position:fixed',
    'top:64px',
    'left:50%',
    'transform:translateX(-50%) translateY(-12px)',
    'background:var(--surface)',
    'border:1.5px solid var(--border)',
    'border-radius:var(--radius-xl)',
    'padding:12px 20px',
    'box-shadow:var(--shadow-lg)',
    'z-index:9999',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'font-family:var(--font)',
    'font-size:13px',
    'color:var(--text)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity .2s, transform .2s',
    'white-space:nowrap',
  ].join(';');

  const icon = isNew ? '🎉' : '✅';
  const msg  = isNew
    ? '<strong>' + label + '</strong> added to your event library'
    : '<strong>' + label + '</strong> saved';

  banner.innerHTML = '<span style="font-size:18px;line-height:1;">' + icon + '</span>'
    + '<div>'
    +   '<div style="font-weight:600;">' + (isNew ? 'Event saved!' : 'Changes saved') + '</div>'
    +   '<div style="font-size:11px;color:var(--text3);">' + msg + '</div>'
    + '</div>';

  document.body.appendChild(banner);

  // Animate in
  requestAnimationFrame(function(){
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Auto-dismiss after 2.5s
  setTimeout(function(){
    banner.style.opacity = '0';
    banner.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(function(){ banner.remove(); }, 250);
  }, 2500);
}

function flashSaved(){
  const revertBtn = el('revertBtn'); if(revertBtn) revertBtn.style.display = 'none';
  const flashEl = document.getElementById('savedFlash');
  if(flashEl){ flashEl.style.display='inline'; setTimeout(()=>{ flashEl.style.display='none'; }, 2000); }
  showSaveStatus('manualsaved');
}


