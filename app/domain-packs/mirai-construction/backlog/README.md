# P2 / P3 Agent 候補カタログ（実行不能）

このディレクトリの `p2-p3-catalog.yaml` は、将来の拡張候補（A03〜A11）を
責任者ロール・必要資料・評価条件・禁止事項・外部接続の未確認事項とともに列挙した
**実行不能なカタログ**である。

- `agents/` 配下には置いていないため、`sync-agent-registry.mjs` で承認済み版として
  登録されることはない（`skill-loader.js` の `loadAgentDefinition` は `agents/` 配下しか読まない）
- 存在しない Tool・API・専門システム接続を「成功する Stub」で埋めていない
- 各候補を有効化する手順は次のとおり
  1. 責任者ロールによる評価条件の確定と、必要資料の利用許諾
  2. 外部接続がある場合は API 仕様・認証・契約の確認（読み取り専用 Adapter から開始）
  3. `agents/<agent_id>.yaml` として正式定義を追加し、必要な Skill を `skills/` 配下へ追加
  4. 単体・否定系・E2E テストを追加し、`sync-agent-registry.mjs` で Administrator が承認

エネルギー領域（A07）は「設備の建設支援」に限定し、発電制御・電力取引へ拡大しない。
MC 系システム（A10）への連携は、仕様と権限を確認した読み取り専用 Adapter からのみ開始する。

設計参考: `docs/Mirai-Agent-Skill-Architecture.md` §6・§9、`docs/decisions/ADR-001-agent-skill-runtime.md`
