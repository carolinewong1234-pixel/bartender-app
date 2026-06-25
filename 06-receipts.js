// ═══ RECEIPTS & PRICE TRACKING ═══
// Receipt scanner modal, receipt manager tab, price history,
// price intelligence, retailer search, library prices

function openReceiptScanner(){
  el('receiptScanBg').style.display = 'flex';
  el('receiptPreviewWrap').style.display = 'none';
  el('receiptStatus').style.display = 'none';
  el('receiptResults').style.display = 'none';
  receiptImageBase64 = null;
}
function closeReceiptScanner(){ el('receiptScanBg').style.display = 'none'; }

// handleReceiptDrop — defined in receipt manager section below

function handleReceiptFile(file){
  if(!file) return;
  receiptImageType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = function(ev){
    receiptImageBase64 = ev.target.result.split(',')[1];
    el('receiptPreview').src = ev.target.result;
    el('receiptPreviewWrap').style.display = '';
    el('receiptResults').style.display = 'none';
    el('receiptStatus').style.display = 'none';
  };
  reader.readAsDataURL(file);
}

async function scanReceiptWithClaude(){
  if(!receiptImageBase64){ showToast('No image loaded','error'); return; }
  const btn = el('scanBtn');
  btn.disabled = true; btn.textContent = '⏳ Reading receipt…';
  el('receiptStatus').style.display = '';
  el('receiptStatus').innerHTML = '🤖 Claude is reading your receipt…';
  el('receiptResults').style.display = 'none';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: receiptImageType, data: receiptImageBase64 }
            },
            {
              type: 'text',
              text: 'This is a grocery or liquor store receipt. Extract every purchased item. Return ONLY a JSON array, no markdown, no explanation. Each item: {"name": "product name in English", "qty": number_of_units, "unit_price": price_per_unit_in_dollars, "total": line_total, "unit": "bottle|L|kg|each", "bottle_size_ml": ml_if_applicable_else_null}. For multi-line items (e.g. "3 @ 6.99 / ITEM NAME / 20.97"), parse as qty=3, unit_price=6.99, total=20.97. Translate French product names to English where obvious. Skip eco fees, taxes, deposits, totals.'
            }
          ]
        }]
      })
    });

    const data = await response.json();
    if(!data.content || !data.content[0]) throw new Error('No response from API');

    let raw = data.content[0].text || '';
    // Strip markdown fences if present
    raw = raw.replace(/```json/g,'').replace(/```/g,'').trim();
    receiptExtractedItems = JSON.parse(raw);

    if(!Array.isArray(receiptExtractedItems) || !receiptExtractedItems.length){
      throw new Error('No items found');
    }

    // Render results
    renderReceiptItems();
    el('receiptStatus').style.display = 'none';
    el('receiptResults').style.display = '';

  } catch(err){
    el('receiptStatus').innerHTML = '⚠️ Error: ' + err.message + '. Try a clearer photo.';
    console.error('Receipt scan error:', err);
  }
  btn.disabled = false; btn.textContent = '✨ Extract ingredients with AI';
}

function renderReceiptItems(){
  const list = el('receiptItemList');
  list.innerHTML = receiptExtractedItems.map(function(item, idx){
    const sizeLabel = item.bottle_size_ml ? item.bottle_size_ml + 'ml' : '';
    const unitCost = item.unit_price || (item.total && item.qty ? (item.total/item.qty).toFixed(2) : '?');
    return '<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1.5px solid var(--border);border-radius:var(--radius-lg);cursor:pointer;background:var(--surface);">'
      + '<input type="checkbox" data-idx="'+idx+'" checked style="width:16px;height:16px;flex-shrink:0;">'
      + '<div style="flex:1;min-width:0;">'
      +   '<div style="font-weight:600;font-size:13px;">'+item.name+(sizeLabel?' <span style="font-weight:400;color:var(--text3);">'+sizeLabel+'</span>':'')+'</div>'
      +   '<div style="font-size:11px;color:var(--text3);">'+item.qty+' × $'+unitCost+' = $'+(item.total||'?')+'</div>'
      + '</div>'
      + '<div style="font-size:12px;color:var(--green);font-weight:600;">$'+unitCost+'/'+(item.unit||'unit')+'</div>'
      + '</label>';
  }).join('');
}

function selectAllReceiptItems(){
  el('receiptItemList').querySelectorAll('input[type=checkbox]').forEach(function(cb){ cb.checked = true; });
}

function importSelectedReceiptItems(){
  const checked = el('receiptItemList').querySelectorAll('input[type=checkbox]:checked');
  let imported = 0;
  checked.forEach(function(cb){
    const item = receiptExtractedItems[parseInt(cb.dataset.idx)];
    if(!item) return;
    const unitPrice = item.unit_price || (item.total && item.qty ? item.total/item.qty : 0);
    const newIng = {
      id: 'qi_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      name: item.name,
      bottleSize: item.bottle_size_ml || (item.unit === 'L' ? 1000 : 750),
      sizeUnit: 'ml',
      price: parseFloat(unitPrice.toFixed(2)),
      retailer: 'Receipt import',
      cat: 'Spirits',
      addedAt: new Date().toISOString(),
      flavorTags: []
    };
    myIngredients.unshift(newIng);
    imported++;
  });
  if(imported){
    saveMyDB(); syncMyDBtoFlat(); renderMyDB();
    showToast('✓ '+imported+' ingredient'+(imported>1?'s':'')+' imported from receipt','success');
    closeReceiptScanner();
  } else {
    showToast('No items selected','error');
  }
}
// ═══ END RECEIPT SCANNER ═══
let receipts = [];

function loadReceipts(){
  try {
    const stored = localStorage.getItem('bartender_receipts_v1');
    if(stored) receipts = JSON.parse(stored);
  } catch(e){ receipts = []; }
}

function saveReceipts(){
  try { localStorage.setItem('bartender_receipts_v1', JSON.stringify(receipts)); }
  catch(e){ console.error('Could not save receipts:', e); }
}

function handleReceiptDrop(e){
  e.preventDefault();
  el('receiptDrop').classList.remove('dragover');
  handleReceiptFiles(e.dataTransfer.files);
}

function handleReceiptFiles(files){
  if(!files || !files.length) return;
  Array.from(files).forEach(f => scanReceipt(f));
}

async function fileToBase64(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Strip the data URL prefix to get pure base64
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function scanReceipt(file){
  const statusEl = el('scanningStatus');
  const msgEl = el('scanningMsg');
  const detailEl = el('scanningDetail');
  if(statusEl) statusEl.style.display = 'block';
  if(msgEl) msgEl.textContent = 'Reading ' + file.name + '...';
  if(detailEl) detailEl.textContent = 'Sending to Claude AI for analysis...';

  try {
    const base64 = await fileToBase64(file);
    const isPDF = file.type === 'application/pdf';
    const mediaType = isPDF ? 'application/pdf' : (file.type || 'image/jpeg');
    const eventLabel = v('eventLabel') || 'Unnamed event';
    const today = new Date().toISOString().split('T')[0];

    const prompt = `You are scanning a receipt from a Montreal bartender/mixologist.

Extract ALL line items from this receipt image. For each item identify:
- The product name (as printed)
- Quantity purchased
- Unit price
- Total line price
- Best guess at the ingredient category (spirit, wine, mixer, garnish, syrup, etc.)
- Whether it looks like a bar/cocktail ingredient

Also extract:
- Store name
- Date of purchase (if visible)
- Receipt subtotal, taxes (TPS/TVQ if visible), and grand total
- Payment method if visible

Then try to MATCH each item to common bar ingredients. For example:
- "BOMBAY SAPH 750ML" → "Bombay Sapphire gin"
- "HAVANA CLUB 3ANS" → "Havana Club 3 ans rum"  
- "CITRONS 3PK" → "Lemon (fresh)"
- "SODA PERRIER 1L" → "Sparkling water (Perrier)"

Respond ONLY with this exact JSON structure, no markdown:
{
  "store": "Store name",
  "date": "YYYY-MM-DD or null",
  "subtotal": 0.00,
  "tps": 0.00,
  "tvq": 0.00,
  "total": 0.00,
  "payment_method": "card/cash/unknown",
  "items": [
    {
      "raw_name": "Exactly as printed on receipt",
      "matched_ingredient": "Best match to common bar ingredient or null",
      "quantity": 1,
      "unit_price": 0.00,
      "total_price": 0.00,
      "category": "spirit/wine/mixer/garnish/syrup/other",
      "is_bar_ingredient": true,
      "is_promo": false,
      "regular_price": null
    }
  ]
}`;

    if(detailEl) detailEl.textContent = 'Analyzing line items and matching ingredients...';

    const messageContent = isPDF
      ? [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
         { type: 'text', text: prompt }]
      : [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
         { type: 'text', text: prompt }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: messageContent }]
      })
    });

    if(!response.ok) throw new Error('API error ' + response.status);
    const data = await response.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if(!jsonMatch) throw new Error('No JSON in response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Build receipt record
    const receipt = {
      id: 'rcpt_' + Date.now(),
      fileName: file.name,
      scannedAt: new Date().toISOString(),
      eventLabel,
      store: parsed.store || 'Unknown store',
      date: parsed.date || today,
      subtotal: parsed.subtotal || 0,
      tps: parsed.tps || 0,
      tvq: parsed.tvq || 0,
      total: parsed.total || 0,
      paymentMethod: parsed.payment_method || 'unknown',
      items: parsed.items || [],
      pricesUpdated: [],
      expanded: true
    };

    // Auto-update ingredient prices in database AND price history
    if(detailEl) detailEl.textContent = 'Matching ingredients and updating prices...';
    const updated = [];
    receipt.items.forEach(item => {
      if(!item.matched_ingredient || !item.unit_price || item.unit_price <= 0) return;
      // Calculate per-oz cost for spirits (750ml = 25.36 oz)
      let costPerUnit = item.unit_price;
      let unit = 'piece';
      const cat = (item.category || '').toLowerCase();
      if(cat === 'spirit' || cat === 'wine' || cat === 'liqueur' || cat === 'mixer') {
        // Check if it looks like a bottle (price > 8 usually means bottle not unit)
        if(item.unit_price > 8) {
          const bottleOz = 25.36; // assume 750ml
          costPerUnit = parseFloat((item.unit_price / bottleOz).toFixed(4));
          unit = 'oz';
        } else {
          unit = 'oz';
        }
      } else if(cat === 'garnish') {
        unit = 'piece';
      }

      // Find in INGFLAT (built-in or custom)
      const nameLC = item.matched_ingredient.toLowerCase();
      const existing = INGFLAT.find(i => i.name.toLowerCase() === nameLC || 
        i.name.toLowerCase().includes(nameLC.split(' ')[0]) ||
        nameLC.includes(i.name.toLowerCase().split(' ')[0]));

      const note = receipt.store + ' $' + item.unit_price.toFixed(2) + ' · ' + receipt.date;
      // Record in price history
      recordPrice(item.matched_ingredient, costPerUnit, unit, receipt.store, 'receipt', receipt.id, item.is_promo||false, item.regular_price||null);

      if(existing) {
        const oldPrice = existing.c;
        existing.c = costPerUnit;
        updated.push({ name: existing.name, oldPrice, newPrice: costPerUnit, unit, store: receipt.store });
        // Also update custom DB if it's a custom ingredient
        const customIdx = myIngredients.findIndex(i => i.name.toLowerCase() === existing.name.toLowerCase());
        if(customIdx >= 0) {
          myIngredients[customIdx].c = costPerUnit;
          myIngredients[customIdx].note = note;
          saveMyDB();
        }
      } else {
        // Add to custom DB as new ingredient
        const newIng = {
          name: item.matched_ingredient,
          unit,
          c: costPerUnit,
          note,
          cat: '🧾 Scanned from receipts',
          addedAt: new Date().toISOString()
        };
        myIngredients.push(newIng);
        INGFLAT.unshift({...newIng, _custom: true});
        saveMyDB();
        updated.push({ name: item.matched_ingredient, oldPrice: null, newPrice: costPerUnit, unit, store: receipt.store, isNew: true });
      }
    });

    receipt.pricesUpdated = updated;
    receipts.unshift(receipt); // newest first
    saveReceipts();

    if(statusEl) statusEl.style.display = 'none';
    renderReceipts();

    // Show summary toast
    const barItems = receipt.items.filter(i => i.is_bar_ingredient).length;
    const msg = updated.length > 0
      ? updated.length + ' ingredient price' + (updated.length > 1 ? 's' : '') + ' updated from ' + receipt.store
      : 'Receipt scanned — ' + barItems + ' bar items found';
    showToast(msg, 'success');

    // Run shopping list sync analysis
    analyzeReceiptVsShoppingList(receipt);

  } catch(err) {
    console.error('Receipt scan error:', err);
    if(statusEl) statusEl.style.display = 'none';
    showToast('Could not read receipt — try a clearer photo or check your connection', 'error');
  }
}

function toggleReceipt(id) {
  const r = receipts.find(r => r.id === id);
  if(r) { r.expanded = !r.expanded; renderReceipts(); }
}

function deleteReceipt(id) {
  if(!confirm('Delete this receipt?')) return;
  receipts = receipts.filter(r => r.id !== id);
  saveReceipts();
  renderReceipts();
}

function clearAllReceipts() {
  if(!confirm('Delete all scanned receipts? This cannot be undone.')) return;
  receipts = [];
  saveReceipts();
  renderReceipts();
}

function analyzeReceiptVsShoppingList(receipt){
  if(!cocktails.length) return; // no menu to compare against

  const guests = vi('gc');
  const {effectiveGuests} = getConsumptionGuests();
  const items = getIM(effectiveGuests);
  if(!items.length) return;

  const analysis = [];
  const receiptBarItems = receipt.items.filter(i => i.is_bar_ingredient && i.matched_ingredient);

  items.forEach(neededItem => {
    // Try to find this ingredient in the receipt
    const matched = receiptBarItems.find(ri => {
      const riName = (ri.matched_ingredient || '').toLowerCase();
      const needName = neededItem.name.toLowerCase();
      return riName === needName ||
        riName.includes(needName.split(' ')[0]) ||
        needName.includes(riName.split(' ')[0]);
    });

    if(matched){
      // Found — check if price is significantly higher than expected
      const receiptUnitPrice = matched.unit_price || 0;
      const expectedBottlePrice = neededItem.cpu * 25.36; // convert oz price to bottle
      const priceDiff = receiptUnitPrice - expectedBottlePrice;
      const pctDiff = expectedBottlePrice > 0 ? (priceDiff / expectedBottlePrice) * 100 : 0;

      analysis.push({
        name: neededItem.name,
        status: 'purchased',
        receiptPrice: receiptUnitPrice,
        expectedPrice: expectedBottlePrice,
        pctDiff: pctDiff,
        overpaid: pctDiff > 15, // flag if >15% more than expected
        rawName: matched.raw_name
      });
    } else {
      // Not found on this receipt
      analysis.push({
        name: neededItem.name,
        status: 'not_found',
        needed: neededItem.bottleInfo ? neededItem.bottles + ' bottle(s)' : neededItem.qtyRaw.toFixed(1) + ' ' + neededItem.unit
      });
    }
  });

  // Store analysis on the receipt
  receipt.shoppingAnalysis = analysis;
  saveReceipts();

  // Show a quick banner if there are overpaid items
  const overpaid = analysis.filter(a => a.overpaid);
  const notFound = analysis.filter(a => a.status === 'not_found');
  const purchased = analysis.filter(a => a.status === 'purchased');

  if(overpaid.length > 0){
    const names = overpaid.slice(0,2).map(a => a.name).join(', ');
    showToast('⚠ ' + overpaid.length + ' item(s) bought at higher price than expected: ' + names + '. Check Price IQ tab.', 'error');
  }

  // Render analysis on the receipt card
  renderReceipts();
}

function renderReceipts() {
  // Summary metrics
  const totalSpent = receipts.reduce((s,r) => s+r.total, 0);
  const totalItems = receipts.reduce((s,r) => s+r.items.length, 0);
  const totalUpdated = receipts.reduce((s,r) => s+r.pricesUpdated.length, 0);
  const quotedTotal = (() => {
    try {
      const guests=vi('gc'),hours=vf('eventHrs'),rate=vf('hr'),travel=vf('tf');
  const marginPct=getMpAsMargin();
  const mkup = marginPct < 100 ? (marginPct/(100-marginPct))*100 : marginPct; // convert to markup for calc
      // Render event selector
  renderShopEventSelector();
  const items=getShopItems(guests);
      const purchase=items.reduce((s,i)=>s+i.purchaseCost,0);
      const mked=purchase*(1+mkup/100),labor=hours*rate;
      const staffLbr=getStaffLaborTotal();
      return mked+labor+staffLbr+travel;
    } catch(e){ return 0; }
  })();
  const diff = quotedTotal - totalSpent;

  shtml('receiptsSummary', receipts.length === 0 ? '' : `
    <div class="met"><div class="ml">Receipts scanned</div><div class="mv">${receipts.length}</div></div>
    <div class="met"><div class="ml">Total spent</div><div class="mv">$${totalSpent.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Items found</div><div class="mv">${totalItems}</div></div>
    <div class="met"><div class="ml">Prices updated</div><div class="mv">${totalUpdated}</div></div>`);

  // Expense vs quote panel
  if(quotedTotal > 0 && totalSpent > 0) {
    const pct = Math.round((diff/quotedTotal)*100);
    shtml('expenseVsQuote', `
      <div class="card" style="margin-bottom:1rem;">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">📊 Actual spend vs quoted</div>
        <div class="expense-vs-quote">
          <div class="evt-met"><div class="ml">Quoted to client</div><div class="mv">$${quotedTotal.toFixed(2)}</div></div>
          <div class="evt-met"><div class="ml">Actually spent</div><div class="mv">$${totalSpent.toFixed(2)}</div></div>
          <div class="evt-met ${diff >= 0 ? 'profit' : 'loss'}">
            <div class="ml">${diff >= 0 ? '✓ Under budget' : '⚠ Over budget'}</div>
            <div class="mv" style="color:${diff>=0?'#1a7a4a':'#c0392b'};">${diff>=0?'+':''} $${diff.toFixed(2)}</div>
          </div>
        </div>
        <div style="font-size:12px;color:#888;">
          ${diff >= 0 
            ? 'You came in ' + pct + '% under your quote — ' + (diff >= 0 ? '$' + diff.toFixed(2) + ' more in your pocket' : '')
            : 'You spent ' + Math.abs(pct) + '% more than quoted — consider adjusting your markup or pricing'}
        </div>
      </div>`);
  } else {
    shtml('expenseVsQuote', '');
  }

  if(!receipts.length) {
    shtml('receiptsList', '<div class="empty" style="padding:2rem;text-align:center;color:#aaa;">No receipts scanned yet — upload a photo or PDF above</div>');
    return;
  }

  shtml('receiptsList', receipts.map(r => {
    const barItems = r.items.filter(i => i.is_bar_ingredient);
    const otherItems = r.items.filter(i => !i.is_bar_ingredient);
    return `
      <div class="receipt-card">
        <div class="receipt-header" onclick="toggleReceipt('${r.id}')">
          <div>
            <div class="receipt-store">${r.store}</div>
            <div class="receipt-meta">${r.date} · ${r.items.length} items · ${r.pricesUpdated.length} prices updated · ${r.eventLabel}</div>
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="receipt-total">$${r.total.toFixed(2)} CAD</div>
            <span style="font-size:11px;color:#aaa;">${r.expanded ? '▲' : '▼'}</span>
            <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteReceipt('${r.id}')" title="Delete">✕</button>
          </div>
        </div>
        <div class="receipt-body ${r.expanded ? 'open' : ''}">
          ${r.tps > 0 || r.tvq > 0 ? `
            <div style="display:flex;gap:16px;font-size:12px;color:#888;padding:6px 0;border-bottom:1px solid #f0f0eb;margin-bottom:8px;">
              <span>Subtotal: $${r.subtotal.toFixed(2)}</span>
              ${r.tps>0?`<span>TPS: $${r.tps.toFixed(2)}</span>`:''}
              ${r.tvq>0?`<span>TVQ: $${r.tvq.toFixed(2)}</span>`:''}
              <span style="font-weight:500;color:#1a1a1a;">Total: $${r.total.toFixed(2)}</span>
              ${r.paymentMethod!=='unknown'?`<span>Paid by ${r.paymentMethod}</span>`:''}
            </div>` : ''}
          ${barItems.length > 0 ? `
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#1a7a4a;padding:4px 0 6px;">🍹 Bar ingredients (${barItems.length})</div>
            <div class="receipt-item receipt-item-header">
              <span>Item</span><span>Matched to</span><span>Qty</span><span>Price</span><span>Status</span>
            </div>
            ${barItems.map(item => {
              const wasUpdated = r.pricesUpdated.find(u => u.name && item.matched_ingredient && 
                u.name.toLowerCase().includes(item.matched_ingredient.toLowerCase().split(' ')[0]));
              const statusHtml = item.matched_ingredient
                ? wasUpdated
                  ? wasUpdated.isNew
                    ? '<span class="match-badge match-updated">+ Added</span>'
                    : '<span class="match-badge match-updated">↻ Updated</span>'
                  : '<span class="match-badge match-yes">✓ Matched</span>'
                : '<span class="match-badge match-no">No match</span>';
              return `<div class="receipt-item">
                <span style="font-weight:500;">${item.raw_name}</span>
                <span style="font-size:12px;color:#888;">${item.matched_ingredient || '—'}</span>
                <span>${item.quantity > 1 ? item.quantity + 'x' : ''}</span>
                <span>$${item.total_price.toFixed(2)}</span>
                <span>${statusHtml}</span>
              </div>`;
            }).join('')}` : ''}
          ${otherItems.length > 0 ? `
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;padding:8px 0 6px;margin-top:4px;">Other items (${otherItems.length})</div>
            ${otherItems.map(item => `
              <div class="receipt-item">
                <span style="color:#aaa;">${item.raw_name}</span>
                <span></span><span>${item.quantity > 1 ? item.quantity + 'x' : ''}</span>
                <span style="color:#aaa;">$${item.total_price.toFixed(2)}</span>
                <span></span>
              </div>`).join('')}` : ''}
          ${r.pricesUpdated.length > 0 ? `
            <div style="margin-top:10px;padding:8px 10px;background:#e8f0fd;border-radius:8px;font-size:12px;color:#2156b8;">
              <strong>Prices updated:</strong> ${r.pricesUpdated.map(u => 
                u.isNew ? u.name + ' added at $' + u.newPrice.toFixed(4) + '/' + u.unit
                : u.name + ' ' + (u.oldPrice ? '$' + u.oldPrice.toFixed(4) + ' → ' : '') + '$' + u.newPrice.toFixed(4) + '/' + u.unit
              ).join(' · ')}
            </div>` : ''}
          ${r.shoppingAnalysis && r.shoppingAnalysis.length ? (() => {
            const purchased = r.shoppingAnalysis.filter(a => a.status === 'purchased');
            const notFound = r.shoppingAnalysis.filter(a => a.status === 'not_found');
            const overpaid = r.shoppingAnalysis.filter(a => a.overpaid);
            if(!purchased.length && !notFound.length) return '';
            return '<div style="margin-top:10px;border:1px solid #e5e5e0;border-radius:8px;overflow:hidden;">'
              + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#666;padding:6px 10px;background:#fafaf7;border-bottom:1px solid #f0f0eb;">Shopping list match</div>'
              + purchased.map(a => {
                  const color = a.overpaid ? '#c0392b' : '#1a7a4a';
                  const flag = a.overpaid ? ' ⚠ +' + a.pctDiff.toFixed(0) + '% vs expected' : ' ✓';
                  return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 10px;font-size:12px;border-bottom:.5px solid #f5f5f0;">'
                    + '<span style="color:' + color + '">✓ ' + a.name + flag + '</span>'
                    + '<span style="color:' + color + ';font-weight:500;">$' + (a.receiptPrice||0).toFixed(2) + '</span></div>';
                }).join('')
              + (notFound.length ? '<div style="padding:5px 10px;font-size:12px;color:#c0392b;border-top:.5px solid #f5f5f0;">⚠ Not on this receipt: ' + notFound.map(a=>a.name).join(', ') + '</div>' : '')
              + '</div>';
          })() : ''}
        </div>
      </div>`;
  }).join(''));
}

function exportReceiptsCSV() {
  if(!receipts.length) { alert('No receipts to export.'); return; }
  const rows = [['Receipt ID','Store','Date','Event','Item (raw)','Matched ingredient','Qty','Unit price','Total','Bar ingredient','Category','TPS','TVQ','Receipt total']];
  receipts.forEach(r => {
    r.items.forEach(item => {
      rows.push([r.id, r.store, r.date, r.eventLabel, item.raw_name,
        item.matched_ingredient||'', item.quantity, item.unit_price.toFixed(2),
        item.total_price.toFixed(2), item.is_bar_ingredient?'yes':'no',
        item.category||'', r.tps.toFixed(2), r.tvq.toFixed(2), r.total.toFixed(2)]);
    });
  });
  const csv = rows.map(r => r.map(v => {
    const s = String(v==null?'':v);
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = (v('eventLabel')||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase() + '_receipts.csv';
  a.click();
}

// ════════════════════════════════════════════════════════════
// PRICE HISTORY — stores every price data point with source
// ════════════════════════════════════════════════════════════
let priceHistory = {}; // { ingredientName: [{date, price, unit, store, source:'receipt'|'lookup', receiptId?}] }

function loadPriceHistory(){
  try {
    const stored = localStorage.getItem('bartender_pricehistory_v1');
    if(stored) priceHistory = JSON.parse(stored);
  } catch(e){ priceHistory = {}; }
}

function savePriceHistory(){
  try { localStorage.setItem('bartender_pricehistory_v1', JSON.stringify(priceHistory)); }
  catch(e){ console.error('Could not save price history:', e); }
}

function recordPrice(ingredientName, pricePerUnit, unit, store, source, receiptId, isPromo, regularPrice){
  const key = ingredientName.toLowerCase().trim();
  if(!priceHistory[key]) priceHistory[key] = [];
  const today = new Date().toISOString().split('T')[0];
  const exists = priceHistory[key].find(p => p.date === today && p.store === store && p.source === source);
  if(exists){ exists.price = pricePerUnit; exists.isPromo = !!isPromo; if(regularPrice) exists.regularPrice = regularPrice; }
  else {
    priceHistory[key].unshift({
      date: today,
      price: pricePerUnit,
      unit,
      store: store || 'Unknown',
      source,
      receiptId: receiptId || null,
      isPromo: !!isPromo,
      regularPrice: regularPrice || null
    });
    // Keep only last 50 entries per ingredient
    if(priceHistory[key].length > 50) priceHistory[key] = priceHistory[key].slice(0, 50);
  }
  savePriceHistory();
}

function getLowestReceiptPrice(ingredientName){
  const key = ingredientName.toLowerCase().trim();
  const hist = priceHistory[key] || [];
  const receiptPrices = hist.filter(p => p.source === 'receipt');
  if(!receiptPrices.length) return null;
  return receiptPrices.reduce((min, p) => p.price < min.price ? p : min, receiptPrices[0]);
}

function getLatestReceiptPrice(ingredientName){
  const key = ingredientName.toLowerCase().trim();
  const hist = priceHistory[key] || [];
  return hist.find(p => p.source === 'receipt') || null;
}

function getPriceHistoryHTML(ingredientName){
  const key = ingredientName.toLowerCase().trim();
  const hist = (priceHistory[key] || []).slice(0, 6);
  if(!hist.length) return '';
  return hist.map(p =>
    `<span class="ph-pill ${p.source}">${p.date} $${p.price.toFixed(2)}/${p.unit} ${p.store}</span>`
  ).join('');
}

// ════════════════════════════════════════════════════════════
// PRICE IQ — variance analysis between receipt prices and market
// ════════════════════════════════════════════════════════════
let priceIQCache = null;

async function runPriceIQ(){
  // Gather all ingredients that have receipt price history
  const ingredients = [];
  Object.entries(priceHistory).forEach(([key, hist]) => {
    const receiptEntry = hist.find(p => p.source === 'receipt');
    if(receiptEntry){
      // Find the ingredient name in INGFLAT
      const ing = INGFLAT.find(i => i.name.toLowerCase() === key) ||
                  myIngredients.find(i => i.name.toLowerCase() === key);
      const displayName = ing ? ing.name : key;
      ingredients.push({
        name: displayName,
        receiptPrice: receiptEntry.price,
        receiptStore: receiptEntry.store,
        receiptDate: receiptEntry.date,
        unit: receiptEntry.unit
      });
    }
  });

  if(!ingredients.length){
    shtml('priceIQResult', `
      <div class="empty" style="padding:2rem;text-align:center;color:#aaa;">
        No receipt price data yet — scan some receipts first, then run the analysis.
      </div>`);
    return;
  }

  const statusEl = el('priceIQStatus');
  const msgEl = el('priceIQMsg');
  const detailEl = el('priceIQDetail');
  if(statusEl) statusEl.style.display = 'block';
  if(msgEl) msgEl.textContent = 'Searching current market prices...';
  if(detailEl) detailEl.textContent = `Analysing ${ingredients.length} ingredients across Montreal stores...`;
  shtml('priceIQResult', '');

  try {
    // Batch the ingredients in groups of 10 to avoid huge prompts
    const batchSize = 10;
    const allResults = [];

    for(let i = 0; i < ingredients.length; i += batchSize){
      const batch = ingredients.slice(i, i + batchSize);
      if(detailEl) detailEl.textContent = `Checking ${Math.min(i+batchSize, ingredients.length)} of ${ingredients.length} ingredients...`;

      const prompt = `You are a Montreal bar supply pricing expert with web search access.

For each ingredient below, find the CURRENT best available price in Montreal (May 2026) from any of these sources:
SAQ.com, IGA.net, Metro.ca, Maxi.ca, Super C, Walmart.ca, Costco.ca, Kim Phat, Amazon.ca

Also flag any items that appear to be ON PROMOTION right now (significantly below normal price).

Ingredients to check:
${batch.map((ing, idx) => (idx+1) + '. ' + ing.name + ' (unit: ' + ing.unit + ') - he paid $' + ing.receiptPrice.toFixed(4) + '/' + ing.unit + ' at ' + ing.receiptStore + ' on ' + ing.receiptDate).join('\n')}

For each ingredient respond with:
- best_price_per_unit: lowest current price per ${batch[0]?.unit || 'unit'} in CAD
- best_store: which store has this price
- normal_price_per_unit: typical non-promo price
- is_on_promo: true/false
- promo_note: short description if on promo (e.g. "Weekly special at Maxi until June 2")
- savings_vs_paid: difference between what he paid and best price (negative = he overpaid, positive = he got a deal)
- recommendation: one short sentence (max 10 words)

Respond ONLY with this JSON array — no markdown:
[{"ingredient": "name", "best_price_per_unit": 0.00, "best_store": "store", "normal_price_per_unit": 0.00, "is_on_promo": false, "promo_note": "", "savings_vs_paid": 0.00, "recommendation": "text"}]`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if(!response.ok) throw new Error('API error ' + response.status);
      const data = await response.json();
      const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if(jsonMatch){
        const batchResults = JSON.parse(jsonMatch[0]);
        // Merge with receipt data
        batchResults.forEach((result, idx) => {
          const ing = batch[idx];
          if(ing) allResults.push({ ...ing, ...result });
        });
      }
      // Small delay between batches
      if(i + batchSize < ingredients.length) await new Promise(r => setTimeout(r, 800));
    }

    priceIQCache = allResults;

    // Record online lookup prices in history
    allResults.forEach(r => {
      if(r.best_price_per_unit > 0){
        recordPrice(r.name, r.best_price_per_unit, r.unit, r.best_store, 'lookup');
      }
    });

    if(statusEl) statusEl.style.display = 'none';
    renderPriceIQ(allResults, ingredients.length);

  } catch(err) {
    console.error('Price IQ error:', err);
    if(statusEl) statusEl.style.display = 'none';
    showToast('Price analysis failed — check your connection and try again', 'error');
  }
}

function renderPriceIQ(results, total){
  if(!results || !results.length){
    shtml('priceIQResult', '<div class="empty">No results — try running the analysis again.</div>');
    return;
  }

  const overpaid   = results.filter(r => (r.savings_vs_paid || 0) < -0.005);
  const promos     = results.filter(r => r.is_on_promo);
  const optimal    = results.filter(r => Math.abs(r.savings_vs_paid || 0) <= 0.005);
  const got_deal   = results.filter(r => (r.savings_vs_paid || 0) > 0.005);
  const totalSavings = overpaid.reduce((s,r) => s + Math.abs(r.savings_vs_paid || 0), 0);

  // Summary cards
  const summaryHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:1.25rem;">
      <div class="met"><div class="ml">Ingredients analysed</div><div class="mv">${total}</div></div>
      <div class="met" style="${overpaid.length ? 'background:#fdf0ef;' : ''}">
        <div class="ml">Overpaying on</div>
        <div class="mv" style="${overpaid.length ? 'color:#c0392b;' : ''}">${overpaid.length}</div>
      </div>
      <div class="met" style="${promos.length ? 'background:#fdf5e8;' : ''}">
        <div class="ml">Promos available</div>
        <div class="mv" style="${promos.length ? 'color:#a06020;' : ''}">${promos.length}</div>
      </div>
      <div class="met" style="${totalSavings > 0 ? 'background:#edfaf3;' : ''}">
        <div class="ml">Potential savings/event</div>
        <div class="mv" style="${totalSavings > 0 ? 'color:#1a7a4a;' : ''}">$${totalSavings.toFixed(2)}</div>
      </div>
    </div>`;

  // Promo alerts
  const promoHTML = promos.length ? `
    <div style="margin-bottom:1.25rem;">
      <div class="section-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#a06020;margin-bottom:8px;">🔥 Promos right now — stock up!</div>
      ${promos.map(r => `
        <div class="savings-alert" style="background:#fdf5e8;border-color:#f0d080;">
          <div class="savings-alert-header" style="color:#a06020;">
            🏷 ${r.name}
            <span class="promo-badge">${r.promo_note || 'On promotion'}</span>
          </div>
          <div style="display:flex;gap:20px;font-size:12px;color:#666;margin-top:2px;">
            <span>He paid: <strong>$${r.receiptPrice.toFixed(4)}/${r.unit}</strong> at ${r.receiptStore}</span>
            <span>Promo price: <strong style="color:#1a7a4a;">$${(r.best_price_per_unit||0).toFixed(4)}/${r.unit}</strong> at ${r.best_store}</span>
            <span>Save: <strong style="color:#1a7a4a;">$${Math.abs(r.savings_vs_paid||0).toFixed(2)}/unit</strong></span>
          </div>
          <div style="font-size:11px;color:#a06020;margin-top:3px;">💡 ${r.recommendation}</div>
        </div>`).join('')}
    </div>` : '';

  // Overpaid items
  const overpaidHTML = overpaid.length ? `
    <div style="margin-bottom:1.25rem;">
      <div class="section-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#c0392b;margin-bottom:8px;">⚠ Overpaying — cheaper options available</div>
      <table class="pi-table">
        <tr><th>Ingredient</th><th>He paid</th><th>Best price</th><th>Store</th><th>Overpaying by</th><th>Action</th></tr>
        ${overpaid.sort((a,b) => (a.savings_vs_paid||0) - (b.savings_vs_paid||0)).map(r => `
          <tr>
            <td style="font-weight:500;">${r.name}</td>
            <td>$${r.receiptPrice.toFixed(4)}<br><span style="font-size:10px;color:#aaa;">${r.receiptStore}</span></td>
            <td style="color:#1a7a4a;font-weight:500;">$${(r.best_price_per_unit||0).toFixed(4)}</td>
            <td>${r.best_store}</td>
            <td class="var-loss">$${Math.abs(r.savings_vs_paid||0).toFixed(4)}</td>
            <td style="font-size:11px;color:#666;">${r.recommendation}</td>
          </tr>`).join('')}
      </table>
    </div>` : '';

  // Optimal / got a deal
  const goodHTML = (optimal.length || got_deal.length) ? `
    <div style="margin-bottom:1.25rem;">
      <div class="section-label" style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:#1a7a4a;margin-bottom:8px;">✓ Already at best price</div>
      <table class="pi-table">
        <tr><th>Ingredient</th><th>He paid</th><th>Market price</th><th>Store</th><th>Variance</th></tr>
        ${[...got_deal, ...optimal].map(r => `
          <tr>
            <td style="font-weight:500;">${r.name}</td>
            <td>$${r.receiptPrice.toFixed(4)}</td>
            <td>$${(r.best_price_per_unit||0).toFixed(4)}</td>
            <td>${r.best_store}</td>
            <td class="${(r.savings_vs_paid||0) > 0 ? 'var-save' : 'var-ok'}">${(r.savings_vs_paid||0) >= 0 ? '+' : ''}$${(r.savings_vs_paid||0).toFixed(4)}</td>
          </tr>`).join('')}
      </table>
    </div>` : '';

  shtml('priceIQResult', summaryHTML + promoHTML + overpaidHTML + goodHTML);
}

function exportPriceIQ(){
  if(!priceIQCache || !priceIQCache.length){ alert('Run the analysis first.'); return; }
  const rows = [['Ingredient','He paid','He paid at','Best price','Best store','On promo','Promo note','Variance','Recommendation']];
  priceIQCache.forEach(r => {
    rows.push([r.name, r.receiptPrice.toFixed(4), r.receiptStore,
      (r.best_price_per_unit||0).toFixed(4), r.best_store,
      r.is_on_promo ? 'yes' : 'no', r.promo_note||'',
      (r.savings_vs_paid||0).toFixed(4), r.recommendation||'']);
  });
  const csv = rows.map(r => r.map(v => {
    const s = String(v==null?'':v);
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g,'""') + '"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'price_intelligence_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

// ════════════════════════════════════════════════════════════
// RECIPE LIBRARY — persistent personal cocktail recipes
// ═══════════════════════════════════════════════════════════
// AI PRICE LOOKUP
// ═══════════════════════════════════════════════════════════
// Price cache so repeated lookups on the same ingredient don't re-query
const priceCache = {};

async function lookupPrice(ingredientName, unit) {
  // Try the Anthropic API with web_search tool (works inside Claude.ai)
  // Falls back to opening retailer search tabs if API unavailable
  const today = new Date().toLocaleDateString('fr-CA');
  const prompt = 'Search the web for the current retail price of "'
    + ingredientName + '" in Montreal, Canada as of ' + today
    + '. Check SAQ.com, Aubut, IGA, Metro, Costco.ca as applicable. '
    + 'Respond ONLY with this exact JSON (no markdown, no extra text): '
    + '{"price_per_unit":0.00,"bottle_price":0.00,"bottle_size":"750ml","source":"Store name $XX.XX","best_store":"Store","confidence":"high|medium|low"}';

  try {
    // Use proxy if available (Vercel deployment), else direct (Claude.ai)
  const PROXY_URL = window.ANTHROPIC_PROXY_URL || 'https://api.anthropic.com/v1/messages';
  const response = await fetch(PROXY_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        tools: [{"type": "web_search_20250305", "name": "web_search"}],
        messages: [{role: "user", content: prompt}]
      })
    });

    if (response.ok) {
      const data = await response.json();
      const textBlock = (data.content||[]).filter(b => b.type === 'text').map(b => b.text||'').join('');
      const cleaned = textBlock.replace(/```json|```/g,'').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }

    // If API returned non-OK but not auth error, fall through to web search
    if (response.status === 401 || response.status === 403) {
      throw new Error('__OPEN_SEARCH__');
    }
    throw new Error('__OPEN_SEARCH__');

  } catch(e) {
    if(e.message === '__OPEN_SEARCH__' || e.message.includes('fetch') || e.message.includes('Failed') || e.message.includes('CORS') || e.message.includes('Network')) {
      throw new Error('__OPEN_SEARCH__');
    }
    throw e;
  }
}

function openRetailerSearch(ingredientName) {
  // Open targeted search tabs so user can find real current prices
  const q = encodeURIComponent(ingredientName + ' montreal prix price');
  const qSAQ = encodeURIComponent(ingredientName);
  const qAubut = encodeURIComponent(ingredientName);

  // Detect what type of ingredient to pick the right stores
  const nm = ingredientName.toLowerCase();
  const isSpirit = /gin|vodka|rum|whisky|whiskey|tequila|mezcal|cognac|liqueur|campari|aperol|vermouth|amaro|beer|wine|champagne|prosecco|port|baileys|kahlua/.test(nm);
  const isBarSupply = /monin|fever-tree|schweppes|clamato|soda|syrup|cup|straw|napkin|walter/.test(nm);

  const searches = [];
  if(isSpirit) {
    searches.push({label:'SAQ', url:'https://www.saq.com/en/catalogsearch/result/?q=' + qSAQ});
  }
  if(isBarSupply) {
    searches.push({label:'Aubut', url:'https://www.aubut.com/catalogsearch/result/?q=' + qAubut});
  }
  // Always add Google Shopping as fallback
  searches.push({label:'Google', url:'https://www.google.com/search?q=' + q + '&tbm=shop'});

  // Show a small popup with the search links
  const existing = document.getElementById('priceSearchPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'priceSearchPopup';
  popup.style.cssText = 'position:fixed;z-index:3000;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;border:1px solid #e5e5e0;border-radius:14px;padding:18px;box-shadow:0 8px 32px rgba(0,0,0,0.15);min-width:280px;max-width:340px;';
  popup.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">🔍 Search for price</div>'
    + '<div style="font-size:12px;color:#888;margin-bottom:12px;">Opens the retailer site — find the price, then type it in the cost field.</div>'
    + '<div style="font-size:13px;font-weight:500;color:#1a1a1a;margin-bottom:10px;">' + ingredientName + '</div>'
    + searches.map(s =>
        '<a href="' + s.url + '" target="_blank" onclick="document.getElementById(\x27priceSearchPopup\x27).remove()"'
        + ' style="display:block;padding:10px 14px;margin-bottom:6px;border-radius:8px;background:#f5f5f0;color:#1a1a1a;text-decoration:none;font-size:13px;font-weight:500;border:1px solid #e5e5e0;">'
        + '🔗 Search ' + s.label + '</a>'
      ).join('')
    + '<button onclick="document.getElementById(\x27priceSearchPopup\x27).remove()" style="width:100%;padding:8px;margin-top:4px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:12px;color:#888;">Cancel</button>';

  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function closePSP(e){
    const pop = document.getElementById('priceSearchPopup');
    if(pop && !pop.contains(e.target)){ pop.remove(); document.removeEventListener('click',closePSP); }
  }), 100);
}

function showLibraryPrices(gid, idx, event){
  if(event) event.stopPropagation();
  document.querySelectorAll('[id^="lpricelib_"]').forEach(el => {
    if(el.id !== 'lpricelib_' + gid) el.style.display = 'none';
  });
  const popEl = document.getElementById('lpricelib_' + gid);
  if(!popEl) return;
  if(popEl.style.display !== 'none'){ popEl.style.display = 'none'; return; }

  const ing = nIng[idx];
  if(!ing || !ing.n.trim()){
    popEl.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px;">Add an ingredient name first.</div>';
    popEl.style.display = 'block';
    return;
  }

  const k = ing.n.toLowerCase().trim();
  const libPrices = retailerPrices[k] || {};
  const histPrices = priceHistory[k] || [];
  const receiptPrices = histPrices.filter(p => p.source === 'receipt');

  // Separate regular vs promo receipt prices
  const regularReceipts = receiptPrices.filter(p => !p.isPromo);
  const promoReceipts   = receiptPrices.filter(p => p.isPromo);

  // Build per-store data from REGULAR prices only
  const byStore = {};
  regularReceipts.forEach(p => {
    const s = p.store || 'Unknown';
    if(!byStore[s]) byStore[s] = {prices:[], source:'receipt', date:p.date};
    byStore[s].prices.push(p.price);
    if(p.date > (byStore[s].date||'')) byStore[s].date = p.date;
  });
  // Add lookup prices for stores not yet in byStore
  Object.entries(libPrices).forEach(([store, entry]) => {
    if(!byStore[store]) byStore[store] = {prices:[entry.price], source:entry.source||'lookup', date:entry.date};
  });

  let html = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#aaa;margin-bottom:8px;">'
    + ing.n
    + '</div>';

  if(!Object.keys(byStore).length && !promoReceipts.length){
    html += '<div style="font-size:12px;color:#aaa;line-height:1.5;">No prices recorded yet.<br>Scan a receipt to build history,<br>or enter a price manually.</div>';
  } else {

    // ── Regular prices (used for average) ──
    if(Object.keys(byStore).length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#1a7a4a;margin-bottom:5px;">Regular prices</div>';
      Object.entries(byStore)
        .sort((a,b) => (a[1].source==='receipt'?0:1) - (b[1].source==='receipt'?0:1))
        .forEach(([store, data]) => {
          const avg = data.prices.reduce((s,p)=>s+p,0) / data.prices.length;
          const isReceipt = data.source === 'receipt';
          const countLabel = data.prices.length > 1
            ? data.prices.length + ' receipts · avg'
            : (isReceipt ? 'receipt' : 'lookup');
          html += '<div onclick="applyLibraryPrice('+gid+','+idx+','+avg.toFixed(4)+',false)"'
            + ' style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid '+(isReceipt?'#c8e6d4':'#e5e5e0')+';background:'+(isReceipt?'#edfaf3':'#fafaf7')+';">'
            + '<div>'
            +   '<div style="font-weight:600;font-size:13px;color:#1a1a1a;">' + store + '</div>'
            +   '<div style="font-size:10px;color:#888;">'+(isReceipt?'🧾 ':'🔍 ')+countLabel+(data.date?' · '+data.date:'')+'</div>'
            + '</div>'
            + '<div style="font-weight:700;font-size:14px;color:'+(isReceipt?'#1a7a4a':'#555')+';">$'+avg.toFixed(4)+'<span style="font-size:10px;font-weight:400;color:#aaa;">/'+(ing.u||'oz')+'</span></div>'
            + '</div>';
        });

      // Overall avg from REGULAR receipts only
      if(regularReceipts.length > 1){
        const regAvg = regularReceipts.reduce((s,p)=>s+p.price,0) / regularReceipts.length;
        html += '<div onclick="applyLibraryPrice('+gid+','+idx+','+regAvg.toFixed(4)+',false)"'
          + ' style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;border-radius:8px;cursor:pointer;background:#1a1a1a;margin-bottom:4px;">'
          + '<div style="font-size:12px;font-weight:600;color:#fff;">Avg regular price ('+regularReceipts.length+' receipts)</div>'
          + '<div style="font-weight:700;font-size:14px;color:#7dd3b0;">$'+regAvg.toFixed(4)+'<span style="font-size:10px;color:#aaa;">/'+(ing.u||'oz')+'</span></div>'
          + '</div>';
      }
    }

    // ── Promo prices (shown for context, not included in avg) ──
    if(promoReceipts.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#d97706;margin-top:8px;margin-bottom:5px;">🏷 Sale / promo prices <span style="font-weight:400;color:#aaa;text-transform:none;">(not in avg)</span></div>';
      // Group promos by store
      const promoByStore = {};
      promoReceipts.forEach(p => {
        const s = p.store || 'Unknown';
        if(!promoByStore[s]) promoByStore[s] = [];
        promoByStore[s].push(p);
      });
      Object.entries(promoByStore).forEach(([store, promos]) => {
        const latest = promos.sort((a,b) => b.date.localeCompare(a.date))[0];
        html += '<div onclick="applyLibraryPrice('+gid+','+idx+','+latest.price.toFixed(4)+',true)"'
          + ' style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:8px;cursor:pointer;margin-bottom:4px;border:1px solid #fde68a;background:#fffbeb;">'
          + '<div>'
          +   '<div style="font-weight:600;font-size:13px;color:#1a1a1a;">' + store + '</div>'
          +   '<div style="font-size:10px;color:#888;">🧾 promo · ' + latest.date
          +   (latest.regularPrice ? ' · reg $'+parseFloat(latest.regularPrice).toFixed(2) : '')
          +   ' · ' + promos.length + ' time' + (promos.length>1?'s':'')
          +   '</div>'
          + '</div>'
          + '<div style="font-weight:700;font-size:14px;color:#d97706;">$'+latest.price.toFixed(4)+'<span style="font-size:10px;font-weight:400;color:#aaa;">/'+(ing.u||'oz')+'</span></div>'
          + '</div>';
      });
    }
  }

  // ── Manual tag toggle — mark the currently entered price as promo ──
  const curPrice = nIng[idx] ? nIng[idx].c : 0;
  if(curPrice > 0){
    html += '<div style="margin-top:8px;padding:8px 10px;background:#f9f9f6;border-radius:8px;border:1px solid #e5e5e0;">'
      + '<div style="font-size:11px;color:#888;margin-bottom:5px;">Tag current price ($'+curPrice.toFixed(4)+'/'+(ing.u||'oz')+'):</div>'
      + '<div style="display:flex;gap:6px;">'
      + '<button onclick="tagCurrentPrice('+gid+','+idx+',false)" style="flex:1;padding:5px 8px;border-radius:7px;border:1px solid #c8e6d4;background:#edfaf3;font-size:11px;font-weight:600;cursor:pointer;color:#1a7a4a;font-family:inherit;">✓ Regular</button>'
      + '<button onclick="tagCurrentPrice('+gid+','+idx+',true)" style="flex:1;padding:5px 8px;border-radius:7px;border:1px solid #fde68a;background:#fffbeb;font-size:11px;font-weight:600;cursor:pointer;color:#d97706;font-family:inherit;">🏷 Promo / sale</button>'
      + '</div></div>';
  }

  html += '<div onclick="var p=document.getElementById(\x27lpricelib_\x27+\x27'+gid+'\x27);if(p)p.style.display=\x27none\x27" style="text-align:center;padding:6px 0 2px;font-size:11px;color:#aaa;cursor:pointer;">Close</div>';
  popEl.innerHTML = html;
  popEl.style.display = 'block';

  setTimeout(() => {
    document.addEventListener('click', function closeLib(e){
      if(!popEl.contains(e.target)){ popEl.style.display='none'; document.removeEventListener('click',closeLib); }
    });
  }, 50);
}


function applyLibraryPrice(gid, idx, price, isPromo){
  nIng[idx].c = price;
  if(isPromo) nIng[idx].isPromo = true;
  else delete nIng[idx].isPromo;
  const inp = document.getElementById('lcost_' + gid);
  if(inp) inp.value = price.toFixed(4);
  document.querySelectorAll('[id^="lpricelib_"]').forEach(el => el.style.display='none');
  const srcEl = document.getElementById('lsrc_' + gid);
  const promoTag = isPromo ? ' 🏷 promo' : '';
  if(srcEl){ srcEl.className='price-source'; srcEl.textContent='✓ library · $'+price.toFixed(4)+'/'+(nIng[idx].u||'oz')+promoTag; }
  markUnsaved();
  showToast((isPromo ? '🏷 Promo price' : 'Regular price')+' $'+price.toFixed(4)+'/'+(nIng[idx].u||'oz')+' applied', 'success');
}

function tagCurrentPrice(gid, idx, isPromo){
  // Tag the currently entered price as regular or promo and save to history
  const ing = nIng[idx];
  if(!ing || !ing.n || ing.c <= 0){ showToast('Enter a price first', 'error'); return; }
  // Save to priceHistory with the promo flag
  recordPrice(ing.n, ing.c, ing.u||'oz', 'Manual', 'manual', null, isPromo, null);
  if(isPromo) ing.isPromo = true;
  else delete ing.isPromo;
  const srcEl = document.getElementById('lsrc_' + gid);
  if(srcEl){ srcEl.className='price-source'; srcEl.textContent='✓ saved · $'+ing.c.toFixed(4)+'/'+(ing.u||'oz')+(isPromo?' 🏷 promo':' regular'); }
  document.querySelectorAll('[id^="lpricelib_"]').forEach(el => el.style.display='none');
  markUnsaved();
  showToast((isPromo ? '🏷 Promo' : 'Regular')+' price saved to history', 'success');
}

async function lookupSinglePrice(idx) {
  const ing = nIng[idx];
  if (!ing || !ing.n.trim()) return;
  const btn = document.getElementById(`lbtn_${ing.id}`);
  const srcEl = document.getElementById(`lsrc_${ing.id}`);
  const input = document.getElementById(`lcost_${ing.id}`);
  if (!btn) return;

  // Show loading state
  btn.classList.add('loading');
  btn.textContent = '...';
  if (srcEl) { srcEl.className = 'price-source'; srcEl.textContent = 'Searching SAQ & grocery prices live...'; }

  try {
    // Check cache first (so re-clicking same ingredient is instant)
    const cacheKey = ing.n.toLowerCase().trim() + '|' + (ing.u||'oz');
    let price, source, bottlePrice, bottleSize, confidence, dateChecked;

    if (priceCache[cacheKey]) {
      ({price, source, bottlePrice, bottleSize, confidence, dateChecked} = priceCache[cacheKey]);
    } else {
      const result = await lookupPrice(ing.n, ing.u || 'oz');
      price = parseFloat(result.price_per_unit);
      source = result.source || 'Live search';
      bottlePrice = result.bottle_price || null;
      bottleSize = result.bottle_size || null;
      confidence = result.confidence || 'medium';
      dateChecked = result.date_checked || new Date().toISOString().split('T')[0];
      const priceRange = result.price_range || null;
      if (!isNaN(price) && price > 0) {
        priceCache[cacheKey] = {price, source, bottlePrice, bottleSize, confidence, dateChecked, priceRange};
        // Record in price history
        recordPrice(ing.n, price, ing.u || 'oz', source ? source.split(' ')[0] : 'Online lookup', 'lookup');
      }
    }

    if (!isNaN(price) && price > 0) {
      nIng[idx].c = price;
      if (input) input.value = price.toFixed(2);
      btn.classList.remove('loading');
      btn.classList.add('done');
      btn.textContent = '✓';
      // Show rich source info: bottle price + per-oz price + confidence + date
      const confColor = confidence === 'high' ? '#1a7a4a' : confidence === 'medium' ? '#a06020' : '#888';
      const confLabel = confidence === 'high' ? '● confirmed' : confidence === 'medium' ? '◐ estimated' : '○ approximate';
      if (srcEl) {
        srcEl.className = 'price-source';
        const priceRange = priceCache[cacheKey] && priceCache[cacheKey].priceRange ? ` · range: ${priceCache[cacheKey].priceRange}` : '';
        // Store lookup result in a safe temp store keyed by ingredient ID
        // Avoids any apostrophe/quote escaping issues in inline onclick attributes
        const tempKey = 'tmp_' + ing.id;
        window._priceLookupTemp = window._priceLookupTemp || {};
        window._priceLookupTemp[tempKey] = {
          name: ing.n, unit: ing.u || 'oz', cost: price, note: source || ''
        };
        // Store in temp registry — button references key only, no strings in onclick
        const saveBtn = `<button data-tmpkey="${tempKey}" onclick="doSaveFromLookup(this)" style="font-size:10px;padding:1px 6px;margin-left:6px;cursor:pointer;border-radius:4px;border:1px solid #c8e6d4;background:#edfaf3;color:#1a7a4a;font-family:inherit;">+ Save to my DB</button>`;
        srcEl.innerHTML = `<span style="color:${confColor};">${confLabel}</span> · ${source}${bottlePrice ? ` · $${parseFloat(bottlePrice).toFixed(2)}/${bottleSize||'bottle'}` : ''}${priceRange} · ${dateChecked} ${saveBtn}`;
      }
      markUnsaved();
      setTimeout(() => { btn.classList.remove('done'); btn.textContent = '🔍'; }, 4000);
    } else throw new Error("bad price");

  } catch(e) {
    btn.classList.remove('loading');
    btn.textContent = '🔍';
    // If API unavailable, open retailer search instead
    if(e.message === '__OPEN_SEARCH__') {
      const ingName = nIng[idx] ? nIng[idx].n : '';
      if(ingName) openRetailerSearch(ingName);
      if(srcEl){ srcEl.className='price-source'; srcEl.textContent=''; }
      return;
    }
    if (srcEl) {
      srcEl.className = 'price-error';
      const errMsg = e && e.message && e.message.includes('401') ? 'API auth error — open in Claude.ai for live prices' :
                     e && e.message && (e.message.includes('fetch') || e.message.includes('Failed')) ? 'Price lookup only works inside Claude.ai — use 🔍 to try manually' :
                     'Price not found — enter manually or try again';
      srcEl.textContent = errMsg;
      setTimeout(() => { if(srcEl) srcEl.textContent = ''; }, 5000);
    }
  }
}

async function lookupAllPrices() {
  const btn = document.getElementById('lookupAllBtn');
  if (!nIng.length) { alert('Add ingredients first.'); return; }
  const named = nIng.filter(i => i.n.trim());
  if (!named.length) { alert('Name your ingredients first.'); return; }
  btn.disabled = true;
  btn.textContent = `⏳ Looking up 1 of ${named.length}...`;
  let done = 0;
  for (let i = 0; i < nIng.length; i++) {
    if (nIng[i].n.trim()) {
      await lookupSinglePrice(i);
      done++;
      btn.textContent = `⏳ ${done} of ${named.length} done...`;
      await new Promise(r => setTimeout(r, 500)); // respectful delay between calls
    }
  }
  btn.disabled = false;
  btn.innerHTML = '✨ Auto-price all';
  // Trigger resale recalc after all prices updated
  if (!rcManualOverride) autoFillResale();
}

// ═══════════════════════════════════════════════════════════
// SAVE / LOAD
// ════════════════════════════════════════════════════════════
// STORE PROMO SEARCH
// ════════════════════════════════════════════════════════════

async function searchStorePromos(store){
  const storeKey = 'promo_' + store.replace(/[^a-z0-9]/gi,'_');
  const promoEl = document.getElementById(storeKey);
  if(!promoEl) return;

  // Get the items Antoine needs to buy at this store
  const items = getIM(vi('gc') || 50);
  const storeItems = items.filter(i => inferStore(i) === store).map(i => i.name).slice(0,8);
  const itemList = storeItems.length ? storeItems.join(', ') : 'bar supplies and spirits';

  promoEl.style.display = 'block';
  promoEl.innerHTML = '⏳ Searching for current promotions at ' + store + '…';

  try {
    const today = new Date().toLocaleDateString('fr-CA');
    const prompt = 'Search for current promotions, sales, or weekly specials at ' + store + ' in Montreal, Canada as of ' + today + '. Focus on bar supplies, spirits, and these specific items if possible: ' + itemList + '. Respond with a brief bulleted list of any active promos or price drops. If no specific promos found, suggest the best buying strategy for these items at ' + store + '. Keep it under 150 words.';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{role: 'user', content: prompt}]
      })
    });
    const data = await response.json();
    const text = (data.content||[]).filter(b=>b.type==='text').map(b=>b.text||'').join('').trim();
    promoEl.innerHTML = '<div style="font-weight:600;margin-bottom:4px;">🏷 ' + store + ' — promotions & tips</div>'
      + text.replace(/\n/g,'<br>').replace(/\*\*/g,'');
  } catch(e){
    promoEl.innerHTML = '⚠ Could not search for promos — check your connection.';
  }
}

// ════════════════════════════════════════════════════════════
// MASTER SHOPPING LIST — all confirmed events
// ════════════════════════════════════════════════════════════

