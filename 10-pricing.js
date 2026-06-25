// ═══ PRICING & QUOTES ═══
// Quote calculation (rQ), margin modes, pricing explainer,
// staff management, discount, syncSettings, cpShop, cpQ

function updatePricingPreview(){
  try {
    const guests  = vi('gc') || 50;
    const hrs     = vf('eventHrs') || 4;
    const rate    = vf('hr') || 0;
    const mp      = getMpAsMargin();
    const travel  = vf('tf') || 0;
    const taxOn   = el('taxEnabled') && el('taxEnabled').checked;

    const markup    = mp < 100 ? (mp / (100 - mp)) * 100 : mp;
    const items     = getIM(guests);
    const bevCost   = items.reduce((s,i) => s + i.purchaseCost, 0);
    const bevCharge = bevCost * (1 + markup / 100);
    const labor     = hrs * rate;
  const staffLab   = typeof getStaffLaborTotal === 'function' ? getStaffLaborTotal() : 0;

    // Discount — handle both modes
    const isDollar  = discountMode === 'dollar';
    const discAmt   = isDollar ? (vf('discountAmt') || 0) : 0;
    const discPct   = !isDollar ? (vf('discountPct') || 0) : 0;
    const sub0      = bevCharge + labor + staffLab + travel;
    const discValue = isDollar ? discAmt : sub0 * (discPct / 100);

    const sub       = Math.max(0, sub0 - discValue);
    const tps       = taxOn ? sub * 0.05 : 0;
    const tvq       = taxOn ? sub * 0.09975 : 0;
    const total     = sub + tps + tvq;
    const perGuest  = guests > 0 ? total / guests : 0;

    const fmt0 = n => '$' + n.toFixed(0);
    const fmt2 = n => '$' + n.toFixed(2);

    // Row 1: total (prominent)
    const ppTotal = el('ppTotal');
    if(ppTotal) ppTotal.textContent = fmt2(total) + ' CAD';

    const ppPG = el('ppPerGuest');
    if(ppPG) ppPG.textContent = guests > 0 ? '· ' + fmt0(perGuest) + '/guest' : '';

    // Row 2: breakdown
    const ppLabor = el('ppLabor');
    const totalLaborDisplay = staffLab > 0 ? fmt0(labor + staffLab) + ' labor (incl. staff)' : fmt0(labor) + ' labor';
  if(ppLabor) ppLabor.textContent = totalLaborDisplay;

    const ppBev = el('ppBev');
    const ppBevSep = el('ppBevSep');
    if(ppBev){
      if(bevCharge > 0){
        ppBev.textContent = fmt0(bevCharge) + ' bev (' + mp + '% margin)';
        if(ppBevSep) ppBevSep.style.display = '';
      } else {
        ppBev.textContent = '';
        if(ppBevSep) ppBevSep.style.display = 'none';
      }
    }

    const ppTravel = el('ppTravel');
    const ppTravSep = el('ppTravelSep');
    if(ppTravel){
      if(travel > 0){
        ppTravel.textContent = fmt0(travel) + ' travel';
        ppTravel.style.display = '';
        if(ppTravSep) ppTravSep.style.display = '';
      } else {
        ppTravel.textContent = ''; ppTravel.style.display = 'none';
        if(ppTravSep) ppTravSep.style.display = 'none';
      }
    }

    // Discount line
    const ppDisc = el('ppDisc');
    const ppDiscSep = el('ppDiscSep');
    if(ppDisc){
      if(discValue > 0){
        ppDisc.textContent = '- ' + fmt0(discValue) + ' discount' + (!isDollar ? ' (' + discPct + '%)' : '');
        ppDisc.style.display = '';
        if(ppDiscSep) ppDiscSep.style.display = '';
      } else {
        ppDisc.textContent = ''; ppDisc.style.display = 'none';
        if(ppDiscSep) ppDiscSep.style.display = 'none';
      }
    }

    // Tax note
    const ppTax = el('ppTax');
    if(ppTax) ppTax.textContent = taxOn ? '· TPS+TVQ incl.' : '';

    // Pour cost education line
    const ppPour = el('ppPourEdu');
    if(ppPour && bevCharge > 0){
      const actualPourCost = Math.round((bevCost / bevCharge) * 100);
      const bevProfit = bevCharge - bevCost;
      const barColor = actualPourCost <= 25 ? '#059669'
                     : actualPourCost <= 33 ? '#0891b2'
                     : actualPourCost <= 50 ? '#d97706'
                     : '#dc2626';
      ppPour.innerHTML =
        '<span style="color:#aaa;font-size:10px;">Pour cost: </span>'
        + '<span style="font-weight:600;color:' + barColor + ';">' + actualPourCost + '%</span>'
        + '<span style="color:#aaa;font-size:10px;"> · bev cost $' + bevCost.toFixed(2) + ' → charge $' + bevCharge.toFixed(2) + ' → profit $' + bevProfit.toFixed(2) + '</span>';
    } else if(ppPour){
      ppPour.innerHTML = '';
    }

  } catch(e){ /* quote not ready yet */ }
}

// ════════════════════════════════════════════════════════════
// MARGIN % vs POUR COST % toggle
// mp field always stores MARGIN % internally
// Pour cost mode converts on input/display
// Relationship: pour_cost = 100 - margin (they are direct inverses)
// Industry standard: 20–25% pour cost = 75–80% margin
// ════════════════════════════════════════════════════════════

let mpMode = 'margin'; // 'margin' or 'pour'

function setMpMode(mode){
  // Convert the currently displayed value before switching modes
  // so the underlying margin stays the same — only the display changes
  const currentMargin = getMpAsMargin(); // read as margin before mode changes
  mpMode = mode;

  // Now re-display in the new unit
  if(mode === 'pour'){
    sv('mp', Math.round(100 - currentMargin)); // show pour cost = 100 - margin
  } else {
    sv('mp', Math.round(currentMargin)); // show margin directly
  }

  // Update toggle button styles
  const marginBtn = el('mpModeMargin');
  const pourBtn   = el('mpModePour');
  const lbl       = el('mpModeLabel');
  if(marginBtn){
    marginBtn.style.background = mode==='margin' ? '#1a1a1a' : 'transparent';
    marginBtn.style.color      = mode==='margin' ? '#fff'    : '#aaa';
    marginBtn.style.fontWeight = mode==='margin' ? '600'     : '400';
  }
  if(pourBtn){
    pourBtn.style.background = mode==='pour' ? '#1a1a1a' : 'transparent';
    pourBtn.style.color      = mode==='pour' ? '#fff'    : '#aaa';
    pourBtn.style.fontWeight = mode==='pour' ? '600'     : '400';
  }
  if(lbl) lbl.textContent = mode==='margin' ? 'Ingredient margin' : 'Pour cost target';

  updateMpEquiv();
  rQ();
  markUnsaved();
}

function updateMpEquiv(){
  const equivEl = el('mpEquivLine');
  if(!equivEl) return;

  // Always work in margin % internally
  const margin   = Math.max(1, Math.min(99, getMpAsMargin()));
  const pourCost = Math.round(100 - margin);
  const markup   = ((margin / (100 - margin)) * 100).toFixed(0);

  // Industry benchmark is based on pour cost
  const note = pourCost <= 25 ? '✅ Excellent — top-tier profitability'
             : pourCost <= 33 ? '✓ Good — professional range'
             : pourCost <= 50 ? '⚠ Moderate — common but improvable'
             :                  '⚠ Low — you may be undercharging';

  if(mpMode === 'margin'){
    // User typed margin % — show pour cost + markup as info
    equivEl.innerHTML =
      'Pour cost: <strong>' + pourCost + '%</strong>'
      + ' &nbsp;·&nbsp; Markup: <strong>×' + markup + '%</strong>'
      + ' &nbsp;<span style="color:#888;font-weight:400;">' + note + '</span>';
  } else {
    // User typed pour cost % — show margin as info
    equivEl.innerHTML =
      'Margin: <strong>' + Math.round(margin) + '%</strong>'
      + ' &nbsp;·&nbsp; Markup: <strong>×' + markup + '%</strong>'
      + ' &nbsp;<span style="color:#888;font-weight:400;">' + note + '</span>';
  }
}

function getMpAsMargin(){
  // mp field holds MARGIN % when mode=margin, POUR COST % when mode=pour
  // Always return the equivalent MARGIN % for use in calculations
  const val = vf('mp') || 75;
  return mpMode === 'pour' ? (100 - val) : val;
}

function openPricingExplainer(e){
  if(e) e.stopPropagation();

  // Pull live numbers from the current event settings
  const margin   = getMpAsMargin();
  const pourCost = Math.round(100 - margin);
  const markup   = margin < 100 ? ((margin / (100 - margin)) * 100).toFixed(1) : '—';

  // Example: $100 of ingredients
  const exCost    = 100;
  const exCharge  = (exCost * (1 + parseFloat(markup)/100)).toFixed(2);
  const exProfit  = (parseFloat(exCharge) - exCost).toFixed(2);

  // Benchmark rating
  const rating = pourCost <= 25 ? {label:'Excellent',color:'#059669',stars:'★★★★★'}
               : pourCost <= 33 ? {label:'Good',color:'#0891b2',stars:'★★★★☆'}
               : pourCost <= 50 ? {label:'Moderate',color:'#d97706',stars:'★★★☆☆'}
               :                  {label:'Low margin',color:'#dc2626',stars:'★★☆☆☆'};

  const benchmarkTip = pourCost <= 25
    ? "You are in the top range. Excellent profitability on ingredients."
    : pourCost <= 33
    ? "You are in a solid professional range."
    : pourCost <= 50
    ? "There is room to improve. Try raising prices gradually."
    : "Your ingredient pricing is quite low vs industry standards. Consider raising prices by 20-30%.";
  const html = `
    <!-- THE CORE IDEA -->
    <div style="background:#f9f9f6;border-radius:10px;padding:14px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">The basic idea 💡</div>
      <div style="font-size:13px;color:#555;line-height:1.6;">
        You buy ingredients, you charge the client more than you paid.
        The gap between what you pay and what you charge is your profit on beverages.
        These percentages just describe <em>how big that gap is</em>.
      </div>
    </div>

    <!-- LIVE EXAMPLE WITH REAL NUMBERS -->
    <div style="background:#edfaf3;border:1px solid #c8e6d4;border-radius:10px;padding:14px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#1a7a4a;margin-bottom:10px;">Your numbers right now</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;margin-bottom:10px;">
        <div style="background:#fff;border-radius:8px;padding:10px;">
          <div style="font-size:20px;font-weight:700;color:#1a1a1a;">${exCost}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">You pay</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;">
          <div style="font-size:20px;font-weight:700;color:#2156b8;">$${exCharge}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">Client pays</div>
        </div>
        <div style="background:#fff;border-radius:8px;padding:10px;">
          <div style="font-size:20px;font-weight:700;color:#059669;">$${exProfit}</div>
          <div style="font-size:11px;color:#888;margin-top:2px;">Your profit</div>
        </div>
      </div>
      <div style="font-size:12px;color:#555;text-align:center;">
        For every <strong>$100</strong> of ingredients you buy, you charge the client <strong>$${exCharge}</strong> and keep <strong>$${exProfit}</strong>.
      </div>
    </div>

    <!-- THE THREE NUMBERS EXPLAINED -->
    <div style="margin-bottom:16px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">What each number means</div>

      <div style="display:flex;gap:10px;align-items:flex-start;padding:10px;background:#f9f9f6;border-radius:8px;margin-bottom:8px;">
        <div style="font-size:22px;flex-shrink:0;">📈</div>
        <div>
          <div style="font-size:13px;font-weight:600;">Margin — <strong>${margin}%</strong></div>
          <div style="font-size:12px;color:#555;margin-top:3px;line-height:1.5;">
            Out of every dollar the client pays for beverages, you keep ${margin} cents as profit.
            The other ${pourCost} cents is what you spent on ingredients.
            <em>Higher = better for you.</em>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:flex-start;padding:10px;background:#f9f9f6;border-radius:8px;margin-bottom:8px;">
        <div style="font-size:22px;flex-shrink:0;">🧾</div>
        <div>
          <div style="font-size:13px;font-weight:600;">Pour cost — <strong>${pourCost}%</strong></div>
          <div style="font-size:12px;color:#555;margin-top:3px;line-height:1.5;">
            Out of every dollar the client pays, ${pourCost} cents went to buying the ingredients.
            This is what bars and bartenders track to measure profitability.
            <em>Lower = better for you.</em>
          </div>
        </div>
      </div>

      <div style="display:flex;gap:10px;align-items:flex-start;padding:10px;background:#f9f9f6;border-radius:8px;">
        <div style="font-size:22px;flex-shrink:0;">🔢</div>
        <div>
          <div style="font-size:13px;font-weight:600;">Markup — <strong>${markup}%</strong></div>
          <div style="font-size:12px;color:#555;margin-top:3px;line-height:1.5;">
            How much you add on top of ingredient cost. A ${markup}% markup means if an ingredient
            costs $10, you charge $${(10 * (1 + parseFloat(markup)/100)).toFixed(2)} for it.
            <em>Higher = better for you, but watch client perception.</em>
          </div>
        </div>
      </div>
    </div>

    <!-- INDUSTRY BENCHMARK -->
    <div style="border:1px solid ${rating.color}30;background:${rating.color}10;border-radius:10px;padding:14px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
        <span style="font-size:15px;">${rating.stars}</span>
        <span style="font-size:13px;font-weight:700;color:${rating.color};">${rating.label}</span>
      </div>
      <div style="font-size:12px;color:#555;line-height:1.6;">
        Professional bars and freelance bartenders typically target a <strong>pour cost of 20–25%</strong>
        (margin of 75–80%). Your current pour cost is <strong>${pourCost}%</strong>.
        ${benchmarkTip}
    </div>

    <!-- HOW TO IMPROVE -->
    <div style="margin-bottom:8px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;">How to improve your numbers</div>
      <div style="font-size:12px;color:#555;line-height:1.8;">
        🔽 <strong>Lower pour cost</strong> → charge clients more per drink, or find cheaper ingredient sources<br>
        🔼 <strong>Higher margin</strong> → same thing — charge more for the same ingredients<br>
        💡 Your <strong>hourly rate and labor</strong> are separate from this — pour cost only measures ingredient profitability
      </div>
    </div>

    <button onclick="closePricingExplainer()" style="width:100%;padding:10px;background:#1a1a1a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:500;cursor:pointer;font-family:inherit;margin-top:8px;">Got it</button>
  `;

  const body = document.getElementById('pricingExplainerBody');
  if(body) body.innerHTML = html;
  document.getElementById('pricingExplainerBg').style.display = 'block';
}

function closePricingExplainer(){
  document.getElementById('pricingExplainerBg').style.display = 'none';
let rcManualOverride = false;

function autoFillResale(){ /* resale credit removed — leftover tracked in Inventory tab */ }

// ════════════════════════════════════════════════════════════
// ADDITIONAL STAFF
// ════════════════════════════════════════════════════════════
let staffList = [];

const STAFF_ROLES = [
  'Bartender', 'Lead bartender', 'Barback', 'Server', 
  'Cocktail waitress/waiter', 'Event coordinator', 'Security', 'Other'
];

function addStaff(preset) {
  staffList.push({
    id: 'st' + Date.now() + Math.random().toString(36).slice(2,6),
    name:  preset ? preset.name  : '',
    role:  preset ? preset.role  : 'Bartender',
    rate:  preset ? preset.rate  : 25,
    hours: preset ? preset.hours : vf('eventHrs') || 4,
  });
  renderStaff();
  rQ();
  markUnsaved();
}

function removeStaff(id) {
  staffList = staffList.filter(s => s.id !== id);
  renderStaff();
  rQ();
  markUnsaved();
}

function updateStaff(id, field, value) {
  const s = staffList.find(s => s.id === id);
  if (!s) return;
  s[field] = (['rate','hours'].includes(field)) ? (parseFloat(value) || 0) : value;
  renderStaff();
  rQ();
  markUnsaved();
}

function getStaffLaborTotal() {
  return staffList.reduce((sum, s) => sum + (s.rate * s.hours), 0);
}

function renderStaff() {
  const listEl = el('staffList');
  if (!listEl) return;

  if (!staffList.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:#bbb;padding:4px 0;">No additional staff — click &quot;+ Add staff member&quot; to add someone</div>';
    return;
  }

  // Only rebuild if the row count changed (avoids destroying focus on every keystroke)
  const existingRows = listEl.querySelectorAll('.staff-row').length;
  if (existingRows !== staffList.length) {
    // Full rebuild needed
    const total = getStaffLaborTotal();
    let html = '<div class="staff-header"><span>Name</span><span>Role</span><span>Rate ($/hr)</span><span>Hours</span><span></span></div>';
    staffList.forEach(s => {
      const roleOpts = STAFF_ROLES.map(r => '<option' + (r===s.role?' selected':'') + '>' + r + '</option>').join('');
      html += '<div class="staff-row" data-sid="' + s.id + '">'
        + '<input type="text" value="' + (s.name||'').replace(/"/g,'&quot;') + '" placeholder="e.g. Alex Martin"'
        + ' data-sid="' + s.id + '" data-field="name" onchange="updateStaffField(this)" oninput="updateStaffField(this)">'
        + '<select data-sid="' + s.id + '" data-field="role" onchange="updateStaffField(this)">' + roleOpts + '</select>'
        + '<input type="number" value="' + s.rate + '" min="0" step="5"'
        + ' data-sid="' + s.id + '" data-field="rate" onchange="updateStaffField(this)">'
        + '<input type="number" value="' + s.hours + '" min="0.5" step="0.5"'
        + ' data-sid="' + s.id + '" data-field="hours" onchange="updateStaffField(this)">'
        + '<button class="btn btn-sm btn-danger" data-sid="' + s.id + '" onclick="removeStaff(this.dataset.sid)">✕</button>'
        + '</div>';
    });
    html += '<div class="staff-total" id="staffTotal"></div>';
    listEl.innerHTML = html;
  }
  // Always update the total line without re-rendering inputs
  updateStaffTotal();
}

function updateStaffField(input) {
  const sid = input.dataset.sid;
  const field = input.dataset.field;
  const s = staffList.find(x => x.id === sid);
  if (!s) return;
  s[field] = (['rate','hours'].includes(field)) ? (parseFloat(input.value) || 0) : input.value;
  updateStaffTotal();
  rQ();
  markUnsaved();
}

function updateStaffTotal() {
  const total = getStaffLaborTotal();
  const totalEl = el('staffTotal');
  if (totalEl) {
    totalEl.innerHTML = staffList.length + ' additional staff · Total additional labor: <strong>$' + total.toFixed(2) + ' CAD</strong>'
      + ' · Avg $' + (staffList.length ? (total/staffList.length).toFixed(2) : '0.00') + '/person';
  }
}

function getStaffQuoteLines() {
  if (!staffList.length) return '';
  const total = getStaffLaborTotal();
  const lines = staffList.map(s =>
    `<div class="ql" style="padding-left:12px;"><span>${s.name ? s.name : s.role} (${s.hours}h × $${s.rate}/h)</span><span>$${(s.rate*s.hours).toFixed(2)}</span></div>`
  ).join('');
  return `
    <div class="ql" style="font-weight:500;"><span>Additional staff labor</span><span>$${total.toFixed(2)}</span></div>
    ${lines}`;
}

function getStaffClientLines() {
  // Client-facing version — no names, rates, or per-person breakdown visible
  // Just one clean "Event staff" line with the combined total
  if (!staffList.length) return '';
  const totalLabor = getStaffLaborTotal();
  const hoursOfService = vf('eventHrs') || 4;
  // Build a clean role summary (e.g. "2 bartenders, 1 barback") without any rates
  const roleCounts = {};
  staffList.forEach(s => {
    const role = (s.role || 'Staff').toLowerCase();
    roleCounts[role] = (roleCounts[role] || 0) + 1;
  });
  const roleStr = Object.entries(roleCounts)
    .map(([role, count]) => count > 1 ? count + ' ' + role + 's' : '1 ' + role)
    .join(', ');
  return `
    <div style="display:flex;justify-content:space-between;font-size:14px;padding:4px 0;color:#666;">
      <span>Event staff (${roleStr})</span>
      <span>$${totalLabor.toFixed(2)}</span>
    </div>`;
}

// ── NOTE / TERMS TEMPLATES ───────────────────────────────
function getNoteTemplate(key){
  const hrs = vf('eventHrs') || 4;
  const lang = pdfLang || 'fr'; // use the selected PDF language
  
  if(lang === 'fr'){
    if(key === 'wedding') return "Ce qui est inclus :\n• Installation et démontage complet du bar\n• Menu de cocktails personnalisé (tel que soumis)\n• Tout l'équipement, les outils et les garnitures\n• " + hrs + " heures de service au bar\n\nPaiement :\n• Un dépôt non remboursable de 25 % est requis pour confirmer la date.\n• Le solde restant est dû 7 jours avant l'événement.\n\nModifications :\n• Changements jusqu'à 10 % du nombre d'invités acceptés avec 14 jours d'avis.\n• Les changements au-delà de 10 % peuvent entraîner une révision du devis.";
    if(key === 'corporate') return "Ce qui est inclus :\n• Installation et démontage complet du bar\n• Menu de cocktails tel que soumis\n• Tout l'équipement, les outils et les fournitures\n• " + hrs + " heures de service au bar\n\nPaiement :\n• Facture payable dans les 30 jours suivant l'événement.\n• Une confirmation de devis signée est requise avant l'événement.\n\nModifications :\n• Les changements doivent être demandés par écrit au moins 7 jours à l'avance.";
    if(key === 'cancellation') return "Politique d'annulation :\n• 30+ jours avant : remboursement complet moins le dépôt.\n• 15-29 jours avant : 50 % du montant total est dû.\n• Moins de 14 jours avant : 100 % du montant total est dû.\n• Maladie/urgence : contactez-nous rapidement — nous trouverons une solution.\n\nModifications du devis :\n• Ce devis est valide 14 jours à compter de la date d'émission.\n• Les modifications après signature peuvent entraîner un devis révisé.\n• Le prix est garanti dès la réception du dépôt.";
  } else {
    if(key === 'wedding') return "What's included:\n• Full bar setup and breakdown\n• Custom cocktail menu (as quoted)\n• All equipment, tools, and garnishes\n• " + hrs + " hours of bar service\n\nPayment:\n• A non-refundable deposit of 25% is required to confirm the date.\n• Remaining balance is due 7 days before the event.\n\nModifications:\n• Guest count changes up to 10% accommodated with 14 days notice.\n• Changes beyond 10% may result in a revised quote.";
    if(key === 'corporate') return "What's included:\n• Full bar setup and breakdown\n• Cocktail menu as quoted\n• All equipment, tools, and supplies\n• " + hrs + " hours of bar service\n\nPayment:\n• Invoice due within 30 days of event.\n• A signed quote confirmation is required before the event.\n\nModifications:\n• Guest count or menu changes must be requested in writing 7+ days prior.";
    if(key === 'cancellation') return "Cancellation policy:\n• 30+ days before event: full refund minus deposit.\n• 15-29 days before: 50% of quoted total is owed.\n• Less than 14 days before: 100% of quoted total is owed.\n• Illness/emergency: contact us early — we will find a solution.\n\nQuote modifications:\n• This quote is valid for 14 days from the date issued.\n• Changes after signing may result in a revised quote.\n• The quoted price is guaranteed once a deposit is received.";
  }
  return '';
}


function insertNoteTemplate(key){
  const existing = v('qn').trim();
  const template = getNoteTemplate(key);
  if(!template) return;
  if(existing && !confirm('Replace current notes with the ' + key + ' template?')) return;
  sv('qn', template);
  rQ(); markUnsaved();
}

let discountMode = '$'; // '$' or '%' 

function setDiscountMode(mode){
  discountMode = mode; // 'dollar' or 'pct'
  const amtEl = el('discountAmt'), pctEl = el('discountPct');
  const btnD = el('discToggleDollar'), btnP = el('discTogglePct');
  const isDollar = mode === 'dollar';
  if(amtEl) amtEl.style.display = isDollar ? '' : 'none';
  if(pctEl) pctEl.style.display = isDollar ? 'none' : '';
  if(btnD){
    btnD.style.background = isDollar ? '#e8f0fd' : 'transparent';
    btnD.style.color      = isDollar ? '#2156b8' : '#aaa';
    btnD.style.fontWeight = isDollar ? '600' : '400';
  }
  if(btnP){
    btnP.style.background = !isDollar ? '#e8f0fd' : 'transparent';
    btnP.style.color      = !isDollar ? '#2156b8' : '#aaa';
    btnP.style.fontWeight = !isDollar ? '600' : '400';
  }
  if(isDollar){ sv('discountPct', 0); } else { sv('discountAmt', 0); }
  rQ(); markUnsaved();
}

function syncSettings(){
  const guests = qvi('gc');
  const dpp = qvf('drinksPerPerson') || 5;
  const buf = qvf('bufferPct') || 0;
  const hrs = qvf('eventHrs') || 4;
  const rate = qvf('hr') || 0;
  const mp = qvf('mp') || 35;
  const base = guests * dpp;
  const total = Math.round(base * (1 + buf/100));
  gc2('consModelInline', `${guests} guests · ${total} drinks est. (incl. ${buf}% buffer)`);

  // Labor total hint
  const laborTotal = hrs * rate;
  const laborEl = el('laborTotalLabel');
  if(laborEl) laborEl.textContent = laborTotal > 0 ? `= $${laborTotal.toFixed(0)} labor` : '';

  // Margin % → show equivalent markup for info
  // margin = mp (user enters margin directly now)
  // The internal markup for calculations = margin / (1 - margin/100)
  const markupEl = el('markupEquivLabel');
  if(markupEl){
    const impliedMarkup = mp > 0 && mp < 100 ? (mp / (100 - mp)) * 100 : 0;
    markupEl.textContent = mp > 0 ? `= ${impliedMarkup.toFixed(0)}% markup` : '';
  }

  // Update toolbar display span with current event label
  const labelVal = qv('eventLabel');
  const dispEl = el('eventLabelDisplay');
  if(dispEl){
    const labelToShow = (menuEventActive && menuEventActive !== 'selecting') ? (labelVal || '') : '';
    const statusVal = qv('quoteStatus') || 'draft';
    const statusColors = {draft:'#888',sent:'#2563eb',confirmed:'#16a34a',completed:'#16a34a',cancelled:'#dc2626'};
    const statusDot = labelToShow ? '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:'+
      (statusColors[statusVal]||'#888')+'margin-left:5px;vertical-align:middle;" title="'+statusVal+'"></span>' : '';
    if(labelToShow){
      dispEl.innerHTML = labelToShow + statusDot;
      dispEl.style.display = '';
    } else {
      dispEl.textContent = '';
      dispEl.style.display = 'none';
    }
  }

  // DPP hint based on hours
  const dppHintEl = el('dppHint');
  if(dppHintEl){
    const hint = hrs <= 2 ? '(2hr event: try 2–3)' : hrs <= 3 ? '(3hr: try 3–4)' : hrs <= 4 ? '(4hr: try 5–6)' : hrs <= 5 ? '(5hr: try 6–8)' : '(6hr+: try 7–9)';
    dppHintEl.textContent = hint;
  }

  // Live pricing preview
  updatePricingPreview();

  // Show deposit field only when quote exceeds $500 threshold
  const DEPOSIT_THRESHOLD = 500;
  const depositWrap = el('depositFieldWrap');
  const depositHint2 = el('depositThresholdHint');
  try {
    const roughItems = getIM(qvi('gc'));
    const roughPurchase = roughItems.reduce((s2,i)=>s2+i.purchaseCost,0);
    const roughMp = qvf('mp')||35;
    const roughMkup = roughMp<100?(roughMp/(100-roughMp))*100:roughMp;
    const roughTotal = roughPurchase*(1+roughMkup/100) + qvf('eventHrs')*qvf('hr') + qvf('tf');
    if(depositWrap) depositWrap.style.display = ''; // always show deposit field
    if(depositHint2 && roughTotal >= DEPOSIT_THRESHOLD) depositHint2.textContent = '(quote over $' + DEPOSIT_THRESHOLD + ')';
  } catch(e){}
}

function getConsumptionGuests(){
  const guests = vi('gc');
  const dpp = vf('drinksPerPerson') || 5; // flat total drinks per person, whole event
  const bufferPct = vf('bufferPct') || 0;
  const totalDrinks = guests * dpp;
  const withBuffer = totalDrinks * (1 + bufferPct/100);
  // Convert to effective guest count so existing drinks-per-guest math still works
  const totalDpg = cocktails.length ? cocktails.reduce((s,c2)=>s+c2.dpg,0) : 1;
  const effectiveGuests = totalDpg > 0 ? Math.ceil(withBuffer / totalDpg) : guests;
  gc2('consModelInline',`${guests} guests · ${Math.round(withBuffer)} drinks est. (incl. ${bufferPct}% buffer)`);
  return {guests, effectiveGuests: Math.max(effectiveGuests, guests), totalDrinks: Math.round(withBuffer)};
}

let shopSelectedEventIds = null; // null = current event only
function rQ(){
  const guests=qvi('gc'),hours=qvf('eventHrs'),rate=qvf('hr'),travel=qvf('tf');
  const marginPct=getMpAsMargin();
  const mkup=marginPct<100?(marginPct/(100-marginPct))*100:marginPct;
  const taxEl=el('taxEnabled');
  const taxEnabled=taxEl&&taxEl.checked;
  const deposit=qvf('depositAmt')||0;
  const discountAmt=qvf('discountAmt')||0;
  const discountPct=qvf('discountPct')||0;
  const items=getIM(guests);
  const purchaseTotal=items.reduce((s,i)=>s+i.purchaseCost,0);
  const rawTotal=items.reduce((s,i)=>s+i.qtyRaw*i.cpu,0);
  const leftoverTotal=items.reduce((s,i)=>s+i.leftoverValue,0);
  const mked=purchaseTotal*(1+mkup/100),labor=hours*rate;
  const staffLabor=getStaffLaborTotal();
  const subtotalBeforeDiscount=mked+labor+staffLabor+travel;
  const pctDiscountValue=subtotalBeforeDiscount*(discountPct/100);
  const totalDiscount=discountAmt+pctDiscountValue;
  const subtotalBeforeTax=subtotalBeforeDiscount-totalDiscount;
  // Update discount status display
  const dStatus=el('discountStatus');
  if(dStatus) dStatus.textContent=totalDiscount>0?'Discount: -$'+totalDiscount.toFixed(2)+' CAD':'';
  const tps=taxEnabled?subtotalBeforeTax*0.05:0;
  const tvq=taxEnabled?subtotalBeforeTax*0.09975:0;
  const total=subtotalBeforeTax+tps+tvq;
  const profit=mked-purchaseTotal;
  const balanceOwing=total-deposit;
  gc2('depositStatus',deposit>0?`Balance owing: $${balanceOwing.toFixed(2)} CAD`:'');
  // Also update the inline balance display next to the deposit input
  const depBalEl = el('depositBalanceDisplay');
  if(depBalEl){
    if(deposit > 0 && total > 0){
      const outstanding = total - deposit;
      if(outstanding <= 0){
        depBalEl.textContent = '✓ Fully paid';
        depBalEl.style.color = 'var(--green)';
      } else {
        depBalEl.textContent = 'Balance owing: $' + outstanding.toFixed(2) + ' CAD';
        depBalEl.style.color = outstanding < total * 0.5 ? 'var(--amber)' : 'var(--red)';
      }
    } else {
      depBalEl.textContent = '';
    }
  }
  syncSettings(); updateStatusBadge(); // (discountMode preserved — do not reset here)
  const cn=qv('cn')||'Client',ed=qv('ed'),notes=qv('qn');
  const dateStr=ed?new Date(ed+'T12:00:00').toLocaleDateString('en-CA',{year:'numeric',month:'long',day:'numeric'}):'';
  shtml('qprev',`
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem;flex-wrap:wrap;gap:8px;">
        <div><div style="font-weight:700;font-size:18px;">${cn}</div>${dateStr?`<div style="font-size:14px;color:#666;margin-top:2px;">${dateStr}</div>`:''}</div>
        <div style="font-size:13px;color:#888;text-align:right;">${guests} guests · ${cocktails.length} cocktail${cocktails.length!==1?'s':''}<br>${hours}h of service</div>
      </div>
      ${(()=>{
        if(!cocktails.length) return '';
        const buf = qvf('bufferPct')||15;
        const rows = cocktails.map(c2=>{
          const rawCost = c2.ing.reduce((s,i)=>s+i.c*i.q,0);
          const markedUp = rawCost*(1+mkup/100);
          const qtyEst = Math.round(c2.dpg * guests * (1+buf/100));
          return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:6px;font-size:12px;padding:6px 10px;border-bottom:1px solid #f5f5f0;align-items:center;">'
            + '<span style="font-weight:500;">' + c2.name + '</span>'
            + '<span style="color:#888;">$' + rawCost.toFixed(2) + '</span>'
            + '<span style="color:#1a1a1a;font-weight:500;">$' + markedUp.toFixed(2) + '</span>'
            + '<span style="color:#888;">' + c2.dpg + '</span>'
            + '<span style="color:#888;">' + qtyEst + ' drinks</span>'
            + '</div>';
        }).join('');
        return '<div style="font-size:13px;color:#666;margin-bottom:.5rem;"><strong>Menu:</strong> ' + cocktails.map(c=>c.name).join(', ') + '</div>'
          + '<div style="border:1px solid #f0f0eb;border-radius:8px;overflow:hidden;margin-bottom:.75rem;">'
          + '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:6px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;padding:6px 10px;background:#fafaf7;border-bottom:1px solid #f0f0eb;">'
          + '<span>Cocktail</span><span>$/drink (raw)</span><span>$/drink (marked up)</span><span>Drinks/guest</span><span>Qty est.</span>'
          + '</div>' + rows + '</div>';
      })()}
      ${getPairQuoteBlock()}
      <hr class="divider">
      <div style="background:#f9f9f6;border-radius:10px;padding:1rem;margin-bottom:.5rem;">
        <div class="ql"><span>Ingredients — raw usage cost</span><span style="color:#aaa;">$${rawTotal.toFixed(2)}</span></div>
        <div class="ql" style="font-weight:500;"><span>Ingredients — actual purchase (full bottles)</span><span>$${purchaseTotal.toFixed(2)}</span></div>
        <div class="ql"><span>Markup (${mkup}%)</span><span>+ $${(mked-purchaseTotal).toFixed(2)}</span></div>
        <div class="ql" style="font-weight:500;"><span>Your labor (${hours}h × $${rate}/h)</span><span>$${labor.toFixed(2)}</span></div>
        ${getStaffQuoteLines()}
        ${travel>0?`<div class="ql"><span>Travel / setup</span><span>$${travel.toFixed(2)}</span></div>`:''}
        <!-- Resale/inventory credit removed from quote — tracked in Inventory tab -->
        ${totalDiscount>0?`
        <div style="border-top:1px dashed #ddd;margin:6px 0;"></div>
        ${discountPct>0?`<div class="ql" style="color:#c0392b;"><span>Discount (${discountPct}%)</span><span>- $${pctDiscountValue.toFixed(2)}</span></div>`:''}
        ${discountAmt>0?`<div class="ql" style="color:#c0392b;"><span>Flat discount</span><span>- $${discountAmt.toFixed(2)}</span></div>`:''}
        `:''}
        ${taxEnabled?`
        <div style="border-top:1px dashed #ddd;margin:6px 0;"></div>
        <div class="ql"><span>Subtotal (before tax)</span><span>$${subtotalBeforeTax.toFixed(2)}</span></div>
        <div class="ql"><span>TPS (5%)</span><span>$${tps.toFixed(2)}</span></div>
        <div class="ql"><span>TVQ (9.975%)</span><span>$${tvq.toFixed(2)}</span></div>`:''}
        <div class="qt"><span>Total quote</span><span>$${total.toFixed(2)} CAD</span></div>
        ${deposit>0?`<div class="ql" style="color:#1a7a4a;"><span>Deposit received</span><span>- $${deposit.toFixed(2)}</span></div><div class="ql" style="font-weight:500;"><span>Balance owing</span><span>$${balanceOwing.toFixed(2)} CAD</span></div>`:''}
      </div>
      <div class="qprofit">💰 Your profit: <strong>$${profit.toFixed(2)} CAD</strong>
        · <strong>${marginPct}% margin</strong>
        · <strong>$${(total/Math.max(guests,1)).toFixed(2)}/guest</strong>
      </div>
      ${getInventoryProfitLine(guests)}
      ${notes?`<div style="margin-top:.75rem;font-size:13px;color:#555;border-top:1px solid #eee;padding-top:.75rem;"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#aaa;margin-bottom:6px;">${L.notes||'Notes'}</div><div style="white-space:pre-wrap;line-height:1.6;">${notes}</div></div>`:''}
    </div>`);
}

function cpShop(){
  const guests=vi('gc'),items=getIM(guests),lbl=v('eventLabel')||'Event';
  const tcPurchase=items.reduce((s,i)=>s+i.purchaseCost,0);
  const leftover=items.reduce((s,i)=>s+i.leftoverValue,0);
  const lines=items.map(i=>{
    if(i.bottleInfo) return `• ${i.name}: ${i.bottles} × ${i.bottleInfo.bottleLabel}  ($${i.purchaseCost.toFixed(2)} CAD · ${i.leftover.toFixed(1)}oz leftover)`;
    return `• ${i.name}: ${i.qtyRaw%1===0?i.qtyRaw:i.qtyRaw.toFixed(1)} ${i.unit}  ($${i.purchaseCost.toFixed(2)} CAD)`;
  });
  navigator.clipboard.writeText(
    `Shopping list — ${lbl} — ${guests} guests
${'─'.repeat(44)}
`+lines.join('\n')+
    `
${'─'.repeat(44)}
Total purchase: $${tcPurchase.toFixed(2)} CAD · Resalable leftover: ~$${leftover.toFixed(2)} CAD`
  ).then(()=>alert('Copied!'));
}
function cpQ(){
  // Build a plain-text quote summary
  const cn2 = v('cn') || 'Client';
  const ed2 = v('ed') ? new Date(v('ed')+'T12:00:00').toLocaleDateString('fr-CA',{month:'long',day:'numeric',year:'numeric'}) : '';
  const guests2 = vi('gc') || 0;
  const hrs2 = vf('eventHrs') || 0;
  const notes2 = v('qn') || '';
  const cocktailNames = cocktails.map(c2=>c2.name).join(', ') || 'TBD';

  // Get totals from rQ output
  const totalEl = document.getElementById('ppTotal');
  const total2 = totalEl ? totalEl.textContent : '—';

  const txt = [
    'Bonjour ' + cn2 + ',',
    '',
    "Merci de votre intérêt pour mes services de bar / Thank you for your interest in my bar services.",
    '',
    '📅 ' + (ed2 || 'Date TBD') + ' · ' + guests2 + ' guests · ' + hrs2 + 'h',
    '🍹 Menu: ' + cocktailNames,
    '💰 Total: ' + total2,
    '',
    notes2,
    '',
    'Au plaisir, / Looking forward to it,',
    'Antoine Duong — Mixologiste'
  ].filter(l => l !== undefined && l !== null).join('\n');

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(() => showToast('Quote copied to clipboard!', 'success'));
  } else {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Quote copied!', 'success');
  }
}

// ═══════════════════════════════════════════════════════════
function updateS1MarginInfo(){
  const mp = parseFloat(el('s1margin') ? el('s1margin').value : vi('mp')) || 35;
  const info = el('s1marginInfo');
  if(!info) return;
  const pourCost = 100 - mp;
  const markup = mp > 0 ? Math.round((mp / (100 - mp)) * 100) : 0;
  let rating = '';
  if(mp >= 65) rating = '✅ Excellent — top-tier profitability';
  else if(mp >= 55) rating = '👍 Good — solid margin';
  else if(mp >= 40) rating = '⚠️ Average — consider raising prices';
  else rating = '❌ Low — margin at risk';
  info.innerHTML = 'Pour cost: <strong>' + pourCost + '%</strong> · Markup: <strong>×' + markup + '%</strong><br>'
    + '<span style="color:' + (mp>=55?'var(--green)':mp>=40?'var(--amber)':'var(--red)') + ';">' + rating + '</span>';
}
}
