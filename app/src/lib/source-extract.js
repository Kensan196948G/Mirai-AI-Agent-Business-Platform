/**
 * 公式サイト（WordPress）の技術紹介・施工実績ページから、出典として保存する本文と属性を取り出す（B-8/B-9）。
 * 取り込みバッチ（ingest-sources.mjs）専用。Agent Run からは呼ばれない。
 *
 * 方針:
 * - 本文は <h1 class="ent-tit"> 以降、「他の技術を探す」「他の施工実績を探す」等のナビゲーション手前まで
 * - 画像・script・style・ナビゲーションは除去する
 * - 施工実績の「地域／市区町村」（詳細な位置情報）は保存しない。「地域／都道府県」は属性として残す
 * - 「発注者／区分」は公式サイトが公開している調達区分として属性に残す（個人名は含まれない前提。
 *   個人名らしき記述は source-normalize の検査で隔離される）
 */

const NAV_MARKERS = ['他の技術を探す', '他の施工実績を探す', 'すべて\nカテゴリ別', '技術紹介\n港湾・海上\n地盤改良'];

/** HTML を行区切りテキストへ（タグ除去・実体参照の復元・空行圧縮）。 */
export function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|th|td|dt|dd|section|article|ul|ol|table)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/ /g, ' ');
  return s.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** パンくず（Home > 技術紹介 > 港湾・海上 > ページ名）からカテゴリを取る。 */
export function extractBreadcrumb(html) {
  const m = String(html).match(/<div class="breadcrumb">([\s\S]*?)<\/div>/);
  if (!m) return [];
  return htmlToText(m[1]).split('\n').filter(Boolean);
}

/** <h1 class="ent-tit"> から本文開始、ナビゲーション見出しで本文終了。 */
export function extractMainText(html) {
  const s = String(html);
  const h1 = s.search(/<h1 class="ent-tit">/);
  if (h1 < 0) return '';
  // 本文ブロックの直後に来るナビゲーション（<div class="mid-nav ...">）以降は捨てる
  const nav = s.slice(h1).search(/<div class="mid-nav/);
  const text = htmlToText(nav > 0 ? s.slice(h1, h1 + nav) : s.slice(h1));
  let end = text.length;
  for (const marker of NAV_MARKERS) {
    const i = text.indexOf(marker);
    if (i > 0 && i < end) end = i;
  }
  return text.slice(0, end).trim();
}

/** 施工実績ページの「ラベル\n値」の並びを属性へ。詳細な位置情報（市区町村）は捨てる。 */
const WORK_FIELDS = {
  着工年月日: 'started_on',
  竣工年月日: 'completed_on',
  '地域／都道府県': 'prefecture',
  '発注者／区分': 'client_category',
  '構造／規模': 'structure',
  施工形態: 'contract_form',
};
const DROP_FIELDS = new Set(['地域／市区町村']);

export function extractWorkPage(html) {
  const crumbs = extractBreadcrumb(html);
  const lines = extractMainText(html).split('\n');
  const title = lines[0] || '';
  const attributes = {};
  const body = [];
  for (let i = 1; i < lines.length; i++) {
    const label = lines[i];
    if (DROP_FIELDS.has(label)) { i++; continue; }
    const key = WORK_FIELDS[label];
    if (key) { attributes[key] = lines[i + 1] || ''; i++; continue; }
    body.push(label);
  }
  const m = /(\d{4})年/.exec(attributes.completed_on || '');
  if (m) attributes.completed_year = Number(m[1]);
  const description = body.join('\n').trim();
  return {
    title,
    category: crumbs.length >= 3 ? crumbs[2] : null, // 海上工事 / 陸上工事 / エネルギー関連工事
    attributes,
    content_text: [title, ...Object.entries(attributes).filter(([k]) => k !== 'completed_year').map(([k, v]) => `${labelOf(k)}: ${v}`), description].join('\n'),
    summary: truncate(description || attributes.structure || '', 400),
  };
}

function labelOf(key) {
  return Object.entries(WORK_FIELDS).find(([, v]) => v === key)?.[0] || key;
}

export function extractTechnologyPage(html) {
  const crumbs = extractBreadcrumb(html);
  const text = extractMainText(html);
  const lines = text.split('\n');
  const title = lines[0] || '';
  const attributes = {};
  const netis = /NETIS登録番号[：:]\s*([A-Z]{2,3}-\d{6}-[A-Z]{1,2})/.exec(text);
  if (netis) attributes.netis = netis[1];
  const firstPara = lines.slice(1).find((l) => l.length >= 20 && !/^（/.test(l)) || '';
  return {
    title,
    category: crumbs.length >= 3 ? crumbs[2] : null, // 港湾・海上 / 地盤改良 / 環境関連技術 / 維持・管理
    attributes,
    content_text: text,
    summary: truncate(firstPara, 400),
  };
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
