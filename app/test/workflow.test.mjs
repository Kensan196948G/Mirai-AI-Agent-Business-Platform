import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableTransitions, findTransition, phaseIndex, TRANSITIONS } from '../src/lib/workflow.js';

test('availableTransitions: idea から proposed への遷移がある', () => {
  const ts = availableTransitions('idea');
  assert.equal(ts.length, 1);
  assert.equal(ts[0].to, 'proposed');
});

test('availableTransitions: archived は終端状態で遷移なし', () => {
  assert.deepEqual(availableTransitions('archived'), []);
});

test('availableTransitions: 未知の status は空配列', () => {
  assert.deepEqual(availableTransitions('unknown'), []);
});

test('findTransition: 存在する遷移を返す', () => {
  const t = findTransition('proposed', 'approved');
  assert.equal(t.risk, 'R2');
  assert.equal(t.approval, 'project_gate');
});

test('findTransition: 存在しない遷移は null', () => {
  assert.equal(findTransition('idea', 'production'), null);
});

test('phaseIndex: 既知/未知のstatusに対する挙動', () => {
  assert.equal(phaseIndex('idea'), 0);
  assert.equal(phaseIndex('production'), 5);
  assert.equal(phaseIndex('suspended'), 3);
  assert.equal(phaseIndex('unknown-status'), 0);
});

test('TRANSITIONS: R3以上の遷移は approval を必須とする（設計の一貫性）', () => {
  for (const [, ts] of Object.entries(TRANSITIONS)) {
    for (const t of ts) {
      const riskLevel = Number(t.risk.slice(1));
      if (riskLevel >= 3) assert.ok(t.approval, `${t.to} (${t.risk}) に approval が必要`);
    }
  }
});
