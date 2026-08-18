// ============================================================
// DXF 出力（平面図）。
//
// 文字列の組み立て(buildDxf)とダウンロード(exportToDxf)を分けてある。
// 組み立ては pure なので、出力内容をテストで固定できる。
//
// ■ 出す粒度の考え方 (= P-1-fix3)
//   既存部材は「その部材が持つ情報は全部出す・見た目の装飾は出さない」で揃っている:
//     手摺 → LINE 1 本（位置・長さ・向きが全部乗る。フックの鉤形は出さない）
//     支柱 → CIRCLE 1 個（位置）
//     アンチ → SOLID 1 枚（位置・幅・長さ）
//   階段もこれに倣うが、外形の矩形だけでは 600×1800 のアンチと区別がつかず、
//   P-1 の要件「上る方向が図面上ひと目で分かる」も満たせない。段板の区切りと
//   上り矢印は装飾ではなく**情報**なので出す（矢印は向きが読めるよう矢じりまで）。
// ============================================================
import { CanvasData } from '@/types';
import { gridToMm } from '@/lib/konva/gridUtils';
import { getHandrailEndpoints } from '@/lib/konva/snapUtils';
import { freePartsToPrimitives } from '@/lib/konva/freeParts';
import {
  pipeEndpointsGrid, stairArrowGrid, stairCornersGrid, stairTreadLinesGrid,
} from '@/lib/konva/planeParts';

/** DXF 本体の文字列を組み立てる（pure・DOM に触らない）。 */
export const buildDxf = (canvasData: CanvasData): string => {
  // S-1: 敷地境界線。無い図面では 1 バイトも出力を変えない。
  const sitePolygons = canvasData.sitePolygons ?? [];
  // DXFファイルを手動構築（dxf-writerのAPIに依存）
  let dxf = '';

  // ヘッダー
  dxf += '0\nSECTION\n2\nHEADER\n0\nENDSEC\n';

  // テーブル（レイヤー定義）
  dxf += '0\nSECTION\n2\nTABLES\n';
  dxf += '0\nTABLE\n2\nLAYER\n';

  const layers = [
    { name: 'BUILDING', color: 7 },
    { name: 'ROOF', color: 8 },
    { name: 'HANDRAIL', color: 5 },
    { name: 'POST', color: 7 },
    { name: 'ANTI', color: 2 },
    { name: 'OBSTACLE', color: 3 },
    { name: 'DIMENSION', color: 8 },
    { name: 'MEMO', color: 7 },
    // P-1-fix3: 平面の追加部材。部材ごとにレイヤーを分ける既存の作法に合わせる。
    { name: 'STAIR', color: 4 },
    { name: 'PIPE', color: 9 },
    // E-8-v5a: キャンバス直下の手動部材。
    { name: 'FREEPART', color: 6 },
    // S-1: 敷地境界線。**敷地があるときだけ**定義を出す。
    //   敷地を使っていない既存の図面は、出力がバイト単位で完全に不変になる。
    ...(sitePolygons.length > 0 ? [{ name: 'SITE', color: 1 }] : []),
  ];

  layers.forEach((layer) => {
    dxf += `0\nLAYER\n2\n${layer.name}\n70\n0\n62\n${layer.color}\n6\nCONTINUOUS\n`;
  });
  dxf += '0\nENDTAB\n0\nENDSEC\n';

  // エンティティ
  dxf += '0\nSECTION\n2\nENTITIES\n';

  /** グリッド座標の線分 1 本（レイヤー指定）。 */
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => {
    dxf += `0\nLINE\n8\n${layer}\n`;
    dxf += `10\n${gridToMm(x1)}\n20\n${gridToMm(y1)}\n`;
    dxf += `11\n${gridToMm(x2)}\n21\n${gridToMm(y2)}\n`;
  };

  // 建物（ポリライン）
  canvasData.buildings.forEach((b) => {
    dxf += '0\nLWPOLYLINE\n8\nBUILDING\n90\n' + b.points.length + '\n70\n1\n';
    b.points.forEach((p) => {
      dxf += `10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n`;
    });
  });

  // 敷地境界線（ポリライン）(= S-1)
  //   建物とまったく同じ粒度。閉じた外形なので LINE に割らず 1 本のポリラインで出す。
  //   線種は CONTINUOUS のまま（DXF に LTYPE テーブルを持っていない）。受け取り側の CAD で
  //   SITE レイヤーに一点鎖線を当ててもらう前提。
  sitePolygons.forEach((s) => {
    dxf += '0\nLWPOLYLINE\n8\nSITE\n90\n' + s.points.length + '\n70\n1\n';
    s.points.forEach((p) => {
      dxf += `10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n`;
    });
  });

  // 手摺（LINE）
  canvasData.handrails.forEach((h) => {
    const [start, end] = getHandrailEndpoints(h);
    dxf += '0\nLINE\n8\nHANDRAIL\n';
    dxf += `10\n${gridToMm(start.x)}\n20\n${gridToMm(start.y)}\n`;
    dxf += `11\n${gridToMm(end.x)}\n21\n${gridToMm(end.y)}\n`;
  });

  // 支柱（CIRCLE）
  canvasData.posts.forEach((p) => {
    dxf += '0\nCIRCLE\n8\nPOST\n';
    dxf += `10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n40\n24\n`;
  });

  // アンチ（SOLID）
  canvasData.antis.forEach((a) => {
    const w = a.direction === 'horizontal' ? a.lengthMm : a.width;
    const h = a.direction === 'horizontal' ? a.width : a.lengthMm;
    const x = gridToMm(a.x);
    const y = gridToMm(a.y);
    dxf += '0\nSOLID\n8\nANTI\n';
    dxf += `10\n${x}\n20\n${y}\n`;
    dxf += `11\n${x + w}\n21\n${y}\n`;
    dxf += `12\n${x}\n22\n${y + h}\n`;
    dxf += `13\n${x + w}\n23\n${y + h}\n`;
  });

  // 階段 (= P-1-fix3)。外形（閉じたポリライン）＋段板の区切り＋上り矢印。
  // 形はキャンバスに描くのと同じ幾何関数から引く＝図面と DXF が食い違わない。
  (canvasData.stairs ?? []).forEach((s) => {
    const corners = stairCornersGrid(s);
    dxf += `0\nLWPOLYLINE\n8\nSTAIR\n90\n${corners.length}\n70\n1\n`;
    corners.forEach((p) => { dxf += `10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n`; });

    stairTreadLinesGrid(s).forEach((t) => line('STAIR', t.x1, t.y1, t.x2, t.y2));

    // 上り矢印。線 1 本だけでは向きが読めないので矢じり（2 本）まで出す。
    const { from, to } = stairArrowGrid(s);
    line('STAIR', from.x, from.y, to.x, to.y);
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const head = len * 0.25, wing = head * 0.5;
    const hx = to.x - ux * head, hy = to.y - uy * head;
    line('STAIR', to.x, to.y, hx - uy * wing, hy + ux * wing);
    line('STAIR', to.x, to.y, hx + uy * wing, hy - ux * wing);
  });

  // 単管 (= P-1-fix3)。LINE 1 本に長さと角度が乗る（手摺と同じ粒度）。
  (canvasData.pipes ?? []).forEach((p) => {
    const [a, b] = pipeEndpointsGrid(p);
    line('PIPE', a.x, a.y, b.x, b.y);
  });

  // 障害物
  canvasData.obstacles.forEach((o) => {
    if (o.points && o.points.length >= 3) {
      dxf += `0\nLWPOLYLINE\n8\nOBSTACLE\n90\n${o.points.length}\n70\n1\n`;
      o.points.forEach(p => { dxf += `10\n${gridToMm(p.x)}\n20\n${gridToMm(p.y)}\n`; });
    } else if (o.type === 'custom_circle') {
      const x = gridToMm(o.x), y = gridToMm(o.y);
      const w = gridToMm(o.width), h = gridToMm(o.height);
      const r = Math.max(w, h) / 2;
      dxf += `0\nCIRCLE\n8\nOBSTACLE\n10\n${x + r}\n20\n${y + r}\n40\n${r}\n`;
    } else {
      const x = gridToMm(o.x), y = gridToMm(o.y);
      const w = gridToMm(o.width), h = gridToMm(o.height);
      dxf += '0\nLWPOLYLINE\n8\nOBSTACLE\n90\n4\n70\n1\n';
      dxf += `10\n${x}\n20\n${y}\n`;
      dxf += `10\n${x + w}\n20\n${y}\n`;
      dxf += `10\n${x + w}\n20\n${y + h}\n`;
      dxf += `10\n${x}\n20\n${y + h}\n`;
    }
  });

  // メモ（TEXT）
  canvasData.memos.forEach((m) => {
    dxf += '0\nTEXT\n8\nMEMO\n';
    dxf += `10\n${gridToMm(m.x)}\n20\n${gridToMm(m.y)}\n40\n30\n1\n${m.text}\n`;
  });

  // キャンバス直下の手動部材 (= E-8-v5a)。描かれる線をそのまま LINE で出す。
  // 座標は画面と同じグリッドなので、他の要素と同じ gridToMm でよい。
  freePartsToPrimitives(canvasData.freeParts ?? []).forEach((p) => {
    const seg = (x1: number, y1: number, x2: number, y2: number) =>
      line('FREEPART', x1, y1, x2, y2);
    if (p.kind === 'line') seg(p.x1, p.y1, p.x2, p.y2);
    else if (p.kind === 'rect') {
      seg(p.x, p.y, p.x + p.w, p.y);
      seg(p.x + p.w, p.y, p.x + p.w, p.y + p.h);
      seg(p.x + p.w, p.y + p.h, p.x, p.y + p.h);
      seg(p.x, p.y + p.h, p.x, p.y);
    } else if (p.kind === 'polygon' && p.points.length >= 4) {
      for (let k = 0; k < p.points.length; k += 2) {
        const n = (k + 2) % p.points.length;
        seg(p.points[k], p.points[k + 1], p.points[n], p.points[n + 1]);
      }
    }
    // circle（端キャップ）と text は線ではないので出さない。
  });

  dxf += '0\nENDSEC\n0\nEOF\n';
  return dxf;
};

export const exportToDxf = (canvasData: CanvasData, siteName: string): void => {
  const dxf = buildDxf(canvasData);

  // ダウンロード
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${siteName || '図面'}_平面図.dxf`;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
