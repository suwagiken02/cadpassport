// ============================================================
// P-2 commit 2: 平面部材にもシャドー追従＋クリック配置を付ける。
//
// 立面部材は「選ぶ → シャドーが追従 → クリックで置く」だが、平面部材は
// 「姿図を掴んで引き出す」しか無く、操作感が揃っていなかった。
//
// 立面の仕組みを平面用に作り直すのではなく、**配置処理そのものを 1 本に
// まとめる**ことで揃える:
//   ・PlacePayload  … 何を置くか（位置は持たない）
//   ・ToolbarDrag   … それに位置が付いたもの（ドラッグ中）
//   ・updatePreview / placeAt … ドラッグでもクリックでも同じ関数を通る
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { toPlacePayload, type PlacePayload, type ToolbarDrag } from '../placePayload';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const src = read('components/toolbar/PartSelector.tsx');
const st = () => useCanvasStore.getState();

beforeEach(() => {
  useCanvasStore.setState({
    planeAddTool: null, planePartPreview: null, handrailPreview: null,
    partPaletteTab: 'plane', showPartSelector: true, elevationAddTool: null,
  });
});

describe('置く中身は 1 つの型にまとまっている', () => {
  it('ドラッグ中の中身から位置を落とすと武装の中身になる', () => {
    const drag: ToolbarDrag = {
      type: 'handrail', lengthMm: 1800, direction: 'horizontal', currentX: 10, currentY: 20,
    };
    expect(toPlacePayload(drag)).toEqual({ type: 'handrail', lengthMm: 1800, direction: 'horizontal' });
  });

  it('平面部材の全種を表せる', () => {
    const payloads: PlacePayload[] = [
      { type: 'handrail', lengthMm: 1800, direction: 'horizontal' },
      { type: 'anti', lengthMm: 1800, direction: 'horizontal', antiWidth: 400 },
      { type: 'post' },
      { type: 'stair', angleDeg: 90, flip: true },
      { type: 'pipe', lengthMm: 5000, angleDeg: 45 },
    ];
    for (const p of payloads) {
      st().setPlaneAddTool(p);
      expect(st().planeAddTool, p.type).toEqual(p);
    }
  });
});

describe('パレットのボタンを押すと武装する', () => {
  it('押した時点で武装とドラッグの両方が始まる', () => {
    expect(src).toMatch(/const arm = useCallback\(\(payload: PlacePayload, e: React\.PointerEvent\) => \{/);
    expect(src).toMatch(/setPlaneAddTool\(payload\);/);
    expect(src).toMatch(/setToolbarDrag\(\{ \.\.\.payload, currentX: e\.clientX, currentY: e\.clientY \}\);/);
  });

  it('全部材のハンドラが arm を通る（部材ごとに書き分けない）', () => {
    for (const t of ['handrail', 'anti', 'post', 'stair', 'pipe', 'obstacle']) {
      expect(src, t).toMatch(new RegExp(`arm\\(\\{[^}]*type: '${t}'`));
    }
  });

  it('パレットの上で離しても武装は残る（＝ボタンを押しただけで選べる）', () => {
    expect(src).toMatch(/配置キャンセル。ただし武装（選んだ状態）は残す/);
  });
});

describe('ドラッグでもクリックでも同じ処理を通る', () => {
  it('置く処理は placeAt 1 本', () => {
    expect(src).toMatch(/const placeAt = useCallback\(\(drag: PlacePayload/);
    // 呼び出しは 2 箇所（ドラッグ経路とクリック経路）だけ。他に置く経路は無い。
    expect((src.match(/placeAt\(/g) ?? []).length).toBe(2);
    expect(src).toMatch(/placeAt\(toolbarDrag, e\.clientX, e\.clientY\)/);
    expect(src).toMatch(/placeAt\(planeAddTool, e\.clientX, e\.clientY\)/);
  });

  it('シャドーも updatePreview 1 本', () => {
    expect(src).toMatch(/updatePreview\(toolbarDrag, e\.clientX, e\.clientY\)/);
    expect(src).toMatch(/updatePreview\(planeAddTool, e\.clientX, e\.clientY\)/);
  });

  it('引き出し（ドラッグ&ドロップ）の経路は残っている', () => {
    expect(src).toMatch(/window\.addEventListener\('pointermove', onMove\)/);
    expect(src).toMatch(/window\.addEventListener\('pointerup', onUp\)/);
    expect(src).toMatch(/パレットから引き出す（ドラッグ&ドロップ・従来の置き方）/);
  });

  it('クリック配置は「押した場所から動いていない」ときだけ（パンと区別）', () => {
    expect(src).toMatch(/TAP_SLOP_PX/);
    expect(src).toMatch(/if \(Math\.hypot\(e\.clientX - d\.x, e\.clientY - d\.y\) > TAP_SLOP_PX\) return;/);
  });

  // P-3 (D): キャンバスの外だけでなく、キャンバスに重なって浮いている
  //   パレットの上での操作も受け付けない。判定は placementGridAt 1 本。
  it('キャンバスの外・パレットの上で押した操作では置かない', () => {
    expect(src).toMatch(/if \(!d \|\| !d\.placeable\) return;/);
    expect(src).toMatch(/placeable: canPlaceAt\(e\.clientX, e\.clientY\)/);
    expect(src).toMatch(/placementGridAt\(clientX, clientY, canvasRect\(\), paletteRects\(\)\) !== null/);
  });
});

describe('シャドーが出る', () => {
  it('支柱にもシャドーが出る（他の部材と揃えた）', () => {
    expect(read('lib/konva/placement/planePlacement.ts')).toMatch(/setPlanePartPreview\(\{ kind: 'post'/);
    expect(read('components/canvas/PlanePartLayer.tsx')).toMatch(/preview\?\.kind === 'post' &&/);
  });

  it('支柱の吸着はシャドーと配置で共有（位置が一致する）', () => {
    const placement = read('lib/konva/placement/planePlacement.ts');
    expect((placement.match(/snapPostToHandrailEnds\(/g) ?? []).length).toBe(2);
  });

  // P-3: アンチは handrailPreview（手摺の細線）への相乗りをやめ、実物と同じ板の
  //   ゴーストを planePartPreview に出すようにした。手摺だけは従来のまま。
  it('手摺は従来の handrailPreview、支柱・アンチ・階段・単管は planePartPreview', () => {
    const placement = read('lib/konva/placement/planePlacement.ts');
    expect(placement).toMatch(/setHandrailPreview\(\{\s*x: at\.x, y: at\.y,/);
    for (const kind of ['post', 'anti', 'stair', 'pipe']) {
      expect(placement, kind).toMatch(new RegExp(`setPlanePartPreview\\(\\{\\s*kind: '${kind}'`));
    }
  });

  it('武装が解けたらシャドーも消える', () => {
    expect(src).toMatch(/if \(!planeAddTool && !toolbarDrag\) clearPreviews\(\);/);
  });
});

describe('武装の解除', () => {
  it('平面タブを離れると解ける', () => {
    st().setPlaneAddTool({ type: 'post' });
    st().setPartPaletteTab('elevation');
    expect(st().planeAddTool).toBeNull();
    expect(st().planePartPreview).toBeNull();
  });

  it('部材メニューを閉じると解ける', () => {
    st().setPlaneAddTool({ type: 'pipe', lengthMm: 5000, angleDeg: 45 });
    st().togglePartSelector();          // 閉じる
    expect(st().showPartSelector).toBe(false);
    expect(st().planeAddTool).toBeNull();
  });

  it('立面タブの武装とは独立している（同時に武装しない）', () => {
    st().setPlaneAddTool({ type: 'post' });
    st().setPartPaletteTab('elevation');
    st().setElevationAddTool('rail');
    expect(st().planeAddTool).toBeNull();
    st().setPartPaletteTab('plane');
    expect(st().elevationAddTool).toBeNull();
  });
});

describe('平面タブは自動選択しない（立面と扱いを分ける）', () => {
  it('初期状態は未武装', () => {
    expect(useCanvasStore.getInitialState().planeAddTool).toBeNull();
  });

  it('平面パレットに「開いたら選ぶ」処理は入れていない', () => {
    expect(src).not.toMatch(/useEffect\([^)]*setPlaneAddTool\(/);
    expect(src).not.toMatch(/DEFAULT_ELEVATION_PART_KIND/);
  });

  it('部材メニューは平面タブから始まり、何も選ばれていない', () => {
    const init = useCanvasStore.getInitialState();
    expect(init.partPaletteTab).toBe('plane');
    expect(init.planeAddTool).toBeNull();
  });
});
