/**
 * Prompt Injection 対策（C-18）。
 * 出典本文・Tool 応答・利用者入力は「データ」であり「指示」ではない。LLM に渡す前の無害化と印付け、
 * LLM 出力に対するポリシー強制（人手確認の固定・根拠の範囲制限・秘密らしき文字列の除去）、
 * 取り込み時の指示文検出（隔離）をここに集約する。判定は決定的で、LLM に自己採点させない。
 */

/** 指示文・役割変更・秘密の要求らしきパターン（日本語 / 英語）。 */
export const INJECTION_PATTERNS = [
  { name: 'ignore_instructions', re: /(以前|これまで|上記|前述|全て|すべて)の(指示|命令|ルール|制約)を?(無視|忘れ|破棄)|ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|rules|prompts?)|disregard\s+(the\s+)?(previous|above)/i },
  { name: 'system_prompt', re: /システム\s*プロンプト|system\s*prompt|<\|im_start\|>|<\|system\|>|\[INST\]|```system/i },
  { name: 'role_override', re: /あなたは今から|今からあなたは|これ以降あなたは|you\s+are\s+now\s+(a|an|the)\b|act\s+as\s+(a|an)\s+(system|admin|developer)|developer\s+mode|jailbreak|DAN\s+mode/i },
  { name: 'policy_tamper', re: /requires_human_review\s*(を|=|:)\s*false|人手確認(を|は)?(不要|省略|スキップ)|レビュー(を|は)?(不要|省略|スキップ)|承認(を|は)?(不要|省略|スキップ|迂回)/i },
  { name: 'secret_request', re: /API\s*キー|api[_\s-]?key|secret\s*key|秘密鍵|パスワード(を|の)(教え|出力|表示|送信)|認証情報(を|の)(教え|出力|表示|送信)|connection\s*string|環境変数(を|の)(教え|出力|表示)/i },
  { name: 'exfiltration', re: /(http|https):\/\/[^\s"'<>]+\?[^\s"'<>]*(key|token|secret|password)=|(送信|送って|post|send)\s*(して|to)?\s*(http|https):\/\//i },
];

/** 秘密らしき文字列（LLM 出力に含まれていたら除去する）。 */
export const SECRET_PATTERNS = [
  { name: 'api_key_like', re: /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'aws_key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'private_key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { name: 'connection_string', re: /\b(postgres|postgresql|mysql|mongodb)(\+srv)?:\/\/[^\s"'<>]+:[^\s"'<>@]+@/i },
  { name: 'password_kv', re: /\b(password|passwd|pwd|secret|token)\s*[:=]\s*\S{6,}/i },
];

// 制御文字（改行・タブ以外）と、見えない文字（ゼロ幅・双方向制御・BOM）
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVISIBLE_CHARS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

export function scanForInjection(text) {
  const s = String(text || '');
  const matches = INJECTION_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name);
  return { suspicious: matches.length > 0, matches };
}

export function scanForSecrets(text) {
  const s = String(text || '');
  return SECRET_PATTERNS.filter((p) => p.re.test(s)).map((p) => p.name);
}

/** 制御文字・ゼロ幅文字・双方向制御文字を除き、長さを制限する（見えない指示の混入を防ぐ）。 */
export function sanitizeUntrustedText(text, { maxLength = 4000 } = {}) {
  let s = String(text ?? '');
  s = s.replace(CONTROL_CHARS, '').replace(INVISIBLE_CHARS, '');
  if (s.length > maxLength) s = `${s.slice(0, maxLength)}…（${s.length - maxLength} 文字省略）`;
  return s;
}

/**
 * LLM へ渡す入力を無害化し、指示文らしき箇所を検出する。文字列だけを対象に深く走査する。
 * 戻り値 { input: 無害化済み, signals: [{ path, matches }] }
 */
export function prepareUntrustedInput(input) {
  const signals = [];
  const walk = (v, path) => {
    if (typeof v === 'string') {
      const clean = sanitizeUntrustedText(v);
      const scan = scanForInjection(clean);
      if (scan.suspicious) signals.push({ path, matches: scan.matches });
      return clean;
    }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, path ? `${path}.${k}` : k)]));
    return v;
  };
  return { input: walk(input ?? {}, ''), signals };
}

const TEXT_LIST_FIELDS = ['findings', 'unknowns', 'assumptions', 'flags', 'confirmed', 'missing', 'similarities', 'differences'];

/** ネストしたオブジェクト（gaps / comparisons 等）の source_record_id をすべて集める。 */
export function collectSourceIds(value, acc = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => collectSourceIds(v, acc));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'source_record_id' && Number.isFinite(Number(v))) acc.add(Number(v));
      else collectSourceIds(v, acc);
    }
  }
  return acc;
}

/**
 * LLM 出力に対するポリシー強制。戻り値 { output, enforced: [{ rule, detail }] }
 * - requireHumanReview: requires_human_review を常に true にする
 * - allowedSourceIds: sources を、この Run で実際に検索・検証された出典に限定する（LLM が捏造した ID を除く）
 * - 文字列配列から秘密らしき記述と指示文を除去し、除去した事実を unknowns に残す
 */
export function enforceOutputPolicy(output, { requireHumanReview = false, allowedSourceIds = null } = {}) {
  if (!output || typeof output !== 'object') return { output, enforced: [] };
  const enforced = [];
  const out = JSON.parse(JSON.stringify(output));
  if (requireHumanReview && out.requires_human_review !== true) {
    enforced.push({ rule: 'requires_human_review', detail: `LLM 出力の ${JSON.stringify(out.requires_human_review)} を true に固定` });
    out.requires_human_review = true;
  }
  if (allowedSourceIds && Array.isArray(out.sources)) {
    const allowed = new Set([...allowedSourceIds].map(Number));
    const before = out.sources.length;
    out.sources = out.sources.filter((s) => allowed.has(Number(s?.source_record_id)));
    if (out.sources.length !== before) enforced.push({ rule: 'sources_scope', detail: `この Run で検索・検証されていない出典 ${before - out.sources.length} 件を除去` });
  }
  const removed = [];
  for (const f of TEXT_LIST_FIELDS) {
    if (!Array.isArray(out[f])) continue;
    out[f] = out[f].filter((x) => {
      if (typeof x !== 'string') return true;
      const secrets = scanForSecrets(x); const inj = scanForInjection(x);
      if (secrets.length || inj.suspicious) { removed.push({ field: f, reasons: [...secrets, ...inj.matches] }); return false; }
      return true;
    });
  }
  if (removed.length) {
    enforced.push({ rule: 'text_scrub', detail: `秘密らしき記述または指示文を ${removed.length} 件除去（${[...new Set(removed.flatMap((r) => r.reasons))].join(', ')}）` });
    if (Array.isArray(out.unknowns)) out.unknowns.push(`出力から不適切な記述を ${removed.length} 件除去しました（人手確認が必要）`);
  }
  return { output: out, enforced };
}
