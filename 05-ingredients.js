// ═══ CUSTOM INGREDIENT DATABASE ═══
// myIngredients, bottle conversion, cost calculation, CRUD,
// quick ingredient modal, inline bottle calculator

// ── CUSTOM INGREDIENT DATABASE ────────────────────────────
// Stored in localStorage so it persists across sessions without needing a server
let myIngredients = [];
let mydbCostManualOverride = false;

// Conversion table for bottle sizes to the selected cost unit
function convertBottleSize(size, fromUnit, toUnit){
  // Convert everything to ml first
  let ml = size;
  if(fromUnit === 'oz') ml = size * 29.5735;
  else if(fromUnit === 'L') ml = size * 1000;
  else if(fromUnit === 'cl') ml = size * 10;
  // ml to target unit
  if(toUnit === 'oz') return ml / 29.5735;
  if(toUnit === 'L') return ml / 1000;
  if(toUnit === 'cl') return ml / 10;
  if(toUnit === 'ml') return ml;
  if(toUnit === 'tsp') return ml / 4.929;
  if(toUnit === 'tbsp') return ml / 14.787;
  // For piece/leaves/dashes/pinch — can't auto-convert, return size as-is
  return size;
}

function calcMyDBCostPerUnit(){
  if(mydbCostManualOverride) return;
  const bottleSize = parseFloat(v('mydbBottleSize')) || 0;
  const sizeUnit = v('mydbSizeUnit') || 'ml';
  const bottlePrice = parseFloat(v('mydbBottlePrice')) || 0;
  const costUnit = v('mydbUnit') || 'oz';
  const preview = el('mydbCostPreview');

  if(bottleSize <= 0 || bottlePrice <= 0){
    sv('mydbCost', '0');
    if(preview) preview.textContent = '';
    return;
  }
  const sizeInCostUnit = convertBottleSize(bottleSize, sizeUnit, costUnit);
  if(sizeInCostUnit <= 0){
    if(preview) preview.textContent = '';
    return;
  }
  const costPerUnit = bottlePrice / sizeInCostUnit;
  sv('mydbCost', costPerUnit.toFixed(4));

  if(preview){
    preview.innerHTML = '$' + bottlePrice.toFixed(2) + ' / ' + bottleSize + sizeUnit
      + ' = <strong>$' + costPerUnit.toFixed(4) + '/' + costUnit + '</strong>'
      + ' <span style="color:#aaa;">(' + sizeInCostUnit.toFixed(1) + ' ' + costUnit + ' per bottle)</span>';
  }
}

function loadMyDB(){
  try {
    const stored = localStorage.getItem('bartender_mydb_v1');
    if(stored) myIngredients = JSON.parse(stored);
  } catch(e){ myIngredients = []; }
  // Inject into INGFLAT so they appear in autocomplete
  syncMyDBtoFlat();
}

function saveMyDB(){
  try { localStorage.setItem('bartender_mydb_v1', JSON.stringify(myIngredients)); }
  catch(e){ alert('Could not save to local storage. Try clearing browser data.'); }
}

function syncMyDBtoFlat(){
  // Remove old custom entries from INGFLAT
  const toRemove = INGFLAT.filter(i => i._custom);
  toRemove.forEach(i => INGFLAT.splice(INGFLAT.indexOf(i), 1));
  // Add current custom entries
  myIngredients.forEach(ing => {
    INGFLAT.unshift({...ing, _custom: true}); // unshift so they appear first in search
  });
}

function addMyIngredient(){
  const name = v('mydbName').trim();
  const unit = v('mydbUnit') || 'oz';
  const cost = parseFloat(v('mydbCost')) || 0;
  const note = v('mydbNote').trim();
  const retailer = v('mydbRetailer') || '';
  const cat  = v('mydbCat') || '🏠 My custom ingredients';
  const bottleSize = parseFloat(v('mydbBottleSize')) || 0;
  const sizeUnit = v('mydbSizeUnit') || 'ml';
  const bottlePrice = parseFloat(v('mydbBottlePrice')) || 0;

  if(!name){ alert('Please enter an ingredient name.'); return; }
  if(cost <= 0 && bottlePrice <= 0){ alert('Enter either the bottle price or a cost per unit.'); return; }

  const entry = {
    name, unit, c: cost,
    note: note || (bottlePrice > 0 ? '$' + bottlePrice.toFixed(2) + '/' + bottleSize + sizeUnit : ''),
    retailer,
    cat,
    bottleSize: bottleSize || null,
    bottleSizeUnit: sizeUnit,
    bottlePrice: bottlePrice || null,
    addedAt: new Date().toISOString()
  };

  const exists = myIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
  if(exists){
    if(!confirm('"' + name + '" already exists in your database. Update it?')) return;
    Object.assign(exists, entry);
  } else {
    myIngredients.push(entry);
  }
  saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  sv('mydbName',''); sv('mydbCost','0'); sv('mydbNote',''); sv('mydbRetailer','');
  sv('mydbBottleSize',''); sv('mydbBottlePrice','');
  mydbCostManualOverride = false;
  const preview = el('mydbCostPreview');
  if(preview) preview.textContent = '';
  const btn = document.querySelector('#mydbForm .btn-primary');
  if(btn){ const o=btn.textContent; btn.textContent='✓ Saved!'; btn.style.background='#1a7a4a'; setTimeout(()=>{btn.textContent=o;btn.style.background='';},1800); }
}

function removeMyIngredient(idx){
  const removed = myIngredients[idx];
  if(!removed) return;
  if(!confirm('Remove "' + removed.name + '" from your database?')) return;
  myIngredients.splice(idx, 1);
  saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  pushUndo('Removed ingredient "' + removed.name + '"', () => {
    myIngredients.splice(idx, 0, removed);
    saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  });
}

function editMyIngredient(idx){
  const ing = myIngredients[idx];
  sv('mydbName',ing.name);
  sv('mydbUnit',ing.unit);
  sv('mydbCost',ing.c);
  sv('mydbNote',ing.note||'');
  sv('mydbRetailer',ing.retailer||'');
  sv('mydbCat',ing.cat||'🏠 My custom ingredients');
  // Remove and let them re-add (effectively an edit)
  myIngredients.splice(idx, 1);
  saveMyDB();
  syncMyDBtoFlat();
  renderMyDB();
  document.getElementById('mydbName').focus();
}

function updateMyIngredientCost(idx, val){
  myIngredients[idx].c = parseFloat(val) || 0;
  saveMyDB();
  syncMyDBtoFlat();
}

function renderMyDB(){
  const el = el2('mydbList');
  if(!el)return;
  if(!myIngredients.length){
    el.innerHTML = '<div class="empty" style="padding:2rem;text-align:center;color:#aaa;font-size:14px;">No custom ingredients yet — add one above</div>';
    return;
  }
  // Group by category
  const groups = {};
  myIngredients.forEach((ing, idx) => {
    const cat = ing.cat || '🏠 My custom ingredients';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push({ing, idx});
  });

  el.innerHTML = Object.entries(groups).map(([cat, items]) => {
    const headerRow = '<div style="display:grid;grid-template-columns:2fr 0.7fr 1.1fr 1.5fr auto;gap:8px;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:#aaa;border-bottom:1px solid #f0f0eb;background:#fafaf7;">'
      + '<span>Name</span><span>Unit</span><span>CAD$/unit</span><span>Notes / where to buy</span><span></span></div>';
    const itemRows = items.map(({ing, idx}) => {
      const bottleLabel = (ing.bottlePrice && ing.bottleSize)
        ? '<div style="font-size:10px;color:#1a7a4a;margin-top:2px;">$' + parseFloat(ing.bottlePrice).toFixed(2) + '/' + ing.bottleSize + (ing.bottleSizeUnit||'ml') + '</div>'
        : '';
      const retailerBadge = ing.retailer
        ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#e8f0fd;color:#2156b8;margin-left:4px;">' + ing.retailer + '</span>'
        : '';
      return '<div style="display:grid;grid-template-columns:2fr 0.7fr 1.1fr 1.5fr auto;gap:8px;padding:9px 12px;font-size:13px;border-bottom:1px solid #f5f5f0;align-items:center;">'
        + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;"><span style="font-weight:500;">' + ing.name + '</span>' + retailerBadge + bottleLabel + '</div>'
        + '<span style="color:#888;">' + ing.unit + '</span>'
        + '<span style="display:flex;flex-direction:column;gap:1px;">'
        + '<input type="number" value="' + (typeof ing.c === 'number' ? ing.c.toFixed(4) : Number(ing.c).toFixed(4)) + '" min="0" step="0.0001" style="width:90px;font-size:13px;" data-idx="' + idx + '" onchange="updateMyIngredientCost(parseInt(this.dataset.idx),this.value)">'
        + '<span style="font-size:10px;color:#aaa;">per ' + ing.unit + '</span>'
        + '</span>'
        + '<span style="font-size:12px;color:#aaa;">' + (ing.note||'—') + '</span>'
        + '<span style="display:flex;gap:4px;">'
        + '<button class="btn btn-sm" data-idx="' + idx + '" onclick="editMyIngredient(parseInt(this.dataset.idx))" title="Edit">✎</button>'
        + '<button class="btn btn-sm btn-danger" data-idx="' + idx + '" onclick="removeMyIngredient(parseInt(this.dataset.idx))" title="Remove">✕</button>'
        + '</span></div>';
    }).join('');
    return '<div style="margin-bottom:1rem;">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;padding:6px 0 4px;">' + cat + '</div>'
      + '<div style="border:1px solid #e5e5e0;border-radius:10px;overflow:hidden;background:#fff;">'
      + headerRow + itemRows + '</div></div>';
  }).join('');
}

function exportMyDB(){
  if(!myIngredients.length){ alert('No custom ingredients to export yet.'); return; }
  const payload = {schema:'bartender_mydb_v1', exportedAt: new Date().toISOString(), ingredients: myIngredients};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
  a.download = 'my_ingredient_database.json';
  a.click();
}

function importMyDB(e){
  const file = e.target.files[0]; if(!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const ings = data.ingredients || data; // support both wrapped and bare array
      if(!Array.isArray(ings)) throw new Error('Invalid format');
      const added = [];
      ings.forEach(ing => {
        if(!ing.name) return;
        const exists = myIngredients.find(i => i.name.toLowerCase() === ing.name.toLowerCase());
        if(!exists){ myIngredients.push(ing); added.push(ing.name); }
      });
      saveMyDB(); syncMyDBtoFlat(); renderMyDB();
      alert(`Imported ${added.length} ingredient${added.length!==1?'s':''} successfully.`);
    } catch(err){ alert("Could not read file — make sure it's a valid ingredient database export."); }
  };
  r.readAsText(file);
  e.target.value = '';
}

// Also allow saving a price looked up from AI directly into custom DB
function doSaveFromLookup(btn){
  const key = btn.dataset.tmpkey;
  const d = window._priceLookupTemp && window._priceLookupTemp[key];
  if(!d){ btn.textContent='Not found'; return; }
  saveToMyDB(d.name, d.unit, d.cost, d.note);
  btn.textContent = String.fromCharCode(10003)+' Saved'; // ✓ without literal special char
  btn.disabled = true;
  btn.style.background = '#1a7a4a';
  btn.style.color = '#fff';
}

function saveToMyDB(ingredientName, unit, cost, note){
  const exists = myIngredients.find(i => i.name.toLowerCase() === ingredientName.toLowerCase());
  if(exists){
    exists.c = cost;
    exists.note = note;
  } else {
    myIngredients.push({name:ingredientName, unit, c:cost, note, cat:'🏠 My custom ingredients', addedAt:new Date().toISOString()});
  }
  saveMyDB(); syncMyDBtoFlat();
}

let quickIngTargetRow = null; // which ingredient row to update after save

function openQuickIngModal(){
  openQuickIngModalWithName('', null);
}

function openQuickIngModalWithName(name, rowIdx){
  quickIngTargetRow = rowIdx;
  sv('qiName', name||'');
  sv('qiBottleSize',''); sv('qiPrice',''); sv('qiCost','0'); sv('qiNote','');
  sv('qiRetailer','');
  gc2('qiPreview','');
  // Close the ingredient dropdown first
  document.querySelectorAll('.ing-dropdown').forEach(d => d.classList.remove('open'));
  el('quickIngModalBg').classList.add('open');
  setTimeout(()=>{
    const n = el('qiName');
    if(n){
      n.focus();
      // Move cursor to end
      n.setSelectionRange(n.value.length, n.value.length);
    }
  }, 100);
}
function closeQuickIngModal(){ el('quickIngModalBg').classList.remove('open'); }

function calcQIcost(){
  const size = parseFloat(v('qiBottleSize'))||0;
  const sizeUnit = v('qiSizeUnit')||'ml';
  const price = parseFloat(v('qiPrice'))||0;
  const unit = v('qiUnit')||'oz';
  if(size > 0 && price > 0){
    const inUnit = convertBottleSize(size, sizeUnit, unit);
    const cpu = inUnit > 0 ? price/inUnit : 0;
    sv('qiCost', cpu.toFixed(4));
    gc2('qiPreview', '$' + price.toFixed(2) + '/' + size + sizeUnit + ' = $' + cpu.toFixed(4) + '/' + unit + ' (' + inUnit.toFixed(1) + ' ' + unit + '/bottle)');
  }
}

function saveQuickIngredient(){
  const name = v('qiName').trim();
  if(!name){ alert('Enter a name.'); return; }
  const cost = parseFloat(v('qiCost'))||0;
  const unit = v('qiUnit')||'oz';
  if(cost <= 0){ alert('Enter a bottle price or cost per unit.'); return; }

  const entry = {
    name, unit, c: cost,
    note: v('qiNote').trim() || (v('qiPrice') && v('qiBottleSize') ? '$'+parseFloat(v('qiPrice')).toFixed(2)+'/'+v('qiBottleSize')+(v('qiSizeUnit')||'ml') : ''),
    retailer: v('qiRetailer') || '',
    cat: '🏠 My custom ingredients',
    bottleSize: parseFloat(v('qiBottleSize'))||null,
    bottleSizeUnit: v('qiSizeUnit')||'ml',
    bottlePrice: parseFloat(v('qiPrice'))||null,
    addedAt: new Date().toISOString()
  };
  const exists = myIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
  if(exists){ Object.assign(exists, entry); }
  else { myIngredients.push(entry); }
  saveMyDB();
  syncMyDBtoFlat();
  closeQuickIngModal();
  // If opened from a specific ingredient row, auto-fill that row
  if(quickIngTargetRow !== null){
    const rowIdx = quickIngTargetRow;
    quickIngTargetRow = null;
    const targetIng = nIng[rowIdx];
    if(targetIng){
      targetIng.n = entry.name;
      targetIng.u = entry.unit;
      targetIng.c = entry.c;
      rNI();
      rC(); rShop(); rQ();
    }
    return;
  }
  quickIngTargetRow = null;
  // Auto-add to current recipe being built
  addIR({n: name, q: 1, u: unit, c: cost});
  showToast('⭐ ' + name + ' added to your database and recipe', 'success');
}

// ── INLINE BOTTLE PRICE CALCULATOR FOR RECIPE INGREDIENTS ──
function toggleBottleCalc(btn, gid, idx){
  const wrap = document.getElementById('bcalc_' + gid);
  if(!wrap) return;
  const open = wrap.style.display === 'none' || !wrap.style.display;
  wrap.style.display = open ? 'block' : 'none';
  btn.style.color = open ? '#1a7a4a' : 'var(--color-text-secondary)';
}

function calcIngBottle(gid, idx){
  const price = parseFloat((document.getElementById('bprice_' + gid)||{}).value)||0;
  const size  = parseFloat((document.getElementById('bsize_' + gid)||{}).value)||0;
  const sunit = (document.getElementById('bsunit_' + gid)||{}).value||'ml';
  const g = nIng[parseInt(idx)];
  if(!g || price <= 0 || size <= 0) return;
  const costUnit = g.u || 'oz';
  const sizeInUnit = convertBottleSize(size, sunit, costUnit);
  if(sizeInUnit <= 0) return;
  const cpu = price / sizeInUnit;
  g.c = parseFloat(cpu.toFixed(4));
  const costEl = document.getElementById('lcost_' + gid);
  if(costEl) costEl.value = cpu.toFixed(4);
  const srcEl = document.getElementById('lsrc_' + gid);
  if(srcEl) srcEl.textContent = '$' + price.toFixed(2) + '/' + size + sunit + ' = $' + cpu.toFixed(4) + '/' + costUnit;
  markUnsaved();
}

// ════════════════════════════════════════════════════════════
