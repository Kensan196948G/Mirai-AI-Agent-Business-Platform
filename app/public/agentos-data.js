// Mirai AgentOS — seed data & domain constants (mock, browser-only)
export const VERSION = 3;
export const KEY = 'mirai-agentos-state';
export const ROLES = ['Administrator','Developer','Reviewer','Approver','Knowledge Curator','Viewer'];
export const PERM = {
  approve:['Administrator','Approver'], review:['Administrator','Approver','Reviewer'],
  promote:['Administrator','Knowledge Curator'], users:['Administrator'], agents:['Administrator','Developer'],
  run:['Administrator','Developer'], create:['Administrator','Developer','Reviewer','Approver','Knowledge Curator'],
  transition:['Administrator','Developer','Approver'], sync:['Administrator','Developer']
};
export const STATUS = {
  idea:['Idea','muted'], proposed:['審査中','blue'], approved:['承認済','blue'], active:['開発中','purple'],
  staging:['Staging / UAT','amber'], production:['本番稼働','green'], suspended:['保留','amber'], closed:['完了','green'], archived:['アーカイブ','muted']
};
export const TASK_ST = {
  pending:['待機','muted'], ready:['実行可','blue'], running:['実行中','purple'], blocked:['ブロック','amber'],
  review:['レビュー','blue'], completed:['完了','green'], failed:['失敗','red'], cancelled:['取消','muted']
};
export const APR_ST = {
  requested:['承認待ち','blue'], in_review:['レビュー中','purple'], approved:['承認','green'],
  returned:['差戻し','amber'], rejected:['却下','red'], cancelled:['取消','muted'], expired:['期限切れ','muted']
};
export const KN_ST = { pending:['レビュー待ち','amber'], promoted:['Notion反映済','green'], rejected:['却下','red'] };
export const RISK = { R0:'muted', R1:'muted', R2:'blue', R3:'amber', R4:'red', R5:'red' };
export const PHASES = ['相談・Idea','企画・審査','要件・設計','開発・検証','Staging / UAT','本番・効果測定','Knowledge化'];
export const STATUS_PHASE = { idea:0, proposed:1, approved:2, active:3, staging:4, production:5, suspended:3, closed:6, archived:6 };
export const TRANSITIONS = {
  idea:[{to:'proposed',label:'審査へ提出',risk:'R1'}],
  proposed:[{to:'approved',label:'案件承認（Gate）',risk:'R2',approval:'project_gate'}],
  approved:[{to:'active',label:'開発開始',risk:'R1'}],
  active:[{to:'staging',label:'Staging移行',risk:'R2'},{to:'suspended',label:'保留',risk:'R1'}],
  staging:[{to:'production',label:'本番リリース',risk:'R4',approval:'production_release'}],
  production:[{to:'closed',label:'完了',risk:'R1'}],
  suspended:[{to:'active',label:'再開',risk:'R1'}],
  closed:[{to:'archived',label:'アーカイブ',risk:'R1'}], archived:[]
};
export const MODELS = ['Claude Opus','Claude Sonnet','Claude Code','Codex','DeepSeek-V3','DeepSeek Harness'];
export const NAV = [
  {id:'g1',label:'概要（OVERVIEW）',items:[{key:'dashboard',label:'ダッシュボード（Dashboard）',ico:'📊'},{key:'chat',label:'AI相談（AI Consultation）',ico:'💬'}]},
  {id:'g2',label:'案件管理（PROJECTS）',items:[{key:'projects',label:'案件（Project）',ico:'📁'},{key:'tasks',label:'タスク・実行（Task / Agent Run）',ico:'🤖'},{key:'approvals',label:'承認（Approval）',ico:'✅'}]},
  {id:'g3',label:'ナレッジ・監査（KNOWLEDGE / AUDIT）',items:[{key:'knowledge',label:'ナレッジ候補（Knowledge）',ico:'📚'},{key:'audit',label:'監査ログ（Audit Log）',ico:'🧾'}]},
  {id:'g4',label:'プラットフォーム（PLATFORM）',items:[{key:'integrations',label:'外部連携（Integrations）',ico:'🔗'},{key:'observability',label:'監視（Observability）',ico:'📈'},{key:'agents',label:'エージェント設定（Agent / Router）',ico:'🧩'},{key:'users',label:'ユーザー・ロール（Users）',ico:'👥',perm:'users'}]}
];
export const TITLES = {
  dashboard:['ダッシュボード','案件・承認・Agent実行・AIコストの現在地'], chat:['AI相談','困りごと・アイデアを自然な日本語で。Intent分類 → Idea構造化 → 案件化'],
  projects:['案件（Project）','Phase / Gate / KPI / Task を PostgreSQL で一元管理'], tasks:['Task / Agent Run','Agent実行、Model Run、Tool Call、Cost の追跡'],
  approvals:['承認（Approval）','Risk R3以上のActionは人間承認を必須化'], knowledge:['Knowledge候補','Agent実行結果からの抽出 → 人間レビュー → Notion反映'],
  audit:['Audit Log','追記型・Hash Chainによる改ざん検知'], integrations:['Integrations','Notion / Slack / Gmail / GitHub 連携状態'],
  observability:['Observability','Metrics / AI Usage / Cost / Queue'], agents:['Agent / Skill / Model Router','Agent登録、Skill Registry、モデル選択ルール'], users:['ユーザー・ロール','authentik RBAC（AgentOS独立認証）']
};
export const SCENARIOS = [
  {match:/写真|画像|カメラ/,title:'現場写真の自動整理・台帳化',intent:'業務自動化 / 画像分類',risk:'R2',
   clarify:'現場写真の整理についてですね。Notionの既存Knowledge（DX-2026-0031 画像分類ADR）を参照しつつ、いくつか確認させてください。\n\n1. 月あたりの写真枚数はどの程度ですか？\n2. 現在の保存先（SDカード / 共有フォルダ / スマートフォン）は？\n3. 整理後の主な利用先は工事写真台帳ですか、出来形管理ですか？',
   idea:[['対象業務','工事写真の工種別分類と写真台帳の作成'],['現状','現場担当が週1回、手作業で約400枚を振り分け（約3h/週）'],['期待効果','整理工数 60%削減、台帳作成リードタイム 5日 → 1日'],['必要データ','現場写真（JPEG/EXIF）、工種マスタ、電子黒板情報'],['リスク候補','R2 — 第三者が映る写真の取扱い（Redaction要）'],['類似Knowledge','DX-2026-0031 コンクリート試験成績の自動判定（画像分類ADR）']]},
  {match:/報告|日報|書類|帳票/,title:'工事日報・報告書の自動生成',intent:'業務自動化 / 文書生成',risk:'R2',
   clarify:'報告書作成の自動化ですね。確認させてください。\n\n1. 対象は日報・週報・月報のどれですか？\n2. 元データはどこにありますか（Excel / 手書き / 写真）？\n3. 提出先フォーマットは発注者指定ですか？',
   idea:[['対象業務','工事日報・週報の作成と提出'],['現状','各現場で毎日30〜40分、Excelへ手入力'],['期待効果','作成時間 70%削減、記載漏れゼロ'],['必要データ','作業実績、天候、人員、安全指示、写真'],['リスク候補','R2 — 発注者提出書式の変更追従'],['類似Knowledge','DX-2026-0038 日報・工事報告書の自動生成（Staging中）']]},
  {match:/./,title:'新規AI活用テーマ',intent:'相談 / 未分類',risk:'R1',
   clarify:'ありがとうございます。案件化に向けて整理させてください。\n\n1. 誰が、どのくらいの頻度で困っていますか？\n2. 今はどのように対処していますか？\n3. うまくいった場合、何がどう変わると嬉しいですか？',
   idea:[['対象業務','（相談内容から抽出）'],['現状','担当者が個別に対応、手順が属人化'],['期待効果','工数削減と品質の標準化'],['必要データ','業務記録、既存テンプレート'],['リスク候補','R1 — 読み取り・整理中心'],['類似Knowledge','Notion: Playbook「業務整理テンプレート」']]}
];
const P = (key,title,status,owner,risk,summary,created,kpis,repo)=>({key,title,status,owner,risk,summary,created,kpis,repo,notion:'notion://projects/'+key,slack:'#dx-'+key.slice(-4)});
export function seed(){
  return {
    users:[
      {id:'u2',name:'佐藤 花子',dept:'情報システム部',role:'Administrator',last:'2026-09-06 09:20'},
      {id:'u1',name:'山田 太郎',dept:'経営企画部',role:'Approver',last:'2026-09-06 08:55'},
      {id:'u3',name:'鈴木 一郎',dept:'土木技術部',role:'Developer',last:'2026-09-06 09:12'},
      {id:'u4',name:'高橋 美咲',dept:'技術研究所',role:'Reviewer',last:'2026-09-05 18:05'},
      {id:'u5',name:'伊藤 健',dept:'DX推進室',role:'Knowledge Curator',last:'2026-09-05 16:40'},
      {id:'u6',name:'渡辺 直子',dept:'東京支店 工事部',role:'Viewer',last:'2026-09-04 11:30'}
    ],
    projects:[
      P('DX-2026-0042','現場写真の自動整理・台帳化','active','u3','R3','EXIF・電子黒板情報から工種を分類し、工事写真台帳を自動生成する。','2026-07-14',[{n:'写真整理工数',t:60,c:38,u:'%削減'},{n:'分類精度',t:95,c:91,u:'%'}],'mirai/agentos-photo-ledger'),
      P('DX-2026-0038','工事日報・報告書の自動生成','staging','u3','R3','作業実績・天候・人員から日報を生成し、発注者書式へ出力する。','2026-06-02',[{n:'作成時間',t:70,c:64,u:'%削減'},{n:'記載漏れ',t:0,c:2,u:'件/月'}],'mirai/agentos-report-gen'),
      P('DX-2026-0045','出来形検査データのAI照査','approved','u4','R3','出来形測定値を基準値と自動照査し、逸脱候補を提示する。','2026-08-05',[{n:'照査時間',t:50,c:0,u:'%削減'}],'mirai/agentos-inspection-check'),
      P('DX-2026-0047','安全巡視記録の音声入力化','proposed','u6','R2','巡視中の音声メモを文字化し、是正指示書へ構造化する。','2026-08-28',[{n:'記録時間',t:40,c:0,u:'%削減'}],'—'),
      P('DX-2026-0051','積算根拠資料のRAG検索','idea','u1','R1','過去の積算根拠・見積資料を横断検索し、根拠提示を高速化する。','2026-09-03',[],'—'),
      P('DX-2026-0031','コンクリート試験成績の自動判定','production','u4','R3','圧縮強度・スランプ試験結果を規格値と照合し、合否を自動判定する。','2026-03-10',[{n:'判定工数',t:50,c:58,u:'%削減'},{n:'誤判定',t:0,c:0,u:'件'}],'mirai/agentos-concrete-qc'),
      P('DX-2026-0040','ドローン測量点群の差分抽出','suspended','u3','R2','施工前後の点群差分から土量変化を抽出する。','2026-07-01',[{n:'土量算出時間',t:60,c:12,u:'%削減'}],'mirai/agentos-pointcloud-diff'),
      P('DX-2026-0022','施工計画書テンプレート整備','closed','u1','R1','施工計画書の標準テンプレートと記載ガイドを整備した。','2026-01-20',[{n:'作成時間',t:30,c:34,u:'%削減'}],'mirai/docs-templates')
    ],
    tasks:[
      {id:'T-1021',pk:'DX-2026-0042',title:'EXIF/黒板情報からの工種分類モデル実装',agent:'Developer Agent',provider:'Anthropic',model:'Claude Code',status:'running',tin:184200,tout:42100,cost:1.82,lat:48200,at:'2026-09-06 09:12',tools:[['notion.search','R0','PERMIT'],['github.create_branch','R1','PERMIT'],['github.push','R2','PERMIT']]},
      {id:'T-1020',pk:'DX-2026-0042',title:'分類精度テスト生成（Unit / Integration）',agent:'Developer Agent',provider:'OpenAI',model:'Codex',status:'completed',tin:96400,tout:31800,cost:0.94,lat:31500,at:'2026-09-05 22:10',tools:[['github.push','R2','PERMIT'],['ci.run_tests','R1','PERMIT']]},
      {id:'T-1019',pk:'DX-2026-0042',title:'PR #48 独立レビュー（実装モデルと分離）',agent:'Reviewer Agent',provider:'DeepSeek',model:'DeepSeek-V3',status:'review',tin:142000,tout:9800,cost:0.11,lat:22400,at:'2026-09-05 23:02',tools:[['github.read_pr','R0','PERMIT'],['github.comment','R1','PERMIT']]},
      {id:'T-1018',pk:'DX-2026-0038',title:'本番リリース手順書・Rollback案作成',agent:'Operations Agent',provider:'Anthropic',model:'Claude Sonnet',status:'blocked',tin:38200,tout:12600,cost:0.31,lat:15200,at:'2026-09-05 17:35',blockedBy:'APR-0107',tools:[['notion.read','R0','PERMIT'],['deploy.production','R4','APPROVAL_REQUIRED']]},
      {id:'T-1017',pk:'DX-2026-0045',title:'出来形基準値（土木工事施工管理基準）の調査・比較',agent:'Research Agent',provider:'DeepSeek',model:'DeepSeek-V3',status:'completed',tin:210000,tout:18400,cost:0.16,lat:41000,at:'2026-09-04 14:20',tools:[['web.search','R0','PERMIT'],['notion.search','R0','PERMIT']]},
      {id:'T-1016',pk:'DX-2026-0045',title:'ADR: 照査ロジックの配置（Worker vs API）',agent:'Architecture Agent',provider:'Anthropic',model:'Claude Opus',status:'completed',tin:54000,tout:9200,cost:1.5,lat:27800,at:'2026-09-04 16:05',tools:[['notion.read','R0','PERMIT'],['notion.draft','R1','PERMIT']]},
      {id:'T-1015',pk:'DX-2026-0047',title:'Intent分類・Risk候補判定',agent:'CTO Orchestrator',provider:'DeepSeek',model:'DeepSeek-V3',status:'completed',tin:6200,tout:1400,cost:0.01,lat:3200,at:'2026-08-28 10:12',tools:[['notion.search','R0','PERMIT']]},
      {id:'T-1014',pk:'DX-2026-0038',title:'帳票テンプレート差分適用',agent:'Developer Agent',provider:'OpenAI',model:'Codex',status:'failed',tin:44000,tout:12000,cost:0.42,lat:19800,at:'2026-09-03 11:48',err:'Validation Error: テンプレート schema 不一致（Retry対象外 → Failed）',tools:[['github.push','R2','PERMIT'],['schema.validate','R0','PERMIT']]},
      {id:'T-1013',pk:'DX-2026-0031',title:'Lessons Learned 抽出（Knowledge候補生成）',agent:'Knowledge Curator',provider:'Anthropic',model:'Claude Sonnet',status:'completed',tin:72000,tout:8800,cost:0.35,lat:12600,at:'2026-09-02 09:30',tools:[['notion.search','R0','PERMIT'],['knowledge.candidate','R1','PERMIT']]},
      {id:'T-1012',pk:'DX-2026-0040',title:'点群差分アルゴリズム調査',agent:'Research Agent',provider:'DeepSeek',model:'DeepSeek-V3',status:'cancelled',tin:18000,tout:2100,cost:0.02,lat:8000,at:'2026-08-20 15:10',tools:[['web.search','R0','PERMIT']]}
    ],
    approvals:[
      {id:'APR-0107',pk:'DX-2026-0038',type:'production_release',title:'本番リリース承認（v0.9.0）',risk:'R4',status:'requested',by:'鈴木 一郎',at:'2026-09-05 17:40',target:'GitHub Release v0.9.0 / mirai/agentos-report-gen',evidence:['E2E 42/42 pass','Security Scan: Critical 0 / High 0','Rollback手順: Runbook #12','UAT承認: 東京支店 工事部（9/5）'],steps:[{role:'Reviewer',who:'高橋 美咲',st:'approved',at:'2026-09-05 18:05'},{role:'Approver',who:'山田 太郎',st:'pending',at:''}],log:[]},
      {id:'APR-0108',pk:'DX-2026-0042',type:'github_merge',title:'PR #48 main へのMerge',risk:'R3',status:'in_review',by:'Developer Agent',at:'2026-09-05 23:05',target:'mirai/agentos-photo-ledger PR #48',evidence:['Unit 118/118 pass','Reviewer Agent（DeepSeek-V3）: 指摘 2件 → 解消'],steps:[{role:'Reviewer',who:'高橋 美咲',st:'pending',at:''},{role:'Approver',who:'山田 太郎',st:'pending',at:''}],log:[]},
      {id:'APR-0106',pk:'DX-2026-0047',type:'project_gate',title:'正式案件化（企画審査Gate）',risk:'R2',status:'requested',by:'渡辺 直子',at:'2026-08-29 09:10',target:'Project DX-2026-0047',evidence:['Idea構造化: Notion Idea #47','期待効果: 記録時間 40%削減','MVP範囲: 1現場・1ヶ月'],steps:[{role:'Approver',who:'山田 太郎',st:'pending',at:''}],log:[]},
      {id:'APR-0104',pk:'DX-2026-0045',type:'project_gate',title:'正式案件化（企画審査Gate）',risk:'R2',status:'approved',by:'高橋 美咲',at:'2026-08-06 10:00',target:'Project DX-2026-0045',evidence:['Idea構造化: Notion Idea #45'],steps:[{role:'Approver',who:'山田 太郎',st:'approved',at:'2026-08-07 13:20'}],log:[{at:'2026-08-07 13:20',who:'山田 太郎',action:'approved',reason:'効果・実現性ともに妥当。MVPは1工区に限定。'}]},
      {id:'APR-0099',pk:'DX-2026-0040',type:'budget',title:'追加予算（点群処理GPU）',risk:'R3',status:'rejected',by:'鈴木 一郎',at:'2026-07-25 11:00',target:'Project DX-2026-0040',evidence:['見積: GPUサーバ 1台'],steps:[{role:'Approver',who:'山田 太郎',st:'rejected',at:'2026-07-28 09:40'}],log:[{at:'2026-07-28 09:40',who:'山田 太郎',action:'rejected',reason:'クラウドGPUのスポット利用で代替可能。案件は保留。'}]}
    ],
    knowledge:[
      {id:'KC-0311',title:'現場写真のEXIF欠損時は電子黒板OCRの日付を優先する',type:'Lesson',pk:'DX-2026-0042',score:82,status:'pending',summary:'撮影機材によりEXIF撮影日時が欠損する事例が全体の12%。黒板OCRの日付を優先し、矛盾時はHuman Reviewへ回す運用が有効だった。',src:'Agent Run T-1020 / PR #48 レビューコメント',dup:'重複なし'},
      {id:'KC-0310',title:'ADR: 出来形照査ロジックはWorker側に配置する',type:'ADR',pk:'DX-2026-0045',score:91,status:'pending',summary:'長時間処理となる照査計算はAPIから分離しWorkerで実行、Job IDで非同期化する。API側は結果参照のみ。',src:'Agent Run T-1016（Architecture Agent）',dup:'重複なし'},
      {id:'KC-0309',title:'帳票テンプレート差分は schema version で管理する',type:'Playbook',pk:'DX-2026-0038',score:64,status:'pending',summary:'発注者書式変更に対し、テンプレートへschema versionを付与しValidationで不一致を検出する。',src:'Agent Run T-1014（Failed）のPostmortem',dup:'類似: Notion Playbook「帳票出力標準」と 40% 重複 — 統合を推奨'},
      {id:'KC-0305',title:'コンクリート試験成績の閾値判定パラメータ',type:'Standard',pk:'DX-2026-0031',score:88,status:'promoted',summary:'圧縮強度・スランプの規格値と許容差、判定ロジックの確定版。',src:'Agent Run T-1013',dup:'重複なし',notion:'notion://knowledge/standards/KC-0305'},
      {id:'KC-0302',title:'Slack #dx-0040 議論ログ（生データ）',type:'Raw',pk:'DX-2026-0040',score:21,status:'rejected',summary:'点群処理に関するSlackスレッドの全文。',src:'Slack Raw Conversation',dup:'FR-303: Raw ConversationはそのままKnowledge化しない'}
    ],
    audit:[
      {id:'AE-09012',at:'2026-09-06 09:12',actorType:'agent',actor:'Developer Agent',type:'tool_call',resType:'task',resId:'T-1021',summary:'github.push (R2) → PERMIT',prev:'a71c3e90',hash:'5be2d0f4'},
      {id:'AE-09011',at:'2026-09-06 09:10',actorType:'service',actor:'GitHub Webhook',type:'webhook',resType:'integration',resId:'github',summary:'pull_request.synchronize PR #48',prev:'3f0c91ab',hash:'a71c3e90'},
      {id:'AE-09010',at:'2026-09-06 08:30',actorType:'service',actor:'Notion Sync',type:'sync',resType:'integration',resId:'notion',summary:'Knowledge DB 差分同期 12件',prev:'c2e84d17',hash:'3f0c91ab'},
      {id:'AE-09009',at:'2026-09-05 23:05',actorType:'agent',actor:'Developer Agent',type:'approval_request',resType:'approval',resId:'APR-0108',summary:'github.merge (R3) → APPROVAL_REQUIRED',prev:'9d4b60e2',hash:'c2e84d17'},
      {id:'AE-09008',at:'2026-09-05 18:05',actorType:'user',actor:'高橋 美咲',type:'approval_action',resType:'approval',resId:'APR-0107',summary:'Reviewer step approved',prev:'e1a7f3c8',hash:'9d4b60e2'},
      {id:'AE-09007',at:'2026-09-05 17:40',actorType:'agent',actor:'Operations Agent',type:'policy_decision',resType:'task',resId:'T-1018',summary:'deploy.production (R4) → APPROVAL_REQUIRED',prev:'7b3d2a55',hash:'e1a7f3c8'},
      {id:'AE-09006',at:'2026-09-05 16:40',actorType:'user',actor:'伊藤 健',type:'knowledge',resType:'knowledge',resId:'KC-0305',summary:'Knowledge候補をNotionへ昇格',prev:'44f0c8de',hash:'7b3d2a55'},
      {id:'AE-09005',at:'2026-09-05 09:02',actorType:'user',actor:'渡辺 直子',type:'user_login',resType:'session',resId:'authentik',summary:'OIDC ログイン成功',prev:'b8e2117a',hash:'44f0c8de'},
      {id:'AE-09004',at:'2026-09-04 11:48',actorType:'user',actor:'渡辺 直子',type:'policy_denied',resType:'approval',resId:'APR-0106',summary:'approve → DENY（Role: Viewer）',prev:'0e6d5f31',hash:'b8e2117a'},
      {id:'AE-09003',at:'2026-09-03 11:48',actorType:'agent',actor:'Developer Agent',type:'task_failed',resType:'task',resId:'T-1014',summary:'Validation Error（Retry対象外）',prev:'62aa19c4',hash:'0e6d5f31'},
      {id:'AE-09002',at:'2026-09-03 08:15',actorType:'service',actor:'pg_backup',type:'backup',resType:'database',resId:'postgresql',summary:'pg_dump 完了 / WAL archive OK / Restore Test PASS',prev:'00000000',hash:'62aa19c4'}
    ],
    integrations:[
      {id:'notion',name:'Notion',role:'Knowledge SoR',status:'connected',last:'2026-09-06 08:30',detail:'Knowledge DB 3 / Pages 412 / 発見候補DB 同期',note:'必要範囲のみ取得。Secretは書き込まない'},
      {id:'slack',name:'Slack',role:'Collaboration',status:'connected',last:'2026-09-06 09:02',detail:'#dx-0042 ほか 6ch / Approval Prompt 有効',note:'Raw LogはKnowledge化しない（FR-303）'},
      {id:'gmail',name:'Gmail',role:'Mail Gateway',status:'attention',last:'2026-09-06 07:55',detail:'受信 14 / 自動返信 9 / Human Review待ち 2',note:'契約・金額・機密・承認事項は自動返信禁止（SEC-006）'},
      {id:'github',name:'GitHub',role:'Engineering SoR',status:'connected',last:'2026-09-06 09:10',detail:'Repos 6 / Open PR 4 / Webhook 128 events',note:'Merge / Release は Policy 対象'}
    ],
    webhooks:[
      ['WH-1128','github','pull_request.synchronize','PR #48','processed'],['WH-1127','slack','app_mention','#dx-0042 @agentos 進捗は？','processed'],
      ['WH-1126','gmail','message.received','件名: 見積書送付の件（外部）','human_review'],['WH-1125','github','check_suite.completed','CI #512 success','processed'],['WH-1124','notion','page.updated','ADR-0045-01','processed']
    ],
    agents:[
      {id:'cto',name:'CTO Orchestrator',duty:'Goal解釈、Plan、委譲、結果統合',skills:'planning, delegation, risk-classification',model:'Claude Opus',on:true},
      {id:'research',name:'Research Agent',duty:'調査、比較、根拠収集',skills:'web-research, notion-search, repo-analysis',model:'DeepSeek-V3',on:true},
      {id:'arch',name:'Architecture Agent',duty:'Architecture / ADR / Design Review',skills:'adr-draft, architecture-review',model:'Claude Opus',on:true},
      {id:'dev',name:'Developer Agent',duty:'実装、Test、PR',skills:'coding, test-generation, github-pr',model:'Claude Code',on:true},
      {id:'review',name:'Reviewer Agent',duty:'独立Review（実装モデルと分離）',skills:'code-review, security-review, test-review',model:'DeepSeek-V3',on:true},
      {id:'ops',name:'Operations Agent',duty:'Deploy、Runbook、Incident',skills:'deploy, rollback, diagnostics',model:'Claude Sonnet',on:false},
      {id:'curator',name:'Knowledge Curator',duty:'Knowledge抽出・品質評価・昇格',skills:'knowledge-discovery, quality-review, lifecycle',model:'Claude Sonnet',on:true}
    ],
    skills:[
      ['coding','1.4.0','Developer','R2','approved'],['github-pr','1.2.1','Developer','R2','approved'],['code-review','1.1.0','Reviewer','R1','approved'],['deploy','0.9.0','Operations','R4','draft'],
      ['knowledge-discovery','1.0.2','Knowledge Curator','R1','approved'],['web-research','2.0.0','Research','R0','approved'],['adr-draft','1.0.0','Architecture','R1','approved'],['legacy-export','0.3.0','Developer','R2','deprecated']
    ],
    router:[
      {cat:'Research / Classification',model:'DeepSeek-V3'},{cat:'Architecture / Docs',model:'Claude Opus'},{cat:'Repository Development',model:'Claude Code'},
      {cat:'Independent Review',model:'DeepSeek-V3'},{cat:'High-volume Agent Loops',model:'DeepSeek Harness'}
    ],
    usage:[{p:'Anthropic (Claude)',tok:1840000,cost:23.4,runs:64,color:'var(--accent)'},{p:'OpenAI (Codex)',tok:920000,cost:11.2,runs:31,color:'var(--blue-2)'},{p:'DeepSeek',tok:3100000,cost:2.9,runs:142,color:'var(--green-2)'}],
    chat:{messages:[{role:'ai',text:'こんにちは。Mirai AgentOSです。困りごと・改善したい業務・研究テーマを普段の言葉で教えてください。Intentを分類し、Notionの既存Knowledgeを参照して案件化まで整理します。'}],topic:-1,step:0},
    theme:'light', role:'Approver', screen:'dashboard', openGroups:{g1:true,g2:true,g3:true,g4:true},
    selProject:'DX-2026-0042', selTask:'T-1021', selApproval:'APR-0107'
  };
}
export function hash(str){let h=5381;for(let i=0;i<str.length;i++)h=((h<<5)+h+str.charCodeAt(i))|0;return (h>>>0).toString(16).padStart(8,'0').slice(0,8);}
export function now(){const d=new Date(),z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;}
