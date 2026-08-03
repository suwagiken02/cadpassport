'use client';

// ============================================================
// 立面部材バー (E-8b → E-8-v2j)。
// 立面図を選択している間だけ出る操作バー。部材パレット・選択中部材の削除／元に戻す・
// 再生成で引き継げなかったものの一覧を持つ。
//
// E-8-v2j: 「編集モード」は廃止した（平面に編集モードが無いのと同じ）。
//   部材の選択・移動・削除はキャンバス上で直接おこない、ここはパレットと補助操作だけ。
//   ・部材(parts)  → 意味データそのものを足し引きする（E-8-v2）
//   ・背景(寸法線・文字など) → ElevationView.edits に差分として積む（E-8b/c）
// どちらも canvasData の履歴に乗るので undo/redo はそのまま効く。
// ============================================================
import React, { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { hasEditFor, withHide, withoutEditsFor } from '@/lib/konva/elevation/elevationEdits';
import { describeEdit } from '@/lib/konva/elevation/elevationRematch';
import { describePart } from '@/lib/konva/elevation/elevationPartsRematch';
import { withPartDeleted } from '@/lib/konva/elevation/elevationParts';
import { PALETTE_KINDS } from '@/lib/konva/elevation/elevationSlots';
import { POST_KOMA_CHOICES, SPAN_LENGTH_CHOICES_MM } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPartKind } from '@/lib/konva/elevation/elevationParts';
import type { ElevationPrimitiveKind } from '@/types';

/** パレットの部材名。 */
const PART_LABEL: Record<ElevationPartKind, string> = {
  post: '支柱', postExt: '支柱延長', jack: 'ジャッキ', board: '踏板',
  rail: '手摺', raiseBoard: '嵩上げ床', raiseRail: '嵩上げ手摺', brace: '筋交',
};

const KIND_LABEL: Record<ElevationPrimitiveKind, string> = {
  building: '建物外形', roof: '屋根', ridge: '棟', gl: 'GL',
  board: '作業床', rail: '手摺', post: '支柱', jack: 'ジャッキ', raise: '嵩上げ床',
  dim: '寸法線', dimText: '寸法値', text: '文字',
};

export default function ElevationEditBar() {
  const selectedPartId = useCanvasStore((s) => s.elevationEditSelectedId);
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addSize = useCanvasStore((s) => s.elevationAddSize);
  const addFlip = useCanvasStore((s) => s.elevationAddFlip);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);

  // 立面図を 1 つ選んでいるときだけ出す（平面の部材操作と同じで、モードは持たない）。
  const view = (mode === 'select' && selectedIds.length === 1)
    ? (views ?? []).find((v) => v.id === selectedIds[0]) ?? null
    : null;
  const viewId = view?.id ?? null;

  // E-8-v2b: 旧ビュー(parts 無し)を選んだら、その場で部材ブロックへ移行する。
  useEffect(() => {
    if (viewId) useCanvasStore.getState().ensureElevationParts(viewId);
  }, [viewId]);

  /**
   * パレットからキャンバスへのドラッグ&ドロップ (= E-8-v3c)。平面の部材配置と同じ流儀:
   * ボタンを押した指をそのままキャンバスへ引き出し、離した位置に置く。
   * 指が動かずボタン上で離した場合は onClick 側（選択だけ）に任せる。
   */
  const startDragOut = (kind: ElevationPartKind) => {
    const st = useCanvasStore.getState();
    st.setElevationAddTool(kind);
    let moved = false;
    const onMove = () => { moved = true; };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) return;                       // その場で離した＝ただの選択
      const canvas = document.querySelector('.konvajs-content');
      const r = canvas?.getBoundingClientRect();
      if (!r) return;
      const inside = e.clientX >= r.left && e.clientX <= r.right
        && e.clientY >= r.top && e.clientY <= r.bottom;
      // キャンバスの外（パレットへ戻す等）で離したらキャンセル＝置かない
      if (inside) useCanvasStore.getState().setElevationDropAt({ clientX: e.clientX, clientY: e.clientY });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Esc: パレットを閉じる → 部材の選択を外す。
  useEffect(() => {
    if (!viewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useCanvasStore.getState();
      if (s.elevationAddTool) s.setElevationAddTool(null);
      else if (s.elevationEditSelectedId) s.setElevationEditSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewId]);

  // 選択が外れたらパレットも畳む（別の図を触っているのにツールが生きていると迷う）。
  useEffect(() => {
    if (!viewId) useCanvasStore.getState().setElevationAddTool(null);
  }, [viewId]);

  if (!view || !viewId) return null;

  const selected = selectedPartId
    ? [...view.primitives, ...(view.edits ?? []).flatMap((e) => (e.op === 'add' ? [e.primitive] : []))]
      .find((p) => p.meta?.id === selectedPartId) ?? null
    : null;
  const kindLabel = selected?.meta ? KIND_LABEL[selected.meta.kind] : null;
  const edited = selectedPartId ? hasEditFor(view.edits, selectedPartId) : false;

  const remove = () => {
    if (!selectedPartId) return;
    const s = useCanvasStore.getState();
    // 部材は意味データから取り除く（自動生成分は墓標を残す）。背景は削除マーク。
    if ((view.parts ?? []).some((p) => p.id === selectedPartId)) {
      s.setElevationParts(viewId, withPartDeleted(view.parts ?? [], selectedPartId));
    } else {
      s.setElevationEdits(viewId, withHide(view.edits, selectedPartId));
    }
    s.setElevationEditSelectedId(null);
  };
  const reset = () => {
    if (!selectedPartId) return;
    useCanvasStore.getState().setElevationEdits(viewId, withoutEditsFor(view.edits, selectedPartId));
  };

  const orphans = view.orphanEdits ?? [];
  const orphanParts = view.orphanParts ?? [];

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[60] bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-3 py-2 max-w-[94vw]">
      {/* E-8-v3c: 部材パレット。種類 → 長さ の 2 段。選ぶとシャドーが指/カーソルに追従し、
          押した位置にそのまま出る（ゴーストの許可位置は廃止）。パレットのボタンを掴んだまま
          キャンバスで離す＝平面と同じドラッグ&ドロップでも置ける。 */}
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] text-dimension mr-1">部材</span>
        {PALETTE_KINDS.map((k) => (
          <button key={k} type="button"
            onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === k ? null : k)}
            onPointerDown={() => startDragOut(k)}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
              addTool === k ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
            }`}>
            {PART_LABEL[k]}
          </button>
        ))}
        <button type="button"
          onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === 'text' ? null : 'text')}
          className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
            addTool === 'text' ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
          }`}>
          文字
        </button>
        {addTool && addTool !== 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">置きたい位置をタップ</span>
        )}
        {addTool === 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">位置をタップ</span>
        )}
      </div>

      {/* E-8-v3c: 長さ（支柱＝コマ数／手摺・踏板・筋交＝標準スパン）と、筋交の向き。 */}
      {addTool && addTool !== 'text' && addTool !== 'jack' && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[10px] text-dimension mr-1">
            {addTool === 'post' || addTool === 'postExt' ? '長さ(コマ)' : '長さ(mm)'}
          </span>
          {(addTool === 'post' || addTool === 'postExt'
            ? POST_KOMA_CHOICES.map((k) => ({ value: k, label: `${k}` }))
            : SPAN_LENGTH_CHOICES_MM.map((l) => ({ value: l, label: `${l}` }))
          ).map(({ value, label }) => (
            <button key={value} type="button"
              onClick={() => useCanvasStore.getState().setElevationAddSize(value)}
              onPointerDown={() => { useCanvasStore.getState().setElevationAddSize(value); startDragOut(addTool); }}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                addSize === value ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'
              }`}>
              {label}
            </button>
          ))}
          {(addTool === 'post' || addTool === 'postExt') && (
            <span className="text-[10px] text-dimension ml-1">＝{addSize * 450}mm</span>
          )}
          {addTool === 'brace' && (
            <button type="button"
              onClick={() => useCanvasStore.getState().toggleElevationAddFlip()}
              className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-dark-bg border-dark-border text-dimension ml-1">
              向き {addFlip ? '↖' : '↗'}
            </button>
          )}
        </div>
      )}

      {/* E-8d: 再生成で引き継げなかった編集 */}
      {orphans.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-dark-bg border border-dark-border rounded-lg">
          <span className="text-[10px] text-dimension truncate max-w-[46vw]">
            引き継げなかった編集 {orphans.length} 件: {orphans.slice(0, 2).map(describeEdit).join(' / ')}
            {orphans.length > 2 ? ' …' : ''}
          </span>
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationOrphanEdits(viewId, [])}
            className="px-2 py-1 bg-dark-surface border border-dark-border rounded text-[10px] text-dimension whitespace-nowrap">
            削除
          </button>
        </div>
      )}

      {/* E-8-v2e: 作り直しで置き場所が無くなった部材（勝手に消さず一覧で提示する） */}
      {orphanParts.length > 0 && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-dark-bg border border-dark-border rounded-lg">
          <span className="text-[10px] text-dimension truncate max-w-[46vw]">
            置き場所が無くなった部材 {orphanParts.length} 件: {orphanParts.slice(0, 2).map(describePart).join(' / ')}
            {orphanParts.length > 2 ? ' …' : ''}
          </span>
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationOrphanParts(viewId, [])}
            className="px-2 py-1 bg-dark-surface border border-dark-border rounded text-[10px] text-dimension whitespace-nowrap">
            削除
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <p className="text-[11px] text-accent font-bold leading-tight">立面図</p>
          <p className="text-xs text-canvas font-bold whitespace-nowrap truncate">
            {selected
              ? `${kindLabel}を選択中${edited ? '（編集済み）' : ''}`
              : '部材をタップ（ドラッグで移動・消去ツールで削除）'}
          </p>
        </div>
        {/* E-8c: 文字(寸法値・ラベル)は上書き編集できる */}
        {selected?.kind === 'text' && (
          <button type="button" onClick={() => useCanvasStore.getState().setElevationTextEditTargetId(selectedPartId)}
            className="px-3 py-2 bg-dark-bg border border-accent text-accent font-bold rounded-lg text-xs whitespace-nowrap">
            文字を編集
          </button>
        )}
        <button type="button" onClick={remove} disabled={!selectedPartId}
          className="px-3 py-2 bg-red-500 text-white font-bold rounded-lg text-xs whitespace-nowrap disabled:opacity-40">
          削除
        </button>
        <button type="button" onClick={reset} disabled={!edited}
          className="px-2 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-dimension whitespace-nowrap disabled:opacity-40">
          元に戻す
        </button>
      </div>
    </div>
  );
}
