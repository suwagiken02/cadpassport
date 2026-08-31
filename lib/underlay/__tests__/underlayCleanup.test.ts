// ============================================================
// U-1 commit 5: 下図の後始末。
//
// ■ いちばん大事なこと: 消す順番
// 下図のアクセス権は「その物件の持ち主か」を projects へ問い合わせて判定して
// いる。**projects の行を先に消すと、その物件の画像は誰も消せなくなり永久に残る。**
// 必ず ① Storage の画像を消す → ② drawings と projects の行を消す の順。
//
// ただし ① が失敗しても ② は進める。画像が消せないからといって物件を消せない
// 方が困るし、残るのは容量だけで整合性は壊れない。取り残しは 0012 の SQL で
// あとから機械的に回収できる。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { underlayDrawingPrefix, underlayProjectPrefix, underlayStoragePath } from '@/lib/konva/underlay';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');
const projects = read('app/projects/page.tsx');
const pageTabs = read('components/editor/PageTabsContainer.tsx');
const modal = read('components/underlay/UnderlayModal.tsx');
const storage = read('lib/underlay/underlayStorage.ts');
const sql = read('lib/supabase/migrations/0012_underlay_orphan_cleanup.sql');

/** deleteProject の中身だけ切り出す。 */
const deleteProjectBody = projects.slice(
  projects.indexOf('const deleteProject = async'),
  projects.indexOf('// Phase 3b: 共有 URL 発行'),
);

// ============================================================
describe('物件を削除するときの順番（間違えると画像が永久に残る）', () => {
  it('Storage を先に消す', () => {
    const storageAt = deleteProjectBody.indexOf('removeUnderlaysForProject');
    const rowsAt = deleteProjectBody.indexOf("from('drawings').delete()");
    expect(storageAt).toBeGreaterThan(0);
    expect(storageAt).toBeLessThan(rowsAt);
  });

  it('projects の行を消すのはいちばん最後', () => {
    expect(deleteProjectBody.indexOf("from('drawings').delete()"))
      .toBeLessThan(deleteProjectBody.indexOf("from('projects').delete()"));
    expect(deleteProjectBody.indexOf('removeUnderlaysForProject'))
      .toBeLessThan(deleteProjectBody.indexOf("from('projects').delete()"));
  });

  it('画像が消せなくても物件の削除は進める', () => {
    expect(deleteProjectBody).toMatch(/try \{[^]*?removeUnderlaysForProject\(id\);[^]*?\} catch/);
    // catch で止めず、そのあと行の削除へ進む
    expect(deleteProjectBody.indexOf('} catch'))
      .toBeLessThan(deleteProjectBody.indexOf("from('drawings').delete()"));
  });

  it('失敗を握りつぶさず記録する', () => {
    expect(deleteProjectBody).toMatch(/console\.warn\('\[deleteProject\] 下図の画像を削除できませんでした'/);
  });

  it('なぜこの順番なのかがコードに書いてある', () => {
    expect(deleteProjectBody).toMatch(/行を先に消すと誰も消せなくなり/);
  });
});

// ============================================================
describe('ページを削除するとき', () => {
  it('そのページぶんの画像を先に消す', () => {
    const storageAt = pageTabs.indexOf('removeUnderlaysForDrawing');
    const rowAt = pageTabs.indexOf("from('drawings').delete().eq('id', id)");
    expect(storageAt).toBeGreaterThan(0);
    expect(storageAt).toBeLessThan(rowAt);
  });

  it('消せなくてもページの削除は進める', () => {
    expect(pageTabs).toMatch(/removeUnderlaysForDrawing\(projectId, id\);[^]*?\} catch/);
    expect(pageTabs).toMatch(/console\.warn\('\[handleDelete\] 下図の画像を削除できませんでした'/);
  });

  it('物件が分からなければ何もしない（間違ったものを消さない）', () => {
    expect(pageTabs).toMatch(/if \(projectId\) \{[^]*?removeUnderlaysForDrawing/);
  });
});

// ============================================================
describe('画像を差し替えたとき', () => {
  it('新しいものを上げたあとに古い実体を消す（途中で失敗しても壊れない）', () => {
    const confirmBody = modal.slice(modal.indexOf('const confirm = async'));
    expect(confirmBody.indexOf('await uploadUnderlay'))
      .toBeLessThan(confirmBody.indexOf('removeUnderlayObject'));
  });

  it('同じパスなら消さない（いま使っているものを落とさない）', () => {
    expect(modal).toMatch(/existing\?\.storagePath && existing\.storagePath !== path/);
  });

  it('取っておいた画像も捨てる（前の絵が残らない）', () => {
    expect(modal).toMatch(/forgetUnderlayImage\(existing\.storagePath\)/);
  });

  it('消せなくても確定は進める', () => {
    expect(modal).toMatch(/removeUnderlayObject\(existing\.storagePath\);[^]*?\} catch/);
    expect(modal).toMatch(/console\.warn\('\[underlay\] 古い画像を削除できませんでした'/);
  });
});

// ============================================================
describe('共有で取り込んだときは下図を引き継がない', () => {
  const route = read('app/api/share/[token]/import/route.ts');

  it('参照を落とす', () => {
    expect(route).toMatch(/canvas_data: stripUnderlay\(d\.canvas_data\)/);
    expect(route).toMatch(/function stripUnderlay/);
  });

  it('underlay だけを消す（他のフィールドは触らない）', () => {
    expect(route).toMatch(/const next = \{ \.\.\.cv \};\s*delete next\.underlay;/);
  });

  it('下図を持たないデータはそのまま返す（無駄に作り直さない）', () => {
    expect(route).toMatch(/if \(!\('underlay' in cv\)\) return canvasData;/);
  });

  it('理由が書いてある', () => {
    expect(route).toMatch(/取り込んだ人には読む権限が無い/);
  });
});

// ============================================================
describe('一括削除の仕組み', () => {
  it('パスの前から順に、物件・ページで絞り込める', () => {
    const p = underlayStoragePath('p1', 'd1', 'u1', 'jpg');
    expect(p.startsWith(underlayProjectPrefix('p1'))).toBe(true);
    expect(p.startsWith(underlayDrawingPrefix('p1', 'd1'))).toBe(true);
  });

  it('別の物件のものは巻き込まない', () => {
    expect(underlayStoragePath('p2', 'd1', 'u1', 'jpg')
      .startsWith(underlayProjectPrefix('p1'))).toBe(false);
  });

  it('フォルダを掘り下げて消す（list は 1 階層しか返さない）', () => {
    expect(storage).toMatch(/for \(const sub of folders\) removed \+= await removeUnderlayPrefix\(sub\);/);
  });

  it('物件ぶん・ページぶんの出口がある', () => {
    expect(storage).toMatch(/export const removeUnderlaysForProject/);
    expect(storage).toMatch(/export const removeUnderlaysForDrawing/);
  });
});

// ============================================================
describe('取り残しを回収する SQL', () => {
  it('孤児の判定は「1 段目の物件が projects に無い」', () => {
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[1\] not in \(select id::text from projects\)/);
  });

  it('まず点検（件数と容量）ができる', () => {
    expect(sql).toMatch(/select\s*\n\s*\(storage\.foldername\(name\)\)\[1\] as project_id,/);
    expect(sql).toMatch(/pg_size_pretty/);
  });

  it('消す文はコメントアウトしてある（誤って流さない）', () => {
    expect(sql).toMatch(/-- delete from storage\.objects/);
    expect(sql).not.toMatch(/^delete from storage\.objects/m);
  });

  it('ページぶんの孤児の見つけ方も書いてある', () => {
    expect(sql).toMatch(/\(storage\.foldername\(name\)\)\[2\] not in \(select id::text from drawings\)/);
  });

  it('service_role で実行することが書いてある（RLS 越しでは孤児が見えない）', () => {
    expect(sql).toMatch(/service_role/);
  });
});
