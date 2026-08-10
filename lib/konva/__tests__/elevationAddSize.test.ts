// ============================================================
// E-8-v5b-fix: 立面部材の「長さ(コマ)」が切り替えられなかった件。
//
// ■ 原因
// パレットの長さボタンは、押した瞬間に「その寸法を選ぶ」→「その種類で引き出しを
// 始める」の順で動く。引き出しの開始は setElevationAddTool を呼ぶが、これが
// **同じ種類でも寸法を既定へ戻していた**ため、選んだ寸法が即座に上書きされていた。
//   setElevationAddSize(8) → setElevationAddTool('post') → 4 に戻る
// 姿図を掴んだときも同じ経路なので、そちらでも寸法が戻っていた。
//
// 種類を「変えたとき」だけ既定へ戻すのが正しい。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  POST_KOMA_CHOICES, SPAN_LENGTH_CHOICES_MM, defaultPartSize, newElevationPart,
  partRangeMm, postSlotBandMm, type ElevationPartKind,
} from '../elevation/elevationParts';
import { PALETTE_KINDS } from '../elevation/elevationSlots';
import { newFreePart, freePartsBoundsGrid } from '../freeParts';

const st = () => useCanvasStore.getState();

/** パレットの長さボタンを押したときに起きること（ElevationPartPalette と同じ順序）。 */
const pressSizeButton = (kind: ElevationPartKind, value: number) => {
  st().setElevationAddSize(value);
  st().setElevationAddTool(kind);   // startDragOut がこれを呼ぶ
};

beforeEach(() => {
  useCanvasStore.setState({ elevationAddTool: null, elevationAddSize: 1800 });
});

describe('長さボタンが効く（今回の不具合）', () => {
  it('支柱のコマ数 8/6/4/2/1 がすべて選べる', () => {
    st().setElevationAddTool('post');
    for (const koma of POST_KOMA_CHOICES) {
      pressSizeButton('post', koma);
      expect(st().elevationAddSize, `${koma}コマ`).toBe(koma);
    }
  });

  it('手摺の長さ 1800/1500/1200/900/600 がすべて選べる', () => {
    st().setElevationAddTool('rail');
    for (const mm of SPAN_LENGTH_CHOICES_MM) {
      pressSizeButton('rail', mm);
      expect(st().elevationAddSize, `${mm}mm`).toBe(mm);
    }
  });

  it('筋交・踏板でも選べる', () => {
    for (const kind of ['brace', 'board'] as ElevationPartKind[]) {
      st().setElevationAddTool(kind);
      for (const mm of SPAN_LENGTH_CHOICES_MM) {
        pressSizeButton(kind, mm);
        expect(st().elevationAddSize, `${kind}/${mm}`).toBe(mm);
      }
    }
  });

  it('姿図を掴んでも寸法が戻らない（同じ経路）', () => {
    st().setElevationAddTool('post');
    st().setElevationAddSize(8);
    st().setElevationAddTool('post');   // 姿図の onPointerDown → startDragOut
    expect(st().elevationAddSize).toBe(8);
  });

  it('選んだあと何度引き出しても保たれる', () => {
    st().setElevationAddTool('post');
    st().setElevationAddSize(1);
    for (let i = 0; i < 5; i++) st().setElevationAddTool('post');
    expect(st().elevationAddSize).toBe(1);
  });
});

describe('種類を変えたときは既定へ戻る（従来どおり）', () => {
  it('支柱 → 手摺 で既定の長さに戻る', () => {
    st().setElevationAddTool('post');
    st().setElevationAddSize(8);
    st().setElevationAddTool('rail');
    expect(st().elevationAddSize).toBe(defaultPartSize('rail'));
  });

  it('手摺 → 支柱 で既定のコマ数に戻る', () => {
    st().setElevationAddTool('rail');
    st().setElevationAddSize(600);
    st().setElevationAddTool('post');
    expect(st().elevationAddSize).toBe(defaultPartSize('post'));
  });

  it('パレットの全種で、切り替え時は既定になる', () => {
    for (const kind of PALETTE_KINDS) {
      st().setElevationAddTool(null);
      st().setElevationAddTool(kind);
      expect(st().elevationAddSize, kind).toBe(defaultPartSize(kind));
    }
  });

  it('解除（null）や文字ツールでは寸法を触らない', () => {
    st().setElevationAddTool('post');
    st().setElevationAddSize(6);
    st().setElevationAddTool(null);
    expect(st().elevationAddSize).toBe(6);
    st().setElevationAddTool('text');
    expect(st().elevationAddSize).toBe(6);
  });
});

describe('選んだ寸法が部材に反映される', () => {
  it('支柱はコマ数どおりの長さになる（1 コマ 450mm）', () => {
    for (const koma of POST_KOMA_CHOICES) {
      const part = newElevationPart('post', 'p', 0, { xMm: 0, yMm: 0 }, { komaCount: koma });
      expect(part.komaCount, `${koma}`).toBe(koma);
      const band = postSlotBandMm(0, koma);
      expect(band.topMm - band.bottomMm, `${koma}`).toBe(450 * koma);
    }
  });

  it('手摺は選んだ長さで置かれる', () => {
    for (const mm of SPAN_LENGTH_CHOICES_MM) {
      const part = newElevationPart('rail', 'r', 0, { xMm: 0, yMm: 0 }, { sizeMm: mm });
      const r = partRangeMm(part, undefined)!;
      expect(r.x1Mm - r.x0Mm, `${mm}`).toBeCloseTo(mm);
    }
  });

  it('足場が無いキャンバス（freeParts）でも全コマ数が使える', () => {
    for (const koma of POST_KOMA_CHOICES) {
      const b = freePartsBoundsGrid([newFreePart('post', 'p', { x: 0, y: 0 }, { komaCount: koma })])!;
      expect((b.maxY - b.minY) * 10, `${koma}`).toBeGreaterThanOrEqual(450 * koma);
    }
  });

  it('足場が無いキャンバスでも全長さが使える', () => {
    for (const mm of SPAN_LENGTH_CHOICES_MM) {
      const part = newFreePart('rail', 'r', { x: 0, y: 0 }, { sizeMm: mm });
      const r = partRangeMm(part, undefined)!;
      expect(r.x1Mm - r.x0Mm, `${mm}`).toBeCloseTo(mm);
    }
  });

  it('「収まる範囲」で丸める残骸は無い（自由＋接合吸着の思想）', () => {
    // 規格外のコマ数を渡してもそのまま通る（置ける場所の制限をしない）
    const part = newElevationPart('post', 'p', 0, { xMm: 0, yMm: 0 }, { komaCount: 12 });
    expect(part.komaCount).toBe(12);
  });
});

describe('規格の並びは確定ルールどおり', () => {
  it('支柱は 8 / 6 / 4 / 2 / 1 コマ', () => {
    expect(POST_KOMA_CHOICES).toEqual([8, 6, 4, 2, 1]);
  });

  it('支柱の既定は 4 コマ（= 1800mm）', () => {
    expect(defaultPartSize('post')).toBe(4);
    expect(defaultPartSize('post') * 450).toBe(1800);
  });

  it('手摺・踏板・筋交の既定は 1800mm', () => {
    for (const kind of ['rail', 'board', 'brace'] as ElevationPartKind[]) {
      expect(defaultPartSize(kind), kind).toBe(1800);
    }
  });
});
