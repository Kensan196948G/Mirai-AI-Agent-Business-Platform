#!/usr/bin/env node
/**
 * source_records（技術選定Agent等が検索対象とする出典）へ、
 * docs/Mirai-Agent-Skill-Architecture.md が2026-09-08時点で確認済みの
 * 公開マーケティング情報（evidence_type: marketing_overview）を投入する。
 *
 * 本スクリプトは追加のWebFetchを行わない。architecture文書の§7・§16に記載された
 * 公式サイトURLと要約をそのまま出典として使う。個人情報・位置情報は含まない。
 * 冪等（既存のsource_codeがあればスキップ）。
 */
import { createHash } from 'node:crypto';
import { loadEnv } from './src/lib/env.js';
import { getPool, closePool } from './src/lib/db.js';

loadEnv(new URL('.env', import.meta.url).pathname);

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

const RECORDS = [
  {
    source_code: 'SRC-0001',
    canonical_url: 'https://www.mirai-const.co.jp/technology/port/5061/',
    title: 'MC-Float Navi',
    source_type: 'technology_catalog',
    evidence_type: 'marketing_overview',
    summary:
      'MC-Float Naviは、公式サイトで公開されている港湾関連技術。技術説明・適用検討の参考にできるが、' +
      '侵入禁止範囲や発報条件そのものを本アプリから自動変更することはできない（公開概要のみを根拠とする）。',
  },
  {
    source_code: 'SRC-0002',
    canonical_url: 'https://www.mirai-const.co.jp/technology/port/4361/',
    title: 'MC-Caisson',
    source_type: 'technology_catalog',
    evidence_type: 'marketing_overview',
    summary:
      'MC-Caissonは、公式サイトで公開されている港湾関連技術。出来形帳票の確認支援・記録の説明比較の' +
      '参考にできるが、ポンプ・注排水・位置誘導を本アプリから直接制御することはできない（公開概要のみを根拠とする）。',
  },
  {
    source_code: 'SRC-0003',
    canonical_url: 'https://www.mirai-const.co.jp/technology/port/3783/',
    title: 'MC-Wake',
    source_type: 'technology_catalog',
    evidence_type: 'marketing_overview',
    summary:
      'MC-Wakeは、公式サイトで公開されている港湾関連技術。警告記録の説明・確認事項の整理の参考にできるが、' +
      '航跡波警報の抑制・代替・解除を本アプリから行うことはできない（公開概要のみを根拠とする）。',
  },
  {
    source_code: 'SRC-0004',
    canonical_url: 'https://www.mirai-const.co.jp/technology/ground/633/',
    title: 'CPG工法',
    source_type: 'technology_catalog',
    evidence_type: 'marketing_overview',
    summary:
      'CPG工法は、公式サイトで公開されている地盤改良技術。公開概要の検索・適用条件の不足情報整理の' +
      '参考にできるが、公開ページの記載だけで施工設計・工法確定を行うことはできない（公開概要のみを根拠とする）。',
  },
  {
    source_code: 'SRC-0005',
    canonical_url: 'https://www.mirai-const.co.jp/technology/environment/',
    title: '環境関連技術（公式サイト概要）',
    source_type: 'technology_catalog',
    evidence_type: 'marketing_overview',
    summary: '環境関連の技術紹介ページ。個別技術の詳細な適用条件・数値は公開ページの記載範囲を超えて断定しない。',
  },
  {
    source_code: 'SRC-0006',
    canonical_url: 'https://www.mirai-const.co.jp/work/',
    title: '施工実績（公式サイト概要、合成Fixture）',
    source_type: 'project_case',
    evidence_type: 'synthetic_fixture',
    summary:
      '（合成Fixture）海上・陸上施工実績の一般的なカテゴリ例。個人情報・位置情報・顧客固有情報は含まない。' +
      '実際の個別案件の詳細は本Fixtureには含まれない（P1初期の検索動作確認用）。',
  },
];

async function main() {
  const pool = getPool();
  for (const r of RECORDS) {
    const existing = await pool.query(`SELECT 1 FROM source_records WHERE source_code = $1`, [r.source_code]);
    if (existing.rows.length > 0) {
      console.log(`スキップ（既存）: ${r.source_code}`);
      continue;
    }
    await pool.query(
      `INSERT INTO source_records
         (source_code, canonical_url, title, source_type, evidence_type, summary,
          fetched_at, content_hash, classification, status)
       VALUES ($1,$2,$3,$4,$5,$6, '2026-09-08T00:00:00Z', $7, 'public', 'approved')`,
      [r.source_code, r.canonical_url, r.title, r.source_type, r.evidence_type, r.summary, hash(r.summary)],
    );
    console.log(`投入: ${r.source_code} ${r.title}`);
  }
  console.log(`完了: ${RECORDS.length} 件を確認しました`);
  await closePool();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
