// ============================================================
// E-8-v5c commit 1: 作図の補助（補助線・目印）のデータと描画。
//
// 補助線・目印は freeParts の器に乗せるが、**部材ではない**。
//   ・接合スナップ（コマ⇔楔・ホゾ⇔受け）に一切参加しない
//   ・部材の集計に数えない
//   ・図面の主役を隠さないよう、建物より背面の AidLayer に描く
//
// ここでいちばん大事なのは「既存の物件が 1 ミリも変わらない」ことなので、
// 補助線を含まない図面の出力が追加前と完全一致することを最初に押さえる。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isDrawingAid, partsToPrimitives, type ElevationPart, type ElevationPartKind,
} from '../elevation/elevationParts';
import { partJoints, partVirtualJoints, snapJoint } from '../elevation/elevationJoints';
import {
  FREE_GEOM, aidPartsOf, freePartsToPrimitives, newFreePart, scaffoldPartsOf,
  type FreePart,
} from '../freeParts';
import { ELEV_PART_COLORS } from '../elevation/elevationPartStyle';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

/** 補助線 1 本（中心・長さ・傾き）。 */
const aidLine = (id = 'a1', at = { x: 0, y: 0 }, sizeMm = 2000, angleDeg?: number): FreePart =>
  newFreePart('line', id, at, { sizeMm, angleDeg });
const aidPoint = (id = 'p1', at = { x: 0, y: 0 }): FreePart =>
  newFreePart('point', id, at, {});
const rail = (id = 'r1', at = { x: 0, y: 0 }): FreePart =>
  newFreePart('rail', id, at, { sizeMm: 1800 });

// ============================================================
describe('「部材ではない」判定は 1 か所', () => {
  it('線と点だけが補助', () => {
    expect(isDrawingAid('line')).toBe(true);
    expect(isDrawingAid('point')).toBe(true);
  });

  it('足場の部材はどれも補助ではない', () => {
    const parts: ElevationPartKind[] = [
      'post', 'postExt', 'jack', 'board', 'rail', 'raiseBoard', 'raiseRail', 'brace',
    ];
    for (const k of parts) expect(isDrawingAid(k), k).toBe(false);
  });

  it('仕分けができる', () => {
    const all = [rail('r1'), aidLine('a1'), aidPoint('p1'), rail('r2')];
    expect(aidPartsOf(all).map((p) => p.id)).toEqual(['a1', 'p1']);
    expect(scaffoldPartsOf(all).map((p) => p.id)).toEqual(['r1', 'r2']);
  });

  it('空・未定義でも落ちない', () => {
    expect(aidPartsOf(undefined)).toEqual([]);
    expect(scaffoldPartsOf([])).toEqual([]);
  });
});

// ============================================================
describe('接合スナップに参加しない（いちばん大事なガード）', () => {
  it('補助線・目印は接合点を持たない', () => {
    expect(partJoints(aidLine(), undefined)).toEqual([]);
    expect(partJoints(aidPoint(), undefined)).toEqual([]);
  });

  it('「将来の受け口」も出さない', () => {
    expect(partVirtualJoints(aidLine(), undefined)).toEqual([]);
    expect(partVirtualJoints(aidPoint(), undefined)).toEqual([]);
  });

  it('手摺は補助線に吸い付かない', () => {
    // 補助線の端点のすぐ近くへ手摺を持っていっても、補正が 0 のまま
    const aid = aidLine('a1', { x: 0, y: 0 }, 2000);
    const moving = rail('r1', { x: 100, y: 1 });
    const snap = snapJoint(moving, [aid], undefined, { dxMm: 0, dyMm: 0 },
      { pxPerMm: 0.3, tolPx: 22 });
    expect(snap).toEqual({ dxMm: 0, dyMm: 0 });
  });

  it('補助線を動かしても部材へ吸い付かない', () => {
    const r = rail('r1', { x: 0, y: 0 });
    const aid = aidLine('a1', { x: 1, y: 1 }, 1800);
    const snap = snapJoint(aid, [r], undefined, { dxMm: 0, dyMm: 0 },
      { pxPerMm: 0.3, tolPx: 22 });
    expect(snap).toEqual({ dxMm: 0, dyMm: 0 });
  });

  it('部材どうしの吸着は従来どおり効く（巻き添えで壊していない）', () => {
    const a = rail('r1', { x: 0, y: 0 });
    const b = rail('r2', { x: 182, y: -1 });
    const snap = snapJoint(b, [a], undefined, { dxMm: 0, dyMm: 0 },
      { pxPerMm: 0.3, tolPx: 22 });
    expect(snap.dxMm !== 0 || snap.dyMm !== 0).toBe(true);
  });

  it('補助線が混ざっていても、部材どうしの吸着は変わらない', () => {
    const a = rail('r1', { x: 0, y: 0 });
    const b = rail('r2', { x: 182, y: -1 });
    const withoutAid = snapJoint(b, [a], undefined, { dxMm: 0, dyMm: 0 }, { pxPerMm: 0.3, tolPx: 22 });
    const withAid = snapJoint(b, [a, aidLine('a1', { x: 181, y: 0 })], undefined,
      { dxMm: 0, dyMm: 0 }, { pxPerMm: 0.3, tolPx: 22 });
    expect(withAid).toEqual(withoutAid);
  });
});

// ============================================================
describe('描かれる', () => {
  it('補助線は線 1 本', () => {
    const prims = freePartsToPrimitives([aidLine('a1', { x: 0, y: 0 }, 2000)]);
    expect(prims).toHaveLength(1);
    expect(prims[0].kind).toBe('line');
  });

  it('補助線の長さが指定どおり（中心から左右へ半分ずつ）', () => {
    const prims = freePartsToPrimitives([aidLine('a1', { x: 50, y: 0 }, 2000)]);
    const p = prims[0] as { x1: number; x2: number };
    expect(p.x2 - p.x1).toBeCloseTo(200, 6);   // 2000mm = 200 グリッド
    expect((p.x1 + p.x2) / 2).toBeCloseTo(50, 6);
  });

  it('目印は十字（線 2 本）＝ DXF にも出る形', () => {
    const prims = freePartsToPrimitives([aidPoint('p1', { x: 10, y: 20 })]);
    expect(prims).toHaveLength(2);
    expect(prims.every((p) => p.kind === 'line')).toBe(true);
    // 円を使っていない（DXF が circle を出力しないため）
    expect(prims.some((p) => p.kind === 'circle')).toBe(false);
  });

  it('十字は指した点で交わる', () => {
    const [h, v] = freePartsToPrimitives([aidPoint('p1', { x: 10, y: 20 })]) as
      { x1: number; y1: number; x2: number; y2: number }[];
    expect((h.x1 + h.x2) / 2).toBeCloseTo(10, 6);
    expect(h.y1).toBeCloseTo(20, 6);
    expect((v.y1 + v.y2) / 2).toBeCloseTo(20, 6);
    expect(v.x1).toBeCloseTo(10, 6);
  });

  it('傾けた補助線は斜めになる（既存の回転がそのまま効く）', () => {
    const [p] = freePartsToPrimitives([aidLine('a1', { x: 0, y: 0 }, 2000, 30)]) as
      { x1: number; y1: number; x2: number; y2: number }[];
    expect(p.y1).not.toBeCloseTo(p.y2, 3);
    // 長さは変わらない
    expect(Math.hypot(p.x2 - p.x1, p.y2 - p.y1)).toBeCloseTo(200, 3);
  });

  it('45° 傾ければ 45° の線になる', () => {
    const [p] = freePartsToPrimitives([aidLine('a1', { x: 0, y: 0 }, 2000, 45)]) as
      { x1: number; y1: number; x2: number; y2: number }[];
    expect(Math.abs(p.x2 - p.x1)).toBeCloseTo(Math.abs(p.y2 - p.y1), 3);
  });

  it('見た目は控えめ（部材より細い・薄い・破線）', () => {
    const [p] = freePartsToPrimitives([aidLine()]) as {
      stroke: string; widthGrid?: number; dash?: number[]; opacity?: number;
    }[];
    expect(p.stroke).toBe(ELEV_PART_COLORS.aid);
    expect(p.widthGrid!).toBeLessThan(8);          // 手摺 8 より細い
    expect(p.dash).toBeDefined();                   // 破線
    expect(p.opacity!).toBeLessThanOrEqual(1);
  });

  it('補助の色が図面の主役と被らない', () => {
    for (const c of [ELEV_PART_COLORS.rail, ELEV_PART_COLORS.post, ELEV_PART_COLORS.board,
      '#1a1a18', '#ffffff', '#0a0a0a']) {
      expect(ELEV_PART_COLORS.aid.toLowerCase()).not.toBe(c.toLowerCase());
    }
  });

  it('絵の出どころは部材と同じ 1 本（別経路を作っていない）', () => {
    const parts = [rail('r1'), aidLine('a1')];
    expect(freePartsToPrimitives(parts))
      .toEqual(partsToPrimitives({ parts: parts as ElevationPart[], geom: FREE_GEOM }));
  });
});

// ============================================================
describe('既存が 1 ミリも変わらない', () => {
  const scaffold = [rail('r1', { x: 0, y: 0 }), newFreePart('post', 'p1', { x: 50, y: 0 }, { komaCount: 4 })];

  it('補助を含まない図面の絵が、追加前とまったく同じ', () => {
    // 補助を足す前後で、部材だけの出力は不変
    const before = freePartsToPrimitives(scaffold);
    const after = freePartsToPrimitives(scaffoldPartsOf([...scaffold, aidLine('a1'), aidPoint('p1x')]));
    expect(after).toEqual(before);
  });

  it('部材の接合点は従来どおり', () => {
    expect(partJoints(scaffold[0], undefined).length).toBeGreaterThan(0);
    expect(partJoints(scaffold[1], undefined).length).toBeGreaterThan(0);
  });

  it('保存の形は変わらない（新しい必須フィールドを足していない）', () => {
    // 補助線も部材と同じ形。読み書きの互換が崩れない
    const keys = Object.keys(aidLine()).sort();
    expect(keys).toEqual(['id', 'kind', 'levelMm', 'origin', 'scaffoldIndex', 'x0Mm', 'x1Mm']);
  });

  it('既存データには line/point が存在しないので、新しい分岐を通らない', () => {
    expect(scaffold.some((p) => isDrawingAid(p.kind))).toBe(false);
  });
});

// ============================================================
describe('レイヤーの分離と重ね順', () => {
  const grid = read('components/canvas/GridCanvas.tsx');
  const aidLayer = read('components/canvas/AidLayer.tsx');
  const freeLayer = read('components/canvas/FreePartLayer.tsx');

  it('AidLayer が載っている', () => {
    expect(grid).toMatch(/<AidLayer \/>/);
  });

  it('建物・足場より背面（主役を隠さない）', () => {
    expect(grid.indexOf('<AidLayer />')).toBeLessThan(grid.indexOf('<BuildingLayer />'));
    expect(grid.indexOf('<AidLayer />')).toBeLessThan(grid.indexOf('<ScaffoldLayer />'));
    expect(grid.indexOf('<AidLayer />')).toBeLessThan(grid.indexOf('<SiteLayer />'));
  });

  it('出力で名指しで隠せるよう名前が付いている', () => {
    expect(aidLayer).toMatch(/export const AID_LAYER_NAME = 'aid-layer';/);
    expect(aidLayer).toMatch(/<Layer name=\{AID_LAYER_NAME\}>/);
  });

  it('AidLayer は補助だけ、FreePartLayer は部材だけを描く', () => {
    expect(aidLayer).toMatch(/aidPartsOf\(freeParts\)/);
    expect(freeLayer).toMatch(/scaffoldPartsOf\(freeParts\)/);
  });

  it('描き方・触り方は共通部品（片方だけ選べない、が起きない）', () => {
    expect(aidLayer).toMatch(/<FreePartGroups/);
    expect(freeLayer).toMatch(/<FreePartGroups/);
  });

  it('補助が 1 つも無ければ何も描かない（既存の図面はノードが増えない）', () => {
    expect(aidLayer).toMatch(/if \(aids\.length === 0\) return null;/);
  });
});

// ============================================================
describe('触れる（選択・移動・削除の経路）', () => {
  const groups = read('components/canvas/FreePartGroups.tsx');

  it('クリック・タップで選択できる', () => {
    expect(groups).toMatch(/onClick=\{\(\) => onPartTap\(id\)\}/);
    expect(groups).toMatch(/onTap=\{\(\) => onPartTap\(id\)\}/);
    expect(groups).toMatch(/st\.setSelectedIds\(\[id\]\)/);
  });

  it('ドラッグで動かせる（既存の moveFreePartBy を通る）', () => {
    expect(groups).toMatch(/draggable=\{mode === 'select'\}/);
    expect(groups).toMatch(/moveFreePartBy\(id, d\)/);
  });

  it('消去モードで削除できる', () => {
    expect(groups).toMatch(/if \(mode === 'erase'\) \{ st\.removeElement\(id\); return; \}/);
  });

  it('指のぶれでドラッグ扱いにならない（従来と同じ 10px）', () => {
    expect(groups).toMatch(/export const EDIT_DRAG_PX = 10;/);
    expect(groups).toMatch(/dragDistance=\{EDIT_DRAG_PX\}/);
  });

  it('置いている最中は既存のものを触らせない（両レイヤーとも）', () => {
    expect(read('components/canvas/AidLayer.tsx')).toMatch(/&& !placing;/);
    expect(read('components/canvas/FreePartLayer.tsx')).toMatch(/interactive && !placing/);
  });
});
