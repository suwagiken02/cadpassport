// ============================================================
// 下図（したず）の合わせ込み (= U-1)・pure
//
// ■ この機能の目的
// 「背景に絵を敷く」ことではなく、**図面の 1800mm とアプリのグリッドの 1800mm を
// ぴったり重ねる**こと。合っていないと、グリッドの交点に吸着する割付部材が実際の
// 壁の位置に乗らず、背景がきれいに見えても使い物にならない。
//
// 合わせるのは 3 つ:
//   ・拡大率（縮尺）… 画像 1px が何グリッドか
//   ・回転          … 図面が傾いて写っていると壁とグリッドが平行にならない
//   ・位置          … 建物の角がグリッドの交点に来るように平行移動
//
// ■ 値を丸めない
// グリッドは 10mm 刻み。originGrid をグリッド単位や整数に丸めると**最大 5mm の
// 誤差が最初から入り**、2 点合わせで出した 7mm 前後の精度が台無しになる。
// scale・rotationDeg も同じ。ここでは一切丸めない（テストで固定してある）。
//
// ■ 座標系
//   画像座標 (ix, iy) … 画像の左上が原点・px・y は下
//   グリッド座標 (gx, gy) … キャンバスと同じ・1 = 10mm・y は下
// 変換は「回して・拡大して・寄せる」の相似変換。第二弾（歪み補正）で射影変換へ
// 差し替えられるよう、kind 付きの入れ物にしてある。
// ============================================================
import { GRID_UNIT_MM } from './gridUtils';
import type { Point } from '@/types';

// ============================================================
// 決めごとの数値（実機で調整しうるもの）
// ============================================================

/** 2 点が近すぎると精度が出ない。これ未満（画像 px）では確定させない。 */
export const UNDERLAY_MIN_CALIB_PX = 500;
/** クリックの誤差の見積もり(px)。推定誤差の表示に使う。 */
export const UNDERLAY_CLICK_ERROR_PX = 1.5;
/** 保存する画像の長辺の上限(px)。これを超えたらブラウザ側で縮めてから上げる。 */
export const UNDERLAY_MAX_LONG_EDGE_PX = 4000;
/** 読み込める元ファイルの上限(byte)。 */
export const UNDERLAY_MAX_BYTES = 10 * 1024 * 1024;
/** 背景の濃さ。足場が見やすいよう既定は薄め。 */
export const UNDERLAY_DEFAULT_OPACITY = 0.5;
export const UNDERLAY_MIN_OPACITY = 0.1;
export const UNDERLAY_MAX_OPACITY = 1;

// ============================================================
// 変換の入れ物
// ============================================================

/**
 * 画像をグリッドへ載せる変換 (= U-1)。
 * kind を持たせてあるので、第二弾で 'projective'（四隅指定の台形補正）を
 * 足すときに、既存データを壊さず分岐できる。
 */
export type UnderlaySimilarity = {
  kind: 'similarity';
  /** 画像 1px が何グリッドか（1 グリッド = 10mm）。丸めない。 */
  scale: number;
  /** 画像を回す角度(度)。画面座標（y 下向き）で正が時計回り。丸めない。 */
  rotationDeg: number;
  /** 画像の左上(0,0) がグリッドのどこに来るか。丸めない。 */
  originGrid: Point;
};

export type UnderlayTransform = UnderlaySimilarity;

/** 合わせ込み前の既定（等倍・無回転・原点）。 */
export const identityTransform = (): UnderlaySimilarity => ({
  kind: 'similarity', scale: 1, rotationDeg: 0, originGrid: { x: 0, y: 0 },
});

// ============================================================
// 画像座標 ⇔ グリッド座標
// ============================================================

/** 画像上の点 → グリッド座標。 */
export function imageToGrid(p: Point, t: UnderlayTransform): Point {
  const r = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const x = p.x * t.scale, y = p.y * t.scale;
  return {
    x: t.originGrid.x + x * cos - y * sin,
    y: t.originGrid.y + x * sin + y * cos,
  };
}

/** グリッド座標 → 画像上の点（逆変換）。 */
export function gridToImage(p: Point, t: UnderlayTransform): Point {
  const r = (-t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const dx = p.x - t.originGrid.x, dy = p.y - t.originGrid.y;
  return {
    x: (dx * cos - dy * sin) / t.scale,
    y: (dx * sin + dy * cos) / t.scale,
  };
}

// ============================================================
// 2 点 ＋ 実寸から、拡大率と回転を決める
// ============================================================

/** 寸法線の向き。 */
export type CalibOrientation = 'horizontal' | 'vertical';

/**
 * 2 点の傾きから寸法線の向きを推す (= 修正3)。
 * たいていの場合ユーザーは何も選ばずに済む。違っていたら切り替えられる。
 */
export function guessOrientation(p1: Point, p2: Point): CalibOrientation {
  return Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y) ? 'horizontal' : 'vertical';
}

/** 角度を -180..180 へ畳む。 */
const normalizeDeg = (deg: number): number => {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

/**
 * その 2 点を結ぶ線を、水平（または垂直）にするための回転角(度)。
 *
 * 目標は水平なら 0° と 180°、垂直なら 90° と -90° の 2 つずつあり、
 * **回転量が小さい方**を選ぶ。こうすると 2 点をどちらの順で押しても同じ結果になり、
 * 「クリックの順番で図面が 180° ひっくり返る」が起きない。
 */
export function calibrationRotationDeg(
  p1: Point, p2: Point, orientation: CalibOrientation,
): number {
  const a = (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;
  const targets = orientation === 'horizontal' ? [0, 180] : [90, -90];
  let best = 0;
  let bestAbs = Infinity;
  for (const t of targets) {
    const d = normalizeDeg(t - a);
    if (Math.abs(d) < bestAbs) { bestAbs = Math.abs(d); best = d; }
  }
  return best;
}

/** 画像上の 2 点の距離(px)。 */
export const imageDistancePx = (p1: Point, p2: Point): number =>
  Math.hypot(p2.x - p1.x, p2.y - p1.y);

/** その 2 点は合わせ込みに使えるか（近すぎると精度が出ない）。 */
export const canCalibrate = (p1: Point, p2: Point): boolean =>
  imageDistancePx(p1, p2) >= UNDERLAY_MIN_CALIB_PX;

/**
 * 2 点と実寸から、拡大率と回転を出す (= 位置は決まらない)。
 * 値は一切丸めない（丸めると最初から誤差が入る）。
 */
export function calibrateFromTwoPoints(
  p1: Point, p2: Point, realMm: number, orientation?: CalibOrientation,
): { scale: number; rotationDeg: number; orientation: CalibOrientation } | null {
  const px = imageDistancePx(p1, p2);
  if (!(px > 0) || !(realMm > 0)) return null;
  const o = orientation ?? guessOrientation(p1, p2);
  return {
    // 画像 1px あたりのグリッド数。realMm/10 がグリッド数。
    scale: realMm / GRID_UNIT_MM / px,
    rotationDeg: calibrationRotationDeg(p1, p2, o),
    orientation: o,
  };
}

// ============================================================
// 位置合わせ
// ============================================================

/**
 * 「画像上のこの点を、グリッドのここへ置く」から原点を決める。
 * 拡大率と回転が決まったあとの平行移動ぶん。丸めない。
 */
export function originForAnchor(
  imagePoint: Point, gridTarget: Point, scale: number, rotationDeg: number,
): Point {
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const x = imagePoint.x * scale, y = imagePoint.y * scale;
  return {
    x: gridTarget.x - (x * cos - y * sin),
    y: gridTarget.y - (x * sin + y * cos),
  };
}

/** 背景をドラッグしたぶん、原点をずらす。 */
export const translateTransform = (t: UnderlayTransform, dGrid: Point): UnderlayTransform => ({
  ...t,
  originGrid: { x: t.originGrid.x + dGrid.x, y: t.originGrid.y + dGrid.y },
});

// ============================================================
// 精度の確認
// ============================================================

/** グリッドの主線の間隔（グリッド）。1000mm ごと＝通り芯を合わせる目安。 */
export const GRID_MAJOR_STEP = 100;

/** いちばん近い主線の交点。 */
export function nearestMajorIntersection(p: Point): Point {
  return {
    x: Math.round(p.x / GRID_MAJOR_STEP) * GRID_MAJOR_STEP,
    y: Math.round(p.y / GRID_MAJOR_STEP) * GRID_MAJOR_STEP,
  };
}

/**
 * 3 点目の確認 (= 合わせたあと、反対側でどれだけずれているか)。
 * 画像上の点（通り芯の交点など）を渡すと、いちばん近いグリッド交点からの
 * ずれを mm で返す。写真の歪みや読み取り誤差は片側が合っても反対側に出るので、
 * これが「使えるか撮り直しか」の判断材料になる。
 */
export function misalignmentMm(
  imagePoint: Point, t: UnderlayTransform,
): { atGrid: Point; nearest: Point; dxMm: number; dyMm: number; distanceMm: number } {
  const atGrid = imageToGrid(imagePoint, t);
  const nearest = nearestMajorIntersection(atGrid);
  const dxMm = (atGrid.x - nearest.x) * GRID_UNIT_MM;
  const dyMm = (atGrid.y - nearest.y) * GRID_UNIT_MM;
  return { atGrid, nearest, dxMm, dyMm, distanceMm: Math.hypot(dxMm, dyMm) };
}

/**
 * 2 点の間隔から、図面の反対側での誤差を見積もる(mm)。
 *
 * 角度誤差はおよそ e/L(ラジアン)。基準点から spanMm 離れた場所では
 * spanMm × e/L のずれになる。「もっと離して選んだ方がいい」を数字で示すのに使う。
 */
export function estimatedErrorMm(
  calibDistancePx: number, spanMm: number, clickErrorPx = UNDERLAY_CLICK_ERROR_PX,
): number {
  if (!(calibDistancePx > 0)) return Infinity;
  return (spanMm * clickErrorPx) / calibDistancePx;
}

/** 画像の対角の実寸(mm)＝「図面の反対側」の目安。 */
export function imageSpanMm(widthPx: number, heightPx: number, scale: number): number {
  return Math.hypot(widthPx, heightPx) * scale * GRID_UNIT_MM;
}

// ============================================================
// 画像の縮小（判定だけ・実際の縮小はブラウザ側）
// ============================================================

/**
 * 保存する大きさ。長辺が上限を超えていたら、比を保って縮める。
 * 縮小はアップロードの**前に**ブラウザで行う（通信量と待ち時間を抑えるため）。
 */
export function fitToMaxLongEdge(
  widthPx: number, heightPx: number, maxLongEdge = UNDERLAY_MAX_LONG_EDGE_PX,
): { width: number; height: number; scaled: boolean } {
  const long = Math.max(widthPx, heightPx);
  if (long <= maxLongEdge || long <= 0) {
    return { width: widthPx, height: heightPx, scaled: false };
  }
  const r = maxLongEdge / long;
  return {
    width: Math.max(1, Math.round(widthPx * r)),
    height: Math.max(1, Math.round(heightPx * r)),
    scaled: true,
  };
}

/** 濃さを範囲へ収める。 */
export const clampOpacity = (v: number): number => {
  if (!Number.isFinite(v)) return UNDERLAY_DEFAULT_OPACITY;
  return Math.min(UNDERLAY_MAX_OPACITY, Math.max(UNDERLAY_MIN_OPACITY, v));
};

/**
 * 画面に表示した画像の上でのクリックを、**元の画像の px** に直す。
 * モーダルでは画像を縮めて表示するので、そのままの座標では合わせ込みがずれる。
 */
export function displayedToImagePx(
  clientX: number, clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  naturalWidth: number, naturalHeight: number,
): Point | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * naturalWidth,
    y: ((clientY - rect.top) / rect.height) * naturalHeight,
  };
}

/** 画像 px → 表示中の画像の中での位置(%)。打った点の印を出すのに使う。 */
export function imagePxToDisplayPercent(
  p: Point, naturalWidth: number, naturalHeight: number,
): { left: number; top: number } {
  return {
    left: naturalWidth > 0 ? (p.x / naturalWidth) * 100 : 0,
    top: naturalHeight > 0 ? (p.y / naturalHeight) * 100 : 0,
  };
}

// ============================================================
// 保存する場所
// ============================================================

/**
 * Storage のパス (= U-1)。
 *   1 段目 projectId … **RLS の判定**（その物件の持ち主か）と、物件削除の一括削除
 *   2 段目 drawingId … ページ削除の一括削除
 *
 * 先頭をユーザー ID ではなく物件 ID にしてあるのが要点。RLS は projects テーブルへ
 * 問い合わせて「その物件の持ち主か」を見るので、**持ち主が変わっても会社共有を
 * 入れても、ポリシーが自動的に追従する**。ユーザー ID をパスに埋めると、その時点の
 * 持ち主が固定されてしまう。
 *
 * canvasData が持つのはこのパスだけで、公開 URL は持たない
 * （他社の図面＝機密情報。表示は認証つきで取得した Blob から作る）。
 */
export function underlayStoragePath(
  projectId: string, drawingId: string, underlayId: string, ext: string,
): string {
  return `${projectId}/${drawingId}/${underlayId}.${ext}`;
}

/** その物件ぶんをまとめて消すときのプレフィックス。 */
export const underlayProjectPrefix = (projectId: string): string => projectId;

/** そのページぶんをまとめて消すときのプレフィックス。 */
export const underlayDrawingPrefix = (projectId: string, drawingId: string): string =>
  `${projectId}/${drawingId}`;

/** 画像のファイル名から拡張子を決める（許すのは JPEG と PNG だけ）。 */
export function underlayExtFor(mimeType: string): 'jpg' | 'png' | null {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  return null;
}
