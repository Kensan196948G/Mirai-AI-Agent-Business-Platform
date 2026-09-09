/**
 * Policy Engine: Tool呼び出し・Source参照・Run開始を許可・保留・拒否する強制規則。
 *
 * SKILL.md / execution.yaml の記述（allowed_tools・forbidden_actions）だけをセキュリティ境界にしない。
 * ここでのチェックは、Skill定義の内容に関わらず常に適用される固定の拒否リスト・DB照合を含む。
 */

export class PolicyDeniedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

// どのSkillのallowed_toolsにも関わらず、常に拒否するTool名（Skill定義側の記述ミス・改変に備えた多層防御）。
const GLOBAL_FORBIDDEN_TOOLS = new Set([
  'shell.exec', 'sql.raw', 'http.fetch', 'equipment.control', 'external.send', 'formal-approval.decide',
]);

// Tool Gatewayが実際に実装している型付きToolのみ（新しいToolを追加する場合はここにも追記する）。
const REGISTERED_TOOLS = new Set([
  'knowledge.search-approved', 'knowledge.search-promoted', 'source.read-approved-snapshot', 'artifact.write-draft',
]);

// Run開始を許可するロール（Viewerは開始できない。既存の requireRole パターンに合わせる）。
const RUN_STARTER_ROLES = new Set(['Administrator', 'Developer', 'Reviewer', 'Approver', 'Knowledge Curator']);

export function authorizeRunStart({ user }) {
  if (!RUN_STARTER_ROLES.has(user.role)) {
    throw new PolicyDeniedError(`ロール「${user.role}」はAgent Runを開始できません`);
  }
}

/**
 * Tool呼び出しを許可するか判定する。呼び出し側（tool-gateway.js）は結果に関わらず
 * run_events へ permit/deny を記録すること。
 */
export function authorizeToolCall({ skillVersion, toolName }) {
  if (GLOBAL_FORBIDDEN_TOOLS.has(toolName)) {
    throw new PolicyDeniedError(`Tool「${toolName}」はグローバルに禁止されています`);
  }
  if (!REGISTERED_TOOLS.has(toolName)) {
    throw new PolicyDeniedError(`Tool「${toolName}」は登録されていません`);
  }
  if (skillVersion.status !== 'approved') {
    throw new PolicyDeniedError(`Skill版が未承認です（status=${skillVersion.status}）`);
  }
  const allowed = Array.isArray(skillVersion.allowed_tools)
    ? skillVersion.allowed_tools
    : JSON.parse(skillVersion.allowed_tools || '[]');
  if (!allowed.includes(toolName)) {
    throw new PolicyDeniedError(`Skill「${skillVersion.skill_id}」はTool「${toolName}」の使用を許可されていません`);
  }
}

/**
 * source_records への参照が許可されるか判定する。
 * classification='internal_project' の場合、Runのproject_idと一致しない限り拒否する
 * （利用者/LLMが渡すprojectIdをそのまま信用せず、Run作成時にサーバ側で固定したIDのみを使う）。
 */
export function authorizeSourceAccess({ run, sourceRecord }) {
  if (sourceRecord.status !== 'approved') {
    throw new PolicyDeniedError(`source_record ${sourceRecord.id} は未承認です（status=${sourceRecord.status}）`);
  }
  if (sourceRecord.effective_to && new Date(sourceRecord.effective_to) < startOfToday()) {
    throw new PolicyDeniedError(`source_record ${sourceRecord.id} は有効期限切れです（effective_to=${toDateString(sourceRecord.effective_to)}）`);
  }
  if (sourceRecord.classification === 'internal_project') {
    if (!run.project_id || Number(sourceRecord.project_scope) !== Number(run.project_id)) {
      throw new PolicyDeniedError(`source_record ${sourceRecord.id} は別案件の非公開情報のため参照できません`);
    }
  }
}

export function authorizeBudget({ reservation, additionalCost }) {
  const spent = Number(reservation.spent_usd);
  const reserved = Number(reservation.reserved_usd);
  if (spent + additionalCost > reserved) {
    throw new PolicyDeniedError(`予算上限（$${reserved}）を超過するため実行を保留します`);
  }
}

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function toDateString(v) {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}
