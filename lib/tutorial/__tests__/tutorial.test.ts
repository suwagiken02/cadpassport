import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from '@/stores/tutorialStore';
import { TUTORIAL_STEPS, TOTAL_STEPS, type TutorialContext, type TutorialStep } from '@/lib/tutorial/tutorialSteps';
import type { CanvasData } from '@/types';

function emptyCanvas(): CanvasData {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [],
    roofOverhangs: [],
    obstacles: [],
    handrails: [],
    posts: [],
    antis: [],
    memos: [],
    compass: { angle: 0 },
  };
}

function emptyCtx(): TutorialContext {
  return {
    canvasData: emptyCanvas(),
    mode: 'select',
    showSettings: false,
    showSettingsPanel: false,
    showAreaCalcModal: false,
    showBuildingModal: false,
    autoOpenRoofForBuildingId: null,
    handrailsBeforeAutolayout: null,
    settingsOpenedOnce: false,
    directionPointsLength: 0,
    isHeightMarkerMode: false,
    heightInputMarkerId: null,
    showScaffoldStart: false,
    showAutoLayout: false,
  };
}

function stepById(id: string): TutorialStep {
  const s = TUTORIAL_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`step not found: ${id}`);
  return s;
}

function needsNextTargetPoll(step: TutorialStep): boolean {
  return step.completeWhen === undefined && step.completeWhenDom === undefined && step.autoAdvance === true;
}
function needsDomValuePoll(step: TutorialStep): boolean {
  return step.completeWhenDom !== undefined;
}

const KUTAI_BUTTON = '[data-tutorial-id="kutai-button"]';
const ASHIBA_BUTTON = '[data-tutorial-id="ashiba-button"]';

const EXPECTED_IDS = [
  'settings',
  'kutai-open',
  'building-select',
  'wallinput-tab',
  'build-start',
  'build-canvas',
  'roof-input',
  'roof-confirm',
  'obstacle-select',
  'obstacle-type',
  'obstacle-place',
  'obstacle-close',
  'height-open',
  'height-tap',
  'height-input',
  'height-ok',
  'scaffold-start-open',
  'scaffold-start-confirm',
  'autolayout-open',
  'autolayout-calc',
  'autolayout-place',
  'reorder',
  'areacalc',
];

describe('tutorialStore', () => {
  beforeEach(() => {
    useTutorialStore.setState({ isActive: false, currentStep: 0, handrailsBeforeAutolayout: null, settingsOpenedOnce: false });
  });

  it('start/skip/end で各 state をリセット', () => {
    useTutorialStore.getState().startTutorial();
    expect(useTutorialStore.getState().isActive).toBe(true);
    useTutorialStore.setState({ handrailsBeforeAutolayout: 5, settingsOpenedOnce: true, currentStep: 9 });
    useTutorialStore.getState().skipTutorial();
    expect(useTutorialStore.getState().currentStep).toBe(0);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBeNull();
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(false);
  });

  it('nextStep / setter 群', () => {
    useTutorialStore.getState().startTutorial();
    useTutorialStore.getState().nextStep();
    expect(useTutorialStore.getState().currentStep).toBe(1);
    useTutorialStore.getState().setHandrailsBeforeAutolayout(2);
    expect(useTutorialStore.getState().handrailsBeforeAutolayout).toBe(2);
    useTutorialStore.getState().setSettingsOpenedOnce(true);
    expect(useTutorialStore.getState().settingsOpenedOnce).toBe(true);
  });
});

describe('tutorialSteps Phase A.3 (= 23 ステップ)', () => {
  it('全 23 ステップ + TOTAL_STEPS=23', () => {
    expect(TUTORIAL_STEPS.length).toBe(23);
    expect(TOTAL_STEPS).toBe(23);
  });

  it('ステップ id の順序', () => {
    expect(TUTORIAL_STEPS.map((s) => s.id)).toEqual(EXPECTED_IDS);
  });

  it('各ステップが id / title / description / autoAdvance を持つ', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.description).toBeTruthy();
      expect(typeof step.autoAdvance).toBe('boolean');
    }
  });

  it('targetSelector は data-tutorial-id 文字列 または null', () => {
    for (const step of TUTORIAL_STEPS) {
      if (step.targetSelector !== null) {
        expect(step.targetSelector).toMatch(/data-tutorial-id/);
      }
    }
    // Konva 操作系は null
    expect(stepById('build-start').targetSelector).toBeNull();
    expect(stepById('build-canvas').targetSelector).toBeNull();
    expect(stepById('height-tap').targetSelector).toBeNull();
    // obstacle-close は躯体ボタン誘導に変更 (= Phase A.4)
    expect(stepById('obstacle-close').targetSelector).toBe(KUTAI_BUTTON);
  });
});

describe('dimmed フラグ (= 暗幕調整)', () => {
  it('build-start/build-canvas/height-tap/scaffold-start-confirm は dimmed=false', () => {
    const dimmedFalse = TUTORIAL_STEPS.filter((s) => s.dimmed === false).map((s) => s.id);
    expect(dimmedFalse).toEqual(['build-start', 'build-canvas', 'obstacle-place', 'height-tap', 'scaffold-start-confirm']);
  });

  it('それ以外は dimmed 未指定 (= 濃い暗幕)', () => {
    expect(stepById('settings').dimmed).toBeUndefined();
    expect(stepById('roof-input').dimmed).toBeUndefined();
  });
});

describe('fallbackTargetSelector', () => {
  it('kutai 系は fallback=kutai-button', () => {
    for (const id of ['building-select', 'obstacle-select', 'obstacle-type', 'height-open']) {
      expect(stepById(id).fallbackTargetSelector).toBe(KUTAI_BUTTON);
    }
  });

  it('ashiba メニュー誘導系は fallback=ashiba-button', () => {
    for (const id of ['scaffold-start-open', 'autolayout-open', 'reorder', 'areacalc']) {
      expect(stepById(id).fallbackTargetSelector).toBe(ASHIBA_BUTTON);
    }
  });

  it('「変なとこが光る」回帰: モーダル確定ステップは fallback なし (= ashiba-button に誤点滅しない)', () => {
    expect(stepById('scaffold-start-confirm').fallbackTargetSelector).toBeUndefined();
    expect(stepById('autolayout-place').fallbackTargetSelector).toBeUndefined();
    // モーダル確定ステップは固定 target を持つ
    expect(stepById('scaffold-start-confirm').targetSelector).toBe('[data-tutorial-id="scaffold-start-confirm"]');
    expect(stepById('autolayout-place').targetSelector).toBe('[data-tutorial-id="autolayout-place"]');
  });

  it('autolayout-place は priorityTargetSelector=conflict-ok (= 干渉警告時に動的ハイライト)', () => {
    expect(stepById('autolayout-place').priorityTargetSelector).toBe('[data-tutorial-id="autolayout-conflict-ok"]');
  });

  it('obstacle-close は target=kutai-button (= 躯体ボタンで閉じる誘導)', () => {
    expect(stepById('obstacle-close').targetSelector).toBe(KUTAI_BUTTON);
    expect(stepById('obstacle-close').completeWhen!({ ...emptyCtx(), mode: 'obstacle' })).toBe(false);
    expect(stepById('obstacle-close').completeWhen!(emptyCtx())).toBe(true);
  });
});

describe('ポーリング種別 / autoAdvance', () => {
  it('reorder のみ autoAdvance=false', () => {
    expect(TUTORIAL_STEPS.filter((s) => !s.autoAdvance).map((s) => s.id)).toEqual(['reorder']);
  });

  it('needsNextTargetPoll: kutai-open / obstacle-type / autolayout-calc', () => {
    expect(TUTORIAL_STEPS.filter(needsNextTargetPoll).map((s) => s.id)).toEqual([
      'kutai-open',
      'obstacle-type',
      'autolayout-calc',
    ]);
  });

  it('needsDomValuePoll: roof-input / height-input', () => {
    expect(TUTORIAL_STEPS.filter(needsDomValuePoll).map((s) => s.id)).toEqual(['roof-input', 'height-input']);
  });

  it('次ステップ target ポーリングのステップの次は非null target', () => {
    TUTORIAL_STEPS.forEach((step, i) => {
      if (needsNextTargetPoll(step)) {
        expect(TUTORIAL_STEPS[i + 1].targetSelector).not.toBeNull();
      }
    });
  });
});

describe('completeWhen 各ステップ', () => {
  it('settings', () => {
    const fn = stepById('settings').completeWhen!;
    const c = emptyCtx(); c.settingsOpenedOnce = true;
    expect(fn(c)).toBe(true);
    c.showSettings = true;
    expect(fn(c)).toBe(false);
  });

  it('building-select: showBuildingModal', () => {
    const c = emptyCtx(); c.showBuildingModal = true;
    expect(stepById('building-select').completeWhen!(c)).toBe(true);
  });

  it("wallinput-tab: mode==='building'", () => {
    const c = emptyCtx(); c.mode = 'building';
    expect(stepById('wallinput-tab').completeWhen!(c)).toBe(true);
  });

  it('build-start: directionPointsLength>0', () => {
    expect(stepById('build-start').completeWhen!(emptyCtx())).toBe(false);
    const c = emptyCtx(); c.directionPointsLength = 1;
    expect(stepById('build-start').completeWhen!(c)).toBe(true);
  });

  it('build-canvas: buildings.length>0', () => {
    const c = emptyCtx();
    c.canvasData.buildings = [{ id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' }];
    expect(stepById('build-canvas').completeWhen!(c)).toBe(true);
  });

  it('roof-input/obstacle-type/autolayout-calc は completeWhen 未定義', () => {
    expect(stepById('roof-input').completeWhen).toBeUndefined();
    expect(stepById('obstacle-type').completeWhen).toBeUndefined();
    expect(stepById('autolayout-calc').completeWhen).toBeUndefined();
  });

  it('roof-confirm: uniformMm===500', () => {
    const c = emptyCtx();
    c.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(stepById('roof-confirm').completeWhen!(c)).toBe(true);
  });

  it("obstacle-select: mode==='obstacle'", () => {
    const c = emptyCtx(); c.mode = 'obstacle';
    expect(stepById('obstacle-select').completeWhen!(c)).toBe(true);
  });

  it('obstacle-place: obstacles.length>0', () => {
    const c = emptyCtx();
    c.canvasData.obstacles = [{ id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 }];
    expect(stepById('obstacle-place').completeWhen!(c)).toBe(true);
  });

  it("obstacle-close: mode !== 'obstacle'", () => {
    const stillObstacle = emptyCtx(); stillObstacle.mode = 'obstacle';
    expect(stepById('obstacle-close').completeWhen!(stillObstacle)).toBe(false);
    expect(stepById('obstacle-close').completeWhen!(emptyCtx())).toBe(true);
  });

  it('height-open: isHeightMarkerMode', () => {
    const c = emptyCtx(); c.isHeightMarkerMode = true;
    expect(stepById('height-open').completeWhen!(c)).toBe(true);
    expect(stepById('height-open').completeWhen!(emptyCtx())).toBe(false);
  });

  it('height-tap: heightInputMarkerId != null', () => {
    const c = emptyCtx(); c.heightInputMarkerId = 'hm1';
    expect(stepById('height-tap').completeWhen!(c)).toBe(true);
    expect(stepById('height-tap').completeWhen!(emptyCtx())).toBe(false);
  });

  it('height-input は completeWhenDom を持つ', () => {
    expect(typeof stepById('height-input').completeWhenDom).toBe('function');
  });

  it('height-ok: heightInputMarkerId == null (= OK で閉じた)', () => {
    expect(stepById('height-ok').completeWhen!(emptyCtx())).toBe(true);
    const open = emptyCtx(); open.heightInputMarkerId = 'hm1';
    expect(stepById('height-ok').completeWhen!(open)).toBe(false);
  });

  it('scaffold-start-open: showScaffoldStart', () => {
    const c = emptyCtx(); c.showScaffoldStart = true;
    expect(stepById('scaffold-start-open').completeWhen!(c)).toBe(true);
  });

  it('scaffold-start-confirm: scaffoldStart1F||2F', () => {
    const c = emptyCtx(); c.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(stepById('scaffold-start-confirm').completeWhen!(c)).toBe(true);
  });

  it('autolayout-open: showAutoLayout', () => {
    const c = emptyCtx(); c.showAutoLayout = true;
    expect(stepById('autolayout-open').completeWhen!(c)).toBe(true);
  });

  it('autolayout-place: snapshot より handrails 増', () => {
    const fn = stepById('autolayout-place').completeWhen!;
    // snapshot=null は false (= 足場開始バースト中に飛ばない)
    const nullSnap = emptyCtx();
    nullSnap.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(nullSnap)).toBe(false);
    // snapshot=2, handrails=3 → true
    const inc = emptyCtx();
    inc.handrailsBeforeAutolayout = 2;
    inc.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h3', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(inc)).toBe(true);
  });

  it('areacalc: showAreaCalcModal', () => {
    const c = emptyCtx(); c.showAreaCalcModal = true;
    expect(stepById('areacalc').completeWhen!(c)).toBe(true);
  });
});

describe('step 飛びバグ回帰 (= ライブ currentStep 評価)', () => {
  function simulateBurst(startId: string, ctxFactory: () => TutorialContext, bursts: number): number {
    let idx = TUTORIAL_STEPS.findIndex((s) => s.id === startId);
    for (let i = 0; i < bursts; i++) {
      const cur = TUTORIAL_STEPS[idx];
      if (cur && cur.completeWhen && cur.completeWhen(ctxFactory())) idx += 1;
    }
    return idx;
  }

  it('wallinput-tab で mode=building 後、 連続変化でも build-start で止まる', () => {
    const result = simulateBurst('wallinput-tab', () => {
      const c = emptyCtx();
      c.mode = 'building';
      return c;
    }, 5);
    // wallinput-tab → build-start。 build-start は directionPointsLength=0 なので進まない
    expect(result).toBe(TUTORIAL_STEPS.findIndex((s) => s.id === 'build-start'));
  });
});
