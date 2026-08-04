// ============================================================
// パレットからの部材配置: 入力方式の判定と受け口 (E-8-v3c-2・汎用)
//
// 立面(E-8-v3)で先行実装した「PC=シャドー追従＋クリック / スマホ=ドラッグ&ドロップ」を、
// 将来そのまま平面(PartSelector・ScaffoldLayer)へ展開するための共通部分。
// ここには「どちらの入力方式か」と「パレットから引き出して離した位置」だけを置き、
// 座標の意味づけ（グリッドか mm か、どの図のローカルか）は呼び出し側に残す。
//
// 依存は DOM のみ（Konva も React も見ない）。node のテストから使えるよう、
// 判定はすべて pure 関数に分けてある。
// ============================================================

/**
 * 部材配置の入力方式。
 *  ・hover-click … カーソルにシャドーが追従し、クリックで置く（マウス。連続配置向き）
 *  ・drag-drop   … パレットから指で引き出し、離した位置に置く（タッチ）
 */
export type PlacementMode = 'hover-click' | 'drag-drop';

/** ポインタ種別から入力方式を決める。pointerType は PointerEvent のもの。 */
export function placementModeForPointer(pointerType?: string): PlacementMode {
  return pointerType === 'touch' || pointerType === 'pen' ? 'drag-drop' : 'hover-click';
}

/**
 * いまの端末の既定の入力方式。粗いポインタ（指）だけの端末はドラッグ&ドロップ。
 * マウスとタッチの両方を持つ端末は hover-click を既定にし、実際に指で触れたときは
 * placementModeForPointer 側が drag-drop に倒す（どちらでも操作できる）。
 */
export function defaultPlacementMode(): PlacementMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'hover-click';
  const fine = window.matchMedia('(any-pointer: fine)').matches;
  return fine ? 'hover-click' : 'drag-drop';
}

/** 点が矩形の中か（キャンバス上で離したかの判定）。 */
export function isInsideRect(
  p: { clientX: number; clientY: number },
  r: { left: number; top: number; right: number; bottom: number } | null | undefined,
): boolean {
  if (!r) return false;
  return p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom;
}

/** 掴んでから離すまでに動いたか（動いていなければ「ボタンを押しただけ」＝選択のみ）。 */
export function movedEnough(
  from: { clientX: number; clientY: number },
  to: { clientX: number; clientY: number },
  thresholdPx = 6,
): boolean {
  return Math.hypot(to.clientX - from.clientX, to.clientY - from.clientY) >= thresholdPx;
}

/**
 * キーボード由来の click か (= E-8-v3c-fix6)。MouseEvent.detail はクリック回数で、
 * Enter / Space で押したときだけ 0 になる。
 *
 * パレットのボタンは「押した時点(pointerdown)」で選択と引き出しを始める。click にも
 * 同じ処理を持たせると 1 回のクリックで 2 回動き（選択 → 同じ種類なので解除）、
 * 実機では「押した途端に選択が消える／パネルが畳まれる」になる。
 * click 側はキーボード操作のぶんだけを拾う。
 */
export function isKeyboardClick(detail: number): boolean {
  return detail === 0;
}

export type PaletteDragOutOptions = {
  /** 掴んだ位置（pointerdown のクライアント座標）。 */
  from: { clientX: number; clientY: number };
  /** ドロップ先の要素（既定は Konva のキャンバス）。 */
  targetSelector?: string;
  /** ドラッグと見なす移動量(px)。 */
  thresholdPx?: number;
  /** キャンバス上で離したとき。ここで実際の配置を行う。 */
  onDrop: (p: { clientX: number; clientY: number }) => void;
  /** キャンバス外（パレットへ戻す等）で離したとき＝取り消し。 */
  onCancel?: () => void;
  /** ドラッグ中の位置（シャドーを DOM 側で出したいとき用）。 */
  onMove?: (p: { clientX: number; clientY: number }) => void;
};

/**
 * パレットのボタンを掴んでキャンバスへ引き出す操作を受ける (= 平面の部材配置と同じ流儀)。
 * pointerdown のハンドラから呼ぶ。後始末（listener の解除）は自分で行う。
 */
export function startPaletteDragOut(opts: PaletteDragOutOptions): () => void {
  const threshold = opts.thresholdPx ?? 6;
  const selector = opts.targetSelector ?? '.konvajs-content';
  let moved = false;

  const onMove = (e: PointerEvent) => {
    const at = { clientX: e.clientX, clientY: e.clientY };
    if (!moved && movedEnough(opts.from, at, threshold)) moved = true;
    if (moved) opts.onMove?.(at);
  };
  const onUp = (e: PointerEvent) => {
    cleanup();
    const at = { clientX: e.clientX, clientY: e.clientY };
    if (!moved && !movedEnough(opts.from, at, threshold)) return;   // 押しただけ＝選択のみ
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    if (isInsideRect(at, rect)) opts.onDrop(at);
    else opts.onCancel?.();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', cleanup);
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cleanup);
  return cleanup;
}

/**
 * クライアント座標 → キャンバス（ステージ）内の座標。
 * ここから先（グリッドへ／立面ローカルへ）の変換は、図ごとの都合なので呼び出し側で行う。
 */
export function clientToCanvasPoint(
  p: { clientX: number; clientY: number },
  canvasRect: { left: number; top: number } | null | undefined,
): { x: number; y: number } | null {
  if (!canvasRect) return null;
  return { x: p.clientX - canvasRect.left, y: p.clientY - canvasRect.top };
}
