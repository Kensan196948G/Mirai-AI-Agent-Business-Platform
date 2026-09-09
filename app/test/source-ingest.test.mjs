/**
 * 出典取り込み（B-8/B-9）と検索語抽出（B-12）のユニットテスト。DB 不要。
 * HTML は公式サイトの構造（breadcrumb / h1.ent-tit / table.work-dit-table / div.mid-nav）を模した合成データ。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTechnologyPage, extractWorkPage, htmlToText } from '../src/lib/source-extract.js';
import { extractSearchTokens } from '../src/lib/search-tokens.js';

const TECH_HTML = `<html><body>
<div class="breadcrumb"><ul><li><a href="/">Home</a></li><li><a href="/technology/">技術紹介</a></li><li><a href="/technology/port/">港湾・海上</a></li><li>「TEST-System」試験用システム</li></ul></div>
<div class="mid-main">
<h1 class="ent-tit">「TEST-System」試験用システム</h1>
<p>本技術は、試験用のケーソン据付を自動で計測し、誘導する技術である。<br />（NETIS登録番号：QSK-000000-A）</p>
<p class="imagebox"><img src="x.png" alt="" />概念図</p>
<h2>特徴</h2>
<ul><li>傾斜計で傾斜を計測する</li><li>&amp; を含む &lt;特殊文字&gt;</li></ul>
<script>alert('x')</script>
</div>
<div class="mid-nav mid-nav__tax"><dl><dt>技術紹介</dt><dd>港湾・海上</dd></dl></div>
<h2 class="dit-one-tit">他の技術を探す</h2>
</body></html>`;

const WORK_HTML = `<html><body>
<div class="breadcrumb"><ul><li><a href="/">Home</a></li><li><a href="/work/">施工実績</a></li><li><a href="/work/land/">陸上工事</a></li><li>試験道路復旧工事</li></ul></div>
<div class="mid-main">
<h1 class="ent-tit">試験道路復旧工事</h1>
<ul id="work-img"><li><img src="p.jpg" alt="試験道路復旧工事"></li></ul>
<table class="work-dit-table">
<tr><th>着工年月日</th><td>2014年06月27日</td></tr><tr><th>竣工年月日</th><td>2015年09月30日</td></tr>
<tr><th>地域／都道府県</th><td>千葉県</td></tr><tr><th>地域／市区町村</th><td>テスト市テスト町1-2-3</td></tr>
<tr><th>発注者／区分</th><td>市区町村</td></tr><tr><th>構造／規模</th><td>軟弱地盤処理工事（表層混合処理工法）4,750㎡</td></tr>
<tr><th>施工形態</th><td>JV-メイン</td></tr></table>
<p class="imagebox">液状化対策工事を行うもの。</p>
</div>
<div class="mid-nav mid-nav__tax"><dl><dt>施工実績</dt><dd>海上工事</dd></dl></div>
</body></html>`;

test('htmlToText: script 除去・実体参照の復元・行分割', () => {
  const t = htmlToText('<p>a &amp; b<br>c</p><script>x()</script><li>d</li>');
  assert.equal(t, 'a & b\nc\nd');
});

test('技術ページ: 見出し・カテゴリ・NETIS番号・本文を抽出し、ナビゲーションと script を含めない', () => {
  const page = extractTechnologyPage(TECH_HTML);
  assert.equal(page.title, '「TEST-System」試験用システム');
  assert.equal(page.category, '港湾・海上');
  assert.equal(page.attributes.netis, 'QSK-000000-A');
  assert.ok(page.summary.startsWith('本技術は、試験用のケーソン据付'));
  assert.ok(page.content_text.includes('傾斜計で傾斜を計測する'));
  assert.ok(page.content_text.includes('& を含む <特殊文字>'));
  assert.ok(!page.content_text.includes('alert('));
  assert.ok(!page.content_text.includes('他の技術を探す'));
  assert.ok(!/技術紹介\n港湾・海上$/.test(page.content_text), 'mid-nav 以降を含めない');
});

test('施工実績ページ: 属性を構造化し、市区町村（詳細な位置情報）は保存しない', () => {
  const page = extractWorkPage(WORK_HTML);
  assert.equal(page.title, '試験道路復旧工事');
  assert.equal(page.category, '陸上工事');
  assert.deepEqual(page.attributes, {
    started_on: '2014年06月27日', completed_on: '2015年09月30日', prefecture: '千葉県', client_category: '市区町村',
    structure: '軟弱地盤処理工事（表層混合処理工法）4,750㎡', contract_form: 'JV-メイン', completed_year: 2015,
  });
  assert.ok(!page.content_text.includes('テスト市'), '市区町村を含めない');
  assert.ok(!JSON.stringify(page.attributes).includes('テスト市'));
  assert.ok(page.content_text.includes('地域／都道府県: 千葉県'));
  assert.equal(page.summary, '液状化対策工事を行うもの。');
  assert.ok(!page.content_text.includes('海上工事'), 'ナビゲーションを含めない');
});

test('検索語抽出: 日本語の文から技術名・カタカナ語・漢字語を取り出し、助詞や 1 文字を含めない', () => {
  const tokens = extractSearchTokens('港湾のケーソン据付工事で MC-Caisson を適用した実績と、類似条件での提案の論点');
  assert.ok(tokens.includes('MC-Caisson'));
  assert.ok(tokens.includes('Caisson'), '型番の一部にも一致させる');
  assert.ok(tokens.includes('ケーソン'));
  assert.ok(tokens.includes('港湾'));
  assert.ok(tokens.includes('据付'));
  assert.ok(!tokens.includes('を') && !tokens.includes('の'));
  assert.ok(tokens.every((t) => t.length >= 2));
  assert.deepEqual(extractSearchTokens(''), []);
  assert.deepEqual(extractSearchTokens('%_ を'), []);
});
