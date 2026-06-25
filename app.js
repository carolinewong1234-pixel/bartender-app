// ═══ CORE UTILITIES ═══
// el(), sv(), v(), vf(), vi() etc. — used by every other module

function el(id){return document.getElementById(id);}
function el2(id){return document.getElementById(id);} // alias — use where 'el' shadowed by local var
function v(id){const e=el(id);return e?e.value:'';}
function vf(id){return parseFloat(v(id))||0;}
function vi(id){return parseInt(v(id))||0;}
function sv(id,val){const e=el(id);if(e)e.value=val;}   // safe set value
function sc(id,val){const e=el(id);if(e)e.checked=val;} // safe set checked
function gc2(id,val){const e=el(id);if(e)e.textContent=val;} // safe set text
function shtml(id,html){const e=el(id);if(e)e.innerHTML=html;} // safe set innerHTML

function dl(content,mime,filename){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=filename;a.click();}
// ═══ DEFENSIVE LAYER v1.0 ═══
// ErrorCode, AppError, Logger, Validator, SafeStore, ErrorBoundary
// Self-test suite (activate: localStorage.setItem('BEP_TEST','true'))







// ═══════════════════════════════════════════════════════════════════════════
// BEP DEFENSIVE LAYER v1.0
// Path A — Runtime safety without build tooling
// All components are self-contained and write no side-effects on import.
// ═══════════════════════════════════════════════════════════════════════════

// ── 1. ERROR CODES ── frozen enum, grep-friendly, never magic strings ──
const ErrorCode = Object.freeze({
  UNKNOWN:           'BEP_UNKNOWN',
  VALIDATION:        'BEP_VALIDATION',
  STORAGE_WRITE:     'BEP_STORAGE_WRITE',
  STORAGE_READ:      'BEP_STORAGE_READ',
  STORAGE_QUOTA:     'BEP_STORAGE_QUOTA',
  STORAGE_CORRUPT:   'BEP_STORAGE_CORRUPT',
  STORAGE_UNAVAIL:   'BEP_STORAGE_UNAVAIL',
  PDF_BUILD:         'BEP_PDF_BUILD',
  API_TIMEOUT:       'BEP_API_TIMEOUT',
  API_RESPONSE:      'BEP_API_RESPONSE',
  STATE_CORRUPT:     'BEP_STATE_CORRUPT',
  SAVE_FAILED:       'BEP_SAVE_FAILED',
  INTERNAL:          'BEP_INTERNAL',
});

// ── 2. AppError ── typed error with cause chain ──
class AppError extends Error {
  constructor(message, code, context, cause) {
    super(typeof message === 'string' && message ? message : 'Unknown error');
    this.name    = 'AppError';
    this.code    = (code && typeof code === 'string') ? code : ErrorCode.UNKNOWN;
    this.context = (context && typeof context === 'object') ? context : {};
    this.cause   = cause instanceof Error ? cause : null;
    this.ts      = new Date().toISOString();
    // Capture stack — some browsers need this explicitly
    if (Error.captureStackTrace) Error.captureStackTrace(this, AppError);
  }

  toString() {
    const base = `[${this.code}] ${this.message}`;
    return this.cause ? `${base}\n  caused by: ${this.cause.message}` : base;
  }

  // from() — always returns an AppError, never throws
  static from(unknown, code, context) {
    try {
      if (unknown instanceof AppError) return unknown;
      if (unknown instanceof Error)
        return new AppError(unknown.message, code || ErrorCode.UNKNOWN, context || {}, unknown);
      if (typeof unknown === 'string' && unknown)
        return new AppError(unknown, code || ErrorCode.UNKNOWN, context || {});
      return new AppError('Non-error thrown: ' + String(unknown), ErrorCode.UNKNOWN, context || {});
    } catch (_) {
      return new AppError('AppError.from() itself failed', ErrorCode.INTERNAL);
    }
  }
}

// ── 3. Logger ── circular buffer, redaction, downloadable dump ──
const Logger = (() => {
  const MAX_ENTRIES  = 100;
  const REDACT_KEYS  = new Set(['cn', 'clientName', 'depositAmt', 'paidAmount', 'proofOfPayment']);
  const _buf         = [];
  const LEVELS       = Object.freeze({ DEBUG:0, INFO:1, WARN:2, ERROR:3 });
  let   _minLevel    = LEVELS.INFO;

  function _redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    try {
      const out = {};
      for (const k of Object.keys(obj))
        out[k] = REDACT_KEYS.has(k) ? '[REDACTED]' : _redact(obj[k]);
      return out;
    } catch (_) { return '[REDACT_FAILED]'; }
  }

  function _serialize(data) {
    try { return JSON.stringify(_redact(data)); }
    catch (_) { try { return String(data); } catch (_) { return '[UNSERIALIZABLE]'; } }
  }

  function _push(level, levelName, message, data, err) {
    if (level < _minLevel) return;
    const entry = {
      ts:      new Date().toISOString(),
      level:   levelName,
      message: typeof message === 'string' ? message : String(message),
      data:    data !== undefined ? _serialize(data) : undefined,
      stack:   err instanceof Error ? err.stack : undefined,
    };
    if (_buf.length >= MAX_ENTRIES) _buf.shift();
    _buf.push(entry);
    // Mirror to console
    const fn = level >= LEVELS.ERROR ? 'error' : level >= LEVELS.WARN ? 'warn' : 'log';
    console[fn](`[BEP ${levelName}] ${entry.message}`, data || '');
  }

  return Object.freeze({
    debug: (msg, data)       => _push(LEVELS.DEBUG, 'DEBUG', msg, data),
    info:  (msg, data)       => _push(LEVELS.INFO,  'INFO',  msg, data),
    warn:  (msg, data)       => _push(LEVELS.WARN,  'WARN',  msg, data),
    error: (msg, data, err)  => _push(LEVELS.ERROR, 'ERROR', msg, data, err),
    setLevel: (l)            => { if (l in LEVELS) _minLevel = LEVELS[l]; },
    dump: () => {
      try { return JSON.stringify({ bep_version: '1.0', ts: new Date().toISOString(), entries: _buf }, null, 2); }
      catch (_) { return '{"error":"dump_failed"}'; }
    },
    download: () => {
      try {
        const blob = new Blob([Logger.dump()], { type: 'application/json' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `bep-log-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch (e) { console.error('Logger.download failed', e); }
    },
  });
})();

// ── 4. Validator ── typed boundary checks, coercion, safe self-execution ──
const Validator = (() => {
  // Internal helper — runs a check function, catches its own errors
  function _run(fn, input) {
    try { return fn(input); }
    catch (e) {
      Logger.error('Validator internal failure', { e: String(e) });
      return { valid: false, data: null, errors: [ErrorCode.INTERNAL] };
    }
  }

  // Coerce a value to a positive number within [min, max]
  function _coerceNum(val, min, max, def) {
    const n = parseFloat(val);
    if (isNaN(n)) return def;
    if (n < min)  return min;
    if (n > max)  return max;
    return n;
  }

  function _coerceStr(val, def) {
    if (val === null || val === undefined) return def;
    const s = String(val).trim();
    return s.length > 0 ? s : def;
  }

  // EventEntry schema
  function _validateEventEntry(raw) {
    const errors = [];
    if (raw === null || raw === undefined || typeof raw !== 'object')
      return { valid: false, data: null, errors: ['Input must be an object'] };

    const label = _coerceStr(raw.label, '');
    if (!label) errors.push('label is required');

    const gc = _coerceNum(raw.guestCount || raw.gc, 1, 2000, 50);
    if (gc <= 0) errors.push('guestCount must be positive');

    const data = {
      id:            _coerceStr(raw.id, 'ev_' + Date.now()),
      label,
      eventDate:     _coerceStr(raw.eventDate, ''),
      eventType:     raw.eventType || null,
      guestCount:    gc,
      cocktailCount: _coerceNum(raw.cocktailCount, 0, 9999, 0),
      status:        ['draft','sent','confirmed','completed','cancelled']
                       .includes(raw.status) ? raw.status : 'draft',
      totalQuoted:   _coerceNum(raw.totalQuoted, 0, 999999, 0),
      savedAt:       _coerceStr(raw.savedAt, new Date().toISOString()),
      state:         (raw.state && typeof raw.state === 'object') ? raw.state : null,
      stateHistory:  Array.isArray(raw.stateHistory)  ? raw.stateHistory  : [],
      quoteHistory:  Array.isArray(raw.quoteHistory)  ? raw.quoteHistory  : [],
      paymentStatus: ['unpaid','deposit','partial','paid']
                       .includes(raw.paymentStatus) ? raw.paymentStatus : 'unpaid',
      // Optional fields — null if missing, never undefined
      quoteSnapshot:   raw.quoteSnapshot   || null,
      quoteSentAt:     raw.quoteSentAt     || null,
      invoiceSnapshot: raw.invoiceSnapshot || null,
      invoiceSentAt:   raw.invoiceSentAt   || null,
      invoiceFinalAt:  raw.invoiceFinalAt  || null,
      invoiceTotal:    raw.invoiceTotal    || null,
      depositPaid:     raw.depositPaid     || null,
      depositAmount:   raw.depositAmount   || null,
      depositDate:     raw.depositDate     || null,
      paidAmount:      raw.paidAmount      || null,
      paidDate:        raw.paidDate        || null,
      paidAt:          raw.paidAt          || null,
      paymentMethod:   raw.paymentMethod   || null,
      proofOfPayment:  raw.proofOfPayment  || null,
    };

    return errors.length > 0
      ? { valid: false, data, errors }       // data included so caller can use defaults
      : { valid: true,  data, errors: [] };
  }

  // QuoteState schema
  function _validateQuoteState(raw) {
    if (!raw || typeof raw !== 'object')
      return { valid: false, data: null, errors: ['QuoteState must be an object'] };
    const errors = [];
    const data = {
      eventLabel:      _coerceStr(raw.eventLabel, ''),
      gc:              _coerceNum(raw.gc, 1, 2000, 50),
      eventHrs:        _coerceNum(raw.eventHrs, 0.5, 24, 4),
      hr:              _coerceNum(raw.hr, 0, 9999, 100),
      mp:              _coerceNum(raw.mp, 0, 100, 35),
      tf:              _coerceNum(raw.tf, 0, 9999, 0),
      drinksPerPerson: _coerceNum(raw.drinksPerPerson, 1, 50, 5),
      bufferPct:       _coerceNum(raw.bufferPct, 0, 100, 0),
      discountAmt:     _coerceNum(raw.discountAmt, 0, 999999, 0),
      discountPct:     _coerceNum(raw.discountPct, 0, 100, 0),
      depositAmt:      _coerceNum(raw.depositAmt, 0, 999999, 0),
      cn:              _coerceStr(raw.cn, ''),
      ed:              _coerceStr(raw.ed, ''),
      qn:              _coerceStr(raw.qn, ''),
      quoteStatus:     _coerceStr(raw.quoteStatus, 'draft'),
    };
    return { valid: errors.length === 0, data, errors };
  }

  return Object.freeze({
    eventEntry:  (raw) => _run(_validateEventEntry,  raw),
    quoteState:  (raw) => _run(_validateQuoteState,  raw),
  });
})();

// ── 5. SafeStore ── shadow-write, quota handling, corruption recovery ──
const SafeStore = (() => {
  const SHADOW_SUFFIX = '__shadow';
  const PRUNE_KEYS    = ['bartender_events_v1']; // history-heavy keys to prune first

  function _available() {
    try {
      const t = '__bep_test__';
      localStorage.setItem(t, '1');
      localStorage.removeItem(t);
      return true;
    } catch (_) { return false; }
  }

  function _parseOrNull(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try { return JSON.parse(raw); }
    catch (_) { return null; }
  }

  function _serialize(value) {
    try { return { ok: true, str: JSON.stringify(value) }; }
    catch (e) { return { ok: false, error: AppError.from(e, ErrorCode.STORAGE_WRITE) }; }
  }

  function _pruneHistory(key) {
    try {
      const raw  = localStorage.getItem(key);
      const data = _parseOrNull(raw);
      if (!Array.isArray(data)) return;
      // Trim stateHistory on each entry to last 5 versions
      const pruned = data.map(function(ev) {
        if (!ev || !Array.isArray(ev.stateHistory)) return ev;
        return Object.assign({}, ev, { stateHistory: ev.stateHistory.slice(0, 5) });
      });
      localStorage.setItem(key, JSON.stringify(pruned));
      Logger.warn('SafeStore: pruned history to recover quota', { key });
    } catch (_) { /* pruning failed — nothing more we can do */ }
  }

  function _writeRaw(key, str) {
    try {
      localStorage.setItem(key, str);
      return { ok: true };
    } catch (e) {
      const isQuota = e instanceof DOMException &&
        (e.code === 22 || e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
      if (isQuota) {
        Logger.warn('SafeStore: quota exceeded, attempting prune', { key });
        PRUNE_KEYS.forEach(_pruneHistory);
        try {
          localStorage.setItem(key, str);
          return { ok: true };
        } catch (e2) {
          const err = new AppError('Storage quota exceeded after pruning', ErrorCode.STORAGE_QUOTA, { key }, e2);
          Logger.error(err.message, { key }, e2);
          return { ok: false, error: err };
        }
      }
      const err = AppError.from(e, ErrorCode.STORAGE_WRITE, { key });
      Logger.error('SafeStore write failed', { key }, e);
      return { ok: false, error: err };
    }
  }

  return Object.freeze({
    health: function() {
      return { available: _available(), ts: new Date().toISOString() };
    },

    set: function(key, value) {
      if (!key || typeof key !== 'string')
        return { ok: false, error: new AppError('SafeStore.set: key must be a string', ErrorCode.INTERNAL) };

      const { ok, str, error } = _serialize(value);
      if (!ok) return { ok: false, error };

      // Write shadow first
      const shadowResult = _writeRaw(key + SHADOW_SUFFIX, str);
      if (!shadowResult.ok) return shadowResult;

      // Promote to primary
      const primaryResult = _writeRaw(key, str);
      if (!primaryResult.ok) return primaryResult;

      return { ok: true };
    },

    get: function(key) {
      if (!key || typeof key !== 'string')
        return { ok: false, data: null, error: new AppError('SafeStore.get: key must be a string', ErrorCode.INTERNAL) };

      // Try primary first
      const primary = _parseOrNull(localStorage.getItem(key));
      if (primary !== null) return { ok: true, data: primary };

      // Fall back to shadow
      Logger.warn('SafeStore: primary corrupt or missing, trying shadow', { key });
      const shadow = _parseOrNull(localStorage.getItem(key + SHADOW_SUFFIX));
      if (shadow !== null) {
        Logger.warn('SafeStore: recovered from shadow key', { key });
        return { ok: true, data: shadow, recovered: true };
      }

      return { ok: true, data: null }; // key doesn't exist — not an error
    },

    remove: function(key) {
      if (!key || typeof key !== 'string') return;
      try { localStorage.removeItem(key); localStorage.removeItem(key + SHADOW_SUFFIX); }
      catch (_) { /* removal failure is non-critical */ }
    },
  });
})();

// ── 6. ErrorBoundary ── global catch-all with rate limiting ──
const ErrorBoundary = (() => {
  const _ratemap  = {}; // code → { count, firstTs }
  const RATE_MAX  = 3;
  const RATE_WIN  = 10000; // 10 seconds

  function _isRateLimited(code) {
    const now  = Date.now();
    const slot = _ratemap[code];
    if (!slot || now - slot.firstTs > RATE_WIN) {
      _ratemap[code] = { count: 1, firstTs: now };
      return false;
    }
    slot.count++;
    if (slot.count > RATE_MAX) {
      if (slot.count === RATE_MAX + 1)
        Logger.warn('ErrorBoundary: rate-limiting error code', { code });
      return true;
    }
    return false;
  }

  function _handle(err) {
    const appErr = AppError.from(err);
    if (_isRateLimited(appErr.code)) return;
    Logger.error(appErr.toString(), appErr.context, err instanceof Error ? err : null);
    // Show user-facing toast only for non-internal errors
    try {
      if (typeof showToast === 'function' && appErr.code !== ErrorCode.INTERNAL)
        showToast('Something went wrong — your data is safe. ' + appErr.message, 'error');
    } catch (_) {
      // showToast unavailable — absolute fallback
      console.error('[BEP BOUNDARY]', appErr.toString());
      document.title = '[ERROR] Bartender Event Planner';
    }
  }

  return Object.freeze({
    init: function() {
      window.onerror = function(msg, src, line, col, err) {
        _handle(err || new Error(String(msg)));
        return false; // don't suppress browser default
      };
      window.onunhandledrejection = function(ev) {
        _handle(ev.reason || new Error('Unhandled promise rejection'));
      };
      Logger.info('ErrorBoundary: active');
    },

    // wrap(fn) — runs sync fn, returns {ok, result} or {ok:false, error}
    wrap: function(fn, context) {
      try {
        const result = fn();
        return { ok: true, result };
      } catch (e) {
        const err = AppError.from(e, ErrorCode.UNKNOWN, context || {});
        Logger.error(err.toString(), context, e instanceof Error ? e : null);
        return { ok: false, error: err };
      }
    },

    // wrapAsync(fn) — runs async fn, always resolves to {ok, result} or {ok:false, error}
    wrapAsync: async function(fn, context) {
      try {
        const result = await fn();
        return { ok: true, result };
      } catch (e) {
        const err = AppError.from(e, ErrorCode.UNKNOWN, context || {});
        Logger.error(err.toString(), context, e instanceof Error ? e : null);
        return { ok: false, error: err };
      }
    },
  });
})();

// ── 7. Wire SafeStore into existing save/load functions ──
// Patch saveEventLibraryStore and loadEventLibrary to use SafeStore
// Keeps all existing callers working with zero changes.
const _EVENTS_KEY = 'bartender_events_v1';

function saveEventLibraryStore() {
  const result = SafeStore.set(_EVENTS_KEY, eventLibrary);
  if (!result.ok) {
    // Quota exceeded after pruning — prompt export
    if (result.error && result.error.code === ErrorCode.STORAGE_QUOTA) {
      if (typeof showToast === 'function')
        showToast('⚠️ Storage nearly full — please export a backup from the ⋯ menu', 'error');
    } else {
      if (typeof showToast === 'function')
        showToast('Could not save event library — ' + (result.error ? result.error.message : 'unknown error'), 'error');
    }
  }
}

function loadEventLibrary() {
  const result = SafeStore.get(_EVENTS_KEY);
  if (!result.ok) {
    Logger.error('loadEventLibrary: SafeStore.get failed', {}, result.error);
    eventLibrary = [];
    return;
  }
  if (!result.data) { eventLibrary = []; return; }
  if (!Array.isArray(result.data)) {
    Logger.error('loadEventLibrary: data is not an array — treating as corrupt', { type: typeof result.data });
    eventLibrary = [];
    return;
  }
  if (result.recovered)
    showToast && showToast('Event library recovered from backup — please save again', 'warn');

  // Validate each entry, use coerced data to heal old schemas
  eventLibrary = result.data.map(function(raw, i) {
    const v = Validator.eventEntry(raw);
    if (!v.valid)
      Logger.warn('loadEventLibrary: entry ' + i + ' has schema issues (auto-healed)', { errors: v.errors });
    return v.data || raw; // fall back to raw if validator itself failed
  }).filter(Boolean);
}

// ── 8. Self-test suite (runs only when localStorage.BEP_TEST = 'true') ──
function runBEPTests() {
  if (localStorage.getItem('BEP_TEST') !== 'true') return;
  const results = { passed: 0, failed: 0, errors: [] };

  function assert(label, condition) {
    if (condition) { results.passed++; Logger.info('✓ ' + label); }
    else           { results.failed++; results.errors.push(label); Logger.error('✗ ' + label); }
  }

  function assertNoThrow(label, fn) {
    try { fn(); results.passed++; Logger.info('✓ ' + label); }
    catch (e) { results.failed++; results.errors.push(label + ': threw ' + e); Logger.error('✗ ' + label, {}, e); }
  }

  console.group('BEP Test Suite');

  // AppError tests
  assertNoThrow('AppError: constructs without throw', () => new AppError('x', ErrorCode.UNKNOWN));
  assert('AppError.from(Error): message preserved',    AppError.from(new Error('hi')).message === 'hi');
  assert('AppError.from(string): message preserved',   AppError.from('oops').message === 'oops');
  assert('AppError.from(null): does not throw',        AppError.from(null) instanceof AppError);
  assert('AppError.from(undefined): does not throw',   AppError.from(undefined) instanceof AppError);
  assert('AppError.from(Error): has cause',            AppError.from(new Error('x'), null, null, new Error('y')) instanceof AppError);
  assertNoThrow('ErrorCode: frozen', () => { try { ErrorCode.UNKNOWN = 'hack'; } catch(_){} });
  assert('ErrorCode: frozen value unchanged',          ErrorCode.UNKNOWN === 'BEP_UNKNOWN');

  // Validator tests
  const v1 = Validator.eventEntry({ label: 'Test', guestCount: 50 });
  assert('Validator.eventEntry: happy path valid',     v1.valid === true);
  assert('Validator.eventEntry: data.label correct',   v1.data && v1.data.label === 'Test');

  const v2 = Validator.eventEntry({});
  assert('Validator.eventEntry: missing label → invalid', v2.valid === false);
  assert('Validator.eventEntry: errors array populated',   v2.errors && v2.errors.length > 0);

  const v3 = Validator.eventEntry({ label: 'X', guestCount: '80' });
  assert('Validator.eventEntry: coerces gc string→number', v3.data && v3.data.guestCount === 80);

  assert('Validator.eventEntry(null): no throw',  Validator.eventEntry(null).valid === false);
  assert('Validator.eventEntry(-1 gc): invalid',  Validator.eventEntry({ label:'X', guestCount:-1}).data.guestCount === 1);
  assert('Validator.eventEntry(9999 gc): capped', Validator.eventEntry({ label:'X', guestCount:9999}).data.guestCount === 2000);
  assert('Validator.eventEntry: missing eventType → null', Validator.eventEntry({label:'X'}).data.eventType === null);
  assert('Validator.eventEntry: missing quoteHistory → []', Array.isArray(Validator.eventEntry({label:'X'}).data.quoteHistory));

  const vq = Validator.quoteState({ gc: '80', hr: 100, mp: 35 });
  assert('Validator.quoteState: coerces gc',       vq.data && vq.data.gc === 80);
  assert('Validator.quoteState(null): no throw',   Validator.quoteState(null).valid === false);

  // SafeStore tests
  const ss1 = SafeStore.set('__bep_test_key__', { x: 42 });
  assert('SafeStore.set: returns ok:true',         ss1.ok === true);
  const ss2 = SafeStore.get('__bep_test_key__');
  assert('SafeStore.get: roundtrip value correct', ss2.ok && ss2.data && ss2.data.x === 42);
  SafeStore.remove('__bep_test_key__');
  const ss3 = SafeStore.get('__bep_test_key__');
  assert('SafeStore.get: missing key returns null data', ss3.ok && ss3.data === null);
  assert('SafeStore.get(null): no throw',          SafeStore.get(null).ok === false);
  assert('SafeStore.set(null,x): no throw',        SafeStore.set(null, {}).ok === false);
  const sh = SafeStore.health();
  assert('SafeStore.health: available true',       sh.available === true);

  // Corrupt primary → shadow recovery
  localStorage.setItem('__bep_shadow_test__', '{bad json{{');
  localStorage.setItem('__bep_shadow_test____shadow', JSON.stringify({ recovered: true }));
  const ss4 = SafeStore.get('__bep_shadow_test__');
  assert('SafeStore: recovers from shadow on corrupt primary', ss4.data && ss4.data.recovered === true);
  SafeStore.remove('__bep_shadow_test__');

  // Logger tests
  assertNoThrow('Logger.info: no throw',  () => Logger.info('test msg'));
  assertNoThrow('Logger.error: no throw', () => Logger.error('err msg', {}, new Error('x')));
  assertNoThrow('Logger.dump: no throw',  () => Logger.dump());
  const dump = Logger.dump();
  assert('Logger.dump: valid JSON',       (() => { try { JSON.parse(dump); return true; } catch(_){ return false; }})());
  assertNoThrow('Logger: circular ref no throw', () => { const o = {}; o.self = o; Logger.info('circ', o); });

  // ErrorBoundary tests
  const r1 = ErrorBoundary.wrap(() => 42);
  assert('ErrorBoundary.wrap: happy path ok:true',     r1.ok && r1.result === 42);
  const r2 = ErrorBoundary.wrap(() => { throw new Error('boom'); });
  assert('ErrorBoundary.wrap: catch returns ok:false',  r2.ok === false);
  assert('ErrorBoundary.wrap: error is AppError',       r2.error instanceof AppError);
  assertNoThrow('ErrorBoundary.wrapAsync: exists',      () => typeof ErrorBoundary.wrapAsync === 'function');

  console.groupEnd();

  const summary = `BEP Tests: ${results.passed} passed, ${results.failed} failed`;
  if (results.failed > 0) {
    console.error(summary, results.errors);
    showToast && showToast(summary, 'error');
  } else {
    console.info(summary);
    showToast && showToast('✓ ' + summary, 'success');
  }
}

// Activate error boundary immediately
ErrorBoundary.init();
Logger.info('BEP Defensive Layer v1.0 loaded', { ts: new Date().toISOString() });
// ═══ DATA CONSTANTS ═══
// INGDB (ingredient database), INGFLAT (flat lookup), LIB (quick-add presets)

const LIB=[
  {name:"Mojito",cat:"Classic",dpg:1,ing:[{n:"Havana Club 3 ans rum",q:1.5,u:"oz",c:1.18},{n:"Lime juice — fresh squeezed on site",q:0.75,u:"oz",c:0.18},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05},{n:"Mint (fresh)",q:6,u:"leaves",c:0.02},{n:"Soda water",q:2,u:"oz",c:0.06}]},
  {name:"Aperol Spritz",cat:"Signature",dpg:1,ing:[{n:"Aperol",q:2,u:"oz",c:0.85},{n:"Prosecco (Cinzano)",q:3,u:"oz",c:0.63},{n:"Soda water",q:1,u:"oz",c:0.06},{n:"Orange slice",q:1,u:"piece",c:0.18}]},
  {name:"Margarita",cat:"Classic",dpg:1,ing:[{n:"Olmeca tequila blanco",q:2,u:"oz",c:1.50},{n:"Lime juice — fresh squeezed on site",q:1,u:"oz",c:0.18},{n:"Triple sec",q:0.5,u:"oz",c:0.71},{n:"Salt (rim)",q:1,u:"pinch",c:0.01}]},
  {name:"Gin & Tonic",cat:"Classic",dpg:1,ing:[{n:"Bombay Sapphire gin",q:1.5,u:"oz",c:1.50},{n:"Tonic water",q:4,u:"oz",c:0.22},{n:"Lime wedge",q:1,u:"piece",c:0.12}]},
  {name:"Cosmopolitan",cat:"Signature",dpg:1,ing:[{n:"Absolut vodka",q:1.5,u:"oz",c:1.30},{n:"Triple sec",q:0.5,u:"oz",c:0.71},{n:"Cranberry juice",q:1,u:"oz",c:0.12},{n:"Lime juice — fresh squeezed on site",q:0.5,u:"oz",c:0.10}]},
  {name:"Old Fashioned",cat:"Classic",dpg:1,ing:[{n:"Bourbon whiskey",q:2,u:"oz",c:1.42},{n:"Simple syrup (homemade)",q:0.25,u:"oz",c:0.05},{n:"Angostura bitters",q:2,u:"dashes",c:0.06},{n:"Orange peel",q:1,u:"piece",c:0.12}]},
  {name:"Moscow Mule",cat:"Classic",dpg:1,ing:[{n:"Absolut vodka",q:1.5,u:"oz",c:1.30},{n:"Ginger beer",q:4,u:"oz",c:0.40},{n:"Lime juice — fresh squeezed on site",q:0.5,u:"oz",c:0.10},{n:"Mint (fresh)",q:3,u:"leaves",c:0.02}]},
  {name:"Paloma",cat:"Classic",dpg:1,ing:[{n:"Olmeca tequila blanco",q:2,u:"oz",c:1.50},{n:"Grapefruit juice",q:2,u:"oz",c:0.22},{n:"Lime juice — fresh squeezed on site",q:0.5,u:"oz",c:0.10},{n:"Soda water",q:2,u:"oz",c:0.06},{n:"Salt (rim)",q:1,u:"pinch",c:0.01}]},
  {name:"Negroni",cat:"Classic",dpg:1,ing:[{n:"Bombay Sapphire gin",q:1,u:"oz",c:1.50},{n:"Campari",q:1,u:"oz",c:1.18},{n:"Sweet vermouth (Martini Rosso)",q:1,u:"oz",c:0.71},{n:"Orange peel",q:1,u:"piece",c:0.12}]},
  {name:"Espresso Martini",cat:"Signature",dpg:1,ing:[{n:"Absolut vodka",q:1.5,u:"oz",c:1.30},{n:"Kahlua",q:0.75,u:"oz",c:1.10},{n:"Espresso",q:1,u:"oz",c:0.35},{n:"Simple syrup (homemade)",q:0.25,u:"oz",c:0.05}]},
  {name:"Whisky Sour",cat:"Classic",dpg:1,ing:[{n:"Bourbon whiskey",q:2,u:"oz",c:1.42},{n:"Lemon juice — fresh squeezed on site",q:0.75,u:"oz",c:0.15},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05},{n:"Egg white",q:0.5,u:"oz",c:0.12}]},
  {name:"Dark & Stormy",cat:"Classic",dpg:1,ing:[{n:"Gosling's Dark Seal rum",q:1.5,u:"oz",c:1.54},{n:"Ginger beer",q:4,u:"oz",c:0.40},{n:"Lime wedge",q:1,u:"piece",c:0.12}]},
  {name:"Sangria punch",cat:"Punch",dpg:1.5,ing:[{n:"Red wine (house)",q:3,u:"oz",c:0.50},{n:"Brandy",q:0.5,u:"oz",c:0.45},{n:"Orange juice (fresh)",q:1,u:"oz",c:0.12},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05}]},
  {name:"Virgin Mojito",cat:"Non-alcoholic",dpg:1,ing:[{n:"Lime juice — fresh squeezed on site",q:1,u:"oz",c:0.18},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05},{n:"Mint (fresh)",q:8,u:"leaves",c:0.02},{n:"Soda water",q:4,u:"oz",c:0.06}]},
  {name:"Shirley Temple",cat:"Non-alcoholic",dpg:1,ing:[{n:"Ginger ale",q:4,u:"oz",c:0.18},{n:"Grenadine",q:0.5,u:"oz",c:0.25},{n:"Orange juice (fresh)",q:1,u:"oz",c:0.12},{n:"Maraschino cherry",q:1,u:"piece",c:0.18}]},
  {name:"Yuzu Gin Fizz",cat:"Signature",dpg:1,ing:[{n:"Bombay Sapphire gin",q:1.5,u:"oz",c:1.50},{n:"Yuzu juice (bottled)",q:0.75,u:"oz",c:0.90},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05},{n:"Soda water",q:2,u:"oz",c:0.06},{n:"Shiso leaf",q:1,u:"piece",c:0.15}]},
  {name:"Lychee Martini",cat:"Signature",dpg:1,ing:[{n:"Absolut vodka",q:1.5,u:"oz",c:1.30},{n:"Lychee liqueur (Soho)",q:0.75,u:"oz",c:1.26},{n:"Lychee juice",q:1,u:"oz",c:0.18},{n:"Lime juice — fresh squeezed on site",q:0.5,u:"oz",c:0.18},{n:"Lychee (canned, muddled)",q:1,u:"piece",c:0.20}]},
  {name:"Japanese Whisky Highball",cat:"Classic",dpg:1,ing:[{n:"Japanese whisky (Nikka/Suntory)",q:1.5,u:"oz",c:2.76},{n:"Soda water",q:4,u:"oz",c:0.06},{n:"Lemon wheel",q:1,u:"piece",c:0.08}]},
  {name:"Matcha Sake Spritz",cat:"Signature",dpg:1,ing:[{n:"Sake (dry/junmai)",q:2,u:"oz",c:0.79},{n:"Matcha syrup",q:0.5,u:"oz",c:0.40},{n:"Yuzu juice (bottled)",q:0.5,u:"oz",c:0.90},{n:"Soda water",q:2,u:"oz",c:0.06},{n:"Cucumber (Asian/seedless)",q:1,u:"piece",c:0.10}]},
  {name:"Spicy Yuzu Margarita",cat:"Signature",dpg:1,ing:[{n:"Olmeca tequila blanco",q:2,u:"oz",c:1.50},{n:"Yuzu juice (bottled)",q:0.75,u:"oz",c:0.90},{n:"Triple sec",q:0.5,u:"oz",c:0.71},{n:"Fresh ginger juice",q:0.25,u:"oz",c:0.30},{n:"Tajin (chili-lime rim)",q:1,u:"pinch",c:0.05}]},
  {name:"Butterfly Pea Gin Sour",cat:"Signature",dpg:1,ing:[{n:"Bombay Sapphire gin",q:1.5,u:"oz",c:1.50},{n:"Butterfly pea flower tea",q:1,u:"oz",c:0.10},{n:"Lemon juice — fresh squeezed on site",q:0.75,u:"oz",c:0.15},{n:"Simple syrup (homemade)",q:0.5,u:"oz",c:0.05},{n:"Egg white",q:0.5,u:"oz",c:0.12}]},
  {name:"Lemongrass Mule",cat:"Signature",dpg:1,ing:[{n:"Absolut vodka",q:1.5,u:"oz",c:1.30},{n:"Lemongrass syrup",q:0.5,u:"oz",c:0.25},{n:"Lime juice — fresh squeezed on site",q:0.5,u:"oz",c:0.18},{n:"Ginger beer",q:4,u:"oz",c:0.40},{n:"Lemongrass stalk",q:1,u:"piece",c:0.30}]},
];

let cocktails=[], nIng=[];
// ═══════════════════════════════════════════════════════════
// INGREDIENT DATABASE — organized by category
// Each entry: { name, unit, c (cost/unit CAD), note }
// ═══════════════════════════════════════════════════════════
const INGDB = {
  "🥃 Spirits — Whisky & Bourbon": [
    {name:"Johnnie Walker Black Label",unit:"oz",c:1.97,note:"~$50/750ml SAQ"},
    {name:"Johnnie Walker Red Label",unit:"oz",c:1.42,note:"~$36/750ml SAQ"},
    {name:"Johnnie Walker Double Black",unit:"oz",c:2.28,note:"~$58/750ml SAQ"},
    {name:"Jack Daniel's Tennessee",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Jack Daniel's Honey",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Jack Daniel's Fire",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Crown Royal Canadian",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Crown Royal Apple",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Crown Royal Peach",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Jim Beam bourbon",unit:"oz",c:1.14,note:"~$29/750ml SAQ"},
    {name:"Maker's Mark bourbon",unit:"oz",c:1.81,note:"~$46/750ml SAQ"},
    {name:"Bulleit bourbon",unit:"oz",c:1.73,note:"~$44/750ml SAQ"},
    {name:"Bulleit rye",unit:"oz",c:1.73,note:"~$44/750ml SAQ"},
    {name:"Woodford Reserve bourbon",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Jameson Irish whiskey",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Jameson Black Barrel",unit:"oz",c:1.89,note:"~$48/750ml SAQ"},
    {name:"Glenfiddich 12yr",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Laphroaig 10yr",unit:"oz",c:2.56,note:"~$65/750ml SAQ"},
    {name:"Glenlivet 12yr",unit:"oz",c:2.09,note:"~$53/750ml SAQ"},
    {name:"Canadian Club whisky",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Forty Creek Canadian whisky",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Gibson's Finest",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Wiser's Deluxe Canadian whisky",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Wild Turkey 101 bourbon",unit:"oz",c:1.46,note:"~$37/750ml SAQ"},
  ],  "🍸 Spirits — Vodka": [
    {name:"Absolut vodka",unit:"oz",c:1.30,note:"~$33/750ml SAQ"},
    {name:"Absolut Citron",unit:"oz",c:1.34,note:"~$34/750ml SAQ"},
    {name:"Absolut Raspberri",unit:"oz",c:1.34,note:"~$34/750ml SAQ"},
    {name:"Absolut Vanilia",unit:"oz",c:1.34,note:"~$34/750ml SAQ"},
    {name:"Grey Goose vodka",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Grey Goose La Poire",unit:"oz",c:2.28,note:"~$58/750ml SAQ"},
    {name:"Grey Goose L'Orange",unit:"oz",c:2.28,note:"~$58/750ml SAQ"},
    {name:"Grey Goose Le Citron",unit:"oz",c:2.28,note:"~$58/750ml SAQ"},
    {name:"Belvedere vodka",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Belvedere Peach Nectar",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Belvedere Wild Berry",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Stolichnaya vodka",unit:"oz",c:1.38,note:"~$35/750ml SAQ"},
    {name:"Stolichnaya Vanil",unit:"oz",c:1.42,note:"~$36/750ml SAQ"},
    {name:"Stolichnaya Razberi",unit:"oz",c:1.42,note:"~$36/750ml SAQ"},
    {name:"Tito's vodka",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Ketel One vodka",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Ketel One Botanical Cucumber Mint",unit:"oz",c:1.69,note:"~$43/750ml SAQ"},
    {name:"Ketel One Botanical Peach Orange Blossom",unit:"oz",c:1.69,note:"~$43/750ml SAQ"},
    {name:"Russian Standard vodka",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Ciroc vodka",unit:"oz",c:1.97,note:"~$50/750ml SAQ"},
    {name:"Ciroc Red Berry",unit:"oz",c:2.05,note:"~$52/750ml SAQ"},
    {name:"Ciroc Peach",unit:"oz",c:2.05,note:"~$52/750ml SAQ"},
    {name:"Ciroc Coconut",unit:"oz",c:2.05,note:"~$52/750ml SAQ"},
    {name:"Smirnoff vodka",unit:"oz",c:0.94,note:"~$24/750ml SAQ"},
    {name:"Smirnoff Raspberry",unit:"oz",c:0.98,note:"~$25/750ml SAQ"},
    {name:"Finlandia vodka",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"42 Below vodka",unit:"oz",c:1.50,note:"~$38/750ml SAQ"},
    {name:"UV Blue vodka (raspberry)",unit:"oz",c:1.06,note:"~$27/750ml SAQ"},
    {name:"Local/house vodka",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
  ],
  "🌿 Spirits — Gin": [
    {name:"Bombay Sapphire gin",unit:"oz",c:1.50,note:"~$38/750ml SAQ"},
    {name:"Bombay Sapphire East",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Hendrick's gin",unit:"oz",c:1.97,note:"~$50/750ml SAQ"},
    {name:"Hendrick's Lunar gin",unit:"oz",c:2.09,note:"~$53/750ml SAQ"},
    {name:"Hendrick's Neptunia gin",unit:"oz",c:2.09,note:"~$53/750ml SAQ"},
    {name:"Tanqueray gin",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Tanqueray No. Ten gin",unit:"oz",c:1.89,note:"~$48/750ml SAQ"},
    {name:"Ungava gin (QC)",unit:"oz",c:1.73,note:"~$44/750ml SAQ — local Quebec"},
    {name:"Empress 1908 gin",unit:"oz",c:2.05,note:"~$52/750ml SAQ — purple, Instagram-worthy"},
    {name:"Roku gin",unit:"oz",c:1.81,note:"~$46/750ml SAQ"},
    {name:"The Botanist gin",unit:"oz",c:2.09,note:"~$53/750ml SAQ"},
    {name:"Malfy Limone gin",unit:"oz",c:1.89,note:"~$48/750ml SAQ"},
    {name:"Malfy Rosa gin",unit:"oz",c:1.89,note:"~$48/750ml SAQ"},
    {name:"Monkey 47 gin",unit:"oz",c:3.15,note:"~$80/500ml SAQ"},
    {name:"Beefeater gin",unit:"oz",c:1.38,note:"~$35/750ml SAQ"},
    {name:"The Botanist gin",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Roku gin",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"Aviation gin",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"Local/house gin",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Boreal Gin (QC)",unit:"oz",c:2.17,note:"~$55/750ml SAQ — Quebec local"},
    {name:"Cirka Gin no. 7 (QC)",unit:"oz",c:1.85,note:"~$47/750ml SAQ — Quebec local"},
    {name:"Fecteau Gin (QC)",unit:"oz",c:1.93,note:"~$49/750ml SAQ — Quebec local"},
  ],
  "🌵 Spirits — Tequila & Mezcal": [
    {name:"Patron Silver tequila",unit:"oz",c:2.76,note:"~$70/750ml SAQ"},
    {name:"Patron Reposado tequila",unit:"oz",c:2.96,note:"~$75/750ml SAQ"},
    {name:"Patron Anejo tequila",unit:"oz",c:3.35,note:"~$85/750ml SAQ"},
    {name:"Don Julio Blanco",unit:"oz",c:2.96,note:"~$75/750ml SAQ"},
    {name:"Don Julio Reposado",unit:"oz",c:3.15,note:"~$80/750ml SAQ"},
    {name:"Don Julio 1942",unit:"oz",c:7.88,note:"~$200/750ml SAQ — premium"},
    {name:"Jose Cuervo Gold",unit:"oz",c:1.30,note:"~$33/750ml SAQ"},
    {name:"Jose Cuervo Silver",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"1800 Silver tequila",unit:"oz",c:1.65,note:"~$42/750ml SAQ"},
    {name:"1800 Coconut tequila",unit:"oz",c:1.73,note:"~$44/750ml SAQ"},
    {name:"Herradura Silver",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Olmeca Altos Plata",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Espolon Blanco",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"El Jimador Blanco",unit:"oz",c:1.38,note:"~$35/750ml SAQ"},
    {name:"Casamigos Blanco",unit:"oz",c:2.76,note:"~$70/750ml SAQ"},
    {name:"Casamigos Reposado",unit:"oz",c:2.96,note:"~$75/750ml SAQ"},
    {name:"Del Maguey Vida mezcal",unit:"oz",c:3.15,note:"~$80/750ml SAQ"},
    {name:"Montelobos mezcal",unit:"oz",c:2.56,note:"~$65/750ml SAQ"},
  ],  "🍹 Spirits — Rum": [
    {name:"Havana Club 3 ans rum",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Havana Club 7 ans rum",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Diplomatico Reserva rum",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Appleton Estate rum",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
    {name:"Mount Gay Eclipse rum",unit:"oz",c:1.46,note:"~$37/750ml SAQ"},
    {name:"Malibu coconut rum",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Gosling's Dark Seal rum",unit:"oz",c:1.54,note:"~$39/750ml SAQ"},
    {name:"Plantation rum",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"Overproof white rum",unit:"oz",c:1.30,note:"~$33/750ml SAQ"},
    {name:"Bacardi Superior white rum",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Bacardi Limón",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Bacardi Coconut",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Bacardi Spiced",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Myers's Dark rum",unit:"oz",c:1.34,note:"~$34/750ml SAQ"},
  ],
  "🍊 Liqueurs & Aperitifs": [
    {name:"Aperol",unit:"oz",c:0.85,note:"~$21.45/750ml SAQ"},
    {name:"Campari",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Cointreau",unit:"oz",c:1.58,note:"~$40/750ml SAQ"},
    {name:"Triple sec",unit:"oz",c:0.71,note:"~$18/750ml SAQ"},
    {name:"Grand Marnier",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"Kahlua",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Baileys Irish Cream",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Amaretto (Disaronno)",unit:"oz",c:1.38,note:"~$35/750ml SAQ"},
    {name:"Frangelico",unit:"oz",c:1.50,note:"~$38/750ml SAQ"},
    {name:"Chambord",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"St-Germain elderflower",unit:"oz",c:1.77,note:"~$45/750ml SAQ"},
    {name:"Peach schnapps",unit:"oz",c:0.79,note:"~$20/750ml SAQ"},
    {name:"Blue Curaçao",unit:"oz",c:0.87,note:"~$22/750ml SAQ"},
    {name:"Midori melon",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Limoncello",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Amaretto",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Pimm's No.1",unit:"oz",c:1.30,note:"~$33/750ml SAQ"},
    {name:"Lillet Blanc",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
  ],
  "🥃 Brandy & Cognac": [
    {name:"Hennessy VS cognac",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Hennessy VSOP cognac",unit:"oz",c:3.54,note:"~$90/750ml SAQ"},
    {name:"Remy Martin VSOP",unit:"oz",c:2.96,note:"~$75/750ml SAQ"},
    {name:"Courvoisier VS cognac",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Martell VS cognac",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Armagnac Janneau VS",unit:"oz",c:1.97,note:"~$50/750ml SAQ"},
    {name:"Calvados (apple brandy)",unit:"oz",c:2.17,note:"~$55/750ml SAQ"},
    {name:"Pisco Capel",unit:"oz",c:1.73,note:"~$44/750ml SAQ"},
    {name:"Christian Brothers brandy",unit:"oz",c:1.06,note:"~$27/750ml SAQ"},
  ],
  "🍷 Vermouth & Fortified Wine": [
    {name:"Sweet vermouth (Martini Rosso)",unit:"oz",c:0.71,note:"~$18/750ml SAQ"},
    {name:"Dry vermouth (Martini Extra Dry)",unit:"oz",c:0.67,note:"~$17/750ml SAQ"},
    {name:"Campari",unit:"oz",c:1.18,note:"~$30/750ml SAQ"},
    {name:"Aperol",unit:"oz",c:0.85,note:"~$21.45/750ml SAQ"},
    {name:"Dubonnet",unit:"oz",c:0.95,note:"~$24/750ml SAQ"},
    {name:"Sherry (Fino)",unit:"oz",c:0.95,note:"~$24/750ml SAQ"},
    {name:"Port wine",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
  ],
  "🍾 Wine & Bubbles": [
    {name:"Prosecco (Cinzano)",unit:"oz",c:0.63,note:"~$16/750ml SAQ"},
    {name:"Champagne (entry level)",unit:"oz",c:1.58,note:"~$40/750ml SAQ"},
    {name:"Sparkling wine (Cava)",unit:"oz",c:0.71,note:"~$18/750ml SAQ"},
    {name:"Red wine (house)",unit:"oz",c:0.50,note:"~$13/750ml SAQ"},
    {name:"White wine (house)",unit:"oz",c:0.50,note:"~$13/750ml SAQ"},
    {name:"Rosé wine",unit:"oz",c:0.59,note:"~$15/750ml SAQ"},
  ],
  "🍺 Beer & Cider": [
    {name:"Domestic beer",unit:"bottle",c:2.50,note:"~$2.50 retail"},
    {name:"Craft beer (local)",unit:"bottle",c:4.00,note:"~$4 retail"},
    {name:"Hard cider",unit:"bottle",c:3.50,note:"~$3.50 retail"},
    {name:"Radler/shandy",unit:"can",c:2.75,note:"~$2.75 retail"},
  ],
  "🌊 Mixers & Sodas": [
    {name:"Soda water",unit:"oz",c:0.06,note:"~$2/1L grocery"},
    {name:"Tonic water",unit:"oz",c:0.22,note:"~$7/1L premium grocery"},
    {name:"Ginger beer",unit:"oz",c:0.40,note:"~$5/355ml can grocery"},
    {name:"Ginger ale",unit:"oz",c:0.18,note:"~$2/1L grocery"},
    {name:"Cola (Coca-Cola)",unit:"oz",c:0.12,note:"~$2.50/2L grocery"},
    {name:"Diet cola",unit:"oz",c:0.12,note:"~$2.50/2L grocery"},
    {name:"Lemon-lime soda (Sprite)",unit:"oz",c:0.12,note:"~$2.50/2L grocery"},
    {name:"Grapefruit soda",unit:"oz",c:0.18,note:"~$4/1L grocery"},
    {name:"Cream soda",unit:"oz",c:0.12,note:"~$2.50/2L grocery"},
    {name:"Still water",unit:"oz",c:0.04,note:"~$3/2L grocery"},
  ],
  "🍋 Juices": [
    {name:"Lime juice — fresh squeezed on site",unit:"oz",c:0.18,note:"~$0.75/lime · 1 lime = ~1oz juice · squeeze at event"},
    {name:"Lime juice — pre-batched fresh",unit:"oz",c:0.18,note:"~$0.75/lime · squeezed in advance, brought in container"},
    {name:"Lime juice — bottled (Bottled lime juice)",unit:"oz",c:0.06,note:"~$4.50/250ml bottle IGA/Metro · ~$0.06/oz"},
    {name:"Lime juice — bottled (Roses)",unit:"oz",c:0.07,note:"~$5/250ml bottle IGA/Metro · sweetened, lower quality"},
    {name:"Lemon juice — fresh squeezed on site",unit:"oz",c:0.15,note:"~$0.60/lemon · 1 lemon = ~1.5oz juice · squeeze at event"},
    {name:"Lemon juice — pre-batched fresh",unit:"oz",c:0.15,note:"~$0.60/lemon · squeezed in advance, brought in container"},
    {name:"Lemon juice — bottled (RealLemon)",unit:"oz",c:0.05,note:"~$4/250ml bottle IGA/Metro · ~$0.05/oz"},
    {name:"Orange juice (fresh)",unit:"oz",c:0.12,note:"~$4/1L grocery"},
    {name:"Grapefruit juice",unit:"oz",c:0.22,note:"~$5/1L grocery"},
    {name:"Cranberry juice",unit:"oz",c:0.12,note:"~$4/1L grocery"},
    {name:"Pineapple juice",unit:"oz",c:0.14,note:"~$3.50/1L grocery"},
    {name:"Mango juice",unit:"oz",c:0.18,note:"~$5/1L grocery"},
    {name:"Tomato juice",unit:"oz",c:0.10,note:"~$3/1L grocery"},
    {name:"Clamato juice",unit:"oz",c:0.08,note:"~$4/1.89L Aubut — Quebec Caesar"},
    {name:"Walter Caesar mix",unit:"oz",c:0.12,note:"~$6/1L Aubut/SAQ"},
    {name:"Coconut water",unit:"oz",c:0.20,note:"~$5/1L grocery"},
    {name:"Apple juice",unit:"oz",c:0.08,note:"~$3/1L grocery"},
    {name:"Passion fruit juice",unit:"oz",c:0.22,note:"~$5/1L grocery"},
  ],
  "🍯 Syrups & Sweeteners": [
    {name:"Simple syrup (homemade)",unit:"oz",c:0.05,note:"~sugar + water"},
    {name:"Simple syrup (commercial)",unit:"oz",c:0.15,note:"~$6/750ml"},
    {name:"Grenadine",unit:"oz",c:0.25,note:"~$6/750ml grocery"},
    {name:"Agave nectar",unit:"oz",c:0.20,note:"~$6/250ml grocery"},
    {name:"Honey syrup",unit:"oz",c:0.18,note:"~$5/250ml grocery"},
    {name:"Lavender syrup",unit:"oz",c:0.30,note:"~$9/250ml specialty"},
    {name:"Rose syrup",unit:"oz",c:0.30,note:"~$9/250ml specialty"},
    {name:"Orgeat (almond syrup)",unit:"oz",c:0.35,note:"~$10/375ml SAQ"},
    {name:"Falernum",unit:"oz",c:0.35,note:"~$10/375ml SAQ"},
    {name:"Passion fruit syrup",unit:"oz",c:0.30,note:"~$9/250ml specialty"},
    {name:"Raspberry syrup",unit:"oz",c:0.28,note:"~$8/250ml grocery"},
    {name:"Vanilla syrup",unit:"oz",c:0.25,note:"~$7/250ml grocery"},
    {name:"Demerara syrup",unit:"oz",c:0.10,note:"~$4/250ml homemade"},
    {name:"Cane sugar syrup",unit:"oz",c:0.08,note:"~$3/250ml homemade"},
  ],
  "🌶 Bitters & Accents": [
    {name:"Angostura bitters",unit:"dashes",c:0.06,note:"~$12/200ml SAQ"},
    {name:"Peychaud's bitters",unit:"dashes",c:0.06,note:"~$12/200ml SAQ"},
    {name:"Orange bitters",unit:"dashes",c:0.06,note:"~$12/200ml SAQ"},
    {name:"Mole bitters",unit:"dashes",c:0.08,note:"~$15/100ml specialty"},
    {name:"Celery bitters",unit:"dashes",c:0.08,note:"~$15/100ml specialty"},
    {name:"Aromatic bitters",unit:"dashes",c:0.06,note:"~$12/200ml SAQ"},
    {name:"Tabasco sauce",unit:"dashes",c:0.03,note:"grocery"},
    {name:"Worcestershire sauce",unit:"dashes",c:0.03,note:"grocery"},
  ],
  "🍊 Garnishes — Citrus": [
    {name:"Lime wedge",unit:"piece",c:0.12,note:"~$0.50/lime grocery"},
    {name:"Lemon wedge",unit:"piece",c:0.10,note:"~$0.40/lemon grocery"},
    {name:"Orange slice",unit:"piece",c:0.18,note:"~$0.75/orange grocery"},
    {name:"Grapefruit slice",unit:"piece",c:0.20,note:"~$0.80/grapefruit grocery"},
    {name:"Lime wheel",unit:"piece",c:0.10,note:"~$0.50/lime grocery"},
    {name:"Lemon wheel",unit:"piece",c:0.08,note:"~$0.40/lemon grocery"},
    {name:"Orange peel",unit:"piece",c:0.12,note:"~$0.75/orange grocery"},
    {name:"Lemon twist",unit:"piece",c:0.08,note:"~$0.40/lemon grocery"},
    {name:"Lime juice — fresh squeezed on site",unit:"oz",c:0.18,note:"~$0.75/lime · squeeze at event"},
  ],
  "🌿 Garnishes — Herbs & Other": [
    {name:"Mint (fresh)",unit:"leaves",c:0.02,note:"~$3/bunch grocery"},
    {name:"Basil (fresh)",unit:"leaves",c:0.03,note:"~$3/bunch grocery"},
    {name:"Rosemary sprig",unit:"piece",c:0.15,note:"~$3/bunch grocery"},
    {name:"Thyme sprig",unit:"piece",c:0.10,note:"~$3/bunch grocery"},
    {name:"Cucumber slice",unit:"piece",c:0.08,note:"~$2/cucumber grocery"},
    {name:"Celery stalk",unit:"piece",c:0.25,note:"~$3/bunch grocery"},
    {name:"Maraschino cherry",unit:"piece",c:0.18,note:"~$5/jar grocery"},
    {name:"Luxardo cherry",unit:"piece",c:0.60,note:"~$18/jar specialty"},
    {name:"Olive (cocktail)",unit:"piece",c:0.20,note:"~$5/jar grocery"},
    {name:"Cocktail onion",unit:"piece",c:0.15,note:"~$4/jar grocery"},
    {name:"Pineapple chunk",unit:"piece",c:0.20,note:"~$4/pineapple grocery"},
    {name:"Dried orange wheel",unit:"piece",c:0.35,note:"~$10/bag specialty"},
    {name:"Edible flower",unit:"piece",c:0.50,note:"~$8/pack specialty"},
    {name:"Cinnamon stick",unit:"piece",c:0.15,note:"~$4/pack grocery"},
    {name:"Star anise",unit:"piece",c:0.12,note:"~$4/pack grocery"},
    {name:"Dehydrated lime wheel",unit:"piece",c:0.40,note:"~$12/bag specialty"},
  ],
  "🧂 Salts, Sugars & Rims": [
    {name:"Salt (rim)",unit:"pinch",c:0.01,note:"grocery"},
    {name:"Sugar (rim)",unit:"pinch",c:0.01,note:"grocery"},
    {name:"Tajin (chili-lime rim)",unit:"pinch",c:0.05,note:"~$5/bottle grocery"},
    {name:"Smoked salt",unit:"pinch",c:0.05,note:"~$6/bottle specialty"},
    {name:"Celery salt",unit:"pinch",c:0.03,note:"~$4/bottle grocery"},
    {name:"Black pepper",unit:"pinch",c:0.02,note:"grocery"},
    {name:"Cayenne pepper",unit:"pinch",c:0.02,note:"grocery"},
  ],
  "🥚 Dairy & Proteins": [
    {name:"Egg white",unit:"oz",c:0.12,note:"~$4/dozen grocery"},
    {name:"Whole egg",unit:"piece",c:0.30,note:"~$4/dozen grocery"},
    {name:"Heavy cream",unit:"oz",c:0.20,note:"~$4/500ml grocery"},
    {name:"Coconut cream",unit:"oz",c:0.22,note:"~$3/400ml can grocery"},
    {name:"Condensed milk",unit:"oz",c:0.15,note:"~$3/300ml grocery"},
    {name:"Butter (fat-washed)",unit:"oz",c:0.18,note:"~$5/250g grocery"},
  ],
  "☕ Coffee & Tea": [
    {name:"Espresso",unit:"oz",c:0.35,note:"~$0.35/shot"},
    {name:"Cold brew coffee",unit:"oz",c:0.20,note:"~$6/1L grocery"},
    {name:"Black tea (brewed)",unit:"oz",c:0.05,note:"grocery"},
    {name:"Green tea (brewed)",unit:"oz",c:0.05,note:"grocery"},
    {name:"Matcha powder",unit:"tsp",c:0.40,note:"~$15/100g specialty"},
    {name:"Chai concentrate",unit:"oz",c:0.20,note:"~$6/1L grocery"},
  ],
  "🍵 Asian-Inspired": [
    {name:"Yuzu juice (bottled)",unit:"oz",c:0.90,note:"~$12/200ml · Japanese citrus · Ares/Marché TAU Montreal"},
    {name:"Yuzu juice (fresh)",unit:"oz",c:1.50,note:"~$3-4/yuzu · seasonal · Asian grocery MTL"},
    {name:"Yuzu kosho paste",unit:"tsp",c:0.40,note:"~$8/jar · spicy citrus condiment · Asian grocery"},
    {name:"Lychee juice",unit:"oz",c:0.18,note:"~$3/400ml can · IGA/Asian grocery"},
    {name:"Lychee liqueur (Soho)",unit:"oz",c:1.26,note:"~$32/750ml SAQ"},
    {name:"Sake (dry/junmai)",unit:"oz",c:0.79,note:"~$20/750ml SAQ"},
    {name:"Sake (nigori/cloudy)",unit:"oz",c:0.95,note:"~$24/750ml SAQ"},
    {name:"Plum wine (umeshu)",unit:"oz",c:0.95,note:"~$24/750ml SAQ"},
    {name:"Shochu",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Japanese whisky (Nikka/Suntory)",unit:"oz",c:2.76,note:"~$70/750ml SAQ"},
    {name:"Sesame oil (few drops)",unit:"dashes",c:0.05,note:"~$5/bottle grocery · fat wash or garnish"},
    {name:"Miso syrup (homemade)",unit:"oz",c:0.20,note:"~miso + simple syrup"},
    {name:"Ginger syrup",unit:"oz",c:0.25,note:"~$7/250ml · Asian grocery or homemade"},
    {name:"Fresh ginger juice",unit:"oz",c:0.30,note:"~$2/knob ginger · pressed fresh"},
    {name:"Matcha syrup",unit:"oz",c:0.40,note:"~matcha + simple syrup · specialty"},
    {name:"Matcha powder",unit:"tsp",c:0.40,note:"~$15/100g · specialty grocery"},
    {name:"Thai basil",unit:"leaves",c:0.04,note:"~$3/bunch · Asian grocery MTL"},
    {name:"Shiso leaf",unit:"piece",c:0.15,note:"~$4/pack · Asian grocery MTL"},
    {name:"Lemongrass stalk",unit:"piece",c:0.30,note:"~$3/bunch · Asian grocery MTL"},
    {name:"Lemongrass syrup",unit:"oz",c:0.25,note:"~homemade or specialty"},
    {name:"Kaffir lime leaf",unit:"piece",c:0.10,note:"~$3/pack · Asian grocery MTL"},
    {name:"Coconut water (fresh young coconut)",unit:"oz",c:0.35,note:"~$4/coconut · Asian grocery MTL"},
    {name:"Pandan syrup",unit:"oz",c:0.25,note:"~$5/bottle · Asian grocery MTL"},
    {name:"Tamarind syrup",unit:"oz",c:0.20,note:"~$4/bottle · Asian grocery MTL"},
    {name:"Black sesame syrup",unit:"oz",c:0.35,note:"~homemade or specialty"},
    {name:"Oolong tea (brewed)",unit:"oz",c:0.06,note:"~$8/100g tea · Asian grocery"},
    {name:"Jasmine tea (brewed)",unit:"oz",c:0.05,note:"~$6/100g tea · grocery"},
    {name:"Butterfly pea flower tea",unit:"oz",c:0.10,note:"~$10/50g · colour-changing · specialty"},
    {name:"Ramune soda",unit:"oz",c:0.20,note:"~$3/bottle · Asian grocery MTL"},
    {name:"Calpico (plain)",unit:"oz",c:0.18,note:"~$5/500ml · Asian grocery MTL"},
    {name:"Calpico (strawberry/melon)",unit:"oz",c:0.20,note:"~$5/500ml · Asian grocery MTL"},
    {name:"Mango lassi base",unit:"oz",c:0.15,note:"~$4/1L · Indian grocery MTL"},
    {name:"Rose water",unit:"dashes",c:0.05,note:"~$5/100ml · Middle Eastern/Asian grocery"},
    {name:"Lychee (canned, muddled)",unit:"piece",c:0.20,note:"~$3/400ml can · IGA/Asian grocery"},
    {name:"Cucumber (Asian/seedless)",unit:"piece",c:0.10,note:"~$2 · grocery"},
    {name:"Wasabi (small amount, rim)",unit:"pinch",c:0.08,note:"~$5/tube · grocery"},
    {name:"Soy sauce (savoury cocktail)",unit:"dashes",c:0.03,note:"grocery"},
    {name:"Mirin",unit:"oz",c:0.15,note:"~$5/300ml · Asian grocery MTL"},
  ],
  "🛒 Aubut — Bar Supplies": [
    {name:"Monin syrup (assorted)",unit:"oz",c:0.28,note:"~$14/750ml Aubut — syrups, 60+ flavors"},
    {name:"Monin Grenadine syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Monin Blue Curaçao syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Monin Passion Fruit syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Monin Elderflower syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Monin Simple syrup",unit:"oz",c:0.20,note:"~$10/750ml Aubut"},
    {name:"Monin Coconut syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Monin Vanilla syrup",unit:"oz",c:0.28,note:"~$14/750ml Aubut"},
    {name:"Clamato juice",unit:"oz",c:0.08,note:"~$7/1.89L Aubut — Caesar essential"},
    {name:"Walter Caesar mix",unit:"oz",c:0.14,note:"~$7/946ml Aubut"},
    {name:"Fever-Tree tonic water",unit:"oz",c:0.18,note:"~$9/4×200ml Aubut"},
    {name:"Fever-Tree ginger beer",unit:"oz",c:0.18,note:"~$9/4×200ml Aubut"},
    {name:"Fever-Tree ginger ale",unit:"oz",c:0.18,note:"~$9/4×200ml Aubut"},
    {name:"Schweppes tonic water (Aubut)",unit:"oz",c:0.06,note:"~$6/2L Aubut"},
    {name:"Canada Dry ginger ale (Aubut)",unit:"oz",c:0.05,note:"~$5/2L Aubut"},
    {name:"SanPellegrino sparkling water",unit:"oz",c:0.10,note:"~$8/6×250ml Aubut"},
    {name:"Perrier sparkling water (Aubut)",unit:"oz",c:0.09,note:"~$7/6×330ml Aubut"},
    {name:"Lime juice (Rose's cordial)",unit:"oz",c:0.16,note:"~$6/500ml Aubut"},
    {name:"Lemon juice (bottled Realemon)",unit:"oz",c:0.10,note:"~$4/500ml Aubut"},
    {name:"Pineapple juice (Del Monte)",unit:"oz",c:0.07,note:"~$4/1.36L Aubut"},
    {name:"Cranberry juice cocktail",unit:"oz",c:0.08,note:"~$5/1.89L Aubut"},
    {name:"Orange juice (Fairlee)",unit:"oz",c:0.06,note:"~$5/1.89L Aubut"},
    {name:"Grapefruit juice",unit:"oz",c:0.08,note:"~$4/1L Aubut"},
    {name:"Coconut cream (Coco Lopez)",unit:"oz",c:0.35,note:"~$6/425ml can Aubut"},
    {name:"Tabasco sauce",unit:"dashes",c:0.05,note:"~$4/150ml Aubut"},
    {name:"Worcestershire sauce",unit:"dashes",c:0.03,note:"~$3/250ml Aubut"},
    {name:"Cocktail olives (jar)",unit:"piece",c:0.12,note:"~$5/jar Aubut — garnish"},
    {name:"Maraschino cherries",unit:"piece",c:0.15,note:"~$5/jar Aubut — garnish"},
    {name:"Cocktail picks / skewers",unit:"piece",c:0.02,note:"~$3/100pk Aubut — garnish"},
    {name:"Plastic cups 16oz",unit:"piece",c:0.08,note:"~$8/100pk Aubut — supplies"},
    {name:"Cocktail napkins",unit:"piece",c:0.02,note:"~$4/200pk Aubut — supplies"},
    {name:"Straws (cocktail)",unit:"piece",c:0.01,note:"~$3/250pk Aubut — supplies"},
    {name:"Disposable bar cups 12oz",unit:"piece",c:0.06,note:"~$6/100pk Aubut"},
  ],
  "🫙 Specialty & Misc": [
    {name:"Coconut milk",unit:"oz",c:0.15,note:"~$3/400ml can grocery"},
    {name:"Coconut water",unit:"oz",c:0.20,note:"~$5/1L grocery"},
    {name:"Almond milk",unit:"oz",c:0.10,note:"~$4/1L grocery"},
    {name:"Oat milk",unit:"oz",c:0.12,note:"~$5/1L grocery"},
    {name:"Club soda",unit:"oz",c:0.06,note:"~$2/1L grocery"},
    {name:"Fever-Tree tonic water",unit:"oz",c:0.18,note:"~$8/4\xd7200ml Aubut/IGA"},
    {name:"Fever-Tree ginger beer",unit:"oz",c:0.18,note:"~$8/4\xd7200ml Aubut"},
    {name:"Schweppes tonic water",unit:"oz",c:0.06,note:"~$3/1L Aubut"},
    {name:"Canada Dry ginger ale",unit:"oz",c:0.05,note:"~$2.50/1L Aubut"},
    {name:"Sparkling water (Perrier)",unit:"oz",c:0.15,note:"~$5/1L grocery"},
    {name:"Rose water",unit:"dashes",c:0.05,note:"~$5/100ml grocery"},
    {name:"Orange flower water",unit:"dashes",c:0.05,note:"~$5/100ml grocery"},
    {name:"Velvet Falernum",unit:"oz",c:0.35,note:"~$10/375ml SAQ"},
    {name:"Absinthe",unit:"oz",c:2.37,note:"~$60/750ml SAQ"},
    {name:"Midori",unit:"oz",c:1.10,note:"~$28/750ml SAQ"},
    {name:"Galliano",unit:"oz",c:1.38,note:"~$35/750ml SAQ"},
    {name:"Chartreuse (Green)",unit:"oz",c:2.76,note:"~$70/750ml SAQ"},
    {name:"Benedictine",unit:"oz",c:1.58,note:"~$40/750ml SAQ"},
    {name:"Drambuie",unit:"oz",c:1.62,note:"~$41/750ml SAQ"},
  ],
};

// flat list for search — built from INGDB + user custom DB
const INGFLAT = [];
Object.entries(INGDB).forEach(([cat, items]) => {
  items.forEach(item => INGFLAT.push({...item, cat}));
});
// ═══ STATE MANAGEMENT ═══
// Q object, sv() override, qv/qvf/qvi, cocktails, nIng, eventLibrary,
// currentEventId, makeEventEntry, getState/applyState

let eventLibrary = [];

let currentEventId = null; // tracks currently loaded event

// ── Q: In-memory quote state — single source of truth ──
// sv() keeps DOM + Q in sync. Calc functions read from Q, not DOM.
// This eliminates stale reads from hidden or unrendered DOM fields.
const Q = {
  eventLabel:    '',
  cn:            '',
  ed:            '',
  gc:            50,
  eventHrs:      4,
  hr:            100,
  mp:            35,
  tf:            0,
  drinksPerPerson: 5,
  bufferPct:     0,
  discountAmt:   0,
  discountPct:   0,
  depositAmt:    0,
  qn:            '',
  quoteStatus:   'draft',
  p1name: '', p1drink: '', p1cat: '',
  p2name: '', p2drink: '', p2cat: '',
};

// Override sv() to also update Q
const _sv_original = function(id, val){
  const e = document.getElementById(id);
  if(e) e.value = val;
};
function sv(id, val){
  _sv_original(id, String(val !== undefined && val !== null ? val : ''));
  if(id in Q){
    // Store as correct type
    const num = parseFloat(val);
    Q[id] = (id === 'eventLabel' || id === 'cn' || id === 'ed' || id === 'qn' ||
              id === 'quoteStatus' || id === 'p1name' || id === 'p1drink' || id === 'p1cat' ||
              id === 'p2name' || id === 'p2drink' || id === 'p2cat')
      ? String(val || '')
      : (isNaN(num) ? 0 : num);
  }
}

// qv() — read from Q (safe, always current)
// Falls back to DOM if field not in Q
function qv(id){  return id in Q ? String(Q[id]) : v(id); }
function qvf(id){ return id in Q ? parseFloat(Q[id]) || 0 : vf(id); }
function qvi(id){ return id in Q ? parseInt(Q[id])   || 0 : vi(id); }

// ── SCHEMA: Single source of truth for event library entry shape ──
// Call this everywhere an entry is created or updated.
// Guarantees every field exists with correct type — no more undefined crashes.
function makeEventEntry(partial, existing){
  const ex = existing || {};
  return {
    // Identity
    id:            ex.id            || partial.id       || ('ev_' + Date.now()),
    label:         partial.label    || ex.label         || 'Untitled event',
    eventDate:     partial.eventDate|| ex.eventDate     || '',
    eventType:     partial.eventType|| ex.eventType     || window._selectedEventType || null,
    // Counts
    guestCount:    partial.guestCount   || ex.guestCount    || 50,
    cocktailCount: partial.cocktailCount|| ex.cocktailCount || 0,
    // Status
    status:        partial.status   || ex.status        || 'draft',
    savedAt:       partial.savedAt  || new Date().toISOString(),
    // Financial
    totalQuoted:   partial.totalQuoted  || ex.totalQuoted   || 0,
    // Full state snapshot
    state:         partial.state    || ex.state         || null,
    // Version history
    stateHistory:  ex.stateHistory  || [],
    // Quote / invoice documents
    quoteSnapshot:   ex.quoteSnapshot   || null,
    quoteSentAt:     ex.quoteSentAt     || null,
    quoteHistory:    ex.quoteHistory    || [],
    invoiceSnapshot: ex.invoiceSnapshot || null,
    invoiceFinalAt:  ex.invoiceFinalAt  || null,
    invoiceSentAt:   ex.invoiceSentAt   || null,
    invoiceTotal:    ex.invoiceTotal    || null,
    // Payment
    depositPaid:     ex.depositPaid     || null,
    paymentStatus:   ex.paymentStatus   || 'unpaid',
    depositAmount:   ex.depositAmount   || null,
    depositDate:     ex.depositDate     || null,
    paidAmount:      ex.paidAmount      || null,
    paidDate:        ex.paidDate        || null,
    paymentMethod:   ex.paymentMethod   || null,
    proofOfPayment:  ex.proofOfPayment  || null,
    paidAt:          ex.paidAt          || null,
  };
}

// ═══════════════════════════════════════════════════════════
function getPairState(){
  return {
    p1name:v('p1name'),p1drink:v('p1drink'),p1desc:v('p1desc'),p1dpg:vf('p1dpg'),p1link:v('p1link'),
    p2name:v('p2name'),p2drink:v('p2drink'),p2desc:v('p2desc'),p2dpg:vf('p2dpg'),p2link:v('p2link'),
    pEventName:v('pEventName')
  };
}
function applyPairState(p){
  if(!p)return;
  ['p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>{
    sv(id, p[id]!==undefined ? p[id] : v(id));
  });
  if(p.p1dpg)sv('p1dpg',p.p1dpg);
  if(p.p2dpg)sv('p2dpg',p.p2dpg);
  populatePairLinks();
  if(p.p1link!==undefined)sv('p1link',p.p1link);
  if(p.p2link!==undefined)sv('p2link',p.p2link);
  rPairs();
}
function getState(){
  return {version:2,exportedAt:new Date().toISOString(),eventLabel:qv('eventLabel'),quoteStatus:qv('quoteStatus')||'draft',guestCount:qvi('gc'),staff:staffList.map(s=>({...s})),receiptCount:receipts.length,totalSpent:receipts.reduce((s,r)=>s+r.total,0),postEvent:{data:postEventData,notes:v('postEventNotes')},
    consumptionModel:{eventHrs:qvf('eventHrs'),drinksPerPerson:qvf('drinksPerPerson'),bufferPct:qvf('bufferPct')},
    cocktails,pair:getPairState(),
    quote:{clientName:qv('cn'),eventDate:qv('ed'),guestCount:qvi('gc'),hoursOfService:qvf('eventHrs'),hourlyRateCAD:qvf('hr'),discountAmt:qvf('discountAmt'),discountPct:qvf('discountPct'),markupPct:qvf('mp'),travelSetupCAD:qvf('tf'),notes:qv('qn')}};
}
function applyState(s){
  menuEventActive = true; // any state apply means we have an active event
  if(!s){ Logger.error('applyState: null state'); return; }
  if(s.version && s.version < 1){ Logger.error('applyState: unsupported version', {version:s.version}); return; }
  sv('eventLabel',s.eventLabel||'');
  sv('quoteStatus',s.quoteStatus||'draft');
  updateStatusBadge();
  cocktails=s.cocktails||[];
  const q=s.quote||{};
  sv('cn',q.clientName||q.cn||'');
  sv('ed',q.eventDate||q.ed||'');
  sv('gc',q.guestCount||q.qg2||50);
  sv('eventHrs',q.hoursOfService||q.sh||4);
  sv('hr',q.hourlyRateCAD||q.hr||100);
  sv('mp',q.markupPct||q.mp||35);
  sv('tf',q.travelSetupCAD||q.tf||0);
  sv('discountAmt',q.discountAmt||0);
  sv('discountPct',q.discountPct||0);
  sv('qn',q.notes||q.qn||'');
  sv('gc',s.guestCount||50);
  if(s.consumptionModel){
    const cm=s.consumptionModel;
    if(cm.eventHrs)sv('eventHrs',cm.eventHrs);
    // Support both old drinkRate format and new drinksPerPerson
    if(cm.drinksPerPerson!==undefined) sv('drinksPerPerson',cm.drinksPerPerson);
    else if(cm.drinkRate!==undefined){
      // Migrate: old format stored drinks/hr/guest — convert to total per person
      // Assume 4hr event as default for migration
      const hrs = cm.eventHrs || 4;
      sv('drinksPerPerson', Math.round(cm.drinkRate * hrs));
    }
    if(cm.bufferPct!==undefined)sv('bufferPct',cm.bufferPct);
    // nonDrinkerPct removed — he quotes for all guests drinking
  }
  staffList = (s.staff || []).map(st=>({...st}));
  renderStaff();
  if(s.postEvent){
    postEventData = s.postEvent.data || {};
    sv('postEventNotes', s.postEvent.notes || '');
  }
  syncSettings();
  rNI();rC();rShop();rQ();
  updateMenuStep();
  if(s.pair)applyPairState(s.pair);
  renderMyLibrarySection();
  renderRecipeLibrary();
  updateStatusBadge();
  updateMpEquiv();
  renderShoppingDeadline();
  flashSaved();
}
// ── DUPLICATE EVENT ──────────────────────────────────────
function dupeEvent(){
  const lbl = v('eventLabel');
  const newLbl = (lbl ? lbl + ' (copy)' : 'Copy of event');
  sv('eventLabel',newLbl);
  // Reset deposit and mark unsaved — everything else stays
  sv('depositAmt',0);
  const depEl = document.getElementById('depositStatus');
  if(depEl) depEl.textContent = '';
  markUnsaved();
  rQ();
  alert('Event duplicated as "' + newLbl + '". Update the client name, date, and deposit before saving.');
}
// ═══ TOAST NOTIFICATIONS ═══

function showToast(msg, type) {
  const existing = el('toastMsg');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'toastMsg';
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:500;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.15);max-width:90vw;text-align:center;';
  t.style.background = type === 'success' ? '#1a7a4a' : '#c0392b';
  t.style.color = '#fff';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// ═══ CUSTOM INGREDIENT DATABASE ═══
// myIngredients, bottle conversion, cost calculation, CRUD,
// quick ingredient modal, inline bottle calculator

// ── CUSTOM INGREDIENT DATABASE ────────────────────────────
// Stored in localStorage so it persists across sessions without needing a server
let myIngredients = [];
let mydbCostManualOverride = false;

// Conversion table for bottle sizes to the selected cost unit
function convertBottleSize(size, fromUnit, toUnit){
  // Convert everything to ml first
  let ml = size;
  if(fromUnit === 'oz') ml = size * 29.5735;
  else if(fromUnit === 'L') ml = size * 1000;
  else if(fromUnit === 'cl') ml = size * 10;
  // ml to target unit
  if(toUnit === 'oz') return ml / 29.5735;
  if(toUnit === 'L') return ml / 1000;
  if(toUnit === 'cl') return ml / 10;
  if(toUnit === 'ml') return ml;
  if(toUnit === 'tsp') return ml / 4.929;
  if(toUnit === 'tbsp') return ml / 14.787;
  // For piece/leaves/dashes/pinch — can't auto-convert, return size as-is
  return size;
}

function calcMyDBCostPerUnit(){
  if(mydbCostManualOverride) return;
  const bottleSize = parseFloat(v('mydbBottleSize')) || 0;
  const sizeUnit = v('mydbSizeUnit') || 'ml';
  const bottlePrice = parseFloat(v('mydbBottlePrice')) || 0;
  const costUnit = v('mydbUnit') || 'oz';
  const preview = el('mydbCostPreview');

  if(bottleSize <= 0 || bottlePrice <= 0){
    sv('mydbCost', '0');
    if(preview) preview.textContent = '';
    return;
  }
  const sizeInCostUnit = convertBottleSize(bottleSize, sizeUnit, costUnit);
  if(sizeInCostUnit <= 0){
    if(preview) preview.textContent = '';
    return;
  }
  const costPerUnit = bottlePrice / sizeInCostUnit;
  sv('mydbCost', costPerUnit.toFixed(4));

  if(preview){
    preview.innerHTML = '$' + bottlePrice.toFixed(2) + ' / ' + bottleSize + sizeUnit
      + ' = <strong>$' + costPerUnit.toFixed(4) + '/' + costUnit + '</strong>'
      + ' <span style="color:#aaa;">(' + sizeInCostUnit.toFixed(1) + ' ' + costUnit + ' per bottle)</span>';
  }
}

function loadMyDB(){
  try {
    const stored = localStorage.getItem('bartender_mydb_v1');
    if(stored) myIngredients = JSON.parse(stored);
  } catch(e){ myIngredients = []; }
  // Inject into INGFLAT so they appear in autocomplete
  syncMyDBtoFlat();
}

function saveMyDB(){
  try { localStorage.setItem('bartender_mydb_v1', JSON.stringify(myIngredients)); }
  catch(e){ alert('Could not save to local storage. Try clearing browser data.'); }
}

function syncMyDBtoFlat(){
  // Remove old custom entries from INGFLAT
  const toRemove = INGFLAT.filter(i => i._custom);
  toRemove.forEach(i => INGFLAT.splice(INGFLAT.indexOf(i), 1));
  // Add current custom entries
  myIngredients.forEach(ing => {
    INGFLAT.unshift({...ing, _custom: true}); // unshift so they appear first in search
  });
}

function addMyIngredient(){
  const name = v('mydbName').trim();
  const unit = v('mydbUnit') || 'oz';
  const cost = parseFloat(v('mydbCost')) || 0;
  const note = v('mydbNote').trim();
  const retailer = v('mydbRetailer') || '';
  const cat  = v('mydbCat') || '🏠 My custom ingredients';
  const bottleSize = parseFloat(v('mydbBottleSize')) || 0;
  const sizeUnit = v('mydbSizeUnit') || 'ml';
  const bottlePrice = parseFloat(v('mydbBottlePrice')) || 0;

  if(!name){ alert('Please enter an ingredient name.'); return; }
  if(cost <= 0 && bottlePrice <= 0){ alert('Enter either the bottle price or a cost per unit.'); return; }

  const entry = {
    name, unit, c: cost,
    note: note || (bottlePrice > 0 ? '$' + bottlePrice.toFixed(2) + '/' + bottleSize + sizeUnit : ''),
    retailer,
    cat,
    bottleSize: bottleSize || null,
    bottleSizeUnit: sizeUnit,
    bottlePrice: bottlePrice || null,
    addedAt: new Date().toISOString()
  };

  const exists = myIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
  if(exists){
    if(!confirm('"' + name + '" already exists in your database. Update it?')) return;
    Object.assign(exists, entry);
  } else {
    myIngredients.push(entry);
  }
  saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  sv('mydbName',''); sv('mydbCost','0'); sv('mydbNote',''); sv('mydbRetailer','');
  sv('mydbBottleSize',''); sv('mydbBottlePrice','');
  mydbCostManualOverride = false;
  const preview = el('mydbCostPreview');
  if(preview) preview.textContent = '';
  const btn = document.querySelector('#mydbForm .btn-primary');
  if(btn){ const o=btn.textContent; btn.textContent='✓ Saved!'; btn.style.background='#1a7a4a'; setTimeout(()=>{btn.textContent=o;btn.style.background='';},1800); }
}

function removeMyIngredient(idx){
  const removed = myIngredients[idx];
  if(!removed) return;
  if(!confirm('Remove "' + removed.name + '" from your database?')) return;
  myIngredients.splice(idx, 1);
  saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  pushUndo('Removed ingredient "' + removed.name + '"', () => {
    myIngredients.splice(idx, 0, removed);
    saveMyDB(); syncMyDBtoFlat(); renderMyDB();
  });
}

function editMyIngredient(idx){
  const ing = myIngredients[idx];
  sv('mydbName',ing.name);
  sv('mydbUnit',ing.unit);
  sv('mydbCost',ing.c);
  sv('mydbNote',ing.note||'');
  sv('mydbRetailer',ing.retailer||'');
  sv('mydbCat',ing.cat||'🏠 My custom ingredients');
  // Remove and let them re-add (effectively an edit)
  myIngredients.splice(idx, 1);
  saveMyDB();
  syncMyDBtoFlat();
  renderMyDB();
  document.getElementById('mydbName').focus();
}

function updateMyIngredientCost(idx, val){
  myIngredients[idx].c = parseFloat(val) || 0;
  saveMyDB();
  syncMyDBtoFlat();
}

function renderMyDB(){
  const el = el2('mydbList');
  if(!el)return;
  if(!myIngredients.length){
    el.innerHTML = '<div class="empty" style="padding:2rem;text-align:center;color:#aaa;font-size:14px;">No custom ingredients yet — add one above</div>';
    return;
  }
  // Group by category
  const groups = {};
  myIngredients.forEach((ing, idx) => {
    const cat = ing.cat || '🏠 My custom ingredients';
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push({ing, idx});
  });

  el.innerHTML = Object.entries(groups).map(([cat, items]) => {
    const headerRow = '<div style="display:grid;grid-template-columns:2fr 0.7fr 1.1fr 1.5fr auto;gap:8px;padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:#aaa;border-bottom:1px solid #f0f0eb;background:#fafaf7;">'
      + '<span>Name</span><span>Unit</span><span>CAD$/unit</span><span>Notes / where to buy</span><span></span></div>';
    const itemRows = items.map(({ing, idx}) => {
      const bottleLabel = (ing.bottlePrice && ing.bottleSize)
        ? '<div style="font-size:10px;color:#1a7a4a;margin-top:2px;">$' + parseFloat(ing.bottlePrice).toFixed(2) + '/' + ing.bottleSize + (ing.bottleSizeUnit||'ml') + '</div>'
        : '';
      const retailerBadge = ing.retailer
        ? '<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:#e8f0fd;color:#2156b8;margin-left:4px;">' + ing.retailer + '</span>'
        : '';
      return '<div style="display:grid;grid-template-columns:2fr 0.7fr 1.1fr 1.5fr auto;gap:8px;padding:9px 12px;font-size:13px;border-bottom:1px solid #f5f5f0;align-items:center;">'
        + '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:2px;"><span style="font-weight:500;">' + ing.name + '</span>' + retailerBadge + bottleLabel + '</div>'
        + '<span style="color:#888;">' + ing.unit + '</span>'
        + '<span style="display:flex;flex-direction:column;gap:1px;">'
        + '<input type="number" value="' + (typeof ing.c === 'number' ? ing.c.toFixed(4) : Number(ing.c).toFixed(4)) + '" min="0" step="0.0001" style="width:90px;font-size:13px;" data-idx="' + idx + '" onchange="updateMyIngredientCost(parseInt(this.dataset.idx),this.value)">'
        + '<span style="font-size:10px;color:#aaa;">per ' + ing.unit + '</span>'
        + '</span>'
        + '<span style="font-size:12px;color:#aaa;">' + (ing.note||'—') + '</span>'
        + '<span style="display:flex;gap:4px;">'
        + '<button class="btn btn-sm" data-idx="' + idx + '" onclick="editMyIngredient(parseInt(this.dataset.idx))" title="Edit">✎</button>'
        + '<button class="btn btn-sm btn-danger" data-idx="' + idx + '" onclick="removeMyIngredient(parseInt(this.dataset.idx))" title="Remove">✕</button>'
        + '</span></div>';
    }).join('');
    return '<div style="margin-bottom:1rem;">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#aaa;padding:6px 0 4px;">' + cat + '</div>'
      + '<div style="border:1px solid #e5e5e0;border-radius:10px;overflow:hidden;background:#fff;">'
      + headerRow + itemRows + '</div></div>';
  }).join('');
}

function exportMyDB(){
  if(!myIngredients.length){ alert('No custom ingredients to export yet.'); return; }
  const payload = {schema:'bartender_mydb_v1', exportedAt: new Date().toISOString(), ingredients: myIngredients};
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'}));
  a.download = 'my_ingredient_database.json';
  a.click();
}

function importMyDB(e){
  const file = e.target.files[0]; if(!file) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const data = JSON.parse(ev.target.result);
      const ings = data.ingredients || data; // support both wrapped and bare array
      if(!Array.isArray(ings)) throw new Error('Invalid format');
      const added = [];
      ings.forEach(ing => {
        if(!ing.name) return;
        const exists = myIngredients.find(i => i.name.toLowerCase() === ing.name.toLowerCase());
        if(!exists){ myIngredients.push(ing); added.push(ing.name); }
      });
      saveMyDB(); syncMyDBtoFlat(); renderMyDB();
      alert(`Imported ${added.length} ingredient${added.length!==1?'s':''} successfully.`);
    } catch(err){ alert("Could not read file — make sure it's a valid ingredient database export."); }
  };
  r.readAsText(file);
  e.target.value = '';
}

// Also allow saving a price looked up from AI directly into custom DB
function doSaveFromLookup(btn){
  const key = btn.dataset.tmpkey;
  const d = window._priceLookupTemp && window._priceLookupTemp[key];
  if(!d){ btn.textContent='Not found'; return; }
  saveToMyDB(d.name, d.unit, d.cost, d.note);
  btn.textContent = String.fromCharCode(10003)+' Saved'; // ✓ without literal special char
  btn.disabled = true;
  btn.style.background = '#1a7a4a';
  btn.style.color = '#fff';
}

function saveToMyDB(ingredientName, unit, cost, note){
  const exists = myIngredients.find(i => i.name.toLowerCase() === ingredientName.toLowerCase());
  if(exists){
    exists.c = cost;
    exists.note = note;
  } else {
    myIngredients.push({name:ingredientName, unit, c:cost, note, cat:'🏠 My custom ingredients', addedAt:new Date().toISOString()});
  }
  saveMyDB(); syncMyDBtoFlat();
}

let quickIngTargetRow = null; // which ingredient row to update after save

function openQuickIngModal(){
  openQuickIngModalWithName('', null);
}

function openQuickIngModalWithName(name, rowIdx){
  quickIngTargetRow = rowIdx;
  sv('qiName', name||'');
  sv('qiBottleSize',''); sv('qiPrice',''); sv('qiCost','0'); sv('qiNote','');
  sv('qiRetailer','');
  gc2('qiPreview','');
  // Close the ingredient dropdown first
  document.querySelectorAll('.ing-dropdown').forEach(d => d.classList.remove('open'));
  el('quickIngModalBg').classList.add('open');
  setTimeout(()=>{
    const n = el('qiName');
    if(n){
      n.focus();
      // Move cursor to end
      n.setSelectionRange(n.value.length, n.value.length);
    }
  }, 100);
}
function closeQuickIngModal(){ el('quickIngModalBg').classList.remove('open'); }

function calcQIcost(){
  const size = parseFloat(v('qiBottleSize'))||0;
  const sizeUnit = v('qiSizeUnit')||'ml';
  const price = parseFloat(v('qiPrice'))||0;
  const unit = v('qiUnit')||'oz';
  if(size > 0 && price > 0){
    const inUnit = convertBottleSize(size, sizeUnit, unit);
    const cpu = inUnit > 0 ? price/inUnit : 0;
    sv('qiCost', cpu.toFixed(4));
    gc2('qiPreview', '$' + price.toFixed(2) + '/' + size + sizeUnit + ' = $' + cpu.toFixed(4) + '/' + unit + ' (' + inUnit.toFixed(1) + ' ' + unit + '/bottle)');
  }
}

function saveQuickIngredient(){
  const name = v('qiName').trim();
  if(!name){ alert('Enter a name.'); return; }
  const cost = parseFloat(v('qiCost'))||0;
  const unit = v('qiUnit')||'oz';
  if(cost <= 0){ alert('Enter a bottle price or cost per unit.'); return; }

  const entry = {
    name, unit, c: cost,
    note: v('qiNote').trim() || (v('qiPrice') && v('qiBottleSize') ? '$'+parseFloat(v('qiPrice')).toFixed(2)+'/'+v('qiBottleSize')+(v('qiSizeUnit')||'ml') : ''),
    retailer: v('qiRetailer') || '',
    cat: '🏠 My custom ingredients',
    bottleSize: parseFloat(v('qiBottleSize'))||null,
    bottleSizeUnit: v('qiSizeUnit')||'ml',
    bottlePrice: parseFloat(v('qiPrice'))||null,
    addedAt: new Date().toISOString()
  };
  const exists = myIngredients.find(i => i.name.toLowerCase() === name.toLowerCase());
  if(exists){ Object.assign(exists, entry); }
  else { myIngredients.push(entry); }
  saveMyDB();
  syncMyDBtoFlat();
  closeQuickIngModal();
  // If opened from a specific ingredient row, auto-fill that row
  if(quickIngTargetRow !== null){
    const rowIdx = quickIngTargetRow;
    quickIngTargetRow = null;
    const targetIng = nIng[rowIdx];
    if(targetIng){
      targetIng.n = entry.name;
      targetIng.u = entry.unit;
      targetIng.c = entry.c;
      rNI();
      rC(); rShop(); rQ();
    }
    return;
  }
  quickIngTargetRow = null;
  // Auto-add to current recipe being built
  addIR({n: name, q: 1, u: unit, c: cost});
  showToast('⭐ ' + name + ' added to your database and recipe', 'success');
}

// ── INLINE BOTTLE PRICE CALCULATOR FOR RECIPE INGREDIENTS ──
function toggleBottleCalc(btn, gid, idx){
  const wrap = document.getElementById('bcalc_' + gid);
  if(!wrap) return;
  const open = wrap.style.display === 'none' || !wrap.style.display;
  wrap.style.display = open ? 'block' : 'none';
  btn.style.color = open ? '#1a7a4a' : 'var(--color-text-secondary)';
}

function calcIngBottle(gid, idx){
  const price = parseFloat((document.getElementById('bprice_' + gid)||{}).value)||0;
  const size  = parseFloat((document.getElementById('bsize_' + gid)||{}).value)||0;
  const sunit = (document.getElementById('bsunit_' + gid)||{}).value||'ml';
  const g = nIng[parseInt(idx)];
  if(!g || price <= 0 || size <= 0) return;
  const costUnit = g.u || 'oz';
  const sizeInUnit = convertBottleSize(size, sunit, costUnit);
  if(sizeInUnit <= 0) return;
  const cpu = price / sizeInUnit;
  g.c = parseFloat(cpu.toFixed(4));
  const costEl = document.getElementById('lcost_' + gid);
  if(costEl) costEl.value = cpu.toFixed(4);
  const srcEl = document.getElementById('lsrc_' + gid);
  if(srcEl) srcEl.textContent = '$' + price.toFixed(2) + '/' + size + sunit + ' = $' + cpu.toFixed(4) + '/' + costUnit;
  markUnsaved();
}

// ════════════════════════════════════════════════════════════
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

// ═══ EVENT MANAGEMENT ═══
// Event categories, presets, creation flow, menu step management,
// event library CRUD, status tracking, save/load

const STATUS_CONFIG = {
  draft:     { label:'📝 Draft',     color:'#888',    bg:'#f5f5f0' },
  sent:      { label:'📤 Sent',      color:'#2156b8', bg:'#e8f0fd' },
  confirmed: { label:'✅ Confirmed', color:'#1a7a4a', bg:'#edfaf3' },
  completed: { label:'🎉 Completed', color:'#1a7a4a', bg:'#d4f5e4' },
  cancelled: { label:'❌ Cancelled', color:'#c0392b', bg:'#fdf0ef' },
  rejected:  { label:'🚫 Rejected',  color:'#888',    bg:'#f5f5f0' }
};

function getStatusConfig(status){
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
}

function updateStatusBadge(){
  const status = v('quoteStatus') || 'draft';
  const cfg = getStatusConfig(status);
  const badge = el('statusBadge');
  if(badge){
    badge.textContent = cfg.label;
    badge.style.background = cfg.bg;
    badge.style.color = cfg.color;
    badge.style.display = status !== 'draft' ? '' : 'none'; // hide when draft (default)
  }
}

function renderEventsTab(){
  const filterStatus = v('evFilterStatus') || 'all';
  const query = (v('evlibSearch') || '').toLowerCase().trim();

  const filtered = eventLibrary.filter(e => {
    const matchStatus = filterStatus === 'all' || (e.status || 'draft') === filterStatus;
    const matchQuery = !query ||
      (e.label || '').toLowerCase().includes(query) ||
      (e.eventDate || '').includes(query);
    return matchStatus && matchQuery;
  });

  // Status metrics
  const counts = {};
  eventLibrary.forEach(e => {
    const s = e.status || 'draft';
    counts[s] = (counts[s] || 0) + 1;
  });
  const confirmedRevenue = eventLibrary
    .filter(e => (e.status||'draft') === 'confirmed' || (e.status||'draft') === 'completed')
    .reduce((s,e) => s + (e.quotedTotal || 0), 0);

  shtml('evStatusMetrics', `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:1rem;">
      ${Object.entries(STATUS_CONFIG).map(([k,cfg]) => `
        <div style="text-align:center;padding:8px;border-radius:8px;background:${cfg.bg};cursor:pointer;"
          onclick="sv('evFilterStatus','${k}');renderEventsTab()">
          <div style="font-size:18px;margin-bottom:2px;">${counts[k]||0}</div>
          <div style="font-size:10px;color:${cfg.color};font-weight:500;">${cfg.label.replace(/^[^ ]+ /,'')}</div>
        </div>`).join('')}
    </div>
    ${confirmedRevenue > 0 ? `<div style="font-size:13px;background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;color:#1a7a4a;margin-bottom:1rem;">
      ✅ Confirmed pipeline: <strong>$${confirmedRevenue.toFixed(2)} CAD</strong> across ${(counts.confirmed||0)+(counts.completed||0)} event(s)
    </div>` : ''}`);

  // Multi-event shopping banner (confirmed events only)
  const confirmedEvents = eventLibrary.filter(e => (e.status||'draft') === 'confirmed');
  if(confirmedEvents.length > 1){
    shtml('multiShopBanner', `
      <div style="background:#e8f0fd;border:1px solid #b5d4f4;border-radius:10px;padding:10px 14px;">
        <div style="font-size:13px;font-weight:600;color:#2156b8;margin-bottom:4px;">
          🛒 ${confirmedEvents.length} confirmed events — combine shopping lists?
        </div>
        <div style="font-size:12px;color:#2156b8;margin-bottom:8px;">
          ${confirmedEvents.map(e => e.label).join(' + ')} — reduce shopping trips by buying for all at once.
        </div>
        <div id="combinedDeadlineLine" style="font-size:12px;color:#2156b8;margin-bottom:8px;font-weight:500;"></div>
        <button class="btn btn-sm" onclick="exportCombinedShoppingList()" style="font-size:12px;background:#fff;border-color:#b5d4f4;color:#2156b8;">
          📱 Export combined shopping list
        </button>
      </div>`);
    el('multiShopBanner').style.display = 'block';
  } else {
    shtml('multiShopBanner', '');
    const b = el('multiShopBanner');
    if(b) b.style.display = 'none';
  }

  if(!eventLibrary.length){
    shtml('eventsTabList', '<div class="empty" style="padding:2rem;text-align:center;color:#aaa;">No saved events yet — build an event and click 💾 Save event to add it here.</div>');
    return;
  }
  if(!filtered.length){
    shtml('eventsTabList', '<div style="padding:1.5rem;text-align:center;color:#aaa;font-size:13px;">No events match that filter.</div>');
    return;
  }

  renderShoppingDeadline();
  shtml('eventsTabList', filtered.map(e => {
    const cfg = getStatusConfig(e.status || 'draft');
    const dateStr = e.eventDate
      ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('en-CA',{month:'short',day:'numeric',year:'numeric'})
      : '—';
    const savedStr = new Date(e.savedAt).toLocaleDateString('en-CA',{month:'short',day:'numeric'});
    const isActive = v('eventLabel') === e.label;
    return `<div style="border:${isActive?'2px solid #1a7a4a':'1px solid #e5e5e0'};border-radius:10px;background:${isActive?'#f0faf5':'#fff'};padding:12px 14px;margin-bottom:8px;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:start;">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
          <span style="font-weight:600;font-size:14px;">${e.label}</span>
          <span style="font-size:11px;padding:2px 8px;border-radius:20px;font-weight:500;background:${cfg.bg};color:${cfg.color};">${cfg.label}</span>
          ${isActive ? '<span style="font-size:10px;background:#1a7a4a;color:#fff;padding:2px 7px;border-radius:20px;">current</span>' : ''}
        </div>
        <div style="font-size:12px;color:#aaa;">${dateStr} · ${e.guests||'—'} guests · ${e.cocktailCount||0} cocktails${e.quotedTotal?' · $'+e.quotedTotal.toFixed(2)+' CAD':''} · saved ${savedStr}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:5px;min-width:100px;">
        <select onchange="updateEventStatus('${e.id}',this.value)" style="font-size:11px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;">
          ${Object.entries(STATUS_CONFIG).map(([k,sc]) => `<option value="${k}"${(e.status||'draft')===k?' selected':''}>${sc.label}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-primary" data-id="${e.id}" onclick="loadEventFromLibrary(this.dataset.id)" style="font-size:11px;">Load</button>
        <button class="btn btn-sm btn-danger" data-id="${e.id}" onclick="deleteEventFromLibrary(this.dataset.id)" style="font-size:11px;">✕ Delete</button>
      </div>
    </div>`;
  }).join(''));
}

// updateEventStatus — defined later in this file (full version with toast + state sync)

const DEFAULT_CATEGORIES = [
  {
    id: 'wedding', name: 'Wedding', icon: '💑',
    desc: 'Full reception bar service — custom cocktail menu, His & Hers',
    defaults: { gc:100, eventHrs:5, drinksPerPerson:6, bufferPct:0, hr:120, mp:50, tf:75 },
    notes: 'Includes full bar setup/breakdown, custom cocktail menu, all equipment and garnishes.'
  },
  {
    id: 'cocktail_hour', name: 'Cocktail hour', icon: '🥂',
    desc: 'Pre-dinner drinks service — shorter, lighter menu',
    defaults: { gc:60, eventHrs:2, drinksPerPerson:3, bufferPct:0, hr:100, mp:45, tf:50 },
    notes: 'Cocktail hour service — setup, 2hr service, and breakdown included.'
  },
  {
    id: 'corporate', name: 'Corporate event', icon: '🏢',
    desc: 'Corporate cocktail party or end-of-year celebration',
    defaults: { gc:80, eventHrs:3, drinksPerPerson:4, bufferPct:0, hr:110, mp:45, tf:60 },
    notes: 'Corporate bar service — professional setup, cocktail menu as quoted.'
  },
  {
    id: 'birthday', name: 'Birthday / private party', icon: '🎂',
    desc: 'Private home or venue party',
    defaults: { gc:40, eventHrs:4, drinksPerPerson:5, bufferPct:0, hr:100, mp:40, tf:40 },
    notes: 'Private event bar service — all equipment and supplies included.'
  },
  {
    id: 'flair_show', name: 'Flair show + bar', icon: '🔥',
    desc: 'Premium flair bartending performance with full bar',
    defaults: { gc:75, eventHrs:3, drinksPerPerson:4, bufferPct:0, hr:150, mp:60, tf:75 },
    notes: 'Premium flair bartending service — custom show, full bar, all equipment.'
  },
  {
    id: 'brunch', name: 'Brunch / daytime', icon: '🍊',
    desc: 'Brunch cocktails, mimosas, Bloody Marys — lighter spirits',
    defaults: { gc:30, eventHrs:2, drinksPerPerson:3, bufferPct:0, hr:90, mp:40, tf:30 },
    notes: 'Brunch bar service — fresh juices, light cocktails, all supplies included.'
  }
];

// User-customizable categories stored in localStorage
let eventCategories = [];

function loadEventCategories(){
  try {
    const stored = localStorage.getItem('bartender_categories_v1');
    if(stored) eventCategories = JSON.parse(stored);
    else eventCategories = DEFAULT_CATEGORIES.map(c => ({...c})); // seed from defaults
  } catch(e){ eventCategories = DEFAULT_CATEGORIES.map(c => ({...c})); }
}

function saveEventCategories(){
  try { localStorage.setItem('bartender_categories_v1', JSON.stringify(eventCategories)); }
  catch(e){}
}

function openNewEventDialog(){
  cnManuallyEdited = false;
  renderCategoryPicker();
  // Clear name input and focus it
  const inp = el('newEvName');
  if(inp){ inp.value = ''; }
  el('newEventModalBg').classList.add('open');
  setTimeout(() => { if(inp) inp.focus(); }, 150);
}

function showBufferExplainer(e){
  if(e) e.stopPropagation();
  const pct = vf('bufferPct') || 0;
  const dpp = vf('drinksPerPerson') || 5;
  const guests = vi('gc') || 50;
  const base = dpp * guests;
  const extra = Math.round(base * pct / 100);
  const total = base + extra;
  showToast(
    pct + '% buffer = ' + extra + ' extra drinks on top of ' + base + ' base → ' + total + ' total. Covers spillage, generous pours & last-minute guests.',
    'success'
  );
}


const EVENT_PRESETS = {
  wedding_large:   { label:'Wedding', guests:120, hrs:7, rate:110, margin:65, travel:80,  dpg:6, buffer:10, notes:'Includes cocktail hour, dinner service, late night bar' },
  wedding_small:   { label:'Wedding', guests:45,  hrs:6, rate:100, margin:60, travel:60,  dpg:5, buffer:10, notes:'Intimate ceremony and reception' },
  corporate:       { label:'Corporate event', guests:80, hrs:4, rate:100, margin:60, travel:60, dpg:3, buffer:5,  notes:'Professional service, non-alcoholic options required' },
  birthday:        { label:'Birthday party', guests:40, hrs:5, rate:90,  margin:55, travel:40, dpg:5, buffer:8,  notes:'Signature cocktail + classics' },
  bachelorette:    { label:'Bachelorette', guests:15, hrs:4, rate:85,  margin:55, travel:40, dpg:6, buffer:5,  notes:'Customized cocktail experience' },
  pop_up:          { label:'Pop-up bar', guests:150,hrs:6, rate:100, margin:65, travel:0,  dpg:2, buffer:15, notes:'High volume, fast service' },
  private:         { label:'Private party', guests:30, hrs:4, rate:90,  margin:55, travel:40, dpg:4, buffer:5,  notes:'' },
};
let selectedPreset = null;

function confirmNewEvent(){
  const name = (el('newEvName') ? el('newEvName').value.trim() : '') || 'New event';

  // ── Always save current event first (even if no cocktails yet) ──
  const currentLabel = v('eventLabel');
  if(currentLabel && currentLabel.trim() && currentLabel !== 'Untitled event'){
    saveEventToLibrary(true); // silent save
  }

  // ── Reset currentEventId so new event gets a fresh ID ──
  currentEventId = null;

  // ── Reset to blank state ──
  cocktails = [];
  nIng = [];
  staffList = [];
  sv('eventLabel', name);
  sv('quoteStatus', 'draft');
  sv('cn', '');
  sv('ed', '');
  // Apply preset if selected, otherwise use defaults
  const _p = selectedPreset ? (EVENT_PRESETS[selectedPreset]||{}) : {};
  sv('gc',           String(_p.guests     || 50));
  sv('eventHrs',     String(_p.hrs        || 4));
  sv('hr',           String(_p.rate       || 100));
  sv('mp',           String(_p.margin     || 35));
  sv('tf',           String(_p.travel     || 0));
  sv('drinksPerPerson', String(_p.dpg     || 5));
  sv('bufferPct',    String(_p.buffer     || 0));
  sv('discountAmt',  '0');
  sv('discountPct',  '0');
  sv('depositAmt',   '0');
  sv('qn',           _p.notes || '');
  selectedPreset = null; // reset for next time
  cnManuallyEdited = false;
  closeNewEventDialog();
  syncSettings();
  rC(); rNI(); rShop(); rQ();
  updateStatusBadge();
  updateMpEquiv();

  // ── Save new event immediately as draft ──
  saveEventToLibrary(true); // sets currentEventId

  // ── Update lastSavedState so no false unsaved-changes warning ──
  if(typeof getSimpleState === 'function') lastSavedState = getSimpleState();

  showToast(name + ' created ✓', 'success');
  // Switch to menu tab and show the type selector (step 1)
  const menuBtn = el('st-menu');
  if(menuBtn) sw('menu', menuBtn);
  // Pre-fill name field in inline selector
  const menuName = el('menuEvName');
  if(menuName) menuName.value = name;
  // Show step 1 (type selector) directly
  menuEventActive = 'selecting';
  updateMenuStep();
  renderEventLibrary();
}

function selectEventPreset(type, btn){
  selectedPreset = type;
  // Highlight selected button
  el('eventTypePresets').querySelectorAll('.qb').forEach(b => b.classList.remove('active-lib-filter'));
  if(btn) btn.classList.add('active-lib-filter');

  const p = EVENT_PRESETS[type];
  if(!p) return;

  // Update name placeholder
  const nameInp = el('newEvName');
  if(nameInp && !nameInp.value.trim()) nameInp.placeholder = p.label + ' · ' + new Date().getFullYear();

  // Show summary
  const summary = el('presetSummary');
  if(summary){
    summary.style.display = '';
    summary.innerHTML = '📋 <strong>Prefill:</strong> ' + p.guests + ' guests · ' + p.hrs + 'h · $' + p.rate + '/h · ' + p.margin + '% margin'
      + (p.travel > 0 ? ' · $' + p.travel + ' travel' : '')
      + (p.notes ? '<br>📝 ' + p.notes : '');
  }
}

// ── Menu step management ──
function saveAndStartMenu(){
  // ── Sync ALL fields needed by getState() / PDF / save ──

  // From step1 shadow inputs
  const s1gc     = el('s1gc');     if(s1gc     && s1gc.value)     sv('gc',           s1gc.value);
  const s1hrs    = el('s1hrs');    if(s1hrs    && s1hrs.value)    sv('eventHrs',     s1hrs.value);
  const s1rate   = el('s1rate');   if(s1rate   && s1rate.value)   sv('hr',           s1rate.value);
  const s1margin = el('s1margin'); if(s1margin && s1margin.value) sv('mp',           s1margin.value);
  const s1travel = el('s1travel'); if(s1travel && s1travel.value) sv('tf',           s1travel.value);
  const s1client = el('s1client'); if(s1client && s1client.value) sv('cn',           s1client.value);

  // Event name from step1 name input
  const menuEvName = el('menuEvName');
  if(menuEvName && menuEvName.value.trim()) sv('eventLabel', menuEvName.value.trim());

  // Event date from step1 date input
  const menuEvDate = el('menuEvDate');
  if(menuEvDate && menuEvDate.value) sv('ed', menuEvDate.value);

  // Apply preset notes if not already set
  const p = (typeof EVENT_PRESETS !== 'undefined' && window._selectedEventType)
    ? EVENT_PRESETS[window._selectedEventType] : null;
  if(p && p.notes && !v('qn')) sv('qn', p.notes);

  // Ensure defaults for fields getState() / PDF rely on
  if(!v('quoteStatus'))    sv('quoteStatus',    'draft');
  if(!v('drinksPerPerson'))sv('drinksPerPerson', p ? String(p.dpg||5) : '5');
  if(!v('bufferPct'))      sv('bufferPct',       p ? String(p.buffer||0) : '0');
  if(!v('discountAmt'))    sv('discountAmt',     '0');
  if(!v('discountPct'))    sv('discountPct',     '0');
  if(!v('depositAmt'))     sv('depositAmt',      '0');

  syncSettings();

  const _saveResult = ErrorBoundary.wrap(
    function(){ saveEventToLibrary(false); },
    { context: 'saveAndStartMenu', label: qv('eventLabel') }
  );
  if(!_saveResult.ok){
    showToast('Save error: ' + _saveResult.error.message, 'error');
    Logger.error('saveAndStartMenu: save failed', {}, _saveResult.error);
    return;
  }

  // ③ Go through applyState with the saved state — same path as loading a saved event
  // This guarantees DOM fields match saved state, no divergence between new/loaded events
  // Transition to step2 — direct and explicit, no applyState complexity
  menuEventActive = true;
  
  // Hide step1 elements
  const _slot = el('step1SettingsSlot'); if(_slot) _slot.style.display = 'none';
  const _nextBtn = el('menuStep1Next'); if(_nextBtn) _nextBtn.style.display = 'none';
  const _esCard = el('eventSettingsCard'); if(_esCard) _esCard.style.display = 'none';

  // Render step2 content
  syncSettings();
  rC();
  rNI();
  rQ();
  renderMyLibrarySection();
  renderEventLibrary();

  // Show step2
  updateMenuStep();

  Logger.info('saveAndStartMenu: complete', { currentEventId, menuEventActive });
}

function updateMenuStep(){
  const step0 = el('menuStep0');
  const step1 = el('menuStep1');
  const step2 = el('menuStep2');
  if(!step0||!step1||!step2) return;

  // Helper: show/hide shared chrome
  function setChrome(showBack, showActions, showSubs){
    const hbb = el('headerBackBtn');   if(hbb)  hbb.style.display  = showBack    ? '' : 'none';
    const eha = el('eventHeaderActions'); if(eha) eha.style.display = showActions ? 'flex' : 'none';
    const sub = el('subtabs-event');   if(sub)  sub.style.display  = showSubs   ? 'flex' : 'none';
  }

  if(!menuEventActive){
    step0.style.display = ''; step1.style.display = 'none'; step2.style.display = 'none';
    // Force-hide settings card — never show on welcome screen
    const _sc = el('eventSettingsCard'); if(_sc) _sc.style.display = 'none';
    const _sb = el('settingsSaveCTA'); if(_sb) _sb.style.display = 'none';
    const _sl = el('step1SettingsSlot'); if(_sl) _sl.style.display = 'none';
    toggleEventSettings(false);
    setChrome(false, false, false);

  } else if(menuEventActive === 'selecting'){
    step0.style.display = 'none'; step1.style.display = ''; step2.style.display = 'none';
    // Always reset step1 to clean type-picker state when re-entering
    const _sc1 = el('eventSettingsCard'); if(_sc1) _sc1.style.display = 'none';
    const _slot1 = el('step1SettingsSlot'); if(_slot1) _slot1.style.display = 'none';
    const _cta1 = el('settingsSaveCTA'); if(_cta1) _cta1.style.display = 'none';
    const _stBtn1 = el('eventSettingsToggleBtn'); if(_stBtn1) _stBtn1.style.display = '';
    toggleEventSettings(false);
    setChrome(true, false, false);

  } else if(menuEventActive === 'settings'){
    // Show settings card prominently, menu hidden
    step0.style.display = 'none'; step1.style.display = 'none'; step2.style.display = 'none';
    const card = el('eventSettingsCard');
    if(card) card.style.display = '';
    const body = el('eventSettingsBody');
    if(body) body.style.display = 'block';
    const stBtn = el('eventSettingsToggleBtn');
    if(stBtn) stBtn.style.display = 'none'; // hide the collapse toggle in this mode
    // Show a prominent save CTA inside settings card
    const saveRow = el('settingsSaveCTA');
    if(saveRow) saveRow.style.display = '';
    setChrome(true, false, false);
    updateMenuHeader();
    window.scrollTo({top:0, behavior:'smooth'});

  } else {
    // true — active event with menu
    step0.style.display = 'none'; step1.style.display = 'none'; step2.style.display = '';
    const card = el('eventSettingsCard');
    if(card) card.style.display = 'none'; // hidden until user taps ⚙️ Event details
    const stBtn = el('eventSettingsToggleBtn');
    if(stBtn) stBtn.style.display = '';
    const saveRow = el('settingsSaveCTA');
    if(saveRow) saveRow.style.display = 'none';
    setChrome(true, true, true);
    updateMenuHeader();
  }
}

function resetToStep0(){
  // Save current event state before going back
  if(currentEventId && v('eventLabel')) saveEventToLibrary(true);
  menuEventActive = false;
  // Also reset step1 UI so next "Create new event" starts clean
  document.querySelectorAll('#inlineEventTypePresets .qb')
    .forEach(function(b){ b.classList.remove('active-lib-filter'); });
  const slot = el('step1SettingsSlot');
  if(slot) slot.style.display = 'none';
  const nextBtn = el('menuStep1Next');
  if(nextBtn) nextBtn.style.display = 'none';
  const summary = el('inlinePresetSummary');
  if(summary) summary.style.display = 'none';
  const card = el('eventSettingsCard');
  if(card) card.style.display = 'none';
  updateMenuStep();
}

function startFreshEvent(){
  // Reset data
  cocktails = []; nIng = []; staffList = [];
  currentEventId = null;
  window._selectedEventType = null;

  // Reset real settings fields
  sv('eventLabel',''); sv('cn',''); sv('ed','');
  sv('gc','50'); sv('eventHrs','4'); sv('hr','100'); sv('mp','35');
  sv('tf','0'); sv('drinksPerPerson','5'); sv('bufferPct','0');
  sv('discountAmt','0'); sv('discountPct','0'); sv('depositAmt','0'); sv('qn','');

  // Reset step1 UI completely
  document.querySelectorAll('#inlineEventTypePresets .qb')
    .forEach(function(b){ b.classList.remove('active-lib-filter'); });

  const els = {
    inlinePresetSummary: { display:'none' },
    menuStep1Next:       { display:'none' },
    step1SettingsSlot:   { display:'none' },
  };
  Object.keys(els).forEach(function(id){
    const el2 = el(id);
    if(el2) el2.style.display = els[id].display;
  });

  // Reset step1 shadow inputs
  ['s1gc','s1hrs','s1rate','s1margin','s1travel','s1client'].forEach(function(id){
    const inp = el(id); if(inp) inp.value = '';
  });
  const s1preview = el('s1quotePreview');
  if(s1preview) s1preview.innerHTML = '';

  // Reset name/date inputs
  const nameInp = el('menuEvName');
  if(nameInp){ nameInp.value = ''; nameInp.placeholder = 'e.g. Smith Wedding · June 2026'; }
  const dateInp = el('menuEvDate');
  if(dateInp) dateInp.value = '';

  // Hide settings card (it may have been shown from previous event)
  const card = el('eventSettingsCard');
  if(card) card.style.display = 'none';
  const stBtn = el('eventSettingsToggleBtn');
  if(stBtn) stBtn.style.display = '';

  menuEventActive = 'selecting';
  syncSettings(); rC(); rNI(); rQ();
  updateMenuStep();
  setTimeout(function(){ const n=el('menuEvName'); if(n) n.focus(); }, 100);
}

function updateMenuHeader(){
  const title = el('menuEventTitle');
  const meta  = el('menuEventMeta');
  if(title) title.textContent = v('eventLabel') || 'Untitled event';
  if(meta){
    const guests = vi('gc') || 50;
    const date   = v('ed');
    const dateStr = date ? new Date(date+'T12:00:00').toLocaleDateString('fr-CA',{month:'long',day:'numeric',year:'numeric'}) : '';
    meta.textContent = [guests + ' guests', dateStr].filter(Boolean).join(' · ');
  }
}

function applyInlinePreset(type, btn){
  // Highlight button
  document.querySelectorAll('#inlineEventTypePresets .qb').forEach(b => b.classList.remove('active-lib-filter'));
  if(btn) btn.classList.add('active-lib-filter');

  if(type === 'custom'){
    el('inlinePresetSummary').style.display = 'none';
    el('menuStep1Next').style.display = '';
    return;
  }

  const p = (typeof EVENT_PRESETS !== 'undefined' && EVENT_PRESETS[type]) || {};
  if(!p.guests) { el('menuStep1Next').style.display = ''; return; }

  // Apply preset values
  sv('gc',    String(p.guests || 50));
  sv('eventHrs', String(p.hrs || 4));
  sv('hr',    String(p.rate  || 100));
  sv('mp',    String(p.margin|| 35));
  sv('tf',    String(p.travel|| 0));
  sv('drinksPerPerson', String(p.dpg || 5));
  sv('bufferPct', String(p.buffer || 0));
  if(p.notes && !v('qn')) sv('qn', p.notes);

  // Show summary
  const summary = el('inlinePresetSummary');
  if(summary){
    summary.style.display = '';
    summary.innerHTML = '✓ <strong>Prefilled:</strong> '
      + p.guests + ' guests · ' + p.hrs + 'h · $' + p.rate + '/h · ' + p.margin + '% margin'
      + (p.travel > 0 ? ' · $' + p.travel + ' travel' : '')
      + (p.notes ? '<br><span style="color:var(--text3);">📝 Notes added</span>' : '');
  }

  // Prefill event name — always update if value looks like a previous preset
  const nameInp = el('menuEvName');
  if(nameInp){
    const yr = new Date().getFullYear();
    const suggested = p.label + ' · ' + yr;
    const currentVal = nameInp.value.trim();
    // Check if current value is a preset-generated name (matches "Anything · YYYY")
    const isPresetName = !currentVal || /^.+ · \d{4}$/.test(currentVal);
    if(isPresetName) nameInp.value = suggested;
    nameInp.placeholder = suggested;
    // Also show the ✓ Start button
    const nb = el('menuStep1Next');
    if(nb) nb.style.display = '';
  }

  window._selectedEventType = type;
  el('menuStep1Next').style.display = '';
  syncSettings();
}

function showStep1Settings(){
  const name = (el('menuEvName') ? el('menuEvName').value.trim() : '') || 'New event';
  sv('eventLabel', name);
  syncSettings();

  // Fill inline fields from current sv values
  const gc = document.getElementById('gc');
  const hrs = document.getElementById('eventHrs');
  const rate = document.getElementById('hr');
  const margin = document.getElementById('mp');
  const travel = document.getElementById('tf');
  const client = document.getElementById('cn');

  const s1gc = el('s1gc'); if(s1gc) s1gc.value = gc ? gc.value : '50';
  const s1hrs = el('s1hrs'); if(s1hrs) s1hrs.value = hrs ? hrs.value : '4';
  const s1rate = el('s1rate'); if(s1rate) s1rate.value = rate ? rate.value : '100';
  const s1margin = el('s1margin'); if(s1margin){ s1margin.value = margin ? margin.value : '35'; } updateS1MarginInfo();
  const s1travel = el('s1travel'); if(s1travel) s1travel.value = travel ? travel.value : '0';
  const s1client = el('s1client'); if(s1client) s1client.value = client ? client.value : '';

  // Update quote preview
  updateS1QuotePreview();

  // Show slot, hide next button
  const slot = el('step1SettingsSlot');
  if(slot){ slot.style.display = ''; slot.scrollIntoView({behavior:'smooth', block:'start'}); }
  const nextBtn = el('menuStep1Next');
  if(nextBtn) nextBtn.style.display = 'none';
}

function updateS1QuotePreview(){
  const hrs  = parseFloat(el('s1hrs') ? el('s1hrs').value : vi('eventHrs')) || 4;
  const rate = parseFloat(el('s1rate') ? el('s1rate').value : vi('hr')) || 100;
  const travel = parseFloat(el('s1travel') ? el('s1travel').value : vi('tf')) || 0;
  const guests = parseInt(el('s1gc') ? el('s1gc').value : vi('gc')) || 50;
  const labor = hrs * rate;
  const total = labor + travel;
  const perGuest = guests > 0 ? (total/guests).toFixed(0) : '—';
  const prev = el('s1quotePreview');
  if(prev) prev.innerHTML = '<strong>Estimate: $' + total.toFixed(0) + ' CAD</strong> · $' + perGuest + '/guest'
    + '<span style="color:var(--text3);margin-left:8px;">$' + labor.toFixed(0) + ' labor'
    + (travel > 0 ? ' · $' + travel.toFixed(0) + ' travel' : '') + '</span>';
}

function confirmInlineEvent(){
  try {
    const name = (el('menuEvName') ? el('menuEvName').value.trim() : '') || 'New event';
    const date = el('menuEvDate') ? el('menuEvDate').value : '';
    sv('eventLabel', name);
    if(date) sv('ed', date);
    syncSettings();
    rC();
    rQ();
    menuEventActive = 'settings'; // show event details before menu
    updateMenuStep();
  } catch(err){
    console.error('confirmInlineEvent error:', err);
    // Force step 2 even if something errored
    menuEventActive = true;
    updateMenuStep();
  }
}

function closeNewEventDialog(){
  el('newEventModalBg').classList.remove('open');
}

function renderCategoryPicker(){
  const listEl = el('catPickerList');
  if(!listEl) return;
  listEl.innerHTML = eventCategories.map(cat => `
    <div class="cat-card" onclick="startEventFromCategory('${cat.id}')">
      <div style="display:flex;align-items:center;gap:10px;">
        <span style="font-size:24px;">${cat.icon}</span>
        <div style="flex:1;">
          <div class="cat-name">${cat.name}</div>
          <div class="cat-meta">${cat.desc}</div>
          <div class="cat-meta" style="margin-top:3px;">
            ${cat.defaults.gc} guests · ${cat.defaults.eventHrs}h · ${cat.defaults.drinksPerPerson} drinks/person · $${cat.defaults.hr}/hr · ${cat.defaults.mp}% margin
          </div>
        </div>
        <span style="font-size:18px;color:#aaa;">›</span>
      </div>
    </div>`).join('');
}

function startEventFromCategory(catId){
  const cat = eventCategories.find(c => c.id === catId);
  if(!cat) return;
  closeNewEventDialog();
  // Clear current event first
  if(cocktails.length || v('eventLabel')){
    if(!confirm('Start a new ' + cat.name + ' event? Current unsaved changes will be lost.')) return;
  }
  // Reset everything
  cocktails=[]; nIng=[];
  ['eventLabel','cn','ed','qn','nn','p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>sv(id,''));
  ['p1dpg','p2dpg'].forEach(id=>sv(id,1));
  sc('taxEnabled',false);
  rcManualOverride=false;
  staffList=[];
  postEventData={};
  editingCocktailId=null;
  editIngredients=[];

  // Apply category defaults
  const d = cat.defaults;
  sv('gc', d.gc || 50);
  sv('eventHrs', d.eventHrs || 4);
  sv('drinksPerPerson', d.drinksPerPerson || 5);
  sv('bufferPct', d.bufferPct !== undefined ? d.bufferPct : 0);
  sv('hr', d.hr || 100);
  sv('mp', d.mp || 35);
  sv('tf', d.tf || 0);
  sv('depositAmt', 0);
  sv('discountAmt', 0);
  sv('discountPct', 0);
  sv('quoteStatus', 'draft');
  sv('qn', cat.notes || '');

  // Set event label to category name as a starting point
  sv('eventLabel', cat.name);

  updateStatusBadge();
  renderStaff();
  rNI(); rC(); rShop(); rQ();
  syncSettings();
  renderShoppingDeadline();
  showToast(cat.icon + ' ' + cat.name + ' event started — update the client name and date', 'success');
}

// ════════════════════════════════════════════════════════════
function saveQuoteToLibrary(asRevision){
  // Get the rendered HTML from the modal
  const contentEl = el('clientPDFContent');
  const html = contentEl ? contentEl.innerHTML : '';
  if(!html || html.trim().length < 50){
    showToast('Open the quote preview first, then save', 'error');
    // Auto-open the preview
    openClientPDF();
    setTimeout(() => showToast('Now click 💾 Save quote', 'success'), 800);
    return;
  }

  const label = v('eventLabel');
  if(!label){ showToast('Set an event name first', 'error'); return; }

  const idx = eventLibrary.findIndex(e => e.label === label || e.id === currentEventId);
  if(idx === -1){
    showToast('Save the event first', 'error');
    return;
  }

  const entry = eventLibrary[idx];
  const snapshot = {
    html,
    total: 0,
    savedAt: new Date().toISOString(),
    eventLabel: label,
    revision: null
  };

  if(asRevision && entry.quoteSnapshot){
    // Keep previous as history, save new as current + link back
    if(!entry.quoteHistory) entry.quoteHistory = [];
    entry.quoteHistory.unshift({
      ...entry.quoteSnapshot,
      revision: (entry.quoteHistory.length + 1)
    });
    snapshot.revision = entry.quoteHistory.length + 1;
    showToast('Quote revision ' + snapshot.revision + ' saved', 'success');
  } else {
    showToast('Quote saved to event library ✓', 'success');
  }

  entry.quoteSnapshot = snapshot;
  entry.quoteSentAt = new Date().toISOString();
  if((entry.status||'draft') === 'draft'){
    entry.status = 'sent';
    sv('quoteStatus', 'sent');
    updateStatusBadge();
  }
  saveEventLibraryStore();
  renderEventLibrary();
}

function saveDocSnapshot(type, html, total){
  // Find the current event in the library and attach snapshot
  const label = v('eventLabel');
  if(!label) return;
  const idx = eventLibrary.findIndex(e =>
    e.label === label || e.id === currentEventId
  );
  if(idx === -1) return;

  // Store as object with metadata
  const snapshot = {html, total: parseFloat(total)||0, savedAt: new Date().toISOString(), invoiceNum:(el('pdfInvoiceNum')||{}).value||'', eventLabel:label};

  if(type === 'quote'){
    eventLibrary[idx].quoteSnapshot = snapshot;
    eventLibrary[idx].quoteSentAt = new Date().toISOString();
    // Auto-advance status to 'sent' if still draft
    if((eventLibrary[idx].status||'draft') === 'draft'){
      eventLibrary[idx].status = 'sent';
      sv('quoteStatus','sent');
      updateStatusBadge();
    }
  } else {
    eventLibrary[idx].invoiceSnapshot = snapshot;
    eventLibrary[idx].invoiceFinalAt = new Date().toISOString();
    eventLibrary[idx].invoiceTotal = parseFloat(total)||0;
    // Auto-advance to completed
    if(['confirmed','sent'].includes(eventLibrary[idx].status||'')){
      eventLibrary[idx].status = 'completed';
      sv('quoteStatus','completed');
      updateStatusBadge();
    }
  }
  saveEventLibraryStore();
  showToast(type === 'quote' ? '📄 Quote saved to event library' : '🧾 Invoice saved to event library', 'success');
}

function saveEventToLibrary(silent){
  const s = getState();
  const rawLabel = s.eventLabel || '';
  // Also check the menuEvName input directly as a fallback
  const menuEvNameEl = el('menuEvName');
  const menuEvNameVal = menuEvNameEl ? menuEvNameEl.value.trim() : '';
  const label = rawLabel || menuEvNameVal || 'New event';
  // If we got a label from menuEvName but not from eventLabel, sync it
  if(!rawLabel && menuEvNameVal) sv('eventLabel', menuEvNameVal);
  const date = s.quote && s.quote.eventDate ? s.quote.eventDate : '';
  const guests = s.guestCount || 0;
  const cocktailCount = (s.cocktails || []).length;
  const now = new Date().toISOString();

  // Check for existing entry with same label+date — offer to overwrite
  // Match priority: 1) currentEventId, 2) label+date, 3) label only
  let existingIdx = currentEventId
    ? eventLibrary.findIndex(e => e.id === currentEventId)
    : eventLibrary.findIndex(e => e.label === label && e.eventDate === date);
  if(existingIdx === -1)
    existingIdx = eventLibrary.findIndex(e => e.label === label);

  // Calculate quoted total for display (works even without a cocktail menu)
  let quotedTotal = 0;
  try {
    if(cocktails.length > 0){
      const qGuests = s.guestCount || 50;
      const qItems = getIM(qGuests);
      const qPurchase = qItems.reduce((sum,i)=>sum+i.purchaseCost,0);
      const qMp = qvf('mp') || 35;
      const qMkup = qMp < 100 ? (qMp/(100-qMp))*100 : qMp;
      const qMked = qPurchase*(1+qMkup/100);
      const qLabor = qvf('eventHrs') * qvf('hr');
      quotedTotal = qMked + qLabor + qvf('tf');
    } else {
      // No menu yet — save labor + travel only
      quotedTotal = qvf('eventHrs') * qvf('hr') + qvf('tf');
    }
  } catch(e){}

  const existing = existingIdx >= 0 ? eventLibrary[existingIdx] : {};
  const entry = makeEventEntry({
    id:           existing.id,
    label,
    eventDate:    date,
    guestCount:   guests,
    cocktailCount,
    status:       qv('quoteStatus') || 'draft',
    eventType:    existing.eventType || window._selectedEventType || null,
    totalQuoted:  quotedTotal,
    savedAt:      now,
    state:        s,
  }, existing);

  // Push snapshot to history on every save (manual or auto)
  try { if(s && entry.stateHistory !== undefined){
    const snapshot = {
      savedAt: now,
      isAuto: !!silent,
      label: generateHistoryLabel(s, existing),
      state: JSON.parse(JSON.stringify(s))
    };
    // Prepend (newest first), cap at 50 versions
    entry.stateHistory = [snapshot, ...(existing.stateHistory||[])].slice(0, 50);
  } } catch(eHist){ console.warn('stateHistory snapshot failed:', eHist); }

  try {
    if(existingIdx >= 0){
      eventLibrary[existingIdx] = entry;
      if(!silent) showSaveNotification(label, false);
    } else {
      eventLibrary.unshift(entry); // newest first
      if(!silent) showSaveNotification(label, true);
    }
  } catch(ePush){
    console.error('eventLibrary push failed:', ePush);
  }

  // Always sync currentEventId so subsequent saves update the same entry
  currentEventId = entry.id;
  try { saveEventLibraryStore(); } catch(eStore){ console.error('localStorage save failed:', eStore); }
  renderEventLibrary(); // always refresh
  if(!silent) flashSaved();

  // Auto-add unique ingredients to My Ingredients when event is confirmed
  if((s.quoteStatus === 'confirmed' || s.quote?.status === 'confirmed') && s.cocktails && s.cocktails.length){
    let ingAdded = 0;
    s.cocktails.forEach(ct => {
      (ct.ing || []).forEach(ing => {
        if(!ing.n || !ing.n.trim()) return;
        const exists = myIngredients.some(mi => mi.name.toLowerCase() === ing.n.toLowerCase());
        if(!exists && ing.c > 0){
          myIngredients.push({
            name: ing.n, unit: ing.u || 'oz', c: ing.c,
            note: 'From: ' + (label || 'event'),
            retailer: '', cat: '🏠 My custom ingredients',
            addedAt: new Date().toISOString(), flavorTags: []
          });
          ingAdded++;
        }
      });
    });
    if(ingAdded > 0){ saveMyDB(); if(!silent) showToast(ingAdded + ' ingredient' + (ingAdded>1?'s':'') + ' added to your library', 'success'); }
  }

  // Refresh event library display
  renderEventLibrary();

  // Flash the header save indicator
  if(!silent) flashSaved();
}

function exportFullBackup(){
  const timestamp = new Date().toISOString().split('T')[0];
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    label: 'Full backup — ' + timestamp,
    // Event data
    currentEvent: getState(),
    eventLibrary: eventLibrary,
    // Ingredient + pricing data
    myIngredients: myIngredients,
    retailerPrices: retailerPrices,
    priceHistory: priceHistory,
    storeOverrides: storeOverrides,
    customRetailers: customRetailers,
    currentStock: currentStock,
    // Recipe library
    recipeLibrary: recipeLibrary,
    // Receipts
    receipts: receipts,
    // Post-event data
    postEventData: postEventData || {}
  };
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bartender_backup_' + timestamp + '.json';
  a.click();
  showToast('✓ Full backup downloaded — ' + Object.keys(backup).length + ' data sets', 'success');
}

function importFullBackup(file){
  if(!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const data = JSON.parse(fr.result);
      if(!data.version || !data.exportedAt) throw new Error('Not a valid backup file');
      if(!confirm('This will restore ALL data from ' + (data.label||data.exportedAt) + '.\n\nYour current data will be replaced. Continue?')) return;
      // Restore everything
      if(data.eventLibrary) { eventLibrary = data.eventLibrary; saveEventLibraryStore(); }
      if(data.myIngredients) { myIngredients = data.myIngredients; saveMyDB(); }
      if(data.retailerPrices) { retailerPrices = data.retailerPrices; saveRetailerPrices(); }
      if(data.priceHistory) { priceHistory = data.priceHistory; localStorage.setItem('bartender_price_history', JSON.stringify(priceHistory)); }
      if(data.storeOverrides) { storeOverrides = data.storeOverrides; localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides)); }
      if(data.customRetailers) { customRetailers = data.customRetailers; saveRetailers(); }
      if(data.currentStock) { currentStock = data.currentStock; localStorage.setItem('bartender_stock', JSON.stringify(currentStock)); }
      if(data.recipeLibrary) { recipeLibrary = data.recipeLibrary; saveRecipeLibraryStore(); }
      if(data.receipts) { receipts = data.receipts; localStorage.setItem('bartender_receipts', JSON.stringify(receipts)); }
      if(data.currentEvent && data.currentEvent.version) applyState(data.currentEvent);
      showToast('✓ Backup restored successfully', 'success');
      renderEventLibrary();
      renderRecipeLibrary();
      renderMyLibrarySection();
    } catch(err) {
      showToast('Could not restore backup: ' + err.message, 'error');
    }
  };
  fr.readAsText(file);
}

function exportEventJSON(){
  // Explicit JSON export — only when user wants it from ⋯ menu
  const s = getState();
  const label = s.eventLabel || 'event';
  const lbl = label.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  dl(JSON.stringify(s,null,2),'application/json',lbl+'_bartender.json');
  showToast('JSON exported', 'success');
}

function saveEvent(){
  // Keep the old export-only save for backwards compat
  const s=getState(), lbl=(s.eventLabel||'event').replace(/[^a-z0-9]/gi,'_').toLowerCase()||'event';
  dl(JSON.stringify(s,null,2),'application/json',lbl+'_bartender.json');
  flashSaved();
}

function openEventLibrary(){
  renderEventLibrary();
  el('evlibModalBg').classList.add('open');
}

function closeEventLibrary(){
  el('evlibModalBg').classList.remove('open');
}

function loadEventFromLibrary(id){
  currentEventId = id;
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) { showToast('Event not found', 'error'); return; }
  const state = entry.state || entry.fullState;
  if(!state) { showToast('Event has no saved data', 'error'); return; }
  // Auto-save current event before loading (no disruptive confirm dialog)
  cnManuallyEdited = false;
  menuEventActive = true;
  applyState(state);
  closeEventLibrary();
  // Switch to menu tab
  const menuBtn = el('st-menu');
  if(menuBtn) sw('menu', menuBtn);
  showToast((entry.label||'Event') + ' loaded ✓', 'success');
}

function previewDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap || !snap.html){
    showToast('No ' + type + ' saved for this event yet', 'error');
    return;
  }
  const w = window.open('','_blank');
  if(w){ w.document.write(snap.html); w.document.close(); }
  else { showToast('Pop-up blocked — allow pop-ups to preview', 'error'); }
}

function reprintDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const snap = type === 'quote' ? entry.quoteSnapshot : entry.invoiceSnapshot;
  if(!snap || !snap.html){
    showToast('No ' + type + ' saved for this event yet', 'error');
    return;
  }
  const w = window.open('','_blank');
  if(w){
    w.document.write(snap.html);
    w.document.close();
    w.focus();
    setTimeout(() => { try{ w.print(); }catch(e){} }, 500);
  } else {
    // Fallback: download as HTML
    const blob = new Blob([snap.html], {type:'text/html'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (entry.label||'event').replace(/[^a-z0-9]/gi,'_') + '_' + type + '.html';
    a.click();
  }
}

function updatePaymentStatus(id, field, value){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry[field] = value;
  // Auto-set paymentStatus based on amounts
  if(field === 'paidAmount' || field === 'depositAmount'){
    const total = entry.invoiceTotal || entry.totalQuoted || 0;
    const paid = parseFloat(entry.paidAmount||0);
    const dep  = parseFloat(entry.depositAmount||0);
    if(paid >= total && total > 0) entry.paymentStatus = 'paid';
    else if(paid > 0) entry.paymentStatus = 'partial';
    else if(dep > 0) entry.paymentStatus = 'deposit';
    else entry.paymentStatus = 'unpaid';
  }
  if(field === 'paymentStatus' && value === 'paid' && !entry.paidDate)
    entry.paidDate = new Date().toISOString().split('T')[0];
  saveEventLibraryStore();
  renderEventLibrary();
  if(field === 'paymentStatus')
    showToast('Payment status → ' + value, 'success');
}

function promptDepositEntry(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const current = entry.depositAmount ? parseFloat(entry.depositAmount).toFixed(2) : '';
  const val = prompt('Deposit amount received (leave blank to clear):', current);
  if(val === null) return; // cancelled
  const amt = parseFloat(val);
  if(val.trim() === ''){
    // Clear deposit
    entry.depositAmount = null;
    entry.depositDate   = null;
    if(entry.paymentStatus === 'deposit') entry.paymentStatus = 'unpaid';
  } else if(!isNaN(amt) && amt >= 0){
    entry.depositAmount = amt;
    entry.depositDate   = entry.depositDate || new Date().toISOString().split('T')[0];
    const total = parseFloat(entry.invoiceTotal||entry.totalQuoted||0);
    if(amt >= total && total > 0) entry.paymentStatus = 'paid';
    else if(amt > 0) entry.paymentStatus = 'deposit';
  } else {
    showToast('Invalid amount', 'error'); return;
  }
  saveEventLibraryStore();
  renderEventLibrary();
  if(val.trim() !== '') showToast('Deposit $' + (parseFloat(val)||0).toFixed(2) + ' saved', 'success');
}

function deleteDocSnapshot(id, type){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  const label = type === 'quote' ? 'quote' : 'invoice';
  if(!confirm('Delete the saved ' + label + ' for "' + (entry.label||'Event') + '"?')) return;
  if(type === 'quote'){
    entry.quoteSnapshot = null;
    entry.quoteSentAt   = null;
    entry.quoteHistory  = [];
    // Revert to draft if was sent
    if(entry.status === 'sent'){ entry.status = 'draft'; }
  } else {
    entry.invoiceSnapshot = null;
    entry.invoiceFinalAt  = null;
    entry.invoiceTotal    = null;
  }
  saveEventLibraryStore();
  renderEventLibrary();
  showToast(label.charAt(0).toUpperCase() + label.slice(1) + ' deleted', 'success');
}

function resetPayment(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  if(!confirm('Reset payment for "' + (entry.label||'Event') + '"?\nThis will clear paid status, amounts and dates.')) return;
  entry.paymentStatus = 'unpaid';
  entry.paidAmount    = null;
  entry.paidDate      = null;
  entry.depositAmount = null;
  entry.depositDate   = null;
  entry.paymentMethod = null;
  entry.proofOfPayment = null;
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Payment reset to unpaid', 'success');
}

function uploadProofOfPayment(id){
  const note = prompt('Enter payment reference (e-transfer confirmation #, cheque #, note, etc.):');
  if(note === null) return;
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry.proofOfPayment = note;
  if(!entry.paidDate) entry.paidDate = new Date().toISOString().split('T')[0];
  if((parseFloat(entry.paidAmount||0) >= (entry.invoiceTotal||entry.totalQuoted||0)) || !entry.paidAmount)
    entry.paymentStatus = 'paid';
  saveEventLibraryStore();
  renderEventLibrary();
  showToast('Payment reference saved', 'success');
}

function updateEventStatus(id, newStatus){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  entry.status = newStatus;
  if(entry.state) entry.state.quoteStatus = newStatus;
  saveEventLibraryStore();
  // Update status badge if this is the current event
  if(currentEventId === id){
    sv('quoteStatus', newStatus);
    updateStatusBadge();
  }
  showToast((entry.label||'Event') + ' → ' + newStatus, 'success');
}

function deleteEventFromLibrary(id){
  const entry = eventLibrary.find(e => e.id === id);
  if(!entry) return;
  if(!confirm('Delete "' + (entry.label||'Event') + '" from the library?')) return;
  eventLibrary = eventLibrary.filter(e => e.id !== id);
  saveEventLibraryStore();
  renderEventLibrary();
  showToast((entry.label||'Event') + ' deleted', 'success');
}

function clearEventLibrary(){
  eventLibrary = [];
  saveEventLibraryStore();
  renderEventLibrary();
}

function renderEventLibrary(){
  const listEl = el('evlibList');
  const countEl = el('evlibCount');
  if(!listEl) return;

  const filterStatus = v('evFilterStatus') || 'all';
  const query = (v('evlibSearch') || '').toLowerCase().trim();

  const filtered = eventLibrary.filter(e => {
    const matchStatus = filterStatus === 'all' || (e.status||'draft') === filterStatus;
    const matchQuery  = !query || (e.label||'').toLowerCase().includes(query) || (e.eventDate||'').includes(query);
    return matchStatus && matchQuery;
  });

  if(countEl) countEl.textContent = eventLibrary.length + ' event' + (eventLibrary.length!==1?'s':'') + ' saved';

  if(!eventLibrary.length){
    listEl.innerHTML = '<div style="padding:2.5rem;text-align:center;color:var(--text3);font-size:13px;">No saved events yet — click 💾 Save to add the current event.</div>';
    return;
  }
  if(!filtered.length){
    listEl.innerHTML = '<div style="padding:1.5rem;text-align:center;color:var(--text3);font-size:13px;">No events match that search.</div>';
    return;
  }

  const STATUS_LABELS = {draft:'📝 Draft',sent:'📤 Sent',confirmed:'✅ Confirmed',completed:'🎉 Done',cancelled:'❌ Cancelled',rejected:'🚫 Rejected'};
  const STATUS_COLORS = {draft:'var(--text3)',sent:'var(--accent)',confirmed:'var(--green)',completed:'#059669',cancelled:'var(--red)',rejected:'var(--red)'};

  const PAY_LABELS = {unpaid:'💳 Unpaid', deposit:'⬇️ Deposit received', partial:'⏳ Partial', paid:'✅ Paid in full'};
  const PAY_BG     = {unpaid:'#fff5f5',deposit:'#fff8e6',partial:'#fff8e6',paid:'#f0fdf4'};
  const PAY_COLOR  = {unpaid:'var(--red)',deposit:'var(--amber)',partial:'var(--amber)',paid:'var(--green)'};

  const rows = filtered.map(e => {
    const dateStr = e.eventDate
      ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric',year:'numeric'})
      : '—';
    const cocktailStr = e.cocktailCount ? e.cocktailCount + ' cocktail' + (e.cocktailCount!==1?'s':'') : '';
    const guestStr = (e.guestCount||e.guests) ? (e.guestCount||e.guests)+' guests' : '';
    const metaStr  = [cocktailStr, guestStr].filter(Boolean).join(' · ');
    const totalStr = e.totalQuoted ? ' · $' + parseFloat(e.totalQuoted).toFixed(0) : '';
    const st = e.status || 'draft';
    const stColor = STATUS_COLORS[st]||'var(--text3)';
    const ps = e.paymentStatus || 'unpaid';

    const selectOpts = Object.entries(STATUS_LABELS).map(([val, lbl]) =>
      '<option value="'+val+'"'+(st===val?' selected':'')+'>'+lbl+'</option>'
    ).join('');

    // ── Quote / Invoice doc strip ──
    const qDate  = e.quoteSentAt   ? new Date(e.quoteSentAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : null;
    const iDate  = e.invoiceFinalAt? new Date(e.invoiceFinalAt).toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : null;
    const iTotal = e.invoiceTotal  ? ' · $' + parseFloat(e.invoiceTotal).toFixed(2) : '';

    const docStrip = (qDate || iDate) ? (
      '<div style="display:flex;gap:6px;padding:8px 14px;border-top:1px solid var(--surface2);flex-wrap:wrap;align-items:center;">'
      + '<span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-right:2px;">Docs:</span>'
      + (qDate
          ? '<span style="display:inline-flex;align-items:center;gap:4px;">'
            + '<button onclick="viewEventDocument(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c5d8f8;background:var(--accent-bg);color:var(--accent);cursor:pointer;font-family:var(--font);font-weight:500;">📋 Quote · '+qDate+ (e.quoteHistory && e.quoteHistory.length ? ' · v'+(e.quoteHistory.length+1) : '') +'</button>'
            + (e.quoteHistory && e.quoteHistory.length ? '<button onclick="viewQuoteHistory(\''+e.id+'\')" style="font-size:11px;padding:3px 9px;border-radius:20px;border:1.5px solid #c5d8f8;background:var(--surface);color:var(--accent);cursor:pointer;font-family:var(--font);" title="View previous quote versions">🕐 History ('+e.quoteHistory.length+')</button>' : '')
            + '<button onclick="saveDocToComputer(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Save to computer">💾</button>'
            + '<button onclick="deleteDocSnapshot(\''+e.id+'\',\'quote\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid #fcc;background:#fff5f5;color:var(--red);cursor:pointer;font-family:var(--font);" title="Delete quote">✕</button>'
            + '</span>'
          : '<span style="font-size:11px;color:var(--text3);font-style:italic;">No quote saved</span>')
      + (iDate
          ? '<button onclick="viewEventDocument(\''+e.id+'\',\'invoice\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c8e6d4;background:var(--green-bg);color:var(--green);cursor:pointer;font-family:var(--font);font-weight:500;">🧾 Invoice'+iTotal+' · '+iDate+'</button>'
          + '<button onclick="saveDocToComputer(\''+e.id+'\',\'invoice\')" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Save to computer">💾</button>'
          : '')
      + '</div>'
    ) : '';

    // ── Payment strip ──
    const paidAmt   = parseFloat(e.paidAmount||0);
    const depAmt    = parseFloat(e.depositAmount||0);
    const total     = parseFloat(e.invoiceTotal||e.totalQuoted||0);
    const outstanding = total > 0 ? Math.max(0, total - paidAmt - depAmt) : null;

    const payStrip = '<div style="display:flex;gap:8px;padding:8px 14px 10px;border-top:1px solid var(--surface2);flex-wrap:wrap;align-items:center;background:'+PAY_BG[ps]+';">'
      // Payment status pill + quick-select
      + '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">'
      +   '<span style="font-size:12px;font-weight:700;color:'+PAY_COLOR[ps]+';">'+PAY_LABELS[ps]+'</span>'
      +   (outstanding !== null && ps !== 'paid'
            ? '<span style="font-size:11px;color:var(--red);font-weight:600;background:var(--red-bg);padding:1px 8px;border-radius:20px;">$'+outstanding.toFixed(2)+' outstanding</span>'
              + (depAmt > 0 ? '<span style="font-size:11px;color:var(--amber);background:var(--amber-bg);padding:1px 8px;border-radius:20px;">$'+depAmt.toFixed(2)+' deposit received</span>' : '')
            : ps === 'paid' ? '<span style="font-size:11px;color:var(--green);font-weight:500;">$'+paidAmt.toFixed(2)+' received</span>' : '')
      +   (e.proofOfPayment ? '<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:1px 8px;border-radius:20px;border:1px solid var(--border);" title="Payment ref">🧾 '+e.proofOfPayment+'</span>' : '')
      + '</div>'
      // Quick action buttons
      + '<div style="display:flex;gap:5px;flex-wrap:wrap;">'
      + (ps !== 'paid'
          ? '<button onclick="updatePaymentStatus(\''+e.id+'\',\'paymentStatus\',\'paid\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid #c8e6d4;background:var(--green-bg);color:var(--green);cursor:pointer;font-family:var(--font);font-weight:600;">✅ Mark paid</button>'
          : '<button onclick="resetPayment(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text3);cursor:pointer;font-family:var(--font);font-weight:500;" title="Undo — reset payment to unpaid">↩ Undo payment</button>')
      + (ps !== 'paid'
          ? '<button onclick="promptDepositEntry(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--amber-bg);background:var(--amber-bg);color:var(--amber);cursor:pointer;font-family:var(--font);font-weight:500;">'+(depAmt>0?'✏️ Edit deposit ($'+depAmt.toFixed(2)+')':'⬇️ Log deposit')+'</button>'
          : '')
      + '<button onclick="uploadProofOfPayment(\''+e.id+'\')" style="font-size:11px;padding:3px 10px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-family:var(--font);" title="Add payment reference">📎 Add ref</button>'
      + '<select onchange="updatePaymentStatus(\''+e.id+'\',\'paymentMethod\',this.value)" style="font-size:11px;padding:3px 8px;border-radius:20px;border:1.5px solid var(--border);background:var(--surface);color:var(--text2);font-family:var(--font);cursor:pointer;">'
      +   '<option value="">💳 Method</option>'
      +   ['cash','etransfer','card','cheque'].map(m =>
            '<option value="'+m+'"'+(e.paymentMethod===m?' selected':'')+'>'+{cash:'💵 Cash',etransfer:'📲 e-Transfer',card:'💳 Card',cheque:'📝 Cheque'}[m]+'</option>'
          ).join('')
      + '</select>'
      + '</div>'
      + '</div>';

    return '<div class="evlib-card" style="border-left:3px solid '+stColor+';">'
      // ── Main row ──
      + '<div style="display:grid;grid-template-columns:2fr 1fr 1.5fr auto;gap:10px;padding:12px 14px;align-items:center;">'
      +   '<div>'
      +     '<div class="evlib-name">'+( e.label||'Untitled')+'</div>'
      +     (metaStr ? '<div class="evlib-meta">'+metaStr+'</div>' : '')
      +   '</div>'
      +   '<div style="font-size:12px;color:var(--text2);font-weight:500;">'+dateStr+'</div>'
      +   '<select data-id="'+e.id+'" onchange="updateEventStatus(this.dataset.id,this.value)"'
      +     ' style="font-size:12px;padding:4px 8px;border-radius:20px;border:1.5px solid '+stColor+'33;background:var(--surface);cursor:pointer;color:'+stColor+';font-weight:600;font-family:var(--font);">'
      +     selectOpts
      +   '</select>'
      +   '<div style="display:flex;gap:5px;flex-shrink:0;">'
      +     (e.status==='confirmed'||e.status==='completed'?'<button class="btn btn-sm btn-success" style="font-size:11px;padding:4px 11px;" data-id="'+e.id+'" onclick="loadAndInvoice(this.dataset.id)">🧾 Invoice</button>':'')      +   '<button class="btn btn-sm btn-primary" style="font-size:11px;padding:4px 11px;" data-id="'+e.id+'" onclick="loadEventFromLibrary(this.dataset.id)">Load</button>'
      +   '<button class="btn btn-sm" style="font-size:11px;padding:4px 9px;" data-id="'+e.id+'" onclick="viewStateHistory(this.dataset.id)" title="Version history">🕐'+(e.stateHistory&&e.stateHistory.length?' ('+e.stateHistory.length+')':'')+'</button>'
      +     '<button class="btn btn-sm btn-danger" style="font-size:11px;padding:4px 9px;" data-id="'+e.id+'" onclick="deleteEventFromLibrary(this.dataset.id)">✕</button>'
      +   '</div>'
      + '</div>'
      + docStrip
      + payStrip
      + '</div>';
  }).join('');

  listEl.innerHTML = rows;
}
function loadEvent(e){
  const file=e.target.files[0];if(!file)return;
  const r=new FileReader();r.onload=ev=>{try{applyState(JSON.parse(ev.target.result));}catch{alert('Could not read file.');}};
  r.readAsText(file);e.target.value='';
}
function newEvent(){
  if(!confirm('Start a new event? Unsaved changes will be lost.'))return;
  cocktails=[];nIng=[];
  ['eventLabel','cn','ed','qn','nn','p1name','p1drink','p1desc','p2name','p2drink','p2desc','pEventName'].forEach(id=>sv(id,''));
  ['p1dpg','p2dpg'].forEach(id=>sv(id,1));
  ['cn','ed','qn'].forEach(id=>sv(id,''));
  sv('eventHrs',4);
  sv('drinksPerPerson',5);
  sv('bufferPct',0);
  sv('depositAmt',0);
  sv('gc',50);
  sv('hr',100);
  sv('mp',35);
  sv('discountAmt',0);
  sv('discountPct',0);
  sv('quoteStatus','draft');
  updateStatusBadge();
  sv('tf',0);
  rcManualOverride=false;
  staffList=[];
  postEventData={};
  editingCocktailId=null;
  editIngredients=[];
  renderStaff();
  // Note: receipts are kept in localStorage — they persist across events by design
  renderReceipts();
  sc('taxEnabled',false);
  sv('gc',50);
  sv('eventHrs',4);sv('hr',100);
  sv('mp',35);
  sv('tf',0);sv('ndpg',1);
  rNI();rC();rShop();rQ();
}
function clearMyLibSearch(){
  const inp = el('myLibSearch');
  if(inp){ inp.value = ''; inp.focus(); }
  const cb = el('myLibSearchClear');
  if(cb) cb.style.display = 'none';
  myLibActiveQuery = '';
  renderMyLibCards(undefined, '');
}

function closeEvLibModal(){
  const bg = el('evlibModalBg');
  if(bg) bg.classList.remove('open');
}

function dismissAutosave(){
  const banner = el('autosaveRestoreBanner');
  if(banner) banner.style.display = 'none';
}

function restoreAutosave(){
  try {
    const saved = localStorage.getItem('bartender_autosave_v1');
    if(!saved) return;
    const data = JSON.parse(saved);
    if(data && data.state) {
      applyState(data.state);
      showToast('Event restored from autosave', 'success');
    }
  } catch(e) {
    showToast('Could not restore autosave', 'error');
  }
  dismissAutosave();
}

function revertToSaved(){
  if(!currentEventId){
    showToast('No saved version to revert to', 'error');
    return;
  }
  const entry = eventLibrary.find(e => e.id === currentEventId);
  if(!entry || !entry.state){
    showToast('No saved version found', 'error');
    return;
  }
  if(!confirm('Discard all unsaved changes and reload "' + (entry.label||'Event') + '" from last save?')) return;
  applyState(entry.state);
  lastSavedState = getSimpleState();
  const revertBtn = el('revertBtn');
  if(revertBtn) revertBtn.style.display = 'none';
  showToast('Reverted to last saved version ✓', 'success');
}

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

// ═══ SHOPPING LIST ═══
// getIM, getBottleInfo, shopping tab, retailers, store overrides,
// inferStore, renderPurchaseList, shopping deadline, master list

// ── Bottle size lookup ─────────────────────────────────────
// Returns { bottleOz, bottleUnit, bottleLabel } for a given ingredient name+unit
// For non-bottle items (garnishes, pinches, dashes, leaves) returns null → no rounding
function getBottleInfo(name, unit) {
  const n = name.toLowerCase();
  const u = unit.toLowerCase();
  // Non-bottled units — don't round
  if (['leaves','leaf','piece','pinch','dashes','dash','tsp','tbsp'].includes(u)) return null;
  // Spirits & liqueurs → 750ml = 25.36 oz
  const spirits = ['rum','vodka','gin','tequila','mezcal','whisky','whiskey','bourbon','scotch','rye','sake','shochu','brandy','cognac','armagnac','absinthe','campari','aperol','cointreau','triple sec','grand marnier','kahlua','baileys','amaretto','frangelico','chambord','st-germain','peach schnapps','curaçao','midori','limoncello','pimm','lillet','dubonnet','galliano','chartreuse','benedictine','drambuie','falernum','velvet','malibu','appleton','havana','diplomatico','mount gay','gosling','plantation','patron','don julio','casamigos','espolon','olmeca','absolut','grey goose','stolichnaya','tito','ketel','ciroc','russian standard','bombay','hendrick','tanqueray','beefeater','botanist','roku','aviation','crown royal','irish','tennessee','lychee liqueur','soho','plum wine','umeshu','japanese whisky','nikka','suntory'];
  if (spirits.some(s => n.includes(s))) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Wine & bubbles → 750ml
  if (['wine','prosecco','champagne','cava','sparkling','rosé'].some(s=>n.includes(s))) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Vermouth → 750ml
  if (n.includes('vermouth')) return {bottleOz:25.36, bottleLabel:'750ml bottle'};
  // Beer/cider → sold by bottle/can, already in those units
  if (['beer','cider','radler','shandy'].some(s=>n.includes(s))) return null;
  // Bitters → 200ml = 6.76 oz
  if (n.includes('bitters') || n.includes('tabasco') || n.includes('worcestershire')) return null;
  // Juices → 1L = 33.8 oz
  if (['juice','cranberry','pineapple','mango','tomato','apple','passion fruit','lychee juice','grapefruit juice','orange juice','coconut water','calpico','ramune'].some(s=>n.includes(s))) return {bottleOz:33.8, bottleLabel:'1L bottle'};
  // Syrups & sweeteners → 250ml = 8.45 oz (small) or 750ml = 25.36 oz
  if (['syrup','grenadine','orgeat','agave','honey','falernum','mirin'].some(s=>n.includes(s))) return {bottleOz:8.45, bottleLabel:'250ml bottle'};
  // Sodas & mixers → 1L = 33.8 oz
  if (['soda','tonic','ginger beer','ginger ale','cola','sprite','lemon-lime','cream soda','water','club soda','perrier'].some(s=>n.includes(s))) return {bottleOz:33.8, bottleLabel:'1L bottle'};
  // Cream/coconut cream → 400ml can = 13.5 oz
  if (['cream','coconut cream','condensed','coconut milk'].some(s=>n.includes(s))) return {bottleOz:13.5, bottleLabel:'400ml can'};
  // Coffee
  if (n.includes('espresso') || n.includes('cold brew') || n.includes('tea')) return null;
  return null; // unknown → no rounding
}

// ── getIM: aggregate ingredients with bottle rounding ──────
function getIM(guests, cocktailList){
  // cocktailList is optional — defaults to global cocktails
  // Passing it explicitly avoids the dangerous global swap pattern
  const _cocktails = cocktailList || cocktails;
  const m={};
  const dpp = qvf('drinksPerPerson') || 5;
  const buf = (qvf('bufferPct') || 0) / 100;
  const totalDPP = dpp * (1 + buf);
  const n = _cocktails.length || 1;

  // Normalise weights: each cocktail has c.dpg as relative weight (default 1)
  // Scale so weights sum to totalDPP
  const rawWeights = _cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b, 0);
  const scale = totalDPP / weightSum;

  _cocktails.forEach((c,i)=>{
    const drinksThisCocktail = rawWeights[i] * scale; // drinks/person for this cocktail
    const td = drinksThisCocktail * guests;
    c.ing.forEach(g=>{
      const k=g.n.toLowerCase().trim();
      if(!m[k])m[k]={name:g.n,unit:g.u,qty:0,cpu:g.c};
      m[k].qty+=g.q*td;
    });
  });
  const items = Object.values(m).sort((a,b)=>a.name.localeCompare(b.name));
  // Attach bottle info and rounded quantities
  items.forEach(item=>{
    const bi = getBottleInfo(item.name, item.unit);
    item.bottleInfo = bi;
    if (bi) {
      item.qtyRaw = item.qty;
      item.bottles = Math.ceil(item.qty / bi.bottleOz);
      item.qtyRounded = item.bottles * bi.bottleOz;
      item.leftover = item.qtyRounded - item.qty;
      item.purchaseCost = item.bottles * (bi.bottleOz * item.cpu);
      item.leftoverValue = item.leftover * item.cpu;
    } else {
      item.qtyRaw = item.qty;
      item.qtyRounded = item.qty;
      item.purchaseCost = item.qty * item.cpu;
      item.leftover = 0;
      item.leftoverValue = 0;
    }
  });
  return items;
}

let shopSelectedEventIds = null; // null = current event only

function switchShopTab(tab, btn){
  document.querySelectorAll('#shopTab-qty,#shopTab-purchase').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  el('shopPane-qty').style.display      = tab === 'qty'      ? '' : 'none';
  el('shopPane-purchase').style.display = tab === 'purchase' ? '' : 'none';
  if(tab === 'purchase'){ rShop(); renderPurchaseList(); }
}

function renderShopEventSelector(){
  const wrap = el('shopEventSelector');
  if(!wrap) return;

  // Only show events that have cocktails saved
  const allEvents = eventLibrary.filter(function(e){
    return e.state && e.state.cocktails && e.state.cocktails.length > 0;
  });

  if(!shopSelectedEventIds) shopSelectedEventIds = new Set();

  // Separate confirmed vs other
  const confirmed = allEvents.filter(function(e){ return e.status==='confirmed'||e.status==='completed'; });
  const others    = allEvents.filter(function(e){ return e.status!=='confirmed'&&e.status!=='completed'; });

  let html = '<div style="margin-bottom:1rem;">';

  if(!allEvents.length){
    html += '<div style="font-size:12px;color:var(--text3);padding:8px 0;">No saved events with cocktails yet — save an event first</div>';
  } else {
    // Section: confirmed events
    if(confirmed.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--green);margin-bottom:6px;">✅ Confirmed events</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-bottom:10px;">';
      confirmed.forEach(function(ev){
        const isOn = shopSelectedEventIds.has(ev.id);
        const dateStr = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
        const guests = ev.guestCount || (ev.state && ev.state.quote && ev.state.quote.guestCount) || '';
        html += '<button data-evid="'+ev.id+'" onclick="toggleShopEvent(this.dataset.evid)"'
          + ' style="font-size:12px;padding:6px 14px;border-radius:20px;cursor:pointer;font-family:var(--font);'
          + 'border:1.5px solid '+(isOn?'var(--green)':'#c8e6d4')+';'
          + 'background:'+(isOn?'var(--green)':'var(--green-bg)')+';'
          + 'color:'+(isOn?'#fff':'var(--green)')+';'
          + 'font-weight:'+(isOn?'700':'500')+';">'
          + (ev.label||'Event')+(dateStr?' · '+dateStr:'')+(guests?' · '+guests+'g':'')
          + '</button>';
      });
      html += '</div>';
    }

    // Section: other events (draft, sent)
    if(others.length){
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:6px;">Other events</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:7px;">';
      others.forEach(function(ev){
        const isOn = shopSelectedEventIds.has(ev.id);
        const statusEmoji = {draft:'📝',sent:'📤',cancelled:'❌'}[ev.status||'draft']||'📝';
        const dateStr = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
        html += '<button data-evid="'+ev.id+'" onclick="toggleShopEvent(this.dataset.evid)"'
          + ' style="font-size:12px;padding:5px 12px;border-radius:20px;cursor:pointer;font-family:var(--font);'
          + 'border:1.5px solid '+(isOn?'var(--border)':'var(--border)')+';'
          + 'background:'+(isOn?'var(--surface2)':'var(--surface)')+';'
          + 'color:'+(isOn?'var(--text)':'var(--text2)')+';'
          + 'font-weight:'+(isOn?'600':'400')+';">'
          + statusEmoji+' '+(ev.label||'Event')+(dateStr?' · '+dateStr:'')
          + '</button>';
      });
      html += '</div>';
    }
  }
  html += '</div>';
  wrap.innerHTML = html;
}


function toggleShopEvent(evId){
  if(shopSelectedEventIds === null) shopSelectedEventIds = new Set();
  if(shopSelectedEventIds.has(evId)) shopSelectedEventIds.delete(evId);
  else shopSelectedEventIds.add(evId);
  renderShopEventSelector();
  rShop();
  // If purchase tab is visible, re-render it too
  const purchasePane = el('shopPane-purchase');
  if(purchasePane && purchasePane.style.display !== 'none') renderPurchaseList();
}


function getShopItems(guests){
  // Always include current event
  let items = getIM(guests);
  // Merge in any selected confirmed events
  if(shopSelectedEventIds && shopSelectedEventIds.size > 0){
    shopSelectedEventIds.forEach(evId => {
      const ev = eventLibrary.find(e => (e.id||e.label) === evId);
      if(!ev) return;
      const state = ev.fullState || ev;
      const evItems = getIMForEvent(state);
      evItems.forEach(evItem => {
        const k = evItem.name.toLowerCase().trim();
        const existing = items.find(i => i.name.toLowerCase().trim() === k);
        if(existing){
          existing.qty += evItem.qty;
        } else {
          items.push({...evItem, fromEvent: ev.label});
        }
      });
    });
  }
  return items;
}

function rShop(){
  const {guests, effectiveGuests, totalDrinks} = getConsumptionGuests();
   // Gather all active events' cocktails
  // Build from selected saved events only (not current event being edited)
  if(!shopSelectedEventIds || !shopSelectedEventIds.size){
    shtml('smet','');
    shtml('slist','<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">👆 Select an event above to view its shopping list</div>');
    return;
  }
  const allShopEvents = [...shopSelectedEventIds].map(id => {
    const ev = eventLibrary.find(e => e.id === id);
    if(!ev || !ev.state) return null;
    const gc = (ev.state.quote && ev.state.quote.guestCount) || ev.guestCount || 50;
    return {cocktails: ev.state.cocktails||[], guestCount: gc, label: ev.label, id};
  }).filter(Boolean);
  if(!allShopEvents.length || !allShopEvents.some(e => e.cocktails.length)){
    shtml('smet','');
    shtml('slist','<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">🍸 Selected events have no cocktails saved yet</div>');
    return;
  }
  // Render event selector
  renderShopEventSelector();
  const items=getShopItems(guests);

  // ── Cross-reference with inventory ──
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    // Find matching stock entry (fuzzy: exact first, then partial)
    let stock = currentStock[key];
    if(!stock){
      const keys = Object.keys(currentStock);
      const partialKey = keys.find(k => k.includes(key.split(' ')[0]) || key.includes(k.split(' ')[0]));
      if(partialKey) stock = currentStock[partialKey];
    }
    if(stock && stock.qty > 0){
      // Convert stock qty to same unit as needed qty
      const stockQtyInUnit = stock.unit === item.unit ? stock.qty
        : stock.unit === 'oz' && item.unit === 'ml' ? stock.qty * 29.5735
        : stock.unit === 'ml' && item.unit === 'oz' ? stock.qty / 29.5735
        : stock.qty; // best-effort same unit
      item.inStock = stockQtyInUnit;
      item.stillNeeded = Math.max(0, item.qtyRaw - stockQtyInUnit);
      item.coveredByStock = Math.min(item.qtyRaw, stockQtyInUnit);
      item.fullyCoVered = item.stillNeeded <= 0;
    } else {
      item.inStock = 0;
      item.stillNeeded = item.qtyRaw;
      item.coveredByStock = 0;
      item.fullyCoVered = false;
    }
    // Recalculate purchase cost based on what still needs to be bought
    if(item.bottleInfo && item.stillNeeded > 0){
      item.bottlesBuy = Math.ceil(item.stillNeeded / item.bottleInfo.bottleOz);
      item.purchaseCostAdjusted = item.bottlesBuy * (item.bottleInfo.bottleOz * item.cpu);
    } else if(item.bottleInfo && item.stillNeeded <= 0){
      item.bottlesBuy = 0;
      item.purchaseCostAdjusted = 0;
    } else {
      item.bottlesBuy = 0;
      item.purchaseCostAdjusted = item.stillNeeded * item.cpu;
    }
  });

  const stockCoveredCount = items.filter(i => i.fullyCoVered).length;
  const itemsStillNeeded = items.filter(i => !i.fullyCoVered);
  const tcPurchase=itemsStillNeeded.reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
  const tcRaw=items.reduce((s,i)=>s+i.qtyRaw*i.cpu,0);
  const totalLeftoverVal=items.reduce((s,i)=>s+i.leftoverValue,0);
  const stockSavings = items.reduce((s,i)=>s+(i.coveredByStock||0)*i.cpu,0);
  const td=totalDrinks;
  const bottledItems=items.filter(i=>i.bottleInfo);

  const stockBanner = stockCoveredCount > 0
    ? `<div style="background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#1a7a4a;display:flex;align-items:center;gap:8px;">
        <span style="font-size:16px;">📦</span>
        <div><strong>${stockCoveredCount} ingredient${stockCoveredCount!==1?'s':''} already in your inventory</strong> — no need to buy${stockSavings>0?' · saves $'+stockSavings.toFixed(2):''}</div>
      </div>`
    : '';

  shtml('smet',`
    ${stockBanner}
    <div class="met"><div class="ml">Total drinks</div><div class="mv">${Math.round(td)}</div></div>
    <div class="met"><div class="ml">Ingredients</div><div class="mv">${items.length}</div></div>
    <div class="met"><div class="ml">Still to buy</div><div class="mv">${itemsStillNeeded.length}</div></div>
    <div class="met"><div class="ml">Purchase cost CAD</div><div class="mv">$${tcPurchase.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Resalable leftover</div><div class="mv" style="color:#1a7a4a;">$${totalLeftoverVal.toFixed(2)}</div></div>`);

  // Auto-fill resale credit from leftover unless user overrode it manually
  // Leftover auto-calc feeds the Inventory tab, not the quote

  // ── Infer store for each item from INGDB note field ──
  // ── Custom Retailers ──────────────────────────────────────
let customRetailers = [];

function loadRetailers(){
  try {
    const stored = localStorage.getItem('bartender_retailers_v1');
    if(stored) customRetailers = JSON.parse(stored);
  } catch(e){ customRetailers = []; }
  renderRetailerOptions();
}

function saveRetailers(){
  localStorage.setItem('bartender_retailers_v1', JSON.stringify(customRetailers));
}

function renderRetailerOptions(){
  // Update all retailer selects with custom entries
  const baseRetailers = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online'];
  document.querySelectorAll('#mydbRetailer, #qiRetailer').forEach(sel => {
    if(!sel) return;
    const current = sel.value;
    // Remove existing custom options (between base and __add__)
    Array.from(sel.options).forEach(o => {
      if(!baseRetailers.includes(o.value) && o.value !== '' && o.value !== '__add__') o.remove();
    });
    // Insert custom retailers before __add__
    const addOpt = Array.from(sel.options).find(o => o.value === '__add__');
    customRetailers.forEach(r => {
      if(!Array.from(sel.options).some(o => o.value === r)){
        const opt = document.createElement('option');
        opt.value = r; opt.textContent = r;
        if(addOpt) sel.insertBefore(opt, addOpt);
        else sel.appendChild(opt);
      }
    });
    // Restore selection
    if(current) sel.value = current;
  });
}

function handleRetailerChange(sel){
  if(sel.value === '__add__'){
    openAddRetailerModal(sel);
  }
}

function openAddRetailerModal(triggerSel){
  const existing = document.getElementById('addRetailerPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'addRetailerPopup';
  popup.style.cssText = 'position:fixed;inset:0;z-index:3000;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;';
  popup.innerHTML = '<div style="background:#fff;border-radius:14px;padding:20px;max-width:380px;width:calc(100% - 32px);box-shadow:0 8px 40px rgba(0,0,0,0.18);">'
    + '<div style="font-size:15px;font-weight:600;margin-bottom:12px;">🏪 Manage retailers</div>'
    + '<div id="retailerListManage" style="margin-bottom:12px;"></div>'
    + '<div style="display:flex;gap:8px;margin-bottom:12px;">'
    + '<input type="text" id="newRetailerInput" placeholder="Add new retailer…" style="flex:1;font-size:13px;" autocomplete="off">'
    + '<button onclick="addRetailerFromModal()" style="padding:6px 12px;border:none;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;font-size:13px;">Add</button>'
    + '</div>'
    + '<button onclick="document.getElementById(\x27addRetailerPopup\x27).remove()" style="width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer;font-family:inherit;font-size:13px;">Done</button>'
    + '</div>';
  document.body.appendChild(popup);
  renderRetailerManageList(triggerSel);
  const inp = document.getElementById('newRetailerInput');
  if(inp) inp.addEventListener('keydown', e => { if(e.key==='Enter') addRetailerFromModal(); });
  if(triggerSel) triggerSel.value = '';
}

function renderRetailerManageList(triggerSel){
  const wrap = document.getElementById('retailerListManage');
  if(!wrap) return;
  const allCustom = customRetailers;
  if(!allCustom.length){
    wrap.innerHTML = '<div style="font-size:12px;color:#aaa;padding:4px 0;">No custom retailers yet.</div>';
    return;
  }
  wrap.innerHTML = allCustom.map((r,i) =>
    '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid #f5f5f0;">'
    + '<span style="flex:1;font-size:13px;">' + r + '</span>'
    + '<button data-idx="' + i + '" onclick="renameRetailer(this.dataset.idx)" style="font-size:11px;padding:2px 8px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;font-family:inherit;">✎ Rename</button>'
    + '<button data-idx="' + i + '" onclick="deleteRetailer(this.dataset.idx)" style="font-size:11px;padding:2px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff5f5;color:#dc2626;cursor:pointer;font-family:inherit;">✕</button>'
    + '</div>'
  ).join('');
}

function addRetailerFromModal(){
  const inp = document.getElementById('newRetailerInput');
  const name = inp ? inp.value.trim() : '';
  if(!name) return;
  if(!customRetailers.includes(name)){
    customRetailers.push(name);
    saveRetailers();
    renderRetailerOptions();
  }
  if(inp) inp.value = '';
  renderRetailerManageList(null);
}

function renameRetailer(idx){
  const old = customRetailers[parseInt(idx)];
  const newName = prompt('Rename "' + old + '" to:', old);
  if(!newName || !newName.trim() || newName.trim() === old) return;
  const n = newName.trim();
  // Update in customRetailers
  customRetailers[parseInt(idx)] = n;
  // Update any storeOverrides that used the old name
  Object.keys(storeOverrides).forEach(k => {
    if(storeOverrides[k] === old) storeOverrides[k] = n;
  });
  // Update myIngredients retailer field
  myIngredients.forEach(ing => { if(ing.retailer === old) ing.retailer = n; });
  saveRetailers();
  localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
  saveMyDB();
  renderRetailerOptions();
  renderRetailerManageList(null);
}

function deleteRetailer(idx){
  const name = customRetailers[parseInt(idx)];
  if(!confirm('Remove "' + name + '" from retailers?')) return;
  customRetailers.splice(parseInt(idx), 1);
  saveRetailers();
  renderRetailerOptions();
  renderRetailerManageList(null);
}

// ════════════════════════════════════════════════════════════
// RETAILER PRICE LIBRARY
// retailerPrices[ingredientNameLC][retailer] = {price, unit, date, source}
// Populated from receipts, live lookup, manual entry
// Used to suggest cheapest store and compare prices
// ════════════════════════════════════════════════════════════

let retailerPrices = {};

function loadRetailerPrices(){
  try { retailerPrices = JSON.parse(localStorage.getItem('bartender_retailer_prices')||'{}'); }
  catch(e){ retailerPrices = {}; }
}

function saveRetailerPrices(){
  localStorage.setItem('bartender_retailer_prices', JSON.stringify(retailerPrices));
}

function setRetailerPrice(ingredientName, retailer, price, unit, source){
  const k = ingredientName.toLowerCase().trim();
  if(!retailerPrices[k]) retailerPrices[k] = {};
  retailerPrices[k][retailer] = {
    price: parseFloat(price),
    unit: unit || 'oz',
    date: new Date().toISOString().split('T')[0],
    source: source || 'manual'
  };
  saveRetailerPrices();
}

function getCheapestRetailer(ingredientName, unit){
  const k = ingredientName.toLowerCase().trim();
  const prices = retailerPrices[k];
  if(!prices || !Object.keys(prices).length) return null;
  let best = null;
  Object.entries(prices).forEach(([store, entry]) => {
    if(!entry.price) return;
    const priceInUnit = unit === entry.unit ? entry.price
      : unit === 'oz' && entry.unit === 'ml' ? entry.price * 29.57
      : entry.price;
    if(!best || priceInUnit < best.price) best = {store, price: entry.price, unit: entry.unit, date: entry.date, source: entry.source};
  });
  return best;
}

function renderRetailerPriceLibrary(){
  const wrap = el('retailerPriceLibContent');
  if(!wrap) return;

  const allKeys = Object.keys(retailerPrices).sort();
  if(!allKeys.length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;font-size:13px;">'
      + 'No retailer prices yet. Prices are recorded when you scan receipts or use the 🔍 price lookup button.</div>';
    return;
  }

  const baseRetailers = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online'];
  const allRetailers = [...new Set([...baseRetailers, ...customRetailers,
    ...Object.values(retailerPrices).flatMap(r => Object.keys(r))])].filter(Boolean);

  // Manual entry row
  const addFormHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;background:#f9f9f6;border-radius:8px;padding:10px;margin-bottom:12px;">'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Ingredient</label><input type="text" id="rpNewName" placeholder="e.g. Hendricks Gin" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:160px;"></div>'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Store</label><input type="text" id="rpNewStore" placeholder="e.g. SAQ" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:100px;"></div>'
    + '<div><label style="font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#aaa;display:block;margin-bottom:3px;">Price ($/oz)</label><input type="number" id="rpNewPrice" placeholder="2.50" step="0.01" style="font-size:13px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:90px;"></div>'
    + '<button onclick="addManualRetailerPrice()" style="padding:6px 12px;border:none;border-radius:8px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;font-size:13px;">+ Add</button>'
    + '</div>';

  if(wrap.querySelector('#rpAddForm') === null){
    const addDiv = document.createElement('div');
    addDiv.id = 'rpAddForm';
    addDiv.innerHTML = addFormHtml;
    wrap.prepend(addDiv);
  }

  let html = '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  html += '<thead><tr style="border-bottom:2px solid #e5e5e0;">'
    + '<th style="text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#aaa;">Ingredient</th>'
    + allRetailers.map(r => '<th style="text-align:right;padding:6px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#aaa;min-width:60px;">' + r + '</th>').join('')
    + '<th style="text-align:right;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#1a7a4a;">Best</th>'
    + '</tr></thead><tbody>';

  allKeys.forEach((k, rowIdx) => {
    const prices = retailerPrices[k];
    const best = getCheapestRetailer(k, 'oz');
    html += '<tr style="border-bottom:0.5px solid #f5f5f0;background:' + (rowIdx%2===0?'#fff':'#fafaf7') + ';">'
      + '<td style="padding:6px 8px;font-weight:500;">' + k + '</td>'
      + allRetailers.map(r => {
          const entry = prices[r];
          if(!entry) return '<td style="text-align:right;padding:6px 4px;color:#ddd;">—</td>';
          const isBest = best && best.store === r;
          return '<td style="text-align:right;padding:6px 4px;font-weight:' + (isBest?'700':'400') + ';color:' + (isBest?'#1a7a4a':'#555') + ';">'
            + '$' + entry.price.toFixed(2) + '<br><span style="font-size:10px;color:#aaa;">/' + entry.unit + '</span></td>';
        }).join('')
      + '<td style="text-align:right;padding:6px 8px;font-size:11px;font-weight:600;color:#1a7a4a;">' + (best ? best.store : '—') + '</td>'
      + '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

// Auto-record prices when lookupPrice returns a result
function addManualRetailerPrice(){
  const name = (document.getElementById('rpNewName')||{}).value?.trim();
  const store = (document.getElementById('rpNewStore')||{}).value?.trim();
  const price = parseFloat((document.getElementById('rpNewPrice')||{}).value);
  if(!name || !store || isNaN(price) || price <= 0){
    showToast('Fill in ingredient, store, and price', 'error');
    return;
  }
  setRetailerPrice(name, store, price, 'oz', 'manual');
  const ni = document.getElementById('rpNewName'); if(ni) ni.value='';
  const si = document.getElementById('rpNewStore'); if(si) si.value='';
  const pi = document.getElementById('rpNewPrice'); if(pi) pi.value='';
  renderRetailerPriceLibrary();
  showToast('Price saved for '+name+' @ '+store, 'success');
}

function recordRetailerPrice(ingredientName, store, price, unit, source){
  if(!store || !price || price <= 0) return;
  setRetailerPrice(ingredientName, store, price, unit, source);
}

// ── Per-item store overrides ─────────────────────────────
let storeOverrides = {};
function loadStoreOverrides(){
  try{ storeOverrides = JSON.parse(localStorage.getItem('bartender_store_overrides')||'{}'); }
  catch(e){ storeOverrides = {}; }
}
function saveStoreOverride(name, store){
  storeOverrides[name.toLowerCase()] = store;
  localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
}

function changeItemStore(pillEl, event){
  if(event) event.stopPropagation();
  const name = (typeof pillEl === 'string') ? pillEl : (pillEl.dataset && pillEl.dataset.name) || pillEl.getAttribute('data-name') || '';
  if(!name) return;

  // Close any open store pickers
  document.querySelectorAll('.store-picker-popup').forEach(p => p.remove());

  const allStores = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online','Grocery'];
  const extras = (customRetailers||[]).filter(r => !allStores.includes(r));
  const stores = [...allStores, ...extras];
  const currentStore = storeOverrides[name.toLowerCase().trim()] || '';

  const popup = document.createElement('div');
  popup.className = 'store-picker-popup';
  popup.style.cssText = 'position:fixed;z-index:2000;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:10px;box-shadow:0 4px 24px rgba(0,0,0,0.14);min-width:220px;max-height:320px;overflow-y:auto;';

  // Position near the pill
  const rect = pillEl.getBoundingClientRect();
  const popH = 340;
  const spaceBelow = window.innerHeight - rect.bottom;
  const topPos = spaceBelow >= popH + 10 ? rect.bottom + 6 : Math.max(10, rect.top - popH - 6);
  popup.style.top = topPos + 'px';
  popup.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 248)) + 'px';

  popup.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#aaa;margin-bottom:8px;padding:0 2px;">'
    + 'Buy at — ' + name + '</div>';

  stores.forEach(store => {
    const isActive = store === currentStore;
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;font-size:13px;font-weight:'+(isActive?'600':'400')+';background:'+(isActive?'#e8f0fd':'transparent')+';color:'+(isActive?'#2156b8':'#1a1a1a')+';margin-bottom:2px;';
    btn.textContent = (isActive ? '✓ ' : '') + store;
    btn.onclick = () => {
      storeOverrides[name.toLowerCase().trim()] = store;
      localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
      popup.remove();
      rShop(); // re-render the shopping list
    };
    popup.appendChild(btn);
  });

  // Auto-detect option
  const autoBtn = document.createElement('button');
  autoBtn.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 10px;border-radius:8px;border:1px dashed #ddd;cursor:pointer;font-family:inherit;font-size:12px;color:#aaa;margin-top:4px;background:transparent;';
  autoBtn.textContent = '↺ Auto-detect';
  autoBtn.onclick = () => {
    delete storeOverrides[name.toLowerCase().trim()];
    localStorage.setItem('bartender_store_overrides', JSON.stringify(storeOverrides));
    popup.remove();
    rShop();
  };
  popup.appendChild(autoBtn);
  document.body.appendChild(popup);

  setTimeout(() => {
    document.addEventListener('click', function closeCSP(e){
      if(!popup.contains(e.target) && !e.target.classList.contains('store-pill')){
        popup.remove();
        document.removeEventListener('click', closeCSP);
      }
    });
  }, 200);
}
function inferStore(item){
    // 0. User override (set by tapping the store pill)
    const override = storeOverrides[item.name.toLowerCase()];
    if(override) return override;

    // 1. Custom ingredient explicit retailer field
    const custom = myIngredients.find(i => i.name.toLowerCase() === item.name.toLowerCase());
    if(custom && custom.retailer) return custom.retailer;

    // 1.5. Retailer price library — use cheapest known store
    const bestRetailer = getCheapestRetailer(item.name, item.unit || 'oz');
    if(bestRetailer && bestRetailer.store) return bestRetailer.store;

    // 2. INGDB built-in — partial name match then check note
    const nameLC = item.name.toLowerCase();
    for(const [cat, items2] of Object.entries(INGDB)){
      const found = items2.find(i => {
        const iLC = i.name.toLowerCase();
        return iLC === nameLC || iLC.includes(nameLC) || nameLC.includes(iLC.split(' ')[0]);
      });
      if(found && found.note){
        const note = found.note.toLowerCase();
        if(note.includes('aubut')) return 'Aubut';
        if(note.includes('saq')) return 'SAQ';
        if(note.includes('iga') || note.includes('metro') || note.includes('maxi')) return 'Grocery';
        if(note.includes('costco')) return 'Costco';
      }
    }

    // 3. Guess by ingredient type
    const nm = item.name.toLowerCase();
    if(nm.includes('gin') || nm.includes('vodka') || nm.includes('rum') || nm.includes('whisky') ||
       nm.includes('whiskey') || nm.includes('tequila') || nm.includes('mezcal') || nm.includes('cognac') ||
       nm.includes('liqueur') || nm.includes('campari') || nm.includes('aperol') || nm.includes('vermouth') ||
       nm.includes('amaro') || nm.includes('chartreuse') || nm.includes('cointreau') || nm.includes('baileys') ||
       nm.includes('kahlua') || nm.includes('beer') || nm.includes('wine') || nm.includes('champagne') ||
       nm.includes('prosecco') || nm.includes('cava') || nm.includes('port') || nm.includes('sherry')) return 'SAQ';
    if(nm.includes('monin') || nm.includes('clamato') || nm.includes('fever-tree') ||
       nm.includes('schweppes') || nm.includes('canada dry') || nm.includes('san pellegrino') ||
       nm.includes('cup') || nm.includes('napkin') || nm.includes('straw') || nm.includes('walter')) return 'Aubut';
    if(nm.includes('juice') || nm.includes('soda') || nm.includes('water') || nm.includes('syrup') ||
       nm.includes('honey') || nm.includes('sugar') || nm.includes('salt') || nm.includes('lime') ||
       nm.includes('lemon') || nm.includes('orange') || nm.includes('mint') || nm.includes('basil') ||
       nm.includes('cream') || nm.includes('egg') || nm.includes('milk') || nm.includes('coffee')) return 'Grocery';
    return 'Other';
  }

  // Tag each non-covered item with store + last receipt price date
  items.filter(i => !i.fullyCoVered).forEach(item => {
    item.store = inferStore(item);
    // Find most recent receipt-sourced price for this item
    const key = item.name.toLowerCase().trim();
    const hist = priceHistory[key];
    if(hist && hist.length){
      const receiptPrices = hist.filter(p => p.source === 'receipt').sort((a,b) => b.date.localeCompare(a.date));
      if(receiptPrices.length){
        item.lastReceiptPrice = receiptPrices[0].price;
        item.lastReceiptDate  = receiptPrices[0].date;
        item.lastReceiptStore = receiptPrices[0].store;
        // Flag if current price differs from receipt price by > 10%
        const diff = Math.abs(item.cpu - item.lastReceiptPrice) / item.lastReceiptPrice;
        item.priceStaleness = diff > 0.1 ? 'outdated' : 'fresh';
      }
    }
  });

  // Group items to buy by store
  const storeGroups = {};
  // Base stores + any custom retailers he's added
  const baseStoreOrder = ['SAQ', 'Aubut', 'IGA', 'Metro', 'Maxi', 'Costco', 'Walmart', 'Marché Jean-Talon', 'Dépanneur', 'Online', 'Grocery'];
  const customStoreOrder = (customRetailers||[]).filter(r => !baseStoreOrder.includes(r));
  const storeOrder = [...baseStoreOrder, ...customStoreOrder, 'Other'];
  const storeEmoji = {SAQ:'🍷',Aubut:'🛒',IGA:'🛍',Metro:'🛍',Maxi:'🛍',Costco:'🏪',Walmart:'🏪','Marché Jean-Talon':'🌿',Dépanneur:'🏪',Online:'💻',Grocery:'🛍',Other:'📦'};
  const storeColor = {SAQ:'#7c3aed',Aubut:'#0891b2',IGA:'#059669',Metro:'#059669',Maxi:'#059669',Costco:'#d97706',Walmart:'#2563eb','Marché Jean-Talon':'#16a34a',Dépanneur:'#6b7280',Online:'#0284c7',Grocery:'#059669',Other:'#6b7280'};
  items.filter(i => !i.fullyCoVered).forEach(item => {
    const store = item.store || 'Other';
    if(!storeGroups[store]) storeGroups[store] = [];
    storeGroups[store].push(item);
  });

  // Build store-grouped HTML
  const storeHTML = storeOrder.filter(s => storeGroups[s]).map(store => {
    const grpItems = storeGroups[store];
    const grpTotal = grpItems.reduce((s,i) => s+(i.purchaseCostAdjusted||i.purchaseCost),0);
    const rows = grpItems.map(i => {
      if(i.bottleInfo){
        const pct = Math.round((i.stillNeeded/((i.bottlesBuy||1)*i.bottleInfo.bottleOz))*100);
        const barColor = pct>=80?'#1a7a4a':pct>=50?'#e69c00':'#c0392b';
        const stockNote = i.inStock > 0 ? ` <span style="font-size:10px;color:#1a7a4a;">(have ${i.inStock.toFixed(1)}${i.unit})</span>` : '';
        const priceTag = i.lastReceiptDate
          ? (i.priceStaleness === 'outdated'
              ? `<span title="Receipt price $${i.lastReceiptPrice.toFixed(2)}/oz from ${i.lastReceiptDate} — may have changed" style="font-size:10px;padding:1px 6px;border-radius:10px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;cursor:default;">⚠ $${i.lastReceiptPrice.toFixed(2)} receipt</span>`
              : `<span title="Confirmed from receipt at ${i.lastReceiptStore} on ${i.lastReceiptDate}" style="font-size:10px;padding:1px 6px;border-radius:10px;background:#d1fae5;color:#065f46;border:1px solid #a7f3d0;cursor:default;">✓ $${i.lastReceiptPrice.toFixed(2)} receipt</span>`)
          : '';
        return `<div class="sr" style="align-items:start;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:13px;">${i.name}</span><span class="store-pill" onclick="event.stopImmediatePropagation();changeItemStore(this,event)" data-name="${i.name}" title="Tap to change retailer" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #c5d8f8;background:#e8f0fd;color:#2156b8;cursor:pointer;font-weight:500;">✎ ${i.store||'?'}</span>${priceTag}</div>${stockNote}
            <div style="font-size:11px;color:#aaa;margin-top:2px;">${i.stillNeeded.toFixed(1)} oz needed · ${i.bottlesBuy} × ${i.bottleInfo.bottleLabel}</div>
            <div style="margin-top:4px;background:#eee;border-radius:4px;height:4px;width:100%;max-width:160px;overflow:hidden;"><div style="height:4px;border-radius:4px;background:${barColor};width:${pct}%;"></div></div>
          </div>
          <div style="text-align:right;"><div style="font-size:13px;font-weight:500;">${i.bottlesBuy} bottle${i.bottlesBuy!==1?'s':''}</div></div>
          <div style="text-align:right;"><div style="font-size:12px;color:#1a7a4a;">+${i.leftover.toFixed(1)} oz left</div></div>
          <div style="text-align:right;font-weight:500;">$${(i.purchaseCostAdjusted||0).toFixed(2)}</div>
        </div>`;
      } else {
        const freshTag2 = i.lastReceiptDate
          ? `<span style="font-size:10px;color:#065f46;"> ✓ receipt ${i.lastReceiptDate}</span>`
          : `<span style="font-size:10px;color:#aaa;"> est.</span>`;
        return `<div class="sr" style="align-items:center;">
          <div>
            <span style="font-size:13px;">${i.name}</span>
            <span class="store-pill" onclick="changeItemStore(this,event)" data-name="${i.name}" title="Tap to change retailer" style="font-size:10px;padding:2px 8px;border-radius:10px;border:1px solid #c5d8f8;background:#e8f0fd;color:#2156b8;cursor:pointer;margin-left:5px;font-weight:500;">✎ ${i.store||'?'}</span>
          </div>
          <span>${(i.stillNeeded||i.qtyRaw).toFixed(1)} ${i.unit}</span>
          <span></span>
          <span>$${(i.purchaseCostAdjusted||i.purchaseCost).toFixed(2)}${freshTag2}</span>
        </div>`;
      }
    }).join('');
    return `<div style="margin-bottom:14px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:16px;">${storeEmoji[store]}</span>
          <span style="font-size:13px;font-weight:600;color:${storeColor[store]};">${store}</span>
          <span style="font-size:11px;color:#aaa;">${grpItems.length} item${grpItems.length!==1?'s':''}</span>
        </div>
        <span style="font-size:13px;font-weight:500;">$${grpTotal.toFixed(2)}</span>
      </div>
      <div class="card" style="padding:0.5rem 1rem;">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding-bottom:4px;border-bottom:1px solid #f0f0eb;margin-bottom:4px;">
          <span>Ingredient</span><span>Bottles/Qty</span><span>Leftover</span><span>Cost</span>
        </div>
        ${rows}
      </div>
    </div>`;
  }).join('');

  shtml('slist',`
    <div style="font-size:12px;background:#e8f0fd;color:#2156b8;border-radius:8px;padding:8px 12px;margin-bottom:10px;border:1px solid #c5d8f8;">
      🍾 <strong>Bottle optimized:</strong> Quantities rounded up to full bottles so you never run short. 
      The progress bar shows how full each bottle will be — green means efficient, red means a lot left over (consider reselling or sharing across events).
    </div>
    ${storeHTML}
    ${Object.keys(storeGroups).length === 0 ? '<div class="empty" style="padding:1rem;text-align:center;color:#aaa;">✅ Everything already in inventory — nothing to buy!</div>' : ''}
    <div class="card" style="padding:10px 14px;background:#f9f9f6;margin-top:4px;">
      <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:600;">
        <span>Total to spend</span>
        <span>$${tcPurchase.toFixed(2)} CAD</span>
      </div>
      ${stockSavings > 0 ? '<div style="font-size:11px;color:#1a7a4a;margin-top:3px;">📦 Inventory covers $'+stockSavings.toFixed(2)+' — already have those bottles</div>' : ''}
      ${totalLeftoverVal > 0 ? '<div style="font-size:11px;color:#888;margin-top:2px;">~$'+totalLeftoverVal.toFixed(2)+' resalable leftover across all purchases</div>' : ''}
    </div>
    <p class="cad-note">* Split by store to reduce trips. Bottle sizes: spirits/wine = 750ml (25.4oz), juices/sodas = 1L (33.8oz), syrups = 250ml.</p>`);
}

function exportCombinedShoppingList(){
  const confirmedEvents = eventLibrary.filter(e => (e.status||'draft') === 'confirmed');
  if(!confirmedEvents.length){ alert('No confirmed events to combine.'); return; }

  // Merge ingredient quantities across all confirmed events
  const merged = {};
  confirmedEvents.forEach(ev => {
    const state = ev.state;
    if(!state || !state.cocktails) return;
    const gsts = state.guestCount || 50;
    const dpp = (state.consumptionModel && state.consumptionModel.drinksPerPerson) || 5;
    const buf = (state.consumptionModel && state.consumptionModel.bufferPct) || 0;

    state.cocktails.forEach(cocktail => {
      const totalDrinks = Math.round(gsts * dpp * (1+buf/100) * cocktail.dpg);
      (cocktail.ing || []).forEach(ing => {
        const key = ing.n.toLowerCase().trim();
        const totalQty = ing.q * totalDrinks;
        if(!merged[key]){
          merged[key] = { name: ing.n, unit: ing.u, totalQty: 0, cpu: ing.c, events: [] };
        }
        merged[key].totalQty += totalQty;
        if(!merged[key].events.includes(ev.label)) merged[key].events.push(ev.label);
      });
    });
  });

  // Generate the HTML shopping list
  const items = Object.values(merged).sort((a,b) => (b.totalQty*b.cpu)-(a.totalQty*a.cpu));
  const totalCost = items.reduce((s,i) => s+(i.totalQty*i.cpu), 0);
  const eventNames = confirmedEvents.map(e=>e.label).join(' + ');
  const today = new Date().toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});

  const rows = items.map(i => {
    const bottles = i.unit === 'oz' ? Math.ceil(i.totalQty/25.36) : null;
    const qtyLabel = bottles ? bottles + ' bottle' + (bottles!==1?'s':'') : i.totalQty.toFixed(1) + ' ' + i.unit;
    const storeHint = i.cpu > 1.5 ? 'SAQ' : 'Grocery';
    const evtBadges = i.events.map(ev => '<span style="font-size:10px;background:#e8f0fd;color:#2156b8;padding:1px 6px;border-radius:10px;margin-right:3px;">'+ev+'</span>').join('');
    return `<li class="item" onclick="this.classList.toggle('checked')">
      <div><div class="cb">${i.name}</div><div style="font-size:11px;color:#aaa;margin-top:2px;">${evtBadges}</div></div>
      <span class="amt">${qtyLabel}</span>
      <span class="store">${storeHint}</span>
      <span class="price">$${(i.totalQty*i.cpu).toFixed(2)}</span>
    </li>`;
  }).join('');

  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Combined shopping list</title>'
    + '<style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f9f9f6;padding-bottom:80px;}'
    + 'header{background:#1a1a1a;color:#fff;padding:1rem 1.25rem;position:sticky;top:0;z-index:10;}'
    + 'h1{font-size:16px;font-weight:600;margin-bottom:2px;}header p{font-size:12px;color:#aaa;}'
    + '.progress-bar{height:4px;background:rgba(255,255,255,0.2);margin-top:8px;border-radius:2px;overflow:hidden;}'
    + '.progress-fill{height:100%;background:#4ade80;border-radius:2px;transition:width .3s;}'
    + 'ul{list-style:none;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e0;margin:1rem 0.75rem 0;}'
    + 'li.item{display:grid;grid-template-columns:1fr auto auto auto;gap:8px;align-items:center;padding:13px 14px;border-bottom:.5px solid #f0f0eb;cursor:pointer;}'
    + 'li.item:last-child{border-bottom:none;}li.item.checked{background:#f0faf5;}'
    + 'li.item.checked .cb{text-decoration:line-through;color:#aaa;}'
    + '.cb{font-size:15px;font-weight:500;}.amt{font-size:12px;color:#666;background:#f5f5f0;padding:2px 8px;border-radius:20px;white-space:nowrap;}'
    + '.store{font-size:11px;color:#aaa;}.price{font-size:13px;font-weight:500;color:#1a7a4a;min-width:48px;text-align:right;}'
    + '.footer{position:fixed;bottom:0;left:0;right:0;background:#fff;border-top:1px solid #e5e5e0;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;}'
    + '.footer-total{font-size:16px;font-weight:600;}.footer-checked{font-size:13px;color:#888;}'
    + '</style></head><body>'
    + '<header><h1>Combined shopping list</h1><p>' + today + ' · ' + confirmedEvents.length + ' events · ' + items.length + ' items</p>'
    + '<p style="font-size:11px;color:#aaa;margin-top:3px;">' + eventNames + '</p>'
    + '<div class="progress-bar"><div class="progress-fill" id="prog" style="width:0%"></div></div></header>'
    + '<ul>' + rows + '</ul>'
    + '<div class="footer"><div><div class="footer-total">$' + totalCost.toFixed(2) + ' CAD</div>'
    + '<div class="footer-checked" id="cc">0 of ' + items.length + ' checked</div></div></div>'
    + '<script>const tot='+items.length+';'
    + 'function upd(){const ch=document.querySelectorAll("li.checked").length;'
    + 'document.getElementById("prog").style.width=(ch/tot*100)+"%";'
    + 'document.getElementById("cc").textContent=ch+" of "+tot+" checked";}'
    + 'document.querySelectorAll("li.item").forEach(li=>li.addEventListener("click",upd));'
    + '<'+'/script></body></html>';

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html],{type:'text/html'}));
  a.download = 'combined_shopping_list.html';
  a.click();
  showToast('Combined list exported for ' + confirmedEvents.length + ' events', 'success');
}

// ════════════════════════════════════════════════════════════
function getShoppingDeadlineInfo(targetDateStr){
  // Given an event date string (YYYY-MM-DD), calculate:
  // - days until the event
  // - recommended shopping deadline (2 days before)
  // - urgency level
  if(!targetDateStr) return null;

  const today = new Date();
  today.setHours(0,0,0,0);
  const eventDate = new Date(targetDateStr + 'T12:00:00');
  const diffMs = eventDate - today;
  const daysUntil = Math.ceil(diffMs / (1000*60*60*24));

  // Recommend shopping 2 days before (leaves 1 day buffer for last-minute items)
  const shopByDate = new Date(eventDate);
  shopByDate.setDate(shopByDate.getDate() - 2);
  const shopDiffMs = shopByDate - today;
  const daysToShopBy = Math.ceil(shopDiffMs / (1000*60*60*24));

  const eventDateFmt = eventDate.toLocaleDateString('en-CA',{weekday:'long',month:'long',day:'numeric'});
  const shopByFmt = shopByDate.toLocaleDateString('en-CA',{weekday:'long',month:'short',day:'numeric'});

  // Urgency levels
  let urgency, icon, bgColor, borderColor, textColor, msg;

  if(daysUntil < 0){
    urgency = 'past';
    icon = '🎉';
    bgColor = '#f5f5f0'; borderColor = '#ddd'; textColor = '#888';
    msg = 'This event already happened ' + Math.abs(daysUntil) + ' day' + (Math.abs(daysUntil)!==1?'s':'') + ' ago.';
  } else if(daysUntil === 0){
    urgency = 'today';
    icon = '🚨';
    bgColor = '#fdf0ef'; borderColor = '#f5c0ba'; textColor = '#c0392b';
    msg = "Event is TODAY — shopping should already be done!";
  } else if(daysUntil === 1){
    urgency = 'tomorrow';
    icon = '🚨';
    bgColor = '#fdf0ef'; borderColor = '#f5c0ba'; textColor = '#c0392b';
    msg = "Event is TOMORROW — buy everything today if you haven't already!";
  } else if(daysToShopBy <= 0){
    urgency = 'overdue';
    icon = '⚠';
    bgColor = '#fdf5e8'; borderColor = '#f0d080'; textColor = '#a06020';
    msg = 'Shopping deadline has passed (should have bought ' + Math.abs(daysToShopBy) + ' day' + (Math.abs(daysToShopBy)!==1?'s':'') + ' ago) — buy now!';
  } else if(daysToShopBy <= 2){
    urgency = 'urgent';
    icon = '⚠';
    bgColor = '#fdf5e8'; borderColor = '#f0d080'; textColor = '#a06020';
    msg = 'Shop by ' + shopByFmt + ' (' + daysToShopBy + ' day' + (daysToShopBy!==1?'s':'') + ' away) — event is ' + eventDateFmt + '.';
  } else if(daysToShopBy <= 5){
    urgency = 'soon';
    icon = '🛒';
    bgColor = '#e8f0fd'; borderColor = '#b5d4f4'; textColor = '#2156b8';
    msg = 'Shop by ' + shopByFmt + ' — ' + daysToShopBy + ' days away. Event: ' + eventDateFmt + '.';
  } else {
    urgency = 'ok';
    icon = '✓';
    bgColor = '#edfaf3'; borderColor = '#c8e6d4'; textColor = '#1a7a4a';
    msg = 'Plenty of time — shop by ' + shopByFmt + '. Event: ' + eventDateFmt + ' (' + daysUntil + ' days away).';
  }

  return { urgency, icon, bgColor, borderColor, textColor, msg, daysUntil, daysToShopBy, shopByFmt, eventDateFmt };
}

function renderShoppingDeadline(){
  const bannerEl = el('shoppingDeadlineBanner');
  if(!bannerEl) return;

  // Current event deadline
  const currentDate = v('ed');
  const currentStatus = v('quoteStatus') || 'draft';

  // Find the soonest confirmed event (including current if confirmed)
  const allDates = [];

  // Add current event if it has a date and is confirmed/sent
  if(currentDate && ['confirmed','sent','draft'].includes(currentStatus)){
    allDates.push({ label: v('eventLabel') || 'Current event', date: currentDate, status: currentStatus, isCurrent: true });
  }

  // Add confirmed events from library
  eventLibrary.forEach(e => {
    if(e.eventDate && (e.status === 'confirmed') && e.label !== v('eventLabel')){
      allDates.push({ label: e.label, date: e.eventDate, status: e.status, isCurrent: false });
    }
  });

  if(!allDates.length){
    bannerEl.innerHTML = '';
    return;
  }

  // Sort by date to find soonest
  allDates.sort((a,b) => new Date(a.date) - new Date(b.date));
  const soonest = allDates[0];
  const info = getShoppingDeadlineInfo(soonest.date);
  if(!info || info.urgency === 'past') {
    bannerEl.innerHTML = '';
    return;
  }

  // Build the callout
  let html = '<div style="background:' + info.bgColor + ';border:1px solid ' + info.borderColor + ';border-radius:10px;padding:12px 14px;font-size:13px;color:' + info.textColor + ';">';
  html += '<div style="display:flex;align-items:flex-start;gap:10px;">';
  html += '<span style="font-size:20px;flex-shrink:0;">' + info.icon + '</span>';
  html += '<div style="flex:1;">';
  html += '<div style="font-weight:600;margin-bottom:3px;">';

  // If shopping for multiple events at once
  if(allDates.length > 1 && !soonest.isCurrent){
    html += 'Shop for ' + allDates.length + ' events by ' + info.shopByFmt;
  } else {
    html += info.urgency === 'ok' ? 'Shopping window open' : info.urgency === 'overdue' ? 'Shopping overdue!' : 'Shopping deadline approaching';
  }
  html += '</div>';
  html += '<div style="line-height:1.6;">' + info.msg + '</div>';

  // If combining events, list them
  if(allDates.length > 1){
    html += '<div style="margin-top:6px;font-size:12px;opacity:0.85;">Covering: ' + allDates.map(d => {
      const di = getShoppingDeadlineInfo(d.date);
      return '<strong>' + d.label + '</strong> (' + (di ? di.eventDateFmt : d.date) + ')';
    }).join(' + ') + '</div>';
  }

  html += '</div></div></div>';
  bannerEl.innerHTML = html;

  // Also update the combined deadline line in the Events tab
  const combinedLine = el('combinedDeadlineLine');
  if(combinedLine && allDates.length > 1){
    combinedLine.innerHTML = info.icon + ' Buy by <strong>' + info.shopByFmt + '</strong> — soonest event is ' + info.eventDateFmt + ' (' + info.daysUntil + ' day' + (info.daysUntil!==1?'s':'') + ' away)';
  }
}

// ════════════════════════════════════════════════════════════
function getIMForEvent(evState){
  // Reconstruct getIM() logic for a saved event state
  const m = {};
  const guests = evState.guestCount || 0;
  if(!guests || !evState.cocktails || !evState.cocktails.length) return [];
  const cm = evState.consumptionModel || {};
  const dpp = cm.drinksPerPerson || 5;
  const buf = (cm.bufferPct || 0) / 100;
  const totalDPP = dpp * (1 + buf);
  const rawWeights = evState.cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b, 0);
  const scale = totalDPP / weightSum;
  evState.cocktails.forEach((ct, i) => {
    const drinksThis = rawWeights[i] * scale;
    const td = drinksThis * guests;
    (ct.ing || []).forEach(g => {
      const k = g.n.toLowerCase().trim();
      if(!m[k]) m[k] = {name:g.n, unit:g.u, qty:0, cpu:g.c};
      m[k].qty += g.q * td;
    });
  });
  return Object.values(m);
}

let masterListSelectedIds = null; // null = all confirmed

function renderMasterList(){
  const wrap = el('masterListContent');
  if(!wrap) return;

  const allConfirmed = eventLibrary.filter(e =>
    e.status === 'confirmed' || e.quoteStatus === 'confirmed'
  );

  if(!allConfirmed.length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;">'
      + '<div style="font-size:32px;margin-bottom:8px;">📅</div>'
      + '<div style="font-weight:500;margin-bottom:4px;">No confirmed events yet</div>'
      + '<div style="font-size:13px;">Mark events as ✅ Confirmed to include them.</div>'
      + '</div>';
    return;
  }

  if(masterListSelectedIds === null)
    masterListSelectedIds = new Set(allConfirmed.map(e => e.id || e.label));

  wrap.innerHTML = '';

  // ── Event selector ──
  const selBox = document.createElement('div');
  selBox.style.cssText = 'background:#f9f9f6;border:1px solid #e5e5e0;border-radius:10px;padding:12px 14px;margin-bottom:14px;';
  selBox.innerHTML = '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:8px;">Include in shopping list</div>';
  const cRow = document.createElement('div');
  cRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
  allConfirmed.forEach(ev => {
    const evId = ev.id || ev.label;
    const checked = masterListSelectedIds.has(evId);
    const lbl = document.createElement('label');
    lbl.style.cssText = 'display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;padding:5px 10px;border-radius:8px;border:1px solid '+(checked?'#1a7a4a':'#e5e5e0')+';background:'+(checked?'#edfaf3':'#fff')+';user-select:none;';
    const chk = document.createElement('input');
    chk.type = 'checkbox'; chk.checked = checked; chk.style.cursor = 'pointer';
    const ds = ev.eventDate ? new Date(ev.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
    lbl.appendChild(chk);
    lbl.appendChild(document.createTextNode((ev.label||'Event')+(ds?' · '+ds:'')+(ev.guestCount?' · '+ev.guestCount+'g':'')));
    chk.addEventListener('change', ()=>{
      if(chk.checked) masterListSelectedIds.add(evId); else masterListSelectedIds.delete(evId);
      renderMasterList();
    });
    cRow.appendChild(lbl);
  });
  selBox.appendChild(cRow);
  wrap.appendChild(selBox);

  const confirmed = allConfirmed.filter(e => masterListSelectedIds.has(e.id || e.label));
  if(!confirmed.length){
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align:center;color:#aaa;font-size:13px;padding:1rem;';
    empty.textContent = 'Select at least one event above.';
    wrap.appendChild(empty);
    return;
  }

  // ── Aggregate all ingredients across confirmed events ──
  const merged = {}; // key → {name, unit, qty, cpu, events:[]}
  confirmed.forEach(ev => {
    const state = ev.fullState || ev;
    const items = getIMForEvent(state);
    items.forEach(item => {
      const k = item.name.toLowerCase().trim();
      if(!merged[k]){
        merged[k] = {name:item.name, unit:item.unit, qty:0, cpu:item.cpu, events:[]};
      }
      merged[k].qty += item.qty;
      merged[k].events.push(ev.label || 'Event');
    });
  });

  if(!Object.keys(merged).length){
    wrap.innerHTML = '<div style="padding:2rem;text-align:center;color:#aaa;">'
      + 'Confirmed events have no cocktails yet. Add cocktails to your events and save them.</div>';
    return;
  }

  // ── Convert to items array with bottle info ──
  const items = Object.values(merged).sort((a,b)=>a.name.localeCompare(b.name));
  items.forEach(item => {
    const bi = getBottleInfo(item.name, item.unit);
    item.bottleInfo = bi;
    if(bi){
      item.qtyRaw = item.qty;
      item.bottles = Math.ceil(item.qty / bi.bottleOz);
      item.qtyRounded = item.bottles * bi.bottleOz;
      item.leftover = item.qtyRounded - item.qty;
      item.purchaseCost = item.bottles * (bi.bottleOz * item.cpu);
      item.leftoverValue = item.leftover * item.cpu;
    } else {
      item.qtyRaw = item.qty;
      item.purchaseCost = item.qty * item.cpu;
      item.leftoverValue = 0;
    }
    // Stock cross-reference
    const stockKey = item.name.toLowerCase().trim();
    let stock = currentStock[stockKey];
    if(!stock){
      const keys = Object.keys(currentStock);
      const pk = keys.find(k => k.includes(stockKey.split(' ')[0]) || stockKey.includes(k.split(' ')[0]));
      if(pk) stock = currentStock[pk];
    }
    if(stock && stock.qty > 0){
      const sq = stock.unit === item.unit ? stock.qty
        : stock.unit==='oz' && item.unit==='ml' ? stock.qty*29.57
        : stock.unit==='ml' && item.unit==='oz' ? stock.qty/29.57
        : stock.qty;
      item.inStock = sq;
      item.stillNeeded = Math.max(0, item.qtyRaw - sq);
      item.fullyCoVered = item.stillNeeded <= 0;
      if(item.bottleInfo && item.stillNeeded > 0){
        item.bottlesBuy = Math.ceil(item.stillNeeded / item.bottleInfo.bottleOz);
        item.purchaseCostAdjusted = item.bottlesBuy * (item.bottleInfo.bottleOz * item.cpu);
      } else if(item.fullyCoVered){
        item.bottlesBuy = 0;
        item.purchaseCostAdjusted = 0;
      }
    } else {
      item.inStock = 0;
      item.stillNeeded = item.qtyRaw;
      item.fullyCoVered = false;
      item.bottlesBuy = item.bottleInfo ? Math.ceil(item.qtyRaw / item.bottleInfo.bottleOz) : 0;
      item.purchaseCostAdjusted = item.purchaseCost;
    }
    item.store = inferStore(item);
  });

  // ── Group by store ──
  const storeOrder = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Grocery','Other'];
  const storeEmoji = {SAQ:'🍷',Aubut:'🛒',IGA:'🛍',Metro:'🛍',Maxi:'🛍',Costco:'🏪',Walmart:'🏪','Marché Jean-Talon':'🌿',Grocery:'🛍',Other:'📦'};
  const storeColor = {SAQ:'#7c3aed',Aubut:'#0891b2',Grocery:'#059669',Other:'#6b7280'};
  const groups = {};
  items.filter(i => !i.fullyCoVered).forEach(item => {
    const s = item.store || 'Other';
    if(!groups[s]) groups[s] = [];
    groups[s].push(item);
  });
  const covered = items.filter(i => i.fullyCoVered);

  const totalCost = items.filter(i=>!i.fullyCoVered).reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
  const stockSavings = covered.reduce((s,i)=>s+i.purchaseCost,0);

  // ── Build HTML ──
  const wrap2 = document.createElement('div');

  // Header
  const hdr = document.createElement('div');
  hdr.style.cssText = 'margin-bottom:1rem;';
  hdr.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px;">'
    + '<div><div style="font-size:16px;font-weight:600;">🗂 Master shopping list</div>'
    + '<div style="font-size:12px;color:#888;margin-top:2px;">'
    + confirmed.length + ' confirmed event' + (confirmed.length!==1?'s':'') + ': '
    + confirmed.map(e=>e.label||'Event').join(' · ')
    + '</div></div>'
    + '<div style="text-align:right;">'
    + '<div style="font-size:18px;font-weight:700;">$' + totalCost.toFixed(2) + ' CAD</div>'
    + (stockSavings>0?'<div style="font-size:11px;color:#1a7a4a;">📦 $'+stockSavings.toFixed(2)+' covered by inventory</div>':'')
    + '</div></div>';

  // Event legend
  if(confirmed.length > 1){
    const legend = document.createElement('div');
    legend.style.cssText = 'background:#f9f9f6;border-radius:8px;padding:8px 12px;margin-bottom:10px;font-size:12px;';
    legend.innerHTML = '<div style="font-weight:600;margin-bottom:4px;color:#666;">Events included:</div>'
      + confirmed.map(e => {
          const dateStr = e.eventDate ? new Date(e.eventDate+'T12:00:00').toLocaleDateString('fr-CA',{month:'short',day:'numeric'}) : '';
          return '<span style="margin-right:10px;">✅ '+e.label+(dateStr?' · '+dateStr:'')+(e.guestCount?' · '+e.guestCount+' guests':'')+'</span>';
        }).join('');
    hdr.appendChild(legend);
  }
  wrap2.appendChild(hdr);

  // Store sections
  const allStores = [...storeOrder, ...Object.keys(groups).filter(s=>!storeOrder.includes(s))];
  allStores.filter(s=>groups[s]).forEach(store => {
    const grpItems = groups[store];
    const grpTotal = grpItems.reduce((s,i)=>s+(i.purchaseCostAdjusted||i.purchaseCost),0);
    const color = storeColor[store] || '#6b7280';
    const emoji = storeEmoji[store] || '📦';

    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:14px;';

    const sHdr = document.createElement('div');
    sHdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
    sHdr.innerHTML = '<div style="display:flex;align-items:center;gap:8px;">'
      + '<span style="font-size:16px;">'+emoji+'</span>'
      + '<span style="font-size:13px;font-weight:600;color:'+color+';">'+store+'</span>'
      + '<span style="font-size:11px;color:#aaa;">'+grpItems.length+' item'+(grpItems.length!==1?'s':'')+'</span>'
      + '</div>'
      + '<span style="font-size:13px;font-weight:500;">$'+grpTotal.toFixed(2)+'</span>';
    section.appendChild(sHdr);

    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:0.5rem 1rem;';

    const tableHdr = document.createElement('div');
    tableHdr.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;font-size:11px;color:#aaa;font-weight:600;text-transform:uppercase;letter-spacing:.03em;padding-bottom:4px;border-bottom:1px solid #f0f0eb;margin-bottom:4px;';
    tableHdr.innerHTML = '<span>Ingredient</span><span>Qty needed</span><span>Events</span><span>Cost</span>';
    card.appendChild(tableHdr);

    grpItems.forEach(item => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:8px;padding:5px 0;border-bottom:0.5px solid #f8f8f5;align-items:start;font-size:13px;';
      const bottlesLabel = item.bottlesBuy ? item.bottlesBuy + ' × ' + (item.bottleInfo ? item.bottleInfo.bottleLabel : item.unit) : item.qtyRaw.toFixed(1)+' '+item.unit;
      const stockNote = item.inStock > 0 ? ' <span style="font-size:10px;color:#1a7a4a;">(have '+item.inStock.toFixed(0)+' '+item.unit+')</span>' : '';
      const evList = [...new Set(item.events)];
      row.innerHTML = '<div><span>'+item.name+'</span>'+stockNote+'</div>'
        + '<div style="color:#555;">'+bottlesLabel+'</div>'
        + '<div style="font-size:11px;color:#888;">'+evList.map(e=>'<div>'+e+'</div>').join('')+'</div>'
        + '<div style="font-weight:500;">$'+(item.purchaseCostAdjusted||item.purchaseCost).toFixed(2)+'</div>';
      card.appendChild(row);
    });
    section.appendChild(card);
    wrap2.appendChild(section);
  });

  // Already covered by stock
  if(covered.length){
    const covSec = document.createElement('div');
    covSec.style.cssText = 'margin-top:8px;';
    covSec.innerHTML = '<div style="font-size:12px;color:#1a7a4a;font-weight:600;margin-bottom:6px;">✅ Already in stock (' + covered.length + ' items — $'+stockSavings.toFixed(2)+' saved)</div>';
    const covList = document.createElement('div');
    covList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    covered.forEach(item => {
      const pill = document.createElement('span');
      pill.style.cssText = 'font-size:11px;padding:2px 9px;border-radius:10px;background:#edfaf3;color:#1a7a4a;border:1px solid #c8e6d4;';
      pill.textContent = item.name;
      covList.appendChild(pill);
    });
    covSec.appendChild(covList);
    wrap2.appendChild(covSec);
  }

  // No items needed (everything covered)
  if(!Object.keys(groups).length && !covered.length){
    wrap2.innerHTML += '<div style="padding:1rem;text-align:center;color:#1a7a4a;font-weight:500;">✅ All ingredients across confirmed events are already in your inventory!</div>';
  }

  wrap.appendChild(wrap2);
}
// ════════════════════════════════════════════════════════════
// EVENT LIBRARY — stored in localStorage, survives tool updates
function renderPurchaseList(){
  const el2 = el('purchaseList');
  if(!el2) return;

  // Use same cocktail source as rShop — current event + selected library events
  let allCocktails = [...(cocktails||[])];
  let guests = vi('gc') || 50;

  if(typeof shopSelectedEvents !== 'undefined' && shopSelectedEvents.length){
    shopSelectedEvents.forEach(id => {
      const ev = eventLibrary.find(e => e.id === id);
      if(ev && ev.state && ev.state.cocktails){
        allCocktails = allCocktails.concat(ev.state.cocktails);
        if(!cocktails.length) guests = (ev.state.quote&&ev.state.quote.guestCount) || ev.guestCount || guests;
      }
    });
  }

  // Also check if there's a loaded event in memory even if cocktails[] is empty
  if(!allCocktails.length && currentEventId){
    const ev = eventLibrary.find(e => e.id === currentEventId);
    if(ev && ev.state && ev.state.cocktails && ev.state.cocktails.length){
      allCocktails = [...ev.state.cocktails];
      guests = (ev.state.quote&&ev.state.quote.guestCount) || ev.guestCount || guests;
    }
  }

  if(!allCocktails.length){
    el2.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text3);font-size:13px;">🍸 Add cocktails first — or load an event</div>';
    return;
  }

  // Build ingredient list — pass cocktail list directly, no global swap
  let items = [];
  if(allCocktails.length){
    try {
      items = getIM(guests, allCocktails);
    } catch(e){ console.warn('Purchase list getIM error:', e); }
  }

  if(!items.length){
    el2.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text3);">No ingredients found</div>';
    return;
  }

  const ALL_RETAILERS = ['SAQ','Aubut','IGA','Metro','Maxi','Costco','Walmart','Marché Jean-Talon','Dépanneur','Online','Grocery','Other'];
  const extras = (customRetailers||[]).filter(r => !ALL_RETAILERS.includes(r));
  const retailers = [...ALL_RETAILERS, ...extras];

  // Build per-item rows with retailer dropdowns
  let grandTotal = 0;
  const rows = items.map((item, idx) => {
    const store = getItemRetailer(item.name);
    const bi = item.bottleInfo;
    const custom2 = myIngredients.find(i => i.name.toLowerCase() === item.name.toLowerCase());
    const k = item.name.toLowerCase().trim();

    let unitLabel = '';
    let costNum = 0;
    let costStr = '—';

    if(bi){
      const btls = item.bottles || Math.ceil(item.qty / (bi.bottleOz||1));
      unitLabel = btls + ' × ' + (bi.bottleLabel || bi.bottleOz + ' oz');
      if(custom2 && custom2.bottlePrice){
        costNum = parseFloat(custom2.bottlePrice) * btls;
        costStr = '$' + costNum.toFixed(2);
        grandTotal += costNum;
      } else if(custom2 && custom2.c && custom2.c > 0){
        costNum = custom2.c * (bi.bottleOz||1) * btls;
        costStr = '~$' + costNum.toFixed(2);
        grandTotal += costNum;
      }
    } else {
      const qty = item.qtyRounded || item.qty || 0;
      unitLabel = qty % 1 === 0 ? qty + ' ' + (item.unit||'') : qty.toFixed(1) + ' ' + (item.unit||'');
      if(custom2 && custom2.c && custom2.c > 0){
        costNum = custom2.c * qty;
        costStr = '~$' + costNum.toFixed(2);
        grandTotal += costNum;
      }
    }

    const opts = retailers.map(r =>
      '<option value="'+r+'"'+(r===store?' selected':'')+'>'+r+'</option>'
    ).join('');

    const bg = idx%2===0 ? 'var(--surface)' : 'var(--surface2)';
    return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr;gap:8px;padding:9px 12px;align-items:center;background:'+bg+';border-bottom:.5px solid var(--border);">'
      + '<div>'
      +   '<div style="font-weight:600;font-size:13px;color:var(--text);">'+item.name+'</div>'
      +   (item.qty>0 ? '<div style="font-size:10.5px;color:var(--text3);">'+item.qty.toFixed(2)+' '+(item.unit||'oz')+' needed</div>' : '')
      + '</div>'
      + '<div style="font-size:13px;color:var(--text2);">'+unitLabel+'</div>'
      + '<div style="font-size:13px;font-weight:600;color:'+(costStr!=='—'?'var(--green)':'var(--text3)')+';">'+costStr+'</div>'
      + '<select data-name="'+item.name.replace(/"/g,'&quot;')+'" onchange="setItemRetailer(this.dataset.name,this.value)"'
      +   ' style="font-size:12px;padding:5px 8px;border-radius:var(--radius);border:1.5px solid var(--border);background:var(--surface);color:var(--text);font-family:var(--font);cursor:pointer;width:100%;">'+opts+'</select>'
      + '</div>';
  }).join('');

  // Column header
  const header = '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1.4fr;gap:8px;padding:6px 12px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);background:var(--surface2);border-radius:var(--radius) var(--radius) 0 0;border:1.5px solid var(--border);border-bottom:none;">'
    + '<span>Ingredient</span><span>Full unit</span><span>Est. cost</span><span>Buy at</span>'
    + '</div>';

  const summary = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.875rem;flex-wrap:wrap;gap:8px;">'
    + '<div style="font-size:13px;color:var(--text2);">'+items.length+' ingredients</div>'
    + (grandTotal>0 ? '<div style="font-size:14px;font-weight:700;">Est. total: <span style="color:var(--green);">$'+grandTotal.toFixed(2)+'</span></div>' : '')
    + '</div>';

  // Build per-store cost summary
  const storeTotals = {};
  items.forEach(function(item){
    const store = getItemRetailer(item.name) || 'Other';
    if(!storeTotals[store]) storeTotals[store] = {cost:0, count:0};
    const bi = item.bottleInfo;
    const custom2 = myIngredients.find(function(i){ return i.name.toLowerCase()===item.name.toLowerCase(); });
    let cost = 0;
    if(bi){
      const btls = item.bottles || Math.ceil(item.qty/(bi.bottleOz||1));
      if(custom2 && custom2.bottlePrice) cost = parseFloat(custom2.bottlePrice)*btls;
      else if(custom2 && custom2.c) cost = custom2.c*(bi.bottleOz||1)*btls;
    } else {
      const qty = item.qtyRounded||item.qty||0;
      if(custom2 && custom2.c) cost = custom2.c*qty;
    }
    storeTotals[store].cost += cost;
    storeTotals[store].count++;
  });

  let storeBreakdown = '';
  const storeEntries = Object.entries(storeTotals).filter(function(e){ return e[1].cost>0; }).sort(function(a,b){ return b[1].cost-a[1].cost; });
  if(storeEntries.length > 0){
    storeBreakdown = '<div style="margin-top:1rem;padding:12px 14px;background:var(--surface2);border-radius:var(--radius-lg);border:1px solid var(--border);">'
      + '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin-bottom:8px;">🏪 Cost by store</div>'
      + storeEntries.map(function(e){
          const storeEmoji = {SAQ:'🍷',Costco:'🏢',IGA:'🛒',Metro:'🛒',Maxi:'🛒',Aubut:'🧃',Walmart:'⭐'}[e[0]]||'🏪';
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:.5px solid var(--border);font-size:13px;">'
            + '<span>'+storeEmoji+' '+e[0]+' <span style="color:var(--text3);font-size:11px;">('+e[1].count+' item'+(e[1].count!==1?'s':'')+')</span></span>'
            + '<span style="font-weight:700;">$'+e[1].cost.toFixed(2)+'</span>'
            + '</div>';
        }).join('')
      + '<div style="display:flex;justify-content:space-between;padding-top:8px;font-size:13px;font-weight:700;">'
      + '<span>Total</span><span style="color:var(--green);">$'+grandTotal.toFixed(2)+'</span></div>'
      + '<div style="font-size:11px;color:var(--text3);margin-top:6px;">Tap any ingredient store dropdown above to reroute to a cheaper store</div>'
      + '</div>';
  }

  el2.innerHTML = summary + header + '<div style="border:1.5px solid var(--border);border-radius:0 0 var(--radius-lg) var(--radius-lg);overflow:hidden;">'+rows+'</div>' + storeBreakdown;
}




// ── Utility functions for purchase list ──
function getItemRetailer(name){
  const key = name.toLowerCase().trim();
  if(storeOverrides[key]) return storeOverrides[key];
  return inferStore({name: name, unit: 'oz'});
}

function setItemRetailer(name, store){
  saveStoreOverride(name, store);
  renderPurchaseList();
}
// ═══ HIS & HERS PAIRING ═══

function populatePairLinks() {
  ['p1link','p2link'].forEach(id => {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = '<option value="">— none / custom —</option>';
    cocktails.forEach((c,i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = cur;
  });
}

function getPairCost(linkVal, dpg, guests) {
  const idx = parseInt(linkVal);
  if (isNaN(idx) || !cocktails[idx]) return null;
  const c = cocktails[idx];
  const costPerDrink = c.ing.reduce((s,i)=>s+i.c*i.q, 0);
  return {costPerDrink, totalCost: costPerDrink * dpg * guests};
}

function editCocktailWeight(cid, currentWeight){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;

  const existing = document.getElementById('weightPopup');
  if(existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'weightPopup';
  popup.style.cssText = 'position:fixed;z-index:2000;background:#fff;border:1px solid #e5e5e0;border-radius:12px;padding:16px;box-shadow:0 4px 24px rgba(0,0,0,0.14);min-width:260px;';

  // Position near the card — center of screen on mobile
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%,-50%)';

  const dpp = parseFloat(document.getElementById('drinksPerPerson')?.value) || 5;
  const n = cocktails.length || 1;
  const rawWeights = cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b,0);

  function calcShare(w){
    const newSum = weightSum - (cocktail.dpg||1) + w;
    return (w / newSum * dpp).toFixed(1);
  }

  popup.innerHTML = '<div style="font-size:14px;font-weight:600;margin-bottom:4px;">' + cocktail.name + '</div>'
    + '<div style="font-size:12px;color:#888;margin-bottom:12px;">How popular is this cocktail relative to others?</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">'
    + '<span style="font-size:12px;color:#aaa;">Less</span>'
    + '<input type="range" id="wSlider" min="0.5" max="3" step="0.5" value="' + (currentWeight||1) + '" style="flex:1;" oninput="updateWeightPreview(this.value)">'
    + '<span style="font-size:12px;color:#aaa;">More</span>'
    + '</div>'
    + '<div id="wPreview" style="text-align:center;font-size:13px;color:#2156b8;font-weight:500;margin-bottom:12px;">~' + calcShare(currentWeight||1) + ' drinks/person</div>'
    + '<div style="display:flex;gap:6px;justify-content:space-between;">'
    + '<button onclick="setCocktailWeight(window._editingWeightCid,1)" style="font-size:12px;padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#f9f9f6;cursor:pointer;font-family:inherit;">= Equal</button>'
    + '<button onclick="applyCocktailWeight(window._editingWeightCid)" style="font-size:12px;padding:5px 14px;border:none;border-radius:6px;background:#1a1a1a;color:#fff;cursor:pointer;font-family:inherit;">Apply</button>'
    + '<button onclick="var p=document.getElementById(\x27weightPopup\x27);if(p)p.remove()" style="font-size:12px;padding:5px 10px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;font-family:inherit;">Cancel</button>'
    + '</div>';

  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', function closeW(e){
    if(!popup.contains(e.target)){ popup.remove(); document.removeEventListener('click',closeW); }
  }), 100);

  // Store current editing cid
  window._editingWeightCid = cid;
}

function updateWeightPreview(val){
  const cid = window._editingWeightCid;
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  const dpp = parseFloat(document.getElementById('drinksPerPerson')?.value) || 5;
  const rawWeights = cocktails.map(c => (c.dpg && c.dpg > 0) ? c.dpg : 1);
  const weightSum = rawWeights.reduce((a,b)=>a+b,0);
  const newSum = weightSum - (cocktail.dpg||1) + parseFloat(val);
  const share = (parseFloat(val) / newSum * dpp).toFixed(1);
  const prev = document.getElementById('wPreview');
  if(prev) prev.textContent = '~' + share + ' drinks/person';
}

function setCocktailWeight(cid, weight){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  cocktail.dpg = weight;
  const popup = document.getElementById('weightPopup');
  if(popup) popup.remove();
  rC(); rShop(); rQ(); markUnsaved();
}

function applyCocktailWeight(cid){
  const slider = document.getElementById('wSlider');
  if(!slider) return;
  setCocktailWeight(cid, parseFloat(slider.value));
}

function toggleHisHers(cid){
  const cocktail = cocktails.find(x => String(x.id) === String(cid));
  if(!cocktail) return;
  // Cycle: none → his → hers → none
  if(!cocktail.hisHers){
    // Check if a 'his' is already set
    const existingHis = cocktails.find(x => x.hisHers === 'his');
    cocktail.hisHers = existingHis ? 'hers' : 'his';
  } else if(cocktail.hisHers === 'his'){
    cocktail.hisHers = 'hers';
  } else {
    cocktail.hisHers = null;
  }
  // Show the His & Hers row in settings if any cocktail is flagged
  const anyFlagged = cocktails.some(x => x.hisHers);
  const hhRow = el('hisHersRow');
  if(hhRow) hhRow.style.display = anyFlagged ? '' : 'none';
  // Auto-sync cocktail name to the pair drink name field
  syncPairNamesToMenu();
  rC(); rQ(); markUnsaved();
}

function syncPairNamesToMenu(){
  // Auto-fill p1drink/p2drink from flagged cocktails
  const his = cocktails.find(x => x.hisHers === 'his');
  const hers = cocktails.find(x => x.hisHers === 'hers');
  if(his){ const inp = el('p1drink'); if(inp && !inp.value) sv('p1drink', his.name); }
  if(hers){ const inp = el('p2drink'); if(inp && !inp.value) sv('p2drink', hers.name); }
  // Auto-link p1link/p2link
  if(his){ const sel = el('p1link'); if(sel) { populatePairLinks(); sel.value = cocktails.indexOf(his); } }
  if(hers){ const sel = el('p2link'); if(sel) { populatePairLinks(); sel.value = cocktails.indexOf(hers); } }
}

function rPairs() {
  populatePairLinks();
  const p1 = v('p1name') || 'Partner 1';
  const p2 = v('p2name') || 'Partner 2';
  const evName = v('pEventName') || '';
  const p1drink = v('p1drink') || 'Signature cocktail';
  const p2drink = v('p2drink') || 'Signature cocktail';
  const p1desc = v('p1desc');
  const p2desc = v('p2desc');
  const p1dpg = parseFloat(v('p1dpg'))||1;
  const p2dpg = parseFloat(v('p2dpg'))||1;
  const p1link = v('p1link');
  const p2link = v('p2link');
  const guests = vi('gc') || 50;

  // Update dynamic labels
  gc2('p1label', p1 + String.fromCharCode(39) + 's drink');
  gc2('p2label', p2 + String.fromCharCode(39) + 's drink');

  // Cost info
  const c1 = getPairCost(p1link, p1dpg, guests);
  const c2 = getPairCost(p2link, p2dpg, guests);
  const linked1 = p1link !== '' && cocktails[parseInt(p1link)];
  const linked2 = p2link !== '' && cocktails[parseInt(p2link)];

  shtml('pairPreview',`
    <div class="quote-pair">
      <div class="quote-pair-header">
        ${evName ? evName + ' · ' : ''}Signature cocktails
      </div>
      <div class="quote-pair-body">
        <div class="quote-pair-side his">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#3a6ad4;margin-bottom:6px;">${p1}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${p1drink}</div>
          ${p1desc ? `<div style="font-size:12px;color:#888;line-height:1.5;margin-bottom:6px;">${p1desc}</div>` : ''}
          ${linked1 ? `<div style="font-size:11px;color:#aaa;">Based on: ${cocktails[parseInt(p1link)].name}</div>` : ''}
          ${c1 ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">$${c1.costPerDrink.toFixed(2)}/drink · ${p1dpg} drink${p1dpg!==1?'s':''}/guest</div>` : `<div style="font-size:11px;color:#aaa;margin-top:2px;">${p1dpg} drink${p1dpg!==1?'s':''}/guest</div>`}
        </div>
        <div class="quote-pair-mid">💑</div>
        <div class="quote-pair-side her">
          <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#c0206e;margin-bottom:6px;">${p2}</div>
          <div style="font-size:16px;font-weight:600;margin-bottom:4px;">${p2drink}</div>
          ${p2desc ? `<div style="font-size:12px;color:#888;line-height:1.5;margin-bottom:6px;">${p2desc}</div>` : ''}
          ${linked2 ? `<div style="font-size:11px;color:#aaa;">Based on: ${cocktails[parseInt(p2link)].name}</div>` : ''}
          ${c2 ? `<div style="font-size:11px;color:#aaa;margin-top:2px;">$${c2.costPerDrink.toFixed(2)}/drink · ${p2dpg} drink${p2dpg!==1?'s':''}/guest</div>` : `<div style="font-size:11px;color:#aaa;margin-top:2px;">${p2dpg} drink${p2dpg!==1?'s':''}/guest</div>`}
        </div>
      </div>
    </div>`);
  markUnsaved();
}

function getPairHTML() {
  const pEl = el('pairPreview'); return pEl ? pEl.innerHTML : '';
}

function addPairToMenu(){
  const p1name = v('p1name') || 'Partner 1';
  const p2name = v('p2name') || 'Partner 2';
  const p1drink = v('p1drink') || '';
  const p2drink = v('p2drink') || '';
  if(!p1drink && !p2drink){ showToast('Enter cocktail names first', 'error'); return; }
  let added = 0;
  [p1drink, p2drink].forEach(nm => {
    if(!nm.trim()) return;
    if(!cocktails.some(c2 => c2.name.toLowerCase() === nm.toLowerCase())){
      cocktails.push({ id: Date.now()+Math.random(), name: nm, cat: 'His & Hers', dpg: 1, ing: [] });
      added++;
    }
  });
  if(added === 0){ showToast('Both cocktails already in menu', 'success'); return; }
  rC(); rShop(); rQ(); markUnsaved();
  showToast(added + ' cocktail' + (added!==1?'s':'') + ' added to menu', 'success');
  sw('menu', document.getElementById('st-menu'));
}

function cpPair() {
  const previewEl = el('pairPreview');
  if (!previewEl || !previewEl.innerText.trim()) { alert('Build a His & Hers pairing first — fill in partner names and cocktails above.'); return; }
  const text = previewEl.innerText;
  // Try modern clipboard API first, fall back to execCommand for local files
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Pairing card copied to clipboard!', 'success'))
      .catch(() => cpPairFallback(text));
  } else {
    cpPairFallback(text);
  }
}
function cpPairFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try {
    document.execCommand('copy');
    showToast('Pairing card copied!', 'success');
  } catch(e) {
    showToast('Could not auto-copy — select the text below and copy manually', 'error');
  }
  document.body.removeChild(ta);
}

// Inject pairing into quote if filled out
function getPairQuoteBlock() {
  const p1name = v('p1name');
  const p1drink = v('p1drink');
  const p2name = v('p2name');
  const p2drink = v('p2drink');
  if (!p1drink && !p2drink) return '';
  const _pEl = el('pairPreview'); return _pEl ? _pEl.innerHTML : '';
}
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
// ═══ POST-EVENT & INVENTORY ═══
// Post-event checklist, stock count, auto-fill leftovers,
// inventory management, loadAndInvoice

function autoFillLeftovers(){
  const items = window._lastShopItems || getIM(vi('gc')||50);
  if(!items.length){ showToast('Build a shopping list first to auto-fill leftovers','error'); return; }
  let filled = 0;
  items.forEach(function(item){
    const key = item.name.toLowerCase().trim();
    if(!postEventData) postEventData = {};
    if(!postEventData[key]){
      const bi = item.bottleInfo;
      const totalBought = bi ? item.bottles * (bi.bottleOz||25.36) : item.qtyRaw;
      const consumed    = item.qty || item.qtyRaw || 0;
      const leftover    = Math.max(0, parseFloat((totalBought - consumed).toFixed(2)));
      postEventData[key] = {
        actualLeftover: leftover,
        estimatedLeftover: leftover,
        unit: item.unit || 'oz',
        name: item.name,
        cpu: item.cpu || 0,
        boughtQty: totalBought,
        confirmedPurchased: true,
        source: 'auto'
      };
      filled++;
    }
  });
  renderPostEvent();
  updatePostEventChecklist();
  showToast('✓ Auto-filled ' + filled + ' leftover items', 'success');
}

function loadAndInvoice(evId){
  loadEventFromLibrary(evId);
  // Switch to post-event tab and open invoice
  setTimeout(function(){
    const peBtn = el('st-postevent');
    if(peBtn) sw('postevent', peBtn);
    setTimeout(function(){
      updatePostEventChecklist();
      openFinalInvoice();
    }, 150);
  }, 300);
}

function updatePostEventChecklist(){
  const ev = currentEventId ? eventLibrary.find(function(e){ return e.id===currentEventId; }) : null;
  const status = v('quoteStatus') || (ev && ev.status) || 'draft';
  const hasMenu = cocktails.length > 0;
  const hasQuote = ev && (ev.quoteHistory && ev.quoteHistory.length > 0 || ev.quoteSnapshot);
  const isConfirmed = status === 'confirmed' || status === 'completed';
  const hasDeposit = parseFloat(v('depositAmt')||0) > 0;
  const eventDate = v('ed') || (ev && ev.eventDate);
  const isPast = eventDate && new Date(eventDate) < new Date();
  const hasShopping = ev && shopSelectedEventIds && shopSelectedEventIds.has(ev.id || '');
  const hasStock = Object.values(postEventData||{}).some(function(d){ return (d.actualLeftover||0) > 0; });
  const hasInvoice = ev && ev.invoiceSentAt;
  const isPaid = status === 'completed' || (ev && ev.paidAt);

  function setCheck(id, done, na){
    const row = el('pec-'+id);
    const st  = el('pecs-'+id);
    if(!row||!st) return;
    if(na){
      row.className = 'pe-check';
      row.style.opacity = '0.4';
      st.textContent = 'N/A';
      st.style.color = 'var(--text3)';
    } else {
      row.style.opacity = '';
      row.className = 'pe-check' + (done?' done':'');
      st.textContent = done ? '✓' : '—';
      st.style.color = done ? 'var(--green)' : 'var(--text3)';
    }
  }

  // Pre-event tasks — show greyed out if event is past
  setCheck('menu',      hasMenu,      false);
  setCheck('quote',     hasQuote,     false);
  setCheck('confirmed', isConfirmed,  false);
  setCheck('deposit',   hasDeposit,   false);
  setCheck('shopping',  hasShopping,  false);

  // Post-event tasks — only relevant after event date
  setCheck('stock',   hasStock,   !isPast);
  setCheck('invoice', hasInvoice, !isPast);
  setCheck('paid',    isPaid,     !isPast);

  // Show/hide a divider between pre and post tasks
  const divider = el('pec-divider');
  if(divider) divider.style.display = '';

  // Update event name in header
  const nameEl = el('postEventEventName');
  if(nameEl) nameEl.textContent = v('eventLabel') ? '📅 ' + v('eventLabel') : '';
}


function importAllData(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if(d.customIngredients) { myIngredients = d.customIngredients; saveMyDB(); syncMyDBtoFlat(); }
      if(d.priceHistory) { priceHistory = d.priceHistory; savePriceHistory(); }
      if(d.recipeLibrary) { recipeLibrary = d.recipeLibrary; saveRecipeLibraryStore(); }
      if(d.receipts) { receipts = d.receipts; saveReceipts(); }
      if(d.currentStock) { currentStock = d.currentStock; saveStock(); }
      if(d.eventLibrary) { eventLibrary = d.eventLibrary; saveEventLibraryStore(); }
      if(d.eventCategories) { eventCategories = d.eventCategories; saveEventCategories(); }
      renderMyDB(); renderRecipeLibrary(); renderReceipts();
      showToast('All data imported successfully', 'success');
    } catch(err){ showToast('Could not read data file', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ════════════════════════════════════════════════════════════
// POST-EVENT INVENTORY
// ════════════════════════════════════════════════════════════

// Stock carries forward between events
// Structure: { ingredientKey: { name, unit, qty, cpu, lastUpdated, eventLabel } }
let currentStock = {};

function loadStock() {
  try {
    const stored = localStorage.getItem('bartender_stock_v1');
    if (stored) currentStock = JSON.parse(stored);
  } catch(e) { currentStock = {}; }
}

function saveStock() {
  try { localStorage.setItem('bartender_stock_v1', JSON.stringify(currentStock)); }
  catch(e) { console.error('Could not save stock:', e); }
}

// postEventData holds the current post-event form state
let postEventData = {}; // { ingredientKey: { actualLeftover } }

// Build the list of actually-purchased items from receipts tagged to this event
function getPurchasedItems() {
  const eventLabel = v('eventLabel') || '';
  const purchased = {};

  // Step 1: pull from scanned receipts for this event
  const eventReceipts = receipts.filter(r =>
    !eventLabel || r.eventLabel === eventLabel
  );
  eventReceipts.forEach(r => {
    (r.items || []).forEach(item => {
      if (!item.is_bar_ingredient || !item.matched_ingredient) return;
      const key = item.matched_ingredient.toLowerCase().trim();
      if (!purchased[key]) {
        // Find the ingredient in INGFLAT to get cpu and unit
        const flat = INGFLAT.find(f => f.name.toLowerCase() === key)
                  || myIngredients.find(m => m.name.toLowerCase() === key);
        const cpu = flat ? flat.c : (item.unit_price > 8 ? item.unit_price/25.36 : item.unit_price);
        purchased[key] = {
          name: item.matched_ingredient,
          key,
          unit: flat ? flat.unit : 'oz',
          cpu,
          boughtQty: item.quantity || 1,
          source: 'receipt',
          receiptStore: r.store,
          receiptDate: r.date
        };
      } else {
        // accumulate quantity if bought multiple times
        purchased[key].boughtQty += (item.quantity || 1);
      }
    });
  });

  // Step 2: also include items manually marked as purchased in postEventData
  Object.entries(postEventData).forEach(([key, d]) => {
    if (d.confirmedPurchased && !purchased[key]) {
      purchased[key] = {
        name: d.name, key, unit: d.unit, cpu: d.cpu,
        boughtQty: d.boughtQty || 0, source: 'manual'
      };
    }
  });

  // Step 3: if no receipts at all, fall back to the full shopping list
  // so the tab is still useful before receipts are scanned
  if (Object.keys(purchased).length === 0) {
    const guests = vi('gc');
    const {effectiveGuests} = getConsumptionGuests();
    const items = getIM(effectiveGuests);
    items.forEach(item => {
      const key = item.name.toLowerCase().trim();
      purchased[key] = {
        name: item.name, key, unit: item.unit, cpu: item.cpu,
        boughtQty: item.bottleInfo ? item.qtyRounded : item.qtyRaw,
        source: 'estimate',
        estimatedLeftover: item.bottleInfo ? parseFloat(item.leftover.toFixed(2)) : 0
      };
    });
  }

  return Object.values(purchased);
}

function renderPostEvent() {
  const hasMenu = cocktails.length > 0;
  const emptyEl = el('postEventEmpty');
  const contentEl = el('postEventContent');

  if (!hasMenu) {
    if (emptyEl) emptyEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  if (contentEl) contentEl.style.display = 'block';

  const purchasedItems = getPurchasedItems();
  const hasReceipts = receipts.some(r => !v('eventLabel') || r.eventLabel === v('eventLabel'));
  const isEstimate = !hasReceipts;

  // Show a banner if using estimates (no receipts yet)
  const banner = isEstimate
    ? '<div style="font-size:12px;background:#fdf5e8;border:1px solid #f0d080;border-radius:8px;padding:8px 12px;margin-bottom:12px;color:#a06020;">⚠ No receipts scanned for this event yet — showing estimated quantities. Scan your receipts first for accurate leftover tracking.</div>'
    : '<div style="font-size:12px;background:#edfaf3;border:1px solid #c8e6d4;border-radius:8px;padding:8px 12px;margin-bottom:12px;color:#1a7a4a;">✓ Based on ' + receipts.filter(r => !v("eventLabel") || r.eventLabel === v("eventLabel")).length + ' scanned receipt(s) for this event.</div>';
  shtml('postEventBanner', banner);

  // Initialise postEventData for each purchased item
  purchasedItems.forEach(p => {
    const key = p.key;
    if (postEventData[key] === undefined) {
      const estLeftover = p.estimatedLeftover !== undefined ? p.estimatedLeftover : 0;
      postEventData[key] = {
        actualLeftover: estLeftover,
        unit: p.unit,
        name: p.name,
        cpu: p.cpu,
        boughtQty: p.boughtQty,
        estimatedLeftover: estLeftover,
        confirmedPurchased: true,
        source: p.source
      };
    }
  });

  const items = purchasedItems; // alias for rest of function
  const bottledItems = items.filter(i => i.unit === 'oz');
  const otherItems = items.filter(i => i.unit !== 'oz');

  // Summary
  const totalBought = items.reduce((s, i) => s + i.purchaseCost, 0);
  const totalEstLeftover = items.reduce((s, i) => s + i.leftoverValue, 0);
  const totalActualLeftover = Object.values(postEventData)
    .reduce((s, d) => s + (d.actualLeftover || 0) * (d.cpu || 0), 0);
  const totalUsedValue = totalBought - totalActualLeftover;
  const varianceVsEst = totalActualLeftover - totalEstLeftover;

  shtml('invSummary', `
    <div class="met"><div class="ml">Total purchased</div><div class="mv">$${totalBought.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Est. leftover value</div><div class="mv">$${totalEstLeftover.toFixed(2)}</div></div>
    <div class="met ${totalActualLeftover >= totalEstLeftover ? '' : 'loss'}" style="${totalActualLeftover < totalEstLeftover ? 'background:#fdf0ef;' : ''}">
      <div class="ml">Actual leftover value</div>
      <div class="mv" style="${totalActualLeftover < totalEstLeftover ? 'color:#c0392b;' : 'color:#1a7a4a;'}">$${totalActualLeftover.toFixed(2)}</div>
    </div>
    <div class="met" style="${varianceVsEst < -2 ? 'background:#fdf0ef;' : varianceVsEst > 2 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Variance vs estimate</div>
      <div class="mv" style="${varianceVsEst < 0 ? 'color:#c0392b;' : 'color:#1a7a4a;'}">
        ${varianceVsEst >= 0 ? '+' : ''}$${varianceVsEst.toFixed(2)}
      </div>
    </div>`);

  // Build table rows
  const allItems = [...bottledItems, ...otherItems];
  const rows = allItems.map(item => {
    const key = item.name.toLowerCase().trim();
    const d = postEventData[key] || { actualLeftover: 0, estimatedLeftover: 0, cpu: item.cpu, unit: item.unit };
    const actual = parseFloat(d.actualLeftover) || 0;
    const estimated = parseFloat(d.estimatedLeftover) || 0;
    const diff = actual - estimated;
    const diffClass = diff > 0.1 ? 'inv-diff-pos' : diff < -0.1 ? 'inv-diff-neg' : 'inv-diff-ok';
    const diffLabel = diff > 0.1 ? '+' + diff.toFixed(1) + ' more' : diff < -0.1 ? diff.toFixed(1) + ' less' : '≈ as expected';
    const actualValue = actual * item.cpu;
    const bought = item.bottleInfo ? item.qtyRounded.toFixed(1) + ' oz (' + item.bottles + ' btl)' : item.qtyRaw.toFixed(1);

    return `<div class="inv-row" id="invrow_${key.replace(/[^a-z0-9]/g,'_')}">
      <div>
        <div style="font-weight:500;">${item.name}</div>
        <div style="font-size:11px;color:#aaa;margin-top:1px;">$${item.cpu.toFixed(4)}/${item.unit} · <span class="${diffClass}">${diffLabel}</span></div>
      </div>
      <span style="color:#888;">${bought}</span>
      <span style="color:#aaa;">${estimated.toFixed(1)}</span>
      <input type="number" value="${actual}" min="0" step="0.1"
        onchange="updateActualLeftover('${key.replace(/'/g,"\'")}', this.value)"
        style="border:1px solid #ddd;border-radius:6px;background:#fff;color:#1a1a1a;"
        title="Enter the actual amount left after the event">
      <span style="color:#888;">${item.unit}</span>
      <span style="color:#1a7a4a;font-weight:500;">$${actualValue.toFixed(2)}</span>
    </div>`;
  }).join('');

  shtml('invTable', rows || '<div style="font-size:13px;color:#aaa;padding:8px 0;">No ingredients found — build a shopping list first.</div>');

  // Stock carry-over summary
  const carryItems = Object.values(postEventData).filter(d => (d.actualLeftover || 0) > 0);
  if (carryItems.length) {
    const carryHTML = carryItems.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid #f0f0eb;font-size:13px;">
        <span>${d.name}</span>
        <div style="display:flex;gap:12px;align-items:center;">
          <span style="color:#888;">${(d.actualLeftover || 0).toFixed(1)} ${d.unit}</span>
          <span class="stock-carry">→ carries to next event</span>
          <span style="color:#1a7a4a;font-weight:500;">$${((d.actualLeftover || 0) * (d.cpu || 0)).toFixed(2)}</span>
        </div>
      </div>`).join('');

    shtml('stockCarryOver', `
      <div class="card">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">
          📦 Carry-over stock — goes into your inventory for the next event
        </div>
        ${carryHTML}
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding-top:8px;border-top:1px solid #eee;margin-top:4px;">
          <span>Total carry-over value</span>
          <span style="color:#1a7a4a;">$${carryItems.reduce((s,d) => s + (d.actualLeftover||0)*(d.cpu||0), 0).toFixed(2)} CAD</span>
        </div>
        <div style="font-size:12px;color:#888;margin-top:6px;">
          💡 Click "Move to inventory stock" to add this leftover to your inventory.
          It will reduce your shopping costs on the next event — and the difference between
          what you quoted and what you actually spend is your extra profit.
        </div>
        <div class="fe" style="margin-top:10px;">
          <button class="btn btn-sm btn-success" onclick="applyCarryOverToResale()">
            ✓ Move to inventory stock
          </button>
        </div>
      </div>`);
  } else {
    shtml('stockCarryOver', '');
  }
}

function updateActualLeftover(key, value) {
  const safeKey = key;
  if (!postEventData[safeKey]) return;
  postEventData[safeKey].actualLeftover = parseFloat(value) || 0;
  // Recalculate the value cell inline
  const d = postEventData[safeKey];
  const actualValue = (d.actualLeftover || 0) * (d.cpu || 0);
  // Re-render summary only (not whole table — preserves focus)
  const guests = vi('gc');
  const items = getIM(guests);
  const totalBought = items.reduce((s, i) => s + i.purchaseCost, 0);
  const totalActualLeftover = Object.values(postEventData)
    .reduce((s, d2) => s + (d2.actualLeftover || 0) * (d2.cpu || 0), 0);
  const totalEstLeftover = items.reduce((s, i) => s + i.leftoverValue, 0);
  const varianceVsEst = totalActualLeftover - totalEstLeftover;
  shtml('invSummary', `
    <div class="met"><div class="ml">Total purchased</div><div class="mv">$${totalBought.toFixed(2)}</div></div>
    <div class="met"><div class="ml">Est. leftover value</div><div class="mv">$${totalEstLeftover.toFixed(2)}</div></div>
    <div class="met" style="${totalActualLeftover < totalEstLeftover ? 'background:#fdf0ef;' : ''}">
      <div class="ml">Actual leftover value</div>
      <div class="mv" style="${totalActualLeftover < totalEstLeftover ? 'color:#c0392b;' : 'color:#1a7a4a;'}">$${totalActualLeftover.toFixed(2)}</div>
    </div>
    <div class="met" style="${varianceVsEst < -2 ? 'background:#fdf0ef;' : varianceVsEst > 2 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Variance vs estimate</div>
      <div class="mv" style="${varianceVsEst < 0 ? 'color:#c0392b;' : 'color:#1a7a4a;'}">
        ${varianceVsEst >= 0 ? '+' : ''}$${varianceVsEst.toFixed(2)}
      </div>
    </div>`);
}

function autoFillEstimated() {
  // Reset to 0 for all purchased items — forces him to enter real numbers
  const purchasedItems = getPurchasedItems();
  purchasedItems.forEach(p => {
    const key = p.key;
    if (postEventData[key]) {
      // Use estimated leftover if available, otherwise 0
      postEventData[key].actualLeftover = p.estimatedLeftover || 0;
    }
  });
  renderPostEvent();
  showToast('Reset to estimates — update each item with the actual amount left', 'success');
}

function savePostEvent() {
  // 1. Update currentStock with actual leftovers from purchased items
  const purchasedItems = getPurchasedItems();
  const eventLabel = v('eventLabel') || 'Unnamed event';
  const today = new Date().toISOString().split('T')[0];

  Object.entries(postEventData).forEach(([key, d]) => {
    const actual = parseFloat(d.actualLeftover) || 0;
    if (actual > 0) {
      // Add to stock (or update if already there)
      if (currentStock[key]) {
        currentStock[key].qty += actual;
        currentStock[key].lastUpdated = today;
        currentStock[key].eventLabel = eventLabel;
      } else {
        currentStock[key] = {
          name: d.name,
          unit: d.unit,
          qty: actual,
          cpu: d.cpu,
          lastUpdated: today,
          eventLabel
        };
      }
    }
  });
  saveStock();

  rQ();
  markUnsaved();

  // 3. Save notes
  const notes = v('postEventNotes');

  // 4. Record in price history as a data point
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    if (item.cpu > 0) {
      recordPrice(item.name, item.cpu, item.unit, 'Post-event stock', 'receipt');
    }
  });

  showToast('Post-event inventory saved. Stock and resale credit updated.', 'success');
  renderPostEvent();
}

function applyCarryOverToResale() {
  // Carry-over stock is tracked in inventory — it boosts his profit but does NOT change the client quote
  // Transfer actual leftovers from this event into currentStock
  const today = new Date().toISOString().split('T')[0];
  const eventLabel = v('eventLabel') || 'Unnamed event';
  let added = 0;
  Object.entries(postEventData).forEach(([key, d]) => {
    const actual = parseFloat(d.actualLeftover) || 0;
    if (actual > 0) {
      if (currentStock[key]) {
        currentStock[key].qty = parseFloat((currentStock[key].qty + actual).toFixed(4));
      } else {
        currentStock[key] = { name: d.name, unit: d.unit, qty: actual, cpu: d.cpu, lastUpdated: today, eventLabel, source: 'post-event' };
      }
      added++;
    }
  });
  saveStock();
  showToast(added + ' items moved to your inventory — they will reduce your shopping costs on the next event', 'success');
  renderInventory();
}

function exportPostEvent() {
  const guests = vi('gc');
  const items = getIM(guests);
  const eventLabel = v('eventLabel') || 'Event';
  const today = new Date().toISOString().split('T')[0];

  const rows = [['Ingredient','Unit','Bought (oz)','Est. leftover','Actual leftover','Difference','Unit cost CAD','Actual leftover value CAD']];
  items.forEach(item => {
    const key = item.name.toLowerCase().trim();
    const d = postEventData[key] || {};
    const actual = parseFloat(d.actualLeftover) || 0;
    const estimated = parseFloat(d.estimatedLeftover) || item.leftover || 0;
    const diff = actual - estimated;
    rows.push([
      item.name, item.unit,
      item.bottleInfo ? item.qtyRounded.toFixed(2) : item.qtyRaw.toFixed(2),
      estimated.toFixed(2), actual.toFixed(2),
      (diff >= 0 ? '+' : '') + diff.toFixed(2),
      item.cpu.toFixed(4),
      (actual * item.cpu).toFixed(2)
    ]);
  });

  const totalActual = Object.values(postEventData).reduce((s,d) => s+(parseFloat(d.actualLeftover)||0)*(d.cpu||0),0);
  rows.push([]);
  rows.push(['Notes', v('postEventNotes') || '']);
  rows.push(['Total actual leftover value CAD', totalActual.toFixed(2)]);

  const csv = rows.map(r => r.map(val => {
    const s = String(val == null ? '' : val);
    return s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');

  const lbl = eventLabel.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = lbl + '_post_event_' + today + '.csv';
  a.click();
}

// ════════════════════════════════════════════════════════════
// INVENTORY & PROFIT TRACKER
// ════════════════════════════════════════════════════════════

function addToInventoryManual() {
  const name  = v('invAddName').trim();
  const qty   = parseFloat(v('invAddQty')) || 0;
  const unit  = v('invAddUnit') || 'oz';
  const price = parseFloat(v('invAddPrice')) || 0;
  const store = v('invAddStore').trim();
  if (!name) { alert('Enter an ingredient name.'); return; }
  if (qty <= 0) { alert('Enter a quantity greater than 0.'); return; }

  const key = name.toLowerCase().trim();
  const today = new Date().toISOString().split('T')[0];

  // Convert bottle price to per-oz if unit is 'bottle'
  let cpu = price;
  let finalUnit = unit;
  let finalQty = qty;
  if (unit === 'bottle') {
    cpu = parseFloat((price / 25.36).toFixed(4));
    finalQty = qty * 25.36;
    finalUnit = 'oz';
  } else if (price > 0 && qty > 0) {
    cpu = parseFloat((price / qty).toFixed(4));
  }

  if (currentStock[key]) {
    currentStock[key].qty = parseFloat((currentStock[key].qty + finalQty).toFixed(4));
    // Update price paid if provided
    if (price > 0) { currentStock[key].cpu = cpu; currentStock[key].pricePaid = price; }
    currentStock[key].lastUpdated = today;
  } else {
    currentStock[key] = {
      name, unit: finalUnit, qty: finalQty,
      cpu, pricePaid: price, store,
      lastUpdated: today,
      source: 'manual-purchase'
    };
  }

  // Record in price history
  if (price > 0) recordPrice(name, cpu, finalUnit, store || 'Manual purchase', 'receipt');

  saveStock();

  // Update ingredient database with real paid price
  const flat = INGFLAT.find(f => f.name.toLowerCase() === key);
  if (flat && cpu > 0) flat.c = cpu;
  const custom = myIngredients.find(m => m.name.toLowerCase() === key);
  if (custom && cpu > 0) { custom.c = cpu; saveMyDB(); }

  sv('invAddName', ''); sv('invAddQty', '1'); sv('invAddPrice', '0'); sv('invAddStore', '');
  renderInventory();
  showToast(name + ' added to inventory', 'success');
}

// Inventory autocomplete dropdown
function filterInvDD(query) {
  const ddEl = el('invAddDD');
  if (!ddEl) return;
  const q = (query || '').toLowerCase().trim();
  let html = '';
  let count = 0;
  Object.entries(INGDB).forEach(([cat, items]) => {
    const filtered = q ? items.filter(i => i.name.toLowerCase().includes(q)) : items.slice(0, 5);
    if (!filtered.length) return;
    html += `<div class="ing-group-label">${cat}</div>`;
    filtered.slice(0, 8).forEach(item => {
      const hi = q ? item.name.replace(new RegExp('(' + q + ')', 'gi'), '<strong>$1</strong>') : item.name;
      html += `<div class="ing-option" data-name="${item.name.replace(/"/g,'&quot;')}" data-unit="${item.unit}"
        onmousedown="pickInvIng(this.dataset.name, this.dataset.unit)">
        <span class="ing-option-name">${hi}</span>
        <span class="ing-option-meta">${item.unit}</span>
      </div>`;
      count++;
    });
  });
  if (!count) html = '<div style="padding:8px 12px;font-size:13px;color:#aaa;">Type to search or enter custom name</div>';
  ddEl.innerHTML = html;
  ddEl.classList.add('open');
  setTimeout(() => document.addEventListener('click', () => ddEl.classList.remove('open'), {once:true}), 10);
}

function pickInvIng(name, unit) {
  sv('invAddName', name);
  sv('invAddUnit', unit);
  const flat = INGFLAT.find(f => f.name.toLowerCase() === name.toLowerCase());
  if (flat) sv('invAddPrice', (flat.c).toFixed(2));
  const ddEl = el('invAddDD');
  if (ddEl) ddEl.classList.remove('open');
}

function updateStockQty(key, val) {
  if (currentStock[key]) {
    currentStock[key].qty = parseFloat(val) || 0;
    saveStock();
  }
}

function removeStockItem(key) {
  if (!confirm('Remove "' + (currentStock[key] ? currentStock[key].name : key) + '" from inventory?')) return;
  delete currentStock[key];
  saveStock();
  renderInventory();
}

function clearUsedStock() {
  const before = Object.keys(currentStock).length;
  Object.keys(currentStock).forEach(k => { if ((currentStock[k].qty || 0) <= 0) delete currentStock[k]; });
  saveStock();
  renderInventory();
  const removed = before - Object.keys(currentStock).length;
  if (removed > 0) showToast(removed + ' empty item' + (removed > 1 ? 's' : '') + ' removed', 'success');
}

// How much of the current event's shopping list is covered by inventory
function getInventoryCoverage() {
  if (!cocktails.length || !Object.keys(currentStock).length) return [];
  const guests = vi('gc');
  const items = getIM(guests);
  return items.map(item => {
    const key = item.name.toLowerCase().trim();
    const stock = currentStock[key];
    const inStock = stock ? Math.min(stock.qty, item.qtyRounded || item.qtyRaw) : 0;
    const stillNeeded = Math.max(0, (item.qtyRounded || item.qtyRaw) - inStock);
    const coveragePct = item.qtyRounded > 0 ? Math.round((inStock / item.qtyRounded) * 100) : 0;
    const savedCost = inStock * item.cpu;
    return { ...item, inStock, stillNeeded, coveragePct, savedCost };
  });
}

// Profit line shown on the quote tab
function getInventoryProfitLine(guests) {
  const coverage = getInventoryCoverage();
  if (!coverage.length) return '';
  const totalSaved = coverage.reduce((s, i) => s + i.savedCost, 0);
  if (totalSaved < 0.01) return '';
  return `<div style="display:flex;align-items:center;gap:6px;font-size:13px;padding:8px 12px;background:#edfaf3;border-radius:8px;color:#1a7a4a;margin-top:8px;">
    📦 Inventory covers <strong>$${totalSaved.toFixed(2)} CAD</strong> of this event — that's extra profit you keep.
    <a href="#" onclick="event.preventDefault();sw('inventory',document.querySelector('.tab:last-child'))" style="color:#1a7a4a;text-decoration:underline;font-size:12px;margin-left:4px;">See details →</a>
  </div>`;
}

function renderInventory() {
  const keys = Object.keys(currentStock);
  const totalValue = keys.reduce((s, k) => s + (currentStock[k].qty || 0) * (currentStock[k].cpu || 0), 0);
  const totalItems = keys.length;
  const coverage = getInventoryCoverage();
  const totalSaved = coverage.reduce((s, i) => s + i.savedCost, 0);

  // Profit dashboard
  const quotedTotal = (() => {
    try {
      const guests=vi('gc'),hours=vf('eventHrs'),rate=vf('hr'),travel=vf('tf');
  const marginPct=getMpAsMargin();
  const mkup = marginPct < 100 ? (marginPct/(100-marginPct))*100 : marginPct;
      const taxEl2=el('taxEnabled'); const taxEnabled=taxEl2&&taxEl2.checked;
      const items=getIM(guests);
      const purchase=items.reduce((s,i)=>s+i.purchaseCost,0);
      const mked=purchase*(1+mkup/100),labor=hours*rate,staffLbr=getStaffLaborTotal();
      const sub=mked+labor+staffLbr+travel;
      const tps=taxEnabled?sub*0.05:0, tvq=taxEnabled?sub*0.09975:0;
      return sub+tps+tvq;
    } catch(e){ return 0; }
  })();

  const receiptTotal = receipts.reduce((s,r) => s + r.total, 0);
  const trueCost = receiptTotal > 0 ? receiptTotal : 0;
  const inventoryProfit = totalSaved;
  const markupProfit = quotedTotal > 0 ? (() => {
    try {
      const guests=vi('gc'),mkup=vf('mp');
      const items=getIM(guests);
      const purchase=items.reduce((s,i)=>s+i.purchaseCost,0);
      const discA=vf('discountAmt')||0, discP=vf('discountPct')||0;
      const sub=purchase*(1+mkup/100);
      return sub*(mkup/100/(1+mkup/100)) - discA - sub*(discP/100);
    } catch(e){ return 0; }
  })() : 0;

  if (quotedTotal > 0 || totalSaved > 0) {
    shtml('profitDashboard', `
      <div class="profit-card">
        <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">💰 Profit breakdown — current event</div>
        <div class="profit-row"><span>Quoted to client</span><span style="font-weight:500;">$${quotedTotal.toFixed(2)}</span></div>
        ${receiptTotal > 0 ? `<div class="profit-row"><span>Actual receipts paid</span><span>- $${receiptTotal.toFixed(2)}</span></div>` : ''}
        <div class="profit-row" style="color:#1a7a4a;"><span>Inventory savings (stock used)</span><span style="color:#1a7a4a;">+ $${inventoryProfit.toFixed(2)}</span></div>
        <div class="profit-row" style="color:#1a7a4a;"><span>Markup profit</span><span style="color:#1a7a4a;">+ $${markupProfit.toFixed(2)}</span></div>
        <div class="profit-total">
          <span>Your estimated total profit</span>
          <span class="profit-green">$${(markupProfit + inventoryProfit).toFixed(2)} CAD</span>
        </div>
        <div style="font-size:11px;color:#aaa;margin-top:6px;">* Quote-based estimate. Scan receipts for exact actuals.</div>
      </div>`);
  } else {
    shtml('profitDashboard', '');
  }

  // Metrics
  shtml('invMetrics', `
    <div class="met"><div class="ml">Items in stock</div><div class="mv">${totalItems}</div></div>
    <div class="met"><div class="ml">Stock value CAD</div><div class="mv">$${totalValue.toFixed(2)}</div></div>
    <div class="met" style="${totalSaved > 0 ? 'background:#edfaf3;' : ''}">
      <div class="ml">Event coverage</div>
      <div class="mv" style="${totalSaved > 0 ? 'color:#1a7a4a;' : ''}">$${totalSaved.toFixed(2)}</div>
    </div>
    <div class="met"><div class="ml">Stock entries</div><div class="mv">${keys.length}</div></div>`);

  // Stock table
  if (!keys.length) {
    shtml('stockTableWrap', '<div class="empty" style="padding:1.5rem;text-align:center;color:#aaa;">No inventory yet — add items above or complete a post-event record</div>');
  } else {
    const rows = keys.sort((a,b) => (currentStock[b].qty*currentStock[b].cpu) - (currentStock[a].qty*currentStock[a].cpu))
      .map(key => {
        const s = currentStock[key];
        const value = (s.qty || 0) * (s.cpu || 0);
        const srcClass = s.source === 'post-event' ? 'src-event' : s.source === 'receipt-scan' ? 'src-purchase' : 'src-manual';
        const srcLabel = s.source === 'post-event' ? 'Post-event' : s.source === 'receipt-scan' ? 'Receipt scan' : 'Manual';
        return `<div class="inv-stock-row">
          <div><div style="font-weight:500;">${s.name}</div><div style="font-size:11px;color:#aaa;">${s.store || ''} · ${s.lastUpdated || ''}</div></div>
          <input type="number" value="${(s.qty||0).toFixed(1)}" min="0" step="0.1"
            onchange="updateStockQty('${key.replace(/'/g,"\'")}', this.value);renderInventory()"
            style="border:1px solid #ddd;border-radius:6px;">
          <span style="color:#888;">${s.unit}</span>
          <span>$${(s.cpu||0).toFixed(4)}</span>
          <span style="color:#1a7a4a;font-weight:500;">$${value.toFixed(2)}</span>
          <span class="source-badge ${srcClass}">${srcLabel}</span>
          <button class="btn btn-sm btn-danger" data-key="${key.replace(/"/g,'&quot;')}"
            onclick="removeStockItem(this.dataset.key)">✕</button>
        </div>`;
      }).join('');
    shtml('stockTableWrap', `
      <div class="inv-stock-row inv-stock-header">
        <span>Ingredient</span><span>Qty</span><span>Unit</span><span>CAD$/unit</span><span>Value</span><span>Source</span><span></span>
      </div>${rows}
      <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding:8px 0;border-top:1px solid #eee;margin-top:4px;">
        <span>Total inventory value</span><span style="color:#1a7a4a;">$${totalValue.toFixed(2)} CAD</span>
      </div>`);
  }

  // Shopping list coverage — what inventory covers for current event
  if (cocktails.length && coverage.length) {
    const covered = coverage.filter(i => i.inStock > 0);
    const stillBuy = coverage.filter(i => i.stillNeeded > 0);
    if (covered.length > 0) {
      shtml('invCoverage', `
        <div class="card">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px;color:#666;">
            📋 Current event — what inventory covers
          </div>
          <div style="font-size:12px;color:#888;margin-bottom:10px;">
            Your stock covers <strong style="color:#1a7a4a;">$${totalSaved.toFixed(2)} CAD</strong> of this event.
            The quote to the client stays the same — this is your extra profit.
          </div>
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#aaa;padding-bottom:5px;border-bottom:1px solid #eee;">
            <span>Ingredient</span><span>Needed</span><span>From stock</span><span>Still buy</span><span>Saved</span>
          </div>
          ${coverage.map(i => `
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr;gap:8px;font-size:13px;padding:5px 0;border-bottom:0.5px solid #f5f5f0;">
              <span style="font-weight:${i.inStock > 0 ? '500' : '400'}">${i.name}</span>
              <span style="color:#888;">${(i.qtyRounded||i.qtyRaw).toFixed(1)} ${i.unit}</span>
              <span style="color:${i.inStock>0?'#1a7a4a':'#aaa'};">${i.inStock > 0 ? i.inStock.toFixed(1) + ' ' + i.unit : '—'}</span>
              <span style="color:${i.stillNeeded>0?'#1a1a1a':'#aaa'};">${i.stillNeeded > 0 ? i.stillNeeded.toFixed(1) + ' ' + i.unit : '✓ covered'}</span>
              <span style="color:#1a7a4a;font-weight:500;">${i.savedCost > 0 ? '$' + i.savedCost.toFixed(2) : '—'}</span>
            </div>`).join('')}
          <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;padding-top:8px;border-top:1px solid #eee;margin-top:4px;">
            <span>Total saved by inventory</span>
            <span style="color:#1a7a4a;">$${totalSaved.toFixed(2)} CAD — your extra profit</span>
          </div>
        </div>`);
    } else {
      shtml('invCoverage', '');
    }
  } else {
    shtml('invCoverage', '');
  }
}

function exportInventory() {
  if (!Object.keys(currentStock).length) { alert('No inventory to export.'); return; }
  const rows = [['Ingredient','Unit','Qty','CAD$/unit','Value CAD','Source','Where bought','Last updated']];
  Object.values(currentStock).forEach(s => {
    rows.push([s.name, s.unit, (s.qty||0).toFixed(2), (s.cpu||0).toFixed(4),
      ((s.qty||0)*(s.cpu||0)).toFixed(2), s.source||'manual', s.store||'', s.lastUpdated||'']);
  });
  const csv = rows.map(r => r.map(val => {
    const s = String(val==null?'':val);
    return s.includes(',') || s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s;
  }).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  a.download = 'inventory_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

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
// ═══ NAVIGATION & UI ═══
// Sidebar navigation, tab switching, mobile nav, overflow menu, undo system

// ── Page title map ──
const PAGE_TITLES = {
  dashboard:      'Dashboard',
  menu:           'Menu Builder',
  events:         'Events',
  shopping:       'Shopping List',
  postevent:      'Post-Event',
  recipelib:      'Recipe Library',
  mydb:           'Ingredients',
  inventory:      'Stock',
  receipts:       'Receipts',
  priceiq:        'Price IQ',
  retailerprices: 'Retailers'
};

// ── Legacy compat: GROUP_MAP still referenced by some functions ──
const GROUP_MAP = {
  event:     { subtabs: 'subtabs-event',     defaultTab: 'menu',      tabs: ['menu','postevent'] },
  shopping:  { subtabs: 'subtabs-shopping',   defaultTab: 'shopping',  tabs: ['shopping'] },
  recipes:   { subtabs: 'subtabs-recipes',   defaultTab: 'recipelib', tabs: ['recipelib','mydb'] },
  inventory: { subtabs: 'subtabs-inventory', defaultTab: 'inventory', tabs: ['inventory','receipts','priceiq','retailerprices'] },
  business:  { subtabs: 'subtabs-business',  defaultTab: 'events',    tabs: ['events','dashboard'] }
};
let currentGroup = 'event';
const groupLastTab = { event:'menu', recipes:'recipelib', inventory:'inventory', business:'events' };

let currentNav = 'dashboard';

// ── PRIMARY NAVIGATION ──
function navTo(id) {
  currentNav = id;

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const navBtn = document.getElementById('nav-' + id);
  if(navBtn) navBtn.classList.add('active');

  // Update mobile nav active state
  document.querySelectorAll('.mobile-nav-btn').forEach(b => b.classList.remove('active'));
  const mnavBtn = document.getElementById('mnav-' + id);
  if(mnavBtn) mnavBtn.classList.add('active');

  // Update page title
  const titleEl = document.getElementById('pageTitle');
  if(titleEl) titleEl.textContent = PAGE_TITLES[id] || id;

  // Event header actions — show on event-related tabs
  const eventTabs = ['menu', 'shopping', 'postevent'];
  const eventActions = document.getElementById('eventHeaderActions');
  if(eventActions) eventActions.style.display = eventTabs.includes(id) ? 'flex' : 'none';

  // Event settings card — show on post-event, hide on standalone
  const settingsCard = document.getElementById('eventSettingsCard');
  if(id === 'postevent') toggleEventSettings(true);
  else if(id === 'menu') {
    // Menu tab: settings handled by updateMenuStep
  } else {
    toggleEventSettings(false);
  }

  // Close sidebar on mobile
  closeSidebar();

  // Scroll to top
  const main = document.getElementById('mainContent');
  if(main) main.scrollTop = 0;

  // Switch content panel via sw()
  sw(id, null);
}

// ── Legacy switchGroup compat ──
function switchGroup(group, btn) {
  const targetTab = groupLastTab[group] || GROUP_MAP[group].defaultTab;
  navTo(targetTab);
}

// ── SIDEBAR TOGGLE (mobile) ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if(!sidebar) return;
  sidebar.classList.toggle('open');
  if(overlay) overlay.classList.toggle('show');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if(sidebar) sidebar.classList.remove('open');
  if(overlay) overlay.classList.remove('show');
}

// ═══ UNDO SYSTEM ═══
const UNDO_STACK = [];
const UNDO_MAX = 30;
let undoToastTimer = null;

function pushUndo(description, undoFn){
  UNDO_STACK.push({ description, undoFn, timestamp: Date.now() });
  if(UNDO_STACK.length > UNDO_MAX) UNDO_STACK.shift();
  showUndoToast(description);
}

function showUndoToast(msg){
  const toast = document.getElementById('undoToast');
  const msgEl = document.getElementById('undoToastMsg');
  if(!toast || !msgEl) return;
  msgEl.textContent = msg;
  toast.classList.add('show');
  if(undoToastTimer) clearTimeout(undoToastTimer);
  undoToastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
}

function doUndo(){
  const toast = document.getElementById('undoToast');
  if(!UNDO_STACK.length){ if(toast) toast.classList.remove('show'); return; }
  const action = UNDO_STACK.pop();
  try { action.undoFn(); }
  catch(e){ console.log('Undo failed:', e); }
  if(toast) toast.classList.remove('show');
  if(undoToastTimer) clearTimeout(undoToastTimer);
  showToast('↩ Undone: ' + action.description, 'success');
}

// ═══ OVERFLOW MENU ═══
function toggleOverflowMenu(){
  const m = el('overflowMenu');
  if(!m) return;
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
  if(m.style.display === 'block'){
    setTimeout(() => document.addEventListener('click', closeOverflowOnce, {once:true}), 10);
  }
}
function closeOverflowOnce(e){ if(!el('overflowMenu').contains(e.target)) closeOverflow(); }
function closeOverflow(){ const m=el('overflowMenu'); if(m) m.style.display='none'; }

// ── Legacy TAB_TITLES (still used by some functions) ──
const TAB_TITLES = {
  recipelib: '📖 My recipes',
  mydb:      '⭐ My ingredients',
  inventory: '📦 Stock',
  receipts:  '🧾 Receipts',
  priceiq:   '📊 Price IQ',
  events:    '📅 Events',
  dashboard: '📈 Dashboard'
};

function setToolbarContext(tabId){
  // Legacy — now handled by navTo
}

function toggleMenuSettings(){
  const card = el('eventSettingsCard');
  const body = el('eventSettingsBody');
  const btn  = el('eventSettingsToggleBtn');
  const cardWasHidden = !card || card.style.display === 'none';
  if(card) card.style.display = '';
  if(body){
    const shouldOpen = cardWasHidden ? true : body.style.display === 'none';
    body.style.display = shouldOpen ? 'block' : 'none';
    if(btn) btn.textContent = shouldOpen ? '▲ Hide' : '▼ Show';
  }
}

function toggleEventSettings(forceOpen){
  const card = el('eventSettingsCard');
  const body = el('eventSettingsBody');
  const btn  = el('eventSettingsToggleBtn');
  if(!card) return;

  if(forceOpen === false){
    card.style.display = 'none';
    return;
  }

  const onMenuTab = document.getElementById('menu') && document.getElementById('menu').classList.contains('active');
  if(onMenuTab && forceOpen === true){
    const step2 = el('menuStep2');
    if(!step2 || step2.style.display === 'none') return;
    card.style.display = '';
    if(body) body.style.display = 'none';
    if(btn) btn.textContent = '▼ Show';
    return;
  }

  card.style.display = '';
  if(!body) return;
  if(forceOpen === true){
    body.style.display = 'block';
    if(btn) btn.textContent = '▲ Hide';
  } else {
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    if(btn) btn.textContent = open ? '▲ Hide' : '▼ Show';
  }
}

// ═══ sw() — CORE TAB SWITCH (called by navTo and by internal code) ═══
function sw(id, btn){
  setToolbarContext(id);

  // Update group tracking (legacy compat)
  for(const [g, info] of Object.entries(GROUP_MAP)){
    if(info.tabs.includes(id)){
      groupLastTab[g] = id;
      currentGroup = g;
      break;
    }
  }

  // Show/hide content sections
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  const secEl = document.getElementById(id);
  if(secEl) secEl.classList.add('active');

  // Render the section that just became visible
  if(id==='menu'){
    if(menuEventActive === 'selecting'){
      const _midSlot = el('step1SettingsSlot');
      if(_midSlot) _midSlot.style.display = 'none';
      const _midNext = el('menuStep1Next');
      if(_midNext) _midNext.style.display = 'none';
    }
    renderMyLibrarySection(); syncSettings(); rC(); rQ(); updateMenuStep();
  }
  if(id==='shopping'){
    if(currentEventId && shopSelectedEventIds !== null && !shopSelectedEventIds.has(currentEventId)){
      if(shopSelectedEventIds.size === 0) shopSelectedEventIds.add(currentEventId);
    } else if(currentEventId && shopSelectedEventIds === null){
      shopSelectedEventIds = new Set([currentEventId]);
    }
    renderShopEventSelector(); rShop(); renderShoppingDeadline();
  }
  if(id==='events') renderEventLibrary();
  if(id==='masterlist') renderMasterList();
  if(id==='mydb') renderMyDB();
  if(id==='receipts') renderReceipts();
  if(id==='priceiq') renderPriceIQ(priceIQCache||[], 0);
  if(id==='retailerprices') renderRetailerPriceLibrary();
  if(id==='recipelib') renderRecipeLibrary();
  if(id==='postevent') renderPostEvent();
  if(id==='inventory') renderInventory();
  if(id==='dashboard') renderDashboard();
}
// ═══ AUTOSAVE & SAVE STATUS ═══
// Autosave timers, crash recovery, save notifications

let autosaveTimer = null;
let libraryAutosaveTimer = null; // timer for library auto-save
let eventAutoSaveTimer = null;

let cnManuallyEdited = false; // true once user types directly in cn field

function syncCnFromLabel(){
  const label = v('eventLabel');
  // Update toolbar display always
  const dispEl = el('eventLabelDisplay');
  if(dispEl) dispEl.textContent = label || 'Untitled event';
  // Sync cn unless user has manually edited it
  if(!cnManuallyEdited){
    sv('cn', label);
  }
  // If event name cleared, also clear cn (unless manually edited)
  if(!label && !cnManuallyEdited){
    sv('cn', '');
  }
}

function scheduleEventAutosave(){
  if(eventAutoSaveTimer) clearTimeout(eventAutoSaveTimer);
  eventAutoSaveTimer = setTimeout(() => {
    const name = v('eventLabel').trim();
    if(!name || name === 'Untitled event') return;
    // Auto-save only if not already saved with same name
    const existing = eventLibrary.find(e => e.id === currentEventId);
    if(!existing && (cocktails.length > 0 || v('ed') || v('cn'))){
      saveEventToLibrary(true); // silent save
    } else if(existing){
      saveEventToLibrary(true); // silent update
    }
  }, 2500);
}
let lastSavedState = null;

function getSimpleState(){
  // Lightweight state fingerprint for change detection
  return JSON.stringify({
    label: v('eventLabel'),
    gc: v('gc'), ed: v('ed'),
    cocktailCount: cocktails.length,
    cocktailNames: cocktails.map(c2=>c2.name).join(','),
    recipeCount: recipeLibrary.length,
    ingCount: myIngredients.length,
    eventCount: eventLibrary.length,
    stockKeys: Object.keys(currentStock).length
  });
}

function generateHistoryLabel(state, existing){
  const parts = [];
  const prev = existing && existing.state;
  if(!prev) return 'Initial save';

  // Helper: read field from flat state or nested quote subobject
  const fld = (s, k) => s ? (s[k] !== undefined ? s[k] : (s.quote && s.quote[k] !== undefined ? s.quote[k] : undefined)) : undefined;

  const prevC = (prev.cocktails||[]).length;
  const newC  = (state.cocktails||[]).length;
  if(newC > prevC) parts.push('+'+(newC-prevC)+' cocktail'+(newC-prevC!==1?'s':''));
  else if(newC < prevC) parts.push('-'+(prevC-newC)+' cocktail'+(prevC-newC!==1?'s':''));

  const prevGuests = parseInt(fld(prev,'guestCount')||50);
  const newGuests  = parseInt(fld(state,'guestCount')||50);
  if(newGuests !== prevGuests) parts.push(newGuests+' guests');

  const prevHrs = parseFloat(fld(prev,'hoursOfService')||fld(prev,'eventHrs')||4);
  const newHrs  = parseFloat(fld(state,'hoursOfService')||fld(state,'eventHrs')||4);
  if(newHrs !== prevHrs) parts.push(newHrs+'h');

  const prevRate = parseFloat(fld(prev,'hourlyRate')||fld(prev,'hr')||100);
  const newRate  = parseFloat(fld(state,'hourlyRate')||fld(state,'hr')||100);
  if(newRate !== prevRate) parts.push('$'+newRate+'/h');

  const prevMargin = parseFloat(fld(prev,'marginPct')||fld(prev,'mp')||35);
  const newMargin  = parseFloat(fld(state,'marginPct')||fld(state,'mp')||35);
  if(newMargin !== prevMargin) parts.push(newMargin+'% margin');

  const prevStaff = (prev.staff||prev.staffList||[]).length;
  const newStaff  = (state.staff||state.staffList||[]).length;
  if(newStaff !== prevStaff) parts.push(newStaff+' staff');

  const prevCocktailNames = (prev.cocktails||[]).map(c=>c.name).sort().join(',');
  const newCocktailNames  = (state.cocktails||[]).map(c=>c.name).sort().join(',');
  if(newCocktailNames !== prevCocktailNames && newC === prevC) parts.push('menu updated');

  if(parts.length === 0) parts.push('Minor update');
  return parts.join(' · ');
}


function scheduleAutosave(){
  if(autosaveTimer) clearTimeout(autosaveTimer);
  showAutosaveDot('saving');
  autosaveTimer = setTimeout(() => {
    const currentState = getSimpleState();
    if(currentState !== lastSavedState){
      showSaveStatus('saving');
      try {
        // 1. Crash-recovery autosave (localStorage, instant restore on crash)
        localStorage.setItem('bartender_autosave_v1', JSON.stringify({
          savedAt: new Date().toISOString(),
          eventLabel: v('eventLabel'),
          cocktails, staffList,
          settings: {
            gc: v('gc'), ed: v('ed'), eventHrs: v('eventHrs'),
            hr: v('hr'), mp: v('mp'), tf: v('tf'),
            drinksPerPerson: v('drinksPerPerson'), qn: v('qn')
          }
        }));
        lastSavedState = currentState;
        showAutosaveDot('saved');
        showSaveStatus('autosaved');
        setTimeout(() => showAutosaveDot(''), 2000);
      } catch(e){ console.log('Autosave failed:', e); }

      // 2. Auto-save to event library silently (with version history)
      if(currentEventId && v('eventLabel')){
        if(libraryAutosaveTimer) clearTimeout(libraryAutosaveTimer);
        libraryAutosaveTimer = setTimeout(() => {
          saveEventToLibrary(true); // silent = true
        }, 180000); // 3 minutes after last change
      }
    } else {
      showAutosaveDot('');
      // No changes — hide the saving pill if it was shown
      const pill = el('saveStatusPill');
      if(pill && pill.textContent === '⏳ Saving…') pill.style.display = 'none';
    }
  }, 1500);
}

function showAutosaveDot(state){
  const dot = document.getElementById('autosaveDot');
  if(!dot) return;
  dot.className = 'autosave-dot' + (state ? ' ' + state : '');
}

function checkAutosaveRestore(){
  try {
    const saved = localStorage.getItem('bartender_autosave_v1');
    if(!saved) return;
    const data = JSON.parse(saved);
    const savedAt = new Date(data.savedAt);
    const mins = Math.round((Date.now() - savedAt) / 60000);
    if(mins < 60 && data.eventLabel && data.cocktails && data.cocktails.length > 0){
      // Only offer restore if different from current state
      if(data.eventLabel !== v('eventLabel') || data.cocktails.length !== cocktails.length){
        const msg = 'Unsaved session found from ' + mins + ' minute' + (mins!==1?'s':'') + ' ago ('
          + data.eventLabel + ' · ' + data.cocktails.length + ' cocktail' + (data.cocktails.length!==1?'s':'') + '). Restore it?';
        if(confirm(msg)){
          sv('eventLabel', data.eventLabel || '');
          cocktails = data.cocktails || [];
          staffList = data.staffList || [];
          if(data.settings){
            const s = data.settings;
            if(s.gc) sv('gc', s.gc);
            if(s.ed) sv('ed', s.ed);
            if(s.eventHrs) sv('eventHrs', s.eventHrs);
            if(s.hr) sv('hr', s.hr);
            if(s.mp) sv('mp', s.mp);
            if(s.tf) sv('tf', s.tf);
            if(s.drinksPerPerson) sv('drinksPerPerson', s.drinksPerPerson);
            if(s.qn) sv('qn', s.qn);
          }
          menuEventActive = true;
          rC(); rQ(); syncSettings(); updateMenuStep();
          showToast('Session restored from autosave', 'success');
        }
        localStorage.removeItem('bartender_autosave_v1');
      }
    }
  } catch(e){ console.log('Autosave restore failed:', e); }
}

// ═══════════════════════════════════════════════════════════
function markUnsaved(){
  const sf = document.getElementById('savedFlash');
  if(sf) sf.style.display='none';
  scheduleAutosave();
  // Debounced auto-save to event library (silent — no file download)
  if(window._evSaveTimer) clearTimeout(window._evSaveTimer);
  window._evSaveTimer = setTimeout(() => {
    if(v('eventLabel')) saveEventToLibrary(true); // silent = no download
  }, 3000);
  // Debounced auto-save cocktails to recipe library
  if(window._libSaveTimer) clearTimeout(window._libSaveTimer);
  window._libSaveTimer = setTimeout(autoSaveAllToLibrary, 2000);
}
function showSaveStatus(type){
  // type: 'saving' | 'autosaved' | 'manualsaved'
  const pill = el('saveStatusPill');
  if(!pill) return;
  if(window._saveStatusTimer) clearTimeout(window._saveStatusTimer);

  const configs = {
    saving:      { text: '⏳ Saving…',      bg: 'var(--amber-bg)',  color: 'var(--amber)' },
    autosaved:   { text: '⚡ Auto-saved',    bg: 'var(--surface2)',  color: 'var(--text3)' },
    manualsaved: { text: '✅ Saved',         bg: 'var(--green-bg)',  color: 'var(--green)' },
  };
  const cfg = configs[type] || configs.autosaved;
  pill.textContent = cfg.text;
  pill.style.background = cfg.bg;
  pill.style.color = cfg.color;
  pill.style.display = 'block';
  pill.style.opacity = '1';

  if(type !== 'saving'){
    window._saveStatusTimer = setTimeout(function(){
      pill.style.opacity = '0';
      setTimeout(function(){ pill.style.display = 'none'; pill.style.opacity = '1'; }, 400);
    }, type === 'manualsaved' ? 3000 : 4000);
  }
}

function showSaveNotification(label, isNew){
  // Remove any existing notification
  const existing = document.getElementById('saveNotifBanner');
  if(existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'saveNotifBanner';
  banner.style.cssText = [
    'position:fixed',
    'top:64px',
    'left:50%',
    'transform:translateX(-50%) translateY(-12px)',
    'background:var(--surface)',
    'border:1.5px solid var(--border)',
    'border-radius:var(--radius-xl)',
    'padding:12px 20px',
    'box-shadow:var(--shadow-lg)',
    'z-index:9999',
    'display:flex',
    'align-items:center',
    'gap:10px',
    'font-family:var(--font)',
    'font-size:13px',
    'color:var(--text)',
    'pointer-events:none',
    'opacity:0',
    'transition:opacity .2s, transform .2s',
    'white-space:nowrap',
  ].join(';');

  const icon = isNew ? '🎉' : '✅';
  const msg  = isNew
    ? '<strong>' + label + '</strong> added to your event library'
    : '<strong>' + label + '</strong> saved';

  banner.innerHTML = '<span style="font-size:18px;line-height:1;">' + icon + '</span>'
    + '<div>'
    +   '<div style="font-weight:600;">' + (isNew ? 'Event saved!' : 'Changes saved') + '</div>'
    +   '<div style="font-size:11px;color:var(--text3);">' + msg + '</div>'
    + '</div>';

  document.body.appendChild(banner);

  // Animate in
  requestAnimationFrame(function(){
    banner.style.opacity = '1';
    banner.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Auto-dismiss after 2.5s
  setTimeout(function(){
    banner.style.opacity = '0';
    banner.style.transform = 'translateX(-50%) translateY(-8px)';
    setTimeout(function(){ banner.remove(); }, 250);
  }, 2500);
}

function flashSaved(){
  const revertBtn = el('revertBtn'); if(revertBtn) revertBtn.style.display = 'none';
  const flashEl = document.getElementById('savedFlash');
  if(flashEl){ flashEl.style.display='inline'; setTimeout(()=>{ flashEl.style.display='none'; }, 2000); }
  showSaveStatus('manualsaved');
}


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

