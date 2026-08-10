// ============================================================
// P-1-fix: 平面パレット（階段・単管）の姿図プレビュー。
//
// ゴールは「置く前に、何がどの向きで置かれるかがひと目で分かる」こと。
// プレビュー専用の作図はせず、キャンバスに描くのと同じ幾何関数の結果を
// 枠に収めるだけなので、ここでは「状態が絵に出ているか」を押さえる。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getAnglePreviewPoints } from '../placement/anglePresets';
import { pipePreview, stairPreview } from '../planePartPreview';
import {
  PIPE_MAX_LENGTH_MM, PIPE_PRESET_LENGTHS_MM, STAIR_TREADS,
  stairArrowGrid, stairTreadLinesGrid,
} from '../planeParts';
import { mmToGrid } from '../gridUtils';

/** 矢印の向き（単位ベクトル）。 */
const dir = (a: ReturnType<typeof stairPreview>['arrow']) => {
  const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y;
  const n = Math.hypot(dx, dy);
  return { x: dx / n, y: dy / n };
};

describe('階段: 向きが絵に出る', () => {
  it('0°/180° は縦長、90°/270° は横長になる', () => {
    for (const deg of [0, 180]) {
      const o = stairPreview({ angleDeg: deg }).outline;
      expect(o.h, `${deg}°`).toBeGreaterThan(o.w);
    }
    for (const deg of [90, 270]) {
      const o = stairPreview({ angleDeg: deg }).outline;
      expect(o.w, `${deg}°`).toBeGreaterThan(o.h);
    }
  });

  it('枠は向きによらず同じ大きさ（縦長・横長の違いが読める）', () => {
    const a = stairPreview({ angleDeg: 0 }).view;
    const b = stairPreview({ angleDeg: 90 }).view;
    expect(b.w).toBeCloseTo(a.w);
    expect(b.h).toBeCloseTo(a.h);
    // 長辺(1800mm)が枠に収まっている
    expect(a.w).toBeGreaterThanOrEqual(mmToGrid(1800));
  });

  it('外形は枠の中に収まる', () => {
    for (const deg of [0, 90, 180, 270]) {
      const { outline: o, view: v } = stairPreview({ angleDeg: deg });
      expect(o.x, `${deg}°`).toBeGreaterThanOrEqual(v.x);
      expect(o.y, `${deg}°`).toBeGreaterThanOrEqual(v.y);
      expect(o.x + o.w, `${deg}°`).toBeLessThanOrEqual(v.x + v.w);
      expect(o.y + o.h, `${deg}°`).toBeLessThanOrEqual(v.y + v.h);
    }
  });

  it('段板の区切り線が描かれる（灰色の箱だけではない）', () => {
    const p = stairPreview({ angleDeg: 0 });
    expect(p.treads).toHaveLength(STAIR_TREADS - 1);
    for (const t of p.treads) expect(t.y1).toBe(t.y2);   // 縦長なら横線
  });

  it('横向きでは段板が縦線になる', () => {
    for (const t of stairPreview({ angleDeg: 90 }).treads) expect(t.x1).toBe(t.x2);
  });

  it('上り矢印が描かれ、0° は上を向く', () => {
    const d = dir(stairPreview({ angleDeg: 0 }).arrow);
    expect(d.y).toBeLessThan(0);
    expect(d.x).toBeCloseTo(0);
  });

  it('90°/270° では矢印が横を向く', () => {
    expect(dir(stairPreview({ angleDeg: 90 }).arrow).x).toBeGreaterThan(0);
    expect(dir(stairPreview({ angleDeg: 270 }).arrow).x).toBeLessThan(0);
  });
});

describe('階段: 上り反転が絵に出る', () => {
  it('flip で矢印が逆を向く', () => {
    for (const deg of [0, 90, 180, 270]) {
      const a = dir(stairPreview({ angleDeg: deg, flip: false }).arrow);
      const b = dir(stairPreview({ angleDeg: deg, flip: true }).arrow);
      expect(b.x, `${deg}°`).toBeCloseTo(-a.x);
      expect(b.y, `${deg}°`).toBeCloseTo(-a.y);
    }
  });

  it('外形は変わらない（向きだけが入れ替わる）', () => {
    const a = stairPreview({ angleDeg: 0, flip: false }).outline;
    const b = stairPreview({ angleDeg: 0, flip: true }).outline;
    expect(b).toEqual(a);
  });
});

describe('キャンバスと同じ絵を出している（プレビュー専用の作図をしない）', () => {
  it('段板・矢印はキャンバス描画と同じ関数の結果', () => {
    for (const deg of [0, 90, 180, 270]) {
      for (const flip of [false, true]) {
        const stair = { id: 'preview', x: 0, y: 0, angleDeg: deg, flip };
        const p = stairPreview({ angleDeg: deg, flip });
        expect(p.treads, `${deg}/${flip}`).toEqual(stairTreadLinesGrid(stair));
        expect(p.arrow, `${deg}/${flip}`).toEqual(stairArrowGrid(stair));
      }
    }
  });
});

describe('単管: 長さが絵に出る', () => {
  const drawn = (lengthMm: number, angleDeg = 0) => {
    const { line: l } = pipePreview({ lengthMm, angleDeg });
    return Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
  };

  it('既製品 1〜6m が長さの違いとして見える（長いほど長い）', () => {
    const lens = PIPE_PRESET_LENGTHS_MM.map((mm) => drawn(mm));
    for (let i = 1; i < lens.length; i++) expect(lens[i]).toBeGreaterThan(lens[i - 1]);
  });

  it('長さは実寸に比例する（1m は 6m の 1/6）', () => {
    expect(drawn(1000) * 6).toBeCloseTo(drawn(6000));
  });

  it('任意長さも既製品の間の長さになる', () => {
    expect(drawn(2500)).toBeGreaterThan(drawn(2000));
    expect(drawn(2500)).toBeLessThan(drawn(3000));
  });

  it('枠は長さによらず同じ（だから長さの違いが比べられる）', () => {
    const a = pipePreview({ lengthMm: 1000 }).view;
    const b = pipePreview({ lengthMm: 6000 }).view;
    expect(b.w).toBeCloseTo(a.w);
    // 枠は最長の既製品(6m)基準
    expect(a.w).toBeGreaterThanOrEqual(mmToGrid(PIPE_MAX_LENGTH_MM));
  });

  it('どの長さ・角度でも枠に収まる', () => {
    for (const mm of PIPE_PRESET_LENGTHS_MM) {
      for (const deg of [0, 30, 45, 90, 135, 180, 270]) {
        const { line: l, view: v } = pipePreview({ lengthMm: mm, angleDeg: deg });
        for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
          expect(x, `${mm}/${deg}`).toBeGreaterThanOrEqual(v.x);
          expect(x, `${mm}/${deg}`).toBeLessThanOrEqual(v.x + v.w);
          expect(y, `${mm}/${deg}`).toBeGreaterThanOrEqual(v.y);
          expect(y, `${mm}/${deg}`).toBeLessThanOrEqual(v.y + v.h);
        }
      }
    }
  });
});

describe('既存チップ（手摺・支柱・アンチ）の見た目は変わらない', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../../components/toolbar/PartSelector.tsx'), 'utf8',
  );

  it('手摺の姿図の寸法・線は従来どおり', () => {
    expect(getAnglePreviewPoints('horizontal')).toEqual({ W: 80, H: 80, cx: 40, cy: 40, dx: 30, dy: 0 });
    expect(getAnglePreviewPoints('vertical')).toEqual({ W: 80, H: 80, cx: 40, cy: 40, dx: 0, dy: 30 });
    const a45 = getAnglePreviewPoints(45);
    expect(a45.dx).toBeCloseTo(a45.dy);
  });

  it('手摺チップの SVG はそのまま（ap の寸法・端点の丸）', () => {
    expect(src).toMatch(/width=\{ap\.W\} height=\{ap\.H\}/);
    expect((src.match(/stroke="#378ADD"/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((src.match(/fill="#378ADD"/g) ?? []).length).toBeGreaterThanOrEqual(2);  // 両端の丸
  });

  it('支柱チップはそのまま（白丸）', () => {
    expect(src).toMatch(/w-3 h-3 rounded-full bg-canvas inline-block/);
  });

  it('アンチチップはそのまま（幅ごとの色分け）', () => {
    expect(src).toMatch(/bg-amber-600 text-white border border-amber-700/);
    expect(src).toMatch(/bg-yellow-500 text-gray-900 border border-yellow-600/);
  });

  it('階段・単管の仮チップ（灰色の箱・斜線）は姿図に置き換わった', () => {
    expect(src).not.toMatch(/w-3 h-5 rounded-sm bg-gray-400/);
    expect(src).not.toMatch(/w-5 h-0\.5 bg-gray-400 rotate-45/);
    expect(src).toMatch(/<StairPreview/);
    expect(src).toMatch(/<PipePreview/);
  });
});

describe('単管: 角度が絵に出る', () => {
  const angleOf = (angleDeg?: number) => {
    const { line: l } = pipePreview({ lengthMm: 2000, angleDeg });
    return (Math.atan2(l.y2 - l.y1, l.x2 - l.x1) * 180) / Math.PI;
  };

  it('0° は水平、90° は垂直', () => {
    expect(angleOf(0)).toBeCloseTo(0);
    expect(angleOf(90)).toBeCloseTo(90);
  });

  it('既定は 45°（角度未指定でも斜めに出る）', () => {
    expect(angleOf(undefined)).toBeCloseTo(45);
  });

  it('角度を変えれば絵の傾きが変わる', () => {
    expect(angleOf(30)).toBeCloseTo(30);
    expect(angleOf(135)).toBeCloseTo(135);
  });
});
