// ============================================================
// 部材の角度指定 (E-8-v3c-fix4・pure・node 安全)
//
// 平面の部材パレット（手摺の向き）と立面の部材パレットで、**同じプリセット・同じ刻み**を
// 使うための 1 箇所。平面が先にあった実装をここへ出し、立面はこれを読む
// （鮎澤氏方針: 立面が先行実装でも、平面と流儀を必ず揃える）。
//
// 角度の意味は「その部材の自然な向きからの回転(度)」。平面の手摺は横=0/縦=90、
// 立面は手摺・踏板が水平=0、支柱・ジャッキが垂直=0。どちらも正で反時計回り。
// ============================================================

/** 平面の手摺は 横/縦 という言い方も使うので、数値と併存させる。 */
export type AngleValue = number | 'horizontal' | 'vertical';

export const ANGLE_PRESETS: { label: string; value: AngleValue }[] = [
  { label: '横', value: 'horizontal' as const },
  { label: '縦', value: 'vertical' as const },
  { label: '15°', value: 15 },
  { label: '30°', value: 30 },
  { label: '45°', value: 45 },
  { label: '60°', value: 60 },
  { label: '75°', value: 75 },
];

/**
 * 単管のプリセット (= P-1-fix9)。単管は火打ち（斜めの補強材）として使うことが多い。
 *
 * 手摺と違い、単管は**置いた点から伸びる**ので、45° と 225° は同じ傾きでも
 * 伸びる向きが逆になる。四隅どちらへも伸ばせないと火打ちが組めないので、
 * 斜めは 4 方向すべて出す（15/30/60/75 は実務で使わないので落とす）。
 * プリセット以外の角度は数値入力と ±ボタンで作れる。
 */
export const PIPE_ANGLE_PRESETS: { label: string; value: AngleValue }[] = [
  { label: '横', value: 'horizontal' as const },
  { label: '縦', value: 'vertical' as const },
  { label: '45°', value: 45 },
  { label: '135°', value: 135 },
  { label: '225°', value: 225 },
  { label: '315°', value: 315 },
];

/** 立面のプリセット（度）。横=0・縦=90 として同じ並びを数値で持つ。 */
export const ANGLE_PRESET_DEGS: { label: string; deg: number }[] =
  ANGLE_PRESETS.map((p) => ({ label: p.label, deg: angleToDeg(p.value) }));

/**
 * 部材の「自然な向き」に合わせてプリセットのラベルを読み替える (= E-8-v3c-fix4)。
 * 角度は自然な向きからの回転なので、支柱・ジャッキ（自然な向き＝縦）では 0°が縦・90°が横。
 * 数値（deg）は共通のまま＝並びもボタン位置も平面と同じ。
 */
export function anglePresetsForNatural(
  natural: 'horizontal' | 'vertical',
): { label: string; deg: number }[] {
  if (natural === 'horizontal') return ANGLE_PRESET_DEGS;
  return ANGLE_PRESET_DEGS.map((p) => (
    p.deg === 0 ? { label: '縦', deg: 0 } : p.deg === 90 ? { label: '横', deg: 90 } : p
  ));
}

/** 微調整ボタンの刻み（左から順に並べる）。 */
export const ANGLE_STEPS = [-10, -1, 1, 10] as const;

/** 横/縦 を度に直す。 */
export function angleToDeg(v: AngleValue): number {
  if (v === 'horizontal') return 0;
  if (v === 'vertical') return 90;
  return v;
}

/** 角度を (-180, 180] に畳む。-370° や 400° のような値をボタン連打で作らないため。 */
export function normalizeAngleDeg(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Object.is(d, -0) ? 0 : d;
}

/** 微調整ボタン。現在値に delta を足して畳む。 */
export function stepAngle(cur: number, delta: number): number {
  return normalizeAngleDeg(cur + delta);
}

/**
 * 姿図プレビュー用の線分（平面パレットの 80×80 の枠）。
 * 立面は実部材の primitives を描く（elevationPartPreview）ので、こちらは平面専用。
 */
export function getAnglePreviewPoints(angle: AngleValue) {
  const W = 80, H = 80;
  const cx = W / 2, cy = H / 2;
  const len = 30;
  let dx = len, dy = 0;
  if (angle === 'vertical') { dx = 0; dy = len; }
  else if (typeof angle === 'number') {
    const rad = angle * Math.PI / 180;
    dx = Math.cos(rad) * len;
    dy = Math.sin(rad) * len;
  }
  return { W, H, cx, cy, dx, dy };
}
