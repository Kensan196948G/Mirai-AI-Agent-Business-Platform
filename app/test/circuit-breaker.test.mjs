/** H-017 Circuit Breaker のユニットテスト（DB 不要）。 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertClosed, recordFailure, recordSuccess, isOpen, circuitStatus, resetCircuits, CircuitOpenError } from '../src/agent-runtime/circuit-breaker.js';
import { validateToolResult, ToolResultError } from '../src/agent-runtime/tool-gateway.js';

beforeEach(() => { resetCircuits(); delete process.env.LLM_CIRCUIT_FAILURES; delete process.env.LLM_CIRCUIT_OPEN_SECONDS; });

test('circuit breaker: 連続失敗が閾値に達すると open になり、期間中は CircuitOpenError、成功で閉じる', () => {
  process.env.LLM_CIRCUIT_FAILURES = '3'; process.env.LLM_CIRCUIT_OPEN_SECONDS = '60';
  const t0 = new Date('2026-09-09T00:00:00Z');
  assert.equal(recordFailure('deepseek', new Error('503'), t0), false);
  assert.equal(recordFailure('deepseek', new Error('503'), t0), false);
  assert.doesNotThrow(() => assertClosed('deepseek', t0));
  assert.equal(recordFailure('deepseek', new Error('timeout'), t0), true, '3 回目で open');
  assert.equal(isOpen('deepseek', t0), true);
  assert.throws(() => assertClosed('deepseek', new Date(t0.getTime() + 30000)), CircuitOpenError);
  const st = circuitStatus(t0);
  assert.deepEqual(st.open, ['deepseek']); assert.equal(st.providers.deepseek.failures, 3); assert.equal(st.providers.deepseek.last_error, 'timeout'); assert.equal(st.scope, 'process');
  // 他 Provider には影響しない
  assert.doesNotThrow(() => assertClosed('openai', t0)); assert.equal(isOpen('openai', t0), false);
  // 期間経過 → half-open で 1 回通す。失敗すれば即再 open、成功すれば閉じる
  const t1 = new Date(t0.getTime() + 61000);
  assert.doesNotThrow(() => assertClosed('deepseek', t1));
  assert.equal(recordFailure('deepseek', new Error('still down'), t1), true, 'half-open での失敗は即 open');
  assert.throws(() => assertClosed('deepseek', new Date(t1.getTime() + 1000)), CircuitOpenError);
  const t2 = new Date(t1.getTime() + 61000);
  assert.doesNotThrow(() => assertClosed('deepseek', t2));
  recordSuccess('deepseek');
  assert.equal(isOpen('deepseek', t2), false); assert.equal(circuitStatus(t2).providers.deepseek.failures, 0);
});

test('circuit breaker: 既定の閾値は 5 回・300 秒', () => {
  const t0 = new Date();
  for (let i = 0; i < 4; i++) assert.equal(recordFailure('p', new Error('x'), t0), false);
  assert.equal(recordFailure('p', new Error('x'), t0), true);
  const until = new Date(circuitStatus(t0).providers.p.opened_until);
  assert.equal(Math.round((until - t0) / 1000), 300);
});

test('H-020 Tool 結果契約: 列欠落・BIGINT 文字列・未知の Tool は ToolResultError、適合する結果はそのまま返る', () => {
  assert.throws(() => validateToolResult('knowledge.search-approved', { candidates: [{ source_record_id: '12', title: 't', summary: 's', evidence_type: 'e' }] }), ToolResultError, 'pg の BIGINT 文字列は不適合');
  assert.throws(() => validateToolResult('knowledge.search-approved', { candidates: [{ source_record_id: 12, title: 't' }] }), ToolResultError, '列欠落');
  assert.throws(() => validateToolResult('knowledge.search-approved', { rows: [] }), ToolResultError);
  assert.throws(() => validateToolResult('artifact.write-draft', { artifact: { id: '42', artifact_code: 'ART-1', kind: 'k', title: 't', review_state: 'draft' } }), ToolResultError);
  assert.throws(() => validateToolResult('artifact.write-draft', { artifact: { id: 42, artifact_code: 'X-1', kind: 'k', title: 't', review_state: 'draft' } }), ToolResultError);
  assert.throws(() => validateToolResult('source.read-approved-snapshot', { source: { id: 1, title: 't', status: 'pending', source_type: 's' } }), ToolResultError, '承認済み以外は返さない');
  assert.throws(() => validateToolResult('shell.exec', { ok: true }), ToolResultError);
  const ok = { candidates: [{ source_record_id: 12, title: 't', summary: 's', evidence_type: 'e', source_type: 'x' }] };
  assert.equal(validateToolResult('knowledge.search-approved', ok), ok);
  assert.doesNotThrow(() => validateToolResult('artifact.write-draft', { artifact: { id: 0, artifact_code: 'ART-EVAL', kind: 'k', title: 't', review_state: 'draft', reused: false, evaluation_stub: true } }));
  assert.doesNotThrow(() => validateToolResult('knowledge.search-promoted', { candidates: [] }));
});
