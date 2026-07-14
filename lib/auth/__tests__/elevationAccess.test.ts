import { describe, it, expect } from 'vitest';
import { isElevationPreviewUser } from '../elevationAccess';

describe('isElevationPreviewUser: 立面プレビューの公開範囲(E-3.15)', () => {
  it('対象メール(管理者)は true', () => {
    expect(isElevationPreviewUser({ email: 'suwagiken02@gmail.com' })).toBe(true);
  });

  it('大文字/前後空白は無視して判定', () => {
    expect(isElevationPreviewUser({ email: '  Suwagiken02@Gmail.com  ' })).toBe(true);
  });

  it('非対象メールは false', () => {
    expect(isElevationPreviewUser({ email: 'other@example.com' })).toBe(false);
  });

  it('ID登録の擬似メールは false', () => {
    expect(isElevationPreviewUser({ email: 'taro@cadpassport.local' })).toBe(false);
  });

  it('email 無し/null/undefined は false', () => {
    expect(isElevationPreviewUser({ email: '' })).toBe(false);
    expect(isElevationPreviewUser({ email: null })).toBe(false);
    expect(isElevationPreviewUser(null)).toBe(false);
    expect(isElevationPreviewUser(undefined)).toBe(false);
  });
});
