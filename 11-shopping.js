// ═══ SHOPPING LIST ═══
// getIM, getBottleInfo, shopping tab, retailers, store overrides,
// inferStore, renderPurchaseList, shopping deadline, master list

// ── Bottle size lookup ─────────────────────────────────────
// Returns { bottleOz, bottleUnit, bottleLabel } for a given ingredient name+unit
// For non-bottle items (garnishes, pinches, dashes, leaves) returns null → no rounding
function getBottleInfo(name, unit) {
  const n = name.toLowerCase();
  const u = unit.toLowerCase();
  // Non-bottled units — don't round
  if (['leaves','leaf','piece','pinch','dashes','dash','tsp','tbsp'].includes(u)) return null;
  // Spirits & liqueurs → 750ml = 25.36 oz
  const spirits = ['rum','vodka','gin','tequila','mezcal','whisky','whiskey','bourbon','scotch','rye','sake','shochu','brandy','cognac','armagnac','absinthe','campari','aperol','cointreau','triple sec','grand marnier','kahlua','baileys','amaretto','frangelico','chambord','st-germain','peach schnapps','curaçao','midori','limoncello','pimm','lillet','dubonnet','galliano','chartreuse','benedictine','drambuie','falernum','velvet','malibu','appleton','havana','diplomatico','mount gay','gosling','plantation','patron','don julio','casamigos','espolon','olmeca','absolut','grey goose','stolichnaya','tito','ketel','ciroc','russian standard','bombay','hendrick','tanqueray','beefeater','botanist','roku','aviation','crown royal','irish','tennessee','lychee liqueur','soho','plum wine','umeshu','japanese whisky','nikka','suntory'];
  if (spirits.some(s => n.includes(s))) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Wine & bubbles → 750ml
  if (['wine','prosecco','champagne','cava','sparkling','rosé'].some(s=>n.includes(s))) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Vermouth → 750ml
  if (n.includes('vermouth')) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Beer/cider → sold by bottle/can, already in those units
  if (['beer','cider','radler','shandy'].some(s=>n.includes(s))) return null;
  // Bitters → 200ml = 6.76 oz
  if (n.includes('bitters') || n.includes('tabasco') || n.includes('worcestershire')) return null;
  // Juices → 1L = 33.8 oz
  if (['juice','cranberry','pineapple','mango','tomato','apple','passion fruit','lychee juice','grapefruit juice','orange juice','coconut water','calpico','ramune'].some(s=>n.includes(s))) return {bottleOz:33.8, bottleLabel:'1L bottle'};
  // Syrups & sweeteners → 250ml = 8.45 oz (small) or 750ml = 25.36 oz
  if (['syrup','grenadine','orgeat','agave','honey','falernum','mirin'].some(s=>n.includes(s))) return {bottleOz:8.45, bottleLabel:'250ml bottle'};
  // Sodas & mixers → 1L = 33.8 oz
  if (['soda','tonic','ginger beer','ginger ale','cola','sprite','lemon-lime','cream soda','water','club soda','perrier'].some(s=>n.includes(s))) return {bottleOz:33.8, bottleLabel:'1L bottle'};
  // Cream/coconut cream → 400ml can = 13.5 oz
  if (['cream','coconut cream','condensed','coconut milk'].some(s=>n.includes(s))) return {bottleOz:13.5, bottleLabel:'400ml can'};
  // Coffee
  if (n.includes('espresso') || n.includes('cold brew') || n.includes('tea')) return null;
  return null; // unknown → no rounding
}

// ── getIM: aggregate ingredients with bottle rounding ──────
function getIM(guests, cocktailList){
  // cocktailList is optional — defaults to global cocktails
  // Passing it explicitly avoids the dangerous global swap pattern
  const _cocktails = cocktailList || cocktails;
  const m={};
  const dpp = qvf('drinksPerPerson') || 5;
  const buf = (qvf('bufferPct') || 0) / 100;
  const totalDPP = dpp * (1 + buf);
  const n = _cocktails.length || 1;

  // Normalise weights: each cocktail has c.dpg as relative weight (default 1)
  // Scale so weights sum to totalDPP
  const rawWeights = _cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b, 0);
  const scale = totalDPP / weightSum;

  _cocktails.forEach((c,i)=>{
    const drinksThisCocktail = rawWeights[i] * scale; // drinks/person for this cocktail
    const td = drinksThisCocktail * guests;
    c.ing.forEach(g=>{
      const k=g.n.toLowerCase().trim();
      if(!m[k])m[k]={name:g.n,unit:g.u,qty:0,cpu:g.c};
      m[k].qty+=g.q*td;
    });
  });
  const items = Object.values(m).sort((a,b)=>a.name.localeCompare(b.name));
  // Attach bottle info and rounded quantities
  items.forEach(item=>{
    const bi = getBottleInfo(item.name, item.unit);
    item.bottleInfo = bi;
    if (bi) {
      item.qtyRaw = item.qty;
      item.bottles = Math.ceil(item.qty / bi.bottleOz);
      item.qtyRounded = item.bottles * bi.bottleOz;
      item.leftover = item.qtyRounded - item.qty;
      item.purchaseCost = item.bottles * (bi.bottleOz * item.cpu);
      item.leftoverValue = item.leftover * item.cpu;
    } else {
      item.qtyRaw = item.qty;
      item.qtyRounded = item.qty;
      item.purchaseCost = item.qty * item.cpu;
      item.leftover = 0;
      item.leftoverValue = 0;
    }
  });
  return items;
}

let shopSelectedEventIds = null; // null = current event only

function switchShopTab(tab, btn){
  document.querySelectorAll('#shopTab-qty,#shopTab-purchase').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  el('shopPane-qty').style.display      = tab === 'qty'      ? '' : 'none';
  el('shopPane-purchase').style.display = tab === 'purchase' ? '' : 'none';
  if(tab === 'purchase'){ rShop(); renderPurchaseList(); }
}

function renderShopEventSelector(){
  const wrap = el('shopEventSelector');
  if(!wrap) return;

  // Only show events that have cocktails saved
  const allEvents = eventLibrary.filter(function(e){
    return e.state && e.state.cocktails && e.state.cocktails.length > 0;
  });

  if(!shopSelectedEventIds) shopSelectedEventIds = new Set();

  // Separate confirmed vs other
  const confirmed = allEvents.filter(function(e){ return e.status==='confirmed'||e.status==='completed'; });
  const others    = allEvents.filter(function(e){ return e.status!=='confirmed'&&e.status!=='completed'; });

  let html = '<div style="margin-bottom:1rem;">';

  if(!allEvents.length){
    html += '<div style="font-size:12px;color:var(--text3);padding:8px 0;">No saved events with cocktails yet — save an event first</div>';
  } else {
    // Section: confirmed events
    if(confirmed.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green);margin-bottom:6px;">✅ Confirmed events</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;">';
      confirmed.forEach(function(ev){
        const isOn = shopSelectedEventIds.has(ev.id);
        const dateStr = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
        const guests = ev.guestCount || (ev.state && ev.state.quote && ev.state.quote.guestCount) || '';
        html += '<button data-evid="'+ev.id+'" onclick="toggleShopEvent(this.dataset.evid)"'
          + ' style="font-size:12px;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:var(--font);'
          + 'border:1.5px solid '+(isOn?'var(--green)':'#c8e6d4')+';'
          + 'background:'+(isOn?'var(--green)':'var(--green-bg)')+';'
          + 'color:'+(isOn?'#fff':'var(--green)')+';'
          + 'font-weight:'+(isOn?'700':'500')+';">'
          + (ev.label||'Event')+(dateStr?' · '+dateStr:'')+(guests?' · '+guests+'g':'')
          + '</button>';
      });
      html += '</div>';
    }

    // Section: other events (draft, sent)
    if(others.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px;">Other events</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:7px;">';
      others.forEach(function(ev){
        const isOn = shopSelectedEventIds.has(ev.id);
        const statusEmoji = {draft:'📝',sent:'📤',cancelled:'❌'}[ev.status||'draft']||'📝';
        const dateStr = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
        html += '<button data-evid="'+ev.id+'" onclick="toggleShopEvent(this.dataset.evid)"'
          + ' style="font-size:12px;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:var(--font);'
          + 'border:1.5px solid '+(isOn?'var(--border)':'var(--border)')+';'
          + 'background:'+(isOn?'var(--surface2)':'var(--surface)')+';'
          + 'color:'+(isOn?'var(--text)':'var(--text2)')+';'
          + 'font-weight:'+(isOn?'600':'400')+';">'
          + statusEmoji+' '+(ev.label||'Event')+(dateStr?' · '+dateStr:'')
          + '</button>';
      });
      html += '</div>';
    }
  }
  html += '</div>';
  wrap.innerHTML = html;
}


function toggleShopEvent(evId){
  if(shopSelectedEventIds === null) shopSelectedEventIds = new Set();
  if(shopSelectedEventIds.has(evId)) shopSelectedEventIds.delete(evId);
  else shopSelectedEventIds.add(evId);
  renderShopEventSelector();
  rShop();
  // If purchase tab is visible, re-render it too
  const purchasePane = el('shopPane-purchase');
  if(purchasePane && purchasePane.style.display !== 'none') renderPurchaseList();
}


function getShopItems(guests){
  // Always include current event
  let items = getIM(guests);
  // Merge in any selected confirmed events
  if(shopSelectedEventIds && shopSelectedEventIds.size > 0){
    shopSelectedEventIds.forEach(evId => {
      const ev = eventLibrary.find(e => (e.id||e.label) === evId);
      if(!ev) return;
      const state = ev.fullState || ev;
      const evItems = getIMForEvent(state);
      evItems.forEach(evItem => {
        const k = evItem.name.toLowerCase().trim();
        const existing = items.find(i => i.name.toLowerCase().trim() === k);
        if(existing){
          existing.qty += evItem.qty;
        } else {
          items.push({...evItem, fromEvent: ev.label});
        }
      });
    });
  }
  return items;
}

function rShop(){
  const {guests, effectiveGuests, totalDrinks} = getConsumptionGuests();
   // Gather all active events' cocktails
  // Build from selected saved events only (not current event being edited)
  if(!shopSelectedEventIds || !shopSelectedEventIds.size){
    shtml('smet','');
    shtml('slist','<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">👆 Select an event above to view its shopping list</div>');
    return;
  }
  const allShopEvents = [...shopSelectedEventIds].map(id => {
    const ev = eventLibrary.find(e => e.id === id);
    if(!ev || !ev.state) return null;
    const gc = (ev.state.quote && ev.state.quote.guestCount) || ev.guestCount || 50;
    return {cocktails: ev.state.cocktails||[], guestCount: gc, label: ev.label, id};
  }).filter(Boolean);
  if(!allShopEvents.length || !allShopEvents.some(e => e.cocktails.length)){
    shtml('smet','');
    shtml('slist','<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">🍸 Selected events have no cocktails saved yet</div>');
    return;
  }
  // Render event selector
  renderShopEventSelector();
  const items=getShopItems(guests);

  // ── Cross-reference with inventory ──
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    // Find matching stock entry (fuzzy: exact first, then partial)
    let stock = currentStock[key];
    if(!stock){
      const keys = Object.keys(currentStock);
      const partialKey = keys.find(k => k.includes(key.split(' ')[0]) || key.includes(k.split(' ')[0]));
      if(partialKey) stock = currentStock[partialKey];
    }
    if(stock && stock.qty > 0){
      // Convert stock qty to same unit as needed qty
      const stockQtyInUnit = stock.unit === item.unit ? stock.qty
        : stock.unit === 'oz' && item.unit === 'ml' ? stock.qty * 29.5735
        : stock.unit === 'ml' && item.unit === 'oz' ? stock.qty / 29.5735
        : stock.qty; // best-effort same unit
      item.inStock = stockQtyInUnit;
      item.stillNeeded = Math.max(0, item.qtyRaw - stockQtyInUnit);
      item.coveredByStock = Math.min(item.qtyRaw, stockQtyInUnit);
      item.fullyCoVered = item.stillNeeded <= 0;
    } else {
      item.inStock = 0;
      item.stillNeeded = item.qtyRaw;
      item.coveredByStock = 0;
      item.fullyCoVered = false;
    }
    // Recalculate purchase cost based on what still needs to be bought
    if(item.bottleInfo && item.stillNeeded > 0){
      item.bottlesBuy = Math.ceil(item.stillNeeded / item.bottleInfo.bottleOz);
      item.purchaseCostAdjusted = item.bottlesBuy * (item.bottleInfo.bottleOz * item.cpu);
    } else if(item.bottleInfo && item.stillNeeded <= 0){
      item.bottlesBuy = 0;
      item.purchaseCostAdjusted = 0;
    } else {
      item.bottlesBuy = 0;
      item.purchaseCostAdjusted = item.stillNeeded * item.cpu;
    }
  });

  const stockCoveredCount = items.filter(i => i.fullyCoVered).length;
  const itemsStillNeeded = items.filter(i => !i.fullyCoVered);
  const tcPurchase=itemsStillNeeded.reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
  const tcRaw=items.reduce((s,i)=>s+i.qtyRaw*i.cpu,0);
  const totalLeftoverVal=items.reduce((s,i)=>s+i.leftoverValue,0);
  const stockSavings = items.reduce((s,i)=>s+(i.coveredByStock||0)*i.cpu,0);
  const td=totalDrinks;
  const bottledItems=items.filter(i=>i.bottleInfo);

  const stockBanner = stockCoveredCount > 0
    ? `<div style="background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#1a7a4a;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">📦</span>
        <div><strong>${stockCoveredCount} ingredient${stockCoveredCount!==1?'s':''} already in your inventory</strong> — no need to buy${stockSavings>0?' · saves $'+stockSavings.toFixed(2):''}</div>
      </div>`
    : '';

  shtml('smet',`
    ${stockBanner}
    <div class="met"><div class="ml">Total drinks</div><div class="mv">${Math.round(td)}</div></div>
    <div class="met"><div class="ml">Ingredients</div><div class="mv">${items.length}</div></div>
    <div class="met"><div class="ml">Still to buy</div><div class="mv">${itemsStillNeeded.length}</div></div>
    <div class="met"><div class="ml">Purchase cost CAD</div><div class="mv">$${tcPurchase.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Resalable leftover</div><div class="mv" style="color:#1a7a4a;">$${totalLeftoverVal.toFixed(2)}</div></div>`);

  // Auto-fill resale credit from leftover unless user overrode it manually
  // Leftover auto-calc feeds the Inventory tab, not the quote

  // ── Infer store for each item from INGDB note field ──
  // ── Custom Retailers ──────────────────────────────────────
let customRetailers = [];

function loadRetailers(){
  try {
    const stored = localStorage.getItem('bartender_retailers_v1');
    if(stored) customRetailers = JSON.parse(stored);
  } catch(e){ customRetailers = []; }
  renderRetailerOptions();
}

function saveRetailers(){
  localStorage.setItem('bartender_retailers_v1', JSON.stringify(customRetailers));
}

function renderRetailerOptions(){
  // Update all retailer selects with custom entries
  const baseRetailers = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online'];
  document.querySelectorAll('#mydbRetailer, #qiRetailer').forEach(sel => {
    if(!sel) return;
    const current = sel.value;
    // Remove existing custom options (between base and __add__)
    Array.from(sel.options).forEach(o => {
      if(!baseRetailers.includes(o.value) && o.value !== '' && o.value !== '__add__') o.remove();
    });
    // Insert custom retailers before __add__
    const addOpt = Array.from(sel.options).find(o => o.value === '__add__');
    customRetailers.forEach(r => {
      if(!Array.from(sel.options).some(o => o.value === r)){
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        if(addOpt) sel.insertBefore(opt, addOpt);
        else sel.appendChild(opt);
      }
    });
    // Restore selection
    if(current) sel.value = current;
  });
}

function handleRetailerChange(sel){
  if(sel.value === '__add__'){
    openAddRetailerModal(sel);
  }
}

function openAddRetailerModal(triggerSel){
  const existing = document.getElementById('addRetailerPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'addRetailerPopup';
  popup.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
  popup.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;max-width:380px;width:calc(100% - 32px);box-shadow:0 8px 40px rgba(0,0,0,0.18);">'
    + '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">🏪 Manage retailers</div>'
    + '<div id="retailerListManage" style="margin-bottom:12px;"></div>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;">'
    + '<input type="text" id="newRetailerInput" placeholder="Add new retailer…" style="flex:1;font-size:13px;" autocomplete="off">'
    + '<button onclick="addRetailerFromModal()" style="padding:6px 12px;border:none;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;font-size:13px;">Add</button>'
    + '</div>'
    + '<button onclick="document.getElementById(\x27addRetailerPopup\x27).remove()" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:13px;">Done</button>'
    + '</div>';
  document.body.appendChild(popup);
  renderRetailerManageList(triggerSel);
  const inp = document.getElementById('newRetailerInput');
  if(inp) inp.addEventListener('keydown', e => { if(e.key==='Enter') addRetailerFromModal(); });
  if(triggerSel) triggerSel.value = '';
}

function renderRetailerManageList(triggerSel){
  const wrap = document.getElementById('retailerListManage');
  if(!wrap) return;
  const allCustom = customRetailers;
  if(!allCustom.length){
    wrap.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0;">No custom retailers yet.</div>';
    return;
  }
  wrap.innerHTML = allCustom.map((r,i) =>
    '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid #f5f5f0;">'
    + '<span style="flex:1;font-size:13px;">' + r + '</span>'
    + '<button data-idx="' + i + '" onclick="renameRetailer(this.dataset.idx)" style="font-size:11px;padding:2px 8px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;font-family:inherit;">✎ Rename</button>'
    + '<button data-idx="' + i + '" onclick="deleteRetailer(this.dataset.idx)" style="font-size:11px;padding:2px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff5f5;color:#dc2626;cursor:pointer;font-family:inherit;">✕</button>'
    + '</div>'
  ).join('');
}

function addRetailerFromModal(){
  const inp = document.getElementById('newRetailerInput');
  const name = inp ? inp.value.trim() : '';
  if(!name) return;
  if(!customRetailers.includes(name)){
    customRetailers.push(name);
    saveRetailers();
    renderRetailerOptions();
  }
  if(inp) inp.value = '';
  renderRetailerManageList(null);
}

function renameRetailer(idx){
  const old = customRetailers[parseInt(idx)];
  const newName = prompt('Rename "' + old + '" to:', old);
  if(!newName || !newName.trim() || newName.trim() === old) return;
  const n = newName.trim();
  // Update in customRetailers
  customRetailers[parseInt(idx)] = n;
  // Update any storeOverrides that used the old name
  Object.keys(storeOverrides).forEach(k => {
    if(storeOverrides[k] === old) storeOverrides[k] = n;
  });
  // Update myIngredients retailer field
  myIngredients.forEach(ing => { if(ing.retailer === old) ing.retailer = n; });
  saveRetailers();
  localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
  saveMyDB();
  renderRetailerOptions();
  renderRetailerManageList(null);
}

function deleteRetailer(idx){
  const name = customRetailers[parseInt(idx)];
  if(!confirm('Remove "' + name + '" from retailers?')) return;
  customRetailers.splice(parseInt(idx), 1);
  saveRetailers();
  renderRetailerOptions();
  renderRetailerManageList(null);
}

// ════════════════════════════════════════════════════════════
// RETAILER PRICE LIBRARY
// retailerPrices[ingredientNameLC][retailer] = {price, unit, date, source}
// Populated from receipts, live lookup, manual entry
// Used to suggest cheapest store and compare prices
// ════════════════════════════════════════════════════════════

let retailerPrices = {};

function loadRetailerPrices(){
  try { retailerPrices = JSON.parse(localStorage.getItem('bartender_retailer_prices')||'{}'); }
  catch(e){ retailerPrices = {}; }
}

function saveRetailerPrices(){
  localStorage.setItem('bartender_retailer_prices', JSON.stringify(retailerPrices));
}

function setRetailerPrice(ingredientName, retailer, price, unit, source){
  const k = ingredientName.toLowerCase().trim();
  if(!retailerPrices[k]) retailerPrices[k] = {};
  retailerPrices[k][retailer] = {
    price: parseFloat(price),
    unit: unit || 'oz',
    date: new Date().toISOString().split('T')[0],
    source: source || 'manual'
  };
  saveRetailerPrices();
}

function getCheapestRetailer(ingredientName, unit){
  const k = ingredientName.toLowerCase().trim();
  const prices = retailerPrices[k];
  if(!prices || !Object.keys(prices).length) return null;
  let best = null;
  Object.entries(prices).forEach(([store, entry]) => {
    if(!entry.price) return;
    const priceInUnit = unit === entry.unit ? entry.price
      : unit === 'oz' && entry.unit === 'ml' ? entry.price * 29.57
      : entry.price;
    if(!best || priceInUnit < best.price) best = {store, price: entry.price, unit: entry.unit, date: entry.date, source: entry.source};
  });
  return best;
}

function renderRetailerPriceLibrary(){
  const wrap = el('retailerPriceLibContent');
  if(!wrap) return;

  const allKeys = Object.keys(retailerPrices).sort();
  if(!allKeys.length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;font-size:13px;">'
      + 'No retailer prices yet. Prices are recorded when you scan receipts or use the 🔍 price lookup button.</div>';
    return;
  }

  const baseRetailers = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online'];
  const allRetailers = [...new Set([...baseRetailers, ...customRetailers,
    ...Object.values(retailerPrices).flatMap(r => Object.keys(r))])].filter(Boolean);

  // Manual entry row
  const addFormHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;background:#f9f9f6;border-radius:8px;padding:10px;margin-bottom:12px;">'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Ingredient</label><input type="text" id="rpNewName" placeholder="e.g. Hendricks Gin" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:160px;"></div>'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Store</label><input type="text" id="rpNewStore" placeholder="e.g. SAQ" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:100px;"></div>'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Price ($/oz)</label><input type="number" id="rpNewPrice" placeholder="2.50" step="0.01" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:90px;"></div>'
    + '<button onclick="addManualRetailerPrice()" style="padding:6px 12px;border:none;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;font-size:13px;">+ Add</button>'
    + '</div>';

  if(wrap.querySelector('#rpAddForm') === null){
    const addDiv = document.createElement('div');
    addDiv.id = 'rpAddForm';
    addDiv.innerHTML = addFormHtml;
    wrap.prepend(addDiv);
  }

  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="border-bottom:2px solid #e5e5e0;">'
    + '<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#aaa;">Ingredient</th>'
    + allRetailers.map(r => '<th style="text-align:right;padding:6px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#aaa;min-width:60px;">' + r + '</th>').join('')
    + '<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#1a7a4a;">Best</th>'
    + '</tr></thead><tbody>';

  allKeys.forEach((k, rowIdx) => {
    const prices = retailerPrices[k];
    const best = getCheapestRetailer(k, 'oz');
    html += '<tr style="border-bottom:0.5px solid #f5f5f0;background:' + (rowIdx%2===0?'#fff':'#fafaf7') + ';">'
      + '<td style="padding:6px 8px;font-weight:500;">' + k + '</td>'
      + allRetailers.map(r => {
          const entry = prices[r];
          if(!entry) return '<td style="text-align:right;padding:6px 4px;color:#ddd;">—</td>';
          const isBest = best && best.store === r;
          return '<td style="text-align:right;padding:6px 4px;font-weight:' + (isBest?'700':'400') + ';color:' + (isBest?'#1a7a4a':'#555') + ';">'
            + '$' + entry.price.toFixed(2) + '<br><span style="font-size:10px;color:#aaa;">/' + entry.unit + '</span></td>';
        }).join('')
      + '<td style="text-align:right;padding:6px 8px;font-size:11px;font-weight:600;color:#1a7a4a;">' + (best ? best.store : '—') + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// Auto-record prices when lookupPrice returns a result
function addManualRetailerPrice(){
  const name = (document.getElementById('rpNewName')||{}).value?.trim();
  const store = (document.getElementById('rpNewStore')||{}).value?.trim();
  const price = parseFloat((document.getElementById('rpNewPrice')||{}).value);
  if(!name || !store || isNaN(price) || price <= 0){
    showToast('Fill in ingredient, store, and price', 'error');
    return;
  }
  setRetailerPrice(name, store, price, 'oz', 'manual');
  const ni = document.getElementById('rpNewName'); if(ni) ni.value='';
  const si = document.getElementById('rpNewStore'); if(si) si.value='';
  const pi = document.getElementById('rpNewPrice'); if(pi) pi.value='';
  renderRetailerPriceLibrary();
  showToast('Price saved for '+name+' @ '+store, 'success');
}

function recordRetailerPrice(ingredientName, store, price, unit, source){
  if(!store || !price || price <= 0) return;
  setRetailerPrice(ingredientName, store, price, unit, source);
}

// ── Per-item store overrides ─────────────────────────────
let storeOverrides = {};
function loadStoreOverrides(){
  try{ storeOverrides = JSON.parse(localStorage.getItem('bartender_store_overrides')||'{}'); }
  catch(e){ storeOverrides = {}; }
}
function saveStoreOverride(name, store){
  storeOverrides[name.toLowerCase()] = store;
  localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
}

function changeItemStore(pillEl, event){
  if(event) event.stopPropagation();
  const name = (typeof pillEl === 'string') ? pillEl : (pillEl.dataset && pillEl.dataset.name) || pillEl.getAttribute('data-name') || '';
  if(!name) return;

  // Close any open store pickers
  document.querySelectorAll('.store-picker-popup').forEach(p => p.remove());

  const allStores = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online','Grocery'];
  const extras = (customRetailers||[]).filter(r => !allStores.includes(r));
  const stores = [...allStores, ...extras];
  const currentStore = storeOverrides[name.toLowerCase().trim()] || '';

  const popup = document.createElement('div');
  popup.className = 'store-picker-popup';
  popup.style.cssText = 'position:fixed;z-index:2000;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:10px;box-shadow:0 4px 24px rgba(0,0,0,0.14);min-width:220px;max-height:320px;overflow-y:auto;';

  // Position near the pill
  const rect = pillEl.getBoundingClientRect();
  const popH = 340;
  const spaceBelow = window.innerHeight - rect.bottom;
  const topPos = spaceBelow >= popH + 10 ? rect.bottom + 6 : Math.max(10, rect.top - popH - 6);
  popup.style.top = topPos + 'px';
  popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 248)) + 'px';

  popup.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#aaa;margin-bottom:8px;padding:0 2px;">'
    + 'Buy at — ' + name + '</div>';

  stores.forEach(store => {
    const isActive = store === currentStore;
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:'+(isActive?'600':'400')+';background:'+(isActive?'#e8f0fd':'transparent')+';color:'+(isActive?'#2156b8':'#1a1a1a')+';margin-bottom:2px;';
    btn.textContent = (isActive ? '✓ ' : '') + store;
    btn.onclick = () => {
      storeOverrides[name.toLowerCase().trim()] = store;
      localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
      popup.remove();
      rShop(); // re-render the shopping list
    };
    popup.appendChild(btn);
  });

  // Auto-detect option
  const autoBtn = document.createElement('button');
  autoBtn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:1px dashed #ddd;cursor:pointer;font-family:inherit;font-size:12px;color:#aaa;margin-top:4px;background:transparent;';
  autoBtn.textContent = '↺ Auto-detect';
  autoBtn.onclick = () => {
    delete storeOverrides[name.toLowerCase().trim()];
    localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
    popup.remove();
    rShop();
  };
  popup.appendChild(autoBtn);
  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function closeCSP(e){
      if(!popup.contains(e.target) && !e.target.classList.contains('store-pill')){
        popup.remove();
        document.removeEventListener('click', closeCSP);
      }
    });
  }, 200);
}
function inferStore(item){
    // 0. User override (set by tapping the store pill)
    const override = storeOverrides[item.name.toLowerCase()];
    if(override) return override;

    // 1. Custom ingredient explicit retailer field
    const custom = myIngredients.find(i => i.name.toLowerCase() === item.name.toLowerCase());
    if(custom && custom.retailer) return custom.retailer;

    // 1.5. Retailer price library — use cheapest known store
    const bestRetailer = getCheapestRetailer(item.name, item.unit || 'oz');
    if(bestRetailer && bestRetailer.store) return bestRetailer.store;

    // 2. INGDB built-in — partial name match then check note
    const nameLC = item.name.toLowerCase();
    for(const [cat, items2] of Object.entries(INGDB)){
      const found = items2.find(i => {
        const iLC = i.name.toLowerCase();
        return iLC === nameLC || iLC.includes(nameLC) || nameLC.includes(iLC.split(' ')[0]);
      });
      if(found && found.note){
        const note = found.note.toLowerCase();
        if(note.includes('aubut')) return 'Aubut';
        if(note.includes('saq')) return 'SAQ';
        if(note.includes('iga') || note.includes('metro') || note.includes('maxi')) return 'Grocery';
        if(note.includes('costco')) return 'Costco';
      }
    }

    // 3. Guess by ingredient type
    const nm = item.name.toLowerCase();
    if(nm.includes('gin') || nm.includes('vodka') || nm.includes('rum') || nm.includes('whisky') ||
       nm.includes('whiskey') || nm.includes('tequila') || nm.includes('mezcal') || nm.includes('cognac') ||
       nm.includes('liqueur') || nm.includes('campari') || nm.includes('aperol') || nm.includes('vermouth') ||
       nm.includes('amaro') || nm.includes('chartreuse') || nm.includes('cointreau') || nm.includes('baileys') ||
       nm.includes('kahlua') || nm.includes('beer') || nm.includes('wine') || nm.includes('champagne') ||
       nm.includes('prosecco') || nm.includes('cava') || nm.includes('port') || nm.includes('sherry')) return 'SAQ';
    if(nm.includes('monin') || nm.includes('clamato') || nm.includes('fever-tree') ||
       nm.includes('schweppes') || nm.includes('canada dry') || nm.includes('san pellegrino') ||
       nm.includes('cup') || nm.includes('napkin') || nm.includes('straw') || nm.includes('walter')) return 'Aubut';
    if(nm.includes('juice') || nm.includes('soda') || nm.includes('water') || nm.includes('syrup') ||
       nm.includes('honey') || nm.includes('sugar') || nm.includes('salt') || nm.includes('lime') ||
       nm.includes('lemon') || nm.includes('orange') || nm.includes('mint') || nm.includes('basil') ||
       nm.includes('cream') || nm.includes('egg') || nm.includes('milk') || nm.includes('coffee')) return 'Grocery';
    return 'Other';
  }

  // Tag each non-covered item with store + last receipt price date
  items.filter(i => !i.fullyCoVered).forEach(item => {
    item.store = inferStore(item);
    // Find most recent receipt-sourced price for this item
    const key = item.name.toLowerCase().trim();
    const hist = priceHistory[key];
    if(hist && hist.length){
      const receiptPrices = hist.filter(p => p.source === 'receipt').sort((a,b) => b.date.localeCompare(a.date));
      if(receiptPrices.length){
        item.lastReceiptPrice = receiptPrices[0].price;
        item.lastReceiptDate  = receiptPrices[0].date;
        item.lastReceiptStore = receiptPrices[0].store;
        // Flag if current price differs from receipt price by > 10%
        const diff = Math.abs(item.cpu - item.lastReceiptPrice) / item.lastReceiptPrice;
        item.priceStaleness = diff > 0.1 ? 'outdated' : 'fresh';
      }
    }
  });

  // Group items to buy by store
  const storeGroups = {};
  // Base stores + any custom retailers he's added
  const baseStoreOrder = ['SAQ', 'Aubut', 'IGA', 'Metro', 'Maxi', 'Costco', 'Walmart', 'Marché Jean-Talon', 'Dépanneur', 'Online', 'Grocery'];
  const customStoreOrder = (customRetailers||[]).filter(r => !baseStoreOrder.includes(r));
  const storeOrder = [...baseStoreOrder, ...customStoreOrder, 'Other'];
  const storeEmoji = {SAQ:'🍷',Aubut:'🛒',IGA:'🛍',Metro:'🛍',Maxi:'🛍',Costco:'🏪',Walmart:'🏪','Marché Jean-Talon':'🌿',Dépanneur:'🏪',Online:'💻',Grocery:'🛍',Other:'📦'};
  const storeColor = {SAQ:'#7c3aed',Aubut:'#0891b2',IGA:'#059669',Metro:'#059669',Maxi:'#059669',Costco:'#d97706',Walmart:'#2563eb','Marché Jean-Talon':'#16a34a',Dépanneur:'#6b7280',Online:'#0284c7',Grocery:'#059669',Other:'#6b7280'};
  items.filter(i => !i.fullyCoVered).forEach(item => {
    const store = item.store || 'Other';
    if(!storeGroups[store]) storeGroups[store] = [];
    storeGroups[store].push(item);
  });

  // Build store-grouped HTML
  const storeHTML = storeOrder.filter(s => storeGroups[s]).map(store => {
    const grpItems = storeGroups[store];
    const grpTotal = grpItems.reduce((s,i) => s+(i.purchaseCostAdjusted||i.purchaseCost),0);
    const rows = grpItems.map(i => {
      if(i.bottleInfo){
        const pct = Math.round((i.stillNeeded/((i.bottlesBuy||1)*i.bottleInfo.bottleOz))*100);
        const barColor = pct>=80?'#1a7a4a':pct>=50?'#e69c00':'#c0392b';
        const stockNote = i.inStock > 0 ? ` <span style="font-size:10px;color:#1a7a4a;">(have ${i.inStock.toFixed(1)}${i.unit})</span>` : '';
        const priceTag = i.lastReceiptDate
          ? (i.priceStaleness === 'outdated'
              ? `<span title="Receipt price $${i.lastReceiptPrice.toFixed(2)}/oz from ${i.lastReceiptDate} — may have changed" style="font-size:10px;padding:1px 6px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;cursor:default;">⚠ $${i.lastReceiptPrice.toFixed(2)} receipt</span>`
              : `<span title="Confirmed from receipt at ${i.lastReceiptStore} on ${i.lastReceiptDate}" style="font-size:10px;padding:1px 6px;border-radius:10px;background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;cursor:default;">✓ $${i.lastReceiptPrice.toFixed(2)} receipt</span>`)
          : '';
        return `<div class="sr" style="align-items:start;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:13px;">${i.name}</span><span class="store-pill" onclick="event.stopImmediatePropagation();changeItemStore(this,event)" data-name="${i.name}" title="Tap to change retailer" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #c5d8f8;background:#e8f0fd;color:#2156b8;cursor:pointer;font-weight:500;">✎ ${i.store||'?'}</span>${priceTag}</div>${stockNote}
            <div style="font-size:11px;color:#aaa;margin-top:2px;">${i.stillNeeded.toFixed(1)} oz needed · ${i.bottlesBuy} × ${i.bottleInfo.bottleLabel}</div>
            <div style="margin-top:4px;background:#eee;border-radius:4px;height:4px;width:100%;max-width:160px;overflow:hidden;"><div style="height:4px;border-radius:4px;background:${barColor};width:${pct}%;"></div></div>
          </div>
          <div style="text-align:right;"><div style="font-size:13px;font-weight:500;">${i.bottlesBuy} bottle${i.bottlesBuy!==1?'s':''}</div></div>
          <div style="text-align:right;"><div style="font-size:12px;color:#1a7a4a;">+${i.leftover.toFixed(1)} oz left</div></div>
          <div style="text-align:right;font-weight:500;">$${(i.purchaseCostAdjusted||0).toFixed(2)}</div>
        </div>`;
      } else {
        const freshTag2 = i.lastReceiptDate
          ? `<span style="font-size:10px;color:#065f46;"> ✓ receipt ${i.lastReceiptDate}</span>`
          : `<span style="font-size:10px;color:#aaa;"> est.</span>`;
        return `<div class="sr" style="align-items:center;">
          <div>
            <span style="font-size:13px;">${i.name}</span>
            <span class="store-pill" onclick="changeItemStore(this,event)" data-name="${i.name}" title="Tap to change retailer" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #c5d8f8;background:#e8f0fd;color:#2156b8;cursor:pointer;margin-left:5px;font-weight:500;">✎ ${i.store||'?'}</span>
          </div>
          <span>${(i.stillNeeded||i.qtyRaw).toFixed(1)} ${i.unit}</span>
          <span></span>
          <span>$${(i.purchaseCostAdjusted||i.purchaseCost).toFixed(2)}${freshTag2}</span>
        </div>`;
      }
    }).join('');
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">${storeEmoji[store]}</span>
          <span style="font-size:13px;font-weight:600;color:${storeColor[store]};">${store}</span>
          <span style="font-size:11px;color:#aaa;">${grpItems.length} item${grpItems.length!==1?'s':''}</span>
        </div>
        <span style="font-size:13px;font-weight:500;">$${grpTotal.toFixed(2)}</span>
      </div>
      <div class="card" style="padding:0.5rem 1rem;">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding-bottom:4px;border-bottom:1px solid #f0f0eb;margin-bottom:4px;">
          <span>Ingredient</span><span>Bottles/Qty</span><span>Leftover</span><span>Cost</span>
        </div>
        ${rows}
      </div>
    </div>`;
  }).join('');

  shtml('slist',`
    <div style="font-size:12px;background:#e8f0fd;color:#2156b8;border-radius:8px;padding:8px 12px;margin-bottom:10px;border:1px solid #c5d8f8;">
      🍾 <strong>Bottle optimized:</strong> Quantities rounded up to full bottles so you never run short. 
      The progress bar shows how full each bottle will be — green means efficient, red means a lot left over (consider reselling or sharing across events).
    </div>
    ${storeHTML}
    ${Object.keys(storeGroups).length === 0 ? '<div class="empty" style="padding:1rem;text-align:center;color:#aaa;">✅ Everything already in inventory — nothing to buy!</div>' : ''}
    <div class="card" style="padding:10px 14px;background:#f9f9f6;margin-top:4px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
        <span>Total to spend</span>
        <span>$${tcPurchase.toFixed(2)} CAD</span>
      </div>
      ${stockSavings > 0 ? '<div style="font-size:11px;color:#1a7a4a;margin-top:3px;">📦 Inventory covers $'+stockSavings.toFixed(2)+' — already have those bottles</div>' : ''}
      ${totalLeftoverVal > 0 ? '<div style="font-size:11px;color:#888;margin-top:2px;">~$'+totalLeftoverVal.toFixed(2)+' resalable leftover across all purchases</div>' : ''}
    </div>
    <p class="cad-note">* Split by store to reduce trips. Bottle sizes: spirits/wine = 750ml (25.4oz), juices/sodas = 1L (33.8oz), syrups = 250ml.</p>`);
}

function exportCombinedShoppingList(){
  const confirmedEvents = eventLibrary.filter(e => (e.status||'draft') === 'confirmed');
  if(!confirmedEvents.length){ alert('No confirmed events to combine.'); return; }

  // Merge ingredient quantities across all confirmed events
  const merged = {};
  confirmedEvents.forEach(ev => {
    const state = ev.state;
    if(!state || !state.cocktails) return;
    const gsts = state.guestCount || 50;
    const dpp = (state.consumptionModel && state.consumptionModel.drinksPerPerson) || 5;
    const buf = (state.consumptionModel && state.consumptionModel.bufferPct) || 0;

    state.cocktails.forEach(cocktail => {
      const totalDrinks = Math.round(gsts * dpp * (1+buf/100) * cocktail.dpg);
      (cocktail.ing || []).forEach(ing => {
        const key = ing.n.toLowerCase().trim();
        const totalQty = ing.q * totalDrinks;
        if(!merged[key]){
          merged[key] = { name: ing.n, unit: ing.u, totalQty: 0, cpu: ing.c, events: [] };
        }
        merged[key].totalQty += totalQty;
        if(!merged[key].events.includes(ev.label)) merged[key].events.push(ev.label);
      });
    });
  });

  // Generate the HTML shopping list
  const items = Object.values(merged).sort((a,b) => (b.totalQty*b.cpu)-(a.totalQty*a.cpu));
  const totalCost = items.reduce((s,i) => s+(i.totalQty*i.cpu), 0);
  const eventNames = confirmedEvents.map(e=>e.label).join(' + ');
  const today = new Date().toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});

  const rows = items.map(i => {
    const bottles = i.unit === 'oz' ? Math.ceil(i.totalQty/25.36) : null;
    const qtyLabel = bottles ? bottles + ' bottle' + (bottles!==1?'s':'') : i.totalQty.toFixed(1) + ' ' + i.unit;
    const storeHint = i.cpu > 1.5 ? 'SAQ' : 'Grocery';
    const evtBadges = i.events.map(ev => '<span style="font-size:10px;background:#e8f0fd;color:#2156b8;padding:1px 6px;border-radius:10px;margin-right:3px;">'+ev+'</span>').join('');
    return `<li class="item" onclick="this.classList.toggle('checked')">
      <div><div class="cb">${i.name}</div><div style="font-size:11px;color:#aaa;margin-top:2px;">${evtBadges}</div></div>
      <span class="amt">${qtyLabel}</span>
      <span class="store">${storeHint}</span>
      <span class="price">$${(i.totalQty*i.cpu).toFixed(2)}</span>
    </li>`;
  }).join('');

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Combined shopping list</title>'
    + '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f9f9f6;padding-bottom:80px;}'
    + 'header{background:#1a1a1a;color:#fff;padding:1rem 1.25rem;position:sticky;top:0;z-index:10;}'
    + 'h1{font-size:16px;font-weight:600;margin-bottom:2px;}header p{font-size:12px;color:#aaa;}'
    + '.progress-bar{height:4px;background:rgba(255,255,255,0.2);margin-top:8px;border-radius:2px;overflow:hidden;}'
    + '.progress-fill{height:100%;background:#4ade80;border-radius:2px;transition:width .3s;}'
    + 'ul{list-style:none;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e0;margin:1rem 0.75rem 0;}'
    + 'li.item{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:13px 14px;border-bottom:.5px solid #f0f0eb;cursor:pointer;}'
    + 'li.item:last-child{border-bottom:none;}li.item.checked{background:#f0faf5;}'
    + 'li.item.checked .cb{text-decoration:line-through;color:#aaa;}'
    + '.cb{font-size:15px;font-weight:500;}.amt{font-size:12px;color:#666;background:#f5f5f0;padding:2px 8px;border-radius:20px;white-space:nowrap;}'
    + '.store{font-size:11px;color:#aaa;}.price{font-size:13px;font-weight:500;color:#1a7a4a;min-width:48px;text-align:right;}'
    + '.footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e5e0;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;}'
    + '.footer-total{font-size:16px;font-weight:600;}.footer-checked{font-size:13px;color:#888;}'
    + '</style></head><body>'
    + '<header><h1>Combined shopping list</h1><p>' + today + ' · ' + confirmedEvents.length + ' events · ' + items.length + ' items</p>'
    + '<p style="font-size:11px;color:#aaa;margin-top:3px;">' + eventNames + '</p>'
    + '<div class="progress-bar"><div class="progress-fill" id="prog" style="width:0%"></div></div></header>'
    + '<ul>' + rows + '</ul>'
    + '<div class="footer"><div><div class="footer-total">$' + totalCost.toFixed(2) + ' CAD</div>'
    + '<div class="footer-checked" id="cc">0 of ' + items.length + ' checked</div></div></div>'
    + '<script>const tot='+items.length+';'
    + 'function upd(){const ch=document.querySelectorAll("li.checked").length;'
    + 'document.getElementById("prog").style.width=(ch/tot*100)+"%";'
    + 'document.getElementById("cc").textContent=ch+" of "+tot+" checked";}'
    + 'document.querySelectorAll("li.item").forEach(li=>li.addEventListener("click",upd));'
    + '<'+'/script></body></html>';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download = 'combined_shopping_list.html';
  a.click();
  showToast('Combined list exported for ' + confirmedEvents.length + ' events', 'success');
}

// ════════════════════════════════════════════════════════════
function getShoppingDeadlineInfo(targetDateStr){
  // Given an event date string (YYYY-MM-DD), calculate:
  // - days until the event
  // - recommended shopping deadline (2 days before)
  // - urgency level
  if(!targetDateStr) return null;

  const today = new Date();
  today.setHours(0,0,0,0);
  const eventDate = new Date(targetDateStr + 'T12:00:00');
  const diffMs = eventDate - today;
  const daysUntil = Math.ceil(diffMs / (1000*60*60*24));

  // Recommend shopping 2 days before (leaves 1 day buffer for last-minute items)
  const shopByDate = new Date(eventDate);
  shopByDate.setDate(shopByDate.getDate() - 2);
  const shopDiffMs = shopByDate - today;
  const daysToShopBy = Math.ceil(shopDiffMs / (1000*60*60*24));

  const eventDateFmt = eventDate.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
  const shopByFmt = shopByDate.toLocaleDateString('en-CA',{weekday:'long',month:'short',day:'numeric'});

  // Urgency levels
  let urgency, icon, bgColor, borderColor, textColor, msg;

  if(daysUntil < 0){
    urgency = 'past';
    icon = '🎉';
    bgColor = '#f5f5f0'; borderColor = '#ddd'; textColor = '#888';
    msg = 'This event already happened ' + Math.abs(daysUntil) + ' day' + (Math.abs(daysUntil)!==1?'s':'') + ' ago.';
  } else if(daysUntil === 0){
    urgency = 'today';
    icon = '🚨';
    bgColor = '#fdf0ef'; borderColor = '#f5c0ba'; textColor = '#c0392b';
    msg = "Event is TODAY — shopping should already be done!";
  } else if(daysUntil === 1){
    urgency = 'tomorrow';
    icon = '🚨';
    bgColor = '#fdf0ef'; borderColor = '#f5c0ba'; textColor = '#c0392b';
    msg = "Event is TOMORROW — buy everything today if you haven't already!";
  } else if(daysToShopBy <= 0){
    urgency = 'overdue';
    icon = '⚠';
    bgColor = '#fdf5e8'; borderColor = '#f0d080'; textColor = '#a06020';
    msg = 'Shopping deadline has passed (should have bought ' + Math.abs(daysToShopBy) + ' day' + (Math.abs(daysToShopBy)!==1?'s':'') + ' ago) — buy now!';
  } else if(daysToShopBy <= 2){
    urgency = 'urgent';
    icon = '⚠';
    bgColor = '#fdf5e8'; borderColor = '#f0d080'; textColor = '#a06020';
    msg = 'Shop by ' + shopByFmt + ' (' + daysToShopBy + ' day' + (daysToShopBy!==1?'s':'') + ' away) — event is ' + eventDateFmt + '.';
  } else if(daysToShopBy <= 5){
    urgency = 'soon';
    icon = '🛒';
    bgColor = '#e8f0fd'; borderColor = '#b5d4f4'; textColor = '#2156b8';
    msg = 'Shop by ' + shopByFmt + ' — ' + daysToShopBy + ' days away. Event: ' + eventDateFmt + '.';
  } else {
    urgency = 'ok';
    icon = '✓';
    bgColor = '#edfaf3'; borderColor = '#c8e6d4'; textColor = '#1a7a4a';
    msg = 'Plenty of time — shop by ' + shopByFmt + '. Event: ' + eventDateFmt + ' (' + daysUntil + ' days away).';
  }

  return { urgency, icon, bgColor, borderColor, textColor, msg, daysUntil, daysToShopBy, shopByFmt, eventDateFmt };
}

function renderShoppingDeadline(){
  const bannerEl = el('shoppingDeadlineBanner');
  if(!bannerEl) return;

  // Current event deadline
  const currentDate = v('ed');
  const currentStatus = v('quoteStatus') || 'draft';

  // Find the soonest confirmed event (including current if confirmed)
  const allDates = [];

  // Add current event if it has a date and is confirmed/sent
  if(currentDate && ['confirmed','sent','draft'].includes(currentStatus)){
    allDates.push({ label: v('eventLabel') || 'Current event', date: currentDate, status: currentStatus, isCurrent: true });
  }

  // Add confirmed events from library
  eventLibrary.forEach(e => {
    if(e.eventDate && (e.status === 'confirmed') && e.label !== v('eventLabel')){
      allDates.push({ label: e.label, date: e.eventDate, status: e.status, isCurrent: false });
    }
  });

  if(!allDates.length){
    bannerEl.innerHTML = '';
    return;
  }

  // Sort by date to find soonest
  allDates.sort((a,b) => new Date(a.date) - new Date(b.date));
  const soonest = allDates[0];
  const info = getShoppingDeadlineInfo(soonest.date);
  if(!info || info.urgency === 'past') {
    bannerEl.innerHTML = '';
    return;
  }

  // Build the callout
  let html = '<div style="background:' + info.bgColor + ';border:1px solid ' + info.borderColor + ';border-radius:10px;padding:12px 14px;font-size:13px;color:' + info.textColor + ';">';
  html += '<div style="display:flex;align-items:flex-start;gap:10px;">';
  html += '<span style="font-size:20px;flex-shrink:0;">' + info.icon + '</span>';
  html += '<div style="flex:1;">';
  html += '<div style="font-weight:600;margin-bottom:3px;">';

  // If shopping for multiple events at once
  if(allDates.length > 1 && !soonest.isCurrent){
    html += 'Shop for ' + allDates.length + ' events by ' + info.shopByFmt;
  } else {
    html += info.urgency === 'ok' ? 'Shopping window open' : info.urgency === 'overdue' ? 'Shopping overdue!' : 'Shopping deadline approaching';
  }
  html += '</div>';
  html += '<div style="line-height:1.6;">' + info.msg + '</div>';

  // If combining events, list them
  if(allDates.length > 1){
    html += '<div style="margin-top:6px;font-size:12px;opacity:0.85;">Covering: ' + allDates.map(d => {
      const di = getShoppingDeadlineInfo(d.date);
      return '<strong>' + d.label + '</strong> (' + (di ? di.eventDateFmt : d.date) + ')';
    }).join(' + ') + '</div>';
  }

  html += '</div></div></div>';
  bannerEl.innerHTML = html;

  // Also update the combined deadline line in the Events tab
  const combinedLine = el('combinedDeadlineLine');
  if(combinedLine && allDates.length > 1){
    combinedLine.innerHTML = info.icon + ' Buy by <strong>' + info.shopByFmt + '</strong> — soonest event is ' + info.eventDateFmt + ' (' + info.daysUntil + ' day' + (info.daysUntil!==1?'s':'') + ' away)';
  }
}

// ════════════════════════════════════════════════════════════
function getIMForEvent(evState){
  // Reconstruct getIM() logic for a saved event state
  const m = {};
  const guests = evState.guestCount || 0;
  if(!guests || !evState.cocktails || !evState.cocktails.length) return [];
  const cm = evState.consumptionModel || {};
  const dpp = cm.drinksPerPerson || 5;
  const buf = (cm.bufferPct || 0) / 100;
  const totalDPP = dpp * (1 + buf);
  const rawWeights = evState.cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b, 0);
  const scale = totalDPP / weightSum;
  evState.cocktails.forEach((ct, i) => {
    const drinksThis = rawWeights[i] * scale;
    const td = drinksThis * guests;
    (ct.ing || []).forEach(g => {
      const k = g.n.toLowerCase().trim();
      if(!m[k]) m[k] = {name:g.n, unit:g.u, qty:0, cpu:g.c};
      m[k].qty += g.q * td;
    });
  });
  return Object.values(m);
}

let masterListSelectedIds = null; // null = all confirmed

function renderMasterList(){
  const wrap = el('masterListContent');
  if(!wrap) return;

  const allConfirmed = eventLibrary.filter(e =>
    e.status === 'confirmed' || e.quoteStatus === 'confirmed'
  );

  if(!allConfirmed.length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;">'
      + '<div style="font-size:32px;margin-bottom:8px;">📅</div>'
      + '<div style="font-weight:500;margin-bottom:4px;">No confirmed events yet</div>'
      + '<div style="font-size:13px;">Mark events as ✅ Confirmed to include them.</div>'
      + '</div>';
    return;
  }

  if(masterListSelectedIds === null)
    masterListSelectedIds = new Set(allConfirmed.map(e => e.id || e.label));

  wrap.innerHTML = '';

  // ── Event selector ──
  const selBox = document.createElement('div');
  selBox.style.cssText = 'background:#f9f9f6;border:1px solid #e5e5e0;border-radius:10px;padding:12px 14px;margin-bottom:14px;';
  selBox.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:8px;">Include in shopping list</div>';
  const cRow = document.createElement('div');
  cRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  allConfirmed.forEach(ev => {
    const evId = ev.id || ev.label;
    const checked = masterListSelectedIds.has(evId);
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid '+(checked?'#1a7a4a':'#e5e5e0')+';background:'+(checked?'#edfaf3':'#fff')+';user-select:none;';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = checked; chk.style.cursor = 'pointer';
    const ds = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode((ev.label||'Event')+(ds?' · '+ds:'')+(ev.guestCount?' · '+ev.guestCount+'g':'')));
    chk.addEventListener('change', ()=>{
      if(chk.checked) masterListSelectedIds.add(evId); else masterListSelectedIds.delete(evId);
      renderMasterList();
    });
    cRow.appendChild(lbl);
  });
  selBox.appendChild(cRow);
  wrap.appendChild(selBox);

  const confirmed = allConfirmed.filter(e => masterListSelectedIds.has(e.id || e.label));
  if(!confirmed.length){
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;color:#aaa;font-size:13px;padding:1rem;';
    empty.textContent = 'Select at least one event above.';
    wrap.appendChild(empty);
    return;
  }

  // ── Aggregate all ingredients across confirmed events ──
  const merged = {}; // key → {name, unit, qty, cpu, events:[]}
  confirmed.forEach(ev => {
    const state = ev.fullState || ev;
    const items = getIMForEvent(state);
    items.forEach(item => {
      const k = item.name.toLowerCase().trim();
      if(!merged[k]){
        merged[k] = {name:item.name, unit:item.unit, qty:0, cpu:item.cpu, events:[]};
      }
      merged[k].qty += item.qty;
      merged[k].events.push(ev.label || 'Event');
    });
  });

  if(!Object.keys(merged).length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;">'
      + 'Confirmed events have no cocktails yet. Add cocktails to your events and save them.</div>';
    return;
  }

  // ── Convert to items array with bottle info ──
  const items = Object.values(merged).sort((a,b)=>a.name.localeCompare(b.name));
  items.forEach(item => {
    const bi = getBottleInfo(item.name, item.unit);
    item.bottleInfo = bi;
    if(bi){
      item.qtyRaw = item.qty;
      item.bottles = Math.ceil(item.qty / bi.bottleOz);
      item.qtyRounded = item.bottles * bi.bottleOz;
      item.leftover = item.qtyRounded - item.qty;
      item.purchaseCost = item.bottles * (bi.bottleOz * item.cpu);
      item.leftoverValue = item.leftover * item.cpu;
    } else {
      item.qtyRaw = item.qty;
      item.purchaseCost = item.qty * item.cpu;
      item.leftoverValue = 0;
    }
    // Stock cross-reference
    const stockKey = item.name.toLowerCase().trim();
    let stock = currentStock[stockKey];
    if(!stock){
      const keys = Object.keys(currentStock);
      const pk = keys.find(k => k.includes(stockKey.split(' ')[0]) || stockKey.includes(k.split(' ')[0]));
      if(pk) stock = currentStock[pk];
    }
    if(stock && stock.qty > 0){
      const sq = stock.unit === item.unit ? stock.qty
        : stock.unit==='oz' && item.unit==='ml' ? stock.qty*29.57
        : stock.unit==='ml' && item.unit==='oz' ? stock.qty/29.57
        : stock.qty;
      item.inStock = sq;
      item.stillNeeded = Math.max(0, item.qtyRaw - sq);
      item.fullyCoVered = item.stillNeeded <= 0;
      if(item.bottleInfo && item.stillNeeded > 0){
        item.bottlesBuy = Math.ceil(item.stillNeeded / item.bottleInfo.bottleOz);
        item.purchaseCostAdjusted = item.bottlesBuy * (item.bottleInfo.bottleOz * item.cpu);
      } else if(item.fullyCoVered){
        item.bottlesBuy = 0;
        item.purchaseCostAdjusted = 0;
      }
    } else {
      item.inStock = 0;
      item.stillNeeded = item.qtyRaw;
      item.fullyCoVered = false;
      item.bottlesBuy = item.bottleInfo ? Math.ceil(item.qtyRaw / item.bottleInfo.bottleOz) : 0;
      item.purchaseCostAdjusted = item.purchaseCost;
    }
    item.store = inferStore(item);
  });

  // ── Group by store ──
  const storeOrder = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Grocery','Other'];
  const storeEmoji = {SAQ:'🍷',Aubut:'🛒',IGA:'🛍',Metro:'🛍',Maxi:'🛍',Costco:'🏪',Walmart:'🏪','Marché Jean-Talon':'🌿',Grocery:'🛍',Other:'📦'};
  const storeColor = {SAQ:'#7c3aed',Aubut:'#0891b2',Grocery:'#059669',Other:'#6b7280'};
  const groups = {};
  items.filter(i => !i.fullyCoVered).forEach(item => {
    const s = item.store || 'Other';
    if(!groups[s]) groups[s] = [];
    groups[s].push(item);
  });
  const covered = items.filter(i => i.fullyCoVered);

  const totalCost = items.filter(i=>!i.fullyCoVered).reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
  const stockSavings = covered.reduce((s,i)=>s+i.purchaseCost,0);

  // ── Build HTML ──
  const wrap2 = document.createElement('div');

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'margin-bottom:1rem;';
  hdr.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">'
    + '<div><div style="font-size:16px;font-weight:600;">🗂 Master shopping list</div>'
    + '<div style="font-size:12px;color:#888;margin-top:2px;">'
    + confirmed.length + ' confirmed event' + (confirmed.length!==1?'s':'') + ': '
    + confirmed.map(e=>e.label||'Event').join(' · ')
    + '</div></div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:18px;font-weight:700;">$' + totalCost.toFixed(2) + ' CAD</div>'
    + (stockSavings>0?'<div style="font-size:11px;color:#1a7a4a;">📦 $'+stockSavings.toFixed(2)+' covered by inventory</div>':'')
    + '</div></div>';

  // Event legend
  if(confirmed.length > 1){
    const legend = document.createElement('div');
    legend.style.cssText = 'background:#f9f9f6;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;';
    legend.innerHTML = '<div style="font-weight:600;margin-bottom:4px;color:#666;">Events included:</div>'
      + confirmed.map(e => {
          const dateStr = e.eventDate ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
          return '<span style="margin-right:10px;">✅ '+e.label+(dateStr?' · '+dateStr:'')+(e.guestCount?' · '+e.guestCount+' guests':'')+'</span>';
        }).join('');
    hdr.appendChild(legend);
  }
  wrap2.appendChild(hdr);

  // Store sections
  const allStores = [...storeOrder, ...Object.keys(groups).filter(s=>!storeOrder.includes(s))];
  allStores.filter(s=>groups[s]).forEach(store => {
    const grpItems = groups[store];
    const grpTotal = grpItems.reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
    const color = storeColor[store] || '#6b7280';
    const emoji = storeEmoji[store] || '📦';

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:14px;';

    const sHdr = document.createElement('div');
    sHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    sHdr.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:16px;">'+emoji+'</span>'
      + '<span style="font-size:13px;font-weight:600;color:'+color+';">'+store+'</span>'
      + '<span style="font-size:11px;color:#aaa;">'+grpItems.length+' item'+(grpItems.length!==1?'s':'')+'</span>'
      + '</div>'
      + '<span style="font-size:13px;font-weight:500;">$'+grpTotal.toFixed(2)+'</span>';
    section.appendChild(sHdr);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:0.5rem 1rem;';

    const tableHdr = document.createElement('div');
    tableHdr.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding-bottom:4px;border-bottom:1px solid #f0f0eb;margin-bottom:4px;';
    tableHdr.innerHTML = '<span>Ingredient</span><span>Qty needed</span><span>Events</span><span>Cost</span>';
    card.appendChild(tableHdr);

    grpItems.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;padding:5px 0;border-bottom:0.5px solid #f8f8f5;align-items:start;font-size:13px;';
      const bottlesLabel = item.bottlesBuy ? item.bottlesBuy + ' × ' + (item.bottleInfo ? item.bottleInfo.bottleLabel : item.unit) : item.qtyRaw.toFixed(1)+' '+item.unit;
      const stockNote = item.inStock > 0 ? ' <span style="font-size:10px;color:#1a7a4a;">(have '+item.inStock.toFixed(0)+' '+item.unit+')</span>' : '';
      const evList = [...new Set(item.events)];
      row.innerHTML = '<div><span>'+item.name+'</span>'+stockNote+'</div>'
        + '<div style="color:#555;">'+bottlesLabel+'</div>'
        + '<div style="font-size:11px;color:#888;">'+evList.map(e=>'<div>'+e+'</div>').join('')+'</div>'
        + '<div style="font-weight:500;">$'+(item.purchaseCostAdjusted||item.purchaseCost).toFixed(2)+'</div>';
      card.appendChild(row);
    });
    section.appendChild(card);
    wrap2.appendChild(section);
  });

  // Already covered by stock
  if(covered.length){
    const covSec = document.createElement('div');
    covSec.style.cssText = 'margin-top:8px;';
    covSec.innerHTML = '<div style="font-size:12px;color:#1a7a4a;font-weight:600;margin-bottom:6px;">✅ Already in stock (' + covered.length + ' items — $'+stockSavings.toFixed(2)+' saved)</div>';
    const covList = document.createElement('div');
    covList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    covered.forEach(item => {
      const pill = document.createElement('span');
      pill.style.cssText = 'font-size:11px;padding:2px 9px;border-radius:10px;background:#edfaf3;color:#1a7a4a;border:1px solid #c8e6d4;';
      pill.textContent = item.name;
      covList.appendChild(pill);
    });
    covSec.appendChild(covList);
    wrap2.appendChild(covSec);
  }

  // No items needed (everything covered)
  if(!Object.keys(groups).length && !covered.length){
    wrap2.innerHTML += '<div style="padding:1rem;text-align:center;color:#1a7a4a;font-weight:500;">✅ All ingredients across confirmed events are already in your inventory!</div>';
  }

  wrap.appendChild(wrap2);
}
// ════════════════════════════════════════════════════════════
// EVENT LIBRARY — stored in localStorage, survives tool updates
function renderPurchaseList(){
  const el2 = el('purchaseList');
  if(!el2) return;

  // Use same cocktail source as rShop — current event + selected library events
  let allCocktails = [...(cocktails||[])];
  let guests = vi('gc') || 50;

  if(typeof shopSelectedEvents !== 'undefined' && shopSelectedEvents.length){
    shopSelectedEvents.forEach(id => {
      const ev = eventLibrary.find(e => e.id === id);
      if(ev && ev.state && ev.state.cocktails){
        allCocktails = allCocktails.concat(ev.state.cocktails);
        if(!cocktails.length) guests = (ev.state.quote&&ev.state.quote.guestCount) || ev.guestCount || guests;
      }
    });
  }

  // Also check if there's a loaded event in memory even if cocktails[] is empty
  if(!allCocktails.length && currentEventId){
    const ev = eventLibrary.find(e => e.id === currentEventId);
    if(ev && ev.state && ev.state.cocktails && ev.state.cocktails.length){
      allCocktails = [...ev.state.cocktails];
      guests = (ev.state.quote&&ev.state.quote.guestCount) || ev.guestCount || guests;
    }
  }

  if(!allCocktails.length){
    el2.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">🍸 Add cocktails first — or load an event</div>';
    return;
  }

  // Build ingredient list — pass cocktail list directly, no global swap
  let items = [];
  if(allCocktails.length){
    try {
      items = getIM(guests, allCocktails);
    } catch(e){ console.warn('Purchase list getIM error:', e); }
  }

  if(!items.length){
    el2.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text3);">No ingredients found</div>';
    return;
  }

  const ALL_RETAILERS = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online','Grocery','Other'];
  const extras = (customRetailers||[]).filter(r => !ALL_RETAILERS.includes(r));
  const retailers = [...ALL_RETAILERS, ...extras];

  // Build per-item rows with retailer dropdowns
  let grandTotal = 0;
  const rows = items.map((item, idx) => {
    const store = getItemRetailer(item.name);
    const bi = item.bottleInfo;
    const custom2 = myIngredients.find(i => i.name.toLowerCase() === item.name.toLowerCase());
    const k = item.name.toLowerCase().trim();

    let unitLabel = '';
    let costNum = 0;
    let costStr = '—';

    if(bi){
      const btls = item.bottles || Math.ceil(item.qty / (bi.bottleOz||1));
      unitLabel = btls + ' × ' + (bi.bottleLabel || bi.bottleOz + ' oz');
      if(custom2 && custom2.bottlePrice){
        costNum = parseFloat(custom2.bottlePrice) * btls;
        costStr = '$' + costNum.toFixed(2);
        grandTotal += costNum;
      } else if(custom2 && custom2.c && custom2.c > 0){
        costNum = custom2.c * (bi.bottleOz||1) * btls;
        costStr = '~$' + costNum.toFixed(2);
        grandTotal += costNum;
      }
    } else {
      const qty = item.qtyRounded || item.qty || 0;
      unitLabel = qty % 1 === 0 ? qty + ' ' + (item.unit||'') : qty.toFixed(1) + ' ' + (item.unit||'');
      if(custom2 && custom2.c && custom2.c > 0){
        costNum = custom2.c * qty;
        costStr = '~$' + costNum.toFixed(2);
        grandTotal += costNum;
      }
    }

    const opts = retailers.map(r =>
      '<option value="'+r+'"'+(r===store?' selected':'')+'>'+r+'</option>'
    ).join('');

    const bg = idx%2===0 ? 'var(--surface)' : 'var(--surface2)';
    return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr;gap:8px;padding:9px 12px;align-items:center;background:'+bg+';border-bottom:.5px solid var(--border);">'
      + '<div>'
      +   '<div style="font-weight:600;font-size:13px;color:var(--text);">'+item.name+'</div>'
      +   (item.qty>0 ? '<div style="font-size:10.5px;color:var(--text3);">'+item.qty.toFixed(2)+' '+(item.unit||'oz')+' needed</div>' : '')
      + '</div>'
      + '<div style="font-size:13px;color:var(--text2);">'+unitLabel+'</div>'
      + '<div style="font-size:13px;font-weight:600;color:'+(costStr!=='—'?'var(--green)':'var(--text3)')+';">'+costStr+'</div>'
      + '<select data-name="'+item.name.replace(/"/g,'&quot;')+'" onchange="setItemRetailer(this.dataset.name,this.value)"'
      +   ' style="font-size:12px;padding:5px 8px;border-radius:var(--radius);border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-family:var(--font);cursor:pointer;width:100%;">'+opts+'</select>'
      + '</div>';
  }).join('');

  // Column header
  const header = '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr;gap:8px;padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);background:var(--surface2);border-radius:var(--radius) var(--radius) 0 0;border:1.5px solid var(--border);border-bottom:none;">'
    + '<span>Ingredient</span><span>Full unit</span><span>Est. cost</span><span>Buy at</span>'
    + '</div>';

  const summary = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.875rem;flex-wrap:wrap;gap:8px;">'
    + '<div style="font-size:13px;color:var(--text2);">'+items.length+' ingredients</div>'
    + (grandTotal>0 ? '<div style="font-size:14px;font-weight:700;">Est. total: <span style="color:var(--green);">$'+grandTotal.toFixed(2)+'</span></div>' : '')
    + '</div>';

  // Build per-store cost summary
  const storeTotals = {};
  items.forEach(function(item){
    const store = getItemRetailer(item.name) || 'Other';
    if(!storeTotals[store]) storeTotals[store] = {cost:0, count:0};
    const bi = item.bottleInfo;
    const custom2 = myIngredients.find(function(i){ return i.name.toLowerCase()===item.name.toLowerCase(); });
    let cost = 0;
    if(bi){
      const btls = item.bottles || Math.ceil(item.qty/(bi.bottleOz||1));
      if(custom2 && custom2.bottlePrice) cost = parseFloat(custom2.bottlePrice)*btls;
      else if(custom2 && custom2.c) cost = custom2.c*(bi.bottleOz||1)*btls;
    } else {
      const qty = item.qtyRounded||item.qty||0;
      if(custom2 && custom2.c) cost = custom2.c*qty;
    }
    storeTotals[store].cost += cost;
    storeTotals[store].count++;
  });

  let storeBreakdown = '';
  const storeEntries = Object.entries(storeTotals).filter(function(e){ return e[1].cost>0; }).sort(function(a,b){ return b[1].cost-a[1].cost; });
  if(storeEntries.length > 0){
    storeBreakdown = '<div style="margin-top:1rem;padding:12px 14px;background:var(--surface2);border-radius:var(--radius-lg);border:1px solid var(--border);">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px;">🏪 Cost by store</div>'
      + storeEntries.map(function(e){
          const storeEmoji = {SAQ:'🍷',Costco:'🏢',IGA:'🛒',Metro:'🛒',Maxi:'🛒',Aubut:'🧃',Walmart:'⭐'}[e[0]]||'🏪';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border);font-size:13px;">'
            + '<span>'+storeEmoji+' '+e[0]+' <span style="color:var(--text3);font-size:11px;">('+e[1].count+' item'+(e[1].count!==1?'s':'')+')</span></span>'
            + '<span style="font-weight:700;">$'+e[1].cost.toFixed(2)+'</span>'
            + '</div>';
        }).join('')
      + '<div style="display:flex;justify-content:space-between;padding-top:8px;font-size:13px;font-weight:700;">'
      + '<span>Total</span><span style="color:var(--green);">$'+grandTotal.toFixed(2)+'</span></div>'
      + '<div style="font-size:11px;color:var(--text3);margin-top:6px;">Tap any ingredient store dropdown above to reroute to a cheaper store</div>'
      + '</div>';
  }

  el2.innerHTML = summary + header + '<div style="border:1.5px solid var(--border);border-radius:0 0 var(--radius-lg) var(--radius-lg);overflow:hidden;">'+rows+'</div>' + storeBreakdown;
}




// ── Utility functions for purchase list ──
function getItemRetailer(name){
  const key = name.toLowerCase().trim();
  if(storeOverrides[key]) return storeOverrides[key];
  return inferStore({name: name, unit: 'oz'});
}

function setItemRetailer(name, store){
  saveStoreOverride(name, store);
  renderPurchaseList();
}
