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

describe('姿図の枠は 1 つ（手摺・階段・単管で共有）', () => {
  it('枠は掴める（onPointerDown を必ず持つ）', () => {
    const drag = () => {};
    const props = svgOf(h(PalettePreviewFrame, { onDragOut: drag, children: null }));
    expect(props.onPointerDown).toBe(drag);
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
  it('階段の姿図にドラッグ開始が渡っている', () => {
    const drag = () => {};
    expect(svgOf(h(StairPreview, { angleDeg: 90, flip: true, onDragOut: drag })).onPointerDown)
      .toBe(drag);
  });

  it('単管の姿図にドラッグ開始が渡っている', () => {
    const drag = () => {};
    expect(svgOf(h(PipePreview, { lengthMm: 6000, angleDeg: 45, onDragOut: drag })).onPointerDown)
      .toBe(drag);
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
