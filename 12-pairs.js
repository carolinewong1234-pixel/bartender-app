// ═══ HIS & HERS PAIRING ═══

function populatePairLinks() {
  ['p1link','p2link'].forEach(id => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">— none / custom —</option>';
    cocktails.forEach((c,i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = cur;
  });
}

function getPairCost(linkVal, dpg, guests) {
  const idx = parseInt(linkVal);
  if (isNaN(idx) || !cocktails[idx]) return null;
  const c = cocktails[idx];
  const costPerDrink = c.ing.reduce((s,i)=>s+i.c*i.q, 0);
  return {costPerDrink, totalCost: costPerDrink * dpg * guests};
}

function editCocktailWeight(cid, currentWeight){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;

  const existing = document.getElementById('weightPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'weightPopup';
  popup.style.cssText = 'position:fixed;z-index:2000;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:16px;box-shadow:0 4px 24px rgba(0,0,0,0.14);min-width:260px;';

  // Position near the card — center of screen on mobile
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%,-50%)';

  const dpp = parseFloat(document.getElementById('drinksPerPerson')?.value) || 5;
  const n = cocktails.length || 1;
  const rawWeights = cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b,0);

  function calcShare(w){
    const newSum = weightSum - (cocktail.dpg||1) + w;
    return (w / newSum * dpp).toFixed(1);
  }

  popup.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + cocktail.name + '</div>'
    + '<div style="font-size:12px;color:#888;margin-bottom:12px;">How popular is this cocktail relative to others?</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
    + '<span style="font-size:12px;color:#aaa;">Less</span>'
    + '<input type="range" id="wSlider" min="0.5" max="3" step="0.5" value="' + (currentWeight||1) + '" style="flex:1;" oninput="updateWeightPreview(this.value)">'
    + '<span style="font-size:12px;color:#aaa;">More</span>'
    + '</div>'
    + '<div id="wPreview" style="text-align:center;font-size:13px;color:#2156b8;font-weight:500;margin-bottom:12px;">~' + calcShare(currentWeight||1) + ' drinks/person</div>'
    + '<div style="display:flex;gap:6px;justify-content:space-between;">'
    + '<button onclick="setCocktailWeight(window._editingWeightCid,1)" style="font-size:12px;padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;font-family:inherit;">= Equal</button>'
    + '<button onclick="applyCocktailWeight(window._editingWeightCid)" style="font-size:12px;padding:5px 14px;border:none;border-radius:6px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;">Apply</button>'
    + '<button onclick="var p=document.getElementById(\x27weightPopup\x27);if(p)p.remove()" style="font-size:12px;padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '</div>';

  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function closeW(e){
    if(!popup.contains(e.target)){ popup.remove(); document.removeEventListener('click',closeW); }
  }), 100);

  // Store current editing cid
  window._editingWeightCid = cid;
}

function updateWeightPreview(val){
  const cid = window._editingWeightCid;
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  const dpp = parseFloat(document.getElementById('drinksPerPerson')?.value) || 5;
  const rawWeights = cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b,0);
  const newSum = weightSum - (cocktail.dpg||1) + parseFloat(val);
  const share = (parseFloat(val) / newSum * dpp).toFixed(1);
  const prev = document.getElementById('wPreview');
  if(prev) prev.textContent = '~' + share + ' drinks/person';
}

function setCocktailWeight(cid, weight){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  cocktail.dpg = weight;
  const popup = document.getElementById('weightPopup');
  if(popup) popup.remove();
  rC(); rShop(); rQ(); markUnsaved();
}

function applyCocktailWeight(cid){
  const slider = document.getElementById('wSlider');
  if(!slider) return;
  setCocktailWeight(cid, parseFloat(slider.value));
}

function toggleHisHers(cid){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  // Cycle: none → his → hers → none
  if(!cocktail.hisHers){
    // Check if a 'his' is already set
    const existingHis = cocktails.find(x => x.hisHers === 'his');
    cocktail.hisHers = existingHis ? 'hers' : 'his';
  } else if(cocktail.hisHers === 'his'){
    cocktail.hisHers = 'hers';
  } else {
    cocktail.hisHers = null;
  }
  // Show the His & Hers row in settings if any cocktail is flagged
  const anyFlagged = cocktails.some(x => x.hisHers);
  const hhRow = el('hisHersRow');
  if(hhRow) hhRow.style.display = anyFlagged ? '' : 'none';
  // Auto-sync cocktail name to the pair drink name field
  syncPairNamesToMenu();
  rC(); rQ(); markUnsaved();
}

function syncPairNamesToMenu(){
  // Auto-fill p1drink/p2drink from flagged cocktails
  const his = cocktails.find(x => x.hisHers === 'his');
  const hers = cocktails.find(x => x.hisHers === 'hers');
  if(his){ const inp = el('p1drink'); if(inp && !inp.value) sv('p1drink', his.name); }
  if(hers){ const inp = el('p2drink'); if(inp && !inp.value) sv('p2drink', hers.name); }
  // Auto-link p1link/p2link
  if(his){ const sel = el('p1link'); if(sel) { populatePairLinks(); sel.value = cocktails.indexOf(his); } }
  if(hers){ const sel = el('p2link'); if(sel) { populatePairLinks(); sel.value = cocktails.indexOf(hers); } }
}

function rPairs() {
  populatePairLinks();
  const p1 = v('p1name') || 'Partner 1';
  const p2 = v('p2name') || 'Partner 2';
  const evName = v('pEventName') || '';
  const p1drink = v('p1drink') || 'Signature cocktail';
  const p2drink = v('p2drink') || 'Signature cocktail';
  const p1desc = v('p1desc');
  const p2desc = v('p2desc');
  const p1dpg = parseFloat(v('p1dpg'))||1;
  const p2dpg = parseFloat(v('p2dpg'))||1;
  const p1link = v('p1link');
  const p2link = v('p2link');
  const guests = vi('gc') || 50;

  // Update dynamic labels
  gc2('p1label', p1 + String.fromCharCode(39) + 's drink');
  gc2('p2label', p2 + String.fromCharCode(39) + 's drink');

  // Cost info
  const c1 = getPairCost(p1link, p1dpg, guests);
  const c2 = getPairCost(p2link, p2dpg, guests);
  const linked1 = p1link !== '' && cocktails[parseInt(p1link)];
  const linked2 = p2link !== '' && cocktails[parseInt(p2link)];

  shtml('pairPreview',`
    <div class="quote-pair">
      <div class="quote-pair-header">
        ${evName ? evName + ' · ' : ''}Signature cocktails
      </div>
      <div class="quote-pair-body">
        <div class="quote-pair-side his">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#3a6ad4;margin-bottom:6px;">${p1}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${p1drink}</div>
          ${p1desc ? `<div style="font-size:12px;color:#888;line-height:1.5;margin-bottom:6px;">${p1desc}</div>` : ''}
          ${linked1 ? `<div style="font-size:11px;color:#aaa;">Based on: ${cocktails[parseInt(p1link)].name}</div>` : ''}
          ${c1 ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">$${c1.costPerDrink.toFixed(2)}/drink · ${p1dpg} drink${p1dpg!==1?'s':''}/guest</div>` : `<div style="font-size:11px;color:#aaa;margin-top:2px;">${p1dpg} drink${p1dpg!==1?'s':''}/guest</div>`}
        </div>
        <div class="quote-pair-mid">💑</div>
        <div class="quote-pair-side her">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#c0206e;margin-bottom:6px;">${p2}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${p2drink}</div>
          ${p2desc ? `<div style="font-size:12px;color:#888;line-height:1.5;margin-bottom:6px;">${p2desc}</div>` : ''}
          ${linked2 ? `<div style="font-size:11px;color:#aaa;">Based on: ${cocktails[parseInt(p2link)].name}</div>` : ''}
          ${c2 ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">$${c2.costPerDrink.toFixed(2)}/drink · ${p2dpg} drink${p2dpg!==1?'s':''}/guest</div>` : `<div style="font-size:11px;color:#aaa;margin-top:2px;">${p2dpg} drink${p2dpg!==1?'s':''}/guest</div>`}
        </div>
      </div>
    </div>`);
  markUnsaved();
}

function getPairHTML() {
  const pEl = el('pairPreview'); return pEl ? pEl.innerHTML : '';
}

function addPairToMenu(){
  const p1name = v('p1name') || 'Partner 1';
  const p2name = v('p2name') || 'Partner 2';
  const p1drink = v('p1drink') || '';
  const p2drink = v('p2drink') || '';
  if(!p1drink && !p2drink){ showToast('Enter cocktail names first', 'error'); return; }
  let added = 0;
  [p1drink, p2drink].forEach(nm => {
    if(!nm.trim()) return;
    if(!cocktails.some(c2 => c2.name.toLowerCase() === nm.toLowerCase())){
      cocktails.push({ id: Date.now()+Math.random(), name: nm, cat: 'His & Hers', dpg: 1, ing: [] });
      added++;
    }
  });
  if(added === 0){ showToast('Both cocktails already in menu', 'success'); return; }
  rC(); rShop(); rQ(); markUnsaved();
  showToast(added + ' cocktail' + (added!==1?'s':'') + ' added to menu', 'success');
  sw('menu', document.getElementById('st-menu'));
}

function cpPair() {
  const previewEl = el('pairPreview');
  if (!previewEl || !previewEl.innerText.trim()) { alert('Build a His & Hers pairing first — fill in partner names and cocktails above.'); return; }
  const text = previewEl.innerText;
  // Try modern clipboard API first, fall back to execCommand for local files
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Pairing card copied to clipboard!', 'success'))
      .catch(() => cpPairFallback(text));
  } else {
    cpPairFallback(text);
  }
}
function cpPairFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try {
    document.execCommand('copy');
    showToast('Pairing card copied!', 'success');
  } catch(e) {
    showToast('Could not auto-copy — select the text below and copy manually', 'error');
  }
  document.body.removeChild(ta);
}

// Inject pairing into quote if filled out
function getPairQuoteBlock() {
  const p1name = v('p1name');
  const p1drink = v('p1drink');
  const p2name = v('p2name');
  const p2drink = v('p2drink');
  if (!p1drink && !p2drink) return '';
  const _pEl = el('pairPreview'); return _pEl ? _pEl.innerHTML : '';
}
