#!/usr/bin/env node
/**
 * 公式サイト（www.mirai-const.co.jp）の公開ページを出典（source_records）へ取り込む運用バッチ（B-8/B-9）。
 * Agent Run からは使わない（Agent には http.fetch を与えない設計。取り込みは人が起動するバッチに限る）。
 *
 * 使い方:
 *   node ingest-sources.mjs <運用者のemail> --kind technology|work [--limit N] [--dry-run] [--url <1件だけ>]
 *   例: node ingest-sources.mjs admin@example.com --kind technology
 *
 * 動作:
 *   1. sitemap（wp-sitemap-posts-technology-1.xml / wp-sitemap-posts-work-1.xml）から詳細ページ URL を列挙
 *   2. 1 秒間隔で取得（robots.txt は全許可を確認済み。User-Agent を明示）
 *   3. lib/source-extract.js で本文・属性を抽出し、source-normalize Skill と同じ検査（電話番号・位置情報）で隔離判定
 *   4. status='pending' で保存（同じ URL・同じ内容なら unchanged、内容が変わっていれば version+1）
 *   5. 承認は manage-sources.mjs approve か POST /api/sources/:id/approve（Approver / Administrator）
 * 保存しないもの: 画像、地域／市区町村（詳細な位置情報）、ナビゲーション。
 */
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool, withTransaction } from './src/lib/db.js';
import { extractTechnologyPage, extractWorkPage } from './src/lib/source-extract.js';
import { saveIngestedSource } from './src/lib/source-ops.js';
import { SKILL_HANDLERS } from './src/agent-runtime/skills/index.js';

loadEnv(new URL('.env', import.meta.url).pathname);

const SITE = 'https://www.mirai-const.co.jp';
const KINDS = {
  technology: {
    sitemap: `${SITE}/wp-sitemap-posts-technology-1.xml`, pattern: /\/technology\/[a-z]+\/\d+\/$/,
    sourceType: 'technology_catalog', evidenceType: 'public_technology_page', extract: extractTechnologyPage,
  },
  work: {
    sitemap: `${SITE}/wp-sitemap-posts-work-1.xml`, pattern: /\/work\/[a-z]+\/\d+\/$/,
    sourceType: 'project_case', evidenceType: 'public_project_page', extract: extractWorkPage,
  },
};
const USER_AGENT = 'MiraiAgentOS-SourceIngest/1.0 (+internal; DX promotion dept.)';
const INTERVAL_MS = 1000;

const args = process.argv.slice(2);
const email = args[0];
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const kindName = opt('--kind');
const limit = Number(opt('--limit') || 0);
const onlyUrl = opt('--url');
const dryRun = args.includes('--dry-run');
if (!email || !KINDS[kindName]) {
  console.error('使い方: node ingest-sources.mjs <email> --kind technology|work [--limit N] [--dry-run] [--url <URL>]');
  process.exit(1);
}
const kind = KINDS[kindName];

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pool = getPool();
const { rows: users } = await pool.query(`SELECT id, name, role, active FROM users WHERE email = $1`, [email]);
if (users.length === 0 || !users[0].active) { console.error(`有効なユーザーが見つかりません: ${email}`); process.exit(1); }
const operator = users[0];
if (!['Administrator', 'Knowledge Curator', 'Developer'].includes(operator.role)) { console.error(`取り込みは Administrator / Knowledge Curator / Developer が行う（role=${operator.role}）`); process.exit(1); }

let urls;
if (onlyUrl) {
  urls = [onlyUrl];
} else {
  const xml = await fetchText(kind.sitemap);
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => kind.pattern.test(u)).sort();
}
if (limit > 0) urls = urls.slice(0, limit);
console.log(`${kindName}: ${urls.length} ページ${dryRun ? '（dry-run: 保存しない）' : ''}`);

const summary = { inserted: 0, new_version: 0, unchanged: 0, quarantined: 0, failed: 0 };
for (const url of urls) {
  try {
    const html = await fetchText(url);
    const page = kind.extract(html);
    if (!page.title || page.content_text.length < 40) throw new Error('本文を抽出できません');
    const check = await SKILL_HANDLERS['source-normalize']({ input: { raw_text: page.content_text, source_type: kind.sourceType } });
    const rec = {
      canonicalUrl: url, title: page.title, sourceType: kind.sourceType, evidenceType: kind.evidenceType,
      category: page.category, summary: page.summary, contentText: check.normalized_text, attributes: page.attributes,
      quarantined: check.quarantined, quarantineReasons: check.quarantine_reasons, fetchedAt: new Date(), ingestedBy: operator,
      licenseOrPermission: '自社公式サイトの公開情報',
    };
    if (dryRun) {
      console.log(`  [dry] ${page.title} | ${page.category || '-'} | ${page.content_text.length} 文字 | ${check.quarantined ? `隔離: ${check.quarantine_reasons.join('/')}` : 'ok'}`);
      continue;
    }
    const { action, record } = await withTransaction((client) => saveIngestedSource(client, rec));
    summary[check.quarantined && action !== 'unchanged' ? 'quarantined' : action]++;
    console.log(`  [${action}${check.quarantined ? '/quarantined' : ''}] ${record.source_code || ''} v${record.version} ${page.title}`);
  } catch (err) {
    summary.failed++;
    console.error(`  [failed] ${url}: ${err.message}`);
  }
  await sleep(INTERVAL_MS);
}
console.log(`完了: ${JSON.stringify(summary)}`);
await closePool();
