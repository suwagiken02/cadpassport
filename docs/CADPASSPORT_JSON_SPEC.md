# CAD パスポート 図面 JSON 仕様書

外部アプリケーションで本図面 JSON を読み込み、図面を再現するための仕様書です。
**CAD 知識ゼロ** でも理解できるよう、座標系・単位・各要素の構造を平易に説明します。

---

## 1. 概要

この JSON は **足場の施工図面データ** です。
建物の外形・障害物・足場部材（手摺・支柱・踏板）・寸法線・メモ・方位磁石などを含みます。

データは Supabase の `drawings` テーブルに格納され、フィールド名は `canvas_data` (JSON カラム) です。
1 図面 = 1 JSON ドキュメント。

---

## 2. トップレベル構造

ルートオブジェクト (= `CanvasData` 型) の主要フィールド:

| フィールド名 | 型 | 意味 |
|---|---|---|
| `version` | string | スキーマバージョン (例: `"1.0"`) |
| `grid` | object | グリッド情報。下記参照 |
| `buildings` | array | 建物外形の配列 |
| `roofOverhangs` | array | 屋根の出幅（旧式、後方互換用。新規データは原則空） |
| `obstacles` | array | 障害物の配列 |
| `handrails` | array | 手摺（足場部材）の配列 |
| `posts` | array | 支柱の配列 |
| `antis` | array | 踏板（アンチ）の配列 |
| `memos` | array | メモの配列 |
| `compass` | object | 方位磁石の状態 `{ angle: number }` |
| `scaffoldStart1F` / `scaffoldStart2F` | object? | 足場開始角の設定（1F / 2F 別） |
| `magnetPins` | array? | マグネットピン配列（省略可、空 array 互換） |
| `heightMarkers` | array? | 高さマーカー配列（省略可） |
| `dimensionOffsetsMm` | object? | 寸法線位置のユーザ調整値（省略可） |

### `grid` の構造

| キー | 型 | 意味 |
|---|---|---|
| `unitMm` | `10` | 1 グリッド = **10 mm 固定**（変更不可） |
| `cols` | number | 初期キャンバス列数 (例: 600 = 6000mm = 6m) |
| `rows` | number | 初期キャンバス行数 (例: 400 = 4000mm = 4m) |

---

## 3. 座標系（★ 描画再現の要 ★）

### 単位
- **すべての座標 `x, y` は「グリッド単位」**
- **1 グリッド = 10 mm**
- mm に変換するには `mm = grid_value * 10`
- 例: `x: 5` は 50 mm を意味する

### 原点
- 原点 `(0, 0)` はキャンバスの **左上**
- データ自体に「キャンバスの中心」 や「絶対位置」 は無く、図面内の **相対座標系**
- 図面全体をまとめて平行移動しても意味は不変

### Y 軸の向き
- **Y は下向きが正**（画面座標系 / HTML5 Canvas / SVG / Konva と同じ）
- 数学の座標系（Y 上向き）とは逆。注意

### スケール（mm → 表示 px 変換、参考）
- 内部では `1 grid = 3 px (初期表示)` の係数で描画される
- ただし JSON 自体は **グリッド単位のみ**、px は表示用なので外部アプリでは無視可能
- 印刷時のスケール 1/100 とは `紙 1mm = 実 100mm = 10 grid`

### 一部の値のみ mm 単位（注意）
グリッド単位ではなく **mm 単位で持つ値** が存在:
- `handrail.lengthMm` (手摺の長さ)
- `anti.lengthMm` (踏板の長さ)
- `anti.width` (踏板の幅、400 or 250)
- `obstacle` の `width` / `height` は **グリッド単位**
- `heightMarker.heightMm` (高さ)
- `roof.uniformMm` 等、屋根出幅

判別: フィールド名末尾が `Mm` なら mm 単位、それ以外 (`x, y, width, height`) は基本グリッド単位。

---

## 4. 各図形要素の構造

### 4-1. 建物 `buildings`

| フィールド | 型 | 意味 | 例 |
|---|---|---|---|
| `id` | string (UUID) | 一意 ID | `"abc-123"` |
| `type` | `"polygon"` | 固定値 | |
| `points` | `Point[]` | 外形頂点（グリッド単位）。閉じる必要なし、最終点 → 最初点で自動閉じる | `[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80}]` |
| `fill` | string | 塗り色 | `"#3d3d3a"` |
| `floor` | `1 \| 2` (省略可) | 階。省略時は 1F 扱い | `1` |
| `roof` | RoofConfig (省略可) | 屋根設定 | |
| `templateId` | string (省略可) | テンプレ起源 ID。再描画には不要 | |
| `templateDims` | object (省略可) | テンプレ寸法。再描画には不要 | |

#### 描画方法
頂点 `points` を順に結んだ閉じたポリゴンを `fill` で塗る。
階 (`floor`) で 2F は半透明にする慣行があるが、これは表示の都合。

#### `roof` (RoofConfig、省略可)

| フィールド | 型 | 意味 |
|---|---|---|
| `roofType` | `'kirizuma' \| 'yosemune' \| 'katanagare' \| 'none'` | 屋根種別 |
| `uniformMm` | number | 全面同じ出幅の値 (mm) |
| `northMm` / `southMm` / `eastMm` / `westMm` | number\|null | 面別出幅 (mm)、null で `uniformMm` |
| `edgeOverhangsMm` | object? | L 字等多辺ポリゴン用、辺 index → 出幅(mm) のマップ |

「屋根なし」 状態は全 overhang = 0 + `uniformMm = 0` で表現される。

---

### 4-2. 手摺 `handrails`（足場部材の中心）

| フィールド | 型 | 意味 | 例 |
|---|---|---|---|
| `id` | string | 一意 ID | |
| `x` / `y` | number | **始点**のグリッド座標 | `x: 10, y: 20` (= 100mm, 200mm) |
| `lengthMm` | number | 手摺の長さ (mm)。許容値: 1800/1500/1200/1000/900/800/600/500/400/300/200/150/100 | `1800` |
| `direction` | `'horizontal'` / `'vertical'` / number | 方向 | `"horizontal"` |
| `color` | string | 色（CSS 色文字列） | `"#FF6B6B"` |
| `floor` | `1 \| 2` (省略可) | 階 |

#### 終点の計算（重要）
始点 `(x, y)` + 長さ `lengthMm` + 方向で終点を計算:
```
lengthGrid = lengthMm / 10

direction === 'horizontal':
  end = (x + lengthGrid, y)
direction === 'vertical':
  end = (x, y + lengthGrid)
direction === <number 度>:
  rad = direction * π / 180
  end = (x + lengthGrid * cos(rad), y + lengthGrid * sin(rad))
```

#### 描画方法
始点 → 終点を `color` の線で描画 (= 業界標準では太め)。
両端に小さな丸マーカーを描く慣行あり。

---

### 4-3. 支柱 `posts`

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | 一意 ID |
| `x` / `y` | number | 中心のグリッド座標 |
| `floor` | `1 \| 2` (省略可) | 階 |

#### 描画方法
`(x, y)` を中心に小さな黒丸を描く（半径 ~ 2-3 px 程度の固定サイズ）。

---

### 4-4. 踏板（アンチ） `antis`

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | |
| `x` / `y` | number | **左上**のグリッド座標 |
| `width` | `400` \| `250` | アンチ幅 (mm) |
| `lengthMm` | number | アンチ長さ (mm) |
| `direction` | `'horizontal'` / `'vertical'` | 配置方向 |
| `floor` | `1 \| 2` (省略可) | 階 |

#### 矩形のサイズ計算
```
direction === 'horizontal':
  w_grid = lengthMm / 10, h_grid = width / 10
direction === 'vertical':
  w_grid = width / 10, h_grid = lengthMm / 10
```

#### 描画方法
`(x, y)` を左上として `w_grid × h_grid` の矩形を黄系で塗る。

---

### 4-5. 障害物 `obstacles`

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | |
| `type` | string | `'ecocute' \| 'aircon' \| 'bay_window' \| 'carport' \| 'sunroom' \| 'balcony' \| 'custom_rect' \| 'custom_circle'` |
| `x` / `y` | number | **左上**のグリッド座標 |
| `width` / `height` | number | サイズ（**グリッド単位**） |
| `points` | `Point[]` (省略可) | 多角形ポリゴン障害物の頂点（あれば優先、無ければ矩形扱い） |
| `label` | string (省略可) | 表示ラベル |
| `memo` | string (省略可) | 自由メモ |

#### 描画方法
- `type === 'custom_circle'`: `(x, y)` 左上から `width × height` の楕円（円）
- `points` あり: 多角形ポリゴン描画
- それ以外: `(x, y)` 左上、 `width × height` の矩形描画

色は `type` に応じて事前定義（例: ecocute=水色、aircon=緑系、 carport=紫系 等）。

`carport` / `balcony` は「上層階張り出し」 = 破線で枠線描画する慣行あり（足元障害物ではない表現）。

---

### 4-6. メモ `memos`

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | |
| `x` / `y` | number | 左上のグリッド座標 |
| `text` | string | テキスト内容 |
| `style` | string | 旧式スタイル識別 |
| `shape` | `'rect' \| 'cloud' \| 'circle' \| 'speech'` (省略可) | 吹き出し形状。あれば優先 |
| `angle` | number (省略可) | 回転角度 (度) |
| `scaleX` / `scaleY` / `scale` | number (省略可) | スケール |
| `arrowTo` | Point (省略可) | 矢印先（吹き出し用、 旧式 callout） |

#### 描画方法
`shape` がある場合は対応形状（矩形 / 雲 / 円 / 吹き出し）を描き、テキストを中央に。
`shape` 無し + `arrowTo` あり: 旧式 callout（線で矢印 + 矩形ラベル）。
`shape` も `arrowTo` も無し: 単純テキスト描画。

---

### 4-7. 高さマーカー `heightMarkers`

建物外周（または屋根線）上の特定位置に立てる「ここの軒高 = X mm」 ピンポイント情報。

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | |
| `buildingId` | string | 紐づく建物 ID |
| `edgeIndex` | number | 建物 outline の辺 index (0 始まり) |
| `t` | number | 辺上の位置。`0.0` = 辺の始点側、 `1.0` = 終点側 |
| `heightMm` | number | 高さ (mm) |
| `floor` | `1 \| 2` (省略可) | |

#### 描画方法
1. `buildingId` で建物を引く
2. 屋根あり (`roof.roofType !== 'none'` && 出幅 > 0) → 屋根のオフセットポリゴン上、 屋根なし → 建物 `points` 上
3. `edgeIndex` の辺 `[p1, p2]` を取り、 位置 = `p1 + t * (p2 - p1)`
4. その位置に丸マーカー + ラベル `"H{heightMm}mm"` を描画

---

### 4-8. マグネットピン `magnetPins`

ガイドとしての参照点。 障害物 / メモ / 外壁を吸着配置するためのアンカー。

| フィールド | 型 | 意味 |
|---|---|---|
| `id` | string | |
| `x` / `y` | number | グリッド座標 |
| `floor` | `1 \| 2` (省略可) | 全階共通なら undefined |
| `sourceInfo` | object (省略可) | 履歴情報、 描画には不要 |

#### 描画方法
赤い針 + 頭 (= ピン形状) を描く。 表示専用、 線描画には不要なら省略可。

---

### 4-9. 方位磁石 `compass`

| フィールド | 型 | 意味 |
|---|---|---|
| `angle` | number | 回転角度 (度、 0-360)。0 = N が上向き、 90 = N が右向き（時計回り） |

#### 描画方法
- `angle` 度で時計回りに回転した方位磁石を表示
- 通常は紙の左上に小さく描く
- 0 度: 北が画面上向き
- 業界では「真北」 を `angle = 0` に固定し、 図面の向き（敷地形状）に合わせて回転する

---

### 4-10. 足場開始設定 `scaffoldStart1F` / `scaffoldStart2F`

足場の最初の手摺をどの建物角から始めるかの指定。 図面表示には必須ではないが、 足場自動配置の起点として保持される。

| フィールド | 型 | 意味 |
|---|---|---|
| `corner` | `'ne' \| 'nw' \| 'se' \| 'sw'` | 起点の建物角 |
| `startVertexIndex` | number (省略可) | 頂点 index |
| `face1DistanceMm` / `face2DistanceMm` | number | 角に接する 2 面の離れ (mm) |
| `face1FirstHandrail` / `face2FirstHandrail` | number | 最初の手摺長 (mm) |
| `floor` | `1 \| 2` (省略可) | |

---

### 4-11. 寸法線オフセット `dimensionOffsetsMm`

ユーザがドラッグで調整した寸法線位置の delta (mm)。

```ts
{
  scaffold1F: 0,  // 足場寸法線 1F
  scaffold2F: 0,
  wall1F: 0,      // 外壁寸法線 1F
  wall2F: 0,
  roof1F: 0,      // 屋根寸法線 1F
  roof2F: 0,
}
```

全 default 0 = アプリ既定位置。 外部アプリで寸法線を再現しないなら無視可。

---

## 5. 図面再現に必要な最低限（要点）

外部アプリで「とりあえず図面っぽい絵を描く」 ために必要な要素を優先度順に:

### 必須（これだけで図面は最低限見える）
1. `buildings` の `points` を順に結んだポリゴンを塗る
2. `obstacles` の矩形 / 多角形を描く
3. `handrails` の始点 + lengthMm + direction で終点計算し、線を引く

### 推奨（足場図面の体裁）
4. `posts` を黒丸で描く
5. `antis` を黄系矩形で描く
6. `compass.angle` で方位磁石を回転して左上に表示
7. `memos` のテキスト / 吹き出しを描く

### 任意（細部）
8. 屋根 `roof` の出幅をポリゴンで描く（建物外形を法線方向に offset）
9. 高さマーカー `heightMarkers` を建物外周上の指定位置に描く

### 描画擬似コード（最小限）

```pseudo
function drawDrawing(canvasData):
  scale = 3  # 1 grid = 3 px の初期表示
  ctx.translate(0, 0)

  # 1. 建物
  for b in canvasData.buildings:
    ctx.fillStyle = b.fill
    ctx.beginPath()
    for i, p in enumerate(b.points):
      x = p.x * scale
      y = p.y * scale  # Y は下向き正なのでそのまま
      if i == 0: ctx.moveTo(x, y) else: ctx.lineTo(x, y)
    ctx.closePath()
    ctx.fill()

  # 2. 障害物
  for o in canvasData.obstacles:
    if o.points:
      drawPolygon(o.points, COLOR[o.type])
    else if o.type == 'custom_circle':
      drawEllipse(o.x, o.y, o.width, o.height, COLOR[o.type])
    else:
      drawRect(o.x, o.y, o.width, o.height, COLOR[o.type])

  # 3. 手摺
  for h in canvasData.handrails:
    lengthGrid = h.lengthMm / 10
    if h.direction == 'horizontal':
      end = (h.x + lengthGrid, h.y)
    else if h.direction == 'vertical':
      end = (h.x, h.y + lengthGrid)
    else:
      rad = h.direction * PI / 180
      end = (h.x + lengthGrid * cos(rad), h.y + lengthGrid * sin(rad))
    drawLine(h.x * scale, h.y * scale, end.x * scale, end.y * scale, h.color)

  # 4. 支柱
  for p in canvasData.posts:
    drawCircle(p.x * scale, p.y * scale, radius=3, fill='black')

  # 5. アンチ
  for a in canvasData.antis:
    if a.direction == 'horizontal':
      w_grid = a.lengthMm / 10; h_grid = a.width / 10
    else:
      w_grid = a.width / 10; h_grid = a.lengthMm / 10
    drawRect(a.x * scale, a.y * scale, w_grid * scale, h_grid * scale, '#FCD34D')

  # 6. 方位磁石
  drawCompass(top_left, canvasData.compass.angle)
```

---

## 6. サンプル JSON

矩形建物 1 個（5m × 4m）+ 障害物 1 個（エコキュート）+ 手摺 1 本（1800mm） + 支柱 1 本の最小例:

```json
{
  "version": "1.0",
  "grid": {
    "unitMm": 10,
    "cols": 600,
    "rows": 400
  },
  "buildings": [
    {
      "id": "b1",
      "type": "polygon",
      "points": [
        { "x": 100, "y": 100 },
        { "x": 600, "y": 100 },
        { "x": 600, "y": 500 },
        { "x": 100, "y": 500 }
      ],
      "fill": "#3d3d3a",
      "floor": 1
    }
  ],
  "roofOverhangs": [],
  "obstacles": [
    {
      "id": "o1",
      "type": "ecocute",
      "x": 620,
      "y": 200,
      "width": 60,
      "height": 80,
      "label": "エコキュート"
    }
  ],
  "handrails": [
    {
      "id": "h1",
      "x": 90,
      "y": 90,
      "lengthMm": 1800,
      "direction": "horizontal",
      "color": "#FF6B6B",
      "floor": 1
    }
  ],
  "posts": [
    {
      "id": "p1",
      "x": 90,
      "y": 90,
      "floor": 1
    }
  ],
  "antis": [],
  "memos": [],
  "compass": { "angle": 0 }
}
```

### 解釈
- 建物: `(100, 100) - (600, 500)` = グリッド 500×400 = 実寸 5000mm × 4000mm = **5m × 4m** の矩形
- エコキュート: 建物の右側 `(620, 200) - (680, 280)` = 600mm × 800mm
- 手摺: 建物左上角 `(90, 90)` から東に 1800mm 伸びる
- 支柱: 手摺の始点 `(90, 90)` に立つ
- 方位: angle=0 = N が画面上向き（標準）

---

## 7. バリデーション / 互換性のヒント

- `magnetPins` / `heightMarkers` / `dimensionOffsetsMm` は **省略可能**。 古いデータでは存在しないことがある → `?? []` / `?? defaultValue` で吸収を推奨
- `floor` フィールドは **省略時は 1F 扱い**
- `roof.roofType === 'none'` または `uniformMm === 0` で全面出幅 0 = 屋根描画スキップ
- 座標 `x, y` は浮動小数点可（必ずしも整数とは限らない、配置時の微調整が反映される）

---

## 8. 関連情報

- 内部アプリ: Next.js + Konva.js + Zustand + Supabase
- 内部の TypeScript 型: `types/index.ts` の `CanvasData`, `BuildingShape`, `Handrail` 他
- 座標変換 utility: `lib/konva/gridUtils.ts` (`mmToGrid`, `gridToMm`, `GRID_UNIT_MM = 10`)
- 手摺端点計算: `lib/konva/snapUtils.ts` の `getHandrailEndpoints()`
