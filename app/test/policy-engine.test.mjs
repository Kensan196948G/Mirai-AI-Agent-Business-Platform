import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeRunStart, authorizeToolCall, authorizeSourceAccess, authorizeBudget, PolicyDeniedError,
} from '../src/agent-runtime/policy-engine.js';

test('authorizeRunStart: Viewerは開始できない', () => {
  assert.throws(() => authorizeRunStart({ user: { role: 'Viewer' } }), PolicyDeniedError);
});

test('authorizeRunStart: Developerは開始できる', () => {
  assert.doesNotThrow(() => authorizeRunStart({ user: { role: 'Developer' } }));
});

test('authorizeToolCall: グローバル禁止Toolはallowed_toolsに含まれていても拒否される', () => {
  const skillVersion = { skill_id: 'x', status: 'approved', allowed_tools: ['equipment.control'] };
  assert.throws(() => authorizeToolCall({ skillVersion, toolName: 'equipment.control' }), PolicyDeniedError);
});

test('authorizeToolCall: 未登録Toolは拒否される', () => {
  const skillVersion = { skill_id: 'x', status: 'approved', allowed_tools: ['made.up.tool'] };
  assert.throws(() => authorizeToolCall({ skillVersion, toolName: 'made.up.tool' }), PolicyDeniedError);
});

test('authorizeToolCall: 未承認のSkill版は拒否される', () => {
  const skillVersion = { skill_id: 'x', status: 'draft', allowed_tools: ['knowledge.search-approved'] };
  assert.throws(() => authorizeToolCall({ skillVersion, toolName: 'knowledge.search-approved' }), PolicyDeniedError);
});

test('authorizeToolCall: allowed_toolsに含まれないToolは拒否される', () => {
  const skillVersion = { skill_id: 'x', status: 'approved', allowed_tools: ['artifact.write-draft'] };
  assert.throws(() => authorizeToolCall({ skillVersion, toolName: 'knowledge.search-approved' }), PolicyDeniedError);
});

test('authorizeToolCall: 許可されたToolは通る', () => {
  const skillVersion = { skill_id: 'x', status: 'approved', allowed_tools: ['knowledge.search-approved'] };
  assert.doesNotThrow(() => authorizeToolCall({ skillVersion, toolName: 'knowledge.search-approved' }));
});

test('authorizeSourceAccess: 未承認のsource_recordは拒否される', () => {
  const run = { project_id: 1 };
  const sourceRecord = { id: 1, status: 'pending', classification: 'public' };
  assert.throws(() => authorizeSourceAccess({ run, sourceRecord }), PolicyDeniedError);
});

test('authorizeSourceAccess: publicな承認済みsourceは案件を問わず許可される', () => {
  const run = { project_id: null };
  const sourceRecord = { id: 1, status: 'approved', classification: 'public' };
  assert.doesNotThrow(() => authorizeSourceAccess({ run, sourceRecord }));
});

test('authorizeSourceAccess: 別案件のinternal_projectは拒否される（案件越境の防止）', () => {
  const run = { project_id: 1 };
  const sourceRecord = { id: 1, status: 'approved', classification: 'internal_project', project_scope: 2 };
  assert.throws(() => authorizeSourceAccess({ run, sourceRecord }), PolicyDeniedError);
});

test('authorizeSourceAccess: 同一案件のinternal_projectは許可される', () => {
  const run = { project_id: 1 };
  const sourceRecord = { id: 1, status: 'approved', classification: 'internal_project', project_scope: 1 };
  assert.doesNotThrow(() => authorizeSourceAccess({ run, sourceRecord }));
});

test('authorizeSourceAccess: Runがproject_idを持たない場合、internal_projectは拒否される', () => {
  const run = { project_id: null };
  const sourceRecord = { id: 1, status: 'approved', classification: 'internal_project', project_scope: 1 };
  assert.throws(() => authorizeSourceAccess({ run, sourceRecord }), PolicyDeniedError);
});

test('authorizeBudget: 予約額を超える追加コストは拒否される', () => {
  const reservation = { reserved_usd: 0.5, spent_usd: 0.45 };
  assert.throws(() => authorizeBudget({ reservation, additionalCost: 0.1 }), PolicyDeniedError);
});

test('authorizeBudget: 予約額内なら許可される', () => {
  const reservation = { reserved_usd: 0.5, spent_usd: 0.1 };
  assert.doesNotThrow(() => authorizeBudget({ reservation, additionalCost: 0.1 }));
});

test('authorizeToolCall: knowledge.search-promoted は登録済みToolとして許可される', () => {
  const skillVersion = { skill_id: 'knowledge-dedup', status: 'approved', allowed_tools: ['knowledge.search-promoted'] };
  assert.doesNotThrow(() => authorizeToolCall({ skillVersion, toolName: 'knowledge.search-promoted' }));
});

test('authorizeSourceAccess: 有効期限切れ（effective_to が過去）の出典は拒否され、未来なら許可される', () => {
  const run = { project_id: null };
  const base = { id: 9, status: 'approved', classification: 'public' };
  assert.throws(() => authorizeSourceAccess({ run, sourceRecord: { ...base, effective_to: '2000-01-01' } }), PolicyDeniedError);
  assert.doesNotThrow(() => authorizeSourceAccess({ run, sourceRecord: { ...base, effective_to: '2999-12-31' } }));
  assert.doesNotThrow(() => authorizeSourceAccess({ run, sourceRecord: { ...base, effective_to: null } }));
});
