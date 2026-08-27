'use client';

// ============================================================
// 立面の部材パレット (E-8-v3c-fix / 姿図・角度は fix4)
//
// 入口を 1 つにするため、立面タップで出るバー(ElevationEditBar)と
// 画面下の「部材」メニュー(PartSelector)の**両方がこの同じコンポーネント**を出す。
// 中身も見た目も完全に同一なので、どちらから開いても迷わない。
//
// 構成は平面の部材パレットに合わせる (= E-8-v3c-fix4):
//   [種類] → [姿図プレビュー ＋ 角度（プリセット・数値・微調整）] → [長さ・向き]
// 姿図は「実際に置かれる部材の絵」そのもの（ElevationPartPreview）。
//
// 操作（平面の部材配置と同じ流儀・placementInput が判定）:
//   ・マウス … 選ぶとシャドーがカーソルに追従し、クリックで置く（連続配置可）
//   ・指     … パレットのボタン／姿図を掴んだままキャンバスへ引き出し、離した位置に置く
// 置ける場所の制限（ゴーストの許可位置）は無い。接合が近ければ吸着する。
// ============================================================
import React, { useEffect, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  AID_PALETTE_KINDS, DEFAULT_ELEVATION_PART_KIND, PALETTE_KINDS,
} from '@/lib/konva/elevation/elevationSlots';
import { isDrawingAid } from '@/lib/konva/elevation/elevationParts';
import {
  POST_KOMA_CHOICES, SPAN_LENGTH_CHOICES_MM, type ElevationPartKind,
} from '@/lib/konva/elevation/elevationParts';
import {
  defaultPlacementMode, isKeyboardClick, placementModeForPointer, startPaletteDragOut,
  type PlacementMode,
} from '@/lib/konva/placement/placementInput';
import {
  ANGLE_STEPS, anglePresetsForNatural, normalizeAngleDeg, stepAngle,
} from '@/lib/konva/placement/anglePresets';
import ElevationPartPreview from './ElevationPartPreview';
import NumInput from '@/components/ui/NumInput';

/** パレットの部材名。 */
const PART_LABEL: Record<ElevationPartKind, string> = {
  post: '支柱', postExt: '支柱延長', jack: 'ジャッキ', board: '踏板',
  rail: '手摺', raiseBoard: '嵩上げ床', raiseRail: '嵩上げ手摺', brace: '筋交',
  // E-8-v5c: 作図の補助（部材ではない）。パレットに出すかは PALETTE_KINDS 側で決める。
  line: '線', point: '点',
};

export default function ElevationPartPalette({ showText = true }: { showText?: boolean }) {
  const addTool = useCanvasStore((s) => s.elevationAddTool);
  const addSize = useCanvasStore((s) => s.elevationAddSize);
  const addFlip = useCanvasStore((s) => s.elevationAddFlip);
  const addAngle = useCanvasStore((s) => s.elevationAddAngle);
  /** 入力方式。マウス=シャドー追従+クリック / 指=パレットから引き出して離す。 */
  const [inputMode, setInputMode] = useState<PlacementMode>('hover-click');
  useEffect(() => { setInputMode(defaultPlacementMode()); }, []);

  /**
   * 開いた時点で「手摺」を選んでおく (= E-8-v5c)。
   * 「何も選ばれていない段階」は要らない（鮎澤氏）。長さ・角度・姿図も手摺の
   * 既定値で出るので、開いてすぐ置ける。
   * 開いたときの 1 回だけ。ユーザーが自分で解除したら解除のまま（再選択しない）。
   */
  useEffect(() => {
    const s = useCanvasStore.getState();
    if (!s.elevationAddTool) s.setElevationAddTool(DEFAULT_ELEVATION_PART_KIND);
  }, []);

  /** パレットのボタンを掴んでキャンバスへ引き出す（平面と共通の受け口）。 */
  const startDragOut = (kind: ElevationPartKind, e: React.PointerEvent) => {
    useCanvasStore.getState().setElevationAddTool(kind);
    setInputMode(placementModeForPointer(e.pointerType));
    startPaletteDragOut({
      from: { clientX: e.clientX, clientY: e.clientY },
      onDrop: (p) => useCanvasStore.getState().setElevationDropAt(p),
    });
  };

  /**
   * 部材ボタンを押したとき (= E-8-v3c-fix6)。
   *
   * 事故: 選択(setElevationAddTool)を pointerdown と click の**両方**が持っていたため、
   *   1 回のクリックで「pointerdown で選ぶ → click で同じ種類なので解除」となり、
   *   姿図・角度・長さの行が一瞬で消えた（実機では「パネルが閉じる」と見えた。
   *   押しっぱなしの間は click が来ないので正しく出たまま＝症状の説明がつく）。
   * 対策: 押した時点(pointerdown)だけが選択を持つ。同じ種類をもう一度押したら解除。
   */
  const onKindDown = (kind: ElevationPartKind, e: React.PointerEvent) => {
    if (useCanvasStore.getState().elevationAddTool === kind) {
      useCanvasStore.getState().setElevationAddTool(null);   // 2 回目＝選択解除
      return;
    }
    startDragOut(kind, e);
  };
  /** キーボード操作(Enter/Space)だけを拾う click。ポインタ由来(detail>0)は pointerdown 側で処理済み。 */
  const onKeyboardClick = (e: React.MouseEvent, run: () => void) => {
    if (!isKeyboardClick(e.detail)) return;
    run();
  };

  const isPost = addTool === 'post' || addTool === 'postExt';
  const sizes = isPost
    ? POST_KOMA_CHOICES.map((k) => ({ value: k as number, label: `${k}` }))
    : SPAN_LENGTH_CHOICES_MM.map((l) => ({ value: l as number, label: `${l}` }));
  /** 姿図・角度・長さを出すのは部材のときだけ（文字は別物）。 */
  const part = addTool && addTool !== 'text' ? (addTool as ElevationPartKind) : null;
  const setAngle = (v: number) => useCanvasStore.getState().setElevationAddAngle(normalizeAngleDeg(v));
  const btn = (on: boolean) => `px-2 py-1 rounded-lg text-[11px] font-bold border ${
    on ? 'bg-accent text-white border-accent' : 'bg-dark-bg border-dark-border text-dimension'}`;

  return (
    <>
      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <span className="text-[10px] text-dimension mr-1">部材</span>
        {PALETTE_KINDS.map((k) => (
          <button key={k} type="button"
            onPointerDown={(e) => onKindDown(k, e)}
            onClick={(e) => onKeyboardClick(e, () =>
              useCanvasStore.getState().setElevationAddTool(addTool === k ? null : k))}
            className={btn(addTool === k)}>
            {PART_LABEL[k]}
          </button>
        ))}
        {/* E-8-v5c: 作図の補助（部材ではないので区切って並べる）。 */}
        <span className="mx-1 w-px self-stretch bg-dark-border" aria-hidden />
        {AID_PALETTE_KINDS.map((k) => (
          <button key={k} type="button"
            // 部材ボタンと同じ作法。補助線は引き出し（ドラッグ）では置かず
            // 2 クリックで引くので、押した時点で選ぶだけにする。
            onPointerDown={() => useCanvasStore.getState()
              .setElevationAddTool(addTool === k ? null : k)}
            onClick={(e) => onKeyboardClick(e, () =>
              useCanvasStore.getState().setElevationAddTool(addTool === k ? null : k))}
            className={btn(addTool === k)}>
            {PART_LABEL[k]}
          </button>
        ))}
        {showText && (
          <button type="button"
            onClick={() => useCanvasStore.getState().setElevationAddTool(addTool === 'text' ? null : 'text')}
            className={btn(addTool === 'text')}>
            文字
          </button>
        )}
        {part && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">
            {inputMode === 'drag-drop' ? 'パレットから引き出して離す' : '置きたい位置をクリック'}
          </span>
        )}
        {addTool === 'text' && (
          <span className="text-[10px] text-accent ml-1 whitespace-nowrap">位置をタップ</span>
        )}
      </div>

      {/* 姿図（掴んで引き出せる）＋ 角度。平面パレットと同じ並び。 */}
      {part && (
        <div className="flex items-start gap-2 mb-2">
          <ElevationPartPreview
            kind={part}
            sizeMm={isPost ? undefined : addSize}
            komaCount={isPost ? addSize : undefined}
            flip={addFlip}
            angleDeg={addAngle}
            className="bg-dark-bg rounded-lg border border-dark-border cursor-grab active:cursor-grabbing select-none shrink-0"
            onPointerDown={(e) => startDragOut(part, e)}
          />
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex gap-1 flex-wrap">
              <span className="text-[10px] text-dimension self-center mr-1">角度</span>
              {anglePresetsForNatural(isPost || part === 'jack' ? 'vertical' : 'horizontal').map((p) => (
                <button key={p.label} type="button" onClick={() => setAngle(p.deg)}
                  className={btn(addAngle === p.deg)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 flex-wrap">
              <NumInput
                value={addAngle}
                onChange={(v) => setAngle(v)}
                className="w-16 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono"
              />
              <span className="text-[10px] text-dimension mr-1">°</span>
              {ANGLE_STEPS.map((d) => (
                <button key={d} type="button" onClick={() => setAngle(stepAngle(addAngle, d))}
                  className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-dark-bg border-dark-border text-dimension">
                  {d > 0 ? `+${d}°` : `${d}°`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 長さ（支柱＝コマ数／手摺・踏板・筋交＝標準スパン）と、筋交の向き。
          E-8-v5c: 補助線は起点→終点で引くので長さの指定は要らない。 */}
      {part && part !== 'jack' && !isDrawingAid(part) && (
        <div className="flex items-center gap-1 mb-2 flex-wrap">
          <span className="text-[10px] text-dimension mr-1">{isPost ? '長さ(コマ)' : '長さ(mm)'}</span>
          {sizes.map(({ value, label }) => (
            <button key={value} type="button"
              onPointerDown={(e) => {
                useCanvasStore.getState().setElevationAddSize(value);
                startDragOut(part, e);
              }}
              onClick={(e) => onKeyboardClick(e, () =>
                useCanvasStore.getState().setElevationAddSize(value))}
              className={btn(addSize === value)}>
              {label}
            </button>
          ))}
          {isPost && <span className="text-[10px] text-dimension ml-1">＝{addSize * 450}mm</span>}
          {part === 'brace' && (
            <button type="button"
              onClick={() => useCanvasStore.getState().toggleElevationAddFlip()}
              className="px-2 py-1 rounded-lg text-[11px] font-bold border bg-dark-bg border-dark-border text-dimension ml-1">
              向き {addFlip ? '↖' : '↗'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
