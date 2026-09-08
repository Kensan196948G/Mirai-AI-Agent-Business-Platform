/**
 * Project の状態遷移マップ（WebUI 正本 `agentos-data.js` の PHASES / STATUS_PHASE / TRANSITIONS を
 * バックエンドへ移植したもの）。DB には持たず、現在の status から都度算出する。
 */

export const PHASES = ['相談・Idea', '企画・審査', '要件・設計', '開発・検証', 'Staging / UAT', '本番・効果測定', 'Knowledge化'];

export const STATUS_PHASE = {
  idea: 0, proposed: 1, approved: 2, active: 3, staging: 4, production: 5, suspended: 3, closed: 6, archived: 6,
};

/**
 * 遷移先ごとに risk と、承認が必要な場合の approval type を持つ。
 * approval が設定された遷移は、実行すると status を変えずに approval_requests を作成し、
 * 承認確定時にコントローラ側で実際の status 変更を行う（低リスク遷移は即時反映）。
 */
export const TRANSITIONS = {
  idea: [{ to: 'proposed', label: '審査へ提出', risk: 'R1' }],
  proposed: [{ to: 'approved', label: '案件承認（Gate）', risk: 'R2', approval: 'project_gate' }],
  approved: [{ to: 'active', label: '開発開始', risk: 'R1' }],
  active: [
    { to: 'staging', label: 'Staging移行', risk: 'R2' },
    { to: 'suspended', label: '保留', risk: 'R1' },
  ],
  staging: [{ to: 'production', label: '本番リリース', risk: 'R4', approval: 'production_release' }],
  production: [{ to: 'closed', label: '完了', risk: 'R1' }],
  suspended: [{ to: 'active', label: '再開', risk: 'R1' }],
  closed: [{ to: 'archived', label: 'アーカイブ', risk: 'R1' }],
  archived: [],
};

export function availableTransitions(status) {
  return TRANSITIONS[status] || [];
}

export function findTransition(status, to) {
  return availableTransitions(status).find((t) => t.to === to) || null;
}

export function phaseIndex(status) {
  return STATUS_PHASE[status] ?? 0;
}
