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
const ADD_WALL = '[data-tutorial-id="building-add-wall"]';

const EXPECTED_IDS = [
  'settings',
  'kutai-open',
  'building-select',
  'wallinput-tab',
  'build-start',
  'build-wall1',
  'build-wall2',
  'build-close',
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

  it('start/skip で各 state をリセット', () => {
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

describe('tutorialSteps Phase A.5 (= 25 ステップ / 建物細分化)', () => {
  it('全 25 ステップ + TOTAL_STEPS=25', () => {
    expect(TUTORIAL_STEPS.length).toBe(25);
    expect(TOTAL_STEPS).toBe(25);
  });

  it('ステップ id の順序 (= build-wall1/wall2/close を追加)', () => {
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
    expect(stepById('build-close').targetSelector).toBeNull();
    expect(stepById('height-tap').targetSelector).toBeNull();
    // build-wall1/wall2 は「壁を追加」ボタンを target
    expect(stepById('build-wall1').targetSelector).toBe(ADD_WALL);
    expect(stepById('build-wall2').targetSelector).toBe(ADD_WALL);
    // obstacle-close は躯体ボタン誘導
    expect(stepById('obstacle-close').targetSelector).toBe(KUTAI_BUTTON);
  });
});

describe('iconHint (= balloon 方向アイコン点滅誘導)', () => {
  it('Konva 操作系ステップに iconHint がある', () => {
    expect(stepById('build-start').iconHint).toBe('👆');
    expect(stepById('build-wall1').iconHint).toBe('↑');
    expect(stepById('build-wall2').iconHint).toBe('→');
    expect(stepById('build-close').iconHint).toBe('🔁');
    expect(stepById('height-tap').iconHint).toBe('👆');
  });

  it('HTML ハイライト系ステップは iconHint なし', () => {
    expect(stepById('settings').iconHint).toBeUndefined();
    expect(stepById('roof-confirm').iconHint).toBeUndefined();
    expect(stepById('autolayout-place').iconHint).toBeUndefined();
  });
});

describe('dimmed フラグ', () => {
  it('build 系 + obstacle-place + height-tap + scaffold-start-confirm が dimmed=false', () => {
    const dimmedFalse = TUTORIAL_STEPS.filter((s) => s.dimmed === false).map((s) => s.id);
    expect(dimmedFalse).toEqual([
      'build-start',
      'build-wall1',
      'build-wall2',
      'build-close',
      'obstacle-place',
      'height-tap',
      'scaffold-start-confirm',
    ]);
  });
});

describe('fallbackTargetSelector / priority', () => {
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

  it('モーダル確定ステップは fallback なし (= 誤点滅しない)', () => {
    expect(stepById('scaffold-start-confirm').fallbackTargetSelector).toBeUndefined();
    expect(stepById('autolayout-place').fallbackTargetSelector).toBeUndefined();
  });

  it('autolayout-place は priorityTargetSelector=conflict-ok', () => {
    expect(stepById('autolayout-place').priorityTargetSelector).toBe('[data-tutorial-id="autolayout-conflict-ok"]');
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
});

describe('建物細分化ステップの completeWhen', () => {
  it('build-start: directionPointsLength>0', () => {
    expect(stepById('build-start').completeWhen!(emptyCtx())).toBe(false);
    const c = emptyCtx(); c.directionPointsLength = 1;
    expect(stepById('build-start').completeWhen!(c)).toBe(true);
  });

  it('build-wall1: directionPointsLength>=2', () => {
    const c1 = emptyCtx(); c1.directionPointsLength = 1;
    expect(stepById('build-wall1').completeWhen!(c1)).toBe(false);
    const c2 = emptyCtx(); c2.directionPointsLength = 2;
    expect(stepById('build-wall1').completeWhen!(c2)).toBe(true);
  });

  it('build-wall2: directionPointsLength>=3', () => {
    const c2 = emptyCtx(); c2.directionPointsLength = 2;
    expect(stepById('build-wall2').completeWhen!(c2)).toBe(false);
    const c3 = emptyCtx(); c3.directionPointsLength = 3;
    expect(stepById('build-wall2').completeWhen!(c3)).toBe(true);
  });

  it('build-close: buildings.length>0', () => {
    expect(stepById('build-close').completeWhen!(emptyCtx())).toBe(false);
    const c = emptyCtx();
    c.canvasData.buildings = [{ id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' }];
    expect(stepById('build-close').completeWhen!(c)).toBe(true);
  });
});

describe('completeWhen 主要ステップ', () => {
  it('settings', () => {
    const c = emptyCtx(); c.settingsOpenedOnce = true;
    expect(stepById('settings').completeWhen!(c)).toBe(true);
  });
  it('building-select / wallinput-tab', () => {
    const c1 = emptyCtx(); c1.showBuildingModal = true;
    expect(stepById('building-select').completeWhen!(c1)).toBe(true);
    const c2 = emptyCtx(); c2.mode = 'building';
    expect(stepById('wallinput-tab').completeWhen!(c2)).toBe(true);
  });
  it('roof-confirm: uniformMm===500', () => {
    const c = emptyCtx();
    c.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(stepById('roof-confirm').completeWhen!(c)).toBe(true);
  });
  it('obstacle-select / obstacle-place / obstacle-close', () => {
    const c1 = emptyCtx(); c1.mode = 'obstacle';
    expect(stepById('obstacle-select').completeWhen!(c1)).toBe(true);
    const c2 = emptyCtx(); c2.canvasData.obstacles = [{ id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 }];
    expect(stepById('obstacle-place').completeWhen!(c2)).toBe(true);
    expect(stepById('obstacle-close').completeWhen!({ ...emptyCtx(), mode: 'obstacle' })).toBe(false);
    expect(stepById('obstacle-close').completeWhen!(emptyCtx())).toBe(true);
  });
  it('height-open / height-tap / height-ok', () => {
    const c1 = emptyCtx(); c1.isHeightMarkerMode = true;
    expect(stepById('height-open').completeWhen!(c1)).toBe(true);
    const c2 = emptyCtx(); c2.heightInputMarkerId = 'hm1';
    expect(stepById('height-tap').completeWhen!(c2)).toBe(true);
    expect(stepById('height-ok').completeWhen!(emptyCtx())).toBe(true);
    expect(stepById('height-ok').completeWhen!(c2)).toBe(false);
  });
  it('scaffold/autolayout/areacalc', () => {
    const c1 = emptyCtx(); c1.showScaffoldStart = true;
    expect(stepById('scaffold-start-open').completeWhen!(c1)).toBe(true);
    const c2 = emptyCtx(); c2.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(stepById('scaffold-start-confirm').completeWhen!(c2)).toBe(true);
    const c3 = emptyCtx(); c3.showAutoLayout = true;
    expect(stepById('autolayout-open').completeWhen!(c3)).toBe(true);
    const c4 = emptyCtx(); c4.showAreaCalcModal = true;
    expect(stepById('areacalc').completeWhen!(c4)).toBe(true);
  });
  it('autolayout-place: snapshot=null は false / 増加で true', () => {
    const fn = stepById('autolayout-place').completeWhen!;
    const nullSnap = emptyCtx();
    nullSnap.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(nullSnap)).toBe(false);
    const inc = emptyCtx();
    inc.handrailsBeforeAutolayout = 2;
    inc.canvasData.handrails = [
      { id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h2', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
      { id: 'h3', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' },
    ];
    expect(fn(inc)).toBe(true);
  });
});
