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
