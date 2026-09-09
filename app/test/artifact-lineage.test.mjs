/** 成果物の差分・ハッシュ（C-15）のユニットテスト。DB 不要。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, inputHash, diffArtifacts, integrityOf } from '../src/lib/artifact-lineage.js';

test('contentHash: キー順や配列内オブジェクトのキー順に依存しない', () => {
  const a = { findings: ['x'], sources: [{ source_record_id: 1, locator: 'p' }], requires_human_review: true };
  const b = { requires_human_review: true, sources: [{ locator: 'p', source_record_id: 1 }], findings: ['x'] };
  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash({ ...a, findings: ['y'] }));
  assert.equal(inputHash({ query: 'q' }), inputHash({ query: 'q' }));
});

test('diffArtifacts: findings/unknowns/assumptions は文字列集合、sources は source_record_id 集合で追加・削除を出す', () => {
  const prev = { findings: ['a', 'b'], unknowns: ['u1'], assumptions: [], sources: [{ source_record_id: 1 }, { source_record_id: 2 }], requires_human_review: true };
  const next = { findings: ['b', 'c'], unknowns: ['u1', 'u2'], assumptions: ['as'], sources: [{ source_record_id: 2 }, { source_record_id: 3 }], requires_human_review: true };
  const d = diffArtifacts(prev, next);
  assert.deepEqual(d.findings, { added: ['c'], removed: ['a'], unchanged: 1 });
  assert.deepEqual(d.unknowns.added, ['u2']);
  assert.deepEqual(d.assumptions.added, ['as']);
  assert.deepEqual(d.sources, { added: ['3'], removed: ['1'], unchanged: 1 });
  assert.equal(d.changed, true);
  assert.equal(d.summary.findings, '+1 / -1');
  const same = diffArtifacts(prev, { ...prev });
  assert.equal(same.changed, false);
  assert.equal(diffArtifacts(null, {}).changed, false);
});

test('integrityOf: レビュー済みは固定ハッシュと現在の内容を比較し、草案は null', () => {
  const content = { findings: ['a'] };
  assert.equal(integrityOf({ review_state: 'draft', content }), null);
  assert.equal(integrityOf({ review_state: 'reviewed', content, reviewed_content_hash: contentHash(content) }), true);
  assert.equal(integrityOf({ review_state: 'reviewed', content: { findings: ['改変'] }, reviewed_content_hash: contentHash(content) }), false);
});
