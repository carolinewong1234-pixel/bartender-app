// ═══ STATE MANAGEMENT ═══
// Q object, sv() override, qv/qvf/qvi, cocktails, nIng, eventLibrary,
// currentEventId, makeEventEntry, getState/applyState

let eventLibrary = [];

let currentEventId = null; // tracks currently loaded event

// ── Q: In-memory quote state — single source of truth ──
// sv() keeps DOM + Q in sync. Calc functions read from Q, not DOM.
// This eliminates stale reads from hidden or unrendered DOM fields.
const Q = {
  eventLabel:    '',
  cn:            '',
  ed:            '',
  gc:            50,
  eventHrs:      4,
  hr:            100,
  mp:            35,
  tf:            0,
  drinksPerPerson: 5,
  bufferPct:     0,
  discountAmt:   0,
  discountPct:   0,
  depositAmt:    0,
  qn:            '',
  quoteStatus:   'draft',
  p1name: '', p1drink: '', p1cat: '',
  p2name: '', p2drink: '', p2cat: '',
};

// Override sv() to also update Q
const _sv_original = function(id, val){
  const e = document.getElementById(id);
  if(e) e.value = val;
};
function sv(id, val){
  _sv_original(id, String(val !== undefined && val !== null ? val : ''));
  if(id in Q){
    // Store as correct type
    const num = parseFloat(val);
    Q[id] = (id === 'eventLabel' || id === 'cn' || id === 'ed' || id === 'qn' ||
              id === 'quoteStatus' || id === 'p1name' || id === 'p1drink' || id === 'p1cat' ||
              id === 'p2name' || id === 'p2drink' || id === 'p2cat')
      ? String(val || '')
      : (isNaN(num) ? 0 : num);
  }
}

// qv() — read from Q (safe, always current)
// Falls back to DOM if field not in Q
function qv(id){  return id in Q ? String(Q[id]) : v(id); }
function qvf(id){ return id in Q ? parseFloat(Q[id]) || 0 : vf(id); }
function qvi(id){ return id in Q ? parseInt(Q[id])   || 0 : vi(id); }

// ── SCHEMA: Single source of truth for event library entry shape ──
// Call this everywhere an entry is created or updated.
// Guarantees every field exists with correct type — no more undefined crashes.
function makeEventEntry(partial, existing){
  const ex = existing || {};
  return {
    // Identity
    id:            ex.id            || partial.id       || ('ev_' + Date.now()),
    label:         partial.label    || ex.label         || 'Untitled event',
    eventDate:     partial.eventDate|| ex.eventDate     || '',
    eventType:     partial.eventType|| ex.eventType     || window._selectedEventType || null,
    // Counts
    guestCount:    partial.guestCount   || ex.guestCount    || 50,
    cocktailCount: partial.cocktailCount|| ex.cocktailCount || 0,
    // Status
    status:        partial.status   || ex.status        || 'draft',
    savedAt:       partial.savedAt  || new Date().toISOString(),
    // Financial
    totalQuoted:   partial.totalQuoted  || ex.totalQuoted   || 0,
    // Full state snapshot
    state:         partial.state    || ex.state         || null,
    // Version history
    stateHistory:  ex.stateHistory  || [],
    // Quote / invoice documents
    quoteSnapshot:   ex.quoteSnapshot   || null,
    quoteSentAt:     ex.quoteSentAt     || null,
    quoteHistory:    ex.quoteHistory    || [],
    invoiceSnapshot: ex.invoiceSnapshot || null,
    invoiceFinalAt:  ex.invoiceFinalAt  || null,
    invoiceSentAt:   ex.invoiceSentAt   || null,
    invoiceTotal:    ex.invoiceTotal    || null,
    // Payment
    depositPaid:     ex.depositPaid     || null,
    paymentStatus:   ex.paymentStatus   || 'unpaid',
    depositAmount:   ex.depositAmount   || null,
    depositDate:     ex.depositDate     || null,
    paidAmount:      ex.paidAmount      || null,
    paidDate:        ex.paidDate        || null,
    paymentMethod:   ex.paymentMethod   || null,
    proofOfPayment:  ex.proofOfPayment  || null,
    paidAt:          ex.paidAt          || null,
  };
}

// ═══════════════════════════════════════════════════════════
function getPairState(){
  return {
    p1name:v('p1name'),p1drink:v('p1drink'),p1desc:v('p1desc'),p1dpg:vf('p1dpg'),p1link:v('p1link'),
    p2name:v('p2name'),p2drink:v('p2drink'),p2desc:v('p2desc'),p2dpg:vf('p2dpg'),p2link:v('p2link'),
    pEventName:v('pEventName')
  };
}
function applyPairState(p){
  if(!p)return;
  ['p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>{
    sv(id, p[id]!==undefined ? p[id] : v(id));
  });
  if(p.p1dpg)sv('p1dpg',p.p1dpg);
  if(p.p2dpg)sv('p2dpg',p.p2dpg);
  populatePairLinks();
  if(p.p1link!==undefined)sv('p1link',p.p1link);
  if(p.p2link!==undefined)sv('p2link',p.p2link);
  rPairs();
}
function getState(){
  return {version:2,exportedAt:new Date().toISOString(),eventLabel:qv('eventLabel'),quoteStatus:qv('quoteStatus')||'draft',guestCount:qvi('gc'),staff:staffList.map(s=>({...s})),receiptCount:receipts.length,totalSpent:receipts.reduce((s,r)=>s+r.total,0),postEvent:{data:postEventData,notes:v('postEventNotes')},
    consumptionModel:{eventHrs:qvf('eventHrs'),drinksPerPerson:qvf('drinksPerPerson'),bufferPct:qvf('bufferPct')},
    cocktails,pair:getPairState(),
    quote:{clientName:qv('cn'),eventDate:qv('ed'),guestCount:qvi('gc'),hoursOfService:qvf('eventHrs'),hourlyRateCAD:qvf('hr'),discountAmt:qvf('discountAmt'),discountPct:qvf('discountPct'),markupPct:qvf('mp'),travelSetupCAD:qvf('tf'),notes:qv('qn')}};
}
function applyState(s){
  menuEventActive = true; // any state apply means we have an active event
  if(!s){ Logger.error('applyState: null state'); return; }
  if(s.version && s.version < 1){ Logger.error('applyState: unsupported version', {version:s.version}); return; }
  sv('eventLabel',s.eventLabel||'');
  sv('quoteStatus',s.quoteStatus||'draft');
  updateStatusBadge();
  cocktails=s.cocktails||[];
  const q=s.quote||{};
  sv('cn',q.clientName||q.cn||'');
  sv('ed',q.eventDate||q.ed||'');
  sv('gc',q.guestCount||q.qg2||50);
  sv('eventHrs',q.hoursOfService||q.sh||4);
  sv('hr',q.hourlyRateCAD||q.hr||100);
  sv('mp',q.markupPct||q.mp||35);
  sv('tf',q.travelSetupCAD||q.tf||0);
  sv('discountAmt',q.discountAmt||0);
  sv('discountPct',q.discountPct||0);
  sv('qn',q.notes||q.qn||'');
  sv('gc',s.guestCount||50);
  if(s.consumptionModel){
    const cm=s.consumptionModel;
    if(cm.eventHrs)sv('eventHrs',cm.eventHrs);
    // Support both old drinkRate format and new drinksPerPerson
    if(cm.drinksPerPerson!==undefined) sv('drinksPerPerson',cm.drinksPerPerson);
    else if(cm.drinkRate!==undefined){
      // Migrate: old format stored drinks/hr/guest — convert to total per person
      // Assume 4hr event as default for migration
      const hrs = cm.eventHrs || 4;
      sv('drinksPerPerson', Math.round(cm.drinkRate * hrs));
    }
    if(cm.bufferPct!==undefined)sv('bufferPct',cm.bufferPct);
    // nonDrinkerPct removed — he quotes for all guests drinking
  }
  staffList = (s.staff || []).map(st=>({...st}));
  renderStaff();
  if(s.postEvent){
    postEventData = s.postEvent.data || {};
    sv('postEventNotes', s.postEvent.notes || '');
  }
  syncSettings();
  rNI();rC();rShop();rQ();
  updateMenuStep();
  if(s.pair)applyPairState(s.pair);
  renderMyLibrarySection();
  renderRecipeLibrary();
  updateStatusBadge();
  updateMpEquiv();
  renderShoppingDeadline();
  flashSaved();
}
// ── DUPLICATE EVENT ──────────────────────────────────────
function dupeEvent(){
  const lbl = v('eventLabel');
  const newLbl = (lbl ? lbl + ' (copy)' : 'Copy of event');
  sv('eventLabel',newLbl);
  // Reset deposit and mark unsaved — everything else stays
  sv('depositAmt',0);
  const depEl = document.getElementById('depositStatus');
  if(depEl) depEl.textContent = '';
  markUnsaved();
  rQ();
  alert('Event duplicated as "' + newLbl + '". Update the client name, date, and deposit before saving.');
}
