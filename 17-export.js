// ═══ DATA EXPORT ═══
// JSON, CSV, Sheets export, shopping HTML export

function exportShoppingHTML(){
  const guests = vi('gc');
  if(!cocktails.length){ alert('Build a cocktail menu first.'); return; }
  const {effectiveGuests} = getConsumptionGuests();
  const items = getIM(effectiveGuests);
  const eventLabel = v('eventLabel') || 'Event';
  const today = new Date().toLocaleDateString('en-CA', {weekday:'long', month:'long', day:'numeric'});
  const totalCost = items.reduce((s,i) => s+i.purchaseCost, 0);

  // Group by category
  const cats = {};
  items.forEach(i => {
    const cat = i.cat || 'Other';
    if(!cats[cat]) cats[cat] = [];
    cats[cat].push(i);
  });

  const rows = Object.entries(cats).map(([cat, itms]) => {
    const itemRows = itms.map(i => {
      const bottleLabel = i.bottleInfo ? i.bottles + ' bottle' + (i.bottles!==1?'s':'') + ' (' + i.bottleInfo.bottleLabel + ')' : i.qtyRaw.toFixed(1) + ' ' + i.unit;
      const storeHint = i.cpu > 1.5 ? 'SAQ' : 'Grocery';
      return `<li class="item" onclick="this.classList.toggle('checked')">
        <span class="cb">${i.name}</span>
        <span class="amt">${bottleLabel}</span>
        <span class="store">${storeHint}</span>
        <span class="price">$${i.purchaseCost.toFixed(2)}</span>
      </li>`;
    }).join('');
    return `<div class="cat-group"><div class="cat-label">${cat}</div><ul>${itemRows}</ul></div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${eventLabel} — Shopping list</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0;}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9f9f6;color:#1a1a1a;padding-bottom:80px;}
  header{background:#1a1a1a;color:#fff;padding:1rem 1.25rem;position:sticky;top:0;z-index:10;}
  header h1{font-size:17px;font-weight:600;margin-bottom:2px;}
  header p{font-size:12px;color:#aaa;}
  .progress-bar{height:4px;background:rgba(255,255,255,0.2);margin-top:8px;border-radius:2px;overflow:hidden;}
  .progress-fill{height:100%;background:#4ade80;border-radius:2px;transition:width .3s;}
  .cat-group{margin:1rem 0.75rem 0;}
  .cat-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;padding:0 .5rem .5rem;}
  ul{list-style:none;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e0;}
  li.item{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:13px 14px;border-bottom:.5px solid #f0f0eb;cursor:pointer;transition:background .15s;-webkit-tap-highlight-color:transparent;}
  li.item:last-child{border-bottom:none;}
  li.item:active{background:#f5f5f0;}
  li.item.checked{background:#f0faf5;}
  li.item.checked .cb{text-decoration:line-through;color:#aaa;}
  li.item.checked::after{content:'✓';position:absolute;right:14px;color:#1a7a4a;font-weight:700;}
  li.item{position:relative;}
  .cb{font-size:15px;font-weight:500;}
  .amt{font-size:13px;color:#666;background:#f5f5f0;padding:2px 8px;border-radius:20px;white-space:nowrap;}
  .store{font-size:11px;color:#aaa;white-space:nowrap;}
  .price{font-size:13px;font-weight:500;color:#1a7a4a;min-width:48px;text-align:right;}
  .footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e5e0;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;}
  .footer-total{font-size:16px;font-weight:600;}
  .footer-checked{font-size:13px;color:#888;}
  .footer-btn{background:#1a1a1a;color:#fff;border:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;}
</style>
</head>
<body>
<header>
  <h1>${eventLabel}</h1>
  <p>${today} · ${guests} guests · ${items.length} items · SAQ + grocery</p>
  <div class="progress-bar"><div class="progress-fill" id="prog" style="width:0%"></div></div>
</header>

${rows}

<div class="footer">
  <div>
    <div class="footer-total">$${totalCost.toFixed(2)} CAD</div>
    <div class="footer-checked" id="checkedCount">0 of ${items.length} checked</div>
  </div>
  <button class="footer-btn" onclick="clearAll()">Clear all</button>
</div>

<script>
const total = ${items.length};
function updateProgress(){
  const checked = document.querySelectorAll('li.checked').length;
  document.getElementById('prog').style.width = (checked/total*100) + '%';
  document.getElementById('checkedCount').textContent = checked + ' of ' + total + ' checked';
}
document.querySelectorAll('li.item').forEach(li => li.addEventListener('click', updateProgress));
function clearAll(){ document.querySelectorAll('li.checked').forEach(li => li.classList.remove('checked')); updateProgress(); }
<\/scr\'+'ipt>
</body></html>`;

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], {type:'text/html'}));
  const lbl = eventLabel.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  a.download = lbl + '_shopping_list.html';
  a.click();
  showToast('Shopping list exported — open the file on your phone browser', 'success');
}
// ═══════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════
function escCSV(val){const s=String(val==null?'':val);return s.includes(',')||s.includes('"')||s.includes('')?'"'+s.replace(/"/g,'""')+'"':s;}

function exportJSON(){
  const guests=vi('gc'),items=getIM(guests),raw=items.reduce((s,i)=>s+i.qty*i.cpu,0);
  const mp2=vf('mp'),mkup=mp2<100?(mp2/(100-mp2))*100:mp2,mked=raw*(1+mkup/100),labor=vf('eventHrs')*vf('hr'),total=mked+labor+vf('tf')+getStaffLaborTotal();
  const payload={meta:{schema_version:"2.0",exported_at:new Date().toISOString(),currency:"CAD"},
    event:{name:v('eventLabel'),client:v('cn'),date:v('ed'),guest_count:vi('gc'),hours_of_service:vf('eventHrs')},
    cocktail_menu:cocktails.map(c=>({id:c.id,name:c.name,category:c.cat,drinks_per_guest:c.dpg,cost_per_drink_cad:parseFloat(c.ing.reduce((s,i)=>s+i.c*i.q,0).toFixed(4)),ingredients:c.ing.map(g=>({name:g.n,qty_per_drink:g.q,unit:g.u,cost_per_unit_cad:g.c}))})),
    shopping_list:{guest_count:guests,items:items.map(i=>({name:i.name,unit:i.unit,total_qty:parseFloat(i.qty.toFixed(2)),cost_per_unit_cad:i.cpu,total_cost_cad:parseFloat((i.qty*i.cpu).toFixed(2))})),total_ingredient_cost_cad:parseFloat(raw.toFixed(2))},
    quote:{total_quote_cad:parseFloat(total.toFixed(2)),ingredient_cost_cad:parseFloat(raw.toFixed(2)),markup_pct:mkup,labor_cad:parseFloat(labor.toFixed(2)),profit_cad:parseFloat((mked-raw).toFixed(2)),notes:v('qn')}};
  dl(JSON.stringify(payload,null,2),'application/json',(v('eventLabel')||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase()+'_export.json');
}

function exportCSV(){
  const guests=vi('gc'),items=getIM(guests),lbl=v('eventLabel')||'Event',rows=[];
  rows.push(['BARTENDER EVENT PLANNER EXPORT']);rows.push(['Event',lbl,'Client',v('cn'),'Date',v('ed'),'Guests',guests]);rows.push([]);
  rows.push(['COCKTAIL MENU']);rows.push(['Cocktail','Category','Drinks/Guest','Ingredient','Qty/Drink','Unit','CAD$/Unit','Cost/Drink']);
  cocktails.forEach(c=>{c.ing.forEach((g,idx)=>{rows.push([idx===0?c.name:'',idx===0?c.cat:'',idx===0?c.dpg:'',g.n,g.q,g.u,g.c,(g.q*g.c).toFixed(4)]);});rows.push(['','','','TOTAL','','','',c.ing.reduce((s,i)=>s+i.c*i.q,0).toFixed(2)]);rows.push([]);});
  rows.push(['SHOPPING LIST ('+guests+' guests)']);rows.push(['Ingredient','Qty','Unit','$/Unit CAD','Total CAD']);
  items.forEach(i=>rows.push([i.name,i.qty.toFixed(2),i.unit,i.cpu.toFixed(2),(i.qty*i.cpu).toFixed(2)]));
  const rt=items.reduce((s,i)=>s+i.qty*i.cpu,0);rows.push(['TOTAL','','','',rt.toFixed(2)]);rows.push([]);
  const mk=vf('mp'),lb=vf('eventHrs')*vf('hr'),mked=rt*(1+mk/100),tot=mked+vf('tf')+lb+getStaffLaborTotal();
  rows.push(['QUOTE']);rows.push(['Ingredients',rt.toFixed(2)]);rows.push(['Markup ('+mk+'%)',(mked-rt).toFixed(2)]);rows.push(['Your labor',lb.toFixed(2)]);staffList.forEach(s=>rows.push([s.name?s.name+' ('+s.role+')':s.role,+(s.rate*s.hours).toFixed(2)]));if(staffList.length)rows.push(['Total additional staff',getStaffLaborTotal().toFixed(2)]);rows.push(['TOTAL',tot.toFixed(2)]);
  dl(rows.map(r=>r.map(escCSV).join(',')).join('\n'),'text/csv',(v('eventLabel')||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase()+'_export.csv');
}

function exportSheets(){
  const guests=vi('gc'),items=getIM(guests),lbl=v('eventLabel')||'Event';
  const mp3=vf('mp'),mk=mp3<100?(mp3/(100-mp3))*100:mp3,hrs=vf('eventHrs'),rate=vf('hr'),tf=vf('tf'),rows=[];
  rows.push(['BARTENDER EVENT PLANNER']);rows.push(['Event',lbl,'Client',v('cn'),'Date',v('ed')]);rows.push([]);
  rows.push(['SETTINGS']);rows.push(['Guest count',guests]);rows.push(['Hours',hrs]);rows.push(['Rate (CAD)',rate]);rows.push(['Markup %',mk]);rows.push(['Travel/setup',tf]);rows.push([]);
  rows.push(['COCKTAIL MENU']);rows.push(['Cocktail','Category','Drinks/Guest','Ingredient','Qty','Unit','CAD$/Unit','Line Cost']);
  cocktails.forEach(c=>{c.ing.forEach((g,idx)=>{rows.push([idx===0?c.name:'',idx===0?c.cat:'',idx===0?c.dpg:'',g.n,g.q,g.u,g.c,(g.q*g.c).toFixed(4)]);});rows.push(['','','','Cost/drink','','','',c.ing.reduce((s,i)=>s+i.c*i.q,0).toFixed(4)]);rows.push([]);});
  rows.push(['SHOPPING LIST']);rows.push(['Ingredient','Unit','Total Qty','CAD$/Unit','Total Cost']);
  items.forEach(i=>rows.push([i.name,i.unit,i.qty.toFixed(4),i.cpu,(i.qty*i.cpu).toFixed(4)]));
  const rt=items.reduce((s,i)=>s+i.qty*i.cpu,0);rows.push(['','','TOTAL','',rt.toFixed(2)]);rows.push([]);
  const mked=rt*(1+mk/100),labor=hrs*rate,total=mked+labor+tf+getStaffLaborTotal();
  rows.push(['QUOTE']);rows.push(['Item','Formula','CAD Value']);
  rows.push(['Ingredients','=SUM(shopping)',rt.toFixed(2)]);rows.push(['Markup','=ingredients*markup%',(mked-rt).toFixed(2)]);rows.push(['Your labor','=hours*rate',labor.toFixed(2)]);staffList.forEach(s=>rows.push([s.name?s.name+' ('+s.role+')':''+s.role,'=rate*hours',(s.rate*s.hours).toFixed(2)]));if(staffList.length)rows.push(['Total additional staff','=SUM(staff)',getStaffLaborTotal().toFixed(2)]);rows.push(['Travel/setup','(editable)',tf.toFixed(2)]);// Resale/inventory not in quote total — see Inventory tab for profit breakdownrows.push(['TOTAL','=all above',total.toFixed(2)]);rows.push(['Profit','=markup amount',(mked-rt).toFixed(2)]);rows.push(['Per guest','=total/guests',(total/Math.max(vi('gc'),1)).toFixed(2)]);
  dl(rows.map(r=>r.map(c=>String(c==null?'':c).replace(/\t/g,' ')).join('\t')).join('\n'),'text/tab-separated-values',(v('eventLabel')||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase()+'_sheets.tsv');
  setTimeout(()=>alert('✅ Sheets file downloaded!\n\n1. Open Google Sheets (sheets.new)\n2. File → Import → Upload .tsv\n3. Choose Tab as separator'),300);
}

// ═══════════════════════════════════════════════════════════
// HIS & HERS PAIRING BUILDER
// ═══════════════════════════════════════════════════════════
