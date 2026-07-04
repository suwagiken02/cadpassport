import { describe, it, expect } from 'vitest';
import {
  DEFAULT_DIMENSION_VISIBILITY,
  parseDimensionVisibility,
  dimVisibilityItems,
} from '../dimensionVisibility';

// ============================================================
// S-5e-4: 寸法線 段別表示の parse / 項目生成の {1,2} byte 不変 + N 拡張。
// ============================================================

// 旧 pick 実装（byte 不変の基準）: 6 キーを raw から拾い、非 boolean/欠損は既定。
const oldParse = (raw: unknown) => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_DIMENSION_VISIBILITY[k]);
  return {
    roof1F: pick('roof1F'), wall1F: pick('wall1F'), scaffold1F: pick('scaffold1F'),
    roof2F: pick('roof2F'), wall2F: pick('wall2F'), scaffold2F: pick('scaffold2F'),
  };
};

describe('parseDimensionVisibility', () => {
  it('null/非オブジェクトは既定', () => {
    expect(parseDimensionVisibility(null)).toEqual(DEFAULT_DIMENSION_VISIBILITY);
    expect(parseDimensionVisibility(42)).toEqual(DEFAULT_DIMENSION_VISIBILITY);
  });
  it('{1,2}: 6 キー完全指定は旧 pick と同値', () => {
    const raw = { roof1F: false, wall1F: false, scaffold1F: true, roof2F: false, wall2F: true, scaffold2F: true };
    expect(parseDimensionVisibility(raw)).toEqual(oldParse(raw));
    expect(parseDimensionVisibility(raw)).toEqual(raw);
  });
  it('{1,2}: 部分指定・非 boolean 混在も旧 pick と同値', () => {
    const raw = { roof1F: false, wall1F: 'x', scaffold2F: true };
    expect(parseDimensionVisibility(raw)).toEqual(oldParse(raw));
  });
  it('N=3: 3F キー(boolean)を保持（未知キー通過）', () => {
    const raw = { roof1F: true, roof3F: false, scaffold3F: true };
    const out = parseDimensionVisibility(raw);
    expect(out.roof3F).toBe(false);
    expect(out.scaffold3F).toBe(true);
    // 既定 6 キーも土台として残る
    expect(out.wall2F).toBe(true);
  });
});

describe('dimVisibilityItems', () => {
  it('{1,2}(または省略): 従来 6 項目・同順・同キー・同ラベル', () => {
    const legacy = [
      { key: 'roof1F', label: '1F 屋根' }, { key: 'wall1F', label: '1F 外壁' }, { key: 'scaffold1F', label: '1F 足場' },
      { key: 'roof2F', label: '2F 屋根' }, { key: 'wall2F', label: '2F 外壁' }, { key: 'scaffold2F', label: '2F 足場' },
    ];
    for (const arg of [undefined, [] as number[], [1, 2]]) {
      const items = dimVisibilityItems(arg);
      expect(items.map(i => ({ key: i.key, label: i.label }))).toEqual(legacy);
    }
  });
  it('N=3: 9 項目（roof/wall/scaffold × 1,2,3）', () => {
    const items = dimVisibilityItems([1, 2, 3]);
    expect(items).toHaveLength(9);
    expect(items.slice(6).map(i => i.key)).toEqual(['roof3F', 'wall3F', 'scaffold3F']);
    expect(items[6]).toMatchObject({ key: 'roof3F', label: '3F 屋根', cat: 'roof' });
  });
});
