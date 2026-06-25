// ═══ INITIALIZATION ═══
// Emily sample data, error handlers, startup sequence

// ── AUTO-LOAD EMILY DATA (runs once, silently) ────────────────
(function(){
  if(localStorage.getItem('bartender_emily_loaded_v3')) return;
  try {
    let evLib=[]; try{evLib=JSON.parse(localStorage.getItem('bartender_events_v1')||'[]');}catch(e){}
    const emilyEntry={"id": "ev_emily_birthday_1780858224", "label": "Emily's Birthday Party", "eventDate": "2026-04-22", "guestCount": 35, "cocktailCount": 4, "status": "completed", "totalQuoted": 1438.75, "savedAt": "2026-06-07T12:00:00.000Z", "state": {"version": 2, "eventLabel": "Emily's Birthday Party", "quoteStatus": "confirmed", "cocktails": [{"id": "emily_1", "name": "Pretty Pearfect", "category": "Signature", "cat": "Signature", "dpg": 1, "hisHers": false, "notes": "Glass: Plastic Cup | Method: Shake/Dump | Garnish: Thai Basil Leaves and Dehydrated Rosebuds", "ing": [{"n": "Homemade Yuzu Ginger Cordial", "q": 1.0, "u": "oz", "c": 0}, {"n": "Melon Yogo Vera", "q": 2.0, "u": "oz", "c": 0}, {"n": "Grey Goose La Poire", "q": 1.5, "u": "oz", "c": 2.1589}, {"n": "Sparkling Water", "q": 1.5, "u": "oz", "c": 0}]}, {"id": "emily_2", "name": "Peach Please", "category": "Signature", "cat": "Signature", "dpg": 1, "hisHers": false, "notes": "Glass: Plastic Cup | Method: Shake/Strain Over Ice | Garnish: Lemon Wheel and Maynards Peach Skewer", "ing": [{"n": "Ms. Better Bitters Vegan Miraculous Foamer", "q": 1, "u": "dash", "c": 0}, {"n": "Lemon Juice", "q": 1.0, "u": "oz", "c": 0}, {"n": "Orange Juice", "q": 0.75, "u": "oz", "c": 0}, {"n": "Peach Syrup", "q": 0.75, "u": "oz", "c": 0}, {"n": "Amaretto Disaronno", "q": 1.5, "u": "oz", "c": 1.4097}]}, {"id": "emily_3", "name": "Bubbly Personality", "category": "Signature", "cat": "Signature", "dpg": 1, "hisHers": false, "notes": "Glass: Plastic Cup | Method: Shake/Strain | Garnish: Lemon Wheel and Popping Pearls", "ing": [{"n": "Lemon Juice", "q": 1.0, "u": "oz", "c": 0}, {"n": "Simple Syrup", "q": 0.75, "u": "oz", "c": 0}, {"n": "London Dry Gin", "q": 1.25, "u": "oz", "c": 1.2815}, {"n": "Prosecco", "q": 3.0, "u": "oz", "c": 0.5698}]}, {"id": "emily_4", "name": "Hibiscus Margarita Shots", "category": "Shot", "cat": "Shot", "dpg": 1, "batchServings": 100, "hisHers": false, "notes": "Glass: Plastic Shooters | Method: Pre-Batched | Garnish: Lime Wedge | Pre-batched for 100 shots from 1 bottle tequila", "ing": [{"n": "Blanco Tequila", "q": 25.36, "u": "oz", "c": 1.8237}, {"n": "Cointreau", "q": 12.68, "u": "oz", "c": 1.9361}, {"n": "Lime Juice", "q": 16.9, "u": "oz", "c": 0}, {"n": "Hibiscus Agave Syrup", "q": 10.14, "u": "oz", "c": 0}, {"n": "Mineral Water", "q": 10.14, "u": "oz", "c": 0}]}], "quote": {"clientName": "Emily Stimpson", "eventDate": "", "guestCount": 35, "hoursOfService": 7, "hourlyRate": 60, "travelFee": 60, "drinksPerPerson": 5, "bufferPct": 10, "taxEnabled": false, "marginPct": 70, "mpMode": "margin", "discountAmt": 0, "discountPct": 0, "depositAmt": 0, "notes": "SCHEDULE:\n5:30 PM \u2014 Time of arrival\n7:00 PM \u2014 Beginning of service (90 min mise en place from 5:30)\n11:30 PM \u2014 Approximate departure\n\nSTAFFING:\nMixologist: 60$/h (arrival to cleanup)\nHelper: 35$/h\n\nQUANTITIES:\n35 \u00d7 Pretty Pearfect @ $5.50/each\n35 \u00d7 Peach Please @ $4.50/each\n35 \u00d7 Bubbly Personality @ $5.25/each\n100 pre-batched Hibiscus Margarita shots @ $1.00/each\nIce, straws, napkins: $80\n\nTRANSPORT: 1 extra hour charged"}, "staffList": [{"name": "Rosay", "role": "Bar helper", "rate": 35, "hours": 7}], "myIngredients": [], "postEvent": {"data": {}, "notes": ""}}, "invoiceSnapshot": {"total": 1438.75, "savedAt": "2026-04-22T00:00:00.000Z", "invoiceNum": "00000001", "eventLabel": "Emily's Birthday Party", "html": null}, "invoiceFinalAt": "2026-04-22T00:00:00.000Z", "invoiceTotal": 1438.75};
    const existIdx=evLib.findIndex(e=>e.label==="Emily's Birthday Party");
    if(existIdx<0){evLib.unshift(emilyEntry);}// never overwrite user changes
    localStorage.setItem('bartender_events_v1',JSON.stringify(evLib));
    let recLib=[]; try{recLib=JSON.parse(localStorage.getItem('bartender_recipes_v1')||'[]');}catch(e){}
    const er=[{"id": "emily_recipe_emily_1", "name": "Pretty Pearfect", "category": "Signature", "dpg": 1, "ing": [{"n": "Homemade Yuzu Ginger Cordial", "q": 1.0, "u": "oz", "c": 0}, {"n": "Melon Yogo Vera", "q": 2.0, "u": "oz", "c": 0}, {"n": "Grey Goose La Poire", "q": 1.5, "u": "oz", "c": 2.1589}, {"n": "Sparkling Water", "q": 1.5, "u": "oz", "c": 0}], "costPerDrink": 3.2384, "notes": "Glass: Plastic Cup | Method: Shake/Dump | Garnish: Thai Basil Leaves and Dehydrated Rosebuds", "eventLabel": "Emily's Birthday Party", "savedAt": "2026-06-07T12:00:00.000Z", "autoSaved": false, "flavorTags": [], "parentId": null}, {"id": "emily_recipe_emily_2", "name": "Peach Please", "category": "Signature", "dpg": 1, "ing": [{"n": "Ms. Better Bitters Vegan Miraculous Foamer", "q": 1, "u": "dash", "c": 0}, {"n": "Lemon Juice", "q": 1.0, "u": "oz", "c": 0}, {"n": "Orange Juice", "q": 0.75, "u": "oz", "c": 0}, {"n": "Peach Syrup", "q": 0.75, "u": "oz", "c": 0}, {"n": "Amaretto Disaronno", "q": 1.5, "u": "oz", "c": 1.4097}], "costPerDrink": 2.1145, "notes": "Glass: Plastic Cup | Method: Shake/Strain Over Ice | Garnish: Lemon Wheel and Maynards Peach Skewer", "eventLabel": "Emily's Birthday Party", "savedAt": "2026-06-07T12:00:00.000Z", "autoSaved": false, "flavorTags": [], "parentId": null}, {"id": "emily_recipe_emily_3", "name": "Bubbly Personality", "category": "Signature", "dpg": 1, "ing": [{"n": "Lemon Juice", "q": 1.0, "u": "oz", "c": 0}, {"n": "Simple Syrup", "q": 0.75, "u": "oz", "c": 0}, {"n": "London Dry Gin", "q": 1.25, "u": "oz", "c": 1.2815}, {"n": "Prosecco", "q": 3.0, "u": "oz", "c": 0.5698}], "costPerDrink": 3.3113, "notes": "Glass: Plastic Cup | Method: Shake/Strain | Garnish: Lemon Wheel and Popping Pearls", "eventLabel": "Emily's Birthday Party", "savedAt": "2026-06-07T12:00:00.000Z", "autoSaved": false, "flavorTags": [], "parentId": null}, {"id": "emily_recipe_emily_4", "name": "Hibiscus Margarita Shots", "category": "Shot", "dpg": 1, "ing": [{"n": "Blanco Tequila", "q": 25.36, "u": "oz", "c": 1.8237}, {"n": "Cointreau", "q": 12.68, "u": "oz", "c": 1.9361}, {"n": "Lime Juice", "q": 16.9, "u": "oz", "c": 0}, {"n": "Hibiscus Agave Syrup", "q": 10.14, "u": "oz", "c": 0}, {"n": "Mineral Water", "q": 10.14, "u": "oz", "c": 0}], "costPerDrink": 70.7988, "notes": "Glass: Plastic Shooters | Method: Pre-Batched | Garnish: Lime Wedge | Pre-batched for 100 shots from 1 bottle tequila", "eventLabel": "Emily's Birthday Party", "savedAt": "2026-06-07T12:00:00.000Z", "autoSaved": false, "flavorTags": [], "parentId": null}];er.forEach(r=>{if(!recLib.some(x=>x.name.toLowerCase()===r.name.toLowerCase()))recLib.push(r);});localStorage.setItem('bartender_recipes_v1',JSON.stringify(recLib));
    let myIngs=[]; try{myIngs=JSON.parse(localStorage.getItem('bartender_mydb_v1')||'[]');}catch(e){}
    const ei=[{"name": "Grey Goose La Poire", "unit": "oz", "c": 2.1589, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 54.75, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Amaretto Disaronno", "unit": "oz", "c": 1.4097, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 35.75, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Tanqueray London Dry Gin", "unit": "oz", "c": 1.2815, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 32.5, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Prosecco Cantina Trevigiana", "unit": "oz", "c": 0.5698, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 14.45, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Tequila 1800 Silver", "unit": "oz", "c": 1.8237, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 46.25, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Cointreau 375ml", "unit": "oz", "c": 1.9361, "note": "Emily's Birthday Party \u00b7 SAQ", "retailer": "SAQ", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": 24.55, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Yuzu Extract", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Ginger Syrup", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Melon Yogo Vera", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Sparkling Water", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Thai Basil Leaves", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Dehydrated Rosebuds", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Miraculous Foamer", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Lemon Juice", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Lime Juice", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Orange Juice", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Peach Syrup", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Popping Pearls", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Maynards Peach Candy", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Fresh Lemons", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Fresh Limes", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Bamboo Skewers", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Hibiscus Syrup", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Simple Syrup", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Plastic Shooters", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}, {"name": "Ice Bag", "unit": "piece", "c": 0, "note": "Emily's Birthday Party \u00b7 Grocery", "retailer": "Grocery", "cat": "\ud83c\udfe0 My custom ingredients", "bottleSize": null, "bottlePrice": null, "addedAt": "2026-06-07T12:00:00.000Z", "flavorTags": []}];ei.forEach(i=>{if(!myIngs.some(x=>x.name.toLowerCase()===i.name.toLowerCase()))myIngs.push(i);});localStorage.setItem('bartender_mydb_v1',JSON.stringify(myIngs));
    let ph={};try{ph=JSON.parse(localStorage.getItem('bartender_price_history')||'{}');}catch(e){}
    const eph={"grey goose la poire": [{"date": "2026-06-07", "price": 2.1589, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}], "amaretto disaronno": [{"date": "2026-06-07", "price": 1.4097, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}], "tanqueray london dry gin": [{"date": "2026-06-07", "price": 1.2815, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}], "prosecco cantina trevigiana": [{"date": "2026-06-07", "price": 0.5698, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}], "tequila 1800 silver": [{"date": "2026-06-07", "price": 1.8237, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}], "cointreau 375ml": [{"date": "2026-06-07", "price": 1.9361, "unit": "oz", "store": "SAQ", "source": "receipt", "isPromo": false, "regularPrice": null}]};Object.entries(eph).forEach(([k,v])=>{if(!ph[k])ph[k]=[];v.forEach(e=>{if(!ph[k].some(x=>x.date===e.date&&x.store===e.store))ph[k].unshift(e);});});localStorage.setItem('bartender_price_history',JSON.stringify(ph));
    localStorage.setItem('bartender_emily_loaded_v3','1');
    console.log("[BartenderTool] Emily's Birthday Party data loaded ✓ ($1,438.75 · Apr 22 2026)");
  }catch(err){console.warn('[BartenderTool] Emily load error:',err);}
// AUTO-LOAD EMILY DATA (runs once, silently)
})()


// ── GLOBAL ERROR HANDLER — catch errors gracefully rather than silent failure ──
window.addEventListener('beforeunload', function(e){
  // Only warn if there are genuinely unsaved changes
  // (lastSavedState is null until init completes, so skip warning during load)
  if(typeof lastSavedState !== 'undefined' && lastSavedState !== null){
    const currentState = typeof getSimpleState === 'function' ? getSimpleState() : null;
    if(currentState && currentState !== lastSavedState){
      e.preventDefault(); e.returnValue = ''; return '';
    }
  }
});
window.onerror = function(msg, src, line, col, err){
  console.error('[BartenderTool]', msg, 'at line', line);
  // Don't show alert for every error — just log it
  // Uncomment below during development:
  // alert('Error: ' + msg + ' (line ' + line + ')');
  return true; // prevent default browser error
};
window.addEventListener('unhandledrejection', function(e){
  console.error('[BartenderTool] Unhandled promise rejection:', e.reason);
});

const qgrid=el('qgrid');
if(qgrid){
  LIB.forEach((l,i)=>{
    const b=document.createElement('button');
    b.className='qb';
    b.textContent=l.name;
    b.onclick=()=>qAdd(i);
    qgrid.appendChild(b);
  });
}
// Run init safely — catch any startup errors
try {
  loadMyDB();
  loadReceipts();
  loadPriceHistory();
  loadRecipeLibrary();
  loadStock();
  loadEventLibrary();
  loadEventCategories();
  renderMyDB();
  renderRecipeLibrary();
  renderMyLibrarySection();
  syncSettings();
  updateStatusBadge();
  renderShoppingDeadline();
  if(!nIng.length) nIng=[{n:'',q:1,u:'oz',c:0}]; // start with one empty row
  // Seed Q from DOM initial values (in case inputs have defaults)
  Object.keys(Q).forEach(function(field){
    const el2 = document.getElementById(field);
    if(el2 && el2.value) sv(field, el2.value); // sv() updates both DOM and Q
  });
  // Hide settings card immediately
  const _esCard = el('eventSettingsCard');
  if(_esCard) _esCard.style.display = 'none';
  // If we already have an event loaded (from localStorage), mark as active
  if(cocktails.length > 0 || currentEventId) menuEventActive = true;
  rNI();
  rC();
  rQ();
  updateMenuStep();
  // Show His & Hers settings row if any cocktail is flagged
  const anyHH = cocktails.some(x => x.hisHers);
  const hhRow = el('hisHersRow');
  if(hhRow) hhRow.style.display = anyHH ? '' : 'none';
  // Set initial lastSavedState after everything loads
  setTimeout(() => { lastSavedState = getSimpleState(); }, 200);
  // Check for autosave restore (with small delay so UI is ready)
  setTimeout(checkAutosaveRestore, 800);
  setDiscountMode('dollar'); // ensure $ button highlighted on load
  updateMpEquiv(); // show initial pour cost equivalent
  // Ensure event settings state matches initial tab
  toggleEventSettings(true); // menu tab is shown on load
  loadRetailers();
  loadStoreOverrides();
  loadRetailerPrices();
  // Load profile name
  const savedName = localStorage.getItem('bartender_profile_name') || 'Antoine Duong';
  localStorage.setItem('bartender_profile_name', savedName);
  const pn = el('profileName'); if(pn) pn.value = savedName;
  const pnDisplay = document.getElementById('profileNameDisplay');
  if(pnDisplay) pnDisplay.textContent = savedName;
  // Navigate to dashboard on startup
  navTo('dashboard');
} catch(e) {
  console.error('[BartenderTool] Init error:', e);
}

