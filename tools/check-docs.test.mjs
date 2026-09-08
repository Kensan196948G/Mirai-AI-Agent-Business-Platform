/**
 * check-docs.mjs のユニットテスト（node --test / 依存ゼロ）
 *
 * 注意: 秘密情報の検出テストで使うダミー値は、本ファイル自身が DOC003 に
 * 引っかからないよう文字列連結で組み立てている（実在の資格情報は一切含まない）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripFences,
  extractReferences,
  resolveReference,
  checkReferences,
  checkMarkdownHtmlPairs,
  scanSecrets,
  checkDocumentInfo,
  checkSingleH1,
  extractDecisionIds,
  checkDecisionIds,
} from './check-docs.mjs';

test('stripFences: コードフェンス内の行を除去する', () => {
  const text = ['# 見出し', '```text', '# フェンス内のシャープ', '```', '本文'].join('\n');
  const stripped = stripFences(text);
  assert.ok(stripped.includes('# 見出し'));
  assert.ok(!stripped.includes('フェンス内のシャープ'));
});

test('extractReferences: 文書参照を抽出し URL は無視する', () => {
  const text = ['`docs/ai-dx-dev-process.md` を参照', 'https://example.com/a.html は対象外'].join('\n');
  const refs = extractReferences(text).map((r) => r.ref);
  assert.deepEqual(refs, ['docs/ai-dx-dev-process.md']);
});

test('extractReferences: 拡張子のみの表記（`.html`）は参照として拾わない', () => {
  assert.equal(extractReferences('`ai-dx-dev-process.md` / `.html`').length, 1);
});

test('extractReferences: 日本語の括弧・句読点を参照名に含めない（回帰）', () => {
  const text = '作業時は「公式マニュアル追記版.html」が正、詳細は（docs/a.md）を参照。';
  const refs = extractReferences(text).map((r) => r.ref);
  assert.deepEqual(refs, ['公式マニュアル追記版.html', 'docs/a.md']);
});

test('resolveReference: パス指定は末尾一致、ファイル名のみは basename 末尾一致で解決する', () => {
  const files = ['docs/a.md', 'docs/manual/AppSuite 設定手順書 公式マニュアル追記版.html'];
  assert.equal(resolveReference('docs/a.md', files), true);
  assert.equal(resolveReference('a.md', files), true);
  assert.equal(resolveReference('公式マニュアル追記版.html', files), true, 'スペース込み名の断片も解決できる');
  assert.equal(resolveReference('docs/missing.md', files), false);
});

test('checkReferences: 存在しない参照を error として報告する', () => {
  const out = checkReferences('README.md', '`docs/nonexistent-file.md` を参照', ['README.md']);
  assert.equal(out.length, 1);
  assert.equal(out[0].rule, 'DOC001');
  assert.equal(out[0].severity, 'error');
  assert.equal(out[0].line, 1);
});

test('checkMarkdownHtmlPairs: docs 配下で HTML 版が無ければ warn、リポジトリ直下は対象外', () => {
  const warns = checkMarkdownHtmlPairs(['docs/a.md', 'docs/b.md', 'docs/b.html', 'README.md']);
  assert.equal(warns.length, 1);
  assert.equal(warns[0].file, 'docs/a.md');
  assert.equal(warns[0].severity, 'warn');
});

test('scanSecrets: 例示ドメインのメールアドレスは検出しない', () => {
  assert.equal(scanSecrets('doc.md', '（例）taro' + '@example.com').length, 0);
});

test('scanSecrets: 実ドメインのメールアドレスは検出する', () => {
  const out = scanSecrets('doc.md', '連絡先: taro' + '@mirai-example-corp.co.jp');
  assert.equal(out.length, 1);
  assert.equal(out[0].rule, 'DOC003');
});

test('scanSecrets: トークン・接続文字列・平文資格情報を検出する', () => {
  const token = 'gh' + 'p_' + 'A'.repeat(36);
  const conn = 'postgres' + '://user:' + 'dummy' + '@db.internal:5432/app';
  const plain = 'password' + ' = "' + 'dummyvalue123' + '"';
  // 接続文字列は「資格情報付き接続文字列」と「メールアドレス形式」の両方に一致し得るため
  // 件数ではなく「1 件以上検出されること」を要件とする。
  for (const sample of [token, conn, plain]) {
    assert.ok(scanSecrets('doc.md', sample).length >= 1, `検出できていない: ${sample.slice(0, 12)}...`);
  }
});

test('scanSecrets: 検出値そのものをメッセージに出力しない', () => {
  const token = 'gh' + 'p_' + 'B'.repeat(36);
  const [f] = scanSecrets('doc.md', token);
  assert.ok(!f.message.includes(token), '秘密候補の値が報告文へ漏れている');
  assert.ok(f.message.includes('値は非表示'));
});

test('checkDocumentInfo: 文書情報にステータス行が無ければ error', () => {
  const withStatus = '## 文書情報\n\n| 項目 | 内容 |\n| ステータス | Draft |';
  const without = '## 文書情報\n\n| 項目 | 内容 |\n| 版数 | v0.5 |';
  assert.equal(checkDocumentInfo('a.md', withStatus).length, 0);
  assert.equal(checkDocumentInfo('a.md', without).length, 1);
  assert.equal(checkDocumentInfo('a.md', '## 別の見出し').length, 0, '文書情報が無い文書は対象外');
});

test('checkSingleH1: h1 が 0 個・2 個以上なら error', () => {
  assert.equal(checkSingleH1('a.md', '# タイトル\n\n本文').length, 0);
  assert.equal(checkSingleH1('a.md', '本文のみ').length, 1);
  assert.equal(checkSingleH1('a.md', '# A\n\n# B').length, 1);
  assert.equal(checkSingleH1('a.md', '# A\n\n```text\n# B\n```').length, 0, 'フェンス内は h1 と見なさない');
});

test('extractDecisionIds: 表の先頭セルから Q/P の ID を抽出する', () => {
  const ids = extractDecisionIds('| Q1 | 論点 |\n| P-1 | 論点 |\n| 説明 | Q9 は本文中 |');
  assert.deepEqual([...ids].sort(), ['P-1', 'Q1']);
});

test('checkDecisionIds: README と計画書の決定項目の食い違いを検出する', () => {
  const readme = '| Q1 | a |\n| P-1 | b |\n| P-2 | c |';
  const guide = '| Q1 | a |\n| P-1 | b |';
  const out = checkDecisionIds(readme, guide, 'README.md', 'guide.md');
  assert.equal(out.length, 1);
  assert.equal(out[0].file, 'guide.md');
  assert.ok(out[0].message.includes('P-2'));

  assert.equal(checkDecisionIds(readme, readme, 'README.md', 'guide.md').length, 0);
});
