/** 外部連携コネクタ（D 基盤）のユニットテスト。未設定なら外部へ出ない。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONNECTORS, listConnectorIds, runtimeStatus, checkConnector } from '../src/integrations/connectors.js';

test('runtimeStatus: 環境変数の有無で configured / missing_env / mode / blocked_reason を返し、値は含めない', () => {
  const none = runtimeStatus('notion', {});
  assert.equal(none.configured, false);
  assert.deepEqual(none.missing_env, ['NOTION_API_TOKEN', 'NOTION_KNOWLEDGE_DATABASE_ID']);
  assert.equal(none.mode, 'unconfigured');
  assert.match(none.blocked_reason, /環境変数が未設定/);
  const some = runtimeStatus('notion', { NOTION_API_TOKEN: 'secret-value', NOTION_KNOWLEDGE_DATABASE_ID: 'db' });
  assert.equal(some.configured, true);
  assert.equal(some.blocked_reason, null);
  assert.ok(!JSON.stringify(some).includes('secret-value'));
  const neo = runtimeStatus('neo', { NEO_BASE_URL: 'https://neo.example', NEO_API_TOKEN: 't' });
  assert.equal(neo.mode, 'spec_unconfirmed');
  assert.match(neo.blocked_reason, /仕様/);
  assert.equal(runtimeStatus('unknown', {}), null);
  assert.deepEqual(listConnectorIds().sort(), ['appsuite', 'github', 'gmail', 'neo', 'notion', 'slack']);
  for (const c of Object.values(CONNECTORS)) assert.ok(['A1', 'A2'].includes(c.autonomy) && Array.isArray(c.env) && c.env.length > 0);
});

test('checkConnector: 未設定なら外部へ出ずに理由を返し（checked=false）、設定済みは読み取り専用の疎通確認を行う', async () => {
  const savedFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = async (url) => { called++; return { ok: true, status: 200, text: async () => JSON.stringify(url.includes('slack') ? { ok: true, team: 'T' } : { name: 'bot' }) }; };
  try {
    const un = await checkConnector('notion', {});
    assert.equal(un.ok, false); assert.equal(un.checked, false); assert.equal(called, 0, '未設定では外部へ出ない');
    const ok = await checkConnector('notion', { NOTION_API_TOKEN: 'x', NOTION_KNOWLEDGE_DATABASE_ID: 'd' });
    assert.equal(ok.ok, true); assert.equal(ok.checked, true); assert.match(ok.detail, /Notion API 疎通 OK/);
    const sl = await checkConnector('slack', { SLACK_BOT_TOKEN: 'x', SLACK_NOTIFY_CHANNEL: '#c' });
    assert.equal(sl.ok, true);
    const neo = await checkConnector('neo', { NEO_BASE_URL: 'https://neo.example', NEO_API_TOKEN: 't' });
    assert.equal(neo.ok, false, '仕様未確認の SoR は到達しても接続済みにしない');
    assert.match(neo.detail, /仕様確認が未完了/);
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const fail = await checkConnector('github', { GITHUB_API_TOKEN: 'x', GITHUB_REPOSITORY: 'o/r' });
    assert.equal(fail.ok, false); assert.match(fail.detail, /ECONNREFUSED/);
    assert.equal((await checkConnector('nope', {})).ok, false);
  } finally { globalThis.fetch = savedFetch; }
});
