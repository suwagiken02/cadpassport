// ============================================================
// フェーズ0: 行動計測の安全装置。
//
// 計測は「本体を止めない」「個人情報を残さない」が守れて初めて価値がある。
// この 2 つはレビューでは守り切れないので、機械で止める。
// （送信そのものは本番のみ。ここではキューの中身だけを検査する）
// ============================================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { track, trackError, trackResult, __getQueueForTest, __resetForTest } from '../analytics';

describe('個人情報・図面データを載せない', () => {
  beforeEach(() => __resetForTest());

  it('禁止キー（氏名・住所・メール等）は落とす', () => {
    track('x', { name: 'ヤマダ', address: '長野県…', email: 'a@b.c', company: '諏訪技建' });
    expect(__getQueueForTest()[0].props).toEqual({});
  });

  it('長い文字列（自由入力の疑い）は落とす', () => {
    track('x', { note2: 'あ'.repeat(100), kind: 'delete' });
    expect(__getQueueForTest()[0].props).toEqual({ kind: 'delete' });
  });

  it('オブジェクト・配列（図面データの疑い）は落とす', () => {
    track('x', { points: [{ x: 1, y: 2 }], building: { id: 'b1' }, n: 3 });
    expect(__getQueueForTest()[0].props).toEqual({ n: 3 });
  });

  it('数値・真偽・短い列挙値だけが残る', () => {
    track('auto_layout_apply', { handrails: 12, conflict: false, mode: 'all' });
    expect(__getQueueForTest()[0].props).toEqual({ handrails: 12, conflict: false, mode: 'all' });
  });

  it('キー数の上限を超えたぶんは載せない', () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 30; i++) many[`k${i}`] = i;
    track('x', many);
    expect(Object.keys(__getQueueForTest()[0].props).length).toBeLessThanOrEqual(12);
  });
});

describe('本体を止めない', () => {
  beforeEach(() => __resetForTest());

  it('props が壊れていても例外を投げない', () => {
    const bad = { get boom() { throw new Error('x'); } };
    expect(() => track('x', bad as never)).not.toThrow();
  });

  it('循環参照でも例外を投げない', () => {
    const a: Record<string, unknown> = { n: 1 };
    a.self = a;
    expect(() => track('x', a)).not.toThrow();
  });
});

describe('手戻り（自動配置のあとの手直し）を数える', () => {
  beforeEach(() => __resetForTest());

  it('auto_layout_apply の後の manual_edit に回数と経過時間が付く', () => {
    track('auto_layout_apply', { handrails: 10 });
    track('manual_edit', { kind: 'delete' });
    track('manual_edit', { kind: 'add_handrail' });
    const q = __getQueueForTest();
    const edits = q.filter((e) => e.event_name === 'manual_edit');
    expect(edits).toHaveLength(2);
    expect(edits[0].props.edits_since_auto).toBe(1);
    expect(edits[1].props.edits_since_auto).toBe(2);
    expect(typeof edits[1].props.ms_since_auto).toBe('number');
  });

  it('自動配置の前の手直しには回数を付けない（手戻りではない）', () => {
    track('manual_edit', { kind: 'delete' });
    expect(__getQueueForTest()[0].props.edits_since_auto).toBeUndefined();
  });
});

describe('詰まり・エラーの記録', () => {
  beforeEach(() => __resetForTest());

  it('成否は ok 列に入る', () => {
    trackResult('drawing_save', false);
    expect(__getQueueForTest()[0].ok).toBe(false);
  });

  it('エラーは発生箇所だけを残す（例外の生文字列は載せない）', () => {
    trackError('export', 'pdf');
    const e = __getQueueForTest()[0];
    expect(e.event_name).toBe('error');
    expect(e.props).toEqual({ where: 'export', kind: 'pdf' });
  });

  it('同じイベントの連続は count でまとめる（DB を叩きすぎない）', () => {
    track('manual_edit', { kind: 'delete' });
    track('manual_edit', { kind: 'delete' });
    track('manual_edit', { kind: 'delete' });
    const q = __getQueueForTest();
    expect(q).toHaveLength(1);
    expect(q[0].count).toBe(3);
  });
});
