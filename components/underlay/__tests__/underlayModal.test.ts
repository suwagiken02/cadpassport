// ============================================================
// U-1 commit 3: 合わせ込みの UI。
//
// 読み込み → 2 点クリック → 実寸入力 → 位置合わせ → ずれの確認 → 確定。
//
// ■ ここで押さえること
//   ・中断しても残骸が出ないこと（P-3 の「ゴーストが残る」と同じ種類の罠）
//   ・精度を守る仕掛け（距離・推定誤差・近すぎたら進ませない）が入っていること
//   ・平常時の当たり判定を 1 ミリも変えていないこと
// 画像の表示・クリック位置・アップロードはブラウザの API が要るので実機確認に回す。
// ここでは pure な計算と、作りの構造（ソース走査）を固定する。
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  calibrateFromTwoPoints, displayedToImagePx, imagePxToDisplayPercent, misalignmentMm,
  originForAnchor, identityTransform,
} from '@/lib/konva/underlay';
import type { CanvasData } from '@/types';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const modal = read('components/underlay/UnderlayModal.tsx');
const panel = read('components/underlay/UnderlayPanel.tsx');
const adjust = read('components/canvas/UnderlayAdjustLayer.tsx');
const grid = read('components/canvas/GridCanvas.tsx');

const st = () => useCanvasStore.getState();
const blank = (): CanvasData => ({
  version: '1.0',
  grid: { unitMm: 10, cols: 600, rows: 400 },
  buildings: [], roofOverhangs: [], obstacles: [],
  handrails: [], posts: [], antis: [], memos: [],
  compass: { angle: 0 },
} as CanvasData);

beforeEach(() => {
  st().setCanvasData(blank());
  useCanvasStore.setState({
    showUnderlayModal: false, underlayAdjusting: false, underlayHidden: false,
    underlayStatus: 'idle',
  });
});

// ============================================================
describe('表示中の画像の上のクリックを、元画像の px に直す', () => {
  const rect = { left: 100, top: 50, width: 600, height: 400 };

  it('縮小して表示していても、元の px に戻る', () => {
    // 600px 幅で表示している 3000px の画像 → 5 倍
    const p = displayedToImagePx(400, 250, rect, 3000, 2000)!;
    expect(p.x).toBeCloseTo(1500, 6);
    expect(p.y).toBeCloseTo(1000, 6);
  });

  it('左上と右下が端に対応する', () => {
    expect(displayedToImagePx(100, 50, rect, 3000, 2000)).toEqual({ x: 0, y: 0 });
    expect(displayedToImagePx(700, 450, rect, 3000, 2000)).toEqual({ x: 3000, y: 2000 });
  });

  it('丸めない（合わせ込みの精度を落とさない）', () => {
    // 割り切れない大きさ。式とビット単位で一致することを見る
    const p = displayedToImagePx(233, 177, rect, 2999, 1777)!;
    expect(p.x).toBe(((233 - 100) / 600) * 2999);
    expect(p.y).toBe(((177 - 50) / 400) * 1777);
    expect(Number.isInteger(p.x)).toBe(false);
    expect(Number.isInteger(p.y)).toBe(false);
  });

  it('大きさが取れないときは null', () => {
    expect(displayedToImagePx(0, 0, { left: 0, top: 0, width: 0, height: 0 }, 100, 100)).toBeNull();
  });

  it('印の位置は % で返る（表示の大きさに依らない）', () => {
    expect(imagePxToDisplayPercent({ x: 1500, y: 500 }, 3000, 2000))
      .toEqual({ left: 50, top: 25 });
  });

  it('大きさゼロでも落ちない', () => {
    expect(imagePxToDisplayPercent({ x: 1, y: 1 }, 0, 0)).toEqual({ left: 0, top: 0 });
  });
});

// ============================================================
describe('中断しても残骸が出ない（(b)）', () => {
  it('下書きはすべてモーダルのローカル state（ストアに書かない）', () => {
    for (const name of ['p1', 'p2', 'anchor', 'checkPoint', 'orientation', 'prepared']) {
      expect(modal, name).toMatch(new RegExp(`const \\[${name}, set`));
    }
    // 打った点や実寸をストアへ書いていない
    expect(modal).not.toMatch(/setState\(\{[^}]*p1/);
  });

  it('閉じたら下書きを全部捨てる', () => {
    expect(modal).toMatch(/useEffect\(\(\) => \{ if \(!open\) resetDraft\(\); \}, \[open, resetDraft\]\);/);
    expect(modal).toMatch(/const resetDraft = useCallback\(\(\) => \{/);
  });

  it('捨てるときに、打った点・実寸・向き・基準点・確認点すべてを戻す', () => {
    const body = modal.slice(modal.indexOf('const resetDraft'), modal.indexOf('// 閉じたら必ず捨てる'));
    for (const s of ['setP1(null)', 'setP2(null)', 'setOrientation(null)',
      'setAnchor(null)', 'setCheckPoint(null)', 'setPrepared(null)', "setStep('load')"]) {
      expect(body, s).toContain(s);
    }
  });

  it('2 点目を打つ前にやめても、Storage には何も上がらない', () => {
    // アップロードは「確定」の 1 か所だけ
    expect((modal.match(/uploadUnderlay\(/g) ?? [])).toHaveLength(1);
    expect(modal).toMatch(/const confirm = async \(\) => \{/);
  });

  it('確定するまで canvasData を触らない', () => {
    expect((modal.match(/\.setUnderlay\(/g) ?? [])).toHaveLength(1);
    const confirmBody = modal.slice(modal.indexOf('const confirm = async'));
    expect(confirmBody).toMatch(/s\.setUnderlay\(\{/);
  });

  it('モーダルで作ったローカル URL は閉じるときも画面から消えるときも解放する', () => {
    expect(modal).toMatch(/if \(prev\) URL\.revokeObjectURL\(prev\)/);
    // resetDraft（閉じたとき）と アンマウント の 2 経路
    expect((modal.match(/URL\.revokeObjectURL\(prev\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('1 点目を打ち直せる（2 点そろっていたら 1 点目から取り直す）', () => {
    expect(modal).toMatch(/if \(!p1 \|\| \(p1 && p2\)\) \{ setP1\(p\); setP2\(null\); setOrientation\(null\); return; \}/);
  });

  it('やめても画像を差し替えても、キャンバスの状態が中途半端にならない', () => {
    // 位置調整のモードは「外す」で必ず解除する
    expect(panel).toMatch(/s\(\)\.setUnderlayAdjusting\(false\);\s*s\(\)\.setUnderlay\(null\);/);
  });
});

// ============================================================
describe('精度を守る仕掛け（#5 の 3 つ）', () => {
  it('2 点の距離を出す', () => {
    expect(modal).toMatch(/2 点の間隔/);
    expect(modal).toMatch(/Math\.round\(distPx\)/);
  });

  it('推定誤差を mm で見せる', () => {
    expect(modal).toMatch(/図面の反対側で <b>約 \{Math\.round\(errMm\)\}mm<\/b> ずれる見込み/);
    expect(modal).toMatch(/estimatedErrorMm\(\s*distPx, imageSpanMm/);
  });

  it('誤差は「表示上のクリック誤差」を画像の画素へ直してから見積もる', () => {
    // 縮小表示のままだと大きく、拡大すれば小さく出る＝実態どおりの数字になる
    expect(modal).toMatch(/clickErrorImagePx\(vp\.displayScale\)/);
    // 表示倍率が変われば計算し直す
    expect(modal).toMatch(/\}, \[calib, distPx, nat\.w, nat\.h, vp\.displayScale\]\);/);
  });

  it('いまの表示倍率を数字で出す（何倍で狙ったかが分かる）', () => {
    expect(modal).toMatch(/表示倍率 \{\(vp\.displayScale \* 100\)\.toFixed\(0\)\}%/);
  });

  it('近すぎるうちは次へ進ませない', () => {
    expect(modal).toMatch(/const tooClose = !!p1 && !!p2 && !canCalibrate\(p1, p2\);/);
    expect(modal).toMatch(/disabled=\{!calib \|\| tooClose\}/);
  });

  it('誤差の大きさで色を変える（一目で分かる）', () => {
    expect(modal).toMatch(/errMm > 50 \? 'text-red-300' : errMm > 20 \? 'text-amber-300' : 'text-emerald-300'/);
  });

  it('向きは自動推定してから選ばせる（修正3）', () => {
    expect(modal).toMatch(/setOrientation\(guessOrientation\(p1, p\)\)/);
    expect(modal).toMatch(/orientation \?\? guessOrientation\(p1, p2\)/);
    expect(modal).toMatch(/横の寸法/);
    expect(modal).toMatch(/縦の寸法/);
  });

  it('できるだけ離すよう促している', () => {
    expect(modal).toMatch(/できるだけ離れた 2 点/);
  });
});

// ============================================================
describe('ずれの確認（3 点目）', () => {
  it('確認点からずれを計算して見せる', () => {
    expect(modal).toMatch(/misalignmentMm\(checkPoint, transform\)/);
    expect(modal).toMatch(/グリッドの交点から <b>約 \{Math\.round\(gap\.distanceMm\)\}mm<\/b> ずれています/);
  });

  it('X と Y のずれも出す（どちら向きか分かる）', () => {
    expect(modal).toMatch(/X \{Math\.round\(gap\.dxMm\)\}mm \/ Y \{Math\.round\(gap\.dyMm\)\}mm/);
  });

  it('判断の目安を書いてある', () => {
    expect(modal).toMatch(/10mm 以下＝良好 ／ 50mm 以下＝実用 ／ 100mm 超＝撮り直しか歪み補正が必要/);
  });

  it('最初の 2 点から遠い場所を選ぶよう促している', () => {
    expect(modal).toMatch(/最初の 2 点から遠い場所/);
  });

  it('確認を省いても確定できる（強制しない）', () => {
    expect(modal).toMatch(/disabled=\{!transform \|\| !!busy\}/);
  });

  it('計算そのもの: 合っていれば 0mm、ずらせばその値', () => {
    const c = calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 1000, y: 0 }, 10000)!;
    const origin = originForAnchor({ x: 500, y: 500 }, { x: 100, y: 100 }, c.scale, c.rotationDeg);
    const t = { ...identityTransform(), scale: c.scale, rotationDeg: c.rotationDeg, originGrid: origin };
    expect(misalignmentMm({ x: 500, y: 500 }, t).distanceMm).toBeCloseTo(0, 6);
    // 主線 1 つぶん（1000mm）の半分だけ離れた点は 500mm ずれとして出る
    const off = misalignmentMm({ x: 500, y: 500 }, { ...t, originGrid: { x: origin.x + 50, y: origin.y } });
    expect(off.distanceMm).toBeCloseTo(500, 6);
  });
});

// ============================================================
describe('位置合わせ', () => {
  it('基準点を打たないと次へ進めない', () => {
    expect(modal).toMatch(/disabled=\{!anchor\}/);
  });

  it('置き先を mm で指定できる', () => {
    expect(modal).toMatch(/置き先 X/);
    expect(modal).toMatch(/targetMm\.x \/ 10, y: targetMm\.y \/ 10/);
  });

  it('キャンバス上のドラッグでも直せる（主の操作）', () => {
    expect(modal).toMatch(/キャンバス上で背景をドラッグ/);
    expect(panel).toMatch(/位置を調整/);
  });

  it('調整中だけ透明な板が出る（平常時の当たり判定は変わらない）', () => {
    expect(adjust).toMatch(/if \(!underlay \|\| !adjusting\) return null;/);
    expect(adjust).toMatch(/<Rect/);
  });

  it('ドラッグは原点だけを動かす（縮尺と回転に触らない）', () => {
    expect(adjust).toMatch(/translateTransform\(t, \{ x: dx, y: dy \}\)/);
    expect(adjust).not.toMatch(/scale:|rotationDeg:/);
  });

  it('ドラッグでも丸めない', () => {
    expect(adjust).not.toMatch(/Math\.round|toFixed/);
  });
});

// ============================================================
describe('目で確かめる 3 つ（#4）', () => {
  it('グリッド線が下図の上に描かれる', () => {
    expect(grid.indexOf('<UnderlayLayer />')).toBeLessThan(grid.indexOf('{gridLines()}'));
  });

  it('濃さを変えられる', () => {
    expect(panel).toMatch(/type="range"/);
    expect(panel).toMatch(/setUnderlayOpacity\(Number\(e\.target\.value\) \/ 100\)/);
  });

  it('表示のオンオフで見比べられる', () => {
    expect(panel).toMatch(/setUnderlayHidden\(!hidden\)/);
    expect(read('components/canvas/UnderlayLayer.tsx'))
      .toMatch(/if \(!underlay \|\| !image \|\| hidden\) return null;/);
  });

  it('隠しても取得はやり直さない', () => {
    const layer = read('components/canvas/UnderlayLayer.tsx');
    // hidden は useEffect の依存に入っていない＝隠しても読み直さない
    expect(layer).toMatch(/\}, \[path, setUnderlayStatus\]\);/);
  });

  it('隠す状態は保存データに入れない（一時的な切り替え）', () => {
    expect(read('types/index.ts')).not.toMatch(/underlayHidden/);
    expect(read('stores/canvasStore.ts')).toMatch(/^  underlayHidden: false,$/m);
  });
});

// ============================================================
describe('ストアの状態', () => {
  it('モーダルの開閉', () => {
    st().setShowUnderlayModal(true);
    expect(st().showUnderlayModal).toBe(true);
    st().setShowUnderlayModal(false);
    expect(st().showUnderlayModal).toBe(false);
  });

  it('調整モードの切り替え', () => {
    st().setUnderlayAdjusting(true);
    expect(st().underlayAdjusting).toBe(true);
  });

  it('表示のオンオフ', () => {
    st().setUnderlayHidden(true);
    expect(st().underlayHidden).toBe(true);
  });

  it('どれも canvasData を触らない（履歴が増えない）', () => {
    const before = JSON.stringify(st().canvasData);
    const n = st().history.past.length;
    st().setShowUnderlayModal(true);
    st().setUnderlayAdjusting(true);
    st().setUnderlayHidden(true);
    expect(JSON.stringify(st().canvasData)).toBe(before);
    expect(st().history.past.length).toBe(n);
  });
});

// ============================================================
describe('入口と、既存を壊していないこと', () => {
  const toolbar = read('components/toolbar/ModeToolbar.tsx');

  it('入口は躯体メニューの中', () => {
    expect(toolbar).toMatch(/setShowUnderlayModal\(true\)/);
    expect(toolbar).toMatch(/<span className="text-sm font-bold">下図<\/span>/);
  });

  it('敷地の入口は従来どおり', () => {
    expect(toolbar).toMatch(/setShowSiteModal\(true\)/);
    expect(toolbar).toMatch(/<span className="text-sm font-bold">敷地<\/span>/);
  });

  it('下図が無ければパネルも出ない', () => {
    expect(panel).toMatch(/if \(!underlay\) return null;/);
  });

  it('下図が無ければ調整レイヤーも出ない（ノードが増えない）', () => {
    expect(adjust).toMatch(/if \(!underlay \|\| !adjusting\) return null;/);
  });

  it('読めなかった案内はパネルに出す（キャンバスの邪魔をしない）', () => {
    expect(panel).toMatch(/読み込めませんでした/);
    expect(read('components/canvas/UnderlayLayer.tsx')).not.toMatch(/読み込めませんでした/);
  });
});
