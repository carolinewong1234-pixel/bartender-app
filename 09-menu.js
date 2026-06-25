// ═══ MENU BUILDER ═══
// Cocktail cards (rC), ingredient rows, dropdown system,
// cocktail editing, save to library, quick-add

function addIR(o){
  const id='i'+(Date.now()+Math.random()).toString(36).replace('.','');
  const newIng = {id, n:o?o.n:'', q:o?o.q:1, u:o?o.u:'oz', c:o?o.c:0};
  nIng.push(newIng);
  rNI();
  // Auto-focus and open dropdown on the newly added row
  if(!o || !o.n){
    setTimeout(() => {
      const newInput = document.getElementById('lname_' + id);
      if(newInput){
        newInput.focus();
        openDD(nIng.length - 1);
        newInput.scrollIntoView({behavior:'smooth', block:'nearest'});
      }
    }, 60);
  }
}

function rNI(){
  const el=el2('nil');
  if(!el)return;
  if(!nIng.length){el.innerHTML='<div style="font-size:13px;color:#bbb;margin-bottom:8px;padding:4px 0;">No ingredients yet — click &quot;+ Add ingredient&quot; below</div>';return;}
  el.innerHTML=nIng.map((g,i)=>`
    <div class="ir" id="ir_${g.id}">
      <div class="ir-col">
        ${buildDropdown(i)}
      </div>
      <div class="ir-col">
        <input type="number" value="${g.q}" min="0" step="0.25" oninput="nIng[${i}].q=parseFloat(this.value)||0;markUnsaved()">
      </div>
      <div class="ir-col">
        <input type="text" value="${g.u}" placeholder="oz" oninput="nIng[${i}].u=this.value;markUnsaved()">
      </div>
      <div class="ir-col">
        <div class="cost-wrap">
          <input type="number" id="lcost_${g.id}" value="${g.c.toFixed(4)}" min="0" step="0.0001" placeholder="0.0000"
            oninput="nIng[${i}].c=parseFloat(this.value)||0;markUnsaved()">
          <button class="lookup-btn" id="lbtn_${g.id}" onclick="lookupSinglePrice(${i})" title="Look up SAQ/market price">🔍</button>
          <button onclick="toggleBottleCalc(this,'${g.id}','${i}')" title="Enter bottle price instead" style="padding:0 5px;height:32px;font-size:12px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;flex-shrink:0;">🍾</button>
          <button onclick="showLibraryPrices('${g.id}','${i}',event)" title="Use price from receipt history or ingredient library" id="lplib_${g.id}" style="padding:0 6px;height:32px;font-size:12px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;flex-shrink:0;">📦</button>
        </div>
        <div id="lpricelib_${g.id}" style="display:none;position:absolute;z-index:300;background:#fff;border:1px solid #e5e5e0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);padding:8px;min-width:240px;max-width:300px;margin-top:2px;"></div>
        <div id="bcalc_${g.id}" style="display:none;margin-top:4px;">
          <div style="display:flex;gap:3px;align-items:center;">
            <input type="number" placeholder="Price $" id="bprice_${g.id}" min="0" step="0.01" style="flex:1;font-size:11px;padding:4px 6px;" oninput="calcIngBottle('${g.id}','${i}')">
            <input type="number" placeholder="Size" id="bsize_${g.id}" min="0" step="1" style="flex:1;font-size:11px;padding:4px 6px;" oninput="calcIngBottle('${g.id}','${i}')">
            <select id="bsunit_${g.id}" onchange="calcIngBottle('${g.id}','${i}')" style="width:38px;font-size:10px;padding:4px 2px;">
              <option>ml</option><option>oz</option><option>L</option>
            </select>
          </div>
        </div>
        <div class="price-source" id="lsrc_${g.id}"></div>
      </div>
      <div class="ir-col" style="justify-content:flex-start;padding-top:2px;">
        <button class="btn btn-sm btn-danger" onclick="nIng.splice(${i},1);rNI();markUnsaved()">✕</button>
      </div>
    </div>`).join('');
}

function addC(){
  const name=v('nn').trim();
  if(!name){alert('Enter a cocktail name.');return;}
  if(!nIng.length){alert('Add at least one ingredient.');return;}
  const _cat=v('ncat')||'Signature'; cocktails.push({id:Date.now(),name,cat:_cat,dpg:parseFloat(v('ndpg'))||1,hisHers:_cat==='His & Hers',ing:nIng.map(i=>({...i}))});
  nIng=[{n:'',q:1,u:'oz',c:0}];sv('nn','');sv('ndpg','1');
  postEventData={}; // reset post-event when menu changes
  rNI();rC();rShop();syncSettings();rQ();markUnsaved();
  // Focus the name field for next cocktail
  setTimeout(()=>{ const nn=el('nn'); if(nn) nn.focus(); }, 50);
}

function qAdd(i){const l=LIB[i];cocktails.push({id:Date.now(),name:l.name,cat:l.cat,dpg:l.dpg,ing:l.ing.map(x=>({...x}))});rC();markUnsaved();}
function badgeCls(cat){return({Signature:'sig','Non-alcoholic':'non',Shot:'sht',Punch:'pun','His & Hers':'his'})[cat]||'';}
let shopSelectedEvents = [];
let menuEventActive = false; // true only after explicit create or load // IDs of library events to include in shopping list
let editingCocktailId = null;
let editIngredients = []; // working copy while editing
function rC(){
  const el=el2('clist');
  if(!el)return;
  if(!cocktails.length){el.innerHTML='<div class="empty">🍸 No cocktails yet — quick-add from the library or create a custom one</div>';return;}
  el.innerHTML=cocktails.map(c=>{
    const batchSrv=c.batchServings||1; const tc=c.ing.reduce((s,i)=>s+i.c*i.q,0)/batchSrv;
    const isEditing = editingCocktailId === c.id;
    if(isEditing){
      return renderCocktailEdit(c);
    }
    return `<div class="cocktail-item" id="ci_${c.id}" data-cat="${c.cat||'Signature'}">
      <div class="ch">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:15px;">${c.name}</span>
          <span class="badge ${badgeCls(c.cat)}">${c.cat}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:12px;color:#888;">$${tc.toFixed(2)} CAD/drink</span>
          <span
            title="Relative popularity weight — higher = more of this cocktail ordered. Click to adjust."
            style="font-size:11px;padding:2px 8px;border-radius:10px;background:${(c.dpg&&c.dpg!==1)?'#e8f0fd':'#f5f5f0'};color:${(c.dpg&&c.dpg!==1)?'#2156b8':'#aaa'};cursor:pointer;white-space:nowrap;"
            onclick="editCocktailWeight('${c.id}', ${c.dpg||1})"
          >${(c.dpg&&c.dpg!==1)?'×'+c.dpg+' weight':'weight: equal'}</span>
          <button class="btn btn-sm" data-cid="${c.id}" onclick="startEditCocktail(this.dataset.cid)" title="Edit this cocktail">✎ Edit</button>
          <button class="btn btn-sm" data-cid="${c.id}" onclick="saveOneRecipeToLibrary(this.dataset.cid)" title="Save to recipe library">📚 Save</button>
          <button class="btn btn-sm" data-cid="${c.id}"
            onclick="toggleHisHers(this.dataset.cid)"
            title="Mark as His or Hers signature cocktail"
            style="background:${c.hisHers==='his'?'#e8eefb':'c.hisHers'==='hers'?'#fce8f3':'#f9f9f6'};color:${c.hisHers?'#1a1a1a':'#aaa'};"
          >${c.hisHers==='his'?'💙 His':c.hisHers==='hers'?'💗 Hers':'💑'}</button>
          <button class="btn btn-sm btn-danger" data-cid="${c.id}" onclick="removeCocktailById(this.dataset.cid)">Remove</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:4px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;padding-bottom:4px;border-bottom:1px solid #f0f0eb;margin-bottom:4px;">
        <span>Ingredient</span><span>Qty</span><span>Unit</span><span>CAD$/unit</span>
      </div>
      ${c.ing.map(g=>`<div class="ci-ing-row"><span class="ci-ing-name">${g.n}</span><span>${g.q}</span><span>${g.u}</span><span style="font-family:var(--mono);font-size:11.5px;color:var(--text2);">$${g.c.toFixed(2)}</span></div>`).join('')}
    </div>`;
  }).join('');

  // Auto-show His & Hers settings when any cocktail uses that category
  renderMyLibrarySection();
  const _anyHH = cocktails.some(x => x.cat === 'His & Hers' || x.hisHers);
  const _hhRow = el('hisHersRow');
  if(_hhRow) _hhRow.style.display = _anyHH ? '' : 'none';
  if(_anyHH) rPairs();
}

function removeCocktailById(cid){
  const removed = cocktails.find(x => String(x.id) === String(cid));
  cocktails = cocktails.filter(x => String(x.id) !== String(cid));
  if(editingCocktailId === cid) editingCocktailId = null;
  rC(); rShop(); syncSettings(); rQ(); markUnsaved();
  if(removed) pushUndo('Removed "' + removed.name + '" from menu', () => {
    cocktails.push(removed); rC(); rShop(); rQ(); markUnsaved();
  });
}

function renderCocktailEdit(c){
  const CATS = ['Signature','Classic','Non-alcoholic','Shot','Punch','His & Hers'];
  const catOpts = CATS.map(cat => `<option${cat===c.cat?' selected':''}>${cat}</option>`).join('');
  const ingRows = editIngredients.map((g,i) => `
    <div class="edit-ing-row" id="eir_${i}">
      <div style="position:relative;">
        <input type="text" value="${g.n}" placeholder="Ingredient"
          id="ein_${i}"
          autocomplete="off"
          style="width:100%;font-size:13px;"
          oninput="editIngredients[${i}].n=this.value;filterEditDD(${i},this.value);scheduleEditAutosave()"
          onfocus="filterEditDD(${i},this.value)"
          onkeydown="navEditDD(event,${i})">
        <div class="ing-dropdown" id="edd_${i}"></div>
      </div>
      <input type="number" value="${g.q}" min="0" step="0.25"
        oninput="editIngredients[${i}].q=parseFloat(this.value)||0;scheduleEditAutosave()"
        style="font-size:13px;">
      <input type="text" value="${g.u}" placeholder="oz"
        oninput="editIngredients[${i}].u=this.value"
        style="font-size:13px;">
      <div style="display:flex;gap:3px;align-items:center;">
        <input type="number" value="${g.c}" min="0" step="0.01"
          oninput="editIngredients[${i}].c=parseFloat(this.value)||0;scheduleEditAutosave()"
          id="eic_${i}" style="flex:1;font-size:13px;">
        <button class="lookup-btn" style="height:32px;padding:0 6px;font-size:12px;"
          onclick="lookupEditIngPrice(${i})" title="Search current price">🔍</button>
        <button onclick="toggleEditBottleCalc(this,${i})" title="Enter bottle price → auto-calc $/oz"
          style="height:32px;padding:0 6px;font-size:12px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;">🍾</button>
        <button onclick="showEditLibraryPrices(${i},event)" title="Use price from receipt history"
          style="height:32px;padding:0 6px;font-size:12px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;position:relative;">📦</button>
      </div>
      <div id="ebcalc_${i}" style="display:none;margin-top:4px;">
        <div style="display:flex;gap:4px;align-items:center;">
          <input type="number" placeholder="Bottle $" id="ebprice_${i}" min="0" step="0.01"
            style="flex:1;font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;"
            oninput="calcEditBottlePrice(${i})">
          <input type="number" placeholder="Size" id="ebsize_${i}" min="0" step="1"
            style="width:60px;font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;"
            oninput="calcEditBottlePrice(${i})">
          <select id="ebunit_${i}" onchange="calcEditBottlePrice(${i})"
            style="font-size:12px;padding:4px 6px;border:1px solid #ddd;border-radius:6px;">
            <option value="ml">ml</option><option value="oz">oz</option><option value="L">L</option>
          </select>
        </div>
        <div id="ebresult_${i}" style="font-size:11px;color:#1a7a4a;margin-top:3px;"></div>
      </div>
      <div id="elpricelib_${i}" style="display:none;position:absolute;z-index:300;background:#fff;border:1px solid #e5e5e0;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,0.12);padding:8px;min-width:240px;max-width:300px;"></div>
      <button class="btn btn-sm btn-danger"
        onclick="editIngredients.splice(${i},1);rC()">✕</button>
    </div>`).join('');

  return `<div class="cocktail-item editing" id="ci_${c.id}">
    <div style="padding:14px 16px 0;">
    <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:12px;display:flex;align-items:center;gap:6px;">
      ✎ Editing cocktail
      <span style="font-weight:400;color:#aaa;font-size:11px;">— autosaves as you type</span>
    </div>
    <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px;">
      <div>
        <label style="font-size:12px;color:#666;font-weight:500;display:block;margin-bottom:3px;">Cocktail name</label>
        <input type="text" id="editName_${c.id}" value="${c.name}"
          style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;"
          placeholder="Cocktail name">
      </div>
      <div>
        <label style="font-size:12px;color:#666;font-weight:500;display:block;margin-bottom:3px;">Drinks/guest</label>
        <input type="number" id="editDpg_${c.id}" value="${c.dpg}" min="0.1" step="0.1"
          style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;">
      </div>
      <div>
        <label style="font-size:12px;color:#666;font-weight:500;display:block;margin-bottom:3px;">Category</label>
        <select id="editCat_${c.id}"
          style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:8px;font-size:14px;background:#fff;">
          ${catOpts}
        </select>
      </div>
    </div>
  <div style="display:grid;grid-template-columns:2fr 0.7fr 0.6fr 1fr auto;gap:6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px;padding:0 2px;">
      <span>Ingredient</span><span>Qty</span><span>Unit</span><span>CAD$/unit</span><span></span>
    </div>
    <div id="editIngList_${c.id}" style="margin-bottom:4px;">${ingRows}</div>
    <button class="btn btn-sm" onclick="addEditIngredientRow()" style="margin-top:6px;margin-bottom:10px;">+ Add ingredient</button>
    </div>
    <div style="padding:0 16px 14px;"><div class="edit-actions" style="justify-content:space-between;">
      <button class="btn" onclick="cancelEditCocktail()">✕ Close</button>
      <div style="display:flex;gap:8px;align-items:center;">
        <span id="saveEditBtn_${c.id}" style="font-size:11px;color:var(--text3);"></span>
        <button class="btn" onclick="undoEditCocktail()" title="Undo all changes back to original" style="color:var(--amber);border-color:var(--amber-bg);">↩ Undo changes</button>
      </div>
    </div>
  </div>`;
}

function startEditCocktail(cid){
  const c = cocktails.find(x => String(x.id) === String(cid));
  if(!c){ showToast('Cocktail not found — try reloading the event', 'error'); return; }
  editingCocktailId = c.id;
  editIngredients = c.ing.map(i => ({...i})); // deep copy
  // Snapshot the original cocktail for undo
  editOriginalSnapshot = JSON.parse(JSON.stringify(c));
  // Make sure we're on the menu tab before rendering
  const menuBtn = el('st-menu');
  if(menuBtn && !menuBtn.classList.contains('active')) sw('menu', menuBtn);
  rC();
  // Scroll to the editing card
  setTimeout(() => {
    const cardEl = document.getElementById('ci_' + cid);
    if(cardEl) cardEl.scrollIntoView({behavior:'smooth', block:'start'});
  }, 100);
}

let editAutosaveTimer = null;
let editOriginalSnapshot = null; // snapshot for undo

function scheduleEditAutosave(){
  if(!editingCocktailId) return;
  if(editAutosaveTimer) clearTimeout(editAutosaveTimer);
  const status = document.getElementById('saveEditBtn_' + editingCocktailId);
  if(status) status.textContent = 'saving…';
  editAutosaveTimer = setTimeout(() => {
    if(editingCocktailId) {
      saveEditCocktailNow();
      if(status){ status.textContent = '✓ autosaved'; 
        setTimeout(()=>{ if(status) status.textContent = ''; }, 2000); }
    }
  }, 900);
}

function saveEditCocktailNow(){
  if(!editingCocktailId) return;
  saveEditCocktail(editingCocktailId);
}

function undoEditCocktail(){
  if(!editingCocktailId || !editOriginalSnapshot) return;
  const idx = cocktails.findIndex(x => String(x.id) === String(editingCocktailId));
  if(idx === -1) return;
  // Restore original state
  cocktails[idx] = JSON.parse(JSON.stringify(editOriginalSnapshot));
  editIngredients = cocktails[idx].ing.map(i => ({...i}));
  // Re-enter edit mode with restored data
  const cid = editingCocktailId;
  editingCocktailId = cid;
  rC();
  rShop(); rQ(); markUnsaved();
  showToast('Changes undone — restored to original', 'success');
  setTimeout(() => {
    const cardEl = document.getElementById('ci_' + cid);
    if(cardEl) cardEl.scrollIntoView({behavior:'smooth', block:'start'});
  }, 80);
}

function cancelEditCocktail(){
  editingCocktailId = null;
  editIngredients = [];
  rC();
}

function addEditIngredientRow(){
  editIngredients.push({n:'', q:1, u:'oz', c:0});
  const newIdx = editIngredients.length - 1;
  rC();
  setTimeout(() => {
    const inp = document.getElementById('ein_' + newIdx);
    if(inp){
      inp.focus();
      filterEditDD(newIdx, '');
      inp.scrollIntoView({behavior:'smooth', block:'nearest'});
    }
  }, 60);
}

function filterEditDD(idx, query){
  const g = editIngredients[idx];
  if(!g) return;
  // Create or find dropdown — it's inserted right after the input
  let ddEl = document.getElementById('edd_' + idx);
  if(!ddEl) return;
  const q = (query||'').toLowerCase().trim();
  ddEl.innerHTML = '';

  function makeOpt(name, unit, cost, isCustom){
    const div = document.createElement('div');
    div.className = 'ing-option';
    div.dataset.name = name; div.dataset.unit = unit; div.dataset.cost = cost;
    div.addEventListener('mousedown', function(e){
      e.preventDefault(); // prevent blur on the input before we capture the value
      editIngredients[idx].n = name;
      editIngredients[idx].u = unit;
      editIngredients[idx].c = parseFloat(cost) || 0;
      const inp = document.getElementById('ein_' + idx);
      const costInp = document.getElementById('eic_' + idx);
      if(inp){ inp.value = name; }
      if(costInp){ costInp.value = parseFloat(cost).toFixed(4); }
      ddEl.classList.remove('open');
      scheduleEditAutosave();
    });
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ing-option-name';
    nameSpan.textContent = name;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'ing-option-meta';
    metaSpan.textContent = unit + ' · $' + Number(cost||0).toFixed(2) + (isCustom?' ⭐':'');
    if(isCustom) metaSpan.style.color = '#1a7a4a';
    div.appendChild(nameSpan); div.appendChild(metaSpan);
    return div;
  }

  let count = 0;
  const customs = INGFLAT.filter(i => i._custom && (!q || i.name.toLowerCase().includes(q)));
  if(customs.length){
    const lbl = document.createElement('div');
    lbl.className = 'ing-group-label'; lbl.style.color = '#1a7a4a';
    lbl.textContent = '⭐ My ingredients';
    ddEl.appendChild(lbl);
    customs.forEach(item => { ddEl.appendChild(makeOpt(item.name, item.unit, item.c, true)); count++; });
  }
  Object.entries(INGDB).forEach(([cat, items]) => {
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice(0,8);
    if(!filtered.length) return;
    const lbl = document.createElement('div');
    lbl.className = 'ing-group-label'; lbl.textContent = cat;
    ddEl.appendChild(lbl);
    filtered.forEach(item => { ddEl.appendChild(makeOpt(item.name, item.unit, item.c, false)); count++; });
  });
  if(!count){
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 12px;font-size:13px;color:#aaa;';
    empty.textContent = 'No match — type freely';
    ddEl.appendChild(empty);
  }
  ddEl.classList.add('open');
  setTimeout(() => document.addEventListener('click', ()=>ddEl.classList.remove('open'), {once:true}), 10);
}

function navEditDD(event, idx){
  const ddEl = document.getElementById('edd_' + idx);
  if(!ddEl || !ddEl.classList.contains('open')) return;
  const opts = ddEl.querySelectorAll('.ing-option');
  const active = ddEl.querySelector('.ing-option.active');
  const activeIdx = active ? Array.from(opts).indexOf(active) : -1;
  if(event.key === 'ArrowDown'){
    event.preventDefault();
    const next = opts[Math.min(activeIdx + 1, opts.length - 1)];
    if(active) active.classList.remove('active');
    if(next){ next.classList.add('active'); next.scrollIntoView({block:'nearest'}); }
  } else if(event.key === 'ArrowUp'){
    event.preventDefault();
    const prev = opts[Math.max(activeIdx - 1, 0)];
    if(active) active.classList.remove('active');
    if(prev){ prev.classList.add('active'); prev.scrollIntoView({block:'nearest'}); }
  } else if(event.key === 'Enter' && active){
    event.preventDefault();
    active.dispatchEvent(new MouseEvent('mousedown'));
  } else if(event.key === 'Escape'){
    ddEl.classList.remove('open');
  }
}

function toggleEditBottleCalc(btn, idx){
  const wrap = document.getElementById('ebcalc_' + idx);
  if(!wrap) return;
  const open = wrap.style.display !== 'none';
  wrap.style.display = open ? 'none' : 'block';
}

function calcEditBottlePrice(idx){
  const price = parseFloat((document.getElementById('ebprice_'+idx)||{}).value)||0;
  const size  = parseFloat((document.getElementById('ebsize_' +idx)||{}).value)||750;
  const unit  = (document.getElementById('ebunit_' +idx)||{}).value||'ml';
  if(!price || !size) return;
  let ozPerUnit;
  if(unit==='ml') ozPerUnit = size/29.5735;
  else if(unit==='L') ozPerUnit = size*33.814;
  else ozPerUnit = size;
  const perOz = price/ozPerUnit;
  const resultEl = document.getElementById('ebresult_'+idx);
  if(resultEl) resultEl.textContent = '$'+perOz.toFixed(4)+'/oz  ←  tap to apply';
  // Auto-apply
  editIngredients[idx].c = perOz;
  const costInp = document.getElementById('eic_'+idx);
  if(costInp) costInp.value = perOz.toFixed(4);
  scheduleEditAutosave();
}

function showEditLibraryPrices(idx, event){
  if(event) event.stopPropagation();
  document.querySelectorAll('[id^="elpricelib_"]').forEach(el2 => {
    if(el2.id !== 'elpricelib_' + idx) el2.style.display = 'none';
  });
  const popEl = document.getElementById('elpricelib_' + idx);
  if(!popEl) return;
  if(popEl.style.display !== 'none'){ popEl.style.display = 'none'; return; }

  const ing = editIngredients[idx];
  if(!ing || !ing.n.trim()){
    popEl.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px;">Add name first.</div>';
    popEl.style.display = 'block';
    return;
  }
  const k = ing.n.toLowerCase().trim();
  const libPrices = retailerPrices[k] || {};
  const histPrices = priceHistory[k] || [];
  const regularReceipts = histPrices.filter(p => p.source === 'receipt' && !p.isPromo);
  const promoReceipts   = histPrices.filter(p => p.source === 'receipt' && p.isPromo);

  const byStore = {};
  regularReceipts.forEach(p => {
    const s = p.store||'Unknown';
    if(!byStore[s]) byStore[s] = {prices:[], source:'receipt', date:p.date};
    byStore[s].prices.push(p.price);
  });
  Object.entries(libPrices).forEach(([store, entry]) => {
    if(!byStore[store]) byStore[store] = {prices:[entry.price], source:entry.source||'lookup', date:entry.date};
  });

  let html = '<div style="font-size:11px;font-weight:700;color:#aaa;text-transform:uppercase;margin-bottom:8px;">' + ing.n + '</div>';

  if(!Object.keys(byStore).length && !promoReceipts.length){
    html += '<div style="font-size:12px;color:#aaa;">No prices yet. Scan a receipt or tap 🔍.</div>';
  } else {
    if(Object.keys(byStore).length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#1a7a4a;margin-bottom:5px;">Regular prices</div>';
      Object.entries(byStore).forEach(([store, data]) => {
        const avg = data.prices.reduce((s,p)=>s+p,0) / data.prices.length;
        const isReceipt = data.source === 'receipt';
        html += '<div onclick="applyEditLibraryPrice('+idx+','+avg.toFixed(4)+')"'
          + ' style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:8px;cursor:pointer;margin-bottom:3px;border:1px solid '+(isReceipt?'#c8e6d4':'#e5e5e0')+';background:'+(isReceipt?'#edfaf3':'#fafaf7')+';">'
          + '<div><div style="font-weight:600;font-size:13px;">' + store + '</div>'
          +      '<div style="font-size:10px;color:#888;">'+(isReceipt?'🧾 ':'🔍 ')+data.prices.length+(isReceipt?' receipt'+(data.prices.length>1?'s':''):' lookup')+'</div></div>'
          + '<div style="font-weight:700;font-size:14px;color:'+(isReceipt?'#1a7a4a':'#555')+';">$'+avg.toFixed(4)+'<span style="font-size:10px;color:#aaa;">/oz</span></div>'
          + '</div>';
      });
      if(regularReceipts.length > 1){
        const avg = regularReceipts.reduce((s,p)=>s+p.price,0)/regularReceipts.length;
        html += '<div onclick="applyEditLibraryPrice('+idx+','+avg.toFixed(4)+')"'
          + ' style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;cursor:pointer;background:#1a1a1a;margin-bottom:3px;">'
          + '<div style="font-size:12px;font-weight:600;color:#fff;">Avg all receipts ('+regularReceipts.length+')</div>'
          + '<div style="font-weight:700;font-size:14px;color:#7dd3b0;">$'+avg.toFixed(4)+'/oz</div></div>';
      }
    }
    if(promoReceipts.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#d97706;margin:8px 0 5px;">🏷 Promo <span style="font-weight:400;color:#aaa;">(not in avg)</span></div>';
      const promoAvg = promoReceipts[0].price;
      html += '<div onclick="applyEditLibraryPrice('+idx+','+promoAvg.toFixed(4)+')"'
        + ' style="display:flex;justify-content:space-between;padding:7px 10px;border-radius:8px;cursor:pointer;border:1px solid #fde68a;background:#fffbeb;">'
        + '<div style="font-weight:600;font-size:13px;">' + (promoReceipts[0].store||'Unknown') + '</div>'
        + '<div style="font-weight:700;font-size:14px;color:#d97706;">$'+promoAvg.toFixed(4)+'/oz</div></div>';
    }
  }
  html += '<div onclick="var p=document.getElementById(\x27elpricelib_\x27+'+idx+');if(p)p.style.display=\x27none\x27" style="text-align:center;padding:6px 0 2px;font-size:11px;color:#aaa;cursor:pointer;">Close</div>';
  popEl.innerHTML = html;
  popEl.style.display = 'block';
  setTimeout(()=>{
    document.addEventListener('click', function closeELP(e){
      if(!popEl.contains(e.target)){ popEl.style.display='none'; document.removeEventListener('click',closeELP); }
    });
  },50);
}

function applyEditLibraryPrice(idx, price){
  editIngredients[idx].c = price;
  const costInp = document.getElementById('eic_'+idx);
  if(costInp) costInp.value = price.toFixed(4);
  document.querySelectorAll('[id^="elpricelib_"]').forEach(el2 => el2.style.display='none');
  scheduleEditAutosave();
  showToast('$'+price.toFixed(4)+'/oz applied', 'success');
}

async function lookupEditIngPrice(idx){
  const g = editIngredients[idx];
  if(!g || !g.n.trim()){ showToast('Enter an ingredient name first', 'error'); return; }
  const btn = document.querySelector('#eir_' + idx + ' .lookup-btn');
  const inp = document.getElementById('eic_' + idx);
  if(btn){ btn.classList.add('loading'); btn.textContent='...'; btn.disabled=true; }
  try {
    const cacheKey = g.n.toLowerCase().trim() + '|' + (g.u||'oz');
    let price, source;
    if(priceCache[cacheKey] && priceCache[cacheKey].price){
      price = priceCache[cacheKey].price;
      source = priceCache[cacheKey].source;
    } else {
      const result = await lookupPrice(g.n, g.u||'oz');
      price = parseFloat(result.price_per_unit);
      source = result.source || '';
      if(!isNaN(price) && price > 0){
        priceCache[cacheKey] = {price, source, confidence: result.confidence||'medium', dateChecked: new Date().toISOString().split('T')[0]};
        recordPrice(g.n, price, g.u||'oz', source||'Live lookup', 'lookup');
      }
    }
    if(!isNaN(price) && price > 0){
      editIngredients[idx].c = price;
      if(inp){ inp.value = price.toFixed(4); }
      if(btn){ btn.classList.remove('loading'); btn.disabled=false; btn.classList.add('done'); btn.textContent='✓'; setTimeout(()=>{btn.classList.remove('done');btn.textContent='🔍';},2500); }
      showToast('Price updated: $' + price.toFixed(2) + '/oz' + (source?' · '+source:''), 'success');
      scheduleEditAutosave();
    } else {
      throw new Error('No price found');
    }
  } catch(e){
    if(btn){ btn.classList.remove('loading'); btn.disabled=false; btn.textContent='🔍'; }
    if(e.message === '__OPEN_SEARCH__') {
      const ci = editIngredients[idx];
      if(ci && ci.n) openRetailerSearch(ci.n);
      return;
    }
    // Show specific error message
    const errMsg = e.message && e.message.includes('401') ? 'API auth error — use the tool inside Claude.ai' :
                   e.message && e.message.includes('Failed to fetch') ? 'Price lookup requires Claude.ai — tap 🔍 to look up manually' :
                   'Price not found — enter manually';
    showToast(errMsg, 'error');
  }
}
function saveEditCocktail(cid){
  const idx = cocktails.findIndex(x => String(x.id) === String(cid));
  if(idx === -1) return;
  const nameEl = document.getElementById('editName_' + cid);
  const dpgEl  = document.getElementById('editDpg_'  + cid);
  const catEl  = document.getElementById('editCat_'  + cid);
  const name = nameEl ? nameEl.value.trim() : cocktails[idx].name;
  if(!name){ alert('Please enter a cocktail name.'); return; }
  // Fallback: if editIngredients is empty but cocktail has ingredients, restore them
  if(!editIngredients.length && cocktails[idx] && cocktails[idx].ing && cocktails[idx].ing.length){
    editIngredients = cocktails[idx].ing.map(i => ({...i}));
  }
  if(!editIngredients.length){ showToast('Add at least one ingredient first', 'error'); return; }
  const _savedCat = catEl ? catEl.value : cocktails[idx].cat;
  cocktails[idx] = {
    ...cocktails[idx],
    name,
    dpg: parseFloat(dpgEl ? dpgEl.value : cocktails[idx].dpg) || 1,
    cat: _savedCat,
    hisHers: _savedCat === 'His & Hers',
    ing: editIngredients.map(i => ({...i}))
  };
  // Keep edit mode open on the same cocktail — user stays in edit window
  const savedId = cocktails[idx].id;
  editIngredients = cocktails[idx].ing.map(i => ({...i}));
  rC(); // re-renders with edit still open
  rShop();
  rQ();
  markUnsaved();
  showToast(name + ' saved ✓', 'success');
}

// ── SAVE ALL TO LIBRARY WITH DUPLICATE CHECK ──────────────
let dupPendingCocktails = []; // cocktails waiting for user decision
let dupResolutions = {};      // { cocktailId: 'overwrite'|'skip'|'saveas' }

function saveAllToLibraryWithCheck(){
  if(!cocktails.length){ alert('No cocktails in the menu yet.'); return; }

  // Find exact and fuzzy duplicates
  const duplicates = [];
  const clean = [];

  cocktails.forEach(c => {
    const exactMatch = recipeLibrary.find(r =>
      r.name.toLowerCase() === c.name.toLowerCase()
    );
    // Fuzzy: check if any library recipe name contains ≥60% of the words
    const fuzzyMatch = !exactMatch && recipeLibrary.find(r => {
      const libWords = r.name.toLowerCase().split(/\s+/);
      const newWords = c.name.toLowerCase().split(/\s+/);
      const common = newWords.filter(w => libWords.some(lw => lw.includes(w) || w.includes(lw)));
      return common.length >= Math.min(libWords.length, newWords.length) * 0.6 && common.length >= 2;
    });

    if(exactMatch || fuzzyMatch){
      duplicates.push({cocktail: c, existing: exactMatch || fuzzyMatch, isExact: !!exactMatch});
    } else {
      clean.push(c);
    }
  });

  if(!duplicates.length){
    // No duplicates — save everything directly
    _saveAllClean(cocktails);
    return;
  }

  // Show duplicate modal
  dupPendingCocktails = duplicates;
  dupResolutions = {};

  const listHTML = duplicates.map(d => {
    const costNew = d.cocktail.ing.reduce((s,i)=>s+i.c*i.q,0);
    const costOld = d.existing.costPerDrink || d.existing.ing.reduce((s,i)=>s+i.c*i.q,0);
    return `<div class="dup-item" id="dupitem_${d.cocktail.id}">
      <div style="flex:1;">
        <div class="dup-item-name">${d.cocktail.name}
          ${d.isExact
            ? '<span style="font-size:10px;background:#fde8f5;color:#a0206e;padding:2px 6px;border-radius:10px;margin-left:5px;font-weight:500;">exact match</span>'
            : '<span style="font-size:10px;background:#fdf5e8;color:#a06020;padding:2px 6px;border-radius:10px;margin-left:5px;font-weight:500;">similar name</span>'}
        </div>
        <div class="dup-item-meta">
          New: $${costNew.toFixed(2)}/drink · ${d.cocktail.ing.length} ingredients
          &nbsp;·&nbsp;
          Library has: "${d.existing.name}" — $${costOld.toFixed(2)}/drink · saved ${d.existing.savedAt ? new Date(d.existing.savedAt).toLocaleDateString('en-CA') : 'earlier'}
        </div>
      </div>
      <div class="dup-item-action">
        <button class="btn btn-sm" id="dupskip_${d.cocktail.id}"
          onclick="setDupResolution('${d.cocktail.id}','skip',this)">Skip</button>
        <button class="btn btn-sm btn-primary" id="dupover_${d.cocktail.id}"
          onclick="setDupResolution('${d.cocktail.id}','overwrite',this)">Overwrite</button>
      </div>
    </div>`;
  }).join('');

  shtml('dupList', `
    <div style="font-size:12px;color:#aaa;margin-bottom:10px;">
      ${clean.length} new · ${duplicates.length} need your decision
    </div>
    ${listHTML}
    <div style="font-size:12px;color:#888;margin-top:8px;padding:8px;background:#f9f9f6;border-radius:6px;">
      💡 <strong>Overwrite</strong> replaces the old version. <strong>Skip</strong> keeps the library version unchanged.
    </div>`);

  document.getElementById('dupModalBg').classList.add('open');
}

function setDupResolution(id, action, btn){
  dupResolutions[id] = action;
  // Visual feedback — highlight chosen button
  const skipBtn = document.getElementById('dupskip_' + id);
  const overBtn = document.getElementById('dupover_' + id);
  if(skipBtn) skipBtn.style.background = action === 'skip' ? '#f0f0eb' : '';
  if(overBtn){ overBtn.style.background = action === 'overwrite' ? '#1a1a1a' : ''; overBtn.style.color = action === 'overwrite' ? '#fff' : ''; }
}

function closeDupModal(){
  document.getElementById('dupModalBg').classList.remove('open');
  dupPendingCocktails = [];
  dupResolutions = {};
}

function dupSkipAll(){
  // Save only the non-duplicate cocktails
  const nonDups = cocktails.filter(c =>
    !dupPendingCocktails.some(d => d.cocktail.id === c.id)
  );
  closeDupModal();
  _saveAllClean(nonDups);
}

function dupProceedAll(){
  // Apply all resolutions — default unset ones to 'overwrite'
  dupPendingCocktails.forEach(d => {
    if(!dupResolutions[d.cocktail.id]) dupResolutions[d.cocktail.id] = 'overwrite';
  });
  // Build final list
  const toSave = [
    ...cocktails.filter(c => !dupPendingCocktails.some(d => d.cocktail.id === c.id)), // clean ones
    ...dupPendingCocktails.filter(d => dupResolutions[d.cocktail.id] !== 'skip').map(d => d.cocktail) // resolved dups
  ];
  const skipCount = dupPendingCocktails.filter(d => dupResolutions[d.cocktail.id] === 'skip').length;
  closeDupModal();
  _saveAllClean(toSave, skipCount);
}

function _saveAllClean(cocktailsToSave, skipCount){
  if(!cocktailsToSave.length){
    showToast('No new cocktails to save — all were skipped', 'success');
    return;
  }
  let added = 0, updated = 0;
  const eventLabel = v('eventLabel') || 'Unnamed event';
  cocktailsToSave.forEach(c2 => {
    const existing = recipeLibrary.find(r => r.name.toLowerCase() === c2.name.toLowerCase());
    const ing = c2.ing.map(i => {
      const flat = INGFLAT.find(f => f.name.toLowerCase() === i.n.toLowerCase());
      return { n:i.n, q:i.q, u:i.u, c: flat ? flat.c : i.c, priceSource: flat ? (flat._custom?'custom_db':'builtin') : 'manual' };
    });
    const recipe = {
      id: existing ? existing.id : 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      name: c2.name, category: c2.cat, dpg: c2.dpg, ing,
      savedAt: new Date().toISOString(), eventLabel,
      costPerDrink: ing.reduce((s,i) => s+i.c*i.q, 0)
    };
    if(existing){ Object.assign(existing, recipe); updated++; }
    else { recipeLibrary.push(recipe); added++; }
  });
  saveRecipeLibraryStore();
  renderRecipeLibrary();
  const msg = [
    added > 0 ? added + ' recipe' + (added!==1?'s':'') + ' saved' : '',
    updated > 0 ? updated + ' updated' : '',
    skipCount > 0 ? skipCount + ' skipped' : ''
  ].filter(Boolean).join(' · ');
  showToast('📚 ' + msg, 'success');
  renderMyLibrarySection();

  // Flash the Save all button
  const btn = el('saveAllBtn');
  if(btn){ const o=btn.innerHTML; btn.innerHTML='✓ Saved!'; btn.style.background='#1a7a4a'; btn.style.color='#fff'; setTimeout(()=>{btn.innerHTML=o;btn.style.background='';btn.style.color='';},2000); }
}

// ═══════════════════════════════════════════════════════════
let activeDD = null; // currently open dropdown index

function buildDropdown(idx) {
  const g = nIng[idx];
  const ddId = `dd_${g.id}`;
  const inputId = `lname_${g.id}`;
  return `
    <div class="ing-wrap">
      <input type="text" id="${inputId}" class="ing-input" value="${g.n}"
        placeholder="Type or pick ingredient..."
        autocomplete="off"
        oninput="filterDD(${idx}, this.value)"
        onfocus="openDD(${idx})"
        onkeydown="navDD(event, ${idx})"
      >
      <div class="ing-dropdown" id="${ddId}"></div>
    </div>`;
}

function openDD(idx) {
  filterDD(idx, v(`lname_${nIng[idx].id}`));
}

function filterDD(idx, query) {
  const g = nIng[idx];
  const ddEl = document.getElementById(`dd_${g.id}`);
  if (!ddEl) return;
  const q = query.toLowerCase().trim();
  let html = '';
  let count = 0;

  // Show custom ingredients first (from My ingredients database)
  const customItems = INGFLAT.filter(i => i._custom && (!q || i.name.toLowerCase().includes(q)));
  if (customItems.length) {
    html += '<div class="ing-group-label" style="color:#1a7a4a;">⭐ My ingredients</div>';
    customItems.forEach(item => {
      const hi = q ? item.name.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi'), '<strong>$1</strong>') : item.name;
      html += '<div class="ing-option" data-idx="' + count + '" data-name="' + item.name.replace(/"/g,'&quot;') + '" data-unit="' + item.unit + '" data-cost="' + item.c + '" onmousedown="pickIngEl(event,' + idx + ')">'
        + '<span class="ing-option-name">' + hi + '</span>'
        + '<span class="ing-option-meta" style="color:#1a7a4a;">' + item.unit + ' · $' + item.c.toFixed(4) + ' ⭐</span>'
        + '</div>';
      count++;
    });
  }

  // Then built-in database
  Object.entries(INGDB).forEach(([cat, items]) => {
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items;
    if (!filtered.length) return;
    html += '<div class="ing-group-label">' + cat + '</div>';
    filtered.forEach(item => {
      const hi = q ? item.name.replace(new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi'), '<strong>$1</strong>') : item.name;
      html += '<div class="ing-option" data-idx="' + count + '" data-name="' + item.name.replace(/"/g,'&quot;') + '" data-unit="' + item.unit + '" data-cost="' + item.c + '" onmousedown="pickIngEl(event,' + idx + ')">'
        + '<span class="ing-option-name">' + hi + '</span>'
        + '<span class="ing-option-meta">' + item.unit + ' · $' + item.c.toFixed(2) + '</span>'
        + '</div>';
      count++;
    });
  });

  if (count === 0) {
    // Store name in window map to avoid any quote issues in onclick
    if(!window._ddAddMap) window._ddAddMap = {};
    const addKey = 'add_' + idx + '_' + Date.now();
    window._ddAddMap[addKey] = {name: q||'', idx: idx};
    html = '<div class="ing-option" style="color:#2156b8;font-weight:500;"'
      + ' data-key="' + addKey + '"'
      + ' onclick="var d=window._ddAddMap[this.dataset.key];openQuickIngModalWithName(d.name,d.idx)">'
      + '<span>⭐ Add <strong>' + (q||'custom ingredient') + '</strong> to My ingredients</span>'
      + '</div>';
  }

  ddEl.innerHTML = html;
  ddEl.classList.add('open');
  activeDD = idx;

  setTimeout(() => {
    document.addEventListener('click', closeAllDD, {once: true});
  }, 10);
}

function closeAllDD() {
  document.querySelectorAll('.ing-dropdown').forEach(d => d.classList.remove('open'));
  activeDD = null;
}

function navDD(e, idx) {
  const ddEl = document.getElementById(`dd_${nIng[idx].id}`);
  if (!ddEl || !ddEl.classList.contains('open')) return;
  const opts = ddEl.querySelectorAll('.ing-option');
  const cur = ddEl.querySelector('.ing-option.active');
  let curIdx = cur ? parseInt(cur.dataset.idx) : -1;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    curIdx = Math.min(curIdx + 1, opts.length - 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    curIdx = Math.max(curIdx - 1, 0);
  } else if (e.key === 'Enter' && cur) {
    e.preventDefault();
    cur.dispatchEvent(new Event('mousedown'));
    return;
  } else if (e.key === 'Escape') {
    closeAllDD();
    return;
  } else { return; }
  opts.forEach(o => o.classList.remove('active'));
  if (opts[curIdx]) { opts[curIdx].classList.add('active'); opts[curIdx].scrollIntoView({block:'nearest'}); }
}

function pickIngEl(e, idx) {
  const el = e.currentTarget;
  const name = el.dataset.name;
  const unit = el.dataset.unit;
  const cost = parseFloat(el.dataset.cost) || 0;
  pickIng(idx, name, unit, cost);
}
function saveCocktailToLibrary(cid, asVariation){
  const c2 = cocktails.find(function(x){ return x.id === cid; });
  if(!c2) return;
  const existing = recipeLibrary.find(function(r){ return r.name.toLowerCase() === c2.name.toLowerCase(); });
  if(existing && !asVariation){
    if(!confirm('"' + c2.name + '" is already in your library.\nSave as a variation (keeps original)?')) return;
    asVariation = true;
  }
  const recipeName = (asVariation && existing)
    ? c2.name + ' (v. ' + new Date().toLocaleDateString('fr-CA',{month:'short',year:'2-digit'}) + ')'
    : c2.name;
  recipeLibrary.unshift({
    id: 'rl_' + Date.now(),
    name: recipeName,
    category: c2.cat||'Signature', cat: c2.cat||'Signature',
    dpg: c2.dpg||1,
    ing: (c2.ing||[]).map(function(i){ return Object.assign({},i); }),
    costPerDrink: (c2.ing||[]).reduce(function(s,i){ return s+(i.c||0)*(i.q||0); },0),
    notes: c2.notes||'', savedAt: new Date().toISOString(), flavorTags: c2.flavorTags||[]
  });
  saveRecipeLibraryStore();
  showToast('"' + recipeName + '" saved to library', 'success');
  renderMyLibrarySection();
}

function saveAllCocktailsToLibrary(){
  if(!cocktails.length){ showToast('No cocktails in menu yet','error'); return; }
  let saved = 0;
  cocktails.forEach(function(c2){
    const exists = recipeLibrary.some(function(r){ return r.name.toLowerCase()===c2.name.toLowerCase(); });
    if(!exists){
      recipeLibrary.unshift({
        id:'rl_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
        name:c2.name, category:c2.cat||'Signature', cat:c2.cat||'Signature',
        dpg:c2.dpg||1, ing:(c2.ing||[]).map(function(i){ return Object.assign({},i); }),
        costPerDrink:(c2.ing||[]).reduce(function(s,i){ return s+(i.c||0)*(i.q||0); },0),
        savedAt:new Date().toISOString(), flavorTags:[]
      });
      saved++;
    }
  });
  if(saved){ saveRecipeLibraryStore(); showToast(saved+' cocktail'+(saved>1?'s':'')+' added to library','success'); renderMyLibrarySection(); }
  else showToast('All cocktails already in library','success');
}
function pickIng(idx, name, unit, cost) {
  nIng[idx].n = name;
  nIng[idx].u = unit;
  nIng[idx].c = cost;
  closeAllDD();
  rNI();
  markUnsaved();
  // Auto-price if cost is zero or missing — silent background lookup
  if((!cost || cost <= 0) && name.trim()){
    setTimeout(() => autoLookupIngPrice(idx), 100);
  }
}

async function autoLookupIngPrice(idx){
  const ing = nIng[idx];
  if(!ing || !ing.n.trim()) return;
  const cacheKey = ing.n.toLowerCase().trim() + '|' + (ing.u||'oz');
  // Check cache first
  if(priceCache[cacheKey] && priceCache[cacheKey].price > 0){
    nIng[idx].c = priceCache[cacheKey].price;
    const inp = document.getElementById('lcost_' + ing.id);
    if(inp) inp.value = priceCache[cacheKey].price.toFixed(2);
    rNI();
    return;
  }
  // Silent API lookup — show a subtle indicator
  const srcEl = document.getElementById('lsrc_' + ing.id);
  if(srcEl){ srcEl.className='price-source'; srcEl.textContent='⏳ auto-pricing…'; }
  try {
    const result = await lookupPrice(ing.n, ing.u||'oz');
    const price = parseFloat(result.price_per_unit);
    if(!isNaN(price) && price > 0){
      priceCache[cacheKey] = {price, source: result.source||'', confidence: result.confidence||'medium'};
      nIng[idx].c = price;
      recordPrice(ing.n, price, ing.u||'oz', (result.source||'auto').split(' ')[0], 'lookup');
      // Also record in retailer price library
      const srcStore = (result.best_store || result.source || '').split(' ')[0];
      if(srcStore) recordRetailerPrice(ing.n, srcStore, price, ing.u||'oz', 'lookup');
      const inp = document.getElementById('lcost_' + ing.id);
      if(inp) inp.value = price.toFixed(2);
      if(srcEl){ srcEl.textContent = '✓ ' + (result.source||'Auto-priced') + ' · $' + price.toFixed(2) + '/oz'; }
      rNI(); markUnsaved();
    }
  } catch(e){
    if(srcEl) srcEl.textContent = ''; // silent fail — user can hit 🔍 manually
  }
}

