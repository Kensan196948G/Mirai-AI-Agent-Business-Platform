/**
 * 統合カタログ: 組織（org-map.yaml）× P1 Agent（agents/*.yaml）× P2/P3 候補（backlog/p2-p3-catalog.yaml）。
 * AI相談の「近い Agent」提示、WebUI の一覧、部署別シートの正本として使う。
 * P2/P3 は候補であり実行できない。P1 は Registry で承認済みなら実行できる（runnable は DB を見て決める）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { DOMAIN_PACKS_ROOT, loadAgentDefinition, SkillLoaderError } from './skill-loader.js';

const cache = new Map();

function readYaml(packId, rel) {
  const path = join(DOMAIN_PACKS_ROOT, packId, rel);
  return yaml.load(readFileSync(path, 'utf8'), { schema: yaml.JSON_SCHEMA });
}

/** ファイル定義だけから統合カタログを組み立てる（DB は見ない）。 */
export function loadUnifiedCatalog(packId = 'mirai-construction') {
  if (cache.has(packId)) return cache.get(packId);
  const orgMap = readYaml(packId, 'org-map.yaml');
  const backlog = readYaml(packId, 'backlog/p2-p3-catalog.yaml');
  const candidates = new Map((backlog.candidates || []).map((c) => [c.agent_id, c]));
  const agents = new Map();
  for (const org of orgMap.organizations || []) {
    for (const agentId of org.agents || []) {
      let entry;
      try {
        const def = loadAgentDefinition(packId, agentId).definition;
        entry = {
          agent_id: agentId, stage: 'P1', title: def.title, purpose: String(def.purpose || '').trim(), does_not: String(def.does_not || '').trim(),
          owner_role: def.owner_role, max_autonomy_level: def.max_autonomy_level, skills: (def.skills || []).map((s) => s.skill_id), executable: true,
          layer: def.layer || 'organization', technical_risk_class: def.technical_risk_class || null, delegates_to: def.delegates_to || [],
        };
      } catch (err) {
        if (!(err instanceof SkillLoaderError)) throw err;
        const c = candidates.get(agentId);
        if (!c) throw new SkillLoaderError(`org-map.yaml の agent「${agentId}」は agents/ にも backlog にもありません`);
        entry = {
          agent_id: agentId, stage: c.stage, title: c.title, purpose: `${c.main_deliverable || ''}（候補: ${(c.skill_candidates || []).join('、')}）`,
          does_not: (c.forbidden || []).join('、'), owner_role: c.owner_role, max_autonomy_level: null, skills: c.skill_candidates || [], executable: false,
          backlog_id: c.id, required_materials: c.required_materials || [], layer: 'organization', technical_risk_class: null, delegates_to: [],
        };
      }
      entry.org_code = org.code; entry.dept = org.dept;
      agents.set(agentId, entry);
    }
  }
  const catalog = {
    pack_id: packId,
    organizations: (orgMap.organizations || []).map((o) => ({ code: o.code, dept: o.dept, org: o.org, keywords: o.keywords || [], agents: o.agents || [], note: o.note || '' })),
    agents: [...agents.values()],
  };
  cache.set(packId, catalog);
  return catalog;
}

export function findAgent(agentId, packId) {
  return loadUnifiedCatalog(packId).agents.find((a) => a.agent_id === agentId) || null;
}

/** LLM に渡す短い一覧（秘密を含まない。id / 名称 / 段階 / 部署 / 用途の要約）。 */
export function catalogForPrompt(packId) {
  const c = loadUnifiedCatalog(packId);
  return {
    organizations: c.organizations.map((o) => ({ code: o.code, dept: o.dept })),
    agents: c.agents.map((a) => ({ agent_id: a.agent_id, title: a.title, stage: a.stage, dept: a.dept, purpose: a.purpose.slice(0, 160) })),
  };
}

/**
 * 相談文の語から関係部署と近い Agent を決定的に絞り込む（LLM 未設定時の既定、LLM 結果の裏取りにも使う）。
 * 戻り値: { departments: [org code], agents: [{ agent_id, score }] }
 */
export function matchByKeywords(text, packId) {
  const c = loadUnifiedCatalog(packId);
  const t = String(text || '');
  const deptScores = c.organizations.map((o) => ({ code: o.code, score: o.keywords.filter((k) => t.includes(k)).length })).filter((d) => d.score > 0).sort((a, b) => b.score - a.score);
  // Agent は「相談文と Agent 自身の説明の両方に現れる語」がある場合だけ挙げる（部署が合うだけでは挙げない）
  const allKeywords = [...new Set(c.organizations.flatMap((o) => o.keywords))];
  const agentScores = c.agents.map((a) => {
    const body = [a.purpose, ...(a.skills || [])].join(' ');
    const hits = allKeywords.filter((k) => t.includes(k));
    const score = hits.reduce((n, k) => n + (a.title.includes(k) ? 3 : body.includes(k) ? 1 : 0), 0);
    return { agent_id: a.agent_id, score };
  }).filter((a) => a.score >= 2).sort((a, b) => b.score - a.score);
  return { departments: deptScores.slice(0, 3).map((d) => d.code), agents: agentScores.slice(0, 3) };
}

/** LLM が返した agent_id / 部署コードのうち、カタログに存在するものだけを残す。 */
export function validateSuggestions({ agentIds = [], departments = [] }, packId) {
  const c = loadUnifiedCatalog(packId);
  const known = new Set(c.agents.map((a) => a.agent_id));
  const orgs = new Set(c.organizations.map((o) => o.code));
  return {
    agentIds: [...new Set(agentIds.filter((id) => known.has(id)))],
    departments: [...new Set(departments.filter((d) => orgs.has(d)))],
  };
}

/** DB の承認状態を重ねて、実行可能かを付ける。client は省略可（省略時は executable のみ）。 */
export async function catalogWithRuntime(client, packId) {
  const c = loadUnifiedCatalog(packId);
  let approved = new Set();
  if (client) {
    const { rows } = await client.query(
      `SELECT av.agent_id FROM agent_versions av
       WHERE av.status = 'approved' AND NOT EXISTS (
         SELECT 1 FROM agent_skill_bindings b JOIN skill_versions sv ON sv.id = b.skill_version_id
         WHERE b.agent_version_id = av.id AND sv.status <> 'approved')`,
    );
    approved = new Set(rows.map((r) => r.agent_id));
  }
  return {
    ...c,
    agents: c.agents.map((a) => ({ ...a, runnable: a.executable && approved.has(a.agent_id) })),
  };
}
