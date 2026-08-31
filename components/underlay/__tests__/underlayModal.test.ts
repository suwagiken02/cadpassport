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
  UNDERLAY_ERROR_RISK_MM, UNDERLAY_ERROR_WARN_MM,
  calibrateFromTwoPoints, deviationMm, displayedToImagePx, imagePxToDisplayPercent,
  isRiskyError, measureFromAnchorMm, originForAnchor, identityTransform,
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
    // (1) で「赤なら承知のうえ」も条件に加わった。近すぎたら進めない点は不変。
    expect(modal).toMatch(/disabled=\{!calib \|\| tooClose \|\|/);
  });

  it('誤差の大きさで色を変える（一目で分かる）', () => {
    // (1) で生の数値をやめ、しきい値の定数を見るようにした。色分けの意図は不変。
    expect(modal).toContain("errMm > UNDERLAY_ERROR_RISK_MM ? 'text-red-300'");
    expect(modal).toContain("errMm > UNDERLAY_ERROR_WARN_MM ? 'text-amber-300' : 'text-emerald-300'");
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
describe('3 点目の確認は「基準点からの実寸」を出す（グリッドと比べない）', () => {
  it('実寸をそのまま見せる', () => {
    expect(modal).toMatch(/measureFromAnchorMm\(anchor, checkPoint, transform\)/);
    expect(modal).toMatch(/基準点から <b>X = \{Math\.round\(measured\.xMm\)\.toLocaleString\(\)\}mm<\/b>/);
    expect(modal).toMatch(/<b>Y = \{Math\.round\(measured\.yMm\)\.toLocaleString\(\)\}mm<\/b>/);
  });

  it('グリッドとは比べない（910 モジュールで破綻しない）', () => {
    expect(modal).not.toMatch(/misalignmentMm|nearestMajorIntersection|GRID_MAJOR_STEP/);
    expect(modal).not.toMatch(/グリッドの交点から/);
  });

  it('図面の寸法と見比べるよう促している', () => {
    expect(modal).toMatch(/図面に書かれている寸法と見比べてください/);
  });

  it('期待する寸法は任意（入れなくても実寸は見える）', () => {
    expect(modal).toMatch(/図面の寸法（任意）X/);
    // 両方入っているときだけ差を出す
    expect(modal).toMatch(/if \(!expectMm\.x\.trim\(\) \|\| !expectMm\.y\.trim\(\)\) return null;/);
  });

  it('入力されたときだけ差を出す', () => {
    expect(modal).toMatch(/measured && expected \? deviationMm\(measured, expected\) : null/);
    expect(modal).toMatch(/\{gap && \(/);
  });

  it('差はどちら向きかが分かる（符号つき）', () => {
    expect(modal).toMatch(/gap\.dxMm >= 0 \? '\+' : ''/);
    expect(modal).toMatch(/gap\.dyMm >= 0 \? '\+' : ''/);
  });

  it('判断の目安を書いてある', () => {
    expect(modal).toMatch(/10mm 以下＝良好 ／ 50mm 以下＝実用 ／ 100mm 超＝撮り直しか歪み補正が必要/);
  });

  it('基準点から遠い場所を選ぶよう促している', () => {
    expect(modal).toMatch(/基準点から遠い場所/);
  });

  it('確認を省いても確定できる（強制しない）', () => {
    expect(modal).toMatch(/disabled=\{!transform \|\| !!busy\}/);
  });

  it('計算そのもの: 910 の倍数の図面で、合っていれば差が 0 になる', () => {
    // 10,010 x 7,280（すべて 910 の倍数）。グリッド基準なら大きくずれて見えるが、
    // 実寸どうしの比較なので 0 になる。
    const c = calibrateFromTwoPoints({ x: 0, y: 0 }, { x: 1000, y: 0 }, 10000)!;
    const origin = originForAnchor({ x: 0, y: 0 }, { x: 0, y: 0 }, c.scale, c.rotationDeg);
    const t = { ...identityTransform(), scale: c.scale, rotationDeg: c.rotationDeg, originGrid: origin };
    const m = measureFromAnchorMm({ x: 0, y: 0 }, { x: 1001, y: 728 }, t);
    expect(m.xMm).toBeCloseTo(10010, 6);
    expect(m.yMm).toBeCloseTo(7280, 6);
    expect(deviationMm(m, { xMm: 10010, yMm: 7280 }).distanceMm).toBeCloseTo(0, 6);
  });

  it('計算そのもの: ずれていればその値が出る', () => {
    expect(deviationMm({ xMm: 10015, yMm: 7283 }, { xMm: 10010, yMm: 7280 }).dxMm)
      .toBeCloseTo(5, 9);
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
    // (2)(3) で言い方を「背景」→「下図」に揃えた。案内する内容は不変。
    expect(modal).toMatch(/キャンバス上で下図をドラッグ/);
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
    // U-1 commit 4: ノードは残したまま visible で切る（出力側から出し分けるため）。
    expect(read('components/canvas/UnderlayLayer.tsx')).toMatch(/visible=\{!hidden\}/);
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

// ============================================================
describe('パネルの置き場所（fix3: 画面からはみ出していた件）', () => {
  // 原因: このパネルはキャンバス領域（唯一の relative な入れ物）の**外**に
  //   マウントされているのに absolute を使っていた。位置の基準になる親が無く、
  //   画面外へ出ていた。キャンバス上に浮く UI はこのアプリでは例外なく fixed。
  const page = read('app/editor/[id]/page.tsx');

  it('原因の確認: パネルは唯一の relative な入れ物の外にある', () => {
    const canvasContainer = page.indexOf('data-canvas-container className="flex-1 relative');
    expect(canvasContainer).toBeGreaterThan(0);
    // relative な入れ物は 1 つだけ
    expect((page.match(/className="flex-1 relative/g) ?? [])).toHaveLength(1);
    // パネルはそれより後ろ＝入れ子の外に置かれている
    expect(page.indexOf('<UnderlayPanel />')).toBeGreaterThan(canvasContainer);
  });

  it('fixed で置く（既存の浮く UI と同じ作法）', () => {
    expect(panel).toMatch(/className="fixed top-16 left-3 z-30/);
    expect(panel).not.toMatch(/className="absolute/);
  });

  it('幅を明示し、狭い画面でも収まる', () => {
    expect(panel).toMatch(/w-\[260px\] max-w-\[calc\(100vw-24px\)\]/);
  });

  it('縦にも収まる（背が高くなったらパネルの中でスクロールする）', () => {
    expect(panel).toMatch(/max-h-\[calc\(100vh-140px\)\] overflow-y-auto/);
  });

  it('既存のパネルと同じ書き方（幅と max-w の組み合わせ）', () => {
    const ref = read('components/scaffold/MoveSelectRangePanel.tsx');
    expect(ref).toMatch(/max-w-\[calc\(100vw-24px\)\]/);
    expect(panel).toMatch(/max-w-\[calc\(100vw-24px\)\]/);
  });

  it('他の浮く UI と場所が重ならない', () => {
    // 上中央は FloorSelector、下は縮尺表示と各種バーが使っている
    expect(read('components/toolbar/FloorSelector.tsx')).toMatch(/fixed top-2 left-1\/2/);
    expect(panel).toMatch(/top-16 left-3/);
  });

  it('既定は畳んだつまみ（出しっぱなしで図面を隠さない）', () => {
    expect(panel).toMatch(/const \[open, setOpen\] = useState\(false\);/);
    expect(panel).toMatch(/if \(!open\) \{/);
    expect(panel).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/);
  });

  it('畳んでいても状態が分かる（読み込み失敗・調整中・非表示）', () => {
    expect(panel).toMatch(/\{status === 'error' && <span className="text-red-300">!<\/span>\}/);
    expect(panel).toMatch(/\{adjusting && <span className="text-amber-400">調整中<\/span>\}/);
    expect(panel).toMatch(/\{hidden && <span className="text-dimension">非表示<\/span>\}/);
  });

  it('開いたら閉じられる', () => {
    expect(panel).toMatch(/onClick=\{\(\) => setOpen\(false\)\}/);
  });

  it('調整中に「下図の側を動かす」と案内する', () => {
    expect(panel).toMatch(/建物や足場は動きません（合わせるのは下図の側です）/);
  });
});

// ============================================================
describe('(1) 精度が低いときは、承知のうえでないと先へ進めない', () => {
  it('しきい値は 1 か所（色分けと判定で同じ値を見る）', () => {
    expect(UNDERLAY_ERROR_WARN_MM).toBe(20);
    expect(UNDERLAY_ERROR_RISK_MM).toBe(50);
    expect(isRiskyError(51)).toBe(true);
    expect(isRiskyError(50)).toBe(false);
    expect(isRiskyError(null)).toBe(false);
    expect(isRiskyError(Infinity)).toBe(false);
  });

  it('色分けも同じ定数を使う（数値が散らない）', () => {
    expect(modal).toMatch(/errMm > UNDERLAY_ERROR_RISK_MM \? 'text-red-300'/);
    expect(modal).toMatch(/errMm > UNDERLAY_ERROR_WARN_MM \? 'text-amber-300'/);
    // 生の数値で書かれていない
    expect(modal).not.toMatch(/errMm > 50|errMm > 20/);
  });

  it('赤のときだけチェックを出す', () => {
    expect(modal).toMatch(/\{risky && \(/);
    expect(modal).toMatch(/精度が低いことを承知で進む/);
  });

  it('チェックしないと次へ進めない', () => {
    expect(modal).toMatch(/disabled=\{!calib \|\| tooClose \|\| \(risky && !riskAccepted\)\}/);
  });

  it('逃げ道は残す（完全には塞がない）', () => {
    expect(modal).toMatch(/onChange=\{\(e\) => setRiskAccepted\(e\.target\.checked\)\}/);
  });

  it('押せない理由を出す（黙って無効にしない）', () => {
    expect(modal).toMatch(/2 点が近すぎます。もっと離れた 2 点を選んでください。/);
    expect(modal).toMatch(/上のチェックを入れると先へ進めます。/);
  });

  it('点を打ち直したら承知は取り消される（前の判断を持ち越さない）', () => {
    expect(modal).toMatch(/setRiskAccepted\(false\);\s*\n\s*if \(!p1 \|\| \(p1 && p2\)\)/);
    expect(modal).toMatch(/setOrientation\(null\); setRiskAccepted\(false\); \}\}/);
  });

  it('閉じたら承知も捨てる', () => {
    const body = modal.slice(modal.indexOf('const resetDraft'), modal.indexOf('// 閉じたら必ず捨てる'));
    expect(body).toContain('setRiskAccepted(false)');
  });
});

// ============================================================
describe('(2)(3) 位置合わせの案内', () => {
  it('何をクリックすればいいか具体的に書く', () => {
    expect(modal).toMatch(/建物の角をクリックしてください/);
  });

  it('押せない理由を出す（黙って無効にしない）', () => {
    expect(modal).toMatch(/disabled=\{!anchor\}/);
    expect(modal).toMatch(/\{!anchor && \(/);
    expect(modal).toMatch(/基準点をクリックしてください。/);
  });

  it('打った後に、どこへ置くかを言い直す', () => {
    expect(modal).toMatch(/\{anchor && \(/);
    expect(modal).toMatch(/この点を X = \{targetMm\.x\.toLocaleString\(\)\}mm/);
    expect(modal).toMatch(/Y = \{targetMm\.y\.toLocaleString\(\)\}mm に置きます。/);
  });

  it('下図の側を合わせると書いてある（建物は動かせない）', () => {
    expect(modal).toMatch(/建物は交点に沿って描くため動かせません。<b>合わせるのは下図の側<\/b>です。/);
  });

  it('細かい調整はキャンバス上でもできると案内する', () => {
    expect(modal).toMatch(/閉じたあとキャンバス上で下図をドラッグ/);
  });
});

// ============================================================
describe('(3) 調整中はキャンバス上にも出す', () => {
  it('位置合わせ中だけ出る', () => {
    expect(panel).toMatch(/const adjustHint = adjusting && \(/);
  });

  it('パネルを畳んでいても見える（両方の状態で描く）', () => {
    expect((panel.match(/\{adjustHint\}/g) ?? [])).toHaveLength(2);
  });

  it('どちらを動かすのかを書く', () => {
    expect(panel).toMatch(/下図をドラッグして位置を合わせます/);
    expect(panel).toMatch(/建物・足場は動きません（合わせるのは下図の側です）/);
  });

  it('狭い画面でも収まる', () => {
    expect(panel).toMatch(/fixed bottom-28 left-1\/2 -translate-x-1\/2 z-30[^"]*max-w-\[calc\(100vw-24px\)\]/);
  });

  it('パネル内の案内も残す（開いているときの手順）', () => {
    expect(panel).toMatch(/オレンジの枠をドラッグして下図を動かします。/);
  });
});
