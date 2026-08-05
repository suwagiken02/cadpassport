import { describe, it, expect, beforeEach } from 'vitest';
import { useTutorialStore } from '@/stores/tutorialStore';
import {
  TUTORIAL_STEPS,
  TOTAL_STEPS,
  downTapTarget,
  startPointTarget,
  type TutorialContext,
  type TutorialStep,
} from '@/lib/tutorial/tutorialSteps';
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
  'build-wall-up',
  'build-wall-right',
  'build-wall-down',
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

describe('tutorialSteps Phase A.6 (= 26 ステップ / 建物を操作性質別に5分割)', () => {
  it('全 26 ステップ + TOTAL_STEPS=26', () => {
    expect(TUTORIAL_STEPS.length).toBe(26);
    expect(TOTAL_STEPS).toBe(26);
  });

  it('ステップ id の順序 (= build を up/right/down/close に分割)', () => {
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
    for (const id of ['build-start', 'build-wall-up', 'build-wall-right', 'build-wall-down', 'build-close', 'height-tap']) {
      expect(stepById(id).targetSelector).toBeNull();
    }
    expect(stepById('obstacle-close').targetSelector).toBe(KUTAI_BUTTON);
  });
});

describe('iconHint / arrowTarget (= 方向ボタン誘導 vs 交点矢印)', () => {
  it('方向ボタン誘導は iconHint、 交点タップ系は arrowTarget', () => {
    expect(stepById('build-start').iconHint).toBe('👆');
    expect(stepById('build-wall-up').iconHint).toBe('↑');
    expect(stepById('build-wall-right').iconHint).toBe('→');
    expect(stepById('height-tap').iconHint).toBe('👆');
    // 交点矢印ステップは iconHint なし・arrowTarget あり
    expect(stepById('build-wall-down').iconHint).toBeUndefined();
    expect(stepById('build-close').iconHint).toBeUndefined();
    expect(typeof stepById('build-wall-down').arrowTarget).toBe('function');
    expect(typeof stepById('build-close').arrowTarget).toBe('function');
  });

  it('arrowTarget を持つのは build-wall-down / build-close のみ', () => {
    expect(TUTORIAL_STEPS.filter((s) => s.arrowTarget).map((s) => s.id)).toEqual([
      'build-wall-down',
      'build-close',
    ]);
  });
});

describe('arrowTarget 純関数 (= 矢印が指す grid 座標)', () => {
  it('downTapTarget: 正方形3000で 現在列×始点行 (= 3つ目の角)', () => {
    // start(0,0) → up(0,-300) → right(300,-300)
    const dp = [
      { x: 0, y: 0 },
      { x: 0, y: -300 },
      { x: 300, y: -300 },
    ];
    expect(downTapTarget(dp)).toEqual({ x: 300, y: 0 });
  });

  it('downTapTarget: 点が3未満なら null', () => {
    expect(downTapTarget([])).toBeNull();
    expect(downTapTarget([{ x: 0, y: 0 }, { x: 0, y: -300 }])).toBeNull();
  });

  it('startPointTarget: 始点 dp[0] を返す / 空なら null', () => {
    expect(startPointTarget([{ x: 5, y: 7 }, { x: 1, y: 2 }])).toEqual({ x: 5, y: 7 });
    expect(startPointTarget([])).toBeNull();
  });
});

describe('dimmed フラグ', () => {
  it('build 系5 + obstacle-place + height-tap + scaffold-start-confirm が dimmed=false', () => {
    const dimmedFalse = TUTORIAL_STEPS.filter((s) => s.dimmed === false).map((s) => s.id);
    expect(dimmedFalse).toEqual([
      'build-start',
      'build-wall-up',
      'build-wall-right',
      'build-wall-down',
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
  it('モーダル確定ステップは fallback なし / autolayout-place は priority=conflict-ok', () => {
    expect(stepById('scaffold-start-confirm').fallbackTargetSelector).toBeUndefined();
    expect(stepById('autolayout-place').fallbackTargetSelector).toBeUndefined();
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

describe('建物細分化 completeWhen (= directionPointsLength 段階)', () => {
  it('build-start>0 / up>=2 / right>=3 / down>=4', () => {
    const mk = (n: number) => { const c = emptyCtx(); c.directionPointsLength = n; return c; };
    expect(stepById('build-start').completeWhen!(mk(0))).toBe(false);
    expect(stepById('build-start').completeWhen!(mk(1))).toBe(true);
    expect(stepById('build-wall-up').completeWhen!(mk(1))).toBe(false);
    expect(stepById('build-wall-up').completeWhen!(mk(2))).toBe(true);
    expect(stepById('build-wall-right').completeWhen!(mk(2))).toBe(false);
    expect(stepById('build-wall-right').completeWhen!(mk(3))).toBe(true);
    expect(stepById('build-wall-down').completeWhen!(mk(3))).toBe(false);
    expect(stepById('build-wall-down').completeWhen!(mk(4))).toBe(true);
  });

  it('build-close: buildings.length>0', () => {
    expect(stepById('build-close').completeWhen!(emptyCtx())).toBe(false);
    const c = emptyCtx();
    c.canvasData.buildings = [{ id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000' }];
    expect(stepById('build-close').completeWhen!(c)).toBe(true);
  });
});

describe('completeWhen 主要ステップ', () => {
  it('settings / building-select / wallinput-tab', () => {
    const c1 = emptyCtx(); c1.settingsOpenedOnce = true;
    expect(stepById('settings').completeWhen!(c1)).toBe(true);
    const c2 = emptyCtx(); c2.showBuildingModal = true;
    expect(stepById('building-select').completeWhen!(c2)).toBe(true);
    const c3 = emptyCtx(); c3.mode = 'building';
    expect(stepById('wallinput-tab').completeWhen!(c3)).toBe(true);
  });
  it('roof-confirm / obstacle / height / scaffold / autolayout / areacalc', () => {
    const cRoof = emptyCtx();
    cRoof.canvasData.buildings = [
      { id: 'b1', type: 'polygon', points: [{ x: 0, y: 0 }], fill: '#000', roof: { roofType: 'yosemune', uniformMm: 500, northMm: null, southMm: null, eastMm: null, westMm: null } },
    ];
    expect(stepById('roof-confirm').completeWhen!(cRoof)).toBe(true);
    expect(stepById('obstacle-select').completeWhen!({ ...emptyCtx(), mode: 'obstacle' })).toBe(true);
    const cObs = emptyCtx(); cObs.canvasData.obstacles = [{ id: 'o1', type: 'ecocute', x: 0, y: 0, width: 10, height: 10 }];
    expect(stepById('obstacle-place').completeWhen!(cObs)).toBe(true);
    expect(stepById('obstacle-close').completeWhen!({ ...emptyCtx(), mode: 'obstacle' })).toBe(false);
    expect(stepById('obstacle-close').completeWhen!(emptyCtx())).toBe(true);
    expect(stepById('height-open').completeWhen!({ ...emptyCtx(), isHeightMarkerMode: true })).toBe(true);
    expect(stepById('height-tap').completeWhen!({ ...emptyCtx(), heightInputMarkerId: 'hm1' })).toBe(true);
    expect(stepById('height-ok').completeWhen!(emptyCtx())).toBe(true);
    expect(stepById('scaffold-start-open').completeWhen!({ ...emptyCtx(), showScaffoldStart: true })).toBe(true);
    const cSc = emptyCtx(); cSc.canvasData.scaffoldStart1F = { corner: 'tl' } as never;
    expect(stepById('scaffold-start-confirm').completeWhen!(cSc)).toBe(true);
    expect(stepById('autolayout-open').completeWhen!({ ...emptyCtx(), showAutoLayout: true })).toBe(true);
    expect(stepById('areacalc').completeWhen!({ ...emptyCtx(), showAreaCalcModal: true })).toBe(true);
  });
  it('autolayout-place: snapshot=null は false / 増加で true', () => {
    const fn = stepById('autolayout-place').completeWhen!;
    const nullSnap = emptyCtx();
    nullSnap.canvasData.handrails = [{ id: 'h1', x: 0, y: 0, lengthMm: 1800, direction: 'horizontal', color: '#000' }];
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
