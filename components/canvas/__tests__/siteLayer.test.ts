// ============================================================
// S-1 (commit 3): 敷地境界線の描画。
//
// 見た目の決めごと（鮎澤氏の判断）:
//   ・色は**建物と同じ黒**。敷地だけ別の色にしない
//   ・区別は線種（一点鎖線）と太さ（建物より細い）でつける
//   ・塗りなし（敷地の内側に建物と足場が乗るので、塗ると隠れる）
//   ・建物より下に敷く（敷地は下地）
//
// 「import したのに JSX に載せ忘れ」は P-1-fix7 で実際に起きた事故なので、
// 既存の全レイヤー走査テスト（planePartLayerMount）が SiteLayer もまとめて見ている。
// ここでは敷地に固有の性質を固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  SITE_DASH_UNITS, SITE_SELECT_COLOR, SITE_STROKE_DARK, SITE_STROKE_LIGHT,
  SITE_STROKE_WIDTH_UNITS, SITE_STROKE_WIDTH_UNITS_SELECTED,
  siteDash, siteStrokeColor, siteStrokeWidth,
} from '@/lib/konva/siteShape';
import { INITIAL_GRID_PX } from '@/lib/konva/gridUtils';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const gridCanvas = read('components/canvas/GridCanvas.tsx');
const siteLayer = read('components/canvas/SiteLayer.tsx');
const buildingLayer = read('components/canvas/BuildingLayer.tsx');

// ============================================================
describe('色は建物と同じ黒', () => {
  it('ライトモードの線色が建物の枠と同じ', () => {
    expect(buildingLayer).toContain("isDarkMode ? '#888888' : '#1a1a18'");
    expect(SITE_STROKE_LIGHT).toBe('#1a1a18');
  });

  it('ダークモードの線色も建物と同じ', () => {
    expect(SITE_STROKE_DARK).toBe('#888888');
  });

  it('選択中は他の要素と同じオレンジ', () => {
    expect(SITE_SELECT_COLOR).toBe('#FF6B35');
    expect(buildingLayer).toContain("'#FF6B35'");
  });

  it('モードと選択で色が決まる', () => {
    expect(siteStrokeColor(false, false)).toBe('#1a1a18');
    expect(siteStrokeColor(true, false)).toBe('#888888');
    expect(siteStrokeColor(false, true)).toBe('#FF6B35');
    expect(siteStrokeColor(true, true)).toBe('#FF6B35');
  });

  it('背景（白・黒）に溶けない', () => {
    for (const c of [SITE_STROKE_LIGHT, SITE_STROKE_DARK, SITE_SELECT_COLOR]) {
      expect(['#ffffff', '#0a0a0a']).not.toContain(c.toLowerCase());
    }
  });

  it('紫など独自色を使っていない（黒でそろえる判断）', () => {
    expect(read('lib/konva/siteShape.ts')).not.toMatch(/#7E57C2|#B39DDB|#8E44AD/i);
  });
});

// ============================================================
describe('線種は一点鎖線、太さは建物より細い', () => {
  it('長線・空き・点・空き の 4 値', () => {
    expect(SITE_DASH_UNITS).toHaveLength(4);
    const [longSeg, gap1, dot, gap2] = SITE_DASH_UNITS;
    expect(longSeg).toBeGreaterThan(dot);   // 長い線と短い点が交互＝一点鎖線
    expect(gap1).toBe(gap2);
    expect(dot).toBeGreaterThan(0);
  });

  it('ズームに比例する（画面上の見え方が一定）', () => {
    expect(siteDash(1)).toEqual([...SITE_DASH_UNITS]);
    expect(siteDash(2)).toEqual(SITE_DASH_UNITS.map((v) => v * 2));
    expect(siteDash(0.25)).toEqual(SITE_DASH_UNITS.map((v) => v * 0.25));
  });

  it('建物（16 / 選択 24）より細い', () => {
    expect(buildingLayer).toContain('(isSelected ? 24 : 16) * zoom');
    expect(SITE_STROKE_WIDTH_UNITS).toBe(12);
    expect(SITE_STROKE_WIDTH_UNITS).toBeLessThan(16);
    expect(SITE_STROKE_WIDTH_UNITS_SELECTED).toBeLessThan(24);
  });

  it('太さもズームに比例する', () => {
    expect(siteStrokeWidth(1, false)).toBe(12);
    expect(siteStrokeWidth(2, false)).toBe(24);
    expect(siteStrokeWidth(1, true)).toBe(18);
  });

  it('選択すると太くなる（掴んでいることが分かる）', () => {
    expect(siteStrokeWidth(1, true)).toBeGreaterThan(siteStrokeWidth(1, false));
  });

  it('建物は実線のまま（敷地に引きずられて破線にしていない）', () => {
    const body = buildingLayer.slice(
      buildingLayer.indexOf('{/* 建物本体 */}'), buildingLayer.indexOf('{/* 屋根の出幅点線'),
    );
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/dash=/);
  });
});

// ============================================================
describe('塗らない', () => {
  it('敷地の外形に fill を書いていない', () => {
    // S-4 で頂点のつまみ（塗りつぶした丸）が増えたので、外形の <Line> だけを見る。
    const line = siteLayer.slice(siteLayer.indexOf('<Line'), siteLayer.indexOf('/>', siteLayer.indexOf('<Line')));
    expect(line.length).toBeGreaterThan(100);
    expect(line).not.toMatch(/fill=/);
  });

  it('外形は閉じる（closed）', () => {
    expect(siteLayer).toMatch(/closed/);
  });

  it('当たり判定は線そのもの（内側をタップしても拾わない）', () => {
    // 塗りが無い Konva の Line は、内側では当たらない。線の当たり幅だけ広げる。
    expect(siteLayer).toMatch(/hitStrokeWidth=\{listening \? 14 : 0\}/);
  });
});

// ============================================================
describe('キャンバスに載っている・重なり順', () => {
  it('SiteLayer が GridCanvas に置かれている', () => {
    expect(gridCanvas).toMatch(/<SiteLayer\s*\/>/);
  });

  it('建物より下（先に描く＝下地になる）', () => {
    expect(gridCanvas).toMatch(/<SiteLayer\s*\/>[^]*?<BuildingLayer\s*\/>/);
  });

  it('敷地が 1 枚も無ければ何も描かない（既存の図面はノードが増えない）', () => {
    expect(siteLayer).toMatch(/if \(sites\.length === 0\) return null;/);
  });
});

// ============================================================
describe('作法が BuildingLayer と同じ', () => {
  it('座標の写し方が同じ（グリッド × gridPx ＋ pan）', () => {
    for (const [name, src] of [['site', siteLayer], ['building', buildingLayer]] as const) {
      expect(src, name).toMatch(/const gridPx = INITIAL_GRID_PX \* zoom/);
    }
    expect(buildingLayer).toMatch(/p\.x \* gridPx \+ panX/);
    expect(buildingLayer).toMatch(/p\.y \* gridPx \+ panY/);
    // S-4: つまみでも同じ式を使うので sx / sy に切り出した（式そのものは同じ）。
    expect(siteLayer).toMatch(/const sx = \(gx: number\) => gx \* gridPx \+ panX;/);
    expect(siteLayer).toMatch(/const sy = \(gy: number\) => gy \* gridPx \+ panY;/);
    expect(siteLayer).toMatch(/points=\{pts\.flatMap\(\(p\) => \[sx\(p\.x\), sy\(p\.y\)\]\)\}/);
    // 画面座標の計算そのもの（レイヤーと同じ式）
    expect(10 * (INITIAL_GRID_PX * 2) + 50).toBe(110);
  });

  it('触れる条件が同じ式（素の選択モード＋選択ON＋建物ロック解除、または入替）', () => {
    const gate = /\(plainSelect && selectActive && !selectLock(?:\.building|Building)\)\s*\|\|\s*\(mode === 'select' && isReorderMode\)/;
    expect(gate.test(buildingLayer), 'building').toBe(true);
    expect(gate.test(siteLayer), 'site').toBe(true);
  });

  it('消去・まとめ移動でも触れる', () => {
    expect(siteLayer).toMatch(/mode === 'erase' \|\| mode === 'move-select'/);
  });

  it('タップで選べるよう id を持つ（選択はステージ側の共通経路）', () => {
    expect(siteLayer).toMatch(/id=\{site\.id\}/);
    expect(buildingLayer).toMatch(/id=\{building\.id\}/);
  });

  it('まとめ移動中は moveSelect の選択を見る（建物と同じ）', () => {
    for (const [name, src] of [['site', siteLayer], ['building', buildingLayer]] as const) {
      expect(src, name).toMatch(/mode === 'move-select' \? moveSelect/);
    }
  });

  it('透明・非表示にしていない', () => {
    expect(siteLayer).not.toMatch(/opacity=\{0\}/);
    expect(siteLayer).not.toMatch(/visible=\{false\}/);
  });
});
