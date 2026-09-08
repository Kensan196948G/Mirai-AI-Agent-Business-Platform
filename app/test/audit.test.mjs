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
