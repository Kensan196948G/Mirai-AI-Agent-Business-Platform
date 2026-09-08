# 🚀 みらい AIエージェント事業推進基盤（Mirai AI Agent Business Platform）

> 全社員のアイデアを「壁打ち → 企画 → 承認 → 開発 → 本番 → 効果測定 → ナレッジ循環」で回す、**AIエージェント型の事業本部基盤**。
> 自前アプリの新規開発は行わず、既存SaaS（Lightblue / Slack / Notion / AppSuite / desknet's NEO / GitHub）の設定・連携で構築する。

![Status](https://img.shields.io/badge/Status-Review%20%2F%20Planning-yellow)
![Visibility](https://img.shields.io/badge/Repo-Private-lightgrey)
![Docs](https://img.shields.io/badge/Docs-Idea%20to%20Value-blue)
![Custom App](https://img.shields.io/badge/Custom%20App-Not%20Planned%20(SaaS%20Config%20Only)-informational)
[![docs-quality](https://github.com/Kensan196948G/Mirai-AI-Agent-Business-Platform/actions/workflows/docs-quality.yml/badge.svg)](https://github.com/Kensan196948G/Mirai-AI-Agent-Business-Platform/actions/workflows/docs-quality.yml)
[![app-ci](https://github.com/Kensan196948G/Mirai-AI-Agent-Business-Platform/actions/workflows/app-ci.yml/badge.svg)](https://github.com/Kensan196948G/Mirai-AI-Agent-Business-Platform/actions/workflows/app-ci.yml)

---

## 🍰 3行でわかる、このリポジトリ

> 🙋 **社員**：「この作業、AIに手伝ってほしいな…」
> 🤖 **AI（Lightblue）**：「話を聞いて整理しますね。人にも確認してもらいます」
> 👨‍💼 **人間の承認者**：「内容を見ました。OK、進めていいですよ」

1. 😊 **社員がAIに「こんな作業が大変」と話すだけ**でスタートする（難しい書式は不要）
2. 🤖 **AIは「話を聞いて整理する係」**。実際に開発したり本番にリリースしたりする権限は持たない
3. ✅ **最後に必ず人間が「OK」を押す**（Gateと呼ぶ関所を5回通る）まで、何も本番には反映されない

つまりこのリポジトリは、**「AIが手伝う、けれど決めるのは人間」というルールブック（企画書・手順書）の置き場**。
自分たちで新しいアプリを1から作るのではなく、**すでに契約しているSaaS（Slack・Notion・AppSuiteなど）の使い方・つなぎ方を決めて文書化**している。

<details>
<summary>🧸 もっとやさしく：レストランに例えると</summary>

- 🙋 お客さん（社員）が「こういう料理が食べたい」と伝える＝**Lightblueに相談**
- 📝 ウェイター（AI）がオーダーを整理してメモする＝**Slack Canvasで壁打ち**
- 📓 厨房の「確定レシピ帳」に転記する＝**Notionへナレッジ化**
- 🗂️ 注文台帳に記録する＝**AppSuiteで案件管理**
- ✅ 店長が「作っていいよ」と最終OKを出す＝**desknet's NEO Workflowで承認**
- 👨‍🍳 実際に調理するのはコック（開発チーム／GitHub）
- 📊 出来上がった料理の評判を見て、次のレシピ改善に活かす＝**監視・効果測定・ナレッジ循環**

AIは「オーダーを聞いて整理するウェイター」であって、**店長（人間）の許可なしに厨房を勝手に動かすことはない**、というのがこの仕組みの一番大事なポイント。

</details>

---

## 📚 目次

1. [🎯 このリポジトリは何か](#-このリポジトリは何か)
2. [🏛️ 全体アーキテクチャ](#️-全体アーキテクチャ)
3. [🔁 Knowledge Feedback Loop](#-knowledge-feedback-loop)
4. [🚦 5 Stage Gate（進捗承認ゲート）](#-5-stage-gate進捗承認ゲート)
5. [🧭 20フェーズのAI/DX開発プロセス](#-20フェーズのaidx開発プロセス)
6. [⚖️ 3つのAuthority と SOD](#️-3つのauthority-と-sod)
7. [🧩 各ツールの役割](#-各ツールの役割)
8. [🌐 インフラ構成（Phase別拡張）](#-インフラ構成phase別拡張)
9. [🗂️ リポジトリ構成](#️-リポジトリ構成)
9.5. [🧩 Mirai AgentOS MVP](#-mirai-agentos-mvp)
10. [📖 ドキュメント間の関係（正本マップ）](#-ドキュメント間の関係正本マップ)
11. [✅ 現在のステータス（Q1〜Q7 / P-1〜P-12）](#-現在のステータスq1q7--p-1p-12)
12. [🛠️ 文書の更新方法とCI](#️-文書の更新方法とci)
13. [🙅 絶対に守るルール（SOD）](#-絶対に守るルールsod)

---

## 🎯 このリポジトリは何か

> 😊 **かんたんに言うと**：ここに書いてあるのは「何を・誰が・どの順番で・どのツールで進めるか」のルールブック。プログラムのコードはほとんど無く、9割方が「決め事」を書いた文書。

| 項目 | 内容 |
|---|---|
| 🎯 目的 | 全社員の「困りごと」をAIとの壁打ちから事業・業務・システムへ変換する仕組みを、**人が必ず承認する（Human-in-the-Loop）**設計で構築する |
| 🧱 開発方針（原則） | **自前アプリの新規開発なし**。既存契約済みSaaS（AppSuite / desknet's NEO / Notion / Lightblue / Slack）への設定・テンプレート投入で構築する |
| ⚠️ 例外（2026-09-08〜） | `app/` に **Mirai AgentOS MVP** を実装中（下記「🧩 Mirai AgentOS MVP」参照）。ユーザーの明示指示による原則の一時的な例外であり、恒久方針の変更ではない |
| 🔭 将来コード開発対象 | 監視基盤（自前Web構築予定、本計画スコープ外・Phase 2・要件未定義。下記「現在のステータス」章のP-6参照）／Mirai AgentOS（上記例外） |
| 📁 このリポジトリの中身 | 企画書・プロセス定義・SaaS構築計画書・各ツール設定手順書（すべて`docs/`配下） |
| 🏢 正本管理 | GitHub（本リポジトリ）をドキュメントの正本とする |

---

## 🏛️ 全体アーキテクチャ

> 😊 **かんたんに言うと**：7つの道具箱（ツール）にはそれぞれ決まった仕事がある。「雑談用の道具（Slack）で正式な承認をしない」「台帳用の道具（AppSuite）でおしゃべりしない」——道具を混ぜて使わないのがコツ。

各ツールは役割が明確に分離されており、**Slackを稟議システム化せず、AppSuiteをチャット化しない**のが設計の肝。

```mermaid
flowchart TB
    subgraph AI["🤖 AI Agent Layer"]
        LB["🤖 Lightblue<br/>全社員向けAI窓口"]
        CL["🧠 Claude / Claude Code<br/>要件・設計・実装支援"]
    end

    subgraph COLLAB["💬 Collaboration"]
        SL["💬 Slack / Slack Canvas<br/>日常議論・検討中ドラフト"]
    end

    subgraph KNOW["📓 Knowledge / Context"]
        NO["📓 Notion<br/>人間レビュー済みの確定知識"]
    end

    subgraph PROC["🗂️ Process / Transaction"]
        AS["🗂️ AppSuite<br/>案件台帳・Phase・Gate・KPI・ROI"]
    end

    subgraph GOV["✅ Governance"]
        NEO["✅ desknet's NEO Workflow<br/>正式承認・差戻し・履歴（Gate正本）"]
    end

    subgraph ENG["🐙 Engineering SoR"]
        GH["🐙 GitHub<br/>Repo・Issue・PR・Test・Release・CI/CD"]
    end

    subgraph OBS["📊 Observability"]
        MON["📊 監視基盤<br/>稼働・ログ・障害・AI利用量・コスト<br/>(別途選定・自前Web構築予定)"]
    end

    LB -->|壁打ち・整理| SL
    SL -->|人間レビュー| NO
    NO -->|価値判断| AS
    AS -->|申請| NEO
    NEO -->|承認結果| AS
    NO -->|要件・設計| CL
    CL -->|実装支援| GH
    GH -->|Release| PRODENV["🏭 Production"]
    PRODENV -->|稼働監視| MON
    MON -->|KPI/ROI| AS
    AS -->|Lessons Learned| NO
    NO -->|次回の文脈| LB

    style LB fill:#fef3c7,stroke:#d97706
    style CL fill:#ede9fe,stroke:#7c3aed
    style SL fill:#dbeafe,stroke:#2563eb
    style NO fill:#dcfce7,stroke:#16a34a
    style AS fill:#fee2e2,stroke:#dc2626
    style NEO fill:#fef9c3,stroke:#ca8a04
    style GH fill:#e5e7eb,stroke:#374151
    style MON fill:#f3e8ff,stroke:#9333ea
```

> 💡 **各情報の正本**：AIとの相談＝Lightblue／検討中ドラフト＝Slack Canvas／確定知識＝Notion／案件・Phase・Gate＝AppSuite／承認＝desknet's NEO Workflow／ソースコード・Issue・PR＝GitHub／稼働監視＝監視基盤（別途選定）。

---

## 🔁 Knowledge Feedback Loop

> 😊 **かんたんに言うと**：AIとの会話をそのまま「記憶」にはしない。必ず人がチェックしてから「確定の知識ノート（Notion）」に清書する、というワンクッションを置く。

「会話をそのまま覚えさせる」のではなく、**会話 → AI整理 → 人間レビュー → Notionへ確定知識化**する循環を回す。

```mermaid
flowchart LR
    A["👥 全社員"] --> B["🤖 Lightblue<br/>AI壁打ち"]
    B --> C["💬 Slack Canvas"]
    C --> D["📓 Notion<br/>Idea / 確定Knowledge"]
    D --> E["👔 AXWG<br/>→ 3 Authority"]
    E --> F["🗂️ AppSuite<br/>正式案件・Portfolio台帳"]
    F --> G["✅ desknet's NEO Workflow<br/>Gate審査・承認"]
    G --> H["📓 Notion<br/>要件・意思決定"]
    H --> I["🧠 Claude / Claude Code"]
    I --> J["🐙 GitHub<br/>開発・テスト・Release"]
    J --> K["🧪 MVP / Staging (UAT)"]
    K --> L["🏭 Gate 5 → Production RC → Production Deploy"]
    L --> M["📊 監視基盤 (DevSecOps)"]
    M --> N["📈 AppSuite / BI<br/>KPI・ROI"]
    N --> O["📓 Notion<br/>Lessons Learned"]
    O -.->|次回相談の文脈| B

    style A fill:#f9fafb,stroke:#6b7280
    style D fill:#dcfce7,stroke:#16a34a
    style H fill:#dcfce7,stroke:#16a34a
    style O fill:#dcfce7,stroke:#16a34a
    style G fill:#fef9c3,stroke:#ca8a04
    style F fill:#fee2e2,stroke:#dc2626
    style N fill:#fee2e2,stroke:#dc2626
    style J fill:#e5e7eb,stroke:#374151
```

---

## 🚦 5 Stage Gate（進捗承認ゲート）

> 😊 **かんたんに言うと**：企画から本番リリースまでの間に、**5つの「関所（Gate）」**がある。関所の門番（承認者）がハンコを押さない限り、次の段階には絶対に進めない。

**「Slackで承認したから開発開始」は禁止。** 必ず `Slack（検討）→ AppSuite（正式申請）→ desknet's NEO Workflow（正式承認）→ GitHub（開発開始）` の順で進める。

```mermaid
flowchart LR
    Idea(["💡 Idea<br/>AI壁打ち・検討Canvas"]) --> Planning
    Planning(["📝 Planning<br/>企画書・As-Is/To-Be"]) --> G1{{"🚪 Gate 1<br/>企画承認"}}
    G1 --> Definition(["📐 Definition<br/>要件定義・リスク評価"])
    Definition --> G2{{"🚪 Gate 2<br/>開発承認"}}
    G2 --> MVP(["🛠️ MVP<br/>開発・検証"])
    MVP --> G3{{"🚪 Gate 3<br/>MVP承認"}}
    G3 --> Staging(["🧪 Staging<br/>結合試験・UAT"])
    Staging --> G4{{"🚪 Gate 4<br/>本番移行承認"}}
    G4 --> RC(["🏷️ Production RC<br/>承認済みタグ"])
    RC --> G5{{"🚪 Gate 5<br/>Release承認"}}
    G5 --> Prod(["🏭 Production<br/>本番Deploy"])
    Prod --> Ops(["🔄 Operation<br/>DevSecOps・効果測定"])
    Ops -.->|継続/改善/停止判定| Idea

    style G1 fill:#fef9c3,stroke:#ca8a04
    style G2 fill:#fef9c3,stroke:#ca8a04
    style G3 fill:#fef9c3,stroke:#ca8a04
    style G4 fill:#fef9c3,stroke:#ca8a04
    style G5 fill:#fef9c3,stroke:#ca8a04
    style Prod fill:#fee2e2,stroke:#dc2626
```

| Gate | Phase | 承認の主な関与者 |
|---|---|---|
| **Gate 1** 🚪 企画承認 | Planning | 💼 経営企画（主）＋🏗️ ドメイン＋⚙️ IT/DX |
| **Gate 2** 🚪 開発承認 | Definition | 🏗️ ドメイン＋⚙️ IT/DX（技術仕様はドメイン承認） |
| **Gate 3** 🚪 MVP承認 | MVP | 🏗️ ドメイン＋⚙️ IT/DX（経営企画は最終承認） |
| **Gate 4** 🚪 本番移行承認 | Staging | 🏗️ ドメイン（UAT受入）＋💼 経営企画（移行判定） |
| **Gate 5** 🚪 Release承認 | Production RC | 👑 上位Gate Owner（DX統括）＋⚙️ IT/DX |

> ⚠️ **本番環境では開発しない。** MVP/DEV → Staging → Production RC → Release承認 → Production Deploy の順で進め、承認済みRelease TagのみをDeployする。

---

## 🧭 20フェーズのAI/DX開発プロセス

> 😊 **かんたんに言うと**：「思いつき」から「実際に使われて改善され続ける仕組み」になるまでの、**20個の駅（フェーズ）**がある双六（すごろく）。ゴール（20番）に着いたら、またスタート（1番）に戻ってループする。

```mermaid
flowchart TD
    P1["01 全社員からアイデア受付<br/>💡 Idea / 🤖 Lightblue"] --> P2["02 課題明確化<br/>🤖+📓"]
    P2 --> P3["03 アイデア構造化<br/>💬 Slack Canvas / 📓 Notion"]
    P3 --> P4["04 企画候補登録<br/>📓 → 🗂️ AppSuite"]
    P4 --> P5["05 案件ID発番<br/>🗂️ DX-YYYY-NNNN"]
    P5 --> P6["06 企画検討<br/>💬+🧠+📓"]
    P6 --> P7["07 企画審査 Gate1<br/>📓+✅+🗂️"]
    P7 --> P8["08 要件定義<br/>🧠+💬+📓"]
    P8 --> P9["09 要件承認 Gate2<br/>📓+🗂️/✅"]
    P9 --> P10["10 開発案件化<br/>🐙+📓"]
    P10 --> P11["11 MVP開発<br/>🧠+🐙+📓"]
    P11 --> P12["12 テスト<br/>🐙 CI/CD+📓"]
    P12 --> P13["13 MVP評価 Gate3<br/>💬+🗂️+📓"]
    P13 --> P14["14 Staging<br/>🐙+CI/CD+📓"]
    P14 --> P15["15 業務受入試験(UAT) Gate4<br/>🗂️+📓"]
    P15 --> P16["16 本番承認 Gate5<br/>✅+🗂️+📓"]
    P16 --> P17["17 Production Deploy<br/>🐙 CI/CD+🗂️+📓"]
    P17 --> P18["18 DevSecOps<br/>📊+💬+🐙+📓"]
    P18 --> P19["19 効果測定<br/>🗂️+📈+📓"]
    P19 --> P20["20 ナレッジ化・継続判断<br/>📓+🤖 RAG"]
    P20 -.->|次のアイデアへ循環| P1
```

<details>
<summary>📋 各フェーズの詳細を見る（クリックで展開）</summary>

| # | フェーズ | Stage | 主担当 |
|---|---|---|---|
| 01 | 全社員からアイデア受付 | Idea | 🤖 Lightblue |
| 02 | 課題明確化 | Idea | 🤖 Lightblue + 📓 Notion |
| 03 | アイデア構造化 | Idea | 🤖 → 💬 Slack Canvas / 📓 Notion |
| 04 | 企画候補登録 | Planning | 📓 → 🗂️ AppSuite |
| 05 | 案件ID発番（例：`DX-2026-0042`） | Planning | 🗂️ AppSuite |
| 06 | 企画検討（決定/未決/次アクション整理） | Planning | 💬 + 🧠 Claude + 📓 |
| 07 | 企画審査（**Gate 1**） | Gate 1 | 📓 + ✅ Workflow + 🗂️ AppSuite |
| 08 | 要件定義（業務要件・非機能要件） | Definition | 🧠 Claude + 💬 + 📓 |
| 09 | 要件承認（**Gate 2**） | Gate 2 | 📓 + 🗂️/✅ |
| 10 | 開発案件化（Repository/Project/Issue発行） | MVP/DEV | 🐙 GitHub + 📓 |
| 11 | MVP開発 | MVP/DEV | 🧠 Claude Code + 🐙 + 📓 |
| 12 | テスト（Lint/Unit/脆弱性/Secret Scan） | MVP/DEV | 🐙 CI/CD + 📓 |
| 13 | MVP評価（**Gate 3**、KPI測定） | Gate 3 | 💬 + 🗂️ + 📓 |
| 14 | Staging（マスキング済みテストデータ） | Staging | 🐙 CI/CD + 📓 |
| 15 | 業務受入試験 UAT（**Gate 4**） | Gate 4 | 🗂️ + 📓 |
| 16 | 本番承認（**Gate 5**、Release Candidate確定） | Gate 5 | ✅ + 🗂️ + 📓 |
| 17 | Production Deploy（承認済みRelease Tagのみ） | Production | 🐙 CI/CD + 🗂️ + 📓 |
| 18 | DevSecOps（監視 → Slack通知 → GitHub Issue） | Operation | 📊 + 💬 + 🐙 + 📓 |
| 19 | 効果測定（KPI/ROI、Why it happened） | Operation | 🗂️ + 📈 BI + 📓 |
| 20 | ナレッジ化・継続判断（継続/改善/停止） | Knowledge | 📓 + 🤖 Lightblue RAG |

</details>

---

## ⚖️ 3つのAuthority と SOD

> 😊 **かんたんに言うと**：「お金を決める人」「現場に合うか決める人」「作れるか決める人」の3人が別々にいて、**1人だけの判断で物事が進まない**ようにしている（三権分立に似ている）。AIはこの3人の誰にもなれない＝AIは承認できない。

**AIは承認できない。承認は必ず人間が行う。** 企画・承認・開発・運用の権限を分離することでガバナンスを維持する。

```mermaid
flowchart TB
    OWNER["👑 上位Gate Owner<br/>AI/DX統括責任者<br/>（高額案件・全社システム・Gate5最終承認）"]
    OWNER --> BIZ["💼 Business Authority<br/>経営企画<br/>事業価値・ROI・KPI・投資継続判断"]
    OWNER --> DOM["🏗️ Domain Authority<br/>建設土木技術<br/>業務妥当性・技術受入・UAT判定"]
    OWNER --> ENGA["⚙️ Engineering Authority<br/>IT・DX<br/>システム/AI設計・セキュリティ・デプロイ実行"]

    BIZ -.->|単独決定不可| TECH["❌ 技術仕様"]
    DOM -.->|単独決定不可| SYS["❌ システム構成・本番Deploy"]
    ENGA -.->|単独決定不可| SELF["❌ 自分が開発したシステムの単独本番承認"]

    style OWNER fill:#fef3c7,stroke:#d97706,stroke-width:2px
    style BIZ fill:#dbeafe,stroke:#2563eb
    style DOM fill:#dcfce7,stroke:#16a34a
    style ENGA fill:#fee2e2,stroke:#dc2626
```

### RACI（抜粋）

| 行為 | 💼 経営企画 | 🏗️ ドメイン | ⚙️ IT/DX |
|---|:---:|:---:|:---:|
| 事業価値評価 | **A** | C | C |
| 技術妥当性 | C | **A** | C |
| システム実現性 | C | C | **A** |
| 要件定義 | A | **R** | **R** |
| セキュリティ評価 | C | C | **R** |
| コーディング | ― | C | **R** |
| コードレビュー | ― | C（必要時） | R（**別のIT担当**） |
| UAT | C | **R** | C（支援） |
| Production Deploy | ― | ― | **R** |
| 継続 / 停止判断 | **A** | C | C |

`R`=実行　`A`=最終責任・承認　`C`=助言・参画

---

## 🧩 各ツールの役割

> 😊 **かんたんに言うと**：8つの道具箱それぞれの「専門分野」の一覧表。迷ったら「これは誰の仕事？」をこの表で確認する。

| アイコン | ツール | レイヤ | 役割 | 状態 |
|:---:|---|---|---|:---:|
| 🤖 | **Lightblue** | AI Agent Layer | 全社員向けAI窓口。壁打ち・要約・分類・企画化支援・Notionナレッジ検索 | 契約済み（機能範囲は方針決定・確認中） |
| 💬 | **Slack / Slack Canvas** | Collaboration | 日常会話・検討中ドキュメント（共同編集）。**議論参加は3名のみ** | 決定済み |
| 📓 | **Notion** | Knowledge / Context | 人間レビュー済みの確定知識（Idea/決定事項/要件/教訓）を保存 | 導入決定 |
| 🗂️ | **AppSuite** | Process / Transaction | 案件ID・Phase・Gate・責任者・KPI・ROIのAI事業ポートフォリオ台帳 | 構築済み・機能確認済み |
| ✅ | **desknet's NEO Workflow** | Governance | 正式申請・段階的承認・差戻し・審査履歴（**Gate承認の正本**） | 決定済み |
| 🧠 | **Claude / Claude Code** | Expert AI | 高度分析・要件定義・設計・レビュー・実装/テスト支援 | 利用中 |
| 🐙 | **GitHub** | Engineering SoR | Repository・Issue・PR・Test・Release・CI/CD（Webhookは必要時のみ） | 本リポジトリで運用開始 |
| 📊 | **監視基盤** | Observability | 稼働・ログ・障害・AI利用量・コストの継続監視（**ツールは別途選定・自前Web構築予定**） | ⏳ 未着手（下記P-6参照） |

> 🔮 **将来拡張**：AIを1体の万能Botにせず、`AI Orchestrator`配下に専門エージェント（Idea Agent / Planning Agent / Business Analysis Agent / Requirement Agent / Architecture Agent / Security Agent / Coding Agent / QA Agent / Release Agent / Knowledge Agent）を配置する構想。ユーザーからは単一のAI窓口に見える構成。

---

## 🌐 インフラ構成（Phase別拡張）

> 😊 **かんたんに言うと**：将来「見張り番（監視基盤）」を自前で作る時のために、**先に土地（ネットワークの区画）だけ確保してある**状態。建物（実際のシステム）はまだ建てていない。

自前Web監視基盤等の将来コンポーネント用に、VLANアドレス空間が段階的に設計されている（`docs/AIDX開発基盤インフラ・ネットワーク構成設計書.html`）。

```mermaid
flowchart LR
    subgraph Phase1["🟢 Phase 1（開発・検証開始）"]
        MGMT["MGMT VLAN110<br/>管理・監視・Log"]
        AIDEV["AI-DEV VLAN120<br/>Coding Agent/RAG/Vector DB"]
    end
    subgraph Phase2["🟡 Phase 2（本番運用開始・要件未定義）"]
        STG["STAGING VLAN140"]
        PROD["PRODUCTION VLAN150"]
        MON["MONITOR VLAN160<br/>📊 監視基盤"]
        BAK["BACKUP VLAN180"]
    end
    subgraph Phase3["🟠 Phase 3（必要時のみ追加）"]
        INT["INTEGRATION VLAN170<br/>API/Webhook受信"]
    end
    subgraph Phase4["🔵 Phase 4（拡張）"]
        SSO["SSO/MFA/Conditional Access"]
    end

    Phase1 --> Phase2 --> Phase3 --> Phase4

    style MON fill:#f3e8ff,stroke:#9333ea,stroke-width:2px
```

> ⚠️ この設計書は**VLANアドレス空間の予約（設計）のみ承認済み**。MONITOR（監視基盤）の実際の構築着手は、`ai-dx-dev-saas-setup-guide.md` **P-6**（誰が・いつ作るか）の決定が起票条件。

---

## 🧩 Mirai AgentOS MVP

> 😊 **かんたんに言うと**：ここだけは例外的に「実際に動くアプリ」を作っている。社内ダッシュボードのようなもので、ログインすると11個の画面（相談・案件・タスク・承認など）が使える。

⚠️ **本節は「🎯 このリポジトリは何か」の開発方針（自前アプリ開発なし）に対する、
2026-09-08 のユーザー明示指示に基づく例外である。** 恒久方針としての変更ではない。

`doc/`（要件定義書・技術設計概要）が定義する Agentic Operating System「Mirai AgentOS」のうち、
**ログイン後の全11画面**（ダッシュボード / AI相談 / 案件 / タスク・実行 / 承認 / Knowledge /
監査ログ / 外部連携 / 監視 / エージェント設定 / ユーザー・ロール）を実 PostgreSQL・実セッション認証で
動かす本格実装を `app/` に構築した（2026-09-08）。実 AI エージェント実行・外部API自動連携は
本スコープ外（`doc/` 参照。詳細は [`app/README.md`](app/README.md)）。

| 項目 | 状態 |
|---|:---:|
| 主要 User Journey（登録→昇格→9状態ワークフロー遷移） | ✅ 実装・E2Eテスト済み |
| Local PostgreSQL（本番/MVP/テスト DB 分離） | ✅ |
| 認証（email+password、セッション即時失効、ログアウト導線） | ✅ |
| CI（`app-ci.yml`、マイグレーション冪等性・脆弱性監査・E2E） | ✅ |
| systemd（本番/MVP、ループバック限定） | ✅ 導入・起動済み |
| Cloudflare（`mirai-agent-os` / `mirai-agent-os-mvp` サブドメイン公開） | ✅ 実施済み（Tunnel・DNS・Cloudflare Access で管理者アカウントのみに制限） |
| WebUI（ログイン後の11画面） | ✅ Claude Design 正本を移植し**全画面を実 PostgreSQL データへ接続**（Tasks/Knowledge/Approvals多段階/監査Hash Chain含む） |
| Notion / Slack / Gmail / GitHub 連携、Model Router実行 | ⏳ 未実装（Integrations/Routerは設定管理のみ。`doc/` 参照） |
| 業務Agent Runtime（技術選定支援等、P0/P1） | 🟡 API限定で実装（検索・比較・草案作成まで。WebUI未実装）。詳細は [`app/README.md`](app/README.md) と [`docs/decisions/ADR-001-agent-skill-runtime.md`](docs/decisions/ADR-001-agent-skill-runtime.md) |

セットアップ・API・既知の制約は **[`app/README.md`](app/README.md)** を参照。

---

## 🗂️ リポジトリ構成

> 😊 **かんたんに言うと**：本棚の中身一覧。⭐マークの付いた本が「実際の作業で見るべき最新版」、それ以外は概要や補足資料。

```text
Mirai-AI-Agent-Business-Platform/
├── 📄 README.md                                          ← このファイル
├── 🤝 CONTRIBUTING.md                                     ← 文書の更新手順・検査ルール・SOD
├── 📦 package.json                                        ← 検証コマンド定義（外部依存ゼロ）
├── 🙈 .gitignore
├── 📁 .github/
│   ├── ⚙️ workflows/docs-quality.yml                      ← CI（文書整合性・秘密情報検査）
│   ├── 📋 pull_request_template.md
│   └── 📋 ISSUE_TEMPLATE/                                 ← 決定事項（Q/P）・文書修正の起票様式
├── 📁 tools/
│   ├── 🔍 check-docs.mjs                                  ← 文書整合性チェッカ（DOC001〜DOC006）
│   └── 🧪 check-docs.test.mjs                             ← 上記のユニットテスト
├── 📁 app/                                                ← 🧩 Mirai AgentOS MVP 実装（開発方針の例外。詳細は app/README.md）
├── 📁 systemd/                                            ← mira-agent-os の systemd unit（本番/MVP）
├── 📁 doc/                                                ← 🧩 Mirai AgentOS 要件定義書・設計仕様書（app/ の正本仕様）
├── 📁 webui/                                              ← 🧩 Mirai AgentOS WebUI 初期モックアップ（Claude Design、実DBなし）
└── 📁 docs/
    ├── 📘 ai-dx-dev-process.md / .html                    ← 🏛️ プロセス定義（確定版・正本）
    ├── 📗 ai-dx-dev-saas-setup-guide.md / .html            ← 🏗️ SaaS構築・設定計画書（レビュー版v0.5）
    ├── 📙 ai-dx-dev-build-guide.html                       ← 🔧 Phase 01〜20 構築内容（Draft版）
    ├── 🌐 AIDX開発基盤インフラ・ネットワーク構成設計書.html   ← 🖧 VLAN/ネットワーク設計（承認版）
    ├── 📊 ワーキング発足に関する企画書.pptx                  ← 🚀 発足企画書
    └── 📁 ツール利用・設定マニュアル/
        ├── 🗂️ AppSuite.html                                        （ELI5概要版）
        ├── 🗂️ AppSuite 設定手順書 公式マニュアル追記版.html          ⭐ 作業時はこちらが正
        ├── ✅ NEO-Workflow.html                                    （ELI5概要版）
        ├── ✅ desknet's NEO ワークフロー 設定手順書 公式マニュアル追記版.html ⭐
        ├── 📓 Notion.html                                          （ELI5概要版）
        ├── 📓 Notion 設定手順書公式マニュアル追記版.html             ⭐
        ├── 🤖 Lightblue.html                                       （ELI5概要版）
        ├── 🤖 Lightblue 設定手順書公式マニュアル追記版.html          ⭐
        ├── 💬 Slack.html                                           （ELI5概要版）
        ├── 💬 Slack 設定手順書公式マニュアル追記版.html              ⭐
        ├── 🔄 CSV・ファイル取込設定手順書公式マニュアル統合版.html   ← 複数ツール横断のCSV/マスタ投入手順
        └── 🔄 ai-dx-dev-csv-import-guide.md / .html
```

---

## 📖 ドキュメント間の関係（正本マップ）

> 😊 **かんたんに言うと**：文書にも「親子関係」がある。一番上の「全体プロセス定義」が方針を決め、それを具体的な作業手順に分解したのが下の文書たち。矛盾が見つかったら、基本的には上流（親）の文書を正とする。

```mermaid
flowchart TD
    PROC["📘 ai-dx-dev-process.md<br/>全体プロセス定義（確定版）"]
    SETUP["📗 ai-dx-dev-saas-setup-guide.md<br/>SaaS構築計画（レビュー版v0.5）"]
    BUILD["📙 ai-dx-dev-build-guide.html<br/>Phase別構築内容（Draft）"]
    INFRA["🌐 インフラ・ネットワーク構成設計書<br/>（承認版＝VLAN予約のみ）"]
    MANUAL["🗂️✅📓🤖💬 各ツール設定手順書<br/>（公式マニュアル追記版が正）"]
    CSV["🔄 CSV・ファイル取込統合版"]

    PROC -->|Phase定義を実装項目へ分解| SETUP
    SETUP -->|Phase構築内容の詳細分解| BUILD
    SETUP -->|各ツール設定の詳細手順| MANUAL
    SETUP -->|複数ツール横断のCSV投入手順| CSV
    SETUP -.->|"監視基盤VLAN予約（P-6）"| INFRA

    style PROC fill:#dbeafe,stroke:#2563eb,stroke-width:2px
    style SETUP fill:#dcfce7,stroke:#16a34a,stroke-width:2px
```

| 文書 | ステータス | 役割 |
|---|:---:|---|
| `ai-dx-dev-process.md`（+`.html`） | ✅ 確定版 | 全体プロセス定義。20フェーズ・5 Gate・3 Authority・SODの正本 |
| `ai-dx-dev-saas-setup-guide.md`（+`.html`） | 🟡 レビュー版v0.5 | 上記を既存SaaS上での構築・設定計画へ分解。P-1〜P-12が意思決定待ち |
| `ai-dx-dev-build-guide.html` | 🟠 Draft | Phase 01〜20ごとの構築内容・完了条件 |
| インフラ・ネットワーク構成設計書 | ✅ 承認版（VLAN設計のみ） | 監視基盤等の将来コンポーネント用ネットワーク受け皿 |
| 各ツール「公式マニュアル追記版」 | ⭐ 最新 | 実際の画面操作・公式マニュアル引用を含む実務手順（無印版は概要ELI5） |

---

## ✅ 現在のステータス（Q1〜Q7 / P-1〜P-12）

> 😊 **かんたんに言うと**：✅は「もう決まった」、🟡は「だいたい決まったけど最終確認中」、⏳は「まだ誰も決めていない宿題」を表す。⏳の項目は文書を直すだけでは解決せず、実際に人（3 Authority）が集まって決める必要がある。

### Q1〜Q7（基本方針）

| Q | 論点 | 状態 |
|---|---|:---:|
| Q1 | Knowledge基盤 → Notion導入 | ✅ 決定済み |
| Q2 | Collaboration → 通知はNEO、Slack議論は3名のみ | ✅ 決定済み |
| Q3 | 承認の実行場所 → desknet's NEO Workflow | ✅ 決定済み |
| Q4 | GitHub・Webhook → 必要な時のみ利用 | ✅ 決定済み |
| Q5 | 認証 → 当面パスワード、将来SSO | ✅ 決定済み（当面運用） |
| Q6 | Lightblueの機能範囲 | 🟡 方針決定済み・ベンダー確認は未実施 |
| Q7 | 監視ツール → 自前Web構築予定 | ✅ 決定済み（別途計画・下表P-6参照） |

### P-1〜P-12（追加決定ポイント）

| # | 論点 | 状態 |
|---|---|:---:|
| P-1 | Gate 5最終承認者（上位Gate Owner） | ⏳ 未決 |
| P-2 | パイロット案件の選定・KPI | ⏳ 未決 |
| P-3 | NEO ⇄ AppSuiteの反映方法（手動/自動） | ⏳ 未決 |
| P-4 | 「提案者」の範囲 | ⏳ 未決 |
| P-5 | AI利用ルール・情報管理方針 | ⏳ 未決 |
| P-6 | 📊 監視基盤の計画（誰が・いつ） | ⏳ 未決（ネットワーク受け皿は設計済み） |
| P-7 | 将来のSSO導入時期・対象 | ⏳ 未決 |
| P-8 | 3名の兼任ルール | ⏳ 未決（企画書pptxに暫定案あり・要突合） |
| P-9 | パイロット案件のAI入力可否（個人情報/位置情報） | ⏳ 未決 |
| P-10 | 監視基盤の監視項目・通知先 | ⏳ 未決 |
| P-11 | 3名のアカウント・権限レベル | ⏳ 未決 |
| P-12 | 文書・設定のバックアップと引継ぎ | ⏳ 未決 |

> 📌 詳細は `docs/ai-dx-dev-saas-setup-guide.md` 第7章を参照。P-1〜P-12は💼🏗️⚙️ 3 Authorityによるレビュー・決定が必要な事項であり、本リポジトリのドキュメント整備だけでは解決しない。

---

## 🛠️ 文書の更新方法とCI

> 😊 **かんたんに言うと**：このリポジトリの「テスト」は、プログラムの動作確認ではなく**文書の矛盾チェックと個人情報・パスワードの混入チェック**。1コマンド（`npm run verify`）で誰でも同じように確認できる。

本リポジトリは**自前アプリを開発しない**方針のため、CI の対象はアプリのビルドではなく
**文書の整合性と秘密情報の混入有無**である。npm の外部パッケージは使わず（`npm install` 不要）、
Node.js 標準機能だけで動く。非エンジニアの担当者でも同じコマンドで再現でき、
supply-chain リスクを持ち込まないための判断である。

```bash
npm run verify   # 文書整合性チェック + ユニットテスト（Node.js v20 以上・install 不要）
```

CI では上記に加えて **gitleaks による秘密情報スキャン（履歴全体）** を実行する。

| CI ステップ | 内容 |
|---|---|
| 🔐 秘密情報スキャン | **gitleaks**（MIT）でコミット履歴全体を走査。バージョンと SHA256 を固定し、検出値は `--redact` で伏せる |
| 📦 依存関係の確認 | npm 外部依存ゼロが維持されているか |
| 🧪 ユニットテスト | 検証スクリプト自体が正しく動くか |
| 🔍 文書整合性チェック | `DOC001`〜`DOC006` |
| 🙈 `.env` 検査 | `.env` が Git 管理下に無いこと |

> 🔎 **2 段構えの理由**：`DOC003` は `npm run verify` だけで即座に回るローカル用の早期検知、
> gitleaks は数百種のプロバイダパターンで**履歴全体**を走査する本検査である。
> `gitleaks-action` は v2.0.0 以降が商用 EULA（Organization ではライセンスキー＝
> production secret の追加が必要）のため採用せず、MIT ライセンスの公式バイナリを固定して使う。

| ルール | 検査内容 | 重大度 |
|---|---|:---:|
| `DOC001` | 文書内で参照しているファイル（`.md` / `.html` / `.pptx`）が実在するか | 🔴 error |
| `DOC002` | `docs/` 配下の `.md` に対になる配布用 `.html` があるか | 🟡 warn |
| `DOC003` | 秘密情報・個人情報らしき文字列が混入していないか（**検出値は出力しない**） | 🔴 error |
| `DOC004` | 「## 文書情報」を持つ文書に「ステータス」行があるか | 🔴 error |
| `DOC005` | Q1〜Q7 / P-1〜P-12 の ID が README と計画書 第7章で一致するか | 🔴 error |
| `DOC006` | h1 見出しが 1 文書に 1 つだけか | 🔴 error |

更新の流れ（Issue → ブランチ → 編集 → `npm run verify` → PR → CI → 起案者以外のレビュー → Squash merge）と
禁止事項の詳細は **[`CONTRIBUTING.md`](CONTRIBUTING.md)** を参照。

> 🔐 `DOC003` で指摘された場合は、**値を Slack や Issue に貼り付けない**。該当箇所を除去・匿名化し、
> 実在の資格情報を push してしまった場合は除去だけでなく **rotation（再発行）** を行う。

---

## 🙅 絶対に守るルール（SOD）

> 😊 **かんたんに言うと**：「自分で自分の宿題を丸付けしない」というルール。提案した人・作った人が、その承認まで自分でやってしまうと不正やミスに誰も気づけなくなるため。

- 🚫 `企画者 ≠ 企画最終承認者`
- 🚫 `開発者 ≠ Pull Request最終承認者`
- 🚫 `開発者 ≠ Productionリリース最終承認者`
- 🚫 `AI ≠ 承認者`（AIは提案・支援のみ、承認は必ず人間）
- 🚫 `技術評価者 ≠ 経営投資判断者`
- 🚫 `Slack上の「OK」≠ 正式承認`（正式承認は desknet's NEO Workflow / AppSuite の記録のみ）

---

<div align="center">

**「AIを使う会社」ではなく、「社員の発想をAIが組織的に事業・システムへ変換する会社」を目指す。**

</div>
