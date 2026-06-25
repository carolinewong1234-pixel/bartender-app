// ═══ POST-EVENT & INVENTORY ═══
// Post-event checklist, stock count, auto-fill leftovers,
// inventory management, loadAndInvoice

function autoFillLeftovers(){
  const items = window._lastShopItems || getIM(vi('gc')||50);
  if(!items.length){ showToast('Build a shopping list first to auto-fill leftovers','error'); return; }
  let filled = 0;
  items.forEach(function(item){
    const key = item.name.toLowerCase().trim();
    if(!postEventData) postEventData = {};
    if(!postEventData[key]){
      const bi = item.bottleInfo;
      const totalBought = bi ? item.bottles * (bi.bottleOz||25.36) : item.qtyRaw;
      const consumed    = item.qty || item.qtyRaw || 0;
      const leftover    = Math.max(0, parseFloat((totalBought - consumed).toFixed(2)));
      postEventData[key] = {
        actualLeftover: leftover,
        estimatedLeftover: leftover,
        unit: item.unit || 'oz',
        name: item.name,
        cpu: item.cpu || 0,
        boughtQty: totalBought,
        confirmedPurchased: true,
        source: 'auto'
      };
      filled++;
    }
  });
  renderPostEvent();
  updatePostEventChecklist();
  showToast('✓ Auto-filled ' + filled + ' leftover items', 'success');
}

function loadAndInvoice(evId){
  loadEventFromLibrary(evId);
  // Switch to post-event tab and open invoice
  setTimeout(function(){
    const peBtn = el('st-postevent');
    if(peBtn) sw('postevent', peBtn);
    setTimeout(function(){
      updatePostEventChecklist();
      openFinalInvoice();
    }, 150);
  }, 300);
}

function updatePostEventChecklist(){
  const ev = currentEventId ? eventLibrary.find(function(e){ return e.id===currentEventId; }) : null;
  const status = v('quoteStatus') || (ev && ev.status) || 'draft';
  const hasMenu = cocktails.length > 0;
  const hasQuote = ev && (ev.quoteHistory && ev.quoteHistory.length > 0 || ev.quoteSnapshot);
  const isConfirmed = status === 'confirmed' || status === 'completed';
  const hasDeposit = parseFloat(v('depositAmt')||0) > 0;
  const eventDate = v('ed') || (ev && ev.eventDate);
  const isPast = eventDate && new Date(eventDate) < new Date();
  const hasShopping = ev && shopSelectedEventIds && shopSelectedEventIds.has(ev.id || '');
  const hasStock = Object.values(postEventData||{}).some(function(d){ return (d.actualLeftover||0) > 0; });
  const hasInvoice = ev && ev.invoiceSentAt;
  const isPaid = status === 'completed' || (ev && ev.paidAt);

  function setCheck(id, done, na){
    const row = el('pec-'+id);
    const st  = el('pecs-'+id);
    if(!row||!st) return;
    if(na){
      row.className = 'pe-check';
      row.style.opacity = '0.4';
      st.textContent = 'N/A';
      st.style.color = 'var(--text3)';
    } else {
      row.style.opacity = '';
      row.className = 'pe-check' + (done?' done':'');
      st.textContent = done ? '✓' : '—';
      st.style.color = done ? 'var(--green)' : 'var(--text3)';
    }
  }

  // Pre-event tasks — show greyed out if event is past
  setCheck('menu',      hasMenu,      false);
  setCheck('quote',     hasQuote,     false);
  setCheck('confirmed', isConfirmed,  false);
  setCheck('deposit',   hasDeposit,   false);
  setCheck('shopping',  hasShopping,  false);

  // Post-event tasks — only relevant after event date
  setCheck('stock',   hasStock,   !isPast);
  setCheck('invoice', hasInvoice, !isPast);
  setCheck('paid',    isPaid,     !isPast);

  // Show/hide a divider between pre and post tasks
  const divider = el('pec-divider');
  if(divider) divider.style.display = '';

  // Update event name in header
  const nameEl = el('postEventEventName');
  if(nameEl) nameEl.textContent = v('eventLabel') ? '📅 ' + v('eventLabel') : '';
}


function importAllData(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if(d.customIngredients) { myIngredients = d.customIngredients; saveMyDB(); syncMyDBtoFlat(); }
      if(d.priceHistory) { priceHistory = d.priceHistory; savePriceHistory(); }
      if(d.recipeLibrary) { recipeLibrary = d.recipeLibrary; saveRecipeLibraryStore(); }
      if(d.receipts) { receipts = d.receipts; saveReceipts(); }
      if(d.currentStock) { currentStock = d.currentStock; saveStock(); }
      if(d.eventLibrary) { eventLibrary = d.eventLibrary; saveEventLibraryStore(); }
      if(d.eventCategories) { eventCategories = d.eventCategories; saveEventCategories(); }
      renderMyDB(); renderRecipeLibrary(); renderReceipts();
      showToast('All data imported successfully', 'success');
    } catch(err){ showToast('Could not read data file', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ════════════════════════════════════════════════════════════
// POST-EVENT INVENTORY
// ════════════════════════════════════════════════════════════

// Stock carries forward between events
// Structure: { ingredientKey: { name, unit, qty, cpu, lastUpdated, eventLabel } }
let currentStock = {};

function loadStock() {
  try {
    const stored = localStorage.getItem('bartender_stock_v1');
    if (stored) currentStock = JSON.parse(stored);
  } catch(e) { currentStock = {}; }
}

function saveStock() {
  try { localStorage.setItem('bartender_stock_v1', JSON.stringify(currentStock)); }
  catch(e) { console.error('Could not save stock:', e); }
}

// postEventData holds the current post-event form state
let postEventData = {}; // { ingredientKey: { actualLeftover } }

// Build the list of actually-purchased items from receipts tagged to this event
function getPurchasedItems() {
  const eventLabel = v('eventLabel') || '';
  const purchased = {};

  // Step 1: pull from scanned receipts for this event
  const eventReceipts = receipts.filter(r =>
    !eventLabel || r.eventLabel === eventLabel
  );
  eventReceipts.forEach(r => {
    (r.items || []).forEach(item => {
      if (!item.is_bar_ingredient || !item.matched_ingredient) return;
      const key = item.matched_ingredient.toLowerCase().trim();
      if (!purchased[key]) {
        // Find the ingredient in INGFLAT to get cpu and unit
        const flat = INGFLAT.find(f => f.name.toLowerCase() === key)
                  || myIngredients.find(m => m.name.toLowerCase() === key);
        const cpu = flat ? flat.c : (item.unit_price > 8 ? item.unit_price/25.36 : item.unit_price);
        purchased[key] = {
          name: item.matched_ingredient,
          key,
          unit: flat ? flat.unit : 'oz',
          cpu,
          boughtQty: item.quantity || 1,
          source: 'receipt',
          receiptStore: r.store,
          receiptDate: r.date
        };
      } else {
        // accumulate quantity if bought multiple times
        purchased[key].boughtQty += (item.quantity || 1);
      }
    });
  });

  // Step 2: also include items manually marked as purchased in postEventData
  Object.entries(postEventData).forEach(([key, d]) => {
    if (d.confirmedPurchased && !purchased[key]) {
      purchased[key] = {
        name: d.name, key, unit: d.unit, cpu: d.cpu,
        boughtQty: d.boughtQty || 0, source: 'manual'
      };
    }
  });

  // Step 3: if no receipts at all, fall back to the full shopping list
  // so the tab is still useful before receipts are scanned
  if (Object.keys(purchased).length === 0) {
    const guests = vi('gc');
    const {effectiveGuests} = getConsumptionGuests();
    const items = getIM(effectiveGuests);
    items.forEach(item => {
      const key = item.name.toLowerCase().trim();
      purchased[key] = {
        name: item.name, key, unit: item.unit, cpu: item.cpu,
        boughtQty: item.bottleInfo ? item.qtyRounded : item.qtyRaw,
        source: 'estimate',
        estimatedLeftover: item.bottleInfo ? parseFloat(item.leftover.toFixed(2)) : 0
      };
    });
  }

  return Object.values(purchased);
}

function renderPostEvent() {
  const hasMenu = cocktails.length > 0;
  const emptyEl = el('postEventEmpty');
  const contentEl = el('postEventContent');

  if (!hasMenu) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';

  const purchasedItems = getPurchasedItems();
  const hasReceipts = receipts.some(r => !v('eventLabel') || r.eventLabel === v('eventLabel'));
  const isEstimate = !hasReceipts;

  // Show a banner if using estimates (no receipts yet)
  const banner = isEstimate
    ? '<div style="font-size:12px;background:#fdf5e8;border:1px solid #f0d080;border-radius:8px;padding:8px 12px;margin-bottom:12px;color:#a06020;">⚠ No receipts scanned for this event yet — showing estimated quantities. Scan your receipts first for accurate leftover tracking.</div>'
    : '<div style="font-size:12px;background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;margin-bottom:12px;color:#1a7a4a;">✓ Based on ' + receipts.filter(r => !v("eventLabel") || r.eventLabel === v("eventLabel")).length + ' scanned receipt(s) for this event.</div>';
  shtml('postEventBanner', banner);

  // Initialise postEventData for each purchased item
  purchasedItems.forEach(p => {
    const key = p.key;
    if (postEventData[key] === undefined) {
      const estLeftover = p.estimatedLeftover !== undefined ? p.estimatedLeftover : 0;
      postEventData[key] = {
        actualLeftover: estLeftover,
        unit: p.unit,
        name: p.name,
        cpu: p.cpu,
        boughtQty: p.boughtQty,
        estimatedLeftover: estLeftover,
        confirmedPurchased: true,
        source: p.source
      };
    }
  });

  const items = purchasedItems; // alias for rest of function
  const bottledItems = items.filter(i => i.unit === 'oz');
  const otherItems = items.filter(i => i.unit !== 'oz');

  // Summary
  const totalBought = items.reduce((s, i) => s + i.purchaseCost, 0);
  const totalEstLeftover = items.reduce((s, i) => s + i.leftoverValue, 0);
  const totalActualLeftover = Object.values(postEventData)
    .reduce((s, d) => s + (d.actualLeftover || 0) * (d.cpu || 0), 0);
  const totalUsedValue = totalBought - totalActualLeftover;
  const varianceVsEst = totalActualLeftover - totalEstLeftover;

  shtml('invSummary', `
    <div class="met"><div class="ml">Total purchased</div><div class="mv">$${totalBought.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Est. leftover value</div><div class="mv">$${totalEstLeftover.toFixed(2)}</div></div>
    <div class="met ${totalActualLeftover >= totalEstLeftover ? '' : 'loss'}" style="${totalActualLeftover < totalEstLeftover ? 'background:#fdf0ef;' : ''}">
      <div class="ml">Actual leftover value</div>
      <div class="mv" style="${totalActualLeftover < totalEstLeftover ? 'color:#c0392b;' : 'color:#1a7a4a;'}">$${totalActualLeftover.toFixed(2)}</div>
    </div>
    <div class="met" style="${varianceVsEst < -2 ? 'background:#fdf0ef;' : varianceVsEst > 2 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Variance vs estimate</div>
      <div class="mv" style="${varianceVsEst < 0 ? 'color:#c0392b;' : 'color:#1a7a4a;'}">
        ${varianceVsEst >= 0 ? '+' : ''}$${varianceVsEst.toFixed(2)}
      </div>
    </div>`);

  // Build table rows
  const allItems = [...bottledItems, ...otherItems];
  const rows = allItems.map(item => {
    const key = item.name.toLowerCase().trim();
    const d = postEventData[key] || { actualLeftover: 0, estimatedLeftover: 0, cpu: item.cpu, unit: item.unit };
    const actual = parseFloat(d.actualLeftover) || 0;
    const estimated = parseFloat(d.estimatedLeftover) || 0;
    const diff = actual - estimated;
    const diffClass = diff > 0.1 ? 'inv-diff-pos' : diff < -0.1 ? 'inv-diff-neg' : 'inv-diff-ok';
    const diffLabel = diff > 0.1 ? '+' + diff.toFixed(1) + ' more' : diff < -0.1 ? diff.toFixed(1) + ' less' : '≈ as expected';
    const actualValue = actual * item.cpu;
    const bought = item.bottleInfo ? item.qtyRounded.toFixed(1) + ' oz (' + item.bottles + ' btl)' : item.qtyRaw.toFixed(1);

    return `<div class="inv-row" id="invrow_${key.replace(/[^a-z0-9]/g,'_')}">
      <div>
        <div style="font-weight:500;">${item.name}</div>
        <div style="font-size:11px;color:#aaa;margin-top:1px;">$${item.cpu.toFixed(4)}/${item.unit} · <span class="${diffClass}">${diffLabel}</span></div>
      </div>
      <span style="color:#888;">${bought}</span>
      <span style="color:#aaa;">${estimated.toFixed(1)}</span>
      <input type="number" value="${actual}" min="0" step="0.1"
        onchange="updateActualLeftover('${key.replace(/'/g,"\'")}', this.value)"
        style="border:1px solid #ddd;border-radius:6px;background:#fff;color:#1a1a1a;"
        title="Enter the actual amount left after the event">
      <span style="color:#888;">${item.unit}</span>
      <span style="color:#1a7a4a;font-weight:500;">$${actualValue.toFixed(2)}</span>
    </div>`;
  }).join('');

  shtml('invTable', rows || '<div style="font-size:13px;color:#aaa;padding:8px 0;">No ingredients found — build a shopping list first.</div>');

  // Stock carry-over summary
  const carryItems = Object.values(postEventData).filter(d => (d.actualLeftover || 0) > 0);
  if (carryItems.length) {
    const carryHTML = carryItems.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid #f0f0eb;font-size:13px;">
        <span>${d.name}</span>
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="color:#888;">${(d.actualLeftover || 0).toFixed(1)} ${d.unit}</span>
          <span class="stock-carry">→ carries to next event</span>
          <span style="color:#1a7a4a;font-weight:500;">$${((d.actualLeftover || 0) * (d.cpu || 0)).toFixed(2)}</span>
        </div>
      </div>`).join('');

    shtml('stockCarryOver', `
      <div class="card">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">
          📦 Carry-over stock — goes into your inventory for the next event
        </div>
        ${carryHTML}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding-top:8px;border-top:1px solid #eee;margin-top:4px;">
          <span>Total carry-over value</span>
          <span style="color:#1a7a4a;">$${carryItems.reduce((s,d) => s + (d.actualLeftover||0)*(d.cpu||0), 0).toFixed(2)} CAD</span>
        </div>
        <div style="font-size:12px;color:#888;margin-top:6px;">
          💡 Click "Move to inventory stock" to add this leftover to your inventory.
          It will reduce your shopping costs on the next event — and the difference between
          what you quoted and what you actually spend is your extra profit.
        </div>
        <div class="fe" style="margin-top:10px;">
          <button class="btn btn-sm btn-success" onclick="applyCarryOverToResale()">
            ✓ Move to inventory stock
          </button>
        </div>
      </div>`);
  } else {
    shtml('stockCarryOver', '');
  }
}

function updateActualLeftover(key, value) {
  const safeKey = key;
  if (!postEventData[safeKey]) return;
  postEventData[safeKey].actualLeftover = parseFloat(value) || 0;
  // Recalculate the value cell inline
  const d = postEventData[safeKey];
  const actualValue = (d.actualLeftover || 0) * (d.cpu || 0);
  // Re-render summary only (not whole table — preserves focus)
  const guests = vi('gc');
  const items = getIM(guests);
  const totalBought = items.reduce((s, i) => s + i.purchaseCost, 0);
  const totalActualLeftover = Object.values(postEventData)
    .reduce((s, d2) => s + (d2.actualLeftover || 0) * (d2.cpu || 0), 0);
  const totalEstLeftover = items.reduce((s, i) => s + i.leftoverValue, 0);
  const varianceVsEst = totalActualLeftover - totalEstLeftover;
  shtml('invSummary', `
    <div class="met"><div class="ml">Total purchased</div><div class="mv">$${totalBought.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Est. leftover value</div><div class="mv">$${totalEstLeftover.toFixed(2)}</div></div>
    <div class="met" style="${totalActualLeftover < totalEstLeftover ? 'background:#fdf0ef;' : ''}">
      <div class="ml">Actual leftover value</div>
      <div class="mv" style="${totalActualLeftover < totalEstLeftover ? 'color:#c0392b;' : 'color:#1a7a4a;'}">$${totalActualLeftover.toFixed(2)}</div>
    </div>
    <div class="met" style="${varianceVsEst < -2 ? 'background:#fdf0ef;' : varianceVsEst > 2 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Variance vs estimate</div>
      <div class="mv" style="${varianceVsEst < 0 ? 'color:#c0392b;' : 'color:#1a7a4a;'}">
        ${varianceVsEst >= 0 ? '+' : ''}$${varianceVsEst.toFixed(2)}
      </div>
    </div>`);
}

function autoFillEstimated() {
  // Reset to 0 for all purchased items — forces him to enter real numbers
  const purchasedItems = getPurchasedItems();
  purchasedItems.forEach(p => {
    const key = p.key;
    if (postEventData[key]) {
      // Use estimated leftover if available, otherwise 0
      postEventData[key].actualLeftover = p.estimatedLeftover || 0;
    }
  });
  renderPostEvent();
  showToast('Reset to estimates — update each item with the actual amount left', 'success');
}

function savePostEvent() {
  // 1. Update currentStock with actual leftovers from purchased items
  const purchasedItems = getPurchasedItems();
  const eventLabel = v('eventLabel') || 'Unnamed event';
  const today = new Date().toISOString().split('T')[0];

  Object.entries(postEventData).forEach(([key, d]) => {
    const actual = parseFloat(d.actualLeftover) || 0;
    if (actual > 0) {
      // Add to stock (or update if already there)
      if (currentStock[key]) {
        currentStock[key].qty += actual;
        currentStock[key].lastUpdated = today;
        currentStock[key].eventLabel = eventLabel;
      } else {
        currentStock[key] = {
          name: d.name,
          unit: d.unit,
          qty: actual,
          cpu: d.cpu,
          lastUpdated: today,
          eventLabel
        };
      }
    }
  });
  saveStock();

  rQ();
  markUnsaved();

  // 3. Save notes
  const notes = v('postEventNotes');

  // 4. Record in price history as a data point
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    if (item.cpu > 0) {
      recordPrice(item.name, item.cpu, item.unit, 'Post-event stock', 'receipt');
    }
  });

  showToast('Post-event inventory saved. Stock and resale credit updated.', 'success');
  renderPostEvent();
}

function applyCarryOverToResale() {
  // Carry-over stock is tracked in inventory — it boosts his profit but does NOT change the client quote
  // Transfer actual leftovers from this event into currentStock
  const today = new Date().toISOString().split('T')[0];
  const eventLabel = v('eventLabel') || 'Unnamed event';
  let added = 0;
  Object.entries(postEventData).forEach(([key, d]) => {
    const actual = parseFloat(d.actualLeftover) || 0;
    if (actual > 0) {
      if (currentStock[key]) {
        currentStock[key].qty = parseFloat((currentStock[key].qty + actual).toFixed(4));
      } else {
        currentStock[key] = { name: d.name, unit: d.unit, qty: actual, cpu: d.cpu, lastUpdated: today, eventLabel, source: 'post-event' };
      }
      added++;
    }
  });
  saveStock();
  showToast(added + ' items moved to your inventory — they will reduce your shopping costs on the next event', 'success');
  renderInventory();
}

function exportPostEvent() {
  const guests = vi('gc');
  const items = getIM(guests);
  const eventLabel = v('eventLabel') || 'Event';
  const today = new Date().toISOString().split('T')[0];

  const rows = [['Ingredient','Unit','Bought (oz)','Est. leftover','Actual leftover','Difference','Unit cost CAD','Actual leftover value CAD']];
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    const d = postEventData[key] || {};
    const actual = parseFloat(d.actualLeftover) || 0;
    const estimated = parseFloat(d.estimatedLeftover) || item.leftover || 0;
    const diff = actual - estimated;
    rows.push([
      item.name, item.unit,
      item.bottleInfo ? item.qtyRounded.toFixed(2) : item.qtyRaw.toFixed(2),
      estimated.toFixed(2), actual.toFixed(2),
      (diff >= 0 ? '+' : '') + diff.toFixed(2),
      item.cpu.toFixed(4),
      (actual * item.cpu).toFixed(2)
    ]);
  });

  const totalActual = Object.values(postEventData).reduce((s,d) => s+(parseFloat(d.actualLeftover)||0)*(d.cpu||0),0);
  rows.push([]);
  rows.push(['Notes', v('postEventNotes') || '']);
  rows.push(['Total actual leftover value CAD', totalActual.toFixed(2)]);

  const csv = rows.map(r => r.map(val => {
    const s = String(val == null ? '' : val);
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');

  const lbl = eventLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = lbl + '_post_event_' + today + '.csv';
  a.click();
}

// ════════════════════════════════════════════════════════════
// INVENTORY & PROFIT TRACKER
// ════════════════════════════════════════════════════════════

function addToInventoryManual() {
  const name  = v('invAddName').trim();
  const qty   = parseFloat(v('invAddQty')) || 0;
  const unit  = v('invAddUnit') || 'oz';
  const price = parseFloat(v('invAddPrice')) || 0;
  const store = v('invAddStore').trim();
  if (!name) { alert('Enter an ingredient name.'); return; }
  if (qty <= 0) { alert('Enter a quantity greater than 0.'); return; }

  const key = name.toLowerCase().trim();
  const today = new Date().toISOString().split('T')[0];

  // Convert bottle price to per-oz if unit is 'bottle'
  let cpu = price;
  let finalUnit = unit;
  let finalQty = qty;
  if (unit === 'bottle') {
    cpu = parseFloat((price / 25.36).toFixed(4));
    finalQty = qty * 25.36;
    finalUnit = 'oz';
  } else if (price > 0 && qty > 0) {
    cpu = parseFloat((price / qty).toFixed(4));
  }

  if (currentStock[key]) {
    currentStock[key].qty = parseFloat((currentStock[key].qty + finalQty).toFixed(4));
    // Update price paid if provided
    if (price > 0) { currentStock[key].cpu = cpu; currentStock[key].pricePaid = price; }
    currentStock[key].lastUpdated = today;
  } else {
    currentStock[key] = {
      name, unit: finalUnit, qty: finalQty,
      cpu, pricePaid: price, store,
      lastUpdated: today,
      source: 'manual-purchase'
    };
  }

  // Record in price history
  if (price > 0) recordPrice(name, cpu, finalUnit, store || 'Manual purchase', 'receipt');

  saveStock();

  // Update ingredient database with real paid price
  const flat = INGFLAT.find(f => f.name.toLowerCase() === key);
  if (flat && cpu > 0) flat.c = cpu;
  const custom = myIngredients.find(m => m.name.toLowerCase() === key);
  if (custom && cpu > 0) { custom.c = cpu; saveMyDB(); }

  sv('invAddName', ''); sv('invAddQty', '1'); sv('invAddPrice', '0'); sv('invAddStore', '');
  renderInventory();
  showToast(name + ' added to inventory', 'success');
}

// Inventory autocomplete dropdown
function filterInvDD(query) {
  const ddEl = el('invAddDD');
  if (!ddEl) return;
  const q = (query || '').toLowerCase().trim();
  let html = '';
  let count = 0;
  Object.entries(INGDB).forEach(([cat, items]) => {
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice(0, 5);
    if (!filtered.length) return;
    html += `<div class="ing-group-label">${cat}</div>`;
    filtered.slice(0, 8).forEach(item => {
      const hi = q ? item.name.replace(new RegExp('(' + q + ')', 'gi'), '<strong>$1</strong>') : item.name;
      html += `<div class="ing-option" data-name="${item.name.replace(/"/g,'&quot;')}" data-unit="${item.unit}"
        onmousedown="pickInvIng(this.dataset.name, this.dataset.unit)">
        <span class="ing-option-name">${hi}</span>
        <span class="ing-option-meta">${item.unit}</span>
      </div>`;
      count++;
    });
  });
  if (!count) html = '<div style="padding:8px 12px;font-size:13px;color:#aaa;">Type to search or enter custom name</div>';
  ddEl.innerHTML = html;
  ddEl.classList.add('open');
  setTimeout(() => document.addEventListener('click', () => ddEl.classList.remove('open'), {once:true}), 10);
}

function pickInvIng(name, unit) {
  sv('invAddName', name);
  sv('invAddUnit', unit);
  const flat = INGFLAT.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (flat) sv('invAddPrice', (flat.c).toFixed(2));
  const ddEl = el('invAddDD');
  if (ddEl) ddEl.classList.remove('open');
}

function updateStockQty(key, val) {
  if (currentStock[key]) {
    currentStock[key].qty = parseFloat(val) || 0;
    saveStock();
  }
}

function removeStockItem(key) {
  if (!confirm('Remove "' + (currentStock[key] ? currentStock[key].name : key) + '" from inventory?')) return;
  delete currentStock[key];
  saveStock();
  renderInventory();
}

function clearUsedStock() {
  const before = Object.keys(currentStock).length;
  Object.keys(currentStock).forEach(k => { if ((currentStock[k].qty || 0) <= 0) delete currentStock[k]; });
  saveStock();
  renderInventory();
  const removed = before - Object.keys(currentStock).length;
  if (removed > 0) showToast(removed + ' empty item' + (removed > 1 ? 's' : '') + ' removed', 'success');
}

// How much of the current event's shopping list is covered by inventory
function getInventoryCoverage() {
  if (!cocktails.length || !Object.keys(currentStock).length) return [];
  const guests = vi('gc');
  const items = getIM(guests);
  return items.map(item => {
    const key = item.name.toLowerCase().trim();
    const stock = currentStock[key];
    const inStock = stock ? Math.min(stock.qty, item.qtyRounded || item.qtyRaw) : 0;
    const stillNeeded = Math.max(0, (item.qtyRounded || item.qtyRaw) - inStock);
    const coveragePct = item.qtyRounded > 0 ? Math.round((inStock / item.qtyRounded) * 100) : 0;
    const savedCost = inStock * item.cpu;
    return { ...item, inStock, stillNeeded, coveragePct, savedCost };
  });
}

// Profit line shown on the quote tab
function getInventoryProfitLine(guests) {
  const coverage = getInventoryCoverage();
  if (!coverage.length) return '';
  const totalSaved = coverage.reduce((s, i) => s + i.savedCost, 0);
  if (totalSaved < 0.01) return '';
  return `<div style="display:flex;align-items:center;gap:6px;font-size:13px;padding:8px 12px;background:#edfaf3;border-radius:8px;color:#1a7a4a;margin-top:8px;">
    📦 Inventory covers <strong>$${totalSaved.toFixed(2)} CAD</strong> of this event — that's extra profit you keep.
    <a href="#" onclick="event.preventDefault();sw('inventory',document.querySelector('.tab:last-child'))" style="color:#1a7a4a;text-decoration:underline;font-size:12px;margin-left:4px;">See details →</a>
  </div>`;
}

function renderInventory() {
  const keys = Object.keys(currentStock);
  const totalValue = keys.reduce((s, k) => s + (currentStock[k].qty || 0) * (currentStock[k].cpu || 0), 0);
  const totalItems = keys.length;
  const coverage = getInventoryCoverage();
  const totalSaved = coverage.reduce((s, i) => s + i.savedCost, 0);

  // Profit dashboard
  const quotedTotal = (() => {
    try {
      const guests=vi('gc'),hours=vf('eventHrs'),rate=vf('hr'),travel=vf('tf');
  const marginPct=getMpAsMargin();
  const mkup = marginPct < 100 ? (marginPct/(100-marginPct))*100 : marginPct;
      const taxEl2=el('taxEnabled'); const taxEnabled=taxEl2&&taxEl2.checked;
      const items=getIM(guests);
      const purchase=items.reduce((s,i)=>s+i.purchaseCost,0);
      const mked=purchase*(1+mkup/100),labor=hours*rate,staffLbr=getStaffLaborTotal();
      const sub=mked+labor+staffLbr+travel;
      const tps=taxEnabled?sub*0.05:0, tvq=taxEnabled?sub*0.09975:0;
      return sub+tps+tvq;
    } catch(e){ return 0; }
  })();

  const receiptTotal = receipts.reduce((s,r) => s + r.total, 0);
  const trueCost = receiptTotal > 0 ? receiptTotal : 0;
  const inventoryProfit = totalSaved;
  const markupProfit = quotedTotal > 0 ? (() => {
    try {
      const guests=vi('gc'),mkup=vf('mp');
      const items=getIM(guests);
      const purchase=items.reduce((s,i)=>s+i.purchaseCost,0);
      const discA=vf('discountAmt')||0, discP=vf('discountPct')||0;
      const sub=purchase*(1+mkup/100);
      return sub*(mkup/100/(1+mkup/100)) - discA - sub*(discP/100);
    } catch(e){ return 0; }
  })() : 0;

  if (quotedTotal > 0 || totalSaved > 0) {
    shtml('profitDashboard', `
      <div class="profit-card">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">💰 Profit breakdown — current event</div>
        <div class="profit-row"><span>Quoted to client</span><span style="font-weight:500;">$${quotedTotal.toFixed(2)}</span></div>
        ${receiptTotal > 0 ? `<div class="profit-row"><span>Actual receipts paid</span><span>- $${receiptTotal.toFixed(2)}</span></div>` : ''}
        <div class="profit-row" style="color:#1a7a4a;"><span>Inventory savings (stock used)</span><span style="color:#1a7a4a;">+ $${inventoryProfit.toFixed(2)}</span></div>
        <div class="profit-row" style="color:#1a7a4a;"><span>Markup profit</span><span style="color:#1a7a4a;">+ $${markupProfit.toFixed(2)}</span></div>
        <div class="profit-total">
          <span>Your estimated total profit</span>
          <span class="profit-green">$${(markupProfit + inventoryProfit).toFixed(2)} CAD</span>
        </div>
        <div style="font-size:11px;color:#aaa;margin-top:6px;">* Quote-based estimate. Scan receipts for exact actuals.</div>
      </div>`);
  } else {
    shtml('profitDashboard', '');
  }

  // Metrics
  shtml('invMetrics', `
    <div class="met"><div class="ml">Items in stock</div><div class="mv">${totalItems}</div></div>
    <div class="met"><div class="ml">Stock value CAD</div><div class="mv">$${totalValue.toFixed(2)}</div></div>
    <div class="met" style="${totalSaved > 0 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Event coverage</div>
      <div class="mv" style="${totalSaved > 0 ? 'color:#1a7a4a;' : ''}">$${totalSaved.toFixed(2)}</div>
    </div>
    <div class="met"><div class="ml">Stock entries</div><div class="mv">${keys.length}</div></div>`);

  // Stock table
  if (!keys.length) {
    shtml('stockTableWrap', '<div class="empty" style="padding:1.5rem;text-align:center;color:#aaa;">No inventory yet — add items above or complete a post-event record</div>');
  } else {
    const rows = keys.sort((a,b) => (currentStock[b].qty*currentStock[b].cpu) - (currentStock[a].qty*currentStock[a].cpu))
      .map(key => {
        const s = currentStock[key];
        const value = (s.qty || 0) * (s.cpu || 0);
        const srcClass = s.source === 'post-event' ? 'src-event' : s.source === 'receipt-scan' ? 'src-purchase' : 'src-manual';
        const srcLabel = s.source === 'post-event' ? 'Post-event' : s.source === 'receipt-scan' ? 'Receipt scan' : 'Manual';
        return `<div class="inv-stock-row">
          <div><div style="font-weight:500;">${s.name}</div><div style="font-size:11px;color:#aaa;">${s.store || ''} · ${s.lastUpdated || ''}</div></div>
          <input type="number" value="${(s.qty||0).toFixed(1)}" min="0" step="0.1"
            onchange="updateStockQty('${key.replace(/'/g,"\'")}', this.value);renderInventory()"
            style="border:1px solid #ddd;border-radius:6px;">
          <span style="color:#888;">${s.unit}</span>
          <span>$${(s.cpu||0).toFixed(4)}</span>
          <span style="color:#1a7a4a;font-weight:500;">$${value.toFixed(2)}</span>
          <span class="source-badge ${srcClass}">${srcLabel}</span>
          <button class="btn btn-sm btn-danger" data-key="${key.replace(/"/g,'&quot;')}"
            onclick="removeStockItem(this.dataset.key)">✕</button>
        </div>`;
      }).join('');
    shtml('stockTableWrap', `
      <div class="inv-stock-row inv-stock-header">
        <span>Ingredient</span><span>Qty</span><span>Unit</span><span>CAD$/unit</span><span>Value</span><span>Source</span><span></span>
      </div>${rows}
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding:8px 0;border-top:1px solid #eee;margin-top:4px;">
        <span>Total inventory value</span><span style="color:#1a7a4a;">$${totalValue.toFixed(2)} CAD</span>
      </div>`);
  }

  // Shopping list coverage — what inventory covers for current event
  if (cocktails.length && coverage.length) {
    const covered = coverage.filter(i => i.inStock > 0);
    const stillBuy = coverage.filter(i => i.stillNeeded > 0);
    if (covered.length > 0) {
      shtml('invCoverage', `
        <div class="card">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">
            📋 Current event — what inventory covers
          </div>
          <div style="font-size:12px;color:#888;margin-bottom:10px;">
            Your stock covers <strong style="color:#1a7a4a;">$${totalSaved.toFixed(2)} CAD</strong> of this event.
            The quote to the client stays the same — this is your extra profit.
          </div>
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;padding-bottom:5px;border-bottom:1px solid #eee;">
            <span>Ingredient</span><span>Needed</span><span>From stock</span><span>Still buy</span><span>Saved</span>
          </div>
          ${coverage.map(i => `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;font-size:13px;padding:5px 0;border-bottom:0.5px solid #f5f5f0;">
              <span style="font-weight:${i.inStock > 0 ? '500' : '400'}">${i.name}</span>
              <span style="color:#888;">${(i.qtyRounded||i.qtyRaw).toFixed(1)} ${i.unit}</span>
              <span style="color:${i.inStock>0?'#1a7a4a':'#aaa'};">${i.inStock > 0 ? i.inStock.toFixed(1) + ' ' + i.unit : '—'}</span>
              <span style="color:${i.stillNeeded>0?'#1a1a1a':'#aaa'};">${i.stillNeeded > 0 ? i.stillNeeded.toFixed(1) + ' ' + i.unit : '✓ covered'}</span>
              <span style="color:#1a7a4a;font-weight:500;">${i.savedCost > 0 ? '$' + i.savedCost.toFixed(2) : '—'}</span>
            </div>`).join('')}
          <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding-top:8px;border-top:1px solid #eee;margin-top:4px;">
            <span>Total saved by inventory</span>
            <span style="color:#1a7a4a;">$${totalSaved.toFixed(2)} CAD — your extra profit</span>
          </div>
        </div>`);
    } else {
      shtml('invCoverage', '');
    }
  } else {
    shtml('invCoverage', '');
  }
}

function exportInventory() {
  if (!Object.keys(currentStock).length) { alert('No inventory to export.'); return; }
  const rows = [['Ingredient','Unit','Qty','CAD$/unit','Value CAD','Source','Where bought','Last updated']];
  Object.values(currentStock).forEach(s => {
    rows.push([s.name, s.unit, (s.qty||0).toFixed(2), (s.cpu||0).toFixed(4),
      ((s.qty||0)*(s.cpu||0)).toFixed(2), s.source||'manual', s.store||'', s.lastUpdated||'']);
  });
  const csv = rows.map(r => r.map(val => {
    const s = String(val==null?'':val);
    return s.includes(',') || s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'inventory_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

