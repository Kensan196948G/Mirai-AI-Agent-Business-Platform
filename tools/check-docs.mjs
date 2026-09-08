#!/usr/bin/env node
/**
 * 文書整合性チェッカ（Documentation SoR Quality Gate）
 *
 * 本リポジトリは「自前アプリの新規開発を行わない」方針のドキュメント正本である。
 * そのため lint 対象はコードではなく文書であり、外部依存ゼロ（Node 標準機能のみ）で
 * 以下を検証する。依存を持たないのは、非エンジニアの担当者でも `node tools/check-docs.mjs`
 * だけで再現でき、supply-chain リスクを持ち込まないため。
 *
 *   DOC001  文書内で参照されているファイル（.md / .html / .pptx）が実在するか
 *   DOC002  `.md` と `.html` の対になる版が揃っているか
 *   DOC003  秘密情報・個人情報らしき文字列が混入していないか
 *   DOC004  「## 文書情報」を持つ文書にステータス行があるか
 *   DOC005  Q1〜Q7 / P-1〜P-12 の決定項目 ID が README と SaaS構築計画書で一致するか
 *   DOC006  Markdown の h1 見出しが 1 文書に 1 つだけか
 *
 * 使い方: node tools/check-docs.mjs [--root <dir>]
 * 終了コード: error が 1 件でもあれば 1、それ以外は 0
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';

// ---------------------------------------------------------------------------
// 共通ユーティリティ
// ---------------------------------------------------------------------------

/** 走査から除外するディレクトリ */
const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.claude', '.venv', 'dist', 'build']);

/** 秘密情報スキャン対象の拡張子 */
const SCANNABLE_EXT = ['.md', '.html', '.yml', '.yaml', '.json', '.txt', '.mjs', '.js'];

/** 参照解決の対象拡張子 */
const REFERENCE_EXT = ['md', 'html', 'pptx'];

/** 例示用として許可するメールドメイン */
const SAMPLE_EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'example.jp'];

export function walk(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** コードフェンス（``` で囲まれた範囲）を空行へ置換する。見出し判定の誤検出を防ぐ。 */
export function stripFences(text) {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return '';
      }
      return inFence ? '' : line;
    })
    .join('\n');
}

function finding(rule, severity, file, line, message) {
  return { rule, severity, file, line, message };
}

// ---------------------------------------------------------------------------
// DOC001: 参照ファイルの実在確認
// ---------------------------------------------------------------------------

/**
 * 文書中の `xxx.md` / `xxx.html` / `xxx.pptx` を抽出する。
 * 日本語ファイル名にはスペースを含むものがあり厳密なパス復元ができないため、
 * 「実在ファイルのパス末尾と一致するか」でも解決可とする（誤検出を避け、
 * 「どこにも存在しない参照」だけを error にする）。
 */
export function extractReferences(text) {
  // 日本語文中では「」『』（）等が直前に来るため、これらも区切り文字として扱う
  const DELIMS = '\\s`"\'<>|,()\\[\\]「」『』（）【】〈〉《》、。・：；？！';
  const re = new RegExp(`[^${DELIMS}]+\\.(?:${REFERENCE_EXT.join('|')})`, 'g');
  const refs = [];
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(re)) {
      const raw = m[0].replace(/^\.\//, '').replace(/[.,)\]]+$/, '');
      if (raw.startsWith('http://') || raw.startsWith('https://')) continue;
      refs.push({ ref: raw, line: i + 1 });
    }
  });
  return refs;
}

export function resolveReference(ref, fileList) {
  const normalized = ref.replace(/^\.\//, '');
  // パス指定（`/` を含む）は完全一致・末尾一致で解決する
  if (normalized.includes('/')) {
    return fileList.some((f) => f === normalized || f.endsWith('/' + normalized));
  }
  // ファイル名のみの参照は basename の末尾一致で解決する。
  // 日本語ファイル名にはスペースを含むものがあり、本文中の参照からは
  // 語頭が欠けた断片しか取り出せないため（例: 「AppSuite 設定手順書 公式マニュアル追記版.html」）。
  return fileList.some((f) => basename(f) === normalized || basename(f).endsWith(normalized));
}

export function checkReferences(file, text, fileList) {
  const out = [];
  for (const { ref, line } of extractReferences(text)) {
    if (!resolveReference(ref, fileList)) {
      out.push(finding('DOC001', 'error', file, line, `参照先のファイルが存在しない: ${ref}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOC002: .md / .html ペアの整合
// ---------------------------------------------------------------------------

export function checkMarkdownHtmlPairs(fileList) {
  const out = [];
  const htmlSet = new Set(fileList.filter((f) => f.endsWith('.html')));
  for (const md of fileList.filter((f) => f.endsWith('.md'))) {
    if (!md.startsWith('docs/')) continue; // docs/ 配下の配布文書のみ対象
    const html = md.replace(/\.md$/, '.html');
    if (!htmlSet.has(html)) {
      out.push(
        finding('DOC002', 'warn', md, 0, `対になる HTML 版が存在しない（配布用に生成が必要）: ${html}`),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOC003: 秘密情報・個人情報スキャン
// ---------------------------------------------------------------------------

/** 検出パターン。自分自身を検知しないようリテラルは分割して組み立てる。 */
export const SECRET_PATTERNS = [
  { name: 'メールアドレス（例示ドメイン以外）', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { name: '秘密鍵ヘッダ', re: new RegExp('-----BEGIN [A-Z ]*' + 'PRIVATE KEY-----', 'g') },
  { name: 'AWS アクセスキー', re: new RegExp('AKI' + 'A[0-9A-Z]{16}', 'g') },
  { name: 'GitHub トークン', re: new RegExp('(gh[pousr]_[A-Za-z0-9]{20,}|github' + '_pat_[A-Za-z0-9_]{20,})', 'g') },
  { name: 'Slack トークン', re: new RegExp('xox' + '[baprs]-[A-Za-z0-9-]{10,}', 'g') },
  { name: '資格情報付き接続文字列', re: /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s:/@]+@[^\s/]+/g },
  { name: '平文の資格情報代入', re: /\b(?:password|passwd|api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*["'][^"'\s]{8,}["']/gi },
];

/**
 * 意図的な非秘密値（CI の使い捨て認証情報、テストフィクスチャ等）を明示的に許可するマーカー。
 * `doc003-allow: <理由>` を同じ行のコメントに書くと、その行の検出をスキップする。
 * パス単位の一括除外にしないのは、除外理由を書いた本人以外にも一目で分かるようにするため。
 */
const ALLOW_MARKER = /doc003-allow:\s*\S/;

/** 検出値そのものは絶対に出力しない（値の代わりに位置と種別のみ報告する） */
export function scanSecrets(file, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (ALLOW_MARKER.test(line)) return;
    for (const { name, re } of SECRET_PATTERNS) {
      for (const m of line.matchAll(new RegExp(re.source, re.flags))) {
        const hit = m[0];
        if (name.startsWith('メールアドレス')) {
          const domain = hit.split('@')[1]?.toLowerCase() ?? '';
          if (SAMPLE_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith('.' + d))) continue;
        }
        out.push(
          finding('DOC003', 'error', file, i + 1, `${name}らしき文字列を検出（値は非表示）。除去または匿名化し、必要なら rotation する`),
        );
      }
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// DOC004 / DOC006: 文書構造
// ---------------------------------------------------------------------------

export function checkDocumentInfo(file, text) {
  const out = [];
  if (!/^##\s+文書情報\s*$/m.test(text)) return out;
  if (!/^\|\s*ステータス\s*\|/m.test(text)) {
    out.push(finding('DOC004', 'error', file, 0, '「## 文書情報」があるが「| ステータス |」行がない'));
  }
  return out;
}

export function checkSingleH1(file, text) {
  const out = [];
  const lines = stripFences(text).split('\n');
  const h1 = [];
  lines.forEach((line, i) => {
    if (/^#\s+\S/.test(line)) h1.push(i + 1);
  });
  if (h1.length === 0) out.push(finding('DOC006', 'error', file, 0, 'h1 見出し（# ）がない'));
  if (h1.length > 1) {
    out.push(finding('DOC006', 'error', file, h1[1], `h1 見出しが ${h1.length} 個ある（1 文書 1 つ）`));
  }
  return out;
}

// ---------------------------------------------------------------------------
// DOC005: 決定項目 ID の整合
// ---------------------------------------------------------------------------

export function extractDecisionIds(text) {
  const ids = new Set();
  for (const m of text.matchAll(/^\|\s*(Q\d+|P-\d+)\s*\|/gm)) ids.add(m[1]);
  return ids;
}

export function checkDecisionIds(readmeText, guideText, readmeFile, guideFile) {
  const out = [];
  const a = extractDecisionIds(readmeText);
  const b = extractDecisionIds(guideText);
  const missingInGuide = [...a].filter((id) => !b.has(id));
  const missingInReadme = [...b].filter((id) => !a.has(id));
  if (missingInGuide.length) {
    out.push(
      finding('DOC005', 'error', guideFile, 0, `README にあるが計画書にない決定項目: ${missingInGuide.join(', ')}`),
    );
  }
  if (missingInReadme.length) {
    out.push(
      finding('DOC005', 'error', readmeFile, 0, `計画書にあるが README にない決定項目: ${missingInReadme.join(', ')}`),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// 実行本体
// ---------------------------------------------------------------------------

export function runChecks(root) {
  const fileList = walk(root);
  const findings = [];
  const read = (f) => readFileSync(join(root, f), 'utf8');

  for (const file of fileList) {
    const ext = '.' + file.split('.').pop();
    if (!SCANNABLE_EXT.includes(ext)) continue;
    const text = read(file);

    if (file.endsWith('.md')) {
      findings.push(...checkReferences(file, text, fileList));
      findings.push(...checkDocumentInfo(file, text));
      // GitHub の Issue / PR テンプレートは h1 を持たない書式が正しいため対象外
      if (!file.startsWith('.github/')) findings.push(...checkSingleH1(file, text));
    }
    findings.push(...scanSecrets(file, text));
  }

  findings.push(...checkMarkdownHtmlPairs(fileList));

  const readmeFile = 'README.md';
  const guideFile = 'docs/ai-dx-dev-saas-setup-guide.md';
  if (fileList.includes(readmeFile) && fileList.includes(guideFile)) {
    findings.push(...checkDecisionIds(read(readmeFile), read(guideFile), readmeFile, guideFile));
  }

  return { fileList, findings };
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();

  const { fileList, findings } = runChecks(root);
  const errors = findings.filter((f) => f.severity === 'error');
  const warns = findings.filter((f) => f.severity === 'warn');

  for (const f of [...errors, ...warns]) {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(`${f.severity === 'error' ? 'ERROR' : 'WARN '} ${f.rule} ${loc} — ${f.message}`);
  }

  console.log(`\n検査対象 ${fileList.length} ファイル / error ${errors.length} 件 / warn ${warns.length} 件`);
  if (errors.length > 0) {
    console.log('判定: FAIL — error を解消してから PR を更新すること');
    process.exit(1);
  }
  console.log('判定: PASS');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
