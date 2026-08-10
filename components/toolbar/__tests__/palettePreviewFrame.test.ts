// ============================================================
// P-1-fix5: 姿図を掴んでキャンバスへ引き出せること（階段・単管も手摺と同じ）。
//
// 事故の形: 「姿図は出ているのに掴めない」。ドラッグ開始の配線を部材ごとに
// 書いていると、片方だけ付け忘れ・直し忘れが起きる。
// 枠（PalettePreviewFrame）を 1 つにして、そこが必ず onPointerDown を持つ形にした。
// ここではその枠と、各部材の姿図が枠にドラッグを渡していることを固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import React from 'react';
import fs from 'fs';
import path from 'path';
import PalettePreviewFrame, {
  PREVIEW_FRAME_CLASS, PREVIEW_FRAME_SIZE,
} from '../PalettePreviewFrame';
import { PipePreview, StairPreview } from '../PlanePartPreview';
import { getAnglePreviewPoints } from '@/lib/konva/placement/anglePresets';

const h = React.createElement;

/** 関数コンポーネントを 1 段だけ実行する。 */
function renderOnce(element: React.ReactElement): unknown {
  const el = element as unknown as { type: unknown; props: Record<string, unknown> };
  return typeof el.type === 'function'
    ? (el.type as (p: unknown) => React.ReactElement)(el.props)
    : element;
}

/** 最初に出てくる svg 要素（枠）。 */
function svgOf(element: React.ReactElement): Record<string, unknown> {
  let node: unknown = element;
  for (let i = 0; i < 5; i++) {
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (el?.type === 'svg') return el.props ?? {};
    node = renderOnce(node as React.ReactElement);
  }
  throw new Error('svg が見つからない');
}

/** pointerdown を起こす（capture 呼び出しを記録する偽イベント）。 */
function firePointerDown(props: Record<string, unknown>, pointerId = 7) {
  const captured: number[] = [];
  const e = {
    pointerId,
    currentTarget: { setPointerCapture: (id: number) => { captured.push(id); } },
  };
  (props.onPointerDown as (ev: unknown) => void)(e);
  return { captured, e };
}

describe('姿図の枠は 1 つ（手摺・階段・単管で共有）', () => {
  it('枠は掴める（onPointerDown を必ず持つ）', () => {
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: () => {}, children: null }));
    expect(typeof props.onPointerDown).toBe('function');
  });

  it('掴んだらポインタを捕まえる（要素の外へ出ても切れない）', () => {
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: () => {}, children: null }));
    expect(firePointerDown(props, 42).captured).toEqual([42]);
  });

  it('捕まえたうえで、ドラッグ開始の処理も必ず呼ぶ', () => {
    const seen: unknown[] = [];
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: (ev: unknown) => seen.push(ev), children: null }));
    const { captured, e } = firePointerDown(props);
    expect(captured).toHaveLength(1);
    expect(seen).toEqual([e]);
  });

  it('捕獲に失敗する環境でもドラッグ開始は止めない', () => {
    const seen: unknown[] = [];
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: (ev: unknown) => seen.push(ev), children: null }));
    const e = {
      pointerId: 1,
      currentTarget: { setPointerCapture: () => { throw new Error('unsupported'); } },
    };
    expect(() => (props.onPointerDown as (ev: unknown) => void)(e)).not.toThrow();
    expect(seen).toEqual([e]);
  });

  it('掴めない姿図（onDragOut 無し）には何も付けない', () => {
    expect(svgOf(h(PalettePreviewFrame, { children: null })).onPointerDown).toBeUndefined();
  });

  it('枠の見た目・大きさ・タッチ設定は手摺のものそのまま', () => {
    const props = svgOf(h(PalettePreviewFrame, { children: null }));
    expect(props.className).toBe(PREVIEW_FRAME_CLASS);
    expect(props.width).toBe(PREVIEW_FRAME_SIZE);
    expect(props.height).toBe(PREVIEW_FRAME_SIZE);
    // 指で掴んだときにスクロールへ持っていかれない
    expect(props.style).toEqual({ touchAction: 'none' });
  });

  it('枠の大きさは手摺の姿図(getAnglePreviewPoints)と同じ', () => {
    expect(PREVIEW_FRAME_SIZE).toBe(getAnglePreviewPoints(0).W);
  });

  it('手摺は viewBox を持たない（属性ごと出さない＝従来の出力と同じ）', () => {
    expect('viewBox' in svgOf(h(PalettePreviewFrame, { children: null }))).toBe(false);
  });

  it('階段・単管は描画座標系の viewBox を持つ', () => {
    expect(svgOf(h(StairPreview, {})).viewBox).toMatch(/^[-\d. ]+$/);
    expect(svgOf(h(PipePreview, { lengthMm: 2000 })).viewBox).toMatch(/^[-\d. ]+$/);
  });
});

describe('階段・単管の姿図も掴める', () => {
  it('階段の姿図は掴むとポインタを捕まえ、ドラッグ開始を呼ぶ', () => {
    const seen: unknown[] = [];
    const props = svgOf(h(StairPreview, { angleDeg: 90, flip: true, onDragOut: (e: unknown) => seen.push(e) }));
    expect(firePointerDown(props, 3).captured).toEqual([3]);
    expect(seen).toHaveLength(1);
  });

  it('単管の姿図は掴むとポインタを捕まえ、ドラッグ開始を呼ぶ', () => {
    const seen: unknown[] = [];
    const props = svgOf(h(PipePreview, { lengthMm: 6000, angleDeg: 45, onDragOut: (e: unknown) => seen.push(e) }));
    expect(firePointerDown(props, 4).captured).toEqual([4]);
    expect(seen).toHaveLength(1);
  });

  it('手摺の姿図も同じ枠なので同じように捕まえる', () => {
    const seen: unknown[] = [];
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: (e: unknown) => seen.push(e), children: null }));
    expect(firePointerDown(props, 5).captured).toEqual([5]);
    expect(seen).toHaveLength(1);
  });

  it('枠は手摺と同じ（大きさ・クラス名・タッチ設定）', () => {
    for (const el of [h(StairPreview, {}), h(PipePreview, { lengthMm: 2000 })]) {
      const props = svgOf(el);
      expect(props.className).toBe(PREVIEW_FRAME_CLASS);
      expect(props.width).toBe(PREVIEW_FRAME_SIZE);
      expect(props.style).toEqual({ touchAction: 'none' });
    }
  });

  it('絵の中身は残る（枠を通しても姿図が消えない）', () => {
    const stair = renderOnce(h(StairPreview, { angleDeg: 0 })) as { props: { children: unknown[] } };
    expect(Array.isArray(stair.props.children)).toBe(true);
    expect(stair.props.children.length).toBeGreaterThan(0);
  });
});

describe('パレットの選択状態がドラッグに乗る', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../components/toolbar/PartSelector.tsx'), 'utf8',
  );

  it('階段の姿図はドラッグ開始に繋がっている', () => {
    expect(src).toMatch(/<StairPreview[^]*?onDragOut=\{handleStairDown\}/);
  });

  it('単管の姿図はドラッグ開始に繋がっている', () => {
    expect(src).toMatch(/<PipePreview[^]*?onDragOut=\{\(e\) => handlePipeDown\(pipeLengthMm, e\)\}/);
  });

  it('手摺の姿図は従来どおり（選択中の長さと角度を運ぶ）', () => {
    expect(src).toMatch(/onDragOut=\{\(e\) => handleHandrailDown\(selectedHandrailLength, handrailAngle, e\)\}/);
  });

  it('階段のドラッグは向き・上り反転を運ぶ', () => {
    expect(src).toMatch(/type: 'stair', angleDeg: stairAngle, flip: stairFlip/);
  });

  it('単管のドラッグは長さ・角度を運ぶ', () => {
    expect(src).toMatch(/type: 'pipe', lengthMm, angleDeg: pipeAngle/);
  });

  it('ドラッグ中の pointermove / pointerup は window で拾う（要素の外でも届く）', () => {
    expect(src).toMatch(/window\.addEventListener\('pointermove', onMove\)/);
    expect(src).toMatch(/window\.addEventListener\('pointerup', onUp\)/);
  });

  it('pointerleave / pointercancel でドラッグを終わらせていない', () => {
    expect(src).not.toMatch(/pointerleave/);
    // pointercancel でドラッグ状態を捨てる箇所は無い（パネル移動用は別ファイル）
    expect(src).not.toMatch(/pointercancel[^]{0,200}setToolbarDrag\(null\)/);
  });

  it('キャンバス側のドロップは階段・単管の種別を知っている', () => {
    expect(src).toMatch(/toolbarDrag\.type === 'stair'[^]*?addStair\(/);
    expect(src).toMatch(/toolbarDrag\.type === 'pipe'[^]*?addPipe\(/);
  });

  it('単管の任意長さの入力欄が、長さの並びにある', () => {
    // 角度行の下に置くと姿図に押し下げられて見えなくなる（P-1-fix6 の実機指摘）
    expect(src).toMatch(/PIPE_PRESET_LENGTHS_MM\.map[^]*?<NumInput[^]*?clampPipeLengthMm[^]*?<AnglePickerRow/);
  });

  it('姿図が枠を通さず直接 svg を書いている箇所は無い（配線の抜けを作らない）', () => {
    const preview = fs.readFileSync(
      path.resolve(__dirname, '../../../components/toolbar/PlanePartPreview.tsx'), 'utf8',
    );
    // 階段・単管の姿図は素の svg を書かず、必ず枠を通る
    expect(preview).not.toMatch(/<svg/);
    expect(preview).toMatch(/<PalettePreviewFrame/);
    // 手摺の姿図も同じ枠を通る（部材ごとに枠を書き分けない）
    expect(src).toMatch(/const handrailPreview = \(\s*<PalettePreviewFrame/);
  });
});
