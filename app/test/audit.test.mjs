import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash, verifyChain, canonicalize } from '../src/lib/audit.js';

test('hash: 決定的（同じ入力は同じ出力）', () => {
  assert.equal(hash('abc'), hash('abc'));
});

test('hash: 8文字の16進文字列を返す', () => {
  assert.match(hash('hello world'), /^[0-9a-f]{8}$/);
});

test('hash: 異なる入力は異なる出力になる（衝突しない代表例）', () => {
  assert.notEqual(hash('a'), hash('b'));
});

function row(id, prevHash, hashVal, overrides = {}) {
  return {
    id,
    actor_type: 'user',
    actor_name: 'テスト太郎',
    action: 'test.action',
    resource_type: 'project',
    resource_id: '1',
    detail: {},
    prev_hash: prevHash,
    hash: hashVal,
    ...overrides,
  };
}

test('verifyChain: 正しく連結されたチェーンは ok:true', () => {
  // row() のデフォルト値と一致させ、audit.js 自身の canonicalize で hash を計算する
  const e1 = { actorType: 'user', actorName: 'テスト太郎', action: 'test.action', resourceType: 'project', resourceId: '1', detail: {} };
  const hash1 = hash('00000000' + canonicalize(e1));
  const rows = [row(1, '00000000', hash1)];
  const result = verifyChain(rows);
  assert.equal(result.ok, true);
  assert.deepEqual(result.breaks, []);
});

test('verifyChain: 複数件が正しく連結されている場合 ok:true', () => {
  const e1 = { actorType: 'agent', actorName: 'Developer Agent', action: 'tool_call', resourceType: 'task', resourceId: 'T-1', detail: { risk: 'R2' } };
  const hash1 = hash('00000000' + canonicalize(e1));
  const e2 = { actorType: 'user', actorName: '山田 太郎', action: 'approval_action', resourceType: 'approval', resourceId: 'APR-1', detail: {} };
  const hash2 = hash(hash1 + canonicalize(e2));
  const rows = [row(1, '00000000', hash1, { actor_type: 'agent', actor_name: 'Developer Agent', action: 'tool_call', resource_type: 'task', resource_id: 'T-1', detail: { risk: 'R2' } }),
                row(2, hash1, hash2, { action: 'approval_action', resource_type: 'approval', resource_id: 'APR-1', actor_name: '山田 太郎' })];
  const result = verifyChain(rows);
  assert.equal(result.ok, true);
});

test('verifyChain: 途中のhashが改ざんされていると breaks を報告する', () => {
  const rows = [row(1, '00000000', 'deadbeef')];
  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.equal(result.breaks.length, 1);
  assert.equal(result.breaks[0].id, 1);
});

test('verifyChain: prev_hash が直前のhashと不一致なら breaks を報告する', () => {
  const rows = [row(1, '00000000', 'aaaaaaaa'), row(2, 'ffffffff', 'bbbbbbbb')];
  const result = verifyChain(rows);
  assert.equal(result.ok, false);
  assert.ok(result.breaks.some((b) => b.id === 2));
});

test('F-30: 新規行は SHA-256（hash_version=2）で、旧行（version 1）と混在したチェーンも検証できる', async () => {
  const { hashFor, sha256, canonicalize, verifyChain, computeAnchorHash, CURRENT_HASH_VERSION } = await import('../src/lib/audit.js');
  assert.equal(CURRENT_HASH_VERSION, 2);
  assert.equal(hashFor(2, 'abc'), sha256('abc'));
  assert.equal(sha256('abc').length, 64);
  const e1 = { actorType: 'user', actorName: 'a', action: 'x', resourceType: 't', resourceId: '1', detail: {} };
  const e2 = { actorType: 'user', actorName: 'b', action: 'y', resourceType: 't', resourceId: '2', detail: { k: 1 } };
  const h1 = hashFor(1, '00000000' + canonicalize(e1));           // 旧行（djb2）
  const h2 = hashFor(2, h1 + canonicalize(e2));                    // 新行（sha256）。prev は旧行の 8 桁 hash
  const rows = [
    { id: 1, prev_hash: '00000000', hash: h1, hash_version: 1, actor_type: 'user', actor_name: 'a', action: 'x', resource_type: 't', resource_id: '1', detail: {} },
    { id: 2, prev_hash: h1, hash: h2, hash_version: 2, actor_type: 'user', actor_name: 'b', action: 'y', resource_type: 't', resource_id: '2', detail: { k: 1 } },
  ];
  const r = verifyChain(rows);
  assert.equal(r.ok, true);
  assert.deepEqual(r.versions, { 1: 1, 2: 1 });
  assert.equal(r.lastHash, h2);
  const tampered = verifyChain([rows[0], { ...rows[1], detail: { k: 2 } }]);
  assert.equal(tampered.ok, false);
  // 途中からの検証（アンカー以降）
  assert.equal(verifyChain([rows[1]], { startPrev: h1 }).ok, true);
  assert.equal(verifyChain([rows[1]], { startPrev: 'wrong' }).ok, false);
  const a1 = computeAnchorHash({ prevAnchorHash: null, lastAuditId: 2, lastHash: h2, entryCount: 2 });
  assert.equal(a1.length, 64);
  assert.notEqual(a1, computeAnchorHash({ prevAnchorHash: a1, lastAuditId: 2, lastHash: h2, entryCount: 2 }));
});

test('canonicalize: detail に Date が含まれても JSON.stringify と同じ ISO 文字列で安定化する（DB 往復後に hash が再現できる）', () => {
  const d = new Date('2026-09-09T00:00:00.000Z');
  const a = canonicalize({ actor_type: 'service', actor_name: 'x', action: 'y', resource_type: 'z', resource_id: 1, detail: { at: d, nested: { when: d } } });
  const b = canonicalize({ actor_type: 'service', actor_name: 'x', action: 'y', resource_type: 'z', resource_id: 1, detail: JSON.parse(JSON.stringify({ at: d, nested: { when: d } })) });
  assert.equal(a, b);
  assert.ok(a.includes('2026-09-09T00:00:00.000Z'));
});

test('canonicalize: detail に明示的な undefined 値のキー（role/dept 等、未指定フィールドの destructure でよく起きる）が含まれても、' +
  'PostgreSQL の JSONB へ保存して読み戻した後（＝undefined キーは失われる）と同じ hash を再計算できる', () => {
  const detailWithUndefined = { role: undefined, dept: undefined, name: undefined, email: undefined, active: false };
  const a = canonicalize({ actor_type: 'user', actor_name: 'x', action: 'user.deactivate', resource_type: 'user', resource_id: 1, detail: detailWithUndefined });
  // pg ドライバは JSONB パラメータを JSON.stringify 相当で送るため、undefined キーは保存されない。
  // DB から読み戻した後の detail はこの形になる。
  const roundTripped = JSON.parse(JSON.stringify(detailWithUndefined));
  const b = canonicalize({ actor_type: 'user', actor_name: 'x', action: 'user.deactivate', resource_type: 'user', resource_id: 1, detail: roundTripped });
  assert.equal(a, b);
  assert.deepEqual(roundTripped, { active: false });
  // 配列内の undefined は JSON.stringify と同じく null 化する（要素そのものは消えない）
  const arrA = canonicalize({ actor_type: 'x', actor_name: 'x', action: 'x', resource_type: 'x', resource_id: 1, detail: { list: [1, undefined, 3] } });
  const arrB = canonicalize({ actor_type: 'x', actor_name: 'x', action: 'x', resource_type: 'x', resource_id: 1, detail: JSON.parse(JSON.stringify({ list: [1, undefined, 3] })) });
  assert.equal(arrA, arrB);
});
