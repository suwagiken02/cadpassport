// ============================================================
// zustand v5 の selector 安定性ガード (= E-8-v2l-hotfix3)
//
// 事故: ElevationViewLayer が
//     useCanvasStore((s) => ({ mode: s.mode, ... }))
//   のように「毎回新しいオブジェクト」を返す selector を使っていた。
//
//   zustand v5 の useStore は
//     useSyncExternalStore(subscribe, () => selector(getState()), ...)
//   で、v4 と違い selector の結果をメモ化しない。React は commit 後の passive effect で
//     updateStoreInstance → checkIfSnapshotChanged → objectIs(prev, getSnapshot())
//   を見て、違えば forceStoreRerender(SyncLane) を打つ（打ち切りガードは無い）。
//   毎回別オブジェクトなら objectIs は常に false ＝「ストアが変わり続けている」と解釈され、
//   そのコンポーネントは上限なしで再レンダリングし続ける。実機では
//   「エディタを開くと固まる／選択モードでフリーズ」として出た。
//
// 対策はプリミティブで 1 つずつ購読するか、useShallow で包むこと。
// 同じ書き方が再び入らないよう、ソースを走査して機械的に止める。
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SCAN_DIRS = ['components', 'app', 'lib', 'hooks'];
const SKIP = new Set(['node_modules', '.next', '__tests__', 'dist', 'build']);

/** 走査対象のソースファイルを集める。 */
function collect(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 毎回新しい値を作る selector の書き方。
 * `use〜Store((s) => …)` の行に出たら不安定とみなす。
 */
const UNSTABLE: { re: RegExp; why: string }[] = [
  { re: /use\w*Store\(\s*\(\w*\)\s*=>\s*\(\s*\{/, why: 'オブジェクトリテラルを返している' },
  { re: /use\w*Store\(\s*\(\w*\)\s*=>\s*\[/, why: '配列リテラルを返している' },
  { re: /use\w*Store\([^)]*=>[^;]*\?\?\s*(\[\s*\]|\{\s*\})/, why: '?? [] / ?? {} で新しい値を作っている' },
  { re: /use\w*Store\([^;]*=>[^;]*\.(filter|map|flatMap|slice|concat)\(/, why: '配列メソッドで新しい配列を作っている' },
  { re: /use\w*Store\([^;]*=>[^;]*new (Set|Map)\(/, why: '新しい Set/Map を作っている' },
];

describe('zustand selector はスナップショットが安定していること', () => {
  it('毎回新しいオブジェクト/配列を返す selector が無い', () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of collect(path.join(ROOT, dir))) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
          for (const { re, why } of UNSTABLE) {
            if (re.test(line)) {
              hits.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}:${i + 1} ${why}\n    ${line.trim()}`);
            }
          }
        });
      }
    }
    expect(
      hits,
      'zustand v5 では selector の結果がメモ化されない。毎回新しい値を返すと\n'
      + 'useSyncExternalStore が無限に再レンダリングを打ち続ける（実機フリーズ）。\n'
      + 'プリミティブで 1 つずつ購読するか useShallow で包むこと。\n\n'
      + hits.join('\n'),
    ).toEqual([]);
  });

  it('走査が空振りしていない（対象ファイルを実際に読めている）', () => {
    const files = SCAN_DIRS.flatMap((d) => collect(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('ElevationViewLayer.tsx'))).toBe(true);
  });
});
