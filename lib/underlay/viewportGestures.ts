// ============================================================
// 画像ビューアの入力（ホイール・ポインタ）の取り付け (= U-1 commit 3-fix2)
//
// ■ なぜ切り出したか
// 「取り付けたつもりで、実は一度も取り付いていなかった」という不具合を出した。
// 取り付けそのものを DOM から切り離しておくと、
//   ・要素がまだ無いときは何も登録されないこと
//   ・要素が現れたら登録されること
//   ・passive: false で登録すること（そうしないと preventDefault が効かない）
// を node のテストで固定できる。
//
// ■ すべて非 passive で登録する
// React の onWheel は passive として登録されるため preventDefault が効かず、
// ページごとスクロールしてしまう。ポインタも同様に、タッチでは既定の
// ジェスチャ（スクロール・ページ拡大）に取られる前に止める必要がある。
// ============================================================

/**
 * テストできるよう、必要な口だけを要求する。
 * 実際の HTMLElement もそのまま渡せるよう、ハンドラの引数は any にしてある
 * （呼び出し側で WheelLike / PointerLike に絞る）。
 */
export type GestureTarget = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addEventListener(type: string, handler: any, options?: { passive?: boolean }): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeEventListener(type: string, handler: any): void;
};

/** ホイールの 1 段。上へ回すと拡大。 */
export type WheelLike = {
  deltaY: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
};

export type PointerLike = {
  pointerId: number;
  pointerType?: string;
  clientX: number;
  clientY: number;
  preventDefault(): void;
};

export type GestureCallbacks = {
  /** 拡大・縮小（factor は 1 より大きいと拡大）。 */
  onWheelZoom(factor: number, clientX: number, clientY: number): void;
  onPointerDown(e: PointerLike): void;
  onPointerMove(e: PointerLike): void;
  onPointerEnd(e: PointerLike): void;
};

/** ホイール 1 段の倍率（拡大側）。 */
export const WHEEL_ZOOM_STEP = 1.15;

/** 取り付ける種類。ポインタは 4 つとも要る（指を離す・取り消される の両方）。 */
export const POINTER_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/**
 * ホイールとポインタを要素へ取り付ける。戻り値を呼ぶと外れる。
 *
 * **el が null なら何も登録せず、何もしない後始末を返す。**
 * 呼び出し側は「要素が現れたときに呼び直す」責任を持つ（callback ref を使う）。
 */
export function attachViewportGestures(
  el: GestureTarget | null, cb: GestureCallbacks,
): () => void {
  if (!el) return () => {};

  const onWheel = (e: WheelLike) => {
    // ページごとスクロールさせない。passive で登録すると、ここが無視される。
    e.preventDefault();
    cb.onWheelZoom(e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, e.clientX, e.clientY);
  };

  const onDown = (e: PointerLike) => {
    // タッチでは既定のジェスチャ（スクロール・ページ拡大）に取られる前に止める。
    if (e.pointerType === 'touch') e.preventDefault();
    cb.onPointerDown(e);
  };
  const onMove = (e: PointerLike) => {
    if (e.pointerType === 'touch') e.preventDefault();
    cb.onPointerMove(e);
  };
  const onEnd = (e: PointerLike) => cb.onPointerEnd(e);

  const handlers: [string, (e: never) => void][] = [
    ['wheel', onWheel as unknown as (e: never) => void],
    ['pointerdown', onDown as unknown as (e: never) => void],
    ['pointermove', onMove as unknown as (e: never) => void],
    ['pointerup', onEnd as unknown as (e: never) => void],
    ['pointercancel', onEnd as unknown as (e: never) => void],
  ];
  for (const [type, h] of handlers) el.addEventListener(type, h, { passive: false });

  return () => { for (const [type, h] of handlers) el.removeEventListener(type, h); };
}
