// ═══ CLIENT PDF & INVOICES ═══
// Client-facing PDF (bilingual), quote snapshots,
// final invoice builder, reprint/preview

// ── CLIENT-FACING PDF ─────────────────────────────────────
let pdfLang = 'fr'; // default French for Montreal

const PDF_STRINGS = {
  fr: {
    title: 'FACTURE',
    invoiceNo: 'No. de facture :',
    billingDate: 'Date facturation :',
    eventDate: "Date de l&#39;événement :",
    serviceDesc: 'DESCRIPTION DES SERVICES RENDUS',
    colDate: 'Date et descriptif',
    colRole: 'Rôle',
    colHrs: 'Heures',
    colRate: 'Taux horaire',
    colTotal: 'Total',
    cocktailMenu: 'Menu cocktails',
    subtotal: 'Sous-total',
    discount: 'Remise',
    tps: 'TPS (5%)',
    tvq: 'TVQ (9.975%)',
    total: 'TOTAL',
    deposit: 'Acompte reçu',
    balance: 'SOLDE DÛ',
    beverages: 'Boissons et ingrédients',
    travel: 'Déplacement / installation',
    guests: 'invités',
    notes: 'Notes',
    footer: 'Merci pour votre confiance — Thank you for your business.',
    bartender: 'Bartender — Mixologiste'
  },
  en: {
    title: 'INVOICE',
    invoiceNo: 'Invoice No.:',
    billingDate: 'Invoice date:',
    eventDate: 'Event date:',
    serviceDesc: 'SERVICES RENDERED',
    colDate: 'Date & description',
    colRole: 'Role',
    colHrs: 'Hours',
    colRate: 'Hourly rate',
    colTotal: 'Total',
    cocktailMenu: 'Cocktail menu',
    subtotal: 'Subtotal',
    discount: 'Discount',
    tps: 'GST (5%)',
    tvq: 'QST (9.975%)',
    total: 'TOTAL',
    deposit: 'Deposit received',
    balance: 'BALANCE DUE',
    beverages: 'Beverages & ingredients',
    travel: 'Travel / setup',
    guests: 'guests',
        notes: 'Notes',
footer: 'Thank you for your business — Merci pour votre confiance.',
    bartender: 'Bartender — Mixologist'
  }
};

function setPDFLang(lang){
  pdfLang = lang;
  // Update toggle button styles
  const frBtn = el('pdfLangFR'), enBtn = el('pdfLangEN');
  if(frBtn){ frBtn.style.background = lang==='fr'?'#1a1a1a':'#fff'; frBtn.style.color = lang==='fr'?'#fff':'#888'; frBtn.style.fontWeight = lang==='fr'?'600':'400'; }
  if(enBtn){ enBtn.style.background = lang==='en'?'#1a1a1a':'#fff'; enBtn.style.color = lang==='en'?'#fff':'#888'; enBtn.style.fontWeight = lang==='en'?'600':'400'; }
  // Re-render the preview modal in the new language — do NOT open the print window
  openClientPDF();
}

function getNextInvoiceNum(){
  const year = new Date().getFullYear();
  const key = 'bartender_inv_counter_' + year;
  let counter = parseInt(localStorage.getItem(key) || '0') + 1;
  localStorage.setItem(key, counter);
  return year + '-' + String(counter).padStart(3, '0');
}

function openClientPDF(){
  try {
  const guests=qvi('gc'),hours=qvf('eventHrs'),rate=qvf('hr'),travel=qvf('tf');
  const marginPct2=getMpAsMargin();
  const mkup=marginPct2<100?(marginPct2/(100-marginPct2))*100:marginPct2;
  const taxEl=el('taxEnabled');
  const taxEnabled=taxEl&&taxEl.checked;
  const deposit=qvf('depositAmt')||0;
  const items=getIM(guests);
  const purchaseTotal=items.reduce((s,i)=>s+i.purchaseCost,0);
  const mked=purchaseTotal*(1+mkup/100),labor=hours*rate;
  const staffLabor=getStaffLaborTotal();
  // Discount calc (mirrors rQ)
  const discountAmt=qvf('discountAmt')||0;
  const discountPct=qvf('discountPct')||0;
  const subtotalBD=mked+labor+staffLabor+travel;
  const pctDiscountValue=subtotalBD*(discountPct/100);
  const totalDiscount=discountAmt+pctDiscountValue;
  const resale=0; // resale credit not included in client quote
  // Quote is locked — does NOT include resale/inventory credit
  // Profit from reusing stock is tracked separately in the Inventory tab
  const subtotalBeforeTax=Math.max(0, mked+labor+staffLabor+travel-totalDiscount);
  const tps=taxEnabled?subtotalBeforeTax*0.05:0;
  const tvq=taxEnabled?subtotalBeforeTax*0.09975:0;
  let total=subtotalBeforeTax+tps+tvq;
  const balanceOwing=total-deposit;
  const cn=qv('cn')||'Client';
  const ed=qv('ed');
  const notes=qv('qn');
  const dateStr=ed?new Date(ed+'T12:00:00').toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'}):'';
  const pairHTML = getPairQuoteBlock();
  const menuList = cocktails.map(c2=>{
    const rawCost = c2.ing.reduce((s,i)=>s+i.c*i.q,0);
    const clientCost = rawCost*(1+mkup/100);
    return `<li style="display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:5px 0;border-bottom:1px solid #f5f5f0;">
      <span>${c2.name} <span style="color:#aaa;font-size:12px;">(${c2.dpg} drink${c2.dpg!==1?'s':''}/guest)</span></span>
      <span style="color:#888;font-size:12px;">$${clientCost.toFixed(2)}/drink</span>
    </li>`;
  }).join('');

  const L = PDF_STRINGS[pdfLang] || PDF_STRINGS['fr'];

  // Invoice number — generate or use override from the edit field
  const _invOvr = el('pdfInvoiceNum') ? el('pdfInvoiceNum').value.trim() : '';
  const invoiceNum = _invOvr || getNextInvoiceNum();
  if(!_invOvr && el('pdfInvoiceNum')) el('pdfInvoiceNum').value = invoiceNum;

  // Billing date — use override or today, formatted per language
  const _bilOvr = el('pdfBillingDate') ? el('pdfBillingDate').value : '';
  const _bilObj = _bilOvr ? new Date(_bilOvr + 'T12:00:00') : new Date();
  const todayStr = _bilObj.toLocaleDateString(pdfLang === 'fr' ? 'fr-CA' : 'en-CA', {year:'numeric', month:'long', day:'numeric'});
  if(!_bilOvr && el('pdfBillingDate')) el('pdfBillingDate').value = new Date().toISOString().split('T')[0];

  // Build notes HTML separately to avoid nested template literal issues
  const notesHtml = notes
    ? '<div style="font-size:13px;color:#666;padding:12px;border:1px solid #eee;border-radius:8px;white-space:pre-wrap;margin-bottom:16px;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#aaa;margin-bottom:6px;">' + ((L&&L.notes)||'Notes') + '</div>' + notes.replace(/</g,'&lt;') + '</div>'
    : '';

  const html = `
    <div style="font-family:-apple-system,sans-serif;color:#1a1a1a;max-width:560px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1a1a1a;padding-bottom:16px;margin-bottom:20px;gap:12px;">
        <div>
          <div style="font-size:20px;font-weight:700;margin-bottom:4px;">${cn}</div>
          ${dateStr?`<div style="font-size:13px;color:#666;">${dateStr}</div>`:''}
          <div style="font-size:12px;color:#888;margin-top:3px;">${guests} ${L.guests} · ${hours}h</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:.05em;">${L.invoiceNo}</div>
          <div style="font-size:15px;font-weight:700;font-family:monospace;">${invoiceNum}</div>
          <div style="font-size:11px;color:#888;margin-top:3px;">${L.billingDate} ${todayStr}</div>
        </div>
      </div>
      ${pairHTML}
      ${menuList?`
      <div style="margin-bottom:20px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:8px;">Cocktail menu</div>
        <ul style="list-style:none;padding:0;margin:0;">${menuList}</ul>
      </div>`:''}
      <div style="background:#f9f9f6;border-radius:10px;padding:1rem;margin-bottom:16px;">
        <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#888;margin-bottom:10px;">${L.serviceDesc}</div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>Bar service (${hours}h)</span><span>$${labor.toFixed(2)}</span></div>
        ${getStaffClientLines()}
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>${L.beverages}</span><span>$${mked.toFixed(2)}</span></div>
        ${travel>0?`<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>${L.travel}</span><span>$${travel.toFixed(2)}</span></div>`:''}
        ${totalDiscount>0?`
        ${discountPct>0?`<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#c0392b;"><span>${L.discount} (${discountPct}%) —</span><span>- $${pctDiscountValue.toFixed(2)}</span></div>`:''}
        ${discountAmt>0?`<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#c0392b;"><span>${L.discount}</span><span>- $${discountAmt.toFixed(2)}</span></div>`:''}
        `:''}
        ${resale>0?`<div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#1a7a4a;"><span>${L.discount}</span><span>- $${resale.toFixed(2)}</span></div>`:''}
        ${taxEnabled?`
        <div style="border-top:1px dashed #ddd;margin:6px 0;"></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>${L.subtotal}</span><span>$${subtotalBeforeTax.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>${L.tps}</span><span>$${tps.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;"><span>${L.tvq}</span><span>$${tvq.toFixed(2)}</span></div>`:''}
        <div style="display:flex;justify-content:space-between;font-size:17px;font-weight:700;padding-top:10px;border-top:2px solid #ddd;margin-top:4px;"><span>${L.total}</span><span>$${total.toFixed(2)} CAD</span></div>
        ${deposit>0?`
        <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#1a7a4a;"><span>${L.deposit}</span><span>- $${deposit.toFixed(2)}</span></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:600;padding-top:6px;"><span>${L.balance}</span><span>$${balanceOwing.toFixed(2)} CAD</span></div>`:''}
      </div>
      ${notesHtml}
      <div style="text-align:center;margin-top:20px;font-size:12px;color:#aaa;">${L.footer}</div>
    </div>`;

  shtml('clientPDFContent',html);
  // Auto-save quote snapshot to event library when preview is opened
  if(qv('eventLabel')) saveQuoteSnapshot(html);
  // Only increment invoice counter when opening fresh (not when toggling language)
  const pdfBg = document.getElementById('pdfModalBg'); if(pdfBg) pdfBg.style.display = 'flex';
  } catch(err){ console.error('openClientPDF error:', err, err.stack); showToast('Error building PDF preview: ' + err.message + ' — check browser console', 'error'); }
}

function closePDFModal(){
  const pdfBg2 = document.getElementById('pdfModalBg'); if(pdfBg2) pdfBg2.style.display = 'none';
}

function saveQuoteSnapshot(htmlContent){
  // Find current event in library and save quote snapshot
  const label = v('eventLabel');
  if(!label) return;
  const idx = eventLibrary.findIndex(e => e.label === label && (e.eventDate||'') === (v('ed')||''));
  if(idx === -1){
    // Auto-save to library first
    saveEventToLibrary(true);
    return saveQuoteSnapshot(htmlContent);
  }
  eventLibrary[idx].quoteSnapshot = htmlContent;
  eventLibrary[idx].quoteSentAt = new Date().toISOString();
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Quote saved to event library ✓', 'success');
}

function saveInvoiceSnapshot(htmlContent, total, deposit){
  const label = v('eventLabel');
  if(!label) return;
  const idx = eventLibrary.findIndex(e => e.label === label && (e.eventDate||'') === (v('ed')||''));
  if(idx === -1){
    saveEventToLibrary(true);
    return saveInvoiceSnapshot(htmlContent, total, deposit);
  }
  eventLibrary[idx].invoiceSnapshot = htmlContent;
  eventLibrary[idx].invoiceFinalAt = new Date().toISOString();
  eventLibrary[idx].invoiceTotal = total;
  eventLibrary[idx].depositPaid = deposit;
  // Update status to completed if it was confirmed
  if((eventLibrary[idx].status||'draft') === 'confirmed'){
    eventLibrary[idx].status = 'completed';
  }
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Invoice saved to event library ✓', 'success');
}

function viewQuoteHistory(evId){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry || !entry.quoteHistory || !entry.quoteHistory.length){
    showToast('No previous versions found', 'error'); return;
  }

  const existing = document.getElementById('quoteHistoryPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'quoteHistoryPopup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-xl);padding:1.5rem;box-shadow:var(--shadow-lg);z-index:9999;min-width:320px;max-width:420px;';

  const rows = entry.quoteHistory.map((snap, idx) => {
    const dt = snap.savedAt ? new Date(snap.savedAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
    const revNum = snap.revision || (entry.quoteHistory.length - idx);
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:.5px solid var(--border);gap:10px;">'
      + '<div>'
      +   '<div style="font-size:13px;font-weight:600;">Version ' + revNum + '</div>'
      +   '<div style="font-size:11px;color:var(--text3);">' + dt + '</div>'
      + '</div>'
      + '<div style="display:flex;gap:6px;">'
      +   '<button onclick="viewHistoricalQuote(this.dataset.ev, this.dataset.idx)" class="btn btn-sm" style="font-size:11px;">👁 View</button>'
      +   '<button onclick="saveHistoricalQuote(this.dataset.ev, this.dataset.idx)" class="btn btn-sm" style="font-size:11px;">💾 Save</button>'
      + '</div>'
      + '</div>';
  }).join('');

  popup.innerHTML = '<div style="font-size:15px;font-weight:700;margin-bottom:4px;">📋 Quote history</div>'
    + '<div style="font-size:12px;color:var(--text3);margin-bottom:1rem;">' + (entry.label||'Event') + ' · ' + entry.quoteHistory.length + ' previous version' + (entry.quoteHistory.length!==1?'s':'') + '</div>'
    + '<div style="max-height:300px;overflow-y:auto;">' + rows + '</div>'
    + '<button onclick="closeQuoteHistory()" class="btn" style="width:100%;margin-top:1rem;">✕ Close</button>';

  document.body.appendChild(popup);
  setTimeout(()=>{
    document.addEventListener('click', function closeQH(e){
      const p=document.getElementById('quoteHistoryPopup');
      if(p&&!p.contains(e.target)){p.remove();document.removeEventListener('click',closeQH);}
    });
  },100);
}

function closeQuoteHistory(){ const p=document.getElementById('quoteHistoryPopup'); if(p) p.remove(); }

function viewHistoricalQuote(evId, idx){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry || !entry.quoteHistory || !entry.quoteHistory[idx]) return;
  const snap = entry.quoteHistory[idx];
  const html = (typeof snap==='object'&&snap.html)?snap.html:snap;
  if(!html){showToast('No content for this version','error');return;}
  const w = window.open('','_blank');
  if(w){w.document.write(html);w.document.close();}
}

function saveHistoricalQuote(evId, idx){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry || !entry.quoteHistory || !entry.quoteHistory[idx]) return;
  const snap = entry.quoteHistory[idx];
  const html = (typeof snap==='object'&&snap.html)?snap.html:snap;
  if(!html){showToast('No content','error');return;}
  window._docActionHtml = html;
  window._docActionName = (entry.label||'event').replace(/[^a-z0-9]/gi,'_') + '_quote_v' + (snap.revision||idx+1);
  docActionSave();
}

function viewStateHistory(evId){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry){ showToast('Event not found', 'error'); return; }
  const history = entry.stateHistory || [];

  const existing = document.getElementById('stateHistoryPopup');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'stateHistoryPopup';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(25,25,24,.5);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem;';

  const modal = document.createElement('div');
  modal.style.cssText = 'background:var(--surface);border-radius:20px;padding:1.5rem;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:var(--shadow-lg);border:1.5px solid var(--border);';

  const rows = history.length === 0
    ? '<div style="padding:2rem;text-align:center;color:var(--text3);">No version history yet.<br><small>Versions are saved automatically every 3 minutes of changes, or when you click 💾 Save.</small></div>'
    : history.map((snap, idx) => {
        const dt = new Date(snap.savedAt);
        const dateStr = dt.toLocaleDateString('fr-CA', {month:'short', day:'numeric', year:'numeric'});
        const timeStr = dt.toLocaleTimeString('fr-CA', {hour:'2-digit', minute:'2-digit'});
        const isCurrent = idx === 0;
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-lg);margin-bottom:6px;background:'+(isCurrent?'var(--accent-bg)':'var(--surface2)')+';border:1.5px solid '+(isCurrent?'#c5d8f8':'var(--border)')+';">'
          + '<div style="min-width:0;flex:1;">'
          +   '<div style="display:flex;align-items:center;gap:6px;">'
          +     (isCurrent ? '<span style="font-size:10px;background:var(--accent);color:#fff;padding:1px 7px;border-radius:20px;font-weight:600;">Latest</span>' : '')
          +     (snap.isAuto ? '<span style="font-size:10px;color:var(--text3);">⚡ Auto</span>' : '<span style="font-size:10px;color:var(--green);">💾 Manual</span>')
          +   '</div>'
          +   '<div style="font-size:13px;font-weight:600;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (snap.label||'Saved') + '</div>'
          +   '<div style="font-size:11px;color:var(--text3);">' + dateStr + ' · ' + timeStr + '</div>'
          + '</div>'
          + '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:10px;">'
          +   (isCurrent ? '' : '<button data-id="'+evId+'" data-idx="'+idx+'" onclick="restoreStateVersion(this.dataset.id, parseInt(this.dataset.idx))" class="btn btn-sm btn-primary" style="font-size:11px;">↩ Restore</button>')
          + '</div>'
          + '</div>';
      }).join('');

  modal.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem;">'
    + '<div><div style="font-size:16px;font-weight:700;">🕐 Version history</div>'
    +   '<div style="font-size:12px;color:var(--text3);">' + (entry.label||'Event') + ' · ' + history.length + ' version' + (history.length!==1?'s':'') + '</div>'
    + '</div>'
    + '<button onclick="closeStateHistory()" style="background:none;border:none;font-size:20px;cursor:pointer;color:var(--text3);">✕</button>'
    + '</div>'
    + rows;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
}

function closeStateHistory(){ const p=document.getElementById('stateHistoryPopup'); if(p) p.remove(); }

function restoreStateVersion(evId, idx){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry || !entry.stateHistory || !entry.stateHistory[idx]){
    showToast('Version not found', 'error'); return;
  }
  const snap = entry.stateHistory[idx];
  const dt = new Date(snap.savedAt).toLocaleString('fr-CA', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
  if(!confirm('Restore version from ' + dt + '? "' + snap.label + '" — Current state will be saved first.')) return;





  // Save current state as a version before restoring
  saveEventToLibrary(true);

  // Apply the historical state
  applyState(snap.state);
  currentEventId = evId;
  document.getElementById('stateHistoryPopup').remove();
  showToast('Restored version from ' + dt, 'success');
  markUnsaved();
}

function viewEventDocument(evId, type){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap){ showToast('No ' + type + ' saved for this event yet', 'error'); return; }
  // Handle both plain html string and snapshot object
  const html = (typeof snap === 'object' && snap.html) ? snap.html : snap;
  if(!html){ showToast('No ' + type + ' saved for this event yet', 'error'); return; }
  const w = window.open('','_blank');
  if(w){ w.document.write(html); w.document.close(); }
  else { showToast('Pop-up blocked — allow pop-ups to preview', 'error'); }
}

function saveDocToComputer(evId, type){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap){ showToast('No ' + type + ' saved for this event', 'error'); return; }
  const html = (typeof snap === 'object' && snap.html) ? snap.html : snap;
  if(!html){ showToast('No ' + type + ' saved', 'error'); return; }

  // Store html globally for the popup actions
  window._docActionHtml = html;
  window._docActionName = (entry.label||'doc').replace(/[^a-z0-9]/gi,'_') + '_' + type;

  const existing = document.getElementById('docActionPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'docActionPopup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1.5px solid var(--border);border-radius:var(--radius-xl);padding:1.5rem;box-shadow:var(--shadow-lg);z-index:9999;min-width:280px;text-align:center;';
  popup.innerHTML = '<div style="font-size:15px;font-weight:700;margin-bottom:4px;">'
    + (type==='quote'?'📋 Quote':'🧾 Invoice') + '</div>'
    + '<div style="font-size:12px;color:var(--text3);margin-bottom:1.25rem;">' + (entry.label||'Event') + '</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px;">'
    +   '<button onclick="docActionPrint()" class="btn btn-success" style="width:100%;">🖨 Print / Save as PDF</button>'
    +   '<button onclick="docActionClose()" class="btn" style="width:100%;">✕ Cancel</button>'
    + '</div>';
  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function closeDA(e){
      const p = document.getElementById('docActionPopup');
      if(p && !p.contains(e.target)){ p.remove(); document.removeEventListener('click', closeDA); }
    });
  }, 100);
}

function docActionClose(){ const p=document.getElementById('docActionPopup'); if(p) p.remove(); }

function docActionSave(){
  const html = window._docActionHtml;
  const name = window._docActionName || 'document';
  if(!html) return;
  const blob = new Blob([html], {type:'text/html'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '.html';
  a.click();
  const p = document.getElementById('docActionPopup');
  if(p) p.remove();
  showToast('Saved to computer', 'success');
}

function docActionPrint(){
  const html = window._docActionHtml;
  if(!html) return;
  // Add print tip to the HTML
  const printTip = '<div style="display:none;" class="no-print"><p style="font-size:11px;color:#888;">Tip: In the print dialog, choose &quot;Save as PDF&quot; to save a PDF copy.</p></div>';
  const w = window.open('','_blank');
  if(w){
    w.document.write(html.replace('</body>', printTip + '</body>'));
    w.document.close(); w.focus();
    setTimeout(()=>{ try{w.print();}catch(e){} }, 400);
  }
  const p = document.getElementById('docActionPopup');
  if(p) p.remove();
}


function reprintEventDocument(evId, type){
  const entry = eventLibrary.find(e => e.id === evId);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap){ showToast('No ' + type + ' saved for this event yet', 'error'); return; }
  const html = (typeof snap === 'object' && snap.html) ? snap.html : snap;
  if(!html){ showToast('No ' + type + ' saved', 'error'); return; }
  const w = window.open('','_blank');
  if(w){
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(() => { try{ w.print(); }catch(e){} }, 500);
  } else {
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (entry.label||'event').replace(/[^a-z0-9]/gi,'_') + '_' + type + '.html';
    a.click();
  }
}
function printClientPDF(){
  // Build a proper Facture/Invoice matching the Quebec invoice template
  const guests=vi('gc'),hours=vf('eventHrs'),rate=vf('hr'),travel=vf('tf');
  const marginPct2=getMpAsMargin()||35;
  const mkup2=marginPct2<100?(marginPct2/(100-marginPct2))*100:marginPct2;
  const taxEl2=el('taxEnabled'); const taxEnabled2=taxEl2&&taxEl2.checked;
  const deposit2=vf('depositAmt')||0;
  const discountAmt2=vf('discountAmt')||0;
  const discountPct2=vf('discountPct')||0;
  const items2=getIM(guests);
  const purchaseTotal2=items2.reduce((s,i)=>s+i.purchaseCost,0);
  const mked2=purchaseTotal2*(1+mkup2/100);
  const staffLabor2=getStaffLaborTotal();
  const labor2=hours*rate;
  const subBefore=mked2+labor2+staffLabor2+travel;
  const pctDisc=subBefore*(discountPct2/100);
  const totalDisc=discountAmt2+pctDisc;
  const subAfterDisc=subBefore-totalDisc;
  const tps2=taxEnabled2?subAfterDisc*0.05:0;
  const tvq2=taxEnabled2?subAfterDisc*0.09975:0;
  const grandTotal=subAfterDisc+tps2+tvq2;
  const balance=grandTotal-deposit2;

  const lang=PDF_STRINGS[pdfLang]||PDF_STRINGS.fr;
  const clientName=v('cn')||'Client';
  const eventDate = (el('pdfEventDate') && el('pdfEventDate').value) ? el('pdfEventDate').value : v('ed');
  if(el('pdfEventDate') && !el('pdfEventDate').value && v('ed')) el('pdfEventDate').value = v('ed');

  // Invoice number — use override field or generate sequential
  const pdfInvOverride = el('pdfInvoiceNum') ? el('pdfInvoiceNum').value.trim() : '';
  let invoiceNum = pdfInvOverride || getNextInvoiceNum();
  if(!pdfInvOverride && el('pdfInvoiceNum')) el('pdfInvoiceNum').value = invoiceNum;

  // Billing date — use override or today
  const pdfBillingOverride = el('pdfBillingDate') ? el('pdfBillingDate').value : '';
  const billingDateObj = pdfBillingOverride ? new Date(pdfBillingOverride + 'T12:00:00') : new Date();
  const todayStr = billingDateObj.toLocaleDateString(pdfLang === 'fr' ? 'fr-CA' : 'en-CA', {year:'numeric',month:'long',day:'numeric'});
  if(!pdfBillingOverride && el('pdfBillingDate')) el('pdfBillingDate').value = new Date().toISOString().split('T')[0];
  const notes2=v('qn');

  // Event date: use override field or event date from settings
  const pdfEventOverride = el('pdfEventDate') ? el('pdfEventDate').value : '';
  const eventDateFmt=eventDate?new Date(eventDate+'T12:00:00').toLocaleDateString('fr-CA',{year:'numeric',month:'2-digit',day:'2-digit'}):'';

  // Service rows
  const serviceRows = [
    {desc:v('eventLabel')||'Services de bar', role:'Bartender', hrs:hours, rate:rate, total:labor2}
  ];
  staffList.forEach(s=>{
    serviceRows.push({desc:s.name||s.role, role:s.role, hrs:s.hours, rate:s.rate, total:s.rate*s.hours});
  });
  if(mked2>0) serviceRows.push({desc:lang.beverages, role:'—', hrs:'—', rate:'—', total:mked2});
  if(travel>0) serviceRows.push({desc:lang.travel, role:'—', hrs:'—', rate:'—', total:travel});

  const rowsHTML = serviceRows.map(r=>
    '<tr><td>' + (r.desc||'') + '</td><td>' + (r.role||'') + '</td><td style="text-align:center;">' + (r.hrs!=='—'?r.hrs:'—') + '</td>'
    + '<td style="text-align:right;">' + (r.rate!=='—'?'$'+parseFloat(r.rate).toFixed(2)+' $':'—') + '</td>'
    + '<td style="text-align:right;font-weight:500;">' + r.total.toFixed(2) + ' $</td></tr>'
  ).join('');

  // Regular cocktail list
  const regularCocktails = cocktails.filter(c2 => c2.cat !== 'His & Hers');
  const hisCocktails = cocktails.filter(c2 => c2.cat === 'His & Hers');
  const cocktailList = regularCocktails.length
    ? '<p style="margin:0 0 4px;font-size:12px;color:#555;"><strong>' + lang.cocktailMenu + ':</strong> ' + regularCocktails.map(c2=>c2.name).join(', ') + '</p>'
    : '';

  // His & Hers signature pair block
  const p1name = v('p1name'); const p2name = v('p2name');
  const p1drink = v('p1drink'); const p2drink = v('p2drink');
  const p1desc = v('p1desc'); const p2desc = v('p2desc');
  const pairBlock = (p1drink || p2drink || hisCocktails.length)
    ? '<div style="margin:12px 0;border:1px solid #e5e5e0;border-radius:10px;overflow:hidden;">'
      + '<div style="background:#1a1a1a;color:#fff;padding:8px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;">💑 ' + (v('pEventName')||lang.cocktailMenu) + ' — Signature pair</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">'
      + '<div style="padding:12px 14px;border-right:1px solid #e5e5e0;">'
      +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#3a6ad4;margin-bottom:4px;">' + (p1name||'Partner 1') + '</div>'
      +   '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">' + (p1drink||hisCocktails[0]?.name||'—') + '</div>'
      +   (p1desc ? '<div style="font-size:11px;color:#888;line-height:1.5;">' + p1desc + '</div>' : '')
      + '</div>'
      + '<div style="padding:12px 14px;">'
      +   '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#c0206e;margin-bottom:4px;">' + (p2name||'Partner 2') + '</div>'
      +   '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">' + (p2drink||hisCocktails[1]?.name||'—') + '</div>'
      +   (p2desc ? '<div style="font-size:11px;color:#888;line-height:1.5;">' + p2desc + '</div>' : '')
      + '</div>'
      + '</div></div>'
    : '';

  const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8">'
    + '<title>Facture — ' + clientName + '</title>'
    + '<style>'
    + 'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;padding:40px;max-width:680px;margin:0 auto;}'
    + 'h1{font-size:28px;font-weight:700;letter-spacing:2px;margin:0;color:#000;}'
    + '.header{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;}'
    + '.label{font-size:10px;font-weight:700;text-transform:uppercase;color:#888;}'
    + '.info-block{margin-bottom:16px;}'
    + '.divider{border:none;border-top:1.5px solid #222;margin:16px 0;}'
    + '.divider-light{border:none;border-top:0.5px solid #ccc;margin:8px 0;}'
    + 'table{width:100%;border-collapse:collapse;margin:16px 0;}'
    + 'thead tr{background:#222;color:#fff;}'
    + 'thead th{padding:7px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;text-align:left;}'
    + 'thead th:nth-child(3),thead th:nth-child(4),thead th:nth-child(5){text-align:right;}'
    + 'tbody tr:nth-child(even){background:#f9f9f9;}'
    + 'tbody td{padding:7px 10px;border-bottom:0.5px solid #eee;}'
    + '.totals-table{width:100%;border-collapse:collapse;}'
    + '.totals-table td{padding:4px 10px;}'
    + '.totals-table .total-row{font-weight:700;font-size:14px;border-top:1.5px solid #222;}'
    + '.notes{background:#f9f9f9;padding:12px;border-left:3px solid #222;font-size:11px;color:#555;margin-top:16px;white-space:pre-wrap;}'
    + '@media print{body{padding:20px;}}'
    + '</style></head><body>'

    // Header: his info left, FACTURE right
    + '<div class="header">'
    + '<div>'
    + '<div style="font-weight:700;font-size:14px;">' + (localStorage.getItem('bartender_profile_name')||'Antoine Duong') + '</div>'
    + '<div style="font-size:11px;color:#555;">Montréal, Québec</div>'
    + '</div>'
    + '<div style="text-align:right;"><h1>' + lang.title + '</h1>'
    + '<div class="label">' + lang.invoiceNo + ' </div><div>' + invoiceNum + '</div>'
    + '<div class="label">' + lang.billingDate + ' </div><div>' + todayStr + '</div>'
    + (eventDateFmt?'<div class="label">' + lang.eventDate + ' </div><div>' + eventDateFmt + '</div>':'')
    + '</div></div>'

    + '<hr class="divider">'

    // Client info
    + '<div class="info-block">'
    + '<div style="font-weight:700;font-size:13px;">' + clientName + '</div>'
    + '<div style="font-size:11px;color:#555;">' + guests + ' invités</div>'
    + '</div>'

    + '<hr class="divider">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">' + lang.serviceDesc + '</div>'
    + cocktailList
    + pairBlock

    // Service table
    + '<table><thead><tr>'
    + '<th>' + lang.colDate + '</th><th>' + lang.colRole + '</th><th style="text-align:center;">' + lang.colHrs + '</th><th style="text-align:right;">' + lang.colRate + '</th><th style="text-align:right;">' + lang.colTotal + '</th>'
    + '</tr></thead><tbody>' + rowsHTML + '</tbody></table>'

    // Totals
    + '<table class="totals-table" style="margin-left:auto;width:280px;">'
    + (totalDisc>0?'<tr><td>Sous-total</td><td style="text-align:right;">'+subBefore.toFixed(2)+' $</td></tr>':'')
    + (totalDisc>0?'<tr><td>Remise</td><td style="text-align:right;color:#c0392b;">- '+totalDisc.toFixed(2)+' $</td></tr>':'')
    + (taxEnabled2?'<tr><td>TPS (5%)</td><td style="text-align:right;">'+tps2.toFixed(2)+' $</td></tr>':'')
    + (taxEnabled2?'<tr><td>TVQ (9.975%)</td><td style="text-align:right;">'+tvq2.toFixed(2)+' $</td></tr>':'')
    + '<tr class="total-row"><td>TOTAL</td><td style="text-align:right;">'+grandTotal.toFixed(2)+' $</td></tr>'
    + (deposit2>0?'<tr><td style="color:#1a7a4a;">Acompte reçu</td><td style="text-align:right;color:#1a7a4a;">- '+deposit2.toFixed(2)+' $</td></tr>':'')
    + (deposit2>0?'<tr class="total-row"><td>SOLDE DÛ</td><td style="text-align:right;">'+balance.toFixed(2)+' $</td></tr>':'')
    + '</table>'

    + (notes2?'<div class="notes">' + notes2 + '</div>':'')
    + '<div style="text-align:center;margin-top:24px;font-size:11px;color:#aaa;">' + lang.footer + '</div>'
    + '</body></html>';

  // Save quote snapshot to event library
  saveDocSnapshot('quote', html);
  const w = window.open('','_blank');
  if(w && !w.closed){
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(()=>{ try{ w.print(); }catch(e){} }, 500);
  } else {
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (v('cn')||'client').replace(/[^a-z0-9]/gi,'_') + '_invoice.html';
    a.click();
    showToast('Invoice saved — open the file in your browser and print (Cmd+P)', 'success');
  }
  // Save snapshot to event library
  saveQuoteSnapshot(html);
}


// ════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════

let fiLang = 'fr';
let fiBeverageRowCount = 0;

function openFinalInvoice(){
  // Pre-fill from current event settings
  const quotedHrs = vf('eventHrs') || 4;
  const rate = vf('hr') || 100;
  const deposit = vf('depositAmt') || 0;
  const taxEnabled = el('taxEnabled') && el('taxEnabled').checked;

  sv('fiQuotedHrs', quotedHrs);
  sv('fiActualHrs', quotedHrs); // default to quoted
  sv('fiRate', rate);
  sv('fiDepositPaid', deposit);
  sv('fiExtraTravel', 0);
  sv('fiLateFee', 0);
  sv('fiDiscount', 0);
  sv('fiNotes', '');

  const taxEl = el('fiTax');
  if(taxEl) taxEl.checked = taxEnabled;

  // Pre-fill beverage rows from post-event leftovers
  fiBeverageRowCount = 0;
  const rowsEl = el('fiBeverageRows');
  if(rowsEl) rowsEl.innerHTML = '';

  // Add rows for items with leftover from shopping list
  const guests = vi('gc');
  const items = getIM(guests);
  items.filter(i => i.bottleInfo && i.leftover > 0).forEach(item => {
    addFiBeverageRow(item.name, item.leftover.toFixed(1), item.unit, (item.leftoverValue||0).toFixed(2));
  });

  if(fiBeverageRowCount === 0) addFiBeverageRow(); // at least one empty row

  updateFinalInvoiceTotal();
  el('finalInvoiceModalBg').classList.add('open');
}

const FI_NOTE_TEMPLATES = {
  thank_you: "Merci pour votre confiance et pour m'avoir accueilli \u00e0 votre \u00e9v\u00e9nement. Ce fut un plaisir de faire partie de cette belle occasion. Au plaisir de vous revoir!\n\nThank you for having me at your event. It was a pleasure to be part of this special occasion.",
  payment: "Paiement d\u00fb dans les 30 jours suivant la date de facturation.\nModes de paiement accept\u00e9s : virement Interac \u00b7 ch\u00e8que \u00b7 argent comptant.\n\nPayment due within 30 days of invoice date.\nAccepted methods: Interac e-transfer \u00b7 cheque \u00b7 cash.",
  pleasure: "Ce fut un plaisir de travailler avec vous. Votre \u00e9v\u00e9nement \u00e9tait impeccablement organis\u00e9 et vos invit\u00e9s ont sembl\u00e9 vraiment appr\u00e9cier l'exp\u00e9rience.\n\nIt was a genuine pleasure working with you. Your event was beautifully organized and your guests truly enjoyed the experience."
};

function appendFiNote(key){
  const textarea = el('fiNotes');
  if(!textarea) return;
  const existing = textarea.value.trim();
  textarea.value = existing ? existing + '\n\n' + FI_NOTE_TEMPLATES[key] : FI_NOTE_TEMPLATES[key];
}

function closeFinalInvoice(){
  el('finalInvoiceModalBg').classList.remove('open');
}

function setFiLang(lang){
  fiLang = lang;
  const frBtn = el('fiFRbtn'), enBtn = el('fiENbtn');
  if(frBtn){ frBtn.style.background = lang==='fr'?'#1a1a1a':'#fff'; frBtn.style.color = lang==='fr'?'#fff':'#888'; frBtn.style.fontWeight = lang==='fr'?'600':'400'; }
  if(enBtn){ enBtn.style.background = lang==='en'?'#1a1a1a':'#fff'; enBtn.style.color = lang==='en'?'#fff':'#888'; enBtn.style.fontWeight = lang==='en'?'600':'400'; }
  updateFinalInvoiceTotal();
}

function addFiBeverageRow(name, qty, unit, cost){
  const id = ++fiBeverageRowCount;
  const rowsEl = el('fiBeverageRows');
  if(!rowsEl) return;

  const row = document.createElement('div');
  row.id = 'fibev_' + id;
  row.style.cssText = 'display:grid;grid-template-columns:2fr 0.8fr 0.6fr 0.8fr auto;gap:6px;margin-bottom:6px;align-items:center;';

  const nameInp = document.createElement('input');
  nameInp.type = 'text'; nameInp.placeholder = 'Item (e.g. Hendricks Gin)';
  nameInp.id = 'fibev_name_' + id; nameInp.value = name || '';
  nameInp.style.fontSize = '13px';
  nameInp.addEventListener('input', updateFinalInvoiceTotal);

  const qtyInp = document.createElement('input');
  qtyInp.type = 'number'; qtyInp.placeholder = 'Qty'; qtyInp.min = '0'; qtyInp.step = '0.5';
  qtyInp.id = 'fibev_qty_' + id; qtyInp.value = qty || '';
  qtyInp.style.fontSize = '13px';
  qtyInp.addEventListener('input', updateFinalInvoiceTotal);

  const unitInp = document.createElement('input');
  unitInp.type = 'text'; unitInp.placeholder = 'oz';
  unitInp.id = 'fibev_unit_' + id; unitInp.value = unit || 'oz';
  unitInp.style.fontSize = '13px';

  const costInp = document.createElement('input');
  costInp.type = 'number'; costInp.placeholder = '$ value'; costInp.min = '0'; costInp.step = '0.5';
  costInp.id = 'fibev_cost_' + id; costInp.value = cost || '';
  costInp.style.fontSize = '13px';
  costInp.addEventListener('input', updateFinalInvoiceTotal);

  const removeBtn = document.createElement('button');
  removeBtn.className = 'btn btn-sm btn-danger';
  removeBtn.style.padding = '4px 8px';
  removeBtn.textContent = '✕';
  removeBtn.addEventListener('click', function(){ row.remove(); updateFinalInvoiceTotal(); });

  row.appendChild(nameInp);
  row.appendChild(qtyInp);
  row.appendChild(unitInp);
  row.appendChild(costInp);
  row.appendChild(removeBtn);
  rowsEl.appendChild(row);
}

function getFiBeverageRows(){
  const rows = [];
  for(let i = 1; i <= fiBeverageRowCount; i++){
    const nameEl = document.getElementById('fibev_name_'+i);
    if(!nameEl || !nameEl.closest('#fiBeverageRows')) continue; // was removed
    const name = nameEl.value.trim();
    if(!name) continue;
    const qty = parseFloat((document.getElementById('fibev_qty_'+i)||{}).value)||0;
    const unit = (document.getElementById('fibev_unit_'+i)||{}).value||'oz';
    const cost = parseFloat((document.getElementById('fibev_cost_'+i)||{}).value)||0;
    rows.push({name, qty, unit, cost});
  }
  return rows;
}

function getFiTotals(){
  const actualHrs = parseFloat(v('fiActualHrs'))||0;
  const quotedHrs = parseFloat(v('fiQuotedHrs'))||0;
  const rate = parseFloat(v('fiRate'))||0;
  const extraTravel = parseFloat(v('fiExtraTravel'))||0;
  const lateFee = parseFloat(v('fiLateFee'))||0;
  const discount = parseFloat(v('fiDiscount'))||0;
  const depositPaid = parseFloat(v('fiDepositPaid'))||0;
  const taxEnabled = el('fiTax') && el('fiTax').checked;
  const clientKept = el('fiClientKeptBottles') && el('fiClientKeptBottles').checked;
  const deductLeft = el('fiDeductLeftovers') && el('fiDeductLeftovers').checked;

  const beverageRows = getFiBeverageRows();
  const beverageBillable = clientKept ? beverageRows.reduce((s,r)=>s+r.cost,0) : 0;
  const beverageDeduct = deductLeft ? beverageRows.reduce((s,r)=>s+r.cost,0) : 0;

  // Get original quoted beverage cost
  const guests = vi('gc');
  const items = getIM(guests);
  const marginPct = vf('mp')||35;
  const markup = marginPct < 100 ? (marginPct/(100-marginPct))*100 : marginPct;
  const originalBevCost = items.reduce((s,i)=>s+i.purchaseCost,0);
  const markedUpBev = originalBevCost * (1 + markup/100);

  const labor = actualHrs * rate;
  const subBefore = markedUpBev + labor + extraTravel + lateFee + beverageBillable - beverageDeduct;
  const subAfterDisc = Math.max(0, subBefore - discount);
  const tps = taxEnabled ? subAfterDisc * 0.05 : 0;
  const tvq = taxEnabled ? subAfterDisc * 0.09975 : 0;
  const grandTotal = subAfterDisc + tps + tvq;
  const balance = Math.max(0, grandTotal - depositPaid);

  return { actualHrs, quotedHrs, rate, labor, markedUpBev, extraTravel, lateFee,
           beverageBillable, beverageDeduct, discount, subBefore, subAfterDisc,
           tps, tvq, grandTotal, depositPaid, balance, taxEnabled, beverageRows };
}

function updateFinalInvoiceTotal(){
  const t = getFiTotals();
  const preview = el('fiTotalPreview');
  const hrDiff = el('fiHrsDiff');
  if(!preview) return;

  // Hours diff hint
  if(hrDiff){
    const diff = t.actualHrs - t.quotedHrs;
    if(diff > 0) hrDiff.innerHTML = '<span style="color:#f59e0b;font-size:12px;">+'+diff.toFixed(1)+' hrs over quote · +$'+(diff*t.rate).toFixed(2)+'</span>';
    else if(diff < 0) hrDiff.innerHTML = '<span style="color:#1a7a4a;font-size:12px;">'+diff.toFixed(1)+' hrs · -$'+(Math.abs(diff)*t.rate).toFixed(2)+'</span>';
    else hrDiff.innerHTML = '<span style="color:#aaa;font-size:12px;">Same as quoted</span>';
  }

  // Total preview
  preview.innerHTML = '<div style="display:grid;grid-template-columns:1fr auto;gap:4px 16px;font-size:13px;">'
    + '<span style="color:#aaa;">Labor ('+t.actualHrs+' hrs × $'+t.rate+')</span><span style="text-align:right;">$'+t.labor.toFixed(2)+'</span>'
    + '<span style="color:#aaa;">Beverages (marked up)</span><span style="text-align:right;">$'+t.markedUpBev.toFixed(2)+'</span>'
    + (t.beverageBillable>0?'<span style="color:#aaa;">Client kept bottles</span><span style="text-align:right;">+$'+t.beverageBillable.toFixed(2)+'</span>':'')
    + (t.beverageDeduct>0?'<span style="color:#aaa;">Leftover deduction</span><span style="text-align:right;color:#1a7a4a;">-$'+t.beverageDeduct.toFixed(2)+'</span>':'')
    + (t.extraTravel>0?'<span style="color:#aaa;">Extra travel</span><span style="text-align:right;">$'+t.extraTravel.toFixed(2)+'</span>':'')
    + (t.lateFee>0?'<span style="color:#aaa;">Late fee / extra</span><span style="text-align:right;">$'+t.lateFee.toFixed(2)+'</span>':'')
    + (t.discount>0?'<span style="color:#1a7a4a;">Discount</span><span style="text-align:right;color:#1a7a4a;">-$'+t.discount.toFixed(2)+'</span>':'')
    + (t.taxEnabled?'<span style="color:#aaa;">TPS + TVQ</span><span style="text-align:right;">$'+(t.tps+t.tvq).toFixed(2)+'</span>':'')
    + '</div>'
    + '<div style="margin-top:10px;padding-top:10px;border-top:1px solid #333;display:flex;justify-content:space-between;font-size:16px;font-weight:600;">'
    + '<span>'+(t.depositPaid>0?'Balance due':'Total')+'</span>'
    + '<span>$'+t.balance.toFixed(2)+' CAD</span>'
    + '</div>'
    + (t.depositPaid>0?'<div style="font-size:11px;color:#aaa;margin-top:4px;">Grand total $'+t.grandTotal.toFixed(2)+' · deposit $'+t.depositPaid.toFixed(2)+' already paid</div>':'');
}

function printFinalInvoice(){
  const t = getFiTotals();
  const lang = PDF_STRINGS[fiLang] || PDF_STRINGS.fr;
  const clientName = v('cn') || 'Client';
  const eventDate = v('ed');
  const notes = v('fiNotes');
  const invoiceNum = 'FIN-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-4);
  const todayFmt = new Date().toLocaleDateString('fr-CA',{year:'numeric',month:'2-digit',day:'2-digit'});
  const eventDateFmt = eventDate ? new Date(eventDate+'T12:00:00').toLocaleDateString('fr-CA',{year:'numeric',month:'2-digit',day:'2-digit'}) : '';

  const rows = [
    {desc: (v('eventLabel')||'Services de bar'), role:'Bartender', hrs:t.actualHrs, rate:t.rate, total:t.labor}
  ];
  staffList.forEach(s => rows.push({desc:s.name||s.role, role:s.role, hrs:s.hours, rate:s.rate, total:s.rate*s.hours}));
  rows.push({desc:lang.beverages, role:'—', hrs:'—', rate:'—', total:t.markedUpBev});
  if(t.beverageBillable > 0) rows.push({desc:'Articles pris par le client / Items taken by client', role:'—', hrs:'—', rate:'—', total:t.beverageBillable});
  if(t.beverageDeduct > 0) rows.push({desc:'Déduction — surplus conservé / Leftover deduction', role:'—', hrs:'—', rate:'—', total:-t.beverageDeduct});
  if(t.extraTravel > 0) rows.push({desc:lang.travel + ' (supplémentaire)', role:'—', hrs:'—', rate:'—', total:t.extraTravel});
  if(t.lateFee > 0) rows.push({desc:'Frais supplémentaires / Extra charges', role:'—', hrs:'—', rate:'—', total:t.lateFee});

  // Beverage detail
  const bevDetail = t.beverageRows.length > 0
    ? '<p style="margin:6px 0 0;font-size:11px;color:#666;"><em>Articles: '
      + t.beverageRows.map(r => r.name + ' ' + r.qty + ' ' + r.unit + ' ($' + r.cost.toFixed(2) + ')').join(', ')
      + '</em></p>'
    : '';

  const rowsHTML = rows.map(r =>
    '<tr><td>' + (r.desc||'') + '</td><td>' + (r.role||'') + '</td>'
    + '<td style="text-align:center;">' + (r.hrs!=='—'?r.hrs:'—') + '</td>'
    + '<td style="text-align:right;">' + (r.rate!=='—'?'$'+parseFloat(r.rate).toFixed(2):r.rate) + '</td>'
    + '<td style="text-align:right;font-weight:500;' + (r.total<0?'color:#1a7a4a;':'') + '">'
    + (r.total<0?'-':''+'$'+Math.abs(r.total).toFixed(2)) + '</td></tr>'
  ).join('');

  const quotedNote = t.quotedHrs !== t.actualHrs
    ? '<p style="font-size:10px;color:#888;margin:4px 0 0;font-style:italic;">Heures prévues au devis / Quoted hours: ' + t.quotedHrs + 'h → réel / actual: ' + t.actualHrs + 'h</p>'
    : '';

  const html = '<!DOCTYPE html><html lang="'+(fiLang==='fr'?'fr':'en')+'"><head><meta charset="UTF-8">'
    + '<title>Facture finale — ' + clientName + '</title>'
    + '<style>'
    + 'body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;padding:40px;max-width:680px;margin:0 auto;}'
    + 'h1{font-size:28px;font-weight:700;letter-spacing:2px;margin:0;}'
    + '.final-badge{display:inline-block;font-size:10px;font-weight:700;background:#1a1a1a;color:#fff;padding:2px 8px;border-radius:4px;letter-spacing:.06em;margin-left:8px;vertical-align:middle;}'
    + '.header{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;}'
    + '.label{font-size:10px;font-weight:700;text-transform:uppercase;color:#888;}'
    + 'hr.divider{border:none;border-top:1.5px solid #222;margin:16px 0;}'
    + 'table{width:100%;border-collapse:collapse;margin:12px 0;}'
    + 'thead tr{background:#222;color:#fff;}'
    + 'thead th{padding:7px 10px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;text-align:left;}'
    + 'tbody td{padding:7px 10px;border-bottom:0.5px solid #eee;}'
    + '.totals-table{width:100%;border-collapse:collapse;}'
    + '.totals-table td{padding:4px 10px;}'
    + '.totals-table .total-row{font-weight:700;font-size:14px;border-top:1.5px solid #222;}'
    + '.notes{background:#f9f9f9;padding:12px;border-left:3px solid #222;font-size:11px;color:#555;margin-top:16px;white-space:pre-wrap;}'
    + '@media print{body{padding:20px;}}'
    + '</style></head><body>'
    + '<div class="header">'
    + '<div><div style="font-weight:700;font-size:14px;">' + lang.bartender + '</div><div style="font-size:11px;color:#555;">Montréal, Québec</div></div>'
    + '<div style="text-align:right;"><h1>' + lang.title + '<span class="final-badge">FINAL</span></h1>'
    + '<div class="label">' + lang.invoiceNo + ' </div><div>' + invoiceNum + '</div>'
    + '<div class="label">' + lang.billingDate + ' </div><div>' + todayFmt + '</div>'
    + (eventDateFmt?'<div class="label">' + lang.eventDate + ' </div><div>' + eventDateFmt + '</div>':'')
    + '</div></div>'
    + '<hr class="divider">'
    + '<div style="font-weight:700;font-size:13px;">' + clientName + '</div>'
    + '<div style="font-size:11px;color:#555;">' + vi('gc') + ' ' + lang.guests + '</div>'
    + '<hr class="divider">'
    + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">' + lang.serviceDesc + '</div>'
    + quotedNote + bevDetail
    + '<table><thead><tr>'
    + '<th>' + lang.colDate + '</th><th>' + lang.colRole + '</th><th style="text-align:center;">' + lang.colHrs + '</th>'
    + '<th style="text-align:right;">' + lang.colRate + '</th><th style="text-align:right;">' + lang.colTotal + '</th>'
    + '</tr></thead><tbody>' + rowsHTML + '</tbody></table>'
    + '<table class="totals-table" style="margin-left:auto;width:300px;">'
    + (t.discount>0?'<tr><td>' + lang.subtotal + '</td><td style="text-align:right;">' + t.subBefore.toFixed(2) + ' $</td></tr>':'')
    + (t.discount>0?'<tr><td>' + lang.discount + '</td><td style="text-align:right;color:#c0392b;">- ' + t.discount.toFixed(2) + ' $</td></tr>':'')
    + (t.taxEnabled?'<tr><td>' + lang.tps + '</td><td style="text-align:right;">' + t.tps.toFixed(2) + ' $</td></tr>':'')
    + (t.taxEnabled?'<tr><td>' + lang.tvq + '</td><td style="text-align:right;">' + t.tvq.toFixed(2) + ' $</td></tr>':'')
    + '<tr class="total-row"><td>' + lang.total + '</td><td style="text-align:right;">' + t.grandTotal.toFixed(2) + ' $</td></tr>'
    + (t.depositPaid>0?'<tr><td style="color:#1a7a4a;">' + lang.deposit + '</td><td style="text-align:right;color:#1a7a4a;">- ' + t.depositPaid.toFixed(2) + ' $</td></tr>':'')
    + (t.depositPaid>0?'<tr class="total-row"><td>' + lang.balance + '</td><td style="text-align:right;">' + t.balance.toFixed(2) + ' $</td></tr>':'')
    + '</table>'
    + (notes?'<div class="notes">' + notes + '</div>':'')
    + '<div style="text-align:center;margin-top:24px;font-size:11px;color:#aaa;">' + lang.footer + '</div>'
    + '</body></html>';

  // Try popup first, fallback to blob download if blocked
  saveInvoiceSnapshot(html, grandTotal||0, parseFloat(v('fiDepositPaid'))||0);
  // Save invoice snapshot to event library entry
  const fiGrandEl = document.querySelector('.fi-grand-total');
  const fiTotal = fiGrandEl ? parseFloat(fiGrandEl.dataset.total||0) : 0;
  saveDocSnapshot('invoice', html, fiTotal);

  // Save invoice snapshot to event library
  saveDocSnapshot('invoice', html);
  const w = window.open('','_blank');
  if(w && !w.closed){
    w.document.write(html); w.document.close(); w.focus();
    setTimeout(()=>{ try{ w.print(); }catch(e){} }, 500);
  } else {
    // Popup blocked — download as HTML file they can open and print
    const blob = new Blob([html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (v('cn')||'client').replace(/[^a-z0-9]/gi,'_') + '_invoice.html';
    a.click();
    showToast('PDF downloaded — open the file and print (Cmd+P)', 'success');
  }
  closeFinalInvoice();
}

// ════════════════════════════════════════════════════════════
