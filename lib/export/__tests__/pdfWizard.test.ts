import { describe, it, expect } from 'vitest';
import {
  advanceWizard, centerForPage, createWizardState, currentWizardPage,
  isLastWizardStep, recordCenter, wizardStepLabel,
  type PdfWizardSettings, type PdfWizardState,
} from '../pdfWizard';

// ============================================================
// E-7-fix3: 全ページ PDF の枠指定ウィザード。
// ページごとに枠中心を集め、指定しなかったページだけ建物 bbox 中心へフォールバックさせる。
// ============================================================
const SETTINGS: PdfWizardSettings = {
  paperSize: 'A4_landscape', scale: '1/100', siteName: '現場A', companyName: '会社', date: '2026/07/27',
};
const PAGES = [
  { id: 'p1', title: '平面図' },
  { id: 'p2', title: '立面図' },
  { id: 'p3', title: 'ページ3' },
];
const start = (): PdfWizardState => createWizardState(PAGES, SETTINGS, 'p1')!;

describe('createWizardState', () => {
  it('先頭ページから開始し、中心は未指定', () => {
    const w = start();
    expect(w.index).toBe(0);
    expect(currentWizardPage(w)).toEqual({ id: 'p1', title: '平面図' });
    expect(w.centers).toEqual({});
    expect(w.returnDrawingId).toBe('p1');
    expect(w.exporting).toBe(false);
  });

  it('ページ 0 件では開始できない', () => {
    expect(createWizardState([], SETTINGS, null)).toBeNull();
  });
});

describe('進行と終端判定', () => {
  it('決定するたびに次ページへ進む', () => {
    let w = start();
    expect(isLastWizardStep(w)).toBe(false);
    w = advanceWizard(w, { x: 10, y: 20 });
    expect(currentWizardPage(w)?.id).toBe('p2');
    w = advanceWizard(w, null);
    expect(currentWizardPage(w)?.id).toBe('p3');
    expect(isLastWizardStep(w)).toBe(true);
  });

  it('最後のページで決定しても index は進まない（呼び出し側が出力へ）', () => {
    let w = { ...start(), index: 2 };
    w = advanceWizard(w, { x: 1, y: 2 });
    expect(w.index).toBe(2);
    expect(w.centers.p3).toEqual({ x: 1, y: 2 });
  });

  it('1ページだけの物件は最初から最終ステップ', () => {
    const w = createWizardState([{ id: 'only', title: '平面図' }], SETTINGS, 'only')!;
    expect(isLastWizardStep(w)).toBe(true);
  });

  it('進捗ラベルは (現在/総数)', () => {
    const w = start();
    expect(wizardStepLabel(w)).toBe('(1/3)');
    expect(wizardStepLabel({ ...w, index: 2 })).toBe('(3/3)');
  });
});

describe('枠中心の収集とフォールバック', () => {
  it('ユーザーが動かしたページだけ記録する', () => {
    let w = start();
    w = advanceWizard(w, { x: 100, y: 50 });  // p1 は指定した
    w = advanceWizard(w, null);               // p2 は動かさなかった
    expect(w.centers).toEqual({ p1: { x: 100, y: 50 } });
    expect(centerForPage(w.centers, 'p1')).toEqual({ x: 100, y: 50 });
    expect(centerForPage(w.centers, 'p2')).toBeNull(); // → bbox 中心フォールバック
  });

  it('recordCenter は元のマップを壊さない', () => {
    const base = { p1: { x: 1, y: 1 } };
    const next = recordCenter(base, 'p2', { x: 2, y: 2 });
    expect(base).toEqual({ p1: { x: 1, y: 1 } });
    expect(next).toEqual({ p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } });
  });

  it('null を渡すと記録を消す（未指定＝フォールバックに戻す）', () => {
    const base = { p1: { x: 1, y: 1 } };
    expect(recordCenter(base, 'p1', null)).toEqual({});
    expect(recordCenter(base, 'nope', null)).toBe(base); // 変化なしなら同一参照
  });

  it('再訪して指定し直すと上書きされる', () => {
    let w = start();
    w = advanceWizard(w, { x: 10, y: 10 });
    const revisit = { ...w, index: 0 };
    const after = advanceWizard(revisit, { x: 99, y: 99 });
    expect(after.centers.p1).toEqual({ x: 99, y: 99 });
  });
});
