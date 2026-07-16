import { describe, it, expect } from 'vitest';
import { DEFAULT_ROOF_SHAPE } from '../roofDefaults';

// R-1a: 新規建物のデフォルト屋根形状は切妻(gable)。BuildingTemplateModal / RoofSettingsModal は
// この単一ソースを参照するので、ここを固定すれば両モーダルの既定が揃う。
describe('DEFAULT_ROOF_SHAPE (R-1a)', () => {
  it('デフォルトは切妻(gable)', () => {
    expect(DEFAULT_ROOF_SHAPE).toBe('gable');
  });
});
