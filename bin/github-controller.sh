#!/usr/bin/env bash
set -euo pipefail

# GitHub Controller: branch作成 → commit → push → PR → CI監視 → auto-merge → branch削除。
# GITHUB_POLICY.md の操作契約に従い、中央設定（Ruleset / auto-merge）が整っていない場合は
# auto-merge せず BLOCKED で停止する（fail closed）。

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
BASE="${GITHUB_BASE_REF:-main}"
MAX_CONFLICT_RETRY=3
MERGE_TIMEOUT_SEC=180

usage() {
  cat <<'EOF'
Usage: github-controller.sh <subcommand> [options]

Subcommands:
  setup      GitHub側の必須設定を適用（repo settings + main Ruleset）
  preflight  自動化の前提条件を検査（Ruleset / auto-merge / delete-branch）
  publish    変更をbranch化してpushし、PRを作成
  watch      PRのRequired Checksを監視（conflict時はbaseを取り込んで再検証）
  merge      Auto-Merge登録 → merge完了 → branch削除を確認
  run        preflight → publish → watch → merge を一括実行
  status     現在branchのPR状態を表示（read-only）

Publish/Run options:
  --slug <slug>        branch名を auto/<slug> にする（必須）
  --title <text>       PRタイトル（必須）
  --message <text>     commit message（必須）
  --body <text>        PR本文（既定はGITHUB_POLICY.md準拠テンプレート）
  --files "<paths>"    addするファイルの空白区切りリスト
  --all                全変更をaddする（明示時のみ）
  --update             既存branch/PRがあれば更新する

Environment:
  GITHUB_REPOSITORY   既定のリポジトリ（例: owner/repo）
EOF
}

log() { printf '[github-controller] %s\n' "$*" >&2; }
die() { printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh CLIが見つかりません"
  gh auth status >/dev/null 2>&1 || die "gh未認証です"
}

resolve_repo() {
  if [[ -n "${GITHUB_REPOSITORY:-}" ]]; then
    REPO="$GITHUB_REPOSITORY"
    return
  fi
  local origin
  origin="$(git -C "$ROOT_DIR" remote get-url origin 2>/dev/null || true)"
  [[ -n "$origin" ]] || die "remote originが未設定です（GITHUB_REPOSITORYでも指定可）"
  REPO="$(printf '%s\n' "$origin" | sed -E 's#(https?://[^/]+/|git@[^:]+:)##; s#\.git$##')"
  [[ "$REPO" == */* ]] || die "remote originからowner/repoを解決できません: $origin"
}

repo_setting() {
  gh api "repos/$REPO" --jq "$1" 2>/dev/null || printf 'false'
}

ruleset_has_required_checks() {
  local ids id
  ids="$(gh api "repos/$REPO/rulesets" --jq \
    '.[] | select(.target=="branch" and .enforcement=="active") | .id' 2>/dev/null || true)"
  for id in $ids; do
    if gh api "repos/$REPO/rulesets/$id" --jq \
      '[.rules[]? | select(.type=="required_status_checks")] | length > 0' \
      2>/dev/null | grep -qx 'true'; then
      return 0
    fi
  done
  return 1
}

branch_protection_has_required_checks() {
  local ctx
  ctx="$(gh api "repos/$REPO/branches/$BASE/protection" \
    --jq '.required_status_checks.contexts // [] | join(",")' 2>/dev/null || true)"
  [[ "$ctx" == *"quality (20)"* && "$ctx" == *"quality (24)"* && "$ctx" == *"compatibility"* ]]
}

preflight() {
  require_gh
  resolve_repo
  local ok=1

  [[ "$(repo_setting '.allow_auto_merge')" == "true" ]] || {
    log "NG: allow_auto_merge=false（setupを実行してください）"
    ok=0
  }
  [[ "$(repo_setting '.delete_branch_on_merge')" == "true" ]] || {
    log "NG: delete_branch_on_merge=false（setupを実行してください）"
    ok=0
  }
  [[ "$(repo_setting '.allow_squash_merge')" == "true" ]] || {
    log "NG: allow_squash_merge=false（setupを実行してください）"
    ok=0
  }

  if ruleset_has_required_checks || branch_protection_has_required_checks; then
    log "OK: Required Checks（quality(20) / quality(24) / compatibility）が保護設定済み"
  else
    log "NG: Ruleset / branch protection にRequired Checksが未設定（setupを実行してください）"
    ok=0
  fi

  if [[ "$ok" -eq 1 ]]; then
    log "OK: preflight PASS（$REPO / $BASE）"
  else
    die "preflight FAIL"
  fi
}

setup() {
  require_gh
  resolve_repo

  log "repo settingsを更新: auto-merge ON / delete-branch ON / squash既定"
  gh api --method PATCH "repos/$REPO" \
    -F allow_auto_merge=true \
    -F delete_branch_on_merge=true \
    -F allow_squash_merge=true \
    -F allow_merge_commit=false \
    -F allow_rebase_merge=false >/dev/null

  local protected_branches branch ruleset_name exists
  protected_branches="${GITHUB_PROTECTED_BRANCHES:-main webui}"
  for branch in $protected_branches; do
    ruleset_name="${branch}-protection"
    exists="$(gh api "repos/$REPO/rulesets" --jq "[.[] | select(.name==\"$ruleset_name\")] | length" 2>/dev/null || printf '0')"
    if [[ "$exists" == "0" ]]; then
      log "$branch Ruleset（$ruleset_name）を作成"
      gh api --method POST "repos/$REPO/rulesets" --input - >/dev/null <<JSON
{
  "name": "$ruleset_name",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": {
      "include": ["refs/heads/$branch"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "allowed_merge_methods": ["squash"],
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          {"context": "quality (20)"},
          {"context": "quality (24)"},
          {"context": "compatibility"}
        ],
        "strict_required_status_checks_policy": true
      }
    },
    {
      "type": "non_fast_forward"
    },
    {
      "type": "deletion"
    }
  ]
}
JSON
    else
      log "Ruleset $ruleset_name は既存（内容確認は gh api repos/$REPO/rulesets で実施）"
    fi
  done

  preflight
}

publish() {
  require_gh
  resolve_repo

  local slug="" title="" message="" body="" files="" all=0 update=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --slug) slug="${2:?}"; shift 2 ;;
      --title) title="${2:?}"; shift 2 ;;
      --message) message="${2:?}"; shift 2 ;;
      --body) body="${2:?}"; shift 2 ;;
      --files) files="${2:?}"; shift 2 ;;
      --all) all=1; shift ;;
      --update) update=1; shift ;;
      *) die "不明なオプション: $1" ;;
    esac
  done

  [[ -n "$slug" ]] || die "--slug が必要です"
  [[ -n "$title" ]] || die "--title が必要です"
  [[ -n "$message" ]] || die "--message が必要です"

  local branch="auto/$slug"
  cd -- "$ROOT_DIR"
  git fetch origin "$BASE" >/dev/null

  if git rev-parse --verify "$branch" >/dev/null 2>&1; then
    if [[ "$update" -eq 0 ]]; then
      die "branch $branch が既に存在します（--update で更新可能）"
    fi
    git switch "$branch" >/dev/null
    git merge --no-edit "origin/$BASE" >/dev/null
  else
    git switch -c "$branch" "origin/$BASE" >/dev/null
  fi

  if [[ -n "$files" ]]; then
    # shellcheck disable=SC2086
    git add -- $files
  elif [[ "$all" -eq 1 ]]; then
    git add -A
  else
    if git status --porcelain | grep -q .; then
      die "未指定の変更があります（--files でスコープ指定 or --all で明示）"
    fi
    die "コミット対象の変更がありません"
  fi

  git commit -m "$message" >/dev/null
  git push -u origin "$branch" >/dev/null
  log "push完了: $branch"

  local pr_url
  pr_url="$(gh pr view "$branch" --json url -q .url 2>/dev/null || true)"
  if [[ -z "$pr_url" ]]; then
    if [[ -z "$body" ]]; then
      body="変更内容:
- $title

テスト結果:
- CI（quality / compatibility）に依存

影響範囲:
- 本PRの変更スコープのみ

残課題:
- なし
"
    fi
    pr_url="$(gh pr create --base "$BASE" --head "$branch" --title "$title" --body "$body")"
    log "PR作成: $pr_url"
  else
    log "既存PRを使用: $pr_url"
  fi
  printf '%s\n' "$pr_url"
}

watch() {
  require_gh
  resolve_repo
  cd -- "$ROOT_DIR"

  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    pr="$(gh pr view --json number -q .number)"
  fi

  # 環境変数 GH_TOKEN/GITHUB_TOKEN（Claude Code plugin用などに発行された
  # fine-grained PAT）がPRのRequired Checks（statusCheckRollup）読み取り権限を
  # 持たないと、以降の判定が常に失敗扱いになり「CIチェックが開始されない」と
  # 誤検知する（2026-09-18実測）。gh keyring認証（gh auth loginの保存分）で
  # 読める場合のみそちらへフォールバックする。代替認証がなければ何もしない
  # （fail-open: 既存の挙動を変えない）。
  #
  # 注意: CI開始直後はまだcheck runがGitHub側に登録されておらず、
  # statusCheckRollupが空配列のままGraphQL自体はエラーなく成功することが
  # ある。そのためこの判定はループ開始前の一度きりではなく、ループ内で
  # 実際にエラーが起きた時点で行う（2026-09-18実測: 一度きりの事前判定では
  # タイミング次第でフォールバックが発動しないケースがあった）。
  local token_fallback_tried=0
  maybe_fallback_gh_token() {
    [[ "$token_fallback_tried" -eq 0 ]] || return 1
    [[ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]] || return 1
    token_fallback_tried=1
    if env -u GH_TOKEN -u GITHUB_TOKEN gh pr view "$pr" --json statusCheckRollup >/dev/null 2>&1; then
      log "GH_TOKEN/GITHUB_TOKENにChecks読み取り権限がないため、gh呼び出しから一時的に除外します"
      unset GH_TOKEN GITHUB_TOKEN
      return 0
    fi
    return 1
  }

  local seen=0 waited=0
  while [[ "$waited" -lt 120 ]]; do
    local check_count check_err
    if check_err="$(gh pr view "$pr" --json statusCheckRollup -q \
      '[.statusCheckRollup[]? | select(.status? != null)] | length' 2>&1)"; then
      check_count="$check_err"
    else
      check_count=0
      maybe_fallback_gh_token && continue
    fi
    if [[ "$check_count" != "0" ]]; then
      seen=1
      break
    fi
    sleep 5
    waited=$((waited + 5))
  done
  if [[ "$seen" -eq 0 ]]; then
    die "CIチェックが開始されません（120秒待機）"
  fi

  local tries=0
  while [[ "$tries" -lt "$MAX_CONFLICT_RETRY" ]]; do
    local mergeable
    mergeable="$(gh pr view "$pr" --json mergeable -q .mergeable)"
    if [[ "$mergeable" == "CONFLICTING" ]]; then
      log "merge conflictを検出。baseを取り込んで再検証（$((tries + 1))/$MAX_CONFLICT_RETRY）"
      git fetch origin "$BASE" >/dev/null
      git merge --no-edit "origin/$BASE" >/dev/null || die "conflict解消は手動介入が必要"
      git push >/dev/null
      tries=$((tries + 1))
      continue
    fi
    if gh pr checks "$pr" --watch --interval 10 --fail-fast --required; then
      log "Required Checks PASS"
      return 0
    fi
    die "CI失敗（修正後、--update でbranchを更新して再実行）"
  done
  die "conflictを$MAX_CONFLICT_RETRY回試行しても解消できません"
}

merge() {
  require_gh
  resolve_repo
  cd -- "$ROOT_DIR"

  local pr="${1:-}"
  if [[ -z "$pr" ]]; then
    pr="$(gh pr view --json number -q .number)"
  fi

  gh pr merge "$pr" --auto --squash --delete-branch >/dev/null
  log "Auto-Merge登録済み: PR #$pr"

  local state="OPEN" waited=0
  while [[ "$state" != "MERGED" && "$waited" -lt "$MERGE_TIMEOUT_SEC" ]]; do
    sleep 5
    waited=$((waited + 5))
    state="$(gh pr view "$pr" --json state -q .state)"
  done
  [[ "$state" == "MERGED" ]] || die "merge完了を${MERGE_TIMEOUT_SEC}秒以内に確認できません"

  local branch
  branch="$(gh pr view "$pr" --json headRefName -q .headRefName)"
  if git ls-remote --exit-code origin "refs/heads/$branch" >/dev/null 2>&1; then
    die "merge後もbranch $branch が残っています"
  fi
  log "Squash Merge完了・branch削除確認: $branch"
}

run() {
  preflight
  local pr_url
  pr_url="$(publish "$@")"
  local pr_number
  pr_number="$(printf '%s\n' "$pr_url" | sed -E 's#.*/pull/([0-9]+)$#\1#')"
  watch "$pr_number"
  merge "$pr_number"
}

status() {
  require_gh
  resolve_repo
  gh pr status 2>&1 | grep -v -i 'token' || true
  printf '\n'
  gh pr list --repo "$REPO" --state open --limit 10 || true
}

SUBCOMMAND="${1:-usage}"
shift || true

case "$SUBCOMMAND" in
  setup) setup ;;
  preflight) preflight ;;
  publish) publish "$@" ;;
  watch) watch "${1:-}" ;;
  merge) merge "${1:-}" ;;
  run) run "$@" ;;
  status) status ;;
  help|-h|--help) usage ;;
  *) usage >&2; exit 64 ;;
esac
