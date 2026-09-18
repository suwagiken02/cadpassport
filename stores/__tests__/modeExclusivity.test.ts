// ============================================================
// 不具合: 1 タップで「削除」と「部材配置」が同時に走る。
//
// ■ 再現の条件（実機で確認済み）
//   部材パレットを開いて部材を選ぶ（武装する）→ 消去を押す
//     ・パレットの見た目は消える
//     ・しかし部材ボタンは点灯したまま＝武装が残っている
//     ・消去も点灯する
//     ・キャンバスを 1 回タップすると、削除と配置の両方が走る
//
// ■ ここで押さえること
// 「同時に 2 つ点いている状態」を**状態の持ち方のレベルで作れなくする**。
// 見た目を直しても同時実行は残るので、ストアの状態そのものを検査する。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import type { CanvasData } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../', p), 'utf8');
const st = () => useCanvasStore.getState();

const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

/** 部材パレットを開いて、手摺を選んだ状態（＝武装）にする。 */
function armPart() {
  const s = st();
  if (!s.showPartSelector) s.togglePartSelector();
  s.setPlaneAddTool({ type: 'handrail', lengthMm: 1800, direction: 'horizontal' });
}

/**
 * いま点灯しているモードボタン（ModeToolbar の isActive と同じ判定）。
 * ここが排他の唯一の物差し。
 */
function litButtons(): string[] {
  const s = st();
  const isKutai = s.mode === 'building' || s.mode === 'obstacle'
    || s.isHeightMarkerMode || s.isRidgeLineMode;
  const lit: string[] = [];
  if (s.mode === 'select' && s.selectActive && !s.isMeasuring) lit.push('select');
  if (isKutai && !s.isMeasuring) lit.push('kutai');
  if (s.showPartSelector) lit.push('buzai');
  if (s.mode === 'memo' && !s.isMeasuring) lit.push('memo');
  if (s.mode === 'erase' && !s.isMeasuring) lit.push('erase');
  return lit;
}

/** 削除するモードか（タップで消える）。 */
const isErasing = () => st().mode === 'erase';
/** 配置できる状態か（タップで置かれる）。 */
const isArmed = () => st().planeAddTool !== null || st().elevationAddTool !== null;

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({
    mode: 'select', selectActive: true, isMeasuring: false,
    showPartSelector: false, planeAddTool: null, elevationAddTool: null,
    isHeightMarkerMode: false, isRidgeLineMode: false, isMagnetPinMode: false,
    isReorderMode: false, planePartPreview: null, handrailPreview: null,
  });
});

// ============================================================
describe('1) 消去へ切り替えたら、部材は必ず落ちる', () => {
  it('部材パレットが閉じる', () => {
    armPart();
    expect(st().showPartSelector).toBe(true);   // 前提
    st().setMode('erase');
    expect(st().showPartSelector).toBe(false);
  });

  it('選んでいた部材（武装）が null になる', () => {
    armPart();
    expect(st().planeAddTool).not.toBeNull();   // 前提
    st().setMode('erase');
    expect(st().planeAddTool).toBeNull();
  });

  it('立面の武装も落ちる', () => {
    st().togglePartSelector();
    useCanvasStore.setState({ elevationAddTool: 'rail' });
    st().setMode('erase');
    expect(st().elevationAddTool).toBeNull();
  });

  it('シャドー（置かれる姿）も消える', () => {
    armPart();
    useCanvasStore.setState({ handrailPreview: { x: 1, y: 1, lengthMm: 1800, direction: 'horizontal' } as never });
    st().setMode('erase');
    expect(st().handrailPreview).toBeNull();
    expect(st().planePartPreview).toBeNull();
  });
});

// ============================================================
describe('2) 1 タップで削除と配置が同時に走らない', () => {
  it('消去モードでは、配置できる状態が残らない', () => {
    armPart();
    st().setMode('erase');
    expect(isErasing()).toBe(true);
    expect(isArmed()).toBe(false);   // ← 武装が残っていると 1 タップで両方走る
  });

  it('「削除する」と「配置できる」が同時に成り立たない', () => {
    armPart();
    st().setMode('erase');
    expect(isErasing() && isArmed()).toBe(false);
  });

  it('配置の受け口が、置けないモードでは働かない', () => {
    // パレットは mode で見た目を消すだけだったので、window の配置リスナーは
    // 生きたまま残っていた（早期 return の前に useEffect が走るため）。
    const src = read('components/toolbar/PartSelector.tsx');
    expect(src).toMatch(/if \(!planeAddTool \|\| toolbarDrag \|\| !canUsePartSelector\(mode\)\) return;/);
  });

  it('建物モードでも同じ（パレットが使えないモード）', () => {
    armPart();
    st().setMode('building');
    expect(isArmed()).toBe(false);
    expect(st().showPartSelector).toBe(false);
  });
});

// ============================================================
describe('3) 総当たり — 削除と配置が同時に点かない', () => {
  /** モードに入る操作の一覧。 */
  const enter: [string, () => void][] = [
    ['選択', () => { st().setMode('select'); st().setSelectActive(true); }],
    ['躯体(建物)', () => st().setMode('building')],
    ['躯体(障害物)', () => st().setMode('obstacle')],
    ['躯体(高さ)', () => st().setHeightMarkerMode(true)],
    ['躯体(棟)', () => st().setRidgeLineMode(true)],
    ['部材', () => armPart()],
    ['メモ', () => st().setMode('memo')],
    ['消去', () => st().setMode('erase')],
  ];

  it.each(enter)('%s に入っても、削除と配置が同時に成り立たない', (_name, go) => {
    for (const [, from] of enter) {
      // どのモードから来ても壊れないこと
      useCanvasStore.setState({
        mode: 'select', selectActive: true, showPartSelector: false,
        planeAddTool: null, elevationAddTool: null,
        isHeightMarkerMode: false, isRidgeLineMode: false,
      });
      from();
      go();
      expect(isErasing() && isArmed(), `${_name}`).toBe(false);
    }
  });

  it('消去に入ったら、点灯するのは消去だけ', () => {
    armPart();
    st().setMode('erase');
    expect(litButtons()).toEqual(['erase']);
  });

  it('躯体に入ったら、部材は点かない', () => {
    armPart();
    st().setMode('building');
    expect(litButtons()).not.toContain('buzai');
  });
});

// ============================================================
describe('障害物モードの併存（部材パレットが出たままになる）', () => {
  it('パレットは意図どおり出る（武装も残る）', () => {
    armPart();
    st().setMode('obstacle');
    expect(st().showPartSelector).toBe(true);
    expect(st().planeAddTool).not.toBeNull();
  });

  it('それでも 1 タップで作図と配置は同時に走らない', () => {
    // 障害物モードではキャンバスのタップで作図が走らない（パレットからの
    //   ドラッグでしか置かない）。起点タップの分岐は building 限定。
    const src = read('lib/konva/useCanvasInteraction.ts');
    expect(src).toMatch(/obstacle モード: クリック配置は無効化/);
    expect(src).toMatch(/if \(s\.mode === 'building' && s\.buildingInputMethod === 'direction'\)/);
    expect(src).not.toMatch(/s\.mode === 'obstacle'[^]{0,80}addDirectionPoint/);
  });

  it('ドラッグ中はクリック配置が止まる（二重に置かれない）', () => {
    const src = read('components/toolbar/PartSelector.tsx');
    expect(src).toMatch(/if \(!planeAddTool \|\| toolbarDrag \|\| !canUsePartSelector\(mode\)\) return;/);
  });
});

// ============================================================
describe('モードを足したときに更新漏れが起きない形', () => {
  it('全モードを網羅した対応表になっている（1 つ足すと型エラー）', () => {
    const src = read('lib/konva/toolMode.ts');
    expect(src).toMatch(/const PART_SELECTOR_BY_MODE: Record<ModeType, boolean>/);
  });

  it('使えないのは消去と建物だけ（現状の挙動そのまま）', () => {
    const src = read('lib/konva/toolMode.ts');
    expect(src).toMatch(/erase: false/);
    expect(src).toMatch(/building: false/);
    expect(src).toMatch(/obstacle: true/);
  });

  it('判定を見るのは 3 か所（ストア・表示・配置の受け口）', () => {
    expect(read('stores/canvasStore.ts')).toMatch(/canUsePartSelector\(mode\)/);
    const ps = read('components/toolbar/PartSelector.tsx');
    expect((ps.match(/canUsePartSelector\(mode\)/g) ?? [])).toHaveLength(2);
  });

  it('各ボタンのハンドラに「他を消す」処理をコピーしていない', () => {
    const tb = read('components/toolbar/ModeToolbar.tsx');
    expect(tb).not.toMatch(/setPlaneAddTool\(null\)/);
    expect(tb).not.toMatch(/setElevationAddTool\(null\)/);
  });
});

// ============================================================
describe('消去を抜けたら選択へ戻る（B）', () => {
  it('消去をもう一度押す＝選択へ（既存の実装そのまま）', () => {
    expect(read('components/toolbar/ModeToolbar.tsx'))
      .toMatch(/setMode\(mode === 'erase' \? 'select' : 'erase'\)/);
  });

  it('直前のモードを復元する仕組みは持たない', () => {
    expect(read('stores/canvasStore.ts')).not.toMatch(/previousMode|lastMode/);
  });
});
