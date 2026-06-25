// ═══ DASHBOARD ═══

function renderDashboard(){
  const yearEl = el('dashYear');
  const contentEl = el('dashContent');
  if(!contentEl) return;

  const years = [...new Set(
    eventLibrary.filter(e => e.eventDate)
      .map(e => new Date(e.eventDate+'T12:00:00').getFullYear())
  )].sort((a,b)=>b-a);
  if(!years.length) years.push(new Date().getFullYear());
  if(yearEl){
    const cur = parseInt(v('dashYear')) || years[0];
    yearEl.innerHTML = years.map(y=>`<option value="${y}"${y===cur?' selected':''}>${y}</option>`).join('');
  }

  const selectedYear = parseInt(v('dashYear')) || years[0];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const STATUS_COLORS = {confirmed:'#1a7a4a',completed:'#059669',sent:'#2156b8',draft:'#aaa',cancelled:'#dc2626',rejected:'#dc2626'};

  // ── Compute all metrics ──
  // Also include current unsaved event if it has a date and confirmed status
  const currentEventEntry = {
    id: 'current', label: v('eventLabel')||'Current event',
    eventDate: v('ed'), status: v('quoteStatus')||'draft',
    totalQuoted: 0, guestCount: vi('gc')||0, cocktailCount: cocktails.length,
    fullState: null
  };
  try {
    const q = rQ_silent ? rQ_silent() : null;
    if(q) currentEventEntry.totalQuoted = q;
  } catch(e){}

  const yearEvents = eventLibrary.filter(e => {
    if(!e.eventDate) return false;
    return new Date(e.eventDate+'T12:00:00').getFullYear() === selectedYear;
  });

  // Add current event if it's this year and not already saved
  if(currentEventEntry.eventDate){
    const yr = new Date(currentEventEntry.eventDate+'T12:00:00').getFullYear();
    const alreadySaved = yearEvents.some(e => e.label === currentEventEntry.label && e.eventDate === currentEventEntry.eventDate);
    if(yr === selectedYear && !alreadySaved) yearEvents.push(currentEventEntry);
  }

  const confirmed   = yearEvents.filter(e => ['confirmed','completed'].includes(e.status||'draft'));
  const totalRev    = confirmed.reduce((s,e) => s+(e.totalQuoted||0), 0);
  const totalGuests = confirmed.reduce((s,e) => s+(e.guestCount||0), 0);
  const totalEvents = confirmed.length;
  const avgRev      = totalEvents ? totalRev/totalEvents : 0;
  const avgGuests   = totalEvents ? totalGuests/totalEvents : 0;
  const receiptTotal = receipts.filter(r => {
    if(!r.date) return false;
    return new Date(r.date+'T12:00:00').getFullYear() === selectedYear;
  }).reduce((s,r) => s+(r.total||0), 0);
  const profit      = totalRev - receiptTotal;
  const profitPct   = totalRev > 0 ? Math.round(profit/totalRev*100) : 0;

  // ── Monthly revenue data ──
  const byMonth = Array(12).fill(0).map((_,i) => ({month:i, revenue:0, events:0, guests:0}));
  confirmed.forEach(e => {
    const m = new Date(e.eventDate+'T12:00:00').getMonth();
    byMonth[m].revenue += e.totalQuoted||0;
    byMonth[m].events  += 1;
    byMonth[m].guests  += e.guestCount||0;
  });
  const maxMonthRev = Math.max(...byMonth.map(m=>m.revenue), 1);

  // ── SVG bar chart — monthly revenue ──
  const W=560, H=140, PAD=8, BAR_W=32, BAR_GAP=12;
  const chartW = 12*(BAR_W+BAR_GAP);
  function barChart(){
    const bars = byMonth.map((m,i) => {
      const barH = m.revenue > 0 ? Math.max(4, Math.round((m.revenue/maxMonthRev)*(H-30))) : 0;
      const x = i*(BAR_W+BAR_GAP);
      const y = H-30-barH;
      const hasEvent = m.events > 0;
      return `<g>
        <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}"
          rx="4" fill="${hasEvent?'#1a7a4a':'#e5e5e0'}" opacity="${hasEvent?'1':'0.4'}"/>
        ${m.revenue>0?`<text x="${x+BAR_W/2}" y="${y-4}" text-anchor="middle" font-size="9" fill="#1a7a4a" font-weight="600">$${m.revenue>=1000?(m.revenue/1000).toFixed(1)+'k':m.revenue.toFixed(0)}</text>`:''}
        <text x="${x+BAR_W/2}" y="${H-14}" text-anchor="middle" font-size="9" fill="#aaa">${MONTHS[i]}</text>
        ${m.events>0?`<text x="${x+BAR_W/2}" y="${H-4}" text-anchor="middle" font-size="8" fill="#888">${m.events}ev</text>`:''}
      </g>`;
    }).join('');
    return `<svg viewBox="0 0 ${chartW} ${H}" style="width:100%;height:${H}px;overflow:visible;">
      <line x1="0" y1="${H-30}" x2="${chartW}" y2="${H-30}" stroke="#f0f0eb" stroke-width="1"/>
      ${bars}
    </svg>`;
  }

  // ── Revenue by status donut ──
  const statusBreakdown = {};
  yearEvents.forEach(e => {
    const st = e.status||'draft';
    if(!statusBreakdown[st]) statusBreakdown[st]={count:0,revenue:0};
    statusBreakdown[st].count++;
    statusBreakdown[st].revenue+=(e.totalQuoted||0);
  });

  // ── Upcoming events ──
  const today = new Date().toISOString().split('T')[0];
  const upcoming = eventLibrary.filter(e =>
    e.eventDate && e.eventDate >= today &&
    ['confirmed','sent','draft'].includes(e.status||'draft')
  ).sort((a,b)=>a.eventDate.localeCompare(b.eventDate)).slice(0,5);

  // ── Top events by revenue ──
  const topEvents = [...confirmed]
    .sort((a,b)=>(b.totalQuoted||0)-(a.totalQuoted||0))
    .slice(0,5);

  // ── Category breakdown ──
  const catBreakdown = {};
  confirmed.forEach(e => {
    if(!e.fullState) return;
    (e.fullState.cocktails||[]).forEach(c2 => {
      const cat = c2.cat||'Other';
      if(!catBreakdown[cat]) catBreakdown[cat]={count:0};
      catBreakdown[cat].count++;
    });
  });

  // ── Busiest days ──
  const dayCount = {};
  confirmed.forEach(e => {
    if(!e.eventDate) return;
    const d = new Date(e.eventDate+'T12:00:00').toLocaleDateString('en-CA',{weekday:'long'});
    dayCount[d] = (dayCount[d]||0)+1;
  });
  const maxDayCount = Math.max(...Object.values(dayCount),1);

  // ── BUILD HTML ──
  const isEmpty = !totalEvents;
  contentEl.innerHTML = isEmpty
    ? `<div style="padding:3rem;text-align:center;color:#aaa;">
        <div style="font-size:48px;margin-bottom:12px;">📊</div>
        <div style="font-weight:500;margin-bottom:6px;">No confirmed events in ${selectedYear}</div>
        <div style="font-size:13px;">Save and confirm events to see your dashboard.</div>
       </div>`
    : `
  <!-- KPI STRIP -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px;">
    ${[
      {val:'$'+totalRev.toFixed(0), label:'Revenue CAD', sub:'confirmed events', color:'#1a7a4a'},
      {val:totalEvents, label:'Events', sub:avgGuests.toFixed(0)+' avg guests', color:'#2156b8'},
      {val:'$'+avgRev.toFixed(0), label:'Avg per event', sub:'quoted revenue', color:'#7c3aed'},
      {val:profitPct>0?profitPct+'%':'—', label:'Est. margin', sub:receiptTotal>0?'$'+profit.toFixed(0)+' profit':'Scan receipts', color:profitPct>=50?'#1a7a4a':profitPct>0?'#d97706':'#aaa'},
    ].map(k=>`
      <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px 14px 10px;border-left:3px solid ${k.color};">
        <div style="font-size:22px;font-weight:700;color:${k.color};">${k.val}</div>
        <div style="font-size:12px;font-weight:600;color:#1a1a1a;margin-top:2px;">${k.label}</div>
        <div style="font-size:11px;color:#aaa;margin-top:1px;">${k.sub}</div>
      </div>`).join('')}
  </div>

  <!-- MONTHLY REVENUE CHART -->
  <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:16px;margin-bottom:12px;">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:14px;font-weight:600;">Monthly revenue ${selectedYear}</div>
      <div style="font-size:12px;color:#1a7a4a;font-weight:500;">$${totalRev.toFixed(0)} total</div>
    </div>
    ${barChart()}
  </div>

  <!-- ROW 2: Upcoming + Top events -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">

    <!-- Upcoming events -->
    <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">📅 Upcoming</div>
      ${upcoming.length ? upcoming.map(e => {
        const dateStr = new Date(e.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'});
        const daysAway = Math.round((new Date(e.eventDate+'T12:00:00')-new Date())/86400000);
        const stColor = STATUS_COLORS[e.status||'draft']||'#aaa';
        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:.5px solid #f5f5f0;">
          <div style="width:36px;text-align:center;flex-shrink:0;">
            <div style="font-size:14px;font-weight:700;color:#1a1a1a;">${dateStr.split(' ')[1]}</div>
            <div style="font-size:9px;color:#aaa;">${dateStr.split(' ')[0]}</div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${e.label||'Event'}</div>
            <div style="font-size:10px;color:#888;">${e.guestCount||'?'} guests · $${(e.totalQuoted||0).toFixed(0)}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:10px;color:${daysAway<=7?'#dc2626':'#888'};">${daysAway===0?'Today':daysAway===1?'Tomorrow':daysAway+'d'}</div>
            <div style="font-size:10px;color:${stColor};font-weight:500;">${e.status||'draft'}</div>
          </div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:#aaa;">No upcoming events</div>'}
    </div>

    <!-- Top events by revenue -->
    <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">🏆 Top events</div>
      ${topEvents.length ? topEvents.map((e,idx2) => {
        const pct = maxMonthRev > 0 ? (e.totalQuoted||0)/Math.max(...confirmed.map(x=>x.totalQuoted||0))*100 : 0;
        return `<div style="margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
            <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px;">${['🥇','🥈','🥉','4.','5.'][idx2]} ${e.label||'Event'}</span>
            <span style="font-weight:600;color:#1a7a4a;flex-shrink:0;">$${(e.totalQuoted||0).toFixed(0)}</span>
          </div>
          <div style="height:4px;background:#f0f0eb;border-radius:2px;">
            <div style="height:4px;background:#1a7a4a;border-radius:2px;width:${pct}%;"></div>
          </div>
        </div>`;
      }).join('') : '<div style="font-size:12px;color:#aaa;">No confirmed events yet</div>'}
    </div>
  </div>

  <!-- ROW 3: Busy days + Cocktail categories + Profit -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">

    <!-- Busiest days -->
    <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">📆 Busiest days</div>
      ${Object.keys(dayCount).length ? Object.entries(dayCount).sort((a,b)=>b[1]-a[1]).map(([day,cnt]) => `
        <div style="margin-bottom:6px;">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
            <span>${day.slice(0,3)}</span><span style="font-weight:600;">${cnt} event${cnt!==1?'s':''}</span>
          </div>
          <div style="height:5px;background:#f0f0eb;border-radius:3px;">
            <div style="height:5px;background:#7c3aed;border-radius:3px;width:${Math.round(cnt/maxDayCount*100)}%;"></div>
          </div>
        </div>`).join('')
      : '<div style="font-size:12px;color:#aaa;">No data yet</div>'}
    </div>

    <!-- Cocktail categories -->
    <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">🍹 Cocktail mix</div>
      ${Object.keys(catBreakdown).length ? Object.entries(catBreakdown).sort((a,b)=>b[1].count-a[1].count).slice(0,6).map(([cat,data]) => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:.5px solid #f5f5f0;font-size:12px;">
          <span>${cat}</span>
          <span style="font-weight:600;color:#2156b8;">${data.count}</span>
        </div>`).join('')
      : '<div style="font-size:12px;color:#aaa;">No cocktail data</div>'}
    </div>

    <!-- Profit insight -->
    <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
      <div style="font-size:13px;font-weight:600;margin-bottom:10px;">💰 Profit insight</div>
      ${receiptTotal > 0 ? `
        <div style="margin-bottom:10px;">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="color:#888;">Quoted</span><span style="font-weight:600;">$${totalRev.toFixed(0)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px;">
            <span style="color:#888;">Spent</span><span style="font-weight:600;color:#dc2626;">$${receiptTotal.toFixed(0)}</span>
          </div>
          <div style="border-top:1px solid #f0f0eb;padding-top:4px;display:flex;justify-content:space-between;font-size:13px;">
            <span style="font-weight:600;">Profit</span><span style="font-weight:700;color:#1a7a4a;">$${profit.toFixed(0)} (${profitPct}%)</span>
          </div>
        </div>
        <div style="height:8px;background:#f0f0eb;border-radius:4px;overflow:hidden;">
          <div style="height:8px;background:linear-gradient(90deg,#dc2626 ${Math.round(receiptTotal/totalRev*100)}%,#1a7a4a ${Math.round(receiptTotal/totalRev*100)}%);border-radius:4px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:10px;color:#aaa;margin-top:3px;">
          <span>Cost ${Math.round(receiptTotal/totalRev*100)}%</span><span>Profit ${profitPct}%</span>
        </div>`
      : '<div style="font-size:12px;color:#aaa;line-height:1.5;">Scan receipts to see your actual profit breakdown.</div>'}
    </div>
  </div>

  <!-- STATUS BREAKDOWN -->
  <div style="background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:14px;">
    <div style="font-size:13px;font-weight:600;margin-bottom:10px;">Pipeline — all ${yearEvents.length} events in ${selectedYear}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${Object.entries(statusBreakdown).map(([st,data]) => `
        <div style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;background:#f9f9f6;border:1px solid #e5e5e0;">
          <span style="width:8px;height:8px;border-radius:50%;background:${STATUS_COLORS[st]||'#aaa'};display:inline-block;"></span>
          <span style="font-size:12px;font-weight:500;">${st}</span>
          <span style="font-size:12px;color:#888;">${data.count}× · $${data.revenue.toFixed(0)}</span>
        </div>`).join('')}
    </div>
  </div>`;
}

