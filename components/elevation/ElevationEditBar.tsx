'use client';

// ============================================================
// 立面部材パネル (E-8b → E-8-v2j → E-8-v3c-fix5)。
// 立面図を選択している間だけ出るパネル。部材パレット・選択中部材の削除／元に戻す・
// 再生成で引き継げなかったものの一覧を持つ。
//
// E-8-v2j: 「編集モード」は廃止した（平面に編集モードが無いのと同じ）。
//   部材の選択・移動・削除はキャンバス上で直接おこない、ここはパレットと補助操作だけ。
//   ・部材(parts)  → 意味データそのものを足し引きする（E-8-v2）
//   ・背景(寸法線・文字など) → ElevationView.edits に差分として積む（E-8b/c）
// どちらも canvasData の履歴に乗るので undo/redo はそのまま効く。
//
// E-8-v3c-fix5: 画面に出る立面のパネルは**常に 1 つだけ**。
//   ・「部材」メニューの立面タブが開いているときは、そちらが全部（パレット＋操作行）出す
//   ・そうでないときだけ、ここが同じ中身を出す
//   fix4 まではパレットと操作バーが別々に画面下へ出て重なり、パレットが触れなかった。
//   位置は掴んで動かせる（FloatingPanel・位置は store で入口間・再表示間で共有）。
// ============================================================
import React, { useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import FloatingPanel from '@/components/ui/FloatingPanel';
import ElevationPartPalette from './ElevationPartPalette';
import ElevationPartActions from './ElevationPartActions';

export default function ElevationEditBar() {
  const views = useCanvasStore((s) => s.canvasData.elevationViews);
  const mode = useCanvasStore((s) => s.mode);
  const selectedIds = useCanvasStore((s) => s.selectedIds);
  /** 部材メニューの立面タブが開いているときは、そちらがこのパネルを出す（二重に出さない）。 */
  const showPartSelector = useCanvasStore((s) => s.showPartSelector);
  const paletteTab = useCanvasStore((s) => s.partPaletteTab);
  const panelPos = useCanvasStore((s) => s.elevationPanelPos);

  // 立面図を 1 つ選んでいるときだけ出す（平面の部材操作と同じで、モードは持たない）。
  const view = (mode === 'select' && selectedIds.length === 1)
    ? (views ?? []).find((v) => v.id === selectedIds[0]) ?? null
    : null;
  const viewId = view?.id ?? null;

  // E-8-v2b: 旧ビュー(parts 無し)を選んだら、その場で部材ブロックへ移行する。
  useEffect(() => {
    if (viewId) useCanvasStore.getState().ensureElevationParts(viewId);
  }, [viewId]);

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
  // 「部材」メニューの立面タブが開いている＝あちらが同じパネルを出しているので、ここは出さない。
  if (showPartSelector && paletteTab === 'elevation') return null;

  return (
    <FloatingPanel
      title="立面図"
      pos={panelPos}
      onMove={(p) => useCanvasStore.getState().setElevationPanelPos(p)}
    >
      {/* E-8-v3c-fix: 画面下の「部材」メニューと同一のパレット（入口が 2 つでも中身は 1 つ）。 */}
      {!showPartSelector && <ElevationPartPalette />}
      <ElevationPartActions divider={!showPartSelector} />
    </FloatingPanel>
  );
}
