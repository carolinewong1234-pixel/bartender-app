# Bartender Event Planner — Modular Architecture

## How to use this folder

Open `index.html` in your browser. That's it — works the same as the single-file version.
All your existing data in localStorage carries over automatically (same keys, same format).

## For Claude: How to make changes

When Caroline or Antoine asks for a change, follow this process:

1. **Identify which file(s) to touch** using the map below
2. **Read the full file** before editing (each file is small enough to see entirely)
3. **Check the "Depends on" column** — if the change affects shared state (Q, cocktails, eventLibrary), also read 03-state.js
4. **After editing, verify** no function names were duplicated across files

---

## File Map

| # | File | Lines | What it does | When to edit |
|---|------|-------|-------------|-------------|
| 00 | `00-utils.js` | ~14 | `el()`, `sv()`, `v()`, `vf()`, `vi()`, `sc()`, `gc2()`, `shtml()`, `dl()` | Almost never — these are stable utilities |
| 01 | `01-defensive.js` | ~570 | ErrorCode, AppError, Logger, Validator, SafeStore, ErrorBoundary, self-tests | Changing error handling or storage safety |
| 02 | `02-data.js` | ~420 | `INGDB` (ingredient database), `INGFLAT` (flat lookup), `LIB` (22 quick-add cocktail presets) | Adding/editing default ingredients or quick-add cocktails |
| 03 | `03-state.js` | ~190 | `Q` object, `sv()` override (writes to Q + DOM), `qv/qvf/qvi`, `cocktails[]`, `eventLibrary[]`, `currentEventId`, `makeEventEntry()`, `getState/applyState` | Changing what fields an event tracks, or how state is saved/loaded |
| 04 | `04-toast.js` | ~15 | `showToast()` | Changing toast appearance |
| 05 | `05-ingredients.js` | ~360 | Custom ingredient DB (`myIngredients`), bottle conversion, quick ingredient modal, inline bottle calculator | My Ingredients tab, cost-per-unit calc |
| 06 | `06-receipts.js` | ~1300 | Receipt scanner (camera/upload → Claude API), receipt manager tab, price history tracking, Price IQ analysis, retailer search, library prices | Receipt scanning, price tracking, SAQ lookups |
| 07 | `07-recipes.js` | ~1400 | Recipe library CRUD, search, category filter, import/export (JSON/CSV/AI), flavor tags, variation modal, My Library quick-add section | Recipe Library tab, adding recipes from menu |
| 08 | `08-events.js` | ~1400 | Event categories, type presets (Wedding, Corporate, etc.), 3-step creation flow, menu step management, event library CRUD, save/load, status tracking, quote/invoice snapshots | Event creation, event library, status changes |
| 09 | `09-menu.js` | ~950 | Cocktail cards (`rC`), ingredient rows/dropdowns, cocktail editing, save-all-with-check, `addIR/rNI/addC/qAdd` | Menu builder UI, ingredient dropdowns, cocktail editing |
| 10 | `10-pricing.js` | ~770 | Quote calculation (`rQ`), margin/pour-cost modes, pricing explainer, staff management, discount, `syncSettings`, `cpShop/cpQ` | Pricing, quote numbers, staff, margin calculation |
| 11 | `11-shopping.js` | ~1420 | `getIM()`, `getBottleInfo()`, shopping tab, purchase list, retailers, store overrides, `inferStore()`, shopping deadline, master list | Shopping List tab, Purchase List tab, store assignments |
| 12 | `12-pairs.js` | ~250 | His & Hers cocktail pairing | His & Hers feature |
| 13 | `13-pdf.js` | ~960 | Client PDF (bilingual FR/EN), tax toggle, quote snapshots, quote history, final invoice builder | PDF generation, invoices, tax settings |
| 14 | `14-post-event.js` | ~800 | Post-event checklist, stock count, auto-fill leftovers, inventory management | Post-Event tab, Inventory tab |
| 15 | `15-import.js` | ~830 | Document import modal, AI scan (cocktails/schedule/ingredients), `parseEventDocLocally()`, import preview, `saveImportedData()` | Document import, AI scanning |
| 16 | `16-dashboard.js` | ~280 | Dashboard rendering | Dashboard tab |
| 17 | `17-export.js` | ~150 | `exportJSON/CSV/Sheets`, shopping HTML export, `escCSV` | Export buttons |
| 18 | `18-nav.js` | ~240 | Tab switching (`sw()`), group navigation, toolbar context, overflow menu, undo system | Adding new tabs, changing navigation |
| 19 | `19-autosave.js` | ~285 | Autosave timers, crash recovery, save notifications, save status pill | Autosave behavior, save indicators |
| 20 | `20-init.js` | ~120 | Emily sample data (runs once), global error handlers, startup sequence | Startup order, sample data |

---

## Dependency Rules

```
Layer 0: 00-utils.js        ← everything depends on this
Layer 1: 01-defensive.js    ← SafeStore used by event save/load
Layer 2: 02-data.js         ← ingredient/cocktail constants
Layer 3: 03-state.js        ← Q, cocktails[], eventLibrary[]
Layer 4: 04-toast.js        ← used by most modules for notifications
Layer 5: Everything else    ← domain modules, can call each other
```

**Key shared state** (defined in `03-state.js`):
- `Q` — in-memory quote fields. Use `sv(id, val)` to write (updates both DOM and Q)
- `cocktails[]` — current event's cocktail list
- `eventLibrary[]` — all saved events
- `currentEventId` — which event is loaded
- `makeEventEntry(partial, existing)` — schema constructor for events

**Key shared functions** (used across many modules):
- `el(id)` → DOM element (00-utils)
- `sv(id, val)` → set value in DOM + Q (03-state overrides 00-utils version)
- `showToast(msg, type)` → notification (04-toast)
- `getIM(guests, cocktailList?)` → ingredient calculator (11-shopping)
- `saveEventLibraryStore()` → persist events to localStorage via SafeStore (01-defensive)
- `renderEventLibrary()` → refresh event library UI (08-events)
- `markUnsaved()` → flag unsaved changes (19-autosave)

---

## Bugs Fixed During Split

1. **Duplicate `handleReceiptDrop`** — scanner version (dead code) removed, manager version kept
2. **Duplicate `seedDefaultRecipes`** — destructive version (wiped user recipes) removed, safe merge version kept
3. **SafeStore bypass** — the unsafe `loadEventLibrary`/`saveEventLibraryStore` that bypassed SafeStore have been removed; the SafeStore-backed versions in `01-defensive.js` now run
4. **Duplicate `updateEventStatus`** — weaker version (no toast, no state sync) removed
5. **Missing `getItemRetailer`/`setItemRetailer`** — added to `11-shopping.js`

---

## Common Change Scenarios

| Antoine asks for... | Edit this file |
|---------------------|---------------|
| "Add a new cocktail to quick-add" | `02-data.js` (LIB array) |
| "Change how the quote calculates" | `10-pricing.js` (rQ function) |
| "Add a field to the PDF" | `13-pdf.js` |
| "New event type preset" | `08-events.js` (EVENT_PRESETS) |
| "Change shopping list layout" | `11-shopping.js` (rShop or renderPurchaseList) |
| "Fix recipe library bug" | `07-recipes.js` |
| "Add a new tab" | `18-nav.js` + new file for the tab content |
| "Change autosave timing" | `19-autosave.js` |
| "Add ingredient to database" | `02-data.js` (INGDB) |
| "Fix post-event checklist" | `14-post-event.js` |
| "Change receipt scanner" | `06-receipts.js` |
