// ============================================================
// E-8-v5c commit 4: 印刷プレビューの「補助線を含める」チェック。
//
// PDF / PNG / DXF は同じ画面の形式トグルなので、**チェックは 1 つ**で 3 形式に効く。
// 既定はオフ。記憶はしない（毎回オフから始まる）。
//
// 「全ページ」はページ遷移をまたいで進むため、モーダルのローカル state では消える。
// ウィザードの状態（store）に載せないと**全ページのときだけフラグが落ちる**ので、
// 両方の経路をここで固定する。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

// ============================================================
describe('チェックは 1 つで 3 形式に効く', () => {
  const modal = read('components/output/ExportModal.tsx');
  const editor = read('app/editor/[id]/page.tsx');

  it('既定はオフ', () => {
    expect(modal).toMatch(/const \[includeAids, setIncludeAids\] = useState\(false\);/);
  });

  it('チェックが 1 つだけ（形式ごとに置いていない）', () => {
    expect((modal.match(/setIncludeAids\(e\.target\.checked\)/g) ?? [])).toHaveLength(1);
    expect(modal).toMatch(/補助線を含める/);
  });

  it('PNG / DXF の経路（範囲指定なし）に渡る', () => {
    expect(modal).toMatch(/onExport\(\{ format, paperSize, scale, includeAids \}\)/);
  });

  it('「このページのみ」の PDF に渡る', () => {
    expect(modal).toMatch(/onExport\(\{ format, paperSize, scale, allPages, includeAids/);
  });

  it('「全ページ」はウィザードの状態に載る（ページ遷移で消えない）', () => {
    expect(modal).toMatch(/createWizardState\([^]*?includeAids,/);
    expect(read('lib/export/pdfWizard.ts')).toMatch(/includeAids\?: boolean;/);
  });

  it('3 形式とも handleExport でフラグを使っている', () => {
    expect(editor).toMatch(/exportToPng\(siteName, \{ includeAids: settings\.includeAids \}\)/);
    expect(editor).toMatch(/includeAids: settings\.includeAids,/);
    expect(editor).toMatch(/exportToDxf\(canvasData, siteName, \{ includeAids: settings\.includeAids \}\)/);
  });

  it('記憶しない（毎回オフから始まる）', () => {
    expect(modal).not.toMatch(/localStorage[^]*?includeAids/);
  });
});
