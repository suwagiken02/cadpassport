// ============================================================
// 下図の画像を表示できる形にする (= U-1)・ブラウザ専用
//
// ■ Blob URL の作り所と解放（(a)）
//   作る … ここ（loadUnderlayImage の中）で 1 回だけ
//   解放 … LruCache からあふれたとき・差し替えたとき・作図画面を離れたとき
//   作りっぱなしにすると、ページを切り替えるたびに数 MB ずつ積み上がる。
//
// ■ ページを開くたびに取り直すか（(b)）
//   取り直さない。直近 3 枚を取っておいて使い回す（ページを行き来しても再取得なし）。
//   4 枚目を開いたら、いちばん古いものを revoke して捨てる。
//
// ■ 出力のときに読み込みが間に合わないか（(d)）
//   PNG/PDF は stage.toDataURL でその場のステージを画像化するので、読み込み中だと
//   背景の無い絵が出てしまう。whenUnderlayReady() で待ってから出力する
//   （commit 4 で出力側から呼ぶ）。
// ============================================================
import { LruCache, UNDERLAY_CACHE_SIZE, type UnderlayLoadStatus } from './imageCache';
import { downloadUnderlayObjectUrl } from './underlayStorage';

export type { UnderlayLoadStatus };

type Loaded = { url: string; image: HTMLImageElement };

/** 取っておく画像。あふれたら Blob URL を解放してから捨てる。 */
const cache = new LruCache<Loaded>(UNDERLAY_CACHE_SIZE, (_key, v) => {
  URL.revokeObjectURL(v.url);
});

/** 取得中のもの（同じパスを二重にダウンロードしない）。 */
const inflight = new Map<string, Promise<HTMLImageElement>>();

/** Blob URL から <img> を作る（描けるようになるまで待つ）。 */
function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

/**
 * その下図を描ける形で返す。既に持っていればそれを使い回す。
 * 失敗したら例外を投げる（呼び出し側で握りつぶし、背景だけ出さない）。
 */
export async function loadUnderlayImage(storagePath: string): Promise<HTMLImageElement> {
  const hit = cache.get(storagePath);
  if (hit) return hit.image;

  const running = inflight.get(storagePath);
  if (running) return running;

  const p = (async () => {
    const url = await downloadUnderlayObjectUrl(storagePath);
    try {
      const image = await decode(url);
      cache.set(storagePath, { url, image });
      return image;
    } catch (e) {
      // 読めなかった URL は即座に解放する（帳簿に載らないので誰も解放しない）
      URL.revokeObjectURL(url);
      throw e;
    }
  })();
  inflight.set(storagePath, p);
  try {
    return await p;
  } finally {
    inflight.delete(storagePath);
  }
}

/** もう持っているか（同期で欲しいとき）。 */
export const getCachedUnderlayImage = (storagePath: string): HTMLImageElement | null =>
  cache.get(storagePath)?.image ?? null;

/**
 * 出力の直前に呼ぶ (= (d))。読み込み中なら待ち、失敗しても投げない
 * （背景が出ないだけで、出力そのものは通す）。
 */
export async function whenUnderlayReady(storagePath: string | undefined): Promise<void> {
  if (!storagePath) return;
  try {
    await loadUnderlayImage(storagePath);
  } catch {
    // 背景なしで出力する。ここで投げると出力そのものが失敗してしまう。
  }
}

/** 1 枚捨てる（画像を差し替えたとき）。 */
export const forgetUnderlayImage = (storagePath: string): void => cache.delete(storagePath);

/** 全部捨てる（作図画面を離れるとき）。 */
export const clearUnderlayImages = (): void => cache.clear();

/** いま取っておいているパス（診断用）。 */
export const cachedUnderlayPaths = (): string[] => cache.keys();
