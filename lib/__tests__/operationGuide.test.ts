import { describe, it, expect } from 'vitest';
import { getOperationGuide, type GuideState } from '../operationGuide';

// R-2: 操作ガイドの状態→文言マッピング。文言は仮（鮎澤氏が後で調整）だが、全工程で出ることを固定。
const base: GuideState = {
  mode: 'view',
  isMeasuring: false,
  hasMeasurePoint1: false,
  isHeightMarkerMode: false,
  isRidgeLineMode: false,
  hasRidgeDraft: false,
  isMagnetPinMode: false,
  hasPinAnchor: false,
  isAreaDesignationMode: false,
  isReorderMode: false,
  moveSelectActive: false,
  moveSelectStep: 'category',
  buildingInputMethod: 'template',
  directionPointCount: 0,
  selectActive: true,
  isRoofDraw: false,
};
const g = (o: Partial<GuideState>) => getOperationGuide({ ...base, ...o });

describe('getOperationGuide: モードフラグ系（多段階）', () => {
  it('計測: 1点目待ち / 2点目待ち', () => {
    expect(g({ isMeasuring: true, hasMeasurePoint1: false })).toBe('計測の始点をタップしてください');
    expect(g({ isMeasuring: true, hasMeasurePoint1: true })).toBe('計測の終点をタップしてください');
  });
  it('高さマーカー', () => {
    expect(g({ isHeightMarkerMode: true })).toBe('屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
  });
  it('棟ライン: 1点目待ち / 2点目待ち', () => {
    expect(g({ isRidgeLineMode: true, hasRidgeDraft: false })).toBe('棟の始点を建物の中でタップしてください');
    expect(g({ isRidgeLineMode: true, hasRidgeDraft: true })).toBe('棟の終点をタップしてください');
  });
  it('マグネットピン: 基点待ち / 方向入力待ち', () => {
    expect(g({ isMagnetPinMode: true, hasPinAnchor: false })).toBe('ピンの基点（建物の角など）をタップしてください');
    expect(g({ isMagnetPinMode: true, hasPinAnchor: true })).toBe('ピンを立てる方向と距離を入力してください');
  });
  it('面積指定 / 並べ替え', () => {
    expect(g({ isAreaDesignationMode: true })).toBe('面積を計算する範囲を指定してください');
    expect(g({ isReorderMode: true })).toBe('並べ替える部材をタップしてください');
  });
  it('一括移動: 3ステップ', () => {
    expect(g({ moveSelectActive: true, moveSelectStep: 'category' })).toBe('移動する種類を選んでください');
    expect(g({ moveSelectActive: true, moveSelectStep: 'select' })).toBe('移動するオブジェクトをタップで選択してください');
    expect(g({ moveSelectActive: true, moveSelectStep: 'move' })).toBe('ドラッグして移動し、確定してください');
  });
});

describe('getOperationGuide: mode 系', () => {
  it('建物・壁方向入力: 始点待ち / 次の壁待ち', () => {
    expect(g({ mode: 'building', buildingInputMethod: 'direction', directionPointCount: 0 }))
      .toBe('壁の始点をタップしてください');
    expect(g({ mode: 'building', buildingInputMethod: 'direction', directionPointCount: 2 }))
      .toContain('次の壁の方向と距離');
  });
  it('建物・テンプレート', () => {
    expect(g({ mode: 'building', buildingInputMethod: 'template' })).toBe('テンプレートと寸法を入力してください');
  });
  it('部材配置: handrail / post / anti', () => {
    expect(g({ mode: 'handrail' })).toBe('手摺を配置する位置をタップしてください');
    expect(g({ mode: 'post' })).toBe('支柱を配置する位置をタップしてください');
    expect(g({ mode: 'anti' })).toBe('踏板を配置する位置をタップしてください');
  });
  it('消去', () => {
    expect(g({ mode: 'erase' })).toBe('削除するオブジェクトをタップ、またはドラッグで範囲選択してください');
  });
  it('障害物 / メモ', () => {
    expect(g({ mode: 'obstacle' })).toBe('障害物を配置する位置をタップしてください');
    expect(g({ mode: 'memo' })).toBe('メモを配置する位置をタップしてください');
  });
  it('屋根領域描き（建物方向入力を pendingTargetType=roof で流用）: 始点 / 輪郭', () => {
    expect(g({ mode: 'building', buildingInputMethod: 'direction', isRoofDraw: true, directionPointCount: 0 }))
      .toBe('屋根の始点をタップしてください');
    expect(g({ mode: 'building', buildingInputMethod: 'direction', isRoofDraw: true, directionPointCount: 3 }))
      .toContain('屋根の輪郭');
  });
  it('選択: 有効なら案内・無効なら null', () => {
    expect(g({ mode: 'select', selectActive: true })).toContain('オブジェクトをタップ');
    expect(g({ mode: 'select', selectActive: false })).toBeNull();
  });
});

describe('getOperationGuide: null（ガイド非表示）', () => {
  it('閲覧(view)は null', () => {
    expect(g({ mode: 'view' })).toBeNull();
  });
  it('move-select mode は flag 側で扱うので mode 単体では null', () => {
    expect(g({ mode: 'move-select' })).toBeNull();
  });
});

// R-1h-4: 階スコープが効くツール（高さ・棟・屋根）は、複数階の物件で対象階を文言に出す。
describe('getOperationGuide: 対象階の明示', () => {
  it('高さ・棟・屋根には (2F) が付く', () => {
    expect(g({ isHeightMarkerMode: true, targetFloor: 2 }))
      .toBe('(2F) 屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
    expect(g({ isRidgeLineMode: true, hasRidgeDraft: false, targetFloor: 2 }))
      .toBe('(2F) 棟の始点を建物の中でタップしてください');
    expect(g({ isRidgeLineMode: true, hasRidgeDraft: true, targetFloor: 2 }))
      .toBe('(2F) 棟の終点をタップしてください');
    expect(g({ mode: 'building', buildingInputMethod: 'direction', isRoofDraw: true, directionPointCount: 0, targetFloor: 2 }))
      .toBe('(2F) 屋根の始点をタップしてください');
  });

  it('1F でも複数階なら (1F) を出す（どちらの階か常に分かるように）', () => {
    expect(g({ isHeightMarkerMode: true, targetFloor: 1 }))
      .toBe('(1F) 屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
  });

  it('単一階（targetFloor 未指定/null）は従来の文言のまま', () => {
    expect(g({ isHeightMarkerMode: true })).toBe('屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
    expect(g({ isHeightMarkerMode: true, targetFloor: null })).toBe('屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
  });

  it('階スコープが効かないツールには階を出さない', () => {
    expect(g({ isMeasuring: true, targetFloor: 2 })).toBe('計測の始点をタップしてください');
    expect(g({ isMagnetPinMode: true, targetFloor: 2 })).toBe('ピンの基点（建物の角など）をタップしてください');
    // 建物の壁入力は pendingBuildingFloor で階が決まるので activeFloor は出さない。
    expect(g({ mode: 'building', buildingInputMethod: 'direction', directionPointCount: 0, targetFloor: 2 }))
      .toBe('壁の始点をタップしてください');
    expect(g({ mode: 'handrail', targetFloor: 2 })).toBe('手摺を配置する位置をタップしてください');
  });
});

describe('getOperationGuide: 優先順位（フラグ > mode）', () => {
  it('計測中は mode に関わらず計測ガイド', () => {
    expect(g({ mode: 'select', isMeasuring: true })).toBe('計測の始点をタップしてください');
  });
  it('高さマーカー中は mode=building でも高さガイド', () => {
    expect(g({ mode: 'building', isHeightMarkerMode: true })).toBe('屋根の角・辺の中央（○ ◆）をタップして高さを入力してください');
  });
});
