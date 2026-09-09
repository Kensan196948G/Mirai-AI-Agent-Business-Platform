/**
 * LLM Provider ごとの Circuit Breaker（H-017）。プロセス内メモリで連続失敗を数え、閾値に達したら一定時間呼び出しを止める。
 * open の間は structuredComplete が CircuitOpenError を投げ、Step は「circuit open」で明示的に失敗する（縮退の偽成功にしない）。
 *   LLM_CIRCUIT_FAILURES      連続失敗の閾値（既定 5）
 *   LLM_CIRCUIT_OPEN_SECONDS  open を維持する秒数（既定 300）。経過後は half-open（次の 1 回を試し、成功で閉じる・失敗で再 open）
 * JSON Schema 検証の失敗は Provider の障害ではないため数えない（API 呼び出しの例外だけを数える）。
 */
export class CircuitOpenError extends Error {
  constructor(provider, until) {
    super(`LLM Provider「${provider}」は連続失敗のため呼び出しを停止中です（circuit open、${until.toISOString()} まで）`);
    this.name = 'CircuitOpenError';
    this.provider = provider;
    this.until = until;
  }
}

const state = new Map(); // provider → { failures, openedUntil: Date|null, lastError, halfOpen }

export function circuitThreshold() { const n = Number(process.env.LLM_CIRCUIT_FAILURES || '5'); return n > 0 ? n : 5; }
export function circuitOpenSeconds() { const n = Number(process.env.LLM_CIRCUIT_OPEN_SECONDS || '300'); return n > 0 ? n : 300; }

function entry(provider) {
  if (!state.has(provider)) state.set(provider, { failures: 0, openedUntil: null, lastError: null, halfOpen: false, openedCount: 0 });
  return state.get(provider);
}

/** open なら CircuitOpenError を投げる。期限を過ぎていれば half-open として 1 回だけ通す。 */
export function assertClosed(provider, now = new Date()) {
  const e = entry(provider);
  if (!e.openedUntil) return;
  if (now < e.openedUntil) throw new CircuitOpenError(provider, e.openedUntil);
  e.halfOpen = true;
}

export function recordSuccess(provider) {
  const e = entry(provider);
  e.failures = 0; e.openedUntil = null; e.lastError = null; e.halfOpen = false;
}

/** 戻り値: 今回の失敗で open になった（または half-open から再 open した）なら true。 */
export function recordFailure(provider, err, now = new Date()) {
  const e = entry(provider);
  e.failures += 1; e.lastError = err?.message || String(err);
  if (e.halfOpen || e.failures >= circuitThreshold()) {
    e.openedUntil = new Date(now.getTime() + circuitOpenSeconds() * 1000); e.halfOpen = false; e.openedCount += 1;
    return true;
  }
  return false;
}

export function isOpen(provider, now = new Date()) {
  const e = state.get(provider);
  return !!(e && e.openedUntil && now < e.openedUntil);
}

/** /api/health 用（プロセス単位の状態。API プロセスと Worker プロセスで別々に数える）。 */
export function circuitStatus(now = new Date()) {
  const providers = {};
  for (const [p, e] of state) providers[p] = { failures: e.failures, open: !!(e.openedUntil && now < e.openedUntil), opened_until: e.openedUntil ? e.openedUntil.toISOString() : null, last_error: e.lastError, opened_count: e.openedCount };
  return { scope: 'process', threshold: circuitThreshold(), open_seconds: circuitOpenSeconds(), providers, open: Object.keys(providers).filter((p) => providers[p].open) };
}

export function resetCircuits() { state.clear(); }
