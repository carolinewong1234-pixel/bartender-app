// ═══ DOCUMENT IMPORT & AI SCAN ═══
// Import modal, quick scan, parseEventDocLocally,
// renderImportPreview, saveImportedData

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
function exportAllData(){
  const payload = {
    schema: 'bartender_master_v1',
    exportedAt: new Date().toISOString(),
    customIngredients: myIngredients,
    priceHistory,
    recipeLibrary,
    receipts,
    currentStock,
    eventLibrary,
    eventCategories,
    // Current event snapshot
    currentEvent: {
      label: v('eventLabel'),
      cocktails,
      staff: staffList,
      settings: {
        gc: vi('gc'), eventHrs: vf('eventHrs'), drinksPerPerson: vf('drinksPerPerson'),
        bufferPct: vf('bufferPct'),
        hr: vf('hr'), mp: vf('mp'), tf: vf('tf'), discountAmt: vf('discountAmt'), discountPct: vf('discountPct')
      }
    }
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], {type:'application/json'}));
  a.download = 'bartender_all_data_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  showToast('All data exported successfully', 'success');
}

function exportForSupabase(){
  // Formats data exactly as Supabase tables expect it
  // Each object has: user_id (placeholder), data (the array/object), updated_at
  const placeholder = 'REPLACE_WITH_YOUR_USER_ID';
  const now = new Date().toISOString();

  const tables = {
    bartender_mydb:         { user_id: placeholder, data: myIngredients,   updated_at: now },
    bartender_recipes:      { user_id: placeholder, data: recipeLibrary,   updated_at: now },
    bartender_events:       { user_id: placeholder, data: eventLibrary,    updated_at: now },
    bartender_stock:        { user_id: placeholder, data: currentStock,    updated_at: now },
    bartender_receipts:     { user_id: placeholder, data: receipts,        updated_at: now },
    bartender_pricehistory: { user_id: placeholder, data: priceHistory,    updated_at: now },
    bartender_categories:   { user_id: placeholder, data: eventCategories, updated_at: now }
  };

  const payload = {
    _info: 'Supabase-ready export. In the Supabase SQL editor, replace REPLACE_WITH_YOUR_USER_ID with your actual user ID from Authentication → Users.',
    _exportedAt: now,
    _totalRecipes: recipeLibrary.length,
    _totalEvents: eventLibrary.length,
    _totalIngredients: myIngredients.length,
    tables
  };

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)], {type:'application/json'}));
  a.download = 'bartender_supabase_export_' + new Date().toISOString().split('T')[0] + '.json';
  a.click();
  showToast('☁ Supabase export ready — ' + recipeLibrary.length + ' recipes, ' + eventLibrary.length + ' events exported', 'success');
}

let importedData = null; // holds the parsed data waiting for user validation

function openImportModal(){
  const content = el('importModalContent');
  if(content) content.innerHTML = `
    <p style="font-size:13px;color:#888;margin-bottom:1.2rem;line-height:1.5;">
      Upload a photo, PDF, Word doc, or text file. Claude extracts cocktail recipes,
      event schedules, and ingredients — all at once.
    </p>
    <div onclick="el('wordImportInput').click()"
      style="border:2px dashed #e5e5e0;border-radius:12px;padding:2rem;text-align:center;cursor:pointer;background:#fafaf7;">
      <div style="font-size:36px;margin-bottom:8px;">📄</div>
      <div style="font-size:14px;font-weight:600;margin-bottom:4px;">Tap to choose a file</div>
      <div style="font-size:12px;color:#aaa;">Photo, PDF, Word doc, or text file</div>
      <div style="font-size:11px;color:#bbb;margin-top:6px;">Extracts: cocktail recipes · event schedule · ingredients</div>
    </div>
    <div id="importScanStatus" style="display:none;margin-top:1rem;text-align:center;"></div>
    <div id="importScanResults" style="margin-top:1rem;"></div>
  `;
  el('importModalBg').classList.add('open');
}

// ════════════════════════════════════════════════════════════
// QUICK SCAN — focused import for cocktails / schedule / ingredients
// ════════════════════════════════════════════════════════════

let quickScanMode = null; // 'cocktails' | 'schedule' | 'ingredients'

function openQuickScanModal(){
  quickScanMode = null;
  el('quickScanModalBg').classList.add('open');
}
function closeQuickScan(){
  el('quickScanModalBg').classList.remove('open');
  quickScanMode = null;
}

function triggerQuickScan(mode){
  quickScanMode = mode;
  document.getElementById('quickScanInput').click();
}

async function handleQuickScan(e){
  const file = e.target.files[0];
  if(!file) return;
  e.target.value = '';
  closeQuickScan();
  // Delegate to the unified import handler
  // Create a fake event object to reuse handleWordImport
  const dt = new DataTransfer();
  dt.items.add(file);
  const fakeInput = document.getElementById('wordImportInput');
  if(fakeInput){
    // Open import modal to show progress
    openImportModal();
    // Trigger via the input
    Object.defineProperty(fakeInput, 'files', {value: dt.files, configurable:true});
    await handleWordImport({target:{files: dt.files, value:''}});
  }
}
function closeImportModal(){
// ════════════════════════════════════════════════════════════
function parseEventDocLocally(text){
  const lines = text.split(/\n/).map(l => l.replace(/\*+/g,'').trim()).filter(Boolean);
  let parsedCocktails=[], schedule=[], ingredients=[];
  let currentCocktail=null, currentIng=[], currentNotes=[];
  let inMethodology=false, inShopping=false;

  // ── Parse cocktail methodology section ──
  for(let i=0;i<lines.length;i++){
    const line=lines[i], up=line.toUpperCase();

    if(up.includes('METHODOLOGY')||up.includes('MIXOLOGY / THE MENU')) inMethodology=true;
    // Stop cocktail parsing when we hit SAQ/shopping section
    if(up.includes('SAQ MINIMUM')||up.includes('FRESH PRODUCE')||up.includes('ESTIMATED QUOTE')) inMethodology=false;

    if(!inMethodology){ continue; }

    const isSkipLine = /^(GLASS|METHOD|GARNISH|SAQ|FRESH|ESTIMATED|PRICE|CONTACT|SUGGESTED|PHONE|EMAIL|ADRESS|3 SIGNATURE|PRE-BOTTLE|TOP |ICE |PLASTIC|BAMBOO|MAYNARDS|POPPING|SUGAR|AGAVE|HIBISCUS SYRUP$)/.test(up);
    // Cocktail name = ALL-CAPS, no digits at start, no colon, no @, no fractions, not a skip line
    const isCocktailName = !isSkipLine
      && line.length > 3 && line.length < 60
      && !line.match(/^\d|^[¾½¼]/)
      && !line.includes(':') && !line.includes('@')
      && up === line.replace(/[🍐🍑🫧🌺💫✨]/g,'').toUpperCase().trim();

    if(isCocktailName && currentCocktail && currentIng.length>0){
      parsedCocktails.push({name:currentCocktail, category:'Signature', dpg:1, notes:currentNotes.join(' | '), ingredients:currentIng});
      currentIng=[]; currentNotes=[];
    }
    if(isCocktailName){ currentCocktail=line.replace(/[🍐🍑🫧🌺💫✨]/g,'').trim(); continue; }
    if(!currentCocktail) continue;
    if(/^(GLASS|METHOD|GARNISH)\s*:/.test(up)){ currentNotes.push(line); continue; }

    // Ingredient line: starts with number, fraction, or dash keyword
    const ingMatch = line.match(/^([¾½¼]|\d+\.?\d*)\s+(OZ|ML|DASH|TSP|TBSP)?\s*(.+)/i);
    if(ingMatch){
      let qty=0;
      const n=ingMatch[1];
      if(n==='¾')qty=0.75; else if(n==='½')qty=0.5; else if(n==='¼')qty=0.25;
      else qty=parseFloat(n)||0;
      const unit=(ingMatch[2]||'oz').toLowerCase();
      const name=ingMatch[3].trim();
      if(name.length>1 && !name.match(/^(BTL|BOTTLE)/i)) currentIng.push({name,qty,unit,cost:0});
    }
  }
  if(currentCocktail && currentIng.length>0)
    parsedCocktails.push({name:currentCocktail, category:'Signature', dpg:1, notes:currentNotes.join(' | '), ingredients:currentIng});

  // ── Parse schedule ──
  lines.forEach(line => {
    const up = line.toUpperCase();
    if(/\d{1,2}:\d{2}/.test(line) || /ARRIVAL|BEGINNING OF SERVICE|DEPARTURE|MISE EN PLACE|HOURLY RATE|TRANSPORTATION/.test(up)){
      const timeMatch = line.match(/\d{1,2}:\d{2}/);
      schedule.push({time:timeMatch?timeMatch[0]:'', task:line.replace(/.*:\s*/,'').trim()||line, notes:''});
    }
  });

  // ── Parse shopping/ingredients section ──
  let inShop=false;
  for(let i=0;i<lines.length;i++){
    const line=lines[i], up=line.toUpperCase();
    if(up.includes('SAQ MINIMUM')||up.includes('FRESH PRODUCE')||up.includes('TO BE PURCHASED')) inShop=true;
    if(up.includes('ESTIMATED QUOTE')) break; // stop at quote section
    if(!inShop) continue;

    const saqKeywords=['GREY GOOSE','AMARETTO','GIN','PROSECCO','TEQUILA','COINTREAU','VODKA','RUM','WHISKY','CHAMPAGNE','APEROL','CAMPARI','WINE'];
    // Bottled spirit lines: "2 BTLS GREY GOOSE LA POIRE 750ML"
    const bottleMatch = line.match(/^(\d+)\s+(BTLS?|BTL|BOTTLES?)\s+(.+?)(?:\s+\d+\s*ML)?$/i);
    if(bottleMatch){
      const next = lines[i+1]||'';
      const priceMatch = next.match(/(\d+\.?\d*)\s*\$/);
      const isSAQ = saqKeywords.some(s => up.includes(s));
      ingredients.push({name:bottleMatch[3].trim(), qty:parseInt(bottleMatch[1]), unit:'bottle', cost:priceMatch?parseFloat(priceMatch[1]):0, store:isSAQ?'SAQ':'Grocery'});
      return;
    }
    // Skip header/meta lines
    if(/^(SAQ|FRESH PRODUCE|ESTIMATED|PRICE PER|PURCHASES|TO BE PURCHASED|MIXOLOGY|METHODOLOGY)/i.test(line)) continue;
    // Plain named items (produce, supplies)
    if(line.length>2 && line.length<60 && !line.match(/^\d/) && !line.includes(':') && !line.includes('$') && !line.includes('@')){
      const isSAQ = saqKeywords.some(s => up.includes(s));
      ingredients.push({name:line.trim(), qty:1, unit:'piece', cost:0, store:isSAQ?'SAQ':'Grocery'});
    }
  }

  return {parsedCocktails, schedule, ingredients};
}


async function handleWordImport(e){
  const file = e.target.files[0];
  if(!file) return;
  e.target.value = '';

  const statusEl = el('importScanStatus');
  const resultsEl = el('importScanResults');
  if(statusEl){ statusEl.style.display='block'; statusEl.innerHTML='<div style="font-size:13px;color:#888;">📖 Reading <strong>' + file.name + '</strong>…</div>'; }
  if(resultsEl) resultsEl.innerHTML = '';

  // ── Step 1: Extract text from the file ──
  let docText = '';
  try {
    const name = (file.name||'').toLowerCase();
    const type = file.type||'';

    if(file.type.startsWith('image/')){
      // Images — try API with vision, local parser can't read images
      const b64 = await fileToBase64(file);
      await tryAPIImport({type:'image', source:{type:'base64', media_type:file.type, data:b64}}, file.name, statusEl, resultsEl);
      return;
    } else if(file.type === 'application/pdf' || name.endsWith('.pdf')){
      // PDF — try API with document block first, then fall back to binary extraction
      try {
        const b64 = await fileToBase64(file);
        // Try API import directly with PDF as document block
        if(statusEl) statusEl.innerHTML = '<div style="font-size:13px;color:#888;">📄 Reading PDF with Claude…</div>';
        const PROXY2 = window.ANTHROPIC_PROXY_URL || 'https://api.anthropic.com/v1/messages';
        const pdfContent = {type:'document', source:{type:'base64', media_type:'application/pdf', data:b64}};
        const makeReqPDF = (prompt) => fetch(PROXY2, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({model:'claude-sonnet-4-20250514', max_tokens:3000,
            messages:[{role:'user', content:[pdfContent, {type:'text', text:prompt}]}]})
        }).then(r=>r.json()).then(d=>{
          if(d.error) return [];
          const raw = (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
          const m = raw.replace(/```json|```/g,'').trim().match(/\[[\s\S]*?\]/);
          if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
          return [];
        }).catch(()=>[]);
        const [c1,s1,i1] = await Promise.all([
          makeReqPDF('Extract all cocktail recipes. Return JSON array: [{"name":"","category":"Signature","dpg":1,"notes":"","ingredients":[{"name":"","qty":1.5,"unit":"oz","cost":0}]}]. Return [] if none.'),
          makeReqPDF('Extract event schedule/timing. Return JSON array: [{"time":"","task":"","notes":""}]. Return [] if none.'),
          makeReqPDF('Extract all ingredients and shopping items. Return JSON array: [{"name":"","qty":1,"unit":"piece","cost":0,"store":"SAQ or Grocery"}]. Return [] if none.')
        ]);
        if(c1.length || s1.length || i1.length){
          // API worked — apply directly
          let total = 0; const sum = [];
          if(c1.length){ mergeImportedRecipes(normaliseRecipes(c1)); total+=c1.length; sum.push({icon:'🍹',label:c1.length+' recipes added',color:'#1a7a4a'}); }
          else sum.push({icon:'🍹',label:'No cocktail recipes found',color:'#aaa'});
          if(s1.length){ sv('qn',(v('qn')?v('qn')+'\n\n':'')+s1.map(t=>(t.time?t.time+' — ':'')+t.task).join('\n')); rQ(); markUnsaved(); total+=s1.length; sum.push({icon:'⏰',label:s1.length+' schedule entries added',color:'#2156b8'}); }          else sum.push({icon:'⏰',label:'No schedule found',color:'#aaa'});




          if(i1.length){ let added=0; i1.forEach(item=>{ if(!item.name||item.name.length<2)return; const k=item.name.toLowerCase().trim(); if(!myIngredients.find(x=>x.name.toLowerCase()===k)){ myIngredients.push({name:item.name,unit:item.unit||'piece',c:parseFloat(item.cost)||0,note:item.store||'',cat:'🏠 My custom ingredients',retailer:item.store||'',addedAt:new Date().toISOString()}); added++; } }); if(added){saveMyDB();syncMyDBtoFlat();renderMyDB();renderMyLibrarySection();} total+=added; sum.push({icon:'🛒',label:added+' ingredients added',color:'#7c3aed'}); }
          else sum.push({icon:'🛒',label:'No ingredients found',color:'#aaa'});
          if(statusEl) statusEl.style.display='none';
          if(resultsEl) resultsEl.innerHTML='<div style="font-size:14px;font-weight:600;margin-bottom:10px;color:'+(total>0?'#1a7a4a':'#888')+'">'+(total>0?'✅ '+total+' items imported':'⚠ Nothing found')+' </div>'+sum.map(s=>'<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:'+(s.color==='#aaa'?'#f9f9f6':'#f0fdf4')+'"><span style="font-size:18px;">'+s.icon+'</span><span style="font-size:13px;color:'+s.color+';font-weight:500;">'+s.label+'</span></div>').join('')+(total>0?'<button onclick="closeImportModal()" class="btn btn-primary btn-sm" style="width:100%;margin-top:8px;">Done ✓</button>':'<button onclick="el(\x27wordImportInput\x27).click()" class="btn btn-sm" style="width:100%;margin-top:8px;">Try another file</button>');
          return;
        }
      } catch(apiErr){ /* fall through to local extraction */ }
      // Fallback: binary string extraction
      docText = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => {
          const raw = fr.result;
          const chunks = [];
          const matches = raw.matchAll(/\(([^)]{1,200})\)/g);
          for(const m of matches){
            const s = m[1].replace(/\\n/g,' ').replace(/\\r/g,'').trim();

            if(s.length > 1 && /[a-zA-Z]/.test(s)) chunks.push(s);
          }
          res(chunks.join('\n'));

        };
        fr.onerror = () => res('');
        fr.readAsBinaryString(file);
      });
    } else if(name.endsWith('.docx') || type.includes('wordprocessingml') || type.includes('officedocument')){
      // DOCX — extract via JSZip or raw binary fallback
      docText = await extractDocxText(file).catch(async () => {
        const ab = await file.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let raw = '';
        for(let i=0;i<bytes.length;i++){
          const ch = bytes[i];
          if(ch>=32 && ch<127) raw += String.fromCharCode(ch);
          else if(ch===10||ch===13) raw += '\n';
        }
        return raw.replace(/<[^>]{0,200}>/g,' ').replace(/[ \t]{2,}/g,' ');
      });
    } else {
      // Plain text, markdown, csv
      docText = await fileToText(file);
    }
  } catch(err){
    if(statusEl) statusEl.innerHTML = '<div style="color:#dc2626;font-size:13px;">Could not read file: ' + err.message + '</div>';
    return;
  }

  if(!docText || docText.length < 20){
    if(statusEl) statusEl.innerHTML = '<div style="color:#dc2626;font-size:13px;">Could not extract text from this file. Try a .txt or image instead.</div>';
    return;
  }

  // ── Step 2: Parse locally first (always works, no API needed) ──
  if(statusEl) statusEl.innerHTML = '<div style="font-size:13px;color:#888;">🔍 Extracting recipes, schedule, and ingredients…</div>';

  const parsed = parseEventDocLocally(docText);
  let { parsedCocktails: cocktailsFound, schedule: scheduleFound, ingredients: ingredientsFound } = parsed;

  // ── Step 3: If local parser found nothing, try API (only when inside claude.ai) ──
  if(!cocktailsFound.length && !ingredientsFound.length){
    const PROXY = window.ANTHROPIC_PROXY_URL || 'https://api.anthropic.com/v1/messages';
    const contentBase = {type:'text', text:'DOCUMENT: ' + file.name + '\n\n' + docText.slice(0,15000)};
    try {
      const makeReq = (prompt) => fetch(PROXY, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({model:'claude-sonnet-4-20250514', max_tokens:3000,
          messages:[{role:'user', content:[contentBase, {type:'text', text:prompt}]}]})
      }).then(r=>r.json()).then(d=>{
        if(d.error) return [];
        const raw = (d.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
        const m = raw.replace(/```json|```/g,'').trim().match(/\[[\s\S]*?\]/);
        if(m){ try{ return JSON.parse(m[0]); }catch(e){} }
        return [];
      }).catch(()=>[]);

      const results = await Promise.all([
        makeReq('Extract all cocktail recipes from this bartender event document. Return JSON array: [{"name":"","category":"Signature","dpg":1,"notes":"","ingredients":[{"name":"","qty":1.5,"unit":"oz","cost":0}]}]. Return [] if none.'),
        makeReq('Extract event schedule and timing. Return JSON array: [{"time":"","task":"","notes":""}]. Return [] if none.'),
        makeReq('Extract all ingredients and shopping list items. Return JSON array: [{"name":"","qty":1,"unit":"piece","cost":0,"store":"SAQ or Grocery"}]. Return [] if none.')
      ]);
      if(results[0].length) cocktailsFound = results[0];
      if(results[1].length) scheduleFound  = results[1];
      if(results[2].length) ingredientsFound = results[2];
    } catch(err){ /* API unavailable, stick with local results */ }
  }

  // ── Step 4: Apply results ──
  let totalImported = 0;
  const summary = [];

  if(cocktailsFound.length){
    const recipes = normaliseRecipes(cocktailsFound);
    mergeImportedRecipes(recipes);
    totalImported += recipes.length;
    summary.push({icon:'🍹', label: recipes.length + ' cocktail recipe' + (recipes.length!==1?'s':'') + ' added to Recipe library', color:'#1a7a4a'});
  } else {
    summary.push({icon:'🍹', label:'No cocktail recipes found', color:'#aaa'});
  }

  if(scheduleFound.length){
    const schLines = scheduleFound.map(t => (t.time||'') + (t.time?' — ':'') + (t.task||t.notes||'')).filter(Boolean).join('\n');
    const existing = v('qn');
    sv('qn', (existing?existing+'\n\n':'') + 'SCHEDULE:\n' + schLines);
    rQ(); markUnsaved();
    totalImported += scheduleFound.length;
    summary.push({icon:'⏰', label: scheduleFound.length + ' schedule entries added to Event notes', color:'#2156b8'});
  } else {
    summary.push({icon:'⏰', label:'No schedule found', color:'#aaa'});
  }

  if(ingredientsFound.length){
    let added = 0;
    ingredientsFound.forEach(item => {
      if(!item.name || item.name.length < 2) return;
      const key = item.name.toLowerCase().trim();
      if(!myIngredients.find(i => i.name.toLowerCase() === key)){
        myIngredients.push({name:item.name, unit:item.unit||'piece', c:parseFloat(item.cost)||0,
          note:item.store||'', cat:'🏠 My custom ingredients',
          retailer:item.store||'', addedAt:new Date().toISOString()});
        added++;
      }
    });
    if(added){ saveMyDB(); syncMyDBtoFlat(); renderMyDB(); renderMyLibrarySection(); }
    totalImported += added;
    summary.push({icon:'🛒', label: added + ' ingredient' + (added!==1?'s':'') + ' added to Ingredient database', color:'#7c3aed'});
  } else {
    summary.push({icon:'🛒', label:'No ingredients found', color:'#aaa'});
  }

  // ── Step 5: Show results ──
  if(statusEl) statusEl.style.display = 'none';
  if(resultsEl){
    resultsEl.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:10px;color:'+(totalImported>0?'#1a7a4a':'#888')+'">'
      + (totalImported > 0 ? '✅ ' + totalImported + ' items imported' : '⚠ Nothing found in this file')
      + '</div>'
      + summary.map(s =>
          '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;margin-bottom:6px;background:'+(s.color==='#aaa'?'#f9f9f6':'#f0fdf4')+';">'
          + '<span style="font-size:18px;">' + s.icon + '</span>'
          + '<span style="font-size:13px;color:' + s.color + ';font-weight:500;">' + s.label + '</span>'
          + '</div>'
        ).join('')
      + (totalImported > 0
          ? '<button onclick="closeImportModal()" class="btn btn-primary btn-sm" style="width:100%;margin-top:8px;">Done ✓</button>'
          : '<button onclick="el(\'wordImportInput\').click()" class="btn btn-sm" style="width:100%;margin-top:8px;">Try another file</button>');
  }
}

async function tryAPIImport(contentBase, fileName, statusEl, resultsEl){
  // For image files only — no local text extraction possible
  if(statusEl) statusEl.innerHTML = '<div style="font-size:13px;color:#888;">🔍 Scanning image with Claude…</div>';
  // ... (same as before for images)
  if(resultsEl) resultsEl.innerHTML = '<div style="font-size:13px;color:#888;">Image scanning requires the Claude.ai API. Try uploading a PDF or text file instead for now.</div>';
}
function getWordImportPrompt(){
  return 'Extract ALL event information from this document into a single JSON object. Return ONLY the JSON, no other text. Use these exact keys (omit any that are not found):\n'
    + '{\n'
    + '  \"event\": { \"name\": string, \"client\": string, \"date\": \"YYYY-MM-DD\", \"guests\": number, \"venue\": string, \"notes\": string },\n'
    + '  \"billing\": { \"hours\": number, \"hourlyRate\": number, \"travelSetup\": number, \"depositPaid\": number, \"taxEnabled\": boolean, \"discountAmt\": number },\n'
    + '  \"cocktails\": [ { \"name\": string, \"category\": string, \"dpg\": number, \"notes\": string, \"ingredients\": [ { \"name\": string, \"qty\": number, \"unit\": string, \"cost\": number } ] } ],\n'
    + '  \"shoppingList\": [ { \"item\": string, \"qty\": number, \"unit\": string, \"store\": string, \"estimatedCost\": number } ],\n'
    + '  \"timetable\": [ { \"time\": string, \"duration\": string, \"task\": string, \"notes\": string } ],\n'
    + '  \"staff\": [ { \"name\": string, \"role\": string, \"hours\": number, \"rate\": number } ],\n'
    + '  \"materials\": [ { \"item\": string, \"qty\": number, \"unit\": string, \"cost\": number } ]\n'
    + '}\n'
    + 'For ingredients/items with unknown cost, use 0. For unknown numbers, omit the field.';
}

async function fileToBase64(file){
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result.split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

async function fileToText(file){
  const name = (file.name||'').toLowerCase();
  if(name.endsWith('.docx') || (file.type||'').includes('wordprocessingml')){
    return await extractDocxText(file);
  }
  return new Promise((res,rej)=>{
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = rej;
    fr.readAsText(file);
  });
}

async function extractDocxText(file){
  if(!window.JSZip){
    await new Promise((res,rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  const ab = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(ab);
  const xmlFile = zip.file('word/document.xml');
  if(!xmlFile) throw new Error('Not a valid DOCX file');
  const xml = await xmlFile.async('string');
  const text = xml
    .replace(/<w:p[ >]/g, '\n<w:p')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,"'").replace(/&quot;/g,'"')
    .replace(/\n{3,}/g,'\n\n').trim();
  return text;
}

function renderImportPreview(data){
  const body = el('importModalBody');
  if(!body) return;

  const sections = [];

  // ── EVENT DETAILS ──
  if(data.event && Object.keys(data.event).some(k => data.event[k])){
    const ev = data.event;
    const currentName = v('eventLabel') || v('cn') || '';
    const willOverwrite = currentName && currentName !== (ev.name||ev.client||'');
    sections.push({
      key: 'event',
      icon: '📋',
      title: 'Event details',
      tag: willOverwrite ? 'overwrite' : 'new',
      fields: [
        {label:'Event name', key:'name', val:ev.name||ev.client||'', input:'text'},
        {label:'Client', key:'client', val:ev.client||ev.name||'', input:'text'},
        {label:'Date', key:'date', val:ev.date||'', input:'date'},
        {label:'Guests', key:'guests', val:ev.guests||'', input:'number'},
        {label:'Venue', key:'venue', val:ev.venue||'', input:'text'},
        {label:'Notes', key:'notes', val:ev.notes||'', input:'textarea'},
      ].filter(f => f.val !== '' && f.val !== undefined)
    });
  }

  // ── BILLING ──
  if(data.billing && Object.values(data.billing).some(v2 => v2)){
    const b = data.billing;
    sections.push({
      key: 'billing',
      icon: '💰',
      title: 'Billing & rates',
      tag: 'new',
      fields: [
        {label:'Hours', key:'hours', val:b.hours||'', input:'number'},
        {label:'Hourly rate ($)', key:'hourlyRate', val:b.hourlyRate||'', input:'number'},
        {label:'Travel/setup ($)', key:'travelSetup', val:b.travelSetup||'', input:'number'},
        {label:'Deposit paid ($)', key:'depositPaid', val:b.depositPaid||'', input:'number'},
        {label:'Discount ($)', key:'discountAmt', val:b.discountAmt||'', input:'number'},
      ].filter(f => f.val !== '' && f.val !== undefined && f.val !== 0)
    });
  }

  // ── COCKTAILS ──
  if(data.cocktails && data.cocktails.length){
    const existing = data.cocktails.filter(r => cocktails.some(c2 => c2.name.toLowerCase() === r.name.toLowerCase())).length;
    const newCount = data.cocktails.length - existing;
    sections.push({
      key: 'cocktails',
      icon: '🍹',
      title: data.cocktails.length + ' cocktail' + (data.cocktails.length!==1?'s':'') + ' (' + newCount + ' new' + (existing?' · '+existing+' already in menu':'') + ')',
      tag: 'new',
      fields: [],
      preview: data.cocktails.map(r => {
        const inMenu = cocktails.some(c2 => c2.name.toLowerCase() === r.name.toLowerCase());
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid #f5f5f0;font-size:13px;">'
          + '<span style="font-weight:500;">' + r.name + '</span>'
          + '<span style="font-size:11px;' + (inMenu?'color:#aaa;">already in menu':'color:#1a7a4a;">+ new') + '</span>'
          + '</div>';
      }).join('')
    });
  }

  // ── SHOPPING LIST ──
  if(data.shoppingList && data.shoppingList.length){
    sections.push({
      key: 'shoppingList',
      icon: '🛒',
      title: data.shoppingList.length + ' shopping items',
      tag: 'new',
      fields: [],
      preview: '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:4px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding-bottom:4px;border-bottom:1px solid #eee;margin-bottom:4px;"><span>Item</span><span>Qty</span><span>Store</span></div>'
        + data.shoppingList.map(s => '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:4px;font-size:12px;padding:3px 0;border-bottom:.5px solid #f5f5f0;"><span>' + s.item + '</span><span>' + (s.qty||'') + ' ' + (s.unit||'') + '</span><span style="color:#888;">' + (s.store||'—') + '</span></div>').join('')
    });
  }

  // ── TIMETABLE ──
  if(data.timetable && data.timetable.length){
    sections.push({
      key: 'timetable',
      icon: '⏰',
      title: data.timetable.length + ' timetable entries',
      tag: 'new',
      fields: [],
      preview: data.timetable.map(t => '<div style="display:grid;grid-template-columns:80px 1fr;gap:8px;padding:5px 0;border-bottom:.5px solid #f5f5f0;font-size:13px;"><span style="font-weight:500;color:#2156b8;">' + (t.time||'') + '</span><div><div>' + (t.task||'') + '</div>' + (t.notes?'<div style="font-size:11px;color:#aaa;">'+t.notes+'</div>':'') + '</div></div>').join('')
    });
  }

  // ── STAFF ──
  if(data.staff && data.staff.length){
    sections.push({
      key: 'staff',
      icon: '👥',
      title: data.staff.length + ' staff member' + (data.staff.length!==1?'s':''),
      tag: 'new',
      fields: [],
      preview: data.staff.map(s => '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;font-size:13px;padding:5px 0;border-bottom:.5px solid #f5f5f0;"><span style="font-weight:500;">' + (s.name||'Unnamed') + '</span><span style="color:#888;">' + (s.role||'') + '</span><span style="color:#888;">' + (s.hours||'?') + ' hrs</span><span style="color:#888;">$' + (s.rate||0) + '/hr</span></div>').join('')
    });
  }

  // ── MATERIALS ──
  if(data.materials && data.materials.length){
    sections.push({
      key: 'materials',
      icon: '📦',
      title: data.materials.length + ' materials / supplies',
      tag: 'new',
      fields: [],
      preview: data.materials.map(m => '<div style="font-size:13px;padding:4px 0;border-bottom:.5px solid #f5f5f0;">' + (m.item||'') + ' · ' + (m.qty||'') + ' ' + (m.unit||'') + (m.cost?' · $'+m.cost:'') + '</div>').join('')
    });
  }

  if(!sections.length){
    body.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;">No structured data found in the document.<br>Try saving it as a .txt file and re-importing.</div>';
    return;
  }

  // Build section HTML
  let html = '';
  let totalItems = 0;
  sections.forEach(sec => {
    totalItems += sec.fields.length + (sec.preview ? 1 : 0);
    const tagHTML = '<span class="import-tag tag-' + sec.tag + '">' + (sec.tag==='overwrite'?'will overwrite':sec.tag==='new'?'will add':'skip') + '</span>';

    html += '<div class="import-section" id="isec_' + sec.key + '">';
    html += '<div class="import-section-hdr accepted" onclick=\"toggleImportSection(\" + sec.key + \")\">';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span>' + sec.icon + '</span><span style="font-weight:500;font-size:13px;">' + sec.title + '</span>' + tagHTML + '</div>';
    html += '<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:#888;" id="isec_check_' + sec.key + '">✓ Include</span><span style="font-size:12px;color:#aaa;">▲</span></div>';
    html += '</div>';
    html += '<div class="import-section-body" id="isec_body_' + sec.key + '">';

    if(sec.fields.length){
      sec.fields.forEach(f => {
        html += '<div class="import-field-row"><div class="import-field-label">' + f.label + '</div>';
        html += '<div class="import-field-value">';
        if(f.input === 'textarea'){
          html += '<textarea data-sec="' + sec.key + '" data-key="' + f.key + '">' + (f.val||'').replace(/<[^>]+>/g,'') + '</textarea>';
        } else {
          html += '<input type="' + f.input + '" value="' + String(f.val||'').replace(/"/g,'&quot;') + '" data-sec="' + sec.key + '" data-key="' + f.key + '" style="width:100%;border:none;outline:none;font-size:13px;font-family:inherit;">';
        }
        html += '</div></div>';
      });
    }
    if(sec.preview){
      html += '<div style="font-size:12px;color:#aaa;margin-bottom:6px;">Preview — edit in the tool after importing:</div>';
      html += sec.preview;
    }
    html += '</div></div>';
  });

  body.innerHTML = html;
  gc2('importSummaryLine', sections.length + ' sections ready');
}

function toggleImportSection(key){
  const hdr = el('isec_' + key) ? el('isec_' + key).querySelector('.import-section-hdr') : null;
  const body = el('isec_body_' + key);
  const check = el('isec_check_' + key);
  if(!hdr || !body) return;
  const included = hdr.classList.contains('accepted');
  if(included){
    hdr.classList.remove('accepted');
    hdr.classList.add('skipped');
    body.style.display = 'none';
    if(check) check.textContent = '○ Skip';
  } else {
    hdr.classList.add('accepted');
    hdr.classList.remove('skipped');
    body.style.display = '';
    if(check) check.textContent = '✓ Include';
  }
}

function getImportSectionValues(key){
  const body = el('isec_body_' + key);
  if(!body) return {};
  const vals = {};
  body.querySelectorAll('[data-key]').forEach(inp => {
    vals[inp.dataset.key] = inp.value;
  });
  return vals;
}

function isSectionIncluded(key){
  const hdr = el('isec_' + key);
  if(!hdr) return false;
  return hdr.querySelector('.import-section-hdr')?.classList.contains('accepted');
}

function saveImportedData(){
  if(!importedData){ closeImportModal(); return; }
  const d = importedData;
  let saved = [];

  // ── Event details ──
  if(isSectionIncluded('event')){
    const vals = getImportSectionValues('event');
    if(vals.name || vals.client) sv('eventLabel', vals.name || vals.client || '');
    if(vals.client || vals.name) sv('cn', vals.client || vals.name || '');
    if(vals.date) sv('ed', vals.date);
    if(vals.guests) sv('gc', parseInt(vals.guests)||50);
    if(vals.notes) sv('qn', vals.notes);
    saved.push('event details');
  }

  // ── Billing ──
  if(isSectionIncluded('billing')){
    const vals = getImportSectionValues('billing');
    if(vals.hours) sv('eventHrs', parseFloat(vals.hours)||4);
    if(vals.hourlyRate) sv('hr', parseFloat(vals.hourlyRate)||100);
    if(vals.travelSetup) sv('tf', parseFloat(vals.travelSetup)||0);
    if(vals.depositPaid) sv('depositAmt', parseFloat(vals.depositPaid)||0);
    if(vals.discountAmt) sv('discountAmt', parseFloat(vals.discountAmt)||0);
    saved.push('billing');
  }

  // ── Cocktails ──
  if(isSectionIncluded('cocktails') && d.cocktails && d.cocktails.length){
    const newOnes = d.cocktails.filter(r => !cocktails.some(c2 => c2.name.toLowerCase() === r.name.toLowerCase()));
    newOnes.forEach(r => {
      const ing = (r.ingredients||[]).map(i => ({
        n: i.name||i.n||'', q: parseFloat(i.qty||i.q)||1,
        u: i.unit||i.u||'oz', c: parseFloat(i.cost||i.c)||0
      }));
      const flat = INGFLAT;
      ing.forEach(i => {
        const match = flat.find(f => f.name.toLowerCase() === i.n.toLowerCase());
        if(match && i.c === 0) i.c = match.c;
      });
      cocktails.push({id: Date.now()+Math.random(), name:r.name, cat:r.category||'Imported', dpg:parseFloat(r.dpg)||1, ing});
    });
    rC(); rShop();
    saved.push(newOnes.length + ' cocktails');
  }

  // ── Staff ──
  if(isSectionIncluded('staff') && d.staff && d.staff.length){
    d.staff.forEach(s => {
      staffList.push({
        id: 'st_' + Date.now() + Math.random().toString(36).slice(2,4),
        name: s.name||'', role: s.role||'Bartender',
        rate: parseFloat(s.rate)||0, hours: parseFloat(s.hours)||4
      });
    });
    renderStaff();
    saved.push(d.staff.length + ' staff');
  }

  // ── Timetable → save to post-event notes for now ──
  if(isSectionIncluded('timetable') && d.timetable && d.timetable.length){
    const ttText = d.timetable.map(t => (t.time||'?') + ' — ' + (t.task||'') + (t.notes?' ('+t.notes+')':'')).join('\n');
    const existing = v('qn');
    sv('qn', (existing ? existing + '\n\n' : '') + 'TIMETABLE:\n' + ttText);
    saved.push('timetable');
  }

  // ── Shopping list items → add as manual inventory notes ──
  if(isSectionIncluded('shoppingList') && d.shoppingList && d.shoppingList.length){
    // Add to current stock as manual entries to track
    d.shoppingList.forEach(item => {
      const key = (item.item||'').toLowerCase().trim();
      if(!key) return;
      if(!currentStock[key]){
        currentStock[key] = {
          name: item.item, unit: item.unit||'piece',
          qty: parseFloat(item.qty)||1, cpu: parseFloat(item.estimatedCost)||0,
          store: item.store||'', source: 'import', lastUpdated: new Date().toISOString().split('T')[0]
        };
      }
    });
    saveStock();
    saved.push(d.shoppingList.length + ' shopping items');
  }

  rQ(); syncSettings(); markUnsaved();
  closeImportModal();

  const msg = saved.length ? 'Imported: ' + saved.join(' · ') : 'Nothing was imported';
  showToast('✓ ' + msg, 'success');
}

// ════════════════════════════════════════════════════════════
  el('importModalBg').classList.remove('open');
  importedData = null;
}


