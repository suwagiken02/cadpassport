// ============================================================
// P-1-fix4: 角度まわりの UI を手摺と単管で共通化した (AnglePickerRow)。
//
// いちばん怖いのは「共通化のために手摺側を触って、手摺の見た目が変わる」こと。
// なので、リファクタ**前**の手摺の JSX をこのテストの中に参照実装として
// 書き起こし、切り出した部品のレンダリング結果と**文字列で一致**することを固定する。
// クラス名が 1 文字でも変われば落ちる。
//
// 併せて、単管が同じ部品を使って角度を操作できることも押さえる。
// ============================================================
import { describe, it, expect } from 'vitest';
import React from 'react';
import AnglePickerRow from '../AnglePickerRow';
import { PREVIEW_FRAME_CLASS, PREVIEW_FRAME_SIZE } from '../PalettePreviewFrame';
import NumInput from '@/components/ui/NumInput';
import {
  ANGLE_PRESETS, ANGLE_PRESET_DEGS, ANGLE_STEPS, PIPE_ANGLE_PRESETS, angleToDeg,
  getAnglePreviewPoints, type AngleValue,
} from '@/lib/konva/placement/anglePresets';
import { PIPE_DEFAULT_ANGLE_DEG, pipeEndpointsGrid } from '@/lib/konva/planeParts';
import { pipePreview } from '@/lib/konva/planePartPreview';

const h = React.createElement;

// ------------------------------------------------------------
// 要素ツリーを文字列にする（DOM も react-dom も使わない）。
// type / children と、**関数以外の全 props**（= className を含む）を出すので、
// クラス名が 1 文字でも変われば文字列が変わる。
// 関数コンポーネント(NumInput 等)は展開せず、名前と props だけを見る。
// key は React の内部用で DOM には出ないため、見た目の比較からは外す。
// ------------------------------------------------------------
function serialize(node: unknown): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(serialize).join('');
  const el = node as { type?: unknown; key?: unknown; props?: Record<string, unknown> };
  if (!el.props) return '';
  const name = typeof el.type === 'string' ? el.type
    : typeof el.type === 'function' ? ((el.type as { name?: string }).name || 'fn')
    : String(el.type);
  const attrs = Object.entries(el.props)
    .filter(([k]) => k !== 'children')
    .map(([k, v]) => `${k}=${typeof v === 'function' ? '[fn]' : JSON.stringify(v)}`)
    .sort().join(' ');
  return `<${name}${attrs ? ' ' + attrs : ''}>${serialize(el.props.children)}</${name}>`;
}

/** 関数コンポーネントを 1 段だけ実行して中身の要素ツリーにする。 */
function renderOnce(element: React.ReactElement): unknown {
  const el = element as unknown as { type: unknown; props: Record<string, unknown> };
  return typeof el.type === 'function'
    ? (el.type as (p: unknown) => React.ReactElement)(el.props)
    : element;
}

const markup = (element: React.ReactElement) => serialize(renderOnce(element));

// ------------------------------------------------------------
// リファクタ前の手摺の「角度」行（PartSelector.tsx の angleSelector を逐語で移したもの）。
// ここは**絶対に更新しない**。更新したら「変わっていないこと」の証明にならない。
// ------------------------------------------------------------
function legacyHandrailAngleRow(args: {
  handrailAngle: AngleValue;
  setHandrailAngle: (v: AngleValue | ((prev: AngleValue) => AngleValue)) => void;
  preview: React.ReactNode;
}) {
  const { handrailAngle, setHandrailAngle, preview } = args;
  return h('div', { className: 'space-y-1.5' },
    h('div', { className: 'flex gap-1 flex-wrap' },
      ANGLE_PRESETS.map((p) => h('button', {
        key: String(p.value),
        onClick: () => setHandrailAngle(p.value),
        className: `px-2 py-1 rounded text-xs font-bold transition-colors ${
          handrailAngle === p.value ? 'bg-accent text-white' : 'bg-dark-bg text-dimension border border-dark-border'
        }`,
      }, p.label)),
    ),
    h('div', { className: 'flex items-center gap-2' },
      preview,
      h('div', { className: 'flex items-center gap-1' },
        h(NumInput, {
          value: typeof handrailAngle === 'number' ? handrailAngle : handrailAngle === 'horizontal' ? 0 : 90,
          onChange: (v: number) => setHandrailAngle(v),
          min: 0,
          className: 'w-16 bg-dark-bg border border-dark-border rounded px-2 py-1 text-xs font-mono',
        }),
        h('span', { className: 'text-[10px] text-dimension' }, '°'),
      ),
      h('div', { className: 'flex gap-0.5' },
        h('button', {
          onClick: () => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 10),
          className: 'px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors',
        }, '-10°'),
        h('button', {
          onClick: () => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) - 1),
          className: 'px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors',
        }, '-1°'),
        h('button', {
          onClick: () => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 1),
          className: 'px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors',
        }, '+1°'),
        h('button', {
          onClick: () => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + 10),
          className: 'px-2 py-1 rounded text-xs font-bold bg-dark-bg text-dimension border border-dark-border hover:border-accent/50 transition-colors',
        }, '+10°'),
      ),
    ),
  );
}

/** 手摺の姿図（PartSelector と同じもの）。 */
function handrailPreview(angle: AngleValue) {
  const ap = getAnglePreviewPoints(angle);
  return h('svg', {
    width: ap.W, height: ap.H, className: PREVIEW_FRAME_CLASS, style: { touchAction: 'none' },
  },
    h('line', {
      x1: ap.cx - ap.dx, y1: ap.cy - ap.dy, x2: ap.cx + ap.dx, y2: ap.cy + ap.dy,
      stroke: '#378ADD', strokeWidth: 3, strokeLinecap: 'round',
    }),
    h('circle', { cx: ap.cx - ap.dx, cy: ap.cy - ap.dy, r: 3, fill: '#378ADD' }),
    h('circle', { cx: ap.cx + ap.dx, cy: ap.cy + ap.dy, r: 3, fill: '#378ADD' }),
  );
}

/** 現在の実装（切り出した部品）に、手摺と同じ props を渡したもの。 */
function currentHandrailAngleRow(args: {
  handrailAngle: AngleValue;
  setHandrailAngle: (v: AngleValue | ((prev: AngleValue) => AngleValue)) => void;
  preview: React.ReactNode;
}) {
  const { handrailAngle, setHandrailAngle, preview } = args;
  return h(AnglePickerRow<AngleValue>, {
    presets: ANGLE_PRESETS,
    isActive: (v: AngleValue) => handrailAngle === v,
    onPreset: (v: AngleValue) => setHandrailAngle(v),
    numValue: typeof handrailAngle === 'number' ? handrailAngle : handrailAngle === 'horizontal' ? 0 : 90,
    onNum: (v: number) => setHandrailAngle(v),
    onStep: (d: number) => setHandrailAngle((prev) => (typeof prev === 'number' ? prev : 0) + d),
    preview,
  });
}

describe('手摺の角度行は 1 ミリも変わらない', () => {
  const angles: AngleValue[] = ['horizontal', 'vertical', 0, 15, 30, 45, 60, 75, 37];

  it.each(angles.map((a) => [String(a), a] as const))(
    '%s のとき、切り出し前後で HTML が完全に一致する', (_label, angle) => {
      const noop = () => {};
      const before = markup(
        legacyHandrailAngleRow({ handrailAngle: angle, setHandrailAngle: noop, preview: handrailPreview(angle) }),
      );
      const after = markup(
        currentHandrailAngleRow({ handrailAngle: angle, setHandrailAngle: noop, preview: handrailPreview(angle) }),
      );
      expect(after).toBe(before);
    });

  it('姿図の枠のクラス名・大きさが従来どおり', () => {
    expect(PREVIEW_FRAME_CLASS).toBe(
      'bg-dark-bg rounded-lg border border-dark-border cursor-grab active:cursor-grabbing select-none',
    );
    expect(PREVIEW_FRAME_SIZE).toBe(getAnglePreviewPoints(0).W);
    expect(PREVIEW_FRAME_SIZE).toBe(getAnglePreviewPoints(0).H);
  });

  it('微調整の押し方が従来と同じ（横/縦のときは 0 から数える）', () => {
    let got: AngleValue = 'horizontal';
    const set = (v: AngleValue | ((p: AngleValue) => AngleValue)) => {
      got = typeof v === 'function' ? v(got) : v;
    };
    clickByText(currentHandrailAngleRow({ handrailAngle: 'horizontal', setHandrailAngle: set, preview: null }), '+10°');
    expect(got).toBe(10);
  });
});

// ------------------------------------------------------------
// 要素ツリーから button を拾う（DOM を使わずに onClick を呼ぶ）。
// ------------------------------------------------------------
type Btn = { text: string; className: string; onClick: () => void };

function collectButtons(node: unknown, out: Btn[] = []): Btn[] {
  if (Array.isArray(node)) { node.forEach((n) => collectButtons(n, out)); return out; }
  if (!node || typeof node !== 'object') return out;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!el.props) return out;
  if (el.type === 'button') {
    out.push({
      text: String(el.props.children ?? ''),
      className: String(el.props.className ?? ''),
      onClick: el.props.onClick as () => void,
    });
  }
  // 関数コンポーネントは展開せず、素の要素の children だけ辿る（AnglePickerRow 自身は先に呼ぶ）
  collectButtons(el.props.children, out);
  return out;
}

/** AnglePickerRow を 1 段展開してから button を集める。 */
function buttonsOf(element: React.ReactElement): Btn[] {
  return collectButtons(renderOnce(element));
}

function clickByText(element: React.ReactElement, text: string): void {
  const b = buttonsOf(element).find((x) => x.text === text);
  if (!b) throw new Error(`button "${text}" が見つからない`);
  b.onClick();
}

// ------------------------------------------------------------
// 単管
// ------------------------------------------------------------
/** PartSelector の単管パネルと同じ props の組み立て。 */
function pipeAngleRow(angle: number, setAngle: (v: number | ((p: number) => number)) => void) {
  return h(AnglePickerRow<AngleValue>, {
    presets: PIPE_ANGLE_PRESETS,
    isActive: (v: AngleValue) => angle === angleToDeg(v),
    onPreset: (v: AngleValue) => setAngle(angleToDeg(v)),
    numValue: angle,
    onNum: (v: number) => setAngle(v),
    onStep: (d: number) => setAngle((prev) => prev + d),
    preview: null,
  });
}

describe('単管の角度 UI（火打ち向け・P-1-fix9）', () => {
  it('プリセットは 横 / 縦 / 45 / 135 / 225 / 315 の 6 つ', () => {
    const labels = buttonsOf(pipeAngleRow(45, () => {})).map((b) => b.text);
    expect(labels.slice(0, PIPE_ANGLE_PRESETS.length))
      .toEqual(['横', '縦', '45°', '135°', '225°', '315°']);
  });

  it('斜めは四隅の 4 方向そろっている（火打ちはどの隅にも入る）', () => {
    const degs = PIPE_ANGLE_PRESETS.map((p) => angleToDeg(p.value)).filter((d) => d % 90 !== 0);
    expect(degs).toEqual([45, 135, 225, 315]);
  });

  it('同じ傾きでも伸びる向きが逆になる（45 と 225 は別物）', () => {
    const dir = (deg: number) => {
      const [a, b] = pipeEndpointsGrid({ id: 'p', x: 0, y: 0, lengthMm: 2000, angleDeg: deg });
      return { x: Math.sign(Math.round(b.x - a.x)), y: Math.sign(Math.round(b.y - a.y)) };
    };
    expect(dir(45)).toEqual({ x: 1, y: 1 });
    expect(dir(225)).toEqual({ x: -1, y: -1 });
    expect(dir(135)).toEqual({ x: -1, y: 1 });
    expect(dir(315)).toEqual({ x: 1, y: -1 });
  });

  it('微調整ボタンが出る（-10 / -1 / +1 / +10）', () => {
    const labels = buttonsOf(pipeAngleRow(45, () => {})).map((b) => b.text);
    expect(labels.slice(-ANGLE_STEPS.length)).toEqual(['-10°', '-1°', '+1°', '+10°']);
  });

  it('プリセットが角度に反映される（姿図・ゴーストはこの角度を読む）', () => {
    const cases: [string, number][] = [['横', 0], ['縦', 90], ['45°', 45], ['135°', 135], ['225°', 225], ['315°', 315]];
    for (const [label, deg] of cases) {
      let got = -1;
      clickByText(pipeAngleRow(45, (v) => { got = typeof v === 'function' ? v(45) : v; }), label);
      expect(got, label).toBe(deg);
      // その角度で姿図・ゴーストの線が実際に傾く
      const { line } = pipePreview({ lengthMm: 2000, angleDeg: got });
      const drawn = (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
      expect(((drawn % 360) + 360) % 360, label).toBeCloseTo(deg % 360);
    }
  });

  it('微調整が角度に反映される', () => {
    for (const [label, delta] of [['-10°', -10], ['-1°', -1], ['+1°', 1], ['+10°', 10]] as const) {
      let got = -1;
      clickByText(pipeAngleRow(45, (v) => { got = typeof v === 'function' ? v(45) : v; }), label);
      expect(got, label).toBe(45 + delta);
    }
  });

  it('既定の角度は 45° で、45° のボタンが選択状態になる', () => {
    expect(PIPE_DEFAULT_ANGLE_DEG).toBe(45);
    const btns = buttonsOf(pipeAngleRow(PIPE_DEFAULT_ANGLE_DEG, () => {}));
    const active = btns.filter((b) => b.className.includes('bg-accent'));
    expect(active.map((b) => b.text)).toEqual(['45°']);
  });

  it('角度を変えれば選択状態も移る', () => {
    for (const [angle, label] of [[0, '横'], [90, '縦'], [225, '225°'], [315, '315°']] as const) {
      const btns = buttonsOf(pipeAngleRow(angle, () => {}));
      expect(btns.filter((b) => b.className.includes('bg-accent')).map((b) => b.text), label)
        .toEqual([label]);
    }
  });

  it('プリセット以外の角度も作れる（数値入力・±ボタン）', () => {
    let got = -1;
    clickByText(pipeAngleRow(45, (v) => { got = typeof v === 'function' ? v(45) : v; }), '+1°');
    expect(got).toBe(46);
    // どのプリセットも選択状態にならない
    const btns = buttonsOf(pipeAngleRow(46, () => {}));
    expect(btns.filter((b) => b.className.includes('bg-accent'))).toEqual([]);
  });
});

describe('手摺のプリセットは変えていない', () => {
  it('手摺は 横 / 縦 / 15 / 30 / 45 / 60 / 75 の 7 つのまま', () => {
    expect(ANGLE_PRESETS.map((p) => p.label))
      .toEqual(['横', '縦', '15°', '30°', '45°', '60°', '75°']);
    const labels = buttonsOf(currentHandrailAngleRow({
      handrailAngle: 45, setHandrailAngle: () => {}, preview: null,
    })).map((b) => b.text);
    expect(labels.slice(0, ANGLE_PRESETS.length))
      .toEqual(['横', '縦', '15°', '30°', '45°', '60°', '75°']);
  });

  it('単管の変更が手摺に漏れていない（別の一覧）', () => {
    expect(PIPE_ANGLE_PRESETS).not.toEqual(ANGLE_PRESETS);
    expect(ANGLE_PRESETS).toHaveLength(7);
    expect(PIPE_ANGLE_PRESETS).toHaveLength(6);
  });

  it('立面のプリセットも手摺と同じ並びのまま', () => {
    expect(ANGLE_PRESET_DEGS.map((p) => p.label))
      .toEqual(['横', '縦', '15°', '30°', '45°', '60°', '75°']);
  });
});

describe('手摺と単管が同じ部品を使っている', () => {
  it('プリセットの中身以外（並び・微調整・数値入力）は完全に同一', () => {
    // P-1-fix9 でプリセットの一覧だけが部材ごとに変わる。それ以外は 1 文字も違わない。
    const stripPresets = (m: string) => m.replace(
      /<div className="flex gap-1 flex-wrap">[^]*?<\/div>/, '<PRESETS/>',
    );
    const hr = markup(currentHandrailAngleRow({ handrailAngle: 45, setHandrailAngle: () => {}, preview: null }));
    const pp = markup(pipeAngleRow(45, () => {}));
    expect(stripPresets(pp)).toBe(stripPresets(hr));
    expect(pp).not.toBe(hr);   // プリセットだけは違う
  });

  it('プリセットのボタンの見た目は同じ（選択色・クラス名）', () => {
    const hrBtn = buttonsOf(currentHandrailAngleRow({ handrailAngle: 45, setHandrailAngle: () => {}, preview: null }))
      .find((b) => b.text === '45°')!;
    const ppBtn = buttonsOf(pipeAngleRow(45, () => {})).find((b) => b.text === '45°')!;
    expect(ppBtn.className).toBe(hrBtn.className);
  });
});
