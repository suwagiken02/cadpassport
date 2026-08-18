// ============================================================
// S-1 (commit 2): 敷地境界線を方向入力（キャラを方向で動かす turtle）で描く。
//
// 新しい入力方式は作らない。既存の turtle は「モード」ではなく
// pendingTargetType（描き終わったら何になるか）で分岐しており、躯体・障害物・屋根が
// すでに同じ入力を共有している。敷地はその 4 つ目として足すだけ。
//
// ここで押さえること:
//   ・既存の躯体・屋根の挙動が 1 ミリも変わらないこと
//   ・確定の経路が **2 本ある**（モーダルの自動クローズ／画面下の「確定」ボタン）ので、
//     両方に敷地の枝があること。片方だけ直す事故を止める
//   ・敷地は階を持たないので、対象階を訊かないこと
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { useCanvasStore } from '@/stores/canvasStore';
import { isPlainSelectMode, isToolActive } from '@/lib/konva/toolMode';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const modal = read('components/building/DirectionInputModal.tsx');
const editor = read('app/editor/[id]/page.tsx');
const toolbar = read('components/toolbar/ModeToolbar.tsx');
/** S-4: 手描きの起動は躯体メニューから SiteModal（入口）へ移した。 */
const siteModal = read('components/building/SiteModal.tsx');

const st = () => useCanvasStore.getState();

beforeEach(() => {
  useCanvasStore.setState({ pendingTargetType: 'building', mode: 'select' });
});

// ============================================================
describe('入口（躯体メニューの「敷地」→ 手で描く）', () => {
  it('躯体メニューに「敷地」ボタンがある', () => {
    expect(toolbar).toMatch(/<span className="text-sm font-bold">敷地<\/span>/);
  });

  // S-4: 躯体メニューは入口モーダルを開くだけ。turtle の起動は SiteModal 側へ移した。
  it('屋根とまったく同じ起動の仕方（新しいモードを作らない）', () => {
    const site = siteModal.slice(siteModal.indexOf("setPendingTargetType('site')"));
    expect(site).toMatch(/setPendingTargetType\('site'\)/);
    expect(site).toMatch(/setBuildingInputMethod\('direction'\)/);
    expect(site).toMatch(/setMode\('building'\)/);
  });

  it('描き始める前に、前回の点を消してから入る', () => {
    const site = siteModal.slice(siteModal.indexOf("setPendingTargetType('site')"));
    expect(site.slice(0, 400)).toMatch(/clearDirectionPoints\(\)/);
  });

  it('敷地は階を持たないので対象階を訊かない', () => {
    expect(siteModal).not.toMatch(/promptFloorIfMulti/);
  });

  it('屋根の起動は従来どおり（対象階を訊く）', () => {
    const roof = toolbar.slice(
      toolbar.indexOf("setPendingTargetType('roof')"),
      toolbar.indexOf('屋根</span>'),
    );
    expect(roof).toMatch(/promptFloorIfMulti\('roof'\)/);
  });
});

// ============================================================
describe('確定の経路は 2 本ある。両方に敷地の枝があること', () => {
  /** 敷地の枝: 外形をそのまま addSitePolygon して、対象種別を既定へ戻す。 */
  const siteBranch = /pendingTargetType === 'site'[^]*?addSitePolygon\(\{ id: newId, points: pts \}\)[^]*?setPendingTargetType\('building'\)/;

  it('モーダルの自動クローズ（始点に戻ったとき）', () => {
    expect(modal).toMatch(siteBranch);
  });

  it('画面下の「確定」ボタン', () => {
    expect(editor).toMatch(siteBranch);
  });

  it('どちらの経路でも、建物・障害物・屋根の枝は従来のまま', () => {
    for (const [name, src] of [['modal', modal], ['editor', editor]] as const) {
      expect(src, name).toMatch(/pendingTargetType === 'roof'/);
      expect(src, name).toMatch(/pendingTargetType === 'obstacle' && [\w.]*[pP]endingObstacleType/);
      expect(src, name).toMatch(/addBuilding\(\{ id: newId, type: 'polygon', points: pts, fill: '#3d3d3a'/);
    }
  });

  it('敷地の枝は建物より前に見る（else に落ちて建物にならない）', () => {
    for (const [name, src] of [['modal', modal], ['editor', editor]] as const) {
      expect(src.indexOf("pendingTargetType === 'site'"), name)
        .toBeLessThan(src.indexOf('addBuilding({ id: newId'));
    }
  });

  it('敷地には階も屋根も付けない', () => {
    // S-2 で `canTilt = pendingTargetType === 'site' && ...` が前方に増えたので、
    //   確定分岐だけを指す目印（`s.` 付き）で切り出す。
    const branch = modal.slice(
      modal.indexOf("s.pendingTargetType === 'site'"),
      modal.indexOf("s.pendingTargetType === 'obstacle'"),
    );
    expect(branch.length).toBeGreaterThan(20);
    expect(branch.length).toBeLessThan(400);
    expect(branch).not.toMatch(/floor|Floor|roof|Roof/);
  });
});

// ============================================================
describe('文言・色の出し分けが対象そのもので決まる', () => {
  it('boolean 判定（=== \'roof\'）が呼び出し側に残っていない', () => {
    for (const [name, src] of [['modal', modal], ['editor', editor]] as const) {
      expect(src, name).not.toMatch(/directionInputLabels\(\w*[pP]endingTargetType === 'roof'\)/);
    }
    expect(read('components/canvas/GridCanvas.tsx'))
      .not.toMatch(/directionInputColors\(pendingTargetType === 'roof'\)/);
  });

  it('対象をそのまま渡している', () => {
    expect(modal).toMatch(/directionInputLabels\(pendingTargetType\)/);
    expect(editor).toMatch(/directionInputLabels\(pendingTargetType\)/);
    expect(read('components/canvas/GridCanvas.tsx'))
      .toMatch(/directionInputColors\(pendingTargetType\)/);
  });
});

// ============================================================
describe('ツール占有の扱いは屋根と同じ', () => {
  it('敷地を描いている最中（mode=building）はツール中', () => {
    expect(isToolActive({ mode: 'building', pendingTargetType: 'site' })).toBe(true);
    expect(isToolActive({ mode: 'building', pendingTargetType: 'roof' })).toBe(true);
  });

  it('選択モードへ戻れば、対象種別が残っていてもツール中ではない', () => {
    // 屋根で実機デグレになった「中断で pendingTargetType が残る」ケースと同じ扱い
    expect(isToolActive({ mode: 'select', pendingTargetType: 'site' })).toBe(false);
    expect(isPlainSelectMode({ mode: 'select', pendingTargetType: 'site' })).toBe(true);
  });

  it('建物・障害物の扱いは従来どおり（ツール中にしない）', () => {
    expect(isToolActive({ mode: 'building', pendingTargetType: 'building' })).toBe(false);
    expect(isToolActive({ mode: 'building', pendingTargetType: 'obstacle' })).toBe(false);
  });
});

// ============================================================
describe('ストアが敷地を対象として受け付ける', () => {
  it("pendingTargetType に 'site' を入れられる", () => {
    st().setPendingTargetType('site');
    expect(st().pendingTargetType).toBe('site');
  });

  it('既定は従来どおり building', () => {
    useCanvasStore.setState({ pendingTargetType: 'site' });
    st().setMode('select');
    expect(st().pendingTargetType).toBe('building');
  });
});
