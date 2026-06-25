// ═══ RECIPE LIBRARY ═══
// recipeLibrary CRUD, search, import/export, flavor tags,
// variation modal, My Library quick-add section

let recipeLibrary = [];

function loadRecipeLibrary(){
  try {
    const stored = localStorage.getItem('bartender_recipes_v1');
    recipeLibrary = stored ? JSON.parse(stored) : [];
  } catch(e){ recipeLibrary = []; }

  // Only seed the 22 built-in classics on FIRST EVER load
  // Once the user has customised the library (deleted/edited), never auto-restore
  const hasCustomised = localStorage.getItem('bartender_recipes_customised');
  if(!hasCustomised && recipeLibrary.length === 0){
    seedDefaultRecipes();
  }
}

function seedDefaultRecipes(){
  const existingNames = new Set(recipeLibrary.map(r => r.name.toLowerCase()));
  LIB.forEach((r, idx) => {
    if(!existingNames.has(r.name.toLowerCase())){
      recipeLibrary.push({
        id: 'lib_' + idx + '_' + r.name.toLowerCase().replace(/[^a-z0-9]/g,'_'),
        name: r.name,
        category: r.cat || 'Classic',
        dpg: r.dpg || 1,
        ing: (r.ing||[]).map(i => ({n:i.n, q:i.q, u:i.u, c:i.c||0})),
        costPerDrink: (r.ing||[]).reduce((s,i) => s+(i.c||0)*(i.q||0), 0),
        notes: r.notes || '',
        savedAt: new Date().toISOString(),
        autoSaved: false,
        flavorTags: r.flavorTags || [],
        parentId: null
      });
    }
  });
  saveRecipeLibraryStore();
}

function saveRecipeLibraryStore(){
  try { localStorage.setItem('bartender_recipes_v1', JSON.stringify(recipeLibrary)); }
  catch(e){ console.error('Could not save recipe library:', e); }
}

function saveCurrentMenuToLibrary(){
  if(!cocktails.length){ alert('Add cocktails to the menu first.'); return; }
  let added = 0, updated = 0;
  cocktails.forEach(c2 => {
    const existing = recipeLibrary.find(r => r.name.toLowerCase() === c2.name.toLowerCase());
    // Use real prices from INGFLAT where available
    const ing = c2.ing.map(i => {
      const flat = INGFLAT.find(f => f.name.toLowerCase() === i.n.toLowerCase());
      return {
        n: i.n, q: i.q, u: i.u,
        c: flat ? flat.c : i.c, // use live price if available
        priceSource: flat ? (flat._custom ? 'custom_db' : 'builtin') : 'manual'
      };
    });
    const recipe = {
      id: existing ? existing.id : 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      name: c2.name,
      category: c2.cat,
      dpg: c2.dpg,
      ing,
      savedAt: new Date().toISOString(),
      eventLabel: v('eventLabel') || 'Unnamed event',
      costPerDrink: ing.reduce((s,i) => s + i.c*i.q, 0)
    };
    if(existing){
      Object.assign(existing, recipe);
      updated++;
    } else {
      recipeLibrary.push(recipe);
      added++;
    }
  });
  saveRecipeLibraryStore();
  renderRecipeLibrary();
  showToast(added + ' recipe' + (added!==1?'s':'') + ' saved' + (updated?' (' + updated + ' updated)':'') + ' to your library', 'success');
}

function autoSaveAllToLibrary(){
  // Silently save all cocktails — called after any menu change
  cocktails.forEach(c2 => {
    if(!c2.name || !c2.ing || !c2.ing.length) return;
    const existing = recipeLibrary.find(r => r.name.toLowerCase() === c2.name.toLowerCase());
    if(existing){
      // Update existing silently
      existing.ing = c2.ing.map(i => ({...i}));
      existing.dpg = c2.dpg;
      existing.updatedAt = new Date().toISOString();
    } else {
      // New recipe — add to library
      const costPerDrink = c2.ing.reduce((s,i) => s + (i.c||0)*(i.q||0), 0);
      recipeLibrary.unshift({
        id: 'auto_' + c2.id,
        name: c2.name,
        category: c2.cat || 'My Recipes',
        dpg: c2.dpg || 1,
        ing: c2.ing.map(i => ({...i})),
        costPerDrink,
        notes: c2.notes || '',
        eventLabel: v('eventLabel') || '',
        savedAt: new Date().toISOString(),
        autoSaved: true,
        flavorTags: c2.flavorTags || [],
        parentId: c2.parentId || null
      });
    }
  });
  saveRecipeLibraryStore();
  renderMyLibrarySection();
}

let _variationCallback = null;
let _variationOriginalName = '';

function checkDuplicateRecipe(name, callback){
  const exact = recipeLibrary.find(r => r.name.toLowerCase() === name.toLowerCase());
  const similar = recipeLibrary.filter(r => {
    const rWords = r.name.toLowerCase().split(' ');
    const nWords = name.toLowerCase().split(' ');
    return rWords.some(w => w.length > 3 && nWords.includes(w));
  });

  if(!exact && !similar.length){
    callback('new', name);
    return;
  }

  // Open the variation modal instead of confirm()
  _variationCallback = callback;
  _variationOriginalName = name;

  const msgEl = document.getElementById('variationModalMsg');
  const nameInp = document.getElementById('variationNameInput');
  if(exact){
    if(msgEl) msgEl.innerHTML = '<strong>"' + name + '"</strong> already exists in your library. Save as a new variation with a different name, or overwrite the existing one.';
  } else {
    const simNames = similar.slice(0,2).map(r=>'<em>'+r.name+'</em>').join(' and ');
    if(msgEl) msgEl.innerHTML = 'Similar recipes found: ' + simNames + '. Save this as a new variation?';
  }
  if(nameInp){
    nameInp.value = name + ' — v2';
    setTimeout(()=>{ nameInp.focus(); nameInp.select(); }, 200);
  }
  document.getElementById('variationModalBg').classList.add('open');

  // Add overwrite button only for exact match
  const btn = document.querySelector('#variationModalBg .btn-primary');
  if(exact && btn){
    btn.parentElement.innerHTML = '<button class="btn btn-sm" onclick="closeVariationModal()" style="flex:1;">Cancel</button>'
      + '<button class="btn btn-sm" onclick="confirmVariationOverwrite()" style="flex:1.5;">↩ Overwrite</button>'
      + '<button class="btn btn-sm btn-primary" onclick="confirmVariationSave()" style="flex:1.5;">+ New variation</button>';
  }
}

function filterToVariations(parentId){
  // Scroll to and highlight all variations of a parent recipe
  const allCards = document.querySelectorAll('[data-rid]');
  // For now, filter the library to show parent + variations
  rlSetCatFilter('all', null);
  showToast('Showing all variations', 'success');
}

function closeVariationModal(){
  document.getElementById('variationModalBg').classList.remove('open');
  _variationCallback = null;
}

function confirmVariationSave(){
  const name = document.getElementById('variationNameInput').value.trim();
  if(!name){ showToast('Please enter a name', 'error'); return; }
  closeVariationModal();
  if(_variationCallback) _variationCallback('new_version', name);
}

function confirmVariationOverwrite(){
  closeVariationModal();
  if(_variationCallback) _variationCallback('update', _variationOriginalName);
}

function saveOneRecipeToLibrary(cocktailId){
  const c2 = cocktails.find(c => c.id === cocktailId);
  if(!c2) return;
  const existing = recipeLibrary.find(r => r.name.toLowerCase() === c2.name.toLowerCase());
  const ing = c2.ing.map(i => {
    const flat = INGFLAT.find(f => f.name.toLowerCase() === i.n.toLowerCase());
    return { n:i.n, q:i.q, u:i.u, c: flat?flat.c:i.c, priceSource: flat?(flat._custom?'custom_db':'builtin'):'manual' };
  });
  const recipe = {
    id: existing ? existing.id : 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
    name: c2.name, category: c2.cat, dpg: c2.dpg, ing,
    savedAt: new Date().toISOString(),
    eventLabel: v('eventLabel') || 'Unnamed event',
    costPerDrink: ing.reduce((s,i) => s+i.c*i.q, 0)
  };
  if(existing){ Object.assign(existing, recipe); }
  else { recipeLibrary.push(recipe); }
  saveRecipeLibraryStore();
  renderRecipeLibrary();
  showToast(c2.name + ' saved to recipe library', 'success');
  renderMyLibrarySection();
}

function deleteRecipeFromLibrary(id){
  const recipe = recipeLibrary.find(r => r.id === id);
  if(!recipe) return;
  if(!confirm('Remove "' + recipe.name + '" from your recipe book?')) return;
  recipeLibrary = recipeLibrary.filter(r => r.id !== id);
  localStorage.setItem('bartender_recipes_customised', '1');
  saveRecipeLibraryStore(); renderRecipeLibrary(); renderMyLibrarySection();
  pushUndo('Deleted "' + recipe.name + '" from recipes', () => {
    recipeLibrary.push(recipe);
    saveRecipeLibraryStore(); renderRecipeLibrary(); renderMyLibrarySection();
  });
}

function loadRecipeToMenu(id){
  const r = recipeLibrary.find(rec => rec.id === id);
  if(!r) return;
  const exists = cocktails.find(c => c.name.toLowerCase() === r.name.toLowerCase());
  if(exists && !confirm(r.name + ' is already in your menu. Add it again?')) return;
  cocktails.push({
    id: Date.now(),
    name: r.name,
    cat: r.category,
    dpg: r.dpg,
    ing: r.ing.map(i => ({...i, n:i.n, q:i.q, u:i.u, c:i.c}))
  });
  rC();
  markUnsaved();
  showToast(r.name + ' added to current menu', 'success');
  // Switch to menu tab
  const menuTab = document.querySelector('.tab');
  if(menuTab) { sw('menu', menuTab); menuTab.classList.add('active'); }
}

function detectStalePrices(){
  const stale = [];
  const THRESHOLD = 0.15; // 15% drift triggers warning

  recipeLibrary.forEach(r => {
    if(!r.ing || !r.ing.length) return;
    let staleCount = 0;
    let maxDrift = 0;
    let totalOld = 0;
    let totalNew = 0;

    r.ing.forEach(ing => {
      if(!ing.n || !ing.n.trim() || !ing.c) return;
      const k = ing.n.toLowerCase().trim();

      // Get current best price from DB / receipts
      let freshPrice = null;
      const flat = INGFLAT.find(f => f.name.toLowerCase() === k);
      if(flat && flat.c > 0) freshPrice = flat.c;
      else if(priceHistory[k] && priceHistory[k].length){
        const regs = priceHistory[k].filter(p => !p.isPromo);
        if(regs.length) freshPrice = regs.reduce((s,p)=>s+p.price,0)/regs.length;
      }

      if(freshPrice && ing.c > 0){
        const drift = Math.abs(freshPrice - ing.c) / ing.c;
        if(drift > THRESHOLD){
          staleCount++;
          if(drift > maxDrift) maxDrift = drift;
          totalOld += ing.c * ing.q;
          totalNew += freshPrice * ing.q;
        }
      }
    });

    if(staleCount > 0){
      const oldCost  = r.costPerDrink || 0;
      // Estimate new cost: replace stale ingredients
      const newCost = r.ing.reduce((s, ing) => {
        const k = ing.n.toLowerCase().trim();
        const flat = INGFLAT.find(f => f.name.toLowerCase() === k);
        let fp = null;
        if(flat && flat.c > 0) fp = flat.c;
        else if(priceHistory[k]){
          const regs = priceHistory[k].filter(p=>!p.isPromo);
          if(regs.length) fp = regs.reduce((a,p)=>a+p.price,0)/regs.length;
        }
        return s + (fp && Math.abs(fp - ing.c)/ing.c > THRESHOLD ? fp : ing.c) * ing.q;
      }, 0);

      stale.push({
        id: r.id,
        name: r.name,
        staleCount,
        maxDrift: Math.round(maxDrift * 100),
        oldCost: oldCost.toFixed(2),
        newCost: newCost.toFixed(2),
        costDelta: newCost - oldCost
      });
    }
  });

  return stale;
}

async function refreshAllRecipePrices(){
  const btn = el('refreshAllBtn');
  if(btn){ btn.textContent = '⏳ Refreshing…'; btn.disabled = true; }

  let totalUpdated = 0;
  let recipesUpdated = 0;

  for(let ri = 0; ri < recipeLibrary.length; ri++){
    const r = recipeLibrary[ri];
    if(!r.ing || !r.ing.length) continue;
    let recipeChanged = false;

    for(let ii = 0; ii < r.ing.length; ii++){
      const ing = r.ing[ii];
      if(!ing.n || !ing.n.trim()) continue;

      // 1. Check ingredient database (instant)
      const flat = INGFLAT.find(f => f.name.toLowerCase() === ing.n.toLowerCase());
      if(flat && flat.c > 0 && flat.c !== ing.c){
        r.ing[ii] = {...ing, c: flat.c};
        totalUpdated++;
        recipeChanged = true;
        continue;
      }

      // 2. Check price history (receipts)
      const k = ing.n.toLowerCase().trim();
      if(priceHistory[k] && priceHistory[k].length){
        const regularPrices = priceHistory[k].filter(p => !p.isPromo);
        if(regularPrices.length){
          const avgPrice = regularPrices.reduce((s,p) => s + p.price, 0) / regularPrices.length;
          if(Math.abs(avgPrice - ing.c) > 0.001){
            r.ing[ii] = {...ing, c: parseFloat(avgPrice.toFixed(4))};
            totalUpdated++;
            recipeChanged = true;
          }
        }
      }
    }

    if(recipeChanged){
      r.costPerDrink = r.ing.reduce((s,i) => s + i.c * i.q, 0);
      r.pricesRefreshedAt = new Date().toISOString();
      recipesUpdated++;
    }
  }

  saveRecipeLibraryStore();
  renderRecipeLibrary();
  if(btn){ btn.textContent = '↻ Refresh all prices'; btn.disabled = false; }
  showToast(
    totalUpdated > 0
      ? '✓ ' + totalUpdated + ' price' + (totalUpdated!==1?'s':'') + ' updated across ' + recipesUpdated + ' recipe' + (recipesUpdated!==1?'s':'')
      : 'All prices are already up to date',
    totalUpdated > 0 ? 'success' : undefined
  );
}

async function refreshRecipePrices(id){
  const r = recipeLibrary.find(rec => rec.id === id);
  if(!r || !r.ing || !r.ing.length) return;

  // Find the ↻ button and show loading state
  const btn = document.querySelector('[data-id="' + id + '"][onclick*="refreshRecipePrices"]');
  if(btn){ btn.textContent = '⏳'; btn.disabled = true; }

  let updated = 0;
  const named = r.ing.filter(i => i.n && i.n.trim());

  for(let i = 0; i < r.ing.length; i++){
    const ing = r.ing[i];
    if(!ing.n || !ing.n.trim()) continue;

    // First try INGFLAT (instant, no API call needed if already fresh)
    const flat = INGFLAT.find(f => f.name.toLowerCase() === ing.n.toLowerCase());
    if(flat && flat.c > 0){
      if(flat.c !== ing.c){ r.ing[i] = {...ing, c: flat.c}; updated++; }
      continue;
    }

    // Fall back to live API lookup
    try {
      const cacheKey = ing.n.toLowerCase().trim() + '|' + (ing.u||'oz');
      let price;
      if(priceCache[cacheKey] && priceCache[cacheKey].price){
        price = priceCache[cacheKey].price;
      } else {
        const result = await lookupPrice(ing.n, ing.u||'oz');
        price = parseFloat(result.price_per_unit);
        if(!isNaN(price) && price > 0){
          priceCache[cacheKey] = {price, source: result.source||'', confidence: result.confidence||'medium'};
        }
      }
      if(!isNaN(price) && price > 0 && price !== ing.c){
        r.ing[i] = {...ing, c: price};
        updated++;
      }
    } catch(e){
      // silently skip — ingredient not found in live lookup
    }
    // Small delay between API calls to be respectful
    if(i < r.ing.length - 1) await new Promise(res => setTimeout(res, 300));
  }

  r.costPerDrink = r.ing.reduce((s,i) => s + i.c * i.q, 0);
  r.pricesRefreshedAt = new Date().toISOString();
  saveRecipeLibraryStore();
  renderRecipeLibrary();
  if(btn){ btn.textContent = '↻'; btn.disabled = false; }
  showToast(updated + ' price' + (updated!==1?'s':'') + ' refreshed for ' + r.name, 'success');
}

const FLAVOR_TAGS = ["🍋 Citrusy", "🍹 Tropical", "🌿 Herbal", "🌹 Floral", "🍒 Fruity", "🥃 Smoky", "🌶 Spicy", "🍫 Rich", "🫧 Effervescent", "🧊 Crisp", "🍷 Bold", "🍯 Sweet", "🌊 Briny", "🌰 Nutty", "🫖 Earthy"];

function openFlavorTagPicker(recipeId, anchorEl){
  const r = recipeLibrary.find(x => x.id === String(recipeId));
  if(!r) return;
  if(!r.flavorTags) r.flavorTags = [];

  const existing = document.getElementById('flavorPickerPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'flavorPickerPopup';
  popup.style.cssText = 'position:fixed;z-index:9999;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:12px;box-shadow:0 4px 24px rgba(0,0,0,0.14);max-width:280px;';

  const rect = anchorEl.getBoundingClientRect();
  popup.style.top = (rect.bottom + 6) + 'px';
  popup.style.left = Math.min(rect.left, window.innerWidth - 300) + 'px';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:11px;font-weight:600;text-transform:uppercase;color:#aaa;letter-spacing:.04em;margin-bottom:8px;';
  title.textContent = 'Flavor profile';
  popup.appendChild(title);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';

  FLAVOR_TAGS.forEach(tag => {
    const btn = document.createElement('button');
    const isActive = r.flavorTags.includes(tag);
    btn.style.cssText = 'font-size:11px;padding:3px 9px;border-radius:10px;cursor:pointer;font-family:inherit;border:1px solid ' + (isActive?'#4338ca':'#e5e5e0') + ';background:' + (isActive?'#ede9fe':'transparent') + ';color:' + (isActive?'#4338ca':'#555') + ';';
    btn.textContent = tag;
    btn.onclick = () => {
      toggleFlavorTag(recipeId, tag);
      popup.remove();
    };
    grid.appendChild(btn);
  });
  popup.appendChild(grid);
  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), {once:true}), 50);
}

function toggleFlavorTag(recipeId, tag){
  const r = recipeLibrary.find(x => x.id === String(recipeId));
  if(!r) return;
  if(!r.flavorTags) r.flavorTags = [];
  const idx = r.flavorTags.indexOf(tag);
  if(idx > -1) r.flavorTags.splice(idx, 1);
  else r.flavorTags.push(tag);
  saveRecipeLibraryStore();
  renderRecipeLibrary();
}

function getVariations(parentId){
  return recipeLibrary.filter(r => r.parentId === String(parentId));
}

// ════════════════════════════════════════════════════════════
// RECIPE LIBRARY — BUILD FROM SCRATCH
// ════════════════════════════════════════════════════════════

let myLibActiveCat = 'all';
let myLibActiveQuery = '';
let rlIngredients = []; // working ingredient list for the form
let rlEditingId = null; // null = new recipe, string = editing existing

function openNewRecipeForm(){
  rlIngredients = [{id:'rl'+Date.now(), n:'', q:1, u:'oz', c:0}];
  rlEditingId = null;
  sv('rlName',''); sv('rlDpg','1'); sv('rlCat','Signature'); sv('rlNotes','');
  gc2('recipeFormTitle','+ New recipe');
  renderRLIngList();
  el('recipeBuilderWrap').style.display = 'block';
  setTimeout(()=>{ const n=el('rlName'); if(n) n.focus(); }, 80);
}

function openEditRecipeForm(id){
  // Ensure we're on the Recipe Library tab
  const recipeBtn = el('st-recipelib');
  if(recipeBtn && !recipeBtn.classList.contains('active')) sw('recipelib', recipeBtn);
  const r = recipeLibrary.find(x => x.id === id);
  if(!r) return;
  rlEditingId = id;
  rlIngredients = r.ing.map(i => ({id:'rl'+Date.now()+Math.random().toString(36).slice(2,5), n:i.n, q:i.q, u:i.u, c:i.c}));
  sv('rlName', r.name);
  sv('rlDpg', r.dpg || 1);
  sv('rlCat', r.category || 'Signature');
  sv('rlNotes', r.notes || '');
  gc2('recipeFormTitle', '✎ Edit — ' + r.name);
  renderRLIngList();
  el('recipeBuilderWrap').style.display = 'block';
  el('recipeBuilderWrap').scrollIntoView({behavior:'smooth', block:'start'});
}

function closeRecipeForm(){
  el('recipeBuilderWrap').style.display = 'none';
  rlIngredients = [];
  rlEditingId = null;
}

function rlAddIngRow(preset){
  rlIngredients.push({
    id: 'rl' + Date.now() + Math.random().toString(36).slice(2,5),
    n: preset ? preset.n : '',
    q: preset ? preset.q : 1,
    u: preset ? preset.u : 'oz',
    c: preset ? preset.c : 0
  });
  renderRLIngList();
}

function rlRemoveIng(id){
  rlIngredients = rlIngredients.filter(i => i.id !== id);
  renderRLIngList();
}

function rlUpdateIng(id, field, value){
  const ing = rlIngredients.find(i => i.id === id);
  if(!ing) return;
  ing[field] = ['q','c'].includes(field) ? (parseFloat(value)||0) : value;
  // Auto-fill cost from database when name is picked
  if(field === 'n' && value.trim()){
    const flat = INGFLAT.find(f => f.name.toLowerCase() === value.toLowerCase());
    if(flat){
      ing.u = flat.unit || ing.u;
      ing.c = flat.c || ing.c;
      renderRLIngList();
    }
  }
}

function renderRLIngList(){
  const wrap = el('rlIngList');
  if(!wrap) return;
  if(!rlIngredients.length){
    wrap.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0 8px;">No ingredients yet — click + Add ingredient</div>';
    return;
  }

  // Build rows using DOM to avoid all quote-escaping issues
  const frag = document.createDocumentFragment();

  rlIngredients.forEach((g) => {
    const row = document.createElement('div');
    row.className = 'edit-ing-row';
    row.id = 'rlrow_' + g.id;
    row.style.marginBottom = '6px';

    // Name + dropdown
    const nameWrap = document.createElement('div');
    nameWrap.style.position = 'relative';
    const nameInp = document.createElement('input');
    nameInp.type = 'text';
    nameInp.value = g.n;
    nameInp.placeholder = 'Ingredient name';
    nameInp.id = 'rln_' + g.id;
    nameInp.autocomplete = 'off';
    nameInp.style.width = '100%';
    nameInp.dataset.gid = g.id;
    nameInp.addEventListener('input', function(){ rlUpdateIng(this.dataset.gid,'n',this.value); rlFilterDD(this.dataset.gid,this.value); });
    nameInp.addEventListener('focus', function(){ rlFilterDD(this.dataset.gid,this.value); });
    const dd = document.createElement('div');
    dd.className = 'ing-dropdown';
    dd.id = 'rldd_' + g.id;
    nameWrap.appendChild(nameInp);
    nameWrap.appendChild(dd);

    // Qty
    const qtyInp = document.createElement('input');
    qtyInp.type = 'number';
    qtyInp.value = g.q;
    qtyInp.min = '0'; qtyInp.step = '0.25';
    qtyInp.placeholder = 'Qty';
    qtyInp.style.fontSize = '13px';
    qtyInp.dataset.gid = g.id;
    qtyInp.addEventListener('change', function(){ rlUpdateIng(this.dataset.gid,'q',this.value); });

    // Unit
    const unitInp = document.createElement('input');
    unitInp.type = 'text';
    unitInp.value = g.u;
    unitInp.placeholder = 'oz';
    unitInp.style.fontSize = '13px';
    unitInp.dataset.gid = g.id;
    unitInp.addEventListener('input', function(){ rlUpdateIng(this.dataset.gid,'u',this.value); });

    // Cost + lookup
    const costWrap = document.createElement('div');
    costWrap.style.cssText = 'display:flex;gap:3px;align-items:center;';
    const costInp = document.createElement('input');
    costInp.type = 'number';
    costInp.value = Number(g.c||0).toFixed(4);
    costInp.min = '0'; costInp.step = '0.0001';
    costInp.placeholder = '$/unit';
    costInp.id = 'rlc_' + g.id;
    costInp.style.cssText = 'flex:1;font-size:13px;';
    costInp.dataset.gid = g.id;
    costInp.addEventListener('change', function(){ rlUpdateIng(this.dataset.gid,'c',this.value); renderRLCostLine(); });
    const lookupBtn = document.createElement('button');
    lookupBtn.className = 'lookup-btn';
    lookupBtn.id = 'rllbtn_' + g.id;
    lookupBtn.title = 'Live price lookup';
    lookupBtn.style.cssText = 'height:32px;padding:0 6px;font-size:12px;';
    lookupBtn.textContent = '🔍';
    lookupBtn.dataset.gid = g.id;
    lookupBtn.addEventListener('click', function(){ rlLookupPrice(this.dataset.gid); });
    costWrap.appendChild(costInp);
    costWrap.appendChild(lookupBtn);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-sm btn-danger';
    removeBtn.textContent = '✕';
    removeBtn.dataset.gid = g.id;
    removeBtn.addEventListener('click', function(){ rlRemoveIng(this.dataset.gid); });

    row.appendChild(nameWrap);
    row.appendChild(qtyInp);
    row.appendChild(unitInp);
    row.appendChild(costWrap);
    row.appendChild(removeBtn);
    frag.appendChild(row);
  });

  // Header row via DOM
  const headerDiv = document.createElement('div');
  headerDiv.style.cssText = 'display:grid;grid-template-columns:2fr 0.65fr 0.75fr 0.9fr auto;gap:5px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px;padding:0 2px;';
  headerDiv.innerHTML = '<span>Ingredient</span><span>Qty</span><span>Unit</span><span>CAD$/unit</span><span></span>';

  // Running cost
  const totalCost = rlIngredients.reduce((s,i) => s + i.q * i.c, 0);

  wrap.innerHTML = '';
  wrap.appendChild(headerDiv);
  wrap.appendChild(frag);

  if(totalCost > 0){
    const costDiv = document.createElement('div');
    costDiv.style.cssText = 'font-size:12px;color:#1a7a4a;font-weight:500;margin-top:6px;';
    costDiv.textContent = 'Cost per drink: $' + totalCost.toFixed(4) + ' CAD';
    wrap.appendChild(costDiv);
  }
}

function renderRLCostLine(){
  // Lightweight cost update without full re-render
  const wrap = el('rlIngList');
  if(!wrap) return;
  const totalCost = rlIngredients.reduce((s,i) => s + i.q * i.c, 0);
  let costDiv = wrap.querySelector('.rl-cost-line');
  if(!costDiv && totalCost > 0){
    costDiv = document.createElement('div');
    costDiv.className = 'rl-cost-line';
    costDiv.style.cssText = 'font-size:12px;color:#1a7a4a;font-weight:500;margin-top:6px;';
    wrap.appendChild(costDiv);
  }
  if(costDiv) costDiv.textContent = totalCost > 0 ? 'Cost per drink: $' + totalCost.toFixed(4) + ' CAD' : '';
}

function rlFilterDD(gid, query){
  const ddEl = el('rldd_' + gid);
  if(!ddEl) return;
  const q = (query||'').toLowerCase().trim();
  ddEl.innerHTML = '';

  function makeOption(name, unit, cost, isCustom){
    const div = document.createElement('div');
    div.className = 'ing-option';
    div.dataset.name = name;
    div.dataset.unit = unit;
    div.dataset.cost = cost;
    div.addEventListener('mousedown', function(){ rlPickIng(gid, this); });
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ing-option-name';
    nameSpan.textContent = name;
    const metaSpan = document.createElement('span');
    metaSpan.className = 'ing-option-meta';
    metaSpan.textContent = unit + ' · $' + Number(cost||0).toFixed(2) + (isCustom ? ' ⭐' : '');
    if(isCustom) metaSpan.style.color = '#1a7a4a';
    div.appendChild(nameSpan);
    div.appendChild(metaSpan);
    return div;
  }

  let count = 0;

  // Custom ingredients first
  const customs = INGFLAT.filter(i => i._custom && (!q || i.name.toLowerCase().includes(q)));
  if(customs.length){
    const lbl = document.createElement('div');
    lbl.className = 'ing-group-label';
    lbl.style.color = '#1a7a4a';
    lbl.textContent = '⭐ My ingredients';
    ddEl.appendChild(lbl);
    customs.forEach(item => { ddEl.appendChild(makeOption(item.name, item.unit, item.c, true)); count++; });
  }

  // Built-in database
  Object.entries(INGDB).forEach(([cat, items]) => {
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice(0,6);
    if(!filtered.length) return;
    const lbl = document.createElement('div');
    lbl.className = 'ing-group-label';
    lbl.textContent = cat;
    ddEl.appendChild(lbl);
    filtered.forEach(item => { ddEl.appendChild(makeOption(item.name, item.unit, item.c, false)); count++; });
  });

  if(!count){
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 12px;font-size:13px;color:#aaa;';
    empty.textContent = 'No match — type freely to enter custom';
    ddEl.appendChild(empty);
  }

  ddEl.classList.add('open');
  // Close dropdown when clicking elsewhere (not on the dropdown itself)
  setTimeout(() => {
    function closeDD(e){
      if(!ddEl.contains(e.target)) ddEl.classList.remove('open');
    }
    document.addEventListener('mousedown', closeDD, {once:true});
  }, 50);
}
function rlPickIng(gid, optEl){
  const name = optEl.dataset.name;
  const unit = optEl.dataset.unit;
  const cost = parseFloat(optEl.dataset.cost) || 0;
  const ing = rlIngredients.find(i => i.id === gid);
  if(!ing) return;
  ing.n = name; ing.u = unit; ing.c = cost;
  el('rldd_'+gid).classList.remove('open');
  renderRLIngList();
}

async function rlLookupPrice(gid){
  const ing = rlIngredients.find(i => i.id === gid);
  if(!ing || !ing.n.trim()) return;
  const btn = el('rllbtn_' + gid);
  if(btn){ btn.classList.add('loading'); btn.textContent='...'; }
  try {
    const cacheKey = ing.n.toLowerCase().trim() + '|' + (ing.u||'oz');
    let price;
    if(priceCache[cacheKey]){ price = priceCache[cacheKey].price; }
    else {
      const result = await lookupPrice(ing.n, ing.u||'oz');
      price = parseFloat(result.price_per_unit);
      if(!isNaN(price) && price > 0){
        priceCache[cacheKey] = {price, source:result.source||'', confidence:result.confidence||'medium', dateChecked:new Date().toISOString().split('T')[0]};
        recordPrice(ing.n, price, ing.u||'oz', result.source||'Live lookup', 'lookup');
      }
    }
    if(!isNaN(price) && price > 0){
      ing.c = price;
      const inp = el('rlc_' + gid);
      if(inp) inp.value = price.toFixed(4);
      renderRLIngList();
      if(btn){ btn.classList.remove('loading'); btn.classList.add('done'); btn.textContent='✓'; setTimeout(()=>{btn.classList.remove('done');btn.textContent='🔍';},2500); }
    } else throw new Error('bad price');
  } catch(e) {
    if(btn){ btn.classList.remove('loading'); btn.textContent='🔍'; }
  }
}

function saveRecipeFromForm(){
  const name = v('rlName').trim();
  if(!name){ alert('Enter a cocktail name.'); return; }
  if(!rlIngredients.length || !rlIngredients.some(i => i.n.trim())){
    alert('Add at least one ingredient.'); return;
  }

  const cleanIng = rlIngredients
    .filter(i => i.n.trim())
    .map(i => ({
      n: i.n, q: i.q || 1, u: i.u || 'oz', c: i.c || 0,
      priceSource: (() => { const fl = INGFLAT.find(f=>f.name.toLowerCase()===i.n.toLowerCase()); return fl ? (fl._custom?'custom_db':'builtin') : 'manual'; })()
    }));

  const costPerDrink = cleanIng.reduce((s,i) => s + i.c * i.q, 0);
  const recipe = {
    id: rlEditingId || ('rec_' + Date.now() + '_' + Math.random().toString(36).slice(2,5)),
    name,
    category: v('rlCat') || 'Signature',
    dpg: parseFloat(v('rlDpg')) || 1,
    ing: cleanIng,
    notes: v('rlNotes').trim(),
    costPerDrink,
    savedAt: new Date().toISOString(),
    eventLabel: rlEditingId ? (recipeLibrary.find(r=>r.id===rlEditingId)?.eventLabel || 'Library') : 'Library'
  };

  if(rlEditingId){
    const idx = recipeLibrary.findIndex(r => r.id === rlEditingId);
    if(idx >= 0) recipeLibrary[idx] = recipe;
    else recipeLibrary.push(recipe);
  } else {
    // Check for duplicate name
    const exists = recipeLibrary.find(r => r.name.toLowerCase() === name.toLowerCase());
    if(exists){
      if(!confirm('"' + name + '" already exists. Replace it?')) return;
      Object.assign(exists, recipe);
    } else {
      recipeLibrary.push(recipe);
    }
  }

  saveRecipeLibraryStore();
  closeRecipeForm();
  renderRecipeLibrary();
  renderMyLibrarySection();
  // Re-render after a tick to ensure recipeLibrary is fully populated
  setTimeout(() => {
    if(recipeLibrary.length > 0){
      renderMyLibrarySection();
      renderRecipeLibrary();
    }
  }, 100);
  showToast(name + ' saved to library', 'success');
}

function renderRecipeLibrary(){
  const el2 = el('rlGrid');
  if(!el2) return;

  const filterBar2 = el('rlCatFilter');
  if(filterBar2 && recipeLibrary.length){
    const cats = [...new Set(recipeLibrary.map(r => r.category||'Other'))].sort();
    filterBar2.innerHTML = '<button class="qb active-lib-filter" data-cat="all" onclick="rlSetCatFilter(this.dataset.cat,this)">All (' + recipeLibrary.length + ')</button>'
      + cats.map(cat => {
          const n = recipeLibrary.filter(r=>(r.category||'Other')===cat).length;
          return '<button class="qb" data-cat="' + cat.replace(/"/g,'&quot;') + '" onclick="rlSetCatFilter(this.dataset.cat,this)">' + cat + ' (' + n + ')</button>';
        }).join('');
  }

  if(!recipeLibrary.length){
    el2.innerHTML = '<div class="empty" style="padding:3rem;text-align:center;color:#aaa;"><div style=\"font-size:32px;margin-bottom:10px;\">📖</div>Your recipe book is empty — click <strong>+ New recipe</strong> to add your first.</div>';
    return;
  }

  const filterBar3 = el('rlCatFilter');
  const activeCat2 = window._rlActiveCat || ((filterBar3 && filterBar3.querySelector('.active-lib-filter'))
    ? filterBar3.querySelector('.active-lib-filter').dataset.cat || 'all' : 'all');
  const _rlQ = (window._rlSearchQuery || '').toLowerCase().trim();
  const toShow = recipeLibrary.filter(r => {
    const catOk = activeCat2 === 'all' || (r.category||'Other') === activeCat2;
    const qOk   = !_rlQ || r.name.toLowerCase().includes(_rlQ)
      || (r.ing||[]).some(i => i.n && i.n.toLowerCase().includes(_rlQ))
      || (r.notes||'').toLowerCase().includes(_rlQ);
    return catOk && qOk;
  });

  const catColors = {
    'Signature':'#7c3aed','Wedding':'#db2777','Classic':'#1d4ed8',
    'Mocktail':'#10b981','Non-alcoholic':'#059669','Shot':'#dc2626','Punch':'#d97706',
    'Seasonal':'#0891b2','His & Hers':'#db2777','Imported':'#6b7280','Other':'#9ca3af'
  };
  function catColor(cat){ return catColors[cat]||'#6b7280'; }

  const groups = {};
  toShow.forEach(r => {
    const cat = r.category||'Other';
    if(!groups[cat]) groups[cat]=[];
    groups[cat].push(r);
  });

  el2.innerHTML = '';
  // Build stale price map (used for card badges)
  const staleMap = {};
  if(typeof detectStalePrices === 'function'){
    try { detectStalePrices().forEach(s => { staleMap[s.id] = s; }); } catch(e){}
  }
  Object.entries(groups).forEach(([cat, recipes]) => {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:2rem;';

    const catHdr = document.createElement('div');
    catHdr.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:4px 0;';
    catHdr.innerHTML = '<div style="width:4px;height:20px;border-radius:2px;background:' + catColor(cat) + ';flex-shrink:0;"></div>'
      + '<span style="font-size:13px;font-weight:600;color:' + catColor(cat) + ';">' + cat + '</span>'
      + '<div style="flex:1;height:1px;background:var(--border);"></div>'
      + '<span style="font-size:11px;color:#ccc;">' + recipes.length + ' recipe' + (recipes.length!==1?'s':'') + '</span>';
    section.appendChild(catHdr);

    const grid = document.createElement('div');
    grid.style.cssText = 'columns:2 260px;column-gap:12px;';

    recipes.forEach(r => { try {
      const card = document.createElement('div');
      card.style.cssText = 'background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-xl);overflow:visible;border-left:3px solid ' + catColor(r.category||'Other') + ';box-shadow:var(--shadow);display:flex;flex-direction:column;break-inside:avoid;margin-bottom:12px;';
      card.onmouseenter = () => { card.style.boxShadow='0 2px 14px rgba(0,0,0,0.07)'; };
      card.onmouseleave = () => { card.style.boxShadow=''; };

      const cost = (r.costPerDrink||0).toFixed(2);
      const staleInfo = staleMap[r.id];
      const savedDate = r.savedAt ? new Date(r.savedAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric',year:'numeric'}) : '';

      const hdr = document.createElement('div');
      hdr.style.cssText = 'padding:14px 16px 10px;';
      hdr.innerHTML = '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:6px;">'
        + '<div style="font-size:16px;font-weight:600;">' + r.name + '</div>'
        + (staleInfo ? '<span title="Ingredient costs have drifted ' + staleInfo.maxDrift + '% — tap Refresh all prices" style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--amber-bg);color:var(--amber);font-weight:700;white-space:nowrap;flex-shrink:0;cursor:pointer;" onclick="refreshAllRecipePrices()">⚠ +' + staleInfo.maxDrift + '%</span>' : '')
        + '</div>'
        + '<div style="font-size:11px;color:#aaa;">' + r.dpg + ' drink/guest' + (savedDate?' · '+savedDate:'') + '</div>';
      card.appendChild(hdr);

      if(r.notes && r.notes.trim()){
        const notes = document.createElement('div');
        notes.style.cssText = 'padding:0 16px 12px;font-size:12px;color:#777;font-style:italic;line-height:1.5;';
        notes.textContent = r.notes.length>120 ? r.notes.slice(0,117)+'…' : r.notes;
        card.appendChild(notes);
      }

      const ingWrap = document.createElement('div');
      ingWrap.style.cssText = 'padding:8px 16px 10px;border-top:1px solid var(--surface2);overflow:hidden;';
      ingWrap.innerHTML = r.ing.map(i => {
        const qty = i.q%1===0 ? i.q : parseFloat(Number(i.q).toFixed(2));
        return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;font-size:12.5px;border-bottom:0.5px solid var(--border);gap:8px;">'
          + '<span style="flex:1;min-width:0;word-break:break-word;font-size:12.5px;color:var(--text);">' + i.n + '</span>'
          + '<span style="color:var(--text3);white-space:nowrap;font-size:11.5px;flex-shrink:0;">' + qty + ' ' + i.u + '</span></div>';
      }).join('');
      card.appendChild(ingWrap);

      // Flavor tags
      const tags = r.flavorTags || [];
      if(tags.length || true){ // always show tag area
        const tagWrap = document.createElement('div');
        tagWrap.style.cssText = 'padding:8px 14px 6px;display:flex;flex-wrap:wrap;gap:5px;border-top:0.5px solid #f5f5f0;min-height:28px;';
        tags.forEach(tag => {
          const pill = document.createElement('span');
          pill.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:10px;background:#f0f0ff;color:#4338ca;border:1px solid #c7d2fe;cursor:pointer;';
          pill.title = 'Click to remove';
          pill.textContent = tag;
          pill.dataset.id = r.id;
          pill.dataset.tag = tag;
          pill.onclick = () => toggleFlavorTag(r.id, tag);
          tagWrap.appendChild(pill);
        });
        // Add tag button
        const addTagBtn = document.createElement('button');
        addTagBtn.style.cssText = 'font-size:10px;padding:2px 7px;border-radius:10px;border:1px dashed #d1d5db;background:transparent;color:#aaa;cursor:pointer;font-family:inherit;';
        addTagBtn.textContent = '+ flavor';
        addTagBtn.dataset.id = r.id;
        addTagBtn.onclick = (e) => { e.stopPropagation(); openFlavorTagPicker(r.id, addTagBtn); };
        tagWrap.appendChild(addTagBtn);
        card.appendChild(tagWrap);
      }

      // Variations indicator
      const variations = getVariations(r.id);
      if(variations.length){
        const varWrap = document.createElement('div');
        varWrap.style.cssText = 'padding:4px 14px 6px;font-size:11px;color:#888;';
        varWrap.innerHTML = '↳ ' + variations.length + ' variation' + (variations.length!==1?'s':'')
          + ': ' + variations.map(v2 => '<span style="color:#2156b8;cursor:pointer;" data-pid="' + r.id + '" onclick="filterToVariations(this.dataset.pid)">' + v2.name + '</span>').join(', ');
        card.appendChild(varWrap);
      }

      const footer = document.createElement('div');
      footer.style.cssText = 'padding:10px 16px;background:var(--surface2);border-top:1px solid var(--border);border-radius:0 0 var(--radius-xl) var(--radius-xl);display:flex;align-items:center;justify-content:space-between;';
      footer.innerHTML = '<span style="font-size:11px;color:' + (parseFloat(cost)>20?'var(--amber)':'var(--green)') + ';font-weight:600;">$' + cost + ' / drink</span>'
        + '<div style="display:flex;gap:5px;">'
        + '<button class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 8px;" data-id="' + r.id + '" onclick="loadRecipeToMenu(this.dataset.id)">+ Menu</button>'
        + '<button class="btn btn-sm" style="font-size:11px;padding:4px 8px;" data-id="' + r.id + '" onclick="openEditRecipeForm(this.dataset.id)">✎</button>'
        
        + '<button class="btn btn-sm btn-danger" style="font-size:11px;padding:4px 8px;" data-id="' + r.id + '" onclick="deleteRecipeFromLibrary(this.dataset.id)">✕</button>'
        + '</div>';
      card.appendChild(footer);
      grid.appendChild(card);
    } catch(e){ console.warn('Recipe card error:', r.name, e); } });

    section.appendChild(grid);
    el2.appendChild(section);
  });
}

function rlSetCatFilter(cat, btn, searchQuery){
  const bar = el('rlCatFilter');
  if(cat !== undefined && cat !== null){
    if(bar) bar.querySelectorAll('button').forEach(b => b.classList.remove('active-lib-filter'));
    if(btn) btn.classList.add('active-lib-filter');
    else if(bar && cat === 'all'){
      const allBtn = bar.querySelector('[data-cat="all"]');
      if(allBtn) allBtn.classList.add('active-lib-filter');
    }
    window._rlActiveCat = cat;
  }
  if(searchQuery !== undefined){
    window._rlSearchQuery = searchQuery;
  }
  renderRecipeLibrary();
}


function exportRecipeLibrary(){
  if(!recipeLibrary.length){ alert('No recipes in library yet.'); return; }
  const payload = {schema:'bartender_recipes_v1', exportedAt: new Date().toISOString(), recipes: recipeLibrary};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], {type:'application/json'}));
  a.download = 'my_recipe_library.json';
  a.click();
}

function importRecipeLibrary(e){
  const file = e.target.files[0]; if(!file) return;
  e.target.value = '';
  const ext = (file.name.split('.').pop()||'').toLowerCase();
  const isImage = file.type.startsWith('image/');

  if(isImage){
    // Scan image (photo of recipe card, screenshot, etc.) using Claude
    scanRecipeImage(file);
    return;
  }

  const reader = new FileReader();
  reader.onload = ev => {
    const raw = ev.target.result;

    // Try JSON first
    if(ext === 'json' || raw.trim().startsWith('{')){
      try {
        const data = JSON.parse(raw);
        const parsed = parseRecipeJSON(data);
        if(parsed.length){ mergeImportedRecipes(parsed); return; }
      } catch(e){}
    }

    // Try CSV
    if(ext === 'csv' || raw.includes(',') && raw.split('\n').length > 1){
      const parsed = parseRecipeCSV(raw);
      if(parsed.length){ mergeImportedRecipes(parsed); return; }
    }

    // Any text file — pass to AI to extract recipes
    scanRecipeText(raw, file.name);
  };
  reader.readAsText(file);
}

// ── Parse structured JSON (our format + common variants) ──
function parseRecipeJSON(data){
  // Our format: { recipes: [...] }
  if(data.recipes && Array.isArray(data.recipes)) return normaliseRecipes(data.recipes);
  // Raw array
  if(Array.isArray(data)) return normaliseRecipes(data);
  // Master export
  if(data.recipeLibrary) return normaliseRecipes(data.recipeLibrary);
  // Single recipe object
  if(data.name && data.ing) return normaliseRecipes([data]);
  // { cocktails: [...] }
  if(data.cocktails && Array.isArray(data.cocktails)) return normaliseRecipes(data.cocktails);
  return [];
}

// ── Normalise any recipe-like object to our internal format ──
function normaliseRecipes(arr){
  return arr.filter(r => r && (r.name || r.cocktail_name || r.title)).map(r => {
    const name = r.name || r.cocktail_name || r.title || '';
    // Ingredients can be in many shapes
    let ing = [];
    if(Array.isArray(r.ing)) ing = r.ing;
    else if(Array.isArray(r.ingredients)){
      ing = r.ingredients.map(i => {
        if(typeof i === 'string'){
          // "2 oz Bombay Sapphire" → parse
          const m = i.match(/^([\d.\/]+)\s+(\w+)\s+(.+)$/);
          return m ? {n:m[3].trim(), q:parseFloat(m[1])||1, u:m[2], c:0}
                   : {n:i, q:1, u:'oz', c:0};
        }
        return {
          n: i.name || i.ingredient || i.n || '',
          q: parseFloat(i.amount||i.qty||i.quantity||i.q)||1,
          u: i.unit || i.u || 'oz',
          c: parseFloat(i.cost||i.price||i.c)||0
        };
      });
    }
    const cost = ing.reduce((s,i) => s + (i.c||0)*(i.q||1), 0);
    return {
      id: r.id || ('rec_'+Date.now()+'_'+Math.random().toString(36).slice(2,5)),
      name,
      category: r.category || r.cat || r.type || 'Imported',
      dpg: parseFloat(r.dpg||r.drinks_per_guest||r.servings)||1,
      ing,
      notes: r.notes || r.description || r.instructions || '',
      costPerDrink: r.costPerDrink || (r.batchServings ? cost/r.batchServings : cost),
      savedAt: r.savedAt || new Date().toISOString(),
      eventLabel: r.eventLabel || 'Imported'
    };
  }).filter(r => r.name);
}

// ── Parse CSV: name, category, ingredient, qty, unit, cost ──
function parseRecipeCSV(text){
  const lines = text.trim().split('\n').map(l => l.split(',').map(c2 => c2.trim().replace(/^"|"$/g,'')));
  if(lines.length < 2) return [];
  const header = lines[0].map(h => h.toLowerCase());
  const nameCol = header.findIndex(h => h.includes('name')||h.includes('cocktail'));
  if(nameCol === -1) return [];

  const recipes = {};
  for(let i = 1; i < lines.length; i++){
    const row = lines[i];
    const name = row[nameCol];
    if(!name) continue;
    if(!recipes[name]) recipes[name] = {name, ing:[], category:'Imported', dpg:1, notes:''};

    const ingCol = header.findIndex(h => h.includes('ingredient'));
    const qtyCol = header.findIndex(h => h.includes('qty')||h.includes('amount'));
    const unitCol = header.findIndex(h => h.includes('unit'));
    const costCol = header.findIndex(h => h.includes('cost')||h.includes('price'));
    const catCol  = header.findIndex(h => h.includes('cat'));
    const noteCol = header.findIndex(h => h.includes('note')||h.includes('desc'));

    if(ingCol >= 0 && row[ingCol]){
      recipes[name].ing.push({
        n: row[ingCol]||'',
        q: parseFloat(row[qtyCol])||1,
        u: row[unitCol]||'oz',
        c: parseFloat(row[costCol])||0
      });
    }
    if(catCol >= 0 && row[catCol]) recipes[name].category = row[catCol];
    if(noteCol >= 0 && row[noteCol]) recipes[name].notes = row[noteCol];
  }
  return normaliseRecipes(Object.values(recipes));
}

// ── AI scan: extract recipes from unstructured text ──
async function scanRecipeText(text, filename){
  showToast('Scanning "' + filename + '" for recipes...', 'success');
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: 'Extract all cocktail recipes from this text. Return ONLY a JSON array, no other text. Each recipe object must have: name (string), category (string like Signature/Classic/Other), dpg (number, drinks per guest, default 1), notes (string), ingredients (array of {name, qty (number), unit (string like oz/ml/dashes/leaves), cost (number, 0 if unknown)}). Text:\n\n' + text.slice(0, 8000)
        }]
      })
    });
    const data = await resp.json();
    const raw = (data.content||[]).find(b=>b.type==='text')?.text||'';
    const clean = raw.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    const recipes = normaliseRecipes(Array.isArray(parsed)?parsed:[parsed]);
    if(recipes.length){ mergeImportedRecipes(recipes); }
    else { showToast('No recipes found in file', 'error'); }
  } catch(err){
    showToast('Could not extract recipes — try JSON or CSV format', 'error');
  }
}

// ── AI scan: extract recipes from an image ──
async function scanRecipeImage(file){
  showToast('Scanning image for recipes...', 'success');
  const b64 = await new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {type:'image', source:{type:'base64', media_type:file.type, data:b64}},
            {type:'text', text:'Extract all cocktail recipes visible in this image. Return ONLY a JSON array, no other text. Each recipe: {name, category, dpg (default 1), notes, ingredients: [{name, qty, unit, cost (0 if unknown)}]}. If no recipes found return [].'}
          ]
        }]
      })
    });
    const data = await resp.json();
    const raw = (data.content||[]).find(b=>b.type==='text')?.text||'';
    const clean = raw.replace(/```json|```/g,'').trim();
    const parsed = JSON.parse(clean);
    const recipes = normaliseRecipes(Array.isArray(parsed)?parsed:[parsed]);
    if(recipes.length){ mergeImportedRecipes(recipes); }
    else { showToast('No recipes found in image', 'error'); }
  } catch(err){
    showToast('Could not read image — try a clearer photo', 'error');
  }
}
// ════════════════════════════════════════════════════════════

function renderMyLibrarySection() {
  const section = el('myLibrarySection');
  const grid    = el('myLibGrid');
  const filter  = el('myLibFilter');
  const strip   = el('quickAddStrip');

  // Quick-add pill strip: curated classics not yet in the current event menu
  if(strip){
    const CLASSICS = [
      'Mojito','Aperol Spritz','Margarita','Gin & Tonic','Cosmopolitan',
      'Old Fashioned','Moscow Mule','Paloma','Negroni','Espresso Martini',
      'Whisky Sour','Dark & Stormy','Sangria Punch','Virgin Mojito',
      'Shirley Temple','Yuzu Gin Fizz','Lychee Martini',
      'Japanese Whisky Highball','Matcha Sake Spritz','Spicy Yuzu Margarita',
      'Butterfly Pea Gin Sour','Lemongrass Mule'
    ];

    const inMenu = new Set(cocktails.map(function(c2){ return c2.name.toLowerCase(); }));
    const inLib  = new Set(recipeLibrary.map(function(r){ return r.name.toLowerCase(); }));

    // Show classics not already in the menu AND not already in the recipe library
    // (library recipes are shown in the "From saved recipes" section below)
    const available = CLASSICS.filter(function(name){
      return !inMenu.has(name.toLowerCase()) && !inLib.has(name.toLowerCase());
    });

    if(!available.length){
      strip.innerHTML = '<div style="margin-bottom:12px;font-size:12px;color:var(--text3);">✓ All classics are in your library or menu</div>';
    } else {
      // Single flat pill row — same style as before
      // Solid border = classic not in menu; dashed = not yet in library either
      const pills = available.map(function(name){
        return '<button data-name="' + name.replace(/"/g,'&quot;') + '" onclick="quickAddLibCocktail(this.dataset.name)" class="quick-add-pill" style="border-style:dashed;" title="Add to menu (saves to library)">' + name + '</button>';
      }).join('');

      strip.innerHTML = '<div style="margin-bottom:12px;">'
        + '<div style="font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--text3);margin-bottom:8px;">Quick-add · <span style="font-weight:400;">dashed = not yet in your library</span></div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + pills + '</div>'
        + '</div>';
    }
  }

  }
function filterMyLibSearch(query){ myLibActiveQuery = query; renderMyLibCards(); }

function renderMyLibCards(catFilter, query, showAllFlag) {
  if(catFilter !== undefined) myLibActiveCat = catFilter;
  if(query !== undefined) myLibActiveQuery = query;
  const cat = myLibActiveCat || 'all';
  const q = (myLibActiveQuery || '').toLowerCase().trim();

  const grid = el('myLibGrid');
  if (!grid) return;

  let filtered = cat === 'all'
    ? recipeLibrary
    : recipeLibrary.filter(r => (r.category||'Other') === cat);

  if(q){
    filtered = filtered.filter(r => {
      const nameMatch = r.name.toLowerCase().includes(q);
      const ingMatch = r.ing && r.ing.some(i => (i.n||'').toLowerCase().includes(q));
      return nameMatch || ingMatch;
    });
  }

  if(!filtered.length){
    grid.innerHTML = '<div style="font-size:12px;color:#aaa;padding:8px 0;">'
      + (q ? 'No recipes match "' + q + '".' : 'No recipes yet.')
      + '</div>';
    return;
  }

  // Show max 12 by default unless searching
  const showAll = !!q || showAllFlag || filtered.length <= 12;
  const visible = showAll ? filtered : filtered.slice(0, 12);

  grid.innerHTML = visible.map(r => {
    const cost = r.costPerDrink || (r.ing||[]).reduce((s,i)=>s+(i.c||0)*(i.q||0),0);
    const alreadyInMenu = cocktails.some(c2 => c2.name.toLowerCase() === r.name.toLowerCase());
    const bAttrs = alreadyInMenu
      ? 'style="opacity:0.5;cursor:default;" title="Already in menu"'
      : 'data-rid="' + r.id + '" onclick="addFromMyLibrary(this.dataset.rid)" title="Add to menu"';

    let metaText = '$' + cost.toFixed(2) + '/drink';
    if(q && r.ing){
      const matchedIngs = r.ing.filter(i => (i.n||'').toLowerCase().includes(q));
      if(matchedIngs.length){
        metaText = '<span style="color:#2156b8;font-size:10px;">Contains: ' + matchedIngs.map(i=>i.n).join(', ') + '</span> · ' + metaText;
      }
    }

    const catColor = {'Classic':'#1d4ed8','Signature':'#7c3aed','Mocktail':'#10b981','Non-alcoholic':'#059669','Shot':'#dc2626','Punch':'#d97706'}[r.category||''] || '#888';

    return '<button class="lib-card-btn" ' + bAttrs + '>'
      + '<span class="lib-name">' + r.name + (alreadyInMenu ? ' ✓' : '') + '</span>'
      + '<span class="lib-meta">'
      +   '<span style="font-size:9px;padding:1px 6px;border-radius:8px;background:' + catColor + '20;color:' + catColor + ';margin-right:4px;">' + (r.category||'Classic') + '</span>'
      +   metaText
      + '</span>'
      + '</button>';
  }).join('');

  // Show "Show all" button if truncated
  if(!showAll){
    grid.innerHTML += '<button onclick="renderMyLibCards(undefined,undefined,true)" style="width:100%;padding:8px;border:1px dashed #ddd;border-radius:8px;background:transparent;cursor:pointer;font-family:inherit;font-size:12px;color:#888;margin-top:6px;">Show all ' + filtered.length + ' recipes ▾</button>';
  }
}
function filterMyLib(cat, btn) {
  const filterEl = el('myLibFilter');
  if(filterEl){
    filterEl.querySelectorAll('button').forEach(b => b.classList.remove('active-lib-filter'));
  }
  if(btn) btn.classList.add('active-lib-filter');
  renderMyLibCards(cat);
}
function quickAddLibCocktail(name){
  // 1. Check saved recipe library first
  const savedRecipe = recipeLibrary.find(function(r){
    return r.name.toLowerCase() === name.toLowerCase();
  });

  let ing = [], cat = 'Classic', dpg = 1;

  if(savedRecipe){
    ing = (savedRecipe.ing || []).map(function(i){ return Object.assign({},i); });
    cat = savedRecipe.category || savedRecipe.cat || 'Classic';
    dpg = savedRecipe.dpg || 1;
  } else {
    // 2. Try INGDB built-in classics (look for matching recipe data)
    // Add to menu as blank classic — Antoine can fill ingredients later
    cat = 'Classic';
  }

  // Add to event menu
  const newId = 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  cocktails.push({
    id: newId,
    name: name,
    cat: cat,
    dpg: dpg,
    ing: ing
  });

  showToast(name + ' added to menu', 'success');
  postEventData = {};
  rC(); rShop(); syncSettings(); rQ(); markUnsaved();
  renderMyLibrarySection();
}

function addFromMyLibrary(recipeId) {
  const recipe = recipeLibrary.find(r => r.id === recipeId);
  if (!recipe) return;

  // Check if already in menu
  if (cocktails.some(c2 => c2.name.toLowerCase() === recipe.name.toLowerCase())) {
    if (!confirm('"' + recipe.name + '" is already in your menu. Add it again?')) return;
  }

  // Add to menu — refresh prices from current database first
  const ing = recipe.ing.map(i => {
    const flat = INGFLAT.find(f => f.name.toLowerCase() === i.n.toLowerCase());
    return { ...i, c: flat ? flat.c : i.c };
  });

  cocktails.push({
    id: Date.now(),
    name: recipe.name,
    cat: recipe.category || 'Signature',
    dpg: recipe.dpg || 1,
    ing
  });

  rC();
  rShop();
  rQ();
  markUnsaved();
  renderMyLibCards(el('myLibFilter') ? (el('myLibFilter').querySelector('.active-lib-filter')||{}).dataset.cat || 'all' : 'all');
  showToast(recipe.name + ' added to menu', 'success');
  syncSettings();
}

function toggleMyLibrarySection() {
  const grid = el('myLibGrid');
  const filter = el('myLibFilter');
  const btn = el('myLibToggleBtn');
  if (!grid) return;
  const hidden = grid.style.display === 'none';
  grid.style.display = hidden ? 'flex' : 'none';
  if (filter) filter.style.display = hidden ? 'flex' : 'none';
  if (btn) btn.textContent = hidden ? '▲ Hide' : '▼ Show';
}

