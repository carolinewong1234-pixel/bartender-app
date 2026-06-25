// ═══ NAVIGATION & UI ═══
// Sidebar navigation, tab switching, mobile nav, overflow menu, undo system

// ── Page title map ──
const PAGE_TITLES = {
  dashboard:      'Dashboard',
  menu:           'Menu Builder',
  events:         'Events',
  shopping:       'Shopping List',
  postevent:      'Post-Event',
  recipelib:      'Recipe Library',
  mydb:           'Ingredients',
  inventory:      'Stock',
  receipts:       'Receipts',
  priceiq:        'Price IQ',
  retailerprices: 'Retailers'
};

// ── Legacy compat: GROUP_MAP still referenced by some functions ──
const GROUP_MAP = {
  event:     { subtabs: 'subtabs-event',     defaultTab: 'menu',      tabs: ['menu','postevent'] },
  shopping:  { subtabs: 'subtabs-shopping',   defaultTab: 'shopping',  tabs: ['shopping'] },
  recipes:   { subtabs: 'subtabs-recipes',   defaultTab: 'recipelib', tabs: ['recipelib','mydb'] },
  inventory: { subtabs: 'subtabs-inventory', defaultTab: 'inventory', tabs: ['inventory','receipts','priceiq','retailerprices'] },
  business:  { subtabs: 'subtabs-business',  defaultTab: 'events',    tabs: ['events','dashboard'] }
};
let currentGroup = 'event';
const groupLastTab = { event:'menu', recipes:'recipelib', inventory:'inventory', business:'events' };

let currentNav = 'dashboard';

// ── PRIMARY NAVIGATION ──
function navTo(id) {
  currentNav = id;

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const navBtn = document.getElementById('nav-' + id);
  if(navBtn) navBtn.classList.add('active');

  // Update mobile nav active state
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const mnavBtn = document.getElementById('mnav-' + id);
  if(mnavBtn) mnavBtn.classList.add('active');

  // Update page title
  const titleEl = document.getElementById('pageTitle');
  if(titleEl) titleEl.textContent = PAGE_TITLES[id] || id;

  // Event header actions — show on event-related tabs
  const eventTabs = ['menu', 'shopping', 'postevent'];
  const eventActions = document.getElementById('eventHeaderActions');
  if(eventActions) eventActions.style.display = eventTabs.includes(id) ? 'flex' : 'none';

  // Event settings card — show on post-event, hide on standalone
  const settingsCard = document.getElementById('eventSettingsCard');
  if(id === 'postevent') toggleEventSettings(true);
  else if(id === 'menu') {
    // Menu tab: settings handled by updateMenuStep
  } else {
    toggleEventSettings(false);
  }

  // Close sidebar on mobile
  closeSidebar();

  // Scroll to top
  const main = document.getElementById('mainContent');
  if(main) main.scrollTop = 0;

  // Switch content panel via sw()
  sw(id, null);
}

// ── Legacy switchGroup compat ──
function switchGroup(group, btn) {
  const targetTab = groupLastTab[group] || GROUP_MAP[group].defaultTab;
  navTo(targetTab);
}

// ── SIDEBAR TOGGLE (mobile) ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if(!sidebar) return;
  sidebar.classList.toggle('open');
  if(overlay) overlay.classList.toggle('show');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if(sidebar) sidebar.classList.remove('open');
  if(overlay) overlay.classList.remove('show');
}

// ═══ UNDO SYSTEM ═══
const UNDO_STACK = [];
const UNDO_MAX = 30;
let undoToastTimer = null;

function pushUndo(description, undoFn){
  UNDO_STACK.push({ description, undoFn, timestamp: Date.now() });
  if(UNDO_STACK.length > UNDO_MAX) UNDO_STACK.shift();
  showUndoToast(description);
}

function showUndoToast(msg){
  const toast = document.getElementById('undoToast');
  const msgEl = document.getElementById('undoToastMsg');
  if(!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  if(undoToastTimer) clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

function doUndo(){
  const toast = document.getElementById('undoToast');
  if(!UNDO_STACK.length){ if(toast) toast.classList.remove('show'); return; }
  const action = UNDO_STACK.pop();
  try { action.undoFn(); }
  catch(e){ console.log('Undo failed:', e); }
  if(toast) toast.classList.remove('show');
  if(undoToastTimer) clearTimeout(undoToastTimer);
  showToast('↩ Undone: ' + action.description, 'success');
}

// ═══ OVERFLOW MENU ═══
function toggleOverflowMenu(){
  const m = el('overflowMenu');
  if(!m) return;
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
  if(m.style.display === 'block'){
    setTimeout(() => document.addEventListener('click', closeOverflowOnce, {once:true}), 10);
  }
}
function closeOverflowOnce(e){ if(!el('overflowMenu').contains(e.target)) closeOverflow(); }
function closeOverflow(){ const m=el('overflowMenu'); if(m) m.style.display='none'; }

// ── Legacy TAB_TITLES (still used by some functions) ──
const TAB_TITLES = {
  recipelib: '📖 My recipes',
  mydb:      '⭐ My ingredients',
  inventory: '📦 Stock',
  receipts:  '🧾 Receipts',
  priceiq:   '📊 Price IQ',
  events:    '📅 Events',
  dashboard: '📈 Dashboard'
};

function setToolbarContext(tabId){
  // Legacy — now handled by navTo
}

function toggleMenuSettings(){
  const card = el('eventSettingsCard');
  const body = el('eventSettingsBody');
  const btn  = el('eventSettingsToggleBtn');
  const cardWasHidden = !card || card.style.display === 'none';
  if(card) card.style.display = '';
  if(body){
    const shouldOpen = cardWasHidden ? true : body.style.display === 'none';
    body.style.display = shouldOpen ? 'block' : 'none';
    if(btn) btn.textContent = shouldOpen ? '▲ Hide' : '▼ Show';
  }
}

function toggleEventSettings(forceOpen){
  const card = el('eventSettingsCard');
  const body = el('eventSettingsBody');
  const btn  = el('eventSettingsToggleBtn');
  if(!card) return;

  if(forceOpen === false){
    card.style.display = 'none';
    return;
  }

  const onMenuTab = document.getElementById('menu') && document.getElementById('menu').classList.contains('active');
  if(onMenuTab && forceOpen === true){
    const step2 = el('menuStep2');
    if(!step2 || step2.style.display === 'none') return;
    card.style.display = '';
    if(body) body.style.display = 'none';
    if(btn) btn.textContent = '▼ Show';
    return;
  }

  card.style.display = '';
  if(!body) return;
  if(forceOpen === true){
    body.style.display = 'block';
    if(btn) btn.textContent = '▲ Hide';
  } else {
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    if(btn) btn.textContent = open ? '▲ Hide' : '▼ Show';
  }
}

// ═══ sw() — CORE TAB SWITCH (called by navTo and by internal code) ═══
function sw(id, btn){
  setToolbarContext(id);

  // Update group tracking (legacy compat)
  for(const [g, info] of Object.entries(GROUP_MAP)){
    if(info.tabs.includes(id)){
      groupLastTab[g] = id;
      currentGroup = g;
      break;
    }
  }

  // Show/hide content sections
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  const secEl = document.getElementById(id);
  if(secEl) secEl.classList.add('active');

  // Render the section that just became visible
  if(id==='menu'){
    if(menuEventActive === 'selecting'){
      const _midSlot = el('step1SettingsSlot');
      if(_midSlot) _midSlot.style.display = 'none';
      const _midNext = el('menuStep1Next');
      if(_midNext) _midNext.style.display = 'none';
    }
    renderMyLibrarySection(); syncSettings(); rC(); rQ(); updateMenuStep();
  }
  if(id==='shopping'){
    if(currentEventId && shopSelectedEventIds !== null && !shopSelectedEventIds.has(currentEventId)){
      if(shopSelectedEventIds.size === 0) shopSelectedEventIds.add(currentEventId);
    } else if(currentEventId && shopSelectedEventIds === null){
      shopSelectedEventIds = new Set([currentEventId]);
    }
    renderShopEventSelector(); rShop(); renderShoppingDeadline();
  }
  if(id==='events') renderEventLibrary();
  if(id==='masterlist') renderMasterList();
  if(id==='mydb') renderMyDB();
  if(id==='receipts') renderReceipts();
  if(id==='priceiq') renderPriceIQ(priceIQCache||[], 0);
  if(id==='retailerprices') renderRetailerPriceLibrary();
  if(id==='recipelib') renderRecipeLibrary();
  if(id==='postevent') renderPostEvent();
  if(id==='inventory') renderInventory();
  if(id==='dashboard') renderDashboard();
}
