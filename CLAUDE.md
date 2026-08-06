# CADパスポート（ashiba-plan）— 作業の前提

このファイルは AI（および新しく入る人）が最初に読むもの。ここに書いてあることは
**推測より優先**する。矛盾を見つけたら、直す前にここを更新すること。

---

## 1. 絶対に守ること

### 足場設計の絶対原則
- **建物と足場は必ず平行**。斜めに走らせない。
- **1 面内・同一面の全階で「離れ」は一定**。水平・垂直とも途中で変えない。
  面をまたいだ場合のみ異なってよい（例: 北面 900 / 東面 600 は可、北面の途中で 900→600 は不可）。
- この原則に反する提案・実装は、他がどれだけ良くても採用しない。

### 開発フロー
- **`git push` は絶対に実行しない**。commit までで停止し、push は人間が行う。
- 既存機能を壊さない。変更したら `npx tsc --noEmit` / `npm test` / `npm run build` の 3 点を必ず通す。
- 実機（鮎澤氏の端末）で確認するまで「直った」と言わない。報告には必ず**実機確認手順**を付ける。
- 1 つの指示につき 1 commit を基本にし、無関係な変更を混ぜない。

### 計測とプライバシー
- **個人情報を記録しない**。user_id はハッシュ（SHA-256 先頭 16 文字）。
- **図面の実データをログに入れない**（座標・建物名・住所らしき文字列・プロジェクト名）。
- 計測は**完全に非ブロッキング**。失敗しても本体の動作に影響を与えない（`console.warn` のみ）。
- 開発環境では送信しない（本番のみ）。

---

## 2. リポジトリ構成

```
app/                     Next.js App Router
  auth/                  ログイン・新規登録・PW再設定
  projects/              プロジェクト一覧（新規作成もここ）
  editor/[id]/           作図画面（本体。ほぼ全機能の入口）
  settings/  privacy/  terms/  share/[token]/  api/
components/
  canvas/                Konva のレイヤー群（GridCanvas が親）
  toolbar/               モード切替・部材パレット
  scaffold/              自動配置（AutoLayoutModal）
  elevation/             立面図（プレビュー・配置ダイアログ）
  output/  export/       PDF/画像 出力
  building/ dimension/ memo/ project/ settings/ tutorial/ ui/
lib/
  analytics.ts           行動計測（track ひとつで完結）
  konva/                 幾何・自動配置・立面のロジック（pure・テスト対象）
    autolayout/          自動配置のコア
    elevation/           立面エンジン（E-1〜E-9）
  supabase/              client / admin / schema.sql / migrations/
  pages/  export/  auth/  tutorial/
stores/                  Zustand（canvasStore が中心）
scripts/analyze.ts       行動ログの集計（npm run analyze）
docs/                    設計・調査・意思決定の記録
```

### 状態管理（Zustand）
| store | 役割 | 主なアクション |
|---|---|---|
| `stores/canvasStore.ts` | 図面データ・モード・履歴（約 2000 行の中心） | `setCanvasData` / `addHandrail(s)` / `removeElement(s)` / `pushHistory` / `undo` / `redo` / `setMode` |
| `stores/authStore.ts` | ログイン状態・会社 | `signIn` / `signUp` / `signInWithId` / `signOut` / `loadSession` |
| `stores/handrailSettingsStore.ts` | 部材（手摺）設定 | 有効サイズ・単位系 |
| `stores/tutorialStore.ts` | チュートリアル進行 | — |

**zustand v5 の注意**: selector がオブジェクト/配列を新規生成すると無限再描画になる
（`useStore((s) => ({a: s.a}))` は禁止）。プリミティブで 1 つずつ購読するか `useShallow`。
`lib/konva/__tests__/storeSelectorStability.test.ts` がソースを走査して機械的に止めている。

### データベース（Supabase）
`companies` / `profiles` / `projects` / `drawings` / `shared_links` / `handrail_settings` / `events`。
RLS は全テーブル有効。原則「自分のデータだけ読み書きできる」。
`events` だけは例外で「入れるだけ・読めない（管理者と service_role のみ集計可）」。
スキーマは `lib/supabase/schema.sql`、増分は `lib/supabase/migrations/NNNN_*.sql`（**実行は手動**）。

---

## 3. 主要フロー（計測の軸でもある）

```
ログイン(auth) → プロジェクト一覧(projects) → 作図(editor)
   → 建物入力 → 高さ・屋根 → 自動配置(auto_layout_apply) → 手直し(manual_edit)
   → 立面(elevation_open) → 保存(drawing_save) → 出力(export_done)
```

---

## 4. 足場用語集

| 用語 | 意味 |
|---|---|
| 離れ | 建物の壁から足場（支柱の芯）までの水平距離。900/600 など |
| スパン | 支柱と支柱の間隔。標準 1800mm。1500/1200/900/600 もある |
| コマ | 支柱の楔ポケットの位置。450mm ピッチ。1 コマ目は皿+250 |
| 皿（ジャッキ上端） | 支柱の足元。ジャッキを巻いて高さを合わせる（40〜490 で可変） |
| ジャッキ | 支柱の足元の高さ調整金具 |
| 手摺 | 支柱間に渡す水平材。1 スパン 1 本 |
| 踏板（アンチ） | 作業床。幅 400/250（メートル規格）、500/240（インチ規格） |
| 筋交 | スパンの対角に入れる補強材 |
| 段 | 足場の 1 層。標準 1800mm |
| スタート（端数） | 1 段目の高さ。建物高さ − 1800×段数 |
| 下がり | 最上段から建物天端までの残り |
| 妻（つま） | 屋根の三角に見える側の面。棟と直交する |
| 樋面（といめん）／平（ひら） | 軒樋が付く側の面。棟と平行 |
| 棟（むね） | 屋根の頂上の水平線 |
| 軒（のき） | 屋根の下端。軒高＝壁位置の高さ |
| 軒の出（出幅） | 壁より外へ張り出した屋根の量 |
| けらば | 妻側の屋根の端 |
| 下屋（げや） | 母屋より低い、下階の屋根 |
| 総二階 | 1F と 2F の外形が同じ建物 |
| 入隅／出隅 | 建物の凹んだ角／出っ張った角 |
| 嵩上げ | 屋根まで手が届かないスパンでコマを足して床を上げること |
| 起点（スタート角） | 自動配置で最初に部材を置く角。★ で表示 |

---

## 5. AI 提案ループ（フェーズ0 で土台を作った）

1. `npm run analyze` で事実（詰まり・未使用機能・手戻り）を出す
2. 改善案は `docs/proposals/` に 1 案 1 ファイルで置く
3. 採否と**理由**を `docs/decisions.md` に必ず記録する
4. 却下理由の蓄積が次の提案精度を決める。理由なしの却下は残さない
