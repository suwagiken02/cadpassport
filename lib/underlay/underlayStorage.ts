// ============================================================
// 下図の画像の保存と取得 (= U-1)・ブラウザ専用
//
// ■ 非公開バケット ＋ SDK でダウンロード → Blob URL
// 公開 URL も署名 URL も使わない。理由は 3 つ:
//   1. 他社の建築図面＝機密情報。URL を知れば見られる状態にしない
//   2. 署名 URL は期限がある。作図は数時間に及ぶので、編集の途中で背景が消える
//   3. **PNG/PDF 出力が stage.toDataURL でステージを画像化する**方式なので、
//      別ドメインの画像を描くとキャンバスが汚染され、出力が例外で失敗する。
//      blob: は同一オリジン扱いなので汚染しない＝出力が確実に通る
//
// ■ 縮小はアップロードの前に
// 数 MB の元画像を送ってからサーバで縮めるより、通信量も待ち時間も小さい。
// ============================================================
import { supabase } from '@/lib/supabase/client';
import {
  UNDERLAY_MAX_BYTES, fitToMaxLongEdge, underlayDrawingPrefix, underlayExtFor,
  underlayProjectPrefix, underlayStoragePath,
} from '@/lib/konva/underlay';

export const UNDERLAY_BUCKET = 'underlays';

/** 縮小後の JPEG の品質。文字が潰れない程度に高め。 */
const JPEG_QUALITY = 0.92;

export type PreparedImage = {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  /** 縮小したか（実機で「縮みました」と伝えるため）。 */
  scaled: boolean;
};

/**
 * 読み込んだファイルを、保存できる形に整える（**アップロードの前**にここで縮める）。
 * 長辺が上限を超えていたら比を保って縮め、JPEG にし直す。
 */
export async function prepareUnderlayImage(file: File): Promise<PreparedImage> {
  if (file.size > UNDERLAY_MAX_BYTES) {
    throw new Error(`画像が大きすぎます（上限 ${Math.round(UNDERLAY_MAX_BYTES / 1024 / 1024)}MB）`);
  }
  if (!underlayExtFor(file.type)) {
    throw new Error('JPEG か PNG の画像を選んでください');
  }

  const bitmap = await createImageBitmap(file);
  const fit = fitToMaxLongEdge(bitmap.width, bitmap.height);
  if (!fit.scaled) {
    bitmap.close?.();
    return { blob: file, widthPx: fit.width, heightPx: fit.height, scaled: false };
  }

  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を縮小できませんでした');
  ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('画像を縮小できませんでした');
  return { blob, widthPx: fit.width, heightPx: fit.height, scaled: true };
}

/** 画像を上げて、保存したパスを返す。 */
export async function uploadUnderlay(
  projectId: string, drawingId: string, underlayId: string, prepared: PreparedImage,
): Promise<string> {
  const ext = prepared.scaled ? 'jpg' : (underlayExtFor(prepared.blob.type) ?? 'jpg');
  const path = underlayStoragePath(projectId, drawingId, underlayId, ext);
  const { error } = await supabase.storage
    .from(UNDERLAY_BUCKET)
    .upload(path, prepared.blob, { upsert: true, contentType: prepared.blob.type });
  if (error) throw error;
  return path;
}

/**
 * 画像を認証つきで取り、表示に使える Blob URL を作る。
 * **作った URL は必ず revokeObjectURL すること**（呼び出し側の帳簿が持つ）。
 */
export async function downloadUnderlayObjectUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(UNDERLAY_BUCKET).download(storagePath);
  if (error) throw error;
  if (!data) throw new Error('画像が見つかりません');
  return URL.createObjectURL(data);
}

/** 1 枚消す（画像を差し替えたときの古い実体）。 */
export async function removeUnderlayObject(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(UNDERLAY_BUCKET).remove([storagePath]);
  if (error) throw error;
}

/** そのプレフィックス配下を全部消す（物件・ページの削除）。 */
export async function removeUnderlayPrefix(prefix: string): Promise<number> {
  const { data, error } = await supabase.storage.from(UNDERLAY_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  const files = (data ?? []).filter((f) => f.id !== null).map((f) => `${prefix}/${f.name}`);
  // list は 1 階層ぶんしか返さないので、フォルダは掘り下げる
  const folders = (data ?? []).filter((f) => f.id === null).map((f) => `${prefix}/${f.name}`);
  let removed = 0;
  if (files.length > 0) {
    const { error: e2 } = await supabase.storage.from(UNDERLAY_BUCKET).remove(files);
    if (e2) throw e2;
    removed += files.length;
  }
  for (const sub of folders) removed += await removeUnderlayPrefix(sub);
  return removed;
}

/** 物件ぶんをまとめて消す。 */
export const removeUnderlaysForProject = (projectId: string): Promise<number> =>
  removeUnderlayPrefix(underlayProjectPrefix(projectId));

/** ページぶんをまとめて消す。 */
export const removeUnderlaysForDrawing = (projectId: string, drawingId: string): Promise<number> =>
  removeUnderlayPrefix(underlayDrawingPrefix(projectId, drawingId));
