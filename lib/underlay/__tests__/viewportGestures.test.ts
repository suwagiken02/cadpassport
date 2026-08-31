// ============================================================
// U-1 commit 3-fix2: 下図モーダルの拡大が「＋」「−」ボタンでしか効かなかった件。
//
// ■ 実際の原因（再現は「取り付けの再現」で行う）
// ホイールの listener を付ける useEffect が、**要素がまだ描かれていない時点で
// 1 回だけ走り、二度と再実行されなかった**。
//   ・画像のコンテナは step !== 'load' のときだけ描かれる
//   ・effect の依存は useCallback([]) の安定値だけ → 要素が現れても再実行されない
//   ・結果、addEventListener が一度も呼ばれない ＝ ホイールで何も起きない
// touch-action も passive: false も指定済みだったので、そこは原因ではなかった。
//
// ここでは「要素が無ければ何も登録されない」「現れたら登録される」を
// 取り付け関数の単位で固定する。実際のホイール・ピンチの効き方は
// ブラウザが要るので実機確認に回す。
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  POINTER_EVENTS, WHEEL_ZOOM_STEP, attachViewportGestures,
  type GestureCallbacks, type GestureTarget,
} from '../viewportGestures';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

/** 登録された内容を記録する偽の要素。 */
function fakeTarget() {
  const added: { type: string; h: (e: never) => void; opts?: { passive?: boolean } }[] = [];
  const removed: string[] = [];
  const el: GestureTarget = {
    addEventListener: (type, h, opts) => { added.push({ type, h, opts }); },
    removeEventListener: (type) => { removed.push(type); },
  };
  /** その種類のハンドラを呼ぶ。 */
  const fire = (type: string, e: unknown) => {
    for (const a of added) if (a.type === type) (a.h as (x: unknown) => void)(e);
  };
  return { el, added, removed, fire };
}

const callbacks = (): GestureCallbacks & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    onWheelZoom: (f, x, y) => calls.push(`zoom ${f.toFixed(3)} @${x},${y}`),
    onPointerDown: (e) => calls.push(`down ${e.pointerId}`),
    onPointerMove: (e) => calls.push(`move ${e.pointerId}`),
    onPointerEnd: (e) => calls.push(`end ${e.pointerId}`),
  };
};

const wheel = (deltaY: number, clientX = 10, clientY = 20) =>
  ({ deltaY, clientX, clientY, preventDefault: vi.fn() });
const pointer = (pointerId: number, pointerType = 'touch') =>
  ({ pointerId, pointerType, clientX: 0, clientY: 0, preventDefault: vi.fn() });

// ============================================================
describe('不具合の再現 — 要素が無い時点で取り付けようとすると、何も登録されない', () => {
  it('null に取り付けても addEventListener は 1 回も呼ばれない', () => {
    const cb = callbacks();
    const off = attachViewportGestures(null, cb);
    // これが起きていた。以後どれだけホイールを回しても何も起きない。
    expect(typeof off).toBe('function');
    expect(() => off()).not.toThrow();
  });

  it('旧経路の再現: 依存が変わらない effect は、要素が現れても取り付け直さない', () => {
    // 「マウント時に 1 回だけ実行 → そのとき要素は null」という順序をなぞる
    const ref: { current: GestureTarget | null } = { current: null };
    const cb = callbacks();
    const runEffectOnce = () => attachViewportGestures(ref.current, cb);

    const off = runEffectOnce();          // ① マウント時（コンテナはまだ描かれていない）
    const t = fakeTarget();
    ref.current = t.el;                    // ② 画像を選んでコンテナが描かれた
    // ③ しかし依存が変わらないので effect は再実行されない
    expect(t.added).toHaveLength(0);       // ＝ ホイールもポインタも登録されないまま
    off();
  });

  it('直したあと: 要素が現れた時点で取り付け直せば登録される', () => {
    const ref: { current: GestureTarget | null } = { current: null };
    const cb = callbacks();
    attachViewportGestures(ref.current, cb);   // ① まだ無い
    const t = fakeTarget();
    ref.current = t.el;
    attachViewportGestures(ref.current, cb);   // ② 現れたので取り付け直す（callback ref 経路）
    expect(t.added.map((a) => a.type).sort())
      .toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel']);
  });
});

// ============================================================
describe('登録の仕方', () => {
  it('ホイールとポインタ 4 種を登録する', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks());
    expect(t.added.map((a) => a.type)).toEqual(['wheel', ...POINTER_EVENTS]);
  });

  it('すべて passive: false（preventDefault が効く）', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks());
    for (const a of t.added) expect(a.opts?.passive, a.type).toBe(false);
  });

  it('後始末で全部外れる', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks())();
    expect(t.removed.sort()).toEqual(['pointercancel', 'pointerdown', 'pointermove', 'pointerup', 'wheel']);
  });
});

// ============================================================
describe('ホイール', () => {
  it('上へ回すと拡大、下へ回すと縮小', () => {
    const t = fakeTarget();
    const cb = callbacks();
    attachViewportGestures(t.el, cb);
    t.fire('wheel', wheel(-100));
    t.fire('wheel', wheel(100));
    expect(cb.calls[0]).toBe(`zoom ${WHEEL_ZOOM_STEP.toFixed(3)} @10,20`);
    expect(cb.calls[1]).toBe(`zoom ${(1 / WHEEL_ZOOM_STEP).toFixed(3)} @10,20`);
  });

  it('カーソルの位置をそのまま渡す（そこを中心に拡大するため）', () => {
    const t = fakeTarget();
    const cb = callbacks();
    attachViewportGestures(t.el, cb);
    t.fire('wheel', wheel(-100, 333, 444));
    expect(cb.calls[0]).toContain('@333,444');
  });

  it('ページごとスクロールさせない（preventDefault を呼ぶ）', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks());
    const e = wheel(-100);
    t.fire('wheel', e);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

// ============================================================
describe('ポインタ', () => {
  it('押す・動かす・離す・取り消しが届く', () => {
    const t = fakeTarget();
    const cb = callbacks();
    attachViewportGestures(t.el, cb);
    t.fire('pointerdown', pointer(1));
    t.fire('pointermove', pointer(1));
    t.fire('pointerup', pointer(1));
    t.fire('pointercancel', pointer(2));
    expect(cb.calls).toEqual(['down 1', 'move 1', 'end 1', 'end 2']);
  });

  it('2 本目の指も届く（ピンチが成立する前提）', () => {
    const t = fakeTarget();
    const cb = callbacks();
    attachViewportGestures(t.el, cb);
    t.fire('pointerdown', pointer(1));
    t.fire('pointerdown', pointer(2));
    expect(cb.calls).toEqual(['down 1', 'down 2']);
  });

  it('タッチはブラウザの既定の動き（スクロール・ページ拡大）を止める', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks());
    const d = pointer(1, 'touch');
    const m = pointer(1, 'touch');
    t.fire('pointerdown', d);
    t.fire('pointermove', m);
    expect(d.preventDefault).toHaveBeenCalled();
    expect(m.preventDefault).toHaveBeenCalled();
  });

  it('マウスでは既定の動きを止めない（選択などを壊さない）', () => {
    const t = fakeTarget();
    attachViewportGestures(t.el, callbacks());
    const d = pointer(1, 'mouse');
    t.fire('pointerdown', d);
    expect(d.preventDefault).not.toHaveBeenCalled();
  });
});

// ============================================================
describe('二度と同じ穴に落ちない（取り付けの経路をソースで固定）', () => {
  const hook = read('components/underlay/useImageViewport.ts');
  const modal = read('components/underlay/UnderlayModal.tsx');

  it('要素は callback ref で受け取る（描かれた時点で分かる）', () => {
    expect(hook).toMatch(/const containerRef = useCallback\(\(node: HTMLDivElement \| null\) => setNode\(node\), \[\]\);/);
  });

  it('取り付けの effect は要素そのものに依存する', () => {
    expect(hook).toMatch(/\}, \[node\]\);/);
  });

  it('React の onWheel / onPointer\\* を使っていない（passive になるため）', () => {
    expect(modal).not.toMatch(/onWheel=/);
    expect(modal).not.toMatch(/onPointerDown=/);
    expect(hook).not.toMatch(/onWheel=/);
  });

  it('取り付けは 1 本の関数を通る（ホイールとポインタで経路が分かれない）', () => {
    expect(hook).toMatch(/attachViewportGestures\(node,/);
    expect((hook.match(/addEventListener/g) ?? [])).toHaveLength(0);
  });

  it('コンテナに touch-action: none がある（ブラウザのジェスチャに取られない）', () => {
    expect(modal).toMatch(/style=\{\{ touchAction: 'none' \}\}/);
  });

  it('画像と印は当たり判定を持たない（コンテナがすべて受ける）', () => {
    expect(modal).toMatch(/className="absolute left-0 top-0 max-w-none pointer-events-none"/);
    expect(modal).toMatch(/className="absolute pointer-events-none/);
  });
});
