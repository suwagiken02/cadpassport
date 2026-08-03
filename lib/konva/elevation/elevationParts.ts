// ============================================================
// 立面の部材ブロック (E-8-v2a・pure・node 安全)
//
// 思想: 自動立面図は平面の自動割付と同じで「ある程度組み立てられた部材ブロックの集合」。
// 編集とは、その組み立て済みブロックを掴んで組み替えること。よって一次データは
// 「絵(primitives)」ではなく「部材ブロック(ElevationPart)」で、絵は都度そこから起こす。
//
// 部材は意味座標（何列目の足場の・何番目のスパン/支柱の・どの高さか）で位置を持つ。
// 実座標は geom（支柱位置 postXs・段構成）から都度計算するので、
// 「はまる場所にしかはまらない」がデータ構造で担保される。
//
// 建物シルエット・屋根・GL・寸法・文字は部材ではない＝背景プリミティブとして別扱い
// （文字上書き E-8c はそのまま維持）。
// ============================================================
import type { ElevationPrimitive } from '@/types';
import type { FaceElevation } from './elevationEngine';
import { faceElevationExtent, q } from './elevationToObjects';
import {
  komaLevelsFromJackMm, postSegmentsMm, pushBoard, pushBrace, pushJack, pushPost, pushRail,
} from './elevationPartStyle';
import { KOMA_PITCH_MM } from './komaGrid';

/** 部材の種類。palette に出すのは post/rail/board/jack/brace。 */
export type ElevationPartKind =
  | 'post'        // 支柱
  | 'postExt'     // 嵩上げ時の支柱延長（自動のみ・パレットには出さない）
  | 'jack'        // ジャッキ
  | 'board'       // 作業床(踏板)
  | 'rail'        // 手摺・コマ横線
  | 'raiseBoard'  // 妻面嵩上げの段違い床
  | 'raiseRail'   // 同上の手摺(+450/+900)
  | 'brace';      // 筋交（現状エンジンは生成しない＝手動追加専用）

export type ElevationPart = {
  id: string;
  kind: ElevationPartKind;
  /** 同一面の何列目の足場か（L 字の内側/外側）。 */
  scaffoldIndex: number;
  /** 自動生成か手動か。再生成時に auto は作り直し、manual は意味データで引き継ぐ。 */
  origin: 'auto' | 'manual';
  /** 支柱・ジャッキ: 支柱番号。 */
  postIndex?: number;
  /** 踏板・手摺・筋交: スパン番号（左側の支柱番号）。 */
  spanIndex?: number;
  /**
   * 縦位置(mm, GL 基準)。
   * 支柱では「その部材の下端の高さ」を意味する (= E-8-v2r)。既存支柱の天端に継ぎ足した
   * 部材はこれを持つ（自動生成の積み重ねは segmentIndex 側で表す）。
   */
  levelMm?: number;
  /**
   * 支柱の規格部材の長さ（コマ数・1/2/4/6/8）(= E-8-v2r)。
   * levelMm を持つ支柱＝継ぎ足した部材の長さ。未指定は既定長（POST_MEMBER_DEFAULT_KOMA）。
   */
  komaCount?: number;
  /** 描画レンジ（面軸グリッド）。自動分は生成時の実測（入隅切断を含む）、手動分はスパン幅。 */
  x0?: number;
  x1?: number;
  /**
   * 支柱の規格部材の段番号（0=最下段・E-8-v2j）。
   * 支柱は 8/6/4/2/1 コマ品の積み重ねなので、1 本が複数部材に分かれる。
   * 上下端は splitPostKoma の結果から都度計算する（部材ブロックは意味データだけ持つ）。
   * 未指定＝分割しない 1 本（手動追加・旧データ）。
   */
  segmentIndex?: number;
  /** 嵩上げのスロット識別（'mid0' | 'top' 等）。同じ高さの重複を避ける。 */
  slot?: string;
  /** 嵩上げ手摺のオフセット(mm)。 */
  railOffsetMm?: number;
  /**
   * 削除マーク (= E-8-v2e)。ユーザーが自動生成部材を消したことを意味データとして残す墓標。
   * 描画されず、再生成時は「同じスロットに生えてくる自動部材」を抑止する。
   * 手動追加部材の削除は配列から取り除くだけなので墓標は作らない。
   */
  removed?: boolean;
};

/** 部材を実座標へ戻すための最小限の幾何（ビューに保存する）。 */
export type ElevationPartGeometry = {
  /** ローカル原点（面軸の左端・グリッド）。 */
  minXg: number;
  scaffolds: {
    /** 支柱位置（面軸グリッド・昇順）。 */
    postXs: number[];
    jackTopMm: number;
    topRailMm: number;
    /** 作業床の高さ[](mm)。 */
    levelsMm: number[];
    /** コマ位置[](mm)。 */
    komaGridMm: number[];
  }[];
};

export type ElevationPartsBundle = {
  parts: ElevationPart[];
  geom: ElevationPartGeometry;
};

/**
 * FaceElevation の足場部分を部材ブロックへ変換する（E-8-v2a）。
 * 順序は従来の描画順（列ごとに 踏板 → 手摺 → 支柱 → ジャッキ → 嵩上げ → 支柱延長）。
 */
export function faceElevationToParts(fe: FaceElevation): ElevationPartsBundle {
  const ext = faceElevationExtent(fe);
  const geom: ElevationPartGeometry = { minXg: ext ? ext.minXg : 0, scaffolds: [] };
  const parts: ElevationPart[] = [];
  if (!ext) return { parts, geom };
  const lx = (gx: number) => gx - geom.minXg;

  fe.scaffolds.forEach((sc, si) => {
    geom.scaffolds.push({
      postXs: [...sc.postXs],
      jackTopMm: sc.levels.jackTopMm,
      topRailMm: sc.levels.topRailMm,
      levelsMm: [...sc.levels.levels],
      komaGridMm: [...sc.levels.komaGridMm],
    });
    /** その x 位置を含むスパン番号（区間 [postXs[i], postXs[i+1]]）。外なら最寄り。 */
    const spanOf = (x0: number): number => {
      for (let i = 0; i < sc.postXs.length - 1; i++) {
        if (x0 >= sc.postXs[i] - 1e-6 && x0 < sc.postXs[i + 1] - 1e-6) return i;
      }
      return Math.max(0, sc.postXs.length - 2);
    };

    for (const b of sc.boards) {
      parts.push({
        id: `board:${si}:${b.levelMm}:${q(lx(b.x0))}`, kind: 'board', scaffoldIndex: si, origin: 'auto',
        levelMm: b.levelMm, spanIndex: spanOf(b.x0), x0: b.x0, x1: b.x1,
      });
    }
    for (const r of sc.rails) {
      parts.push({
        id: `rail:${si}:${r.heightMm}:${q(lx(r.x0))}`, kind: 'rail', scaffoldIndex: si, origin: 'auto',
        levelMm: r.heightMm, spanIndex: spanOf(r.x0), x0: r.x0, x1: r.x1,
      });
    }
    // E-8-v2j: 支柱は規格部材（8/6/4/2/1 コマ品）の積み重ね。1 本の連続線ではなく
    //   ジョイントで分割された部材として持つ（上合わせ・端数の小部材を下に）。
    const segs = postSegmentsMm(sc.levels.jackTopMm, sc.levels.komaGridMm.length, sc.levels.topRailMm);
    sc.postXs.forEach((px, pi) => {
      if (segs.length === 0) {
        parts.push({ id: `post:${si}:${pi}`, kind: 'post', scaffoldIndex: si, origin: 'auto', postIndex: pi });
        return;
      }
      segs.forEach((_seg, gi) => {
        parts.push({
          id: `post:${si}:${pi}:${gi}`, kind: 'post', scaffoldIndex: si, origin: 'auto',
          postIndex: pi, segmentIndex: gi,
        });
      });
    });
    sc.postXs.forEach((px, pi) => {
      parts.push({ id: `jack:${si}:${pi}`, kind: 'jack', scaffoldIndex: si, origin: 'auto', postIndex: pi });
    });
    const postExtendTop = new Map<number, number>();
    for (const r of sc.spanRaises) {
      r.intermediateFloorsMm.forEach((fmm, fi) => {
        const slot = `mid${fi}`;
        parts.push({
          id: `raise:${si}:${r.spanIndex}:${slot}:board`, kind: 'raiseBoard', scaffoldIndex: si, origin: 'auto',
          spanIndex: r.spanIndex, levelMm: fmm, x0: r.x0, x1: r.x1, slot,
        });
        for (const off of [450, 900]) {
          parts.push({
            id: `raise:${si}:${r.spanIndex}:${slot}:rail${off}`, kind: 'raiseRail', scaffoldIndex: si, origin: 'auto',
            spanIndex: r.spanIndex, levelMm: fmm, x0: r.x0, x1: r.x1, slot, railOffsetMm: off,
          });
        }
      });
      parts.push({
        id: `raise:${si}:${r.spanIndex}:top:board`, kind: 'raiseBoard', scaffoldIndex: si, origin: 'auto',
        spanIndex: r.spanIndex, levelMm: r.raisedFloorMm, x0: r.x0, x1: r.x1, slot: 'top',
      });
      for (const off of [450, 900]) {
        parts.push({
          id: `raise:${si}:${r.spanIndex}:top:rail${off}`, kind: 'raiseRail', scaffoldIndex: si, origin: 'auto',
          spanIndex: r.spanIndex, levelMm: r.raisedFloorMm, x0: r.x0, x1: r.x1, slot: 'top', railOffsetMm: off,
        });
      }
      const top = r.raisedFloorMm + 900;
      for (const px of [r.x0, r.x1]) {
        postExtendTop.set(px, Math.max(postExtendTop.get(px) ?? sc.levels.topRailMm, top));
      }
    }
    postExtendTop.forEach((top, px) => {
      parts.push({
        id: `postExt:${si}:${q(lx(px))}`, kind: 'postExt', scaffoldIndex: si, origin: 'auto',
        levelMm: top, x0: px, x1: px,
      });
    });
  });

  return { parts, geom };
}

/** 仮想支柱の間隔(mm)。既存の支柱列を外へ延ばすときの標準スパン (= E-8-v2n)。 */
export const VIRTUAL_SPAN_MM = 1800;

/**
 * 継ぎ足した支柱の既定の長さ（コマ数）(= E-8-v2r)。
 * 規格は 8/6/4/2/1 コマ品。ドラッグで動かした部材は元の長さを引き継ぐので、
 * これが効くのはパレットから継ぎ足し位置へ直接置いたとき。1800mm＝4 コマを既定にする。
 */
export const POST_MEMBER_DEFAULT_KOMA = 4;

/**
 * その支柱位置に自動生成で積まれている支柱の「物理的な頭」の高さ(mm) (= E-8-v2s)。
 * 規格部材を積み上げた実際の上端であって、天端(topRailMm＝手摺天端の設計高さ)ではない。
 * 皿がスタート端数から逆算されるので普通は一致するが、一致を前提にしない。
 */
export function postStackTopMm(sg: ElevationPartGeometry['scaffolds'][number] | undefined): number {
  if (!sg) return 0;
  const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
  return segs.length > 0 ? segs[segs.length - 1].topMm : sg.topRailMm;
}

/**
 * その支柱部材の「下端」の高さ(mm) (= E-8-v2s)。
 * 継ぎ足した部材は levelMm、自動生成の段は segmentIndex の下端、どちらも無ければ皿。
 * ドラッグの吸着はこの下端を基準にする（指の位置で寄せると、部材の長い支柱では
 * 掴んだ位置ぶん上の候補に吸着して宙に浮く）。
 */
export function postMemberBottomMm(
  part: ElevationPart, sg: ElevationPartGeometry['scaffolds'][number] | undefined,
): number {
  if (part.levelMm != null) return part.levelMm;
  if (!sg) return 0;
  if (part.segmentIndex != null) {
    const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
    const seg = segs[part.segmentIndex];
    if (seg) return seg.bottomMm;
  }
  return sg.jackTopMm;
}

/**
 * その支柱部材の「上端」の高さ(mm) (= E-8-v2t)。
 * 継ぎ足した部材は 下端＋450×コマ数、自動生成の段は segmentIndex の上端、
 * どちらも無ければ（手動で置いた 1 本ものは）足元〜天端なので天端。
 * 手摺のコマ候補をどこまで伸ばすかの基準に使う。
 */
export function postMemberTopMm(
  part: ElevationPart, sg: ElevationPartGeometry['scaffolds'][number] | undefined,
): number {
  if (part.levelMm != null) return part.levelMm + KOMA_PITCH_MM * postMemberKomaCount(part, sg);
  if (!sg) return 0;
  if (part.segmentIndex != null) {
    const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
    const seg = segs[part.segmentIndex];
    if (seg) return seg.topMm;
  }
  return sg.topRailMm;
}

/**
 * その支柱部材の長さ（コマ数）(= E-8-v2r)。
 * 明示的な komaCount →（自動生成なら）segmentIndex の規格 → 既定 の順で決まる。
 */
export function postMemberKomaCount(
  part: ElevationPart, sg: ElevationPartGeometry['scaffolds'][number] | undefined,
): number {
  if (part.komaCount != null) return part.komaCount;
  if (sg && part.segmentIndex != null) {
    const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
    const seg = segs[part.segmentIndex];
    if (seg) return seg.komaCount;
  }
  return POST_MEMBER_DEFAULT_KOMA;
}

/**
 * 支柱番号 → 面軸グリッドの x (= E-8-v2n)。
 *
 * 既存の支柱列(postXs)の範囲外も、標準スパン 1800 ピッチで「仮想の支柱位置」として
 * 引けるようにする。実物の足場は既存の足場の外へも同じ文法で伸ばせるので、
 * 立面でも支柱の無いスパンへ部材を置けないと平面のような自由さが出ない（鮎澤氏）。
 *   index < 0            → 左端から外側へ 1800 ピッチ
 *   0..postXs.length-1   → 実在の支柱（不等間隔もそのまま）
 *   postXs.length 以上   → 右端から外側へ 1800 ピッチ
 */
export function postXAt(
  sg: ElevationPartGeometry['scaffolds'][number] | undefined, index: number,
): number | null {
  if (!sg || sg.postXs.length === 0 || !Number.isFinite(index)) return null;
  const xs = sg.postXs;
  const i = Math.round(index);
  if (i >= 0 && i < xs.length) return xs[i];
  const pitch = VIRTUAL_SPAN_MM / 10;   // 1 グリッド = 10mm
  return i < 0 ? xs[0] + i * pitch : xs[xs.length - 1] + (i - (xs.length - 1)) * pitch;
}

/** 部材の実座標（面軸グリッド）。post/jack は支柱位置から、その他は x0/x1 から。 */
function partSpanX(
  part: ElevationPart, sg: ElevationPartGeometry['scaffolds'][number] | undefined,
): { x0: number; x1: number } | null {
  if (!sg) return null;
  if (part.kind === 'post' || part.kind === 'jack') {
    const px = part.postIndex != null ? postXAt(sg, part.postIndex) : null;
    return px == null ? null : { x0: px, x1: px };
  }
  if (part.x0 != null && part.x1 != null) return { x0: part.x0, x1: part.x1 };
  // 手動追加でレンジ未指定ならスパン幅を使う（はまる場所にしかはまらない）。
  const i = part.spanIndex ?? 0;
  const a = postXAt(sg, i), b = postXAt(sg, i + 1);
  return a == null || b == null ? null : { x0: a, x1: b };
}

/**
 * 部材ブロック → 描画プリミティブ（E-8-v2a）。
 * 座標は geom から都度計算する。meta（E-8a の意味タグ・安定 id）も付け直す。
 */
export function partsToPrimitives(bundle: ElevationPartsBundle): ElevationPrimitive[] {
  const { parts, geom } = bundle;
  const lx = (gx: number) => gx - geom.minXg;
  const ly = (mm: number) => -(mm / 10);
  const out: ElevationPrimitive[] = [];

  for (const p of parts) {
    if (p.removed) continue; // E-8-v2e: 削除マーク（墓標）は描かない
    const sg = geom.scaffolds[p.scaffoldIndex];
    const span = partSpanX(p, sg);
    if (!sg || !span) continue;
    // E-8-v2f: 見た目は elevationPartStyle が single source（旧 primitives 経路と共通）。

    switch (p.kind) {
      case 'board':
        pushBoard(out, lx(span.x0), lx(span.x1), ly(p.levelMm ?? 0),
          { kind: 'board', id: p.id, heightMm: p.levelMm, x: q(lx(span.x0)) });
        break;
      case 'rail':
        pushRail(out, lx(span.x0), lx(span.x1), ly(p.levelMm ?? 0),
          { kind: 'rail', id: p.id, heightMm: p.levelMm, x: q(lx(span.x0)) });
        break;
      case 'post': {
        // E-8-v2g: コマ(450 刻みの受け金具)を支柱上に描く。列は geom が持つコマ格子。
        // E-8-v2j: segmentIndex があれば規格部材 1 本ぶんだけを描き、継ぎ目に印を出す。
        // E-8-v2r: levelMm があれば「その高さを下端にした規格部材 1 本」＝継ぎ足した支柱。
        //   下端は既存支柱の頭に載るので端キャップではなく継ぎ目のスリーブを出す。
        const segs = postSegmentsMm(sg.jackTopMm, sg.komaGridMm.length, sg.topRailMm);
        const seg = p.segmentIndex != null ? segs[p.segmentIndex] : undefined;
        const stacked = p.levelMm != null;
        const koma = p.komaCount ?? seg?.komaCount ?? POST_MEMBER_DEFAULT_KOMA;
        const bottomMm = stacked ? p.levelMm! : (seg ? seg.bottomMm : sg.jackTopMm);
        const topMm = stacked ? bottomMm + KOMA_PITCH_MM * koma : (seg ? seg.topMm : sg.topRailMm);
        const isLast = !seg || p.segmentIndex === segs.length - 1;
        pushPost(out, lx(span.x0), ly(bottomMm), ly(topMm),
          { kind: 'post', id: p.id, index: p.postIndex, x: q(lx(span.x0)), heightMm: topMm },
          {
            // 継ぎ足した部材のコマは自分の下端基準（下端から 250、以降 450 刻み＝格子は連続）
            komaYs: (stacked
              ? komaLevelsFromJackMm(bottomMm, topMm)
              : sg.komaGridMm.filter((h) => h >= bottomMm - 1e-6 && h <= topMm + 1e-6)).map(ly),
            capBottom: stacked ? false : (!seg || p.segmentIndex === 0),
            capTop: stacked ? true : isLast,
            jointY: !stacked && !isLast ? ly(topMm) : undefined,
            jointBottomY: stacked ? ly(bottomMm) : undefined,
          });
        break;
      }
      case 'postExt': {
        // 延長部も同じピッチでコマが続く（基準はジャッキ上端のまま）。
        const top = p.levelMm ?? sg.topRailMm;
        pushPost(out, lx(span.x0), ly(sg.topRailMm), ly(top),
          { kind: 'post', id: p.id, x: q(lx(span.x0)), heightMm: p.levelMm },
          { komaYs: komaLevelsFromJackMm(sg.jackTopMm, top).filter((h) => h > sg.topRailMm + 1e-6).map(ly) });
        break;
      }
      case 'jack':
        pushJack(out, lx(span.x0), ly(sg.jackTopMm), 0,
          { kind: 'jack', id: p.id, index: p.postIndex, x: q(lx(span.x0)), heightMm: sg.jackTopMm });
        break;
      case 'raiseBoard':
        pushBoard(out, lx(span.x0), lx(span.x1), ly(p.levelMm ?? 0),
          { kind: 'raise', id: p.id, heightMm: p.levelMm, index: p.spanIndex, x: q(lx(span.x0)) });
        break;
      case 'raiseRail': {
        const h = (p.levelMm ?? 0) + (p.railOffsetMm ?? 0);
        pushRail(out, lx(span.x0), lx(span.x1), ly(h),
          { kind: 'raise', id: p.id, heightMm: h, index: p.spanIndex, x: q(lx(span.x0)) });
        break;
      }
      case 'brace': {
        // 筋交は手動追加専用。スパンの対角に1本。
        const top = (p.levelMm ?? sg.topRailMm);
        const bottom = top - 1800;
        pushBrace(out, lx(span.x0), ly(bottom), lx(span.x1), ly(top),
          { kind: 'rail', id: p.id, heightMm: top, index: p.spanIndex, x: q(lx(span.x0)) });
        break;
      }
    }
  }
  return out;
}

/**
 * 部材を 1 つ消す (= E-8-v2e/v2j)。
 *   ・自動生成分 → 墓標(removed) を残す。作り直しても同じ場所に生えてこない
 *   ・手動追加分 → 配列から取り除くだけ（元から生えてこない）
 * 消去ツールでも編集バーでも同じ意味になるよう、判断はここ 1 箇所に置く。
 */
export function withPartDeleted(parts: ElevationPart[], id: string): ElevationPart[] {
  const target = parts.find((p) => p.id === id);
  if (!target) return parts;
  return target.origin === 'manual'
    ? parts.filter((p) => p.id !== id)
    : parts.map((p) => (p.id === id ? { ...p, origin: 'manual' as const, removed: true } : p));
}

/**
 * 旧世代（列全幅）の自動部材を持つビューか (= E-8-v2l)。
 *
 * v2l より前は、踏板・手摺を「列の全幅 1 本」で作っていた（実機で手摺を掴むと
 * 10800mm が 1 本として動いた）。すでに配置済みのビューは parts を保存しているので、
 * 生成側を直しても作り直さない限り古い姿のまま残る。それを検出して作り直すための判定。
 *
 * 安全側に倒す:
 *   ・手で足した/動かした部材（origin='manual'）や編集差分がある場合は「触らない」
 *     （作り直しはその場の平面から再生成するので、手の入った内容を失うため）
 *   ・作り直した後はスパン幅ぴったりになるので、この判定は false に落ちる＝再入しない
 */
export function hasLegacyFullWidthParts(
  parts: ElevationPart[] | undefined,
  geom: ElevationPartGeometry | undefined,
  hasManualEdits = false,
): boolean {
  if (!parts || !geom || parts.length === 0) return false;
  if (hasManualEdits) return false;
  if (parts.some((p) => p.origin === 'manual' || p.removed)) return false;
  return parts.some((p) => {
    if (p.kind !== 'rail' && p.kind !== 'board') return false;
    if (p.x0 == null || p.x1 == null) return false;
    const sg = geom.scaffolds[p.scaffoldIndex];
    if (!sg || sg.postXs.length < 2) return false;
    let maxSpan = 0;
    for (let i = 0; i < sg.postXs.length - 1; i++) {
      maxSpan = Math.max(maxSpan, Math.abs(sg.postXs[i + 1] - sg.postXs[i]));
    }
    // どのスパンよりも広い部材 = 複数スパンにまたがる旧世代の 1 本
    return Math.abs(p.x1 - p.x0) > maxSpan + 1e-6;
  });
}

/** 部材レイヤのプリミティブか（背景と部材の切り分け・E-8a のタグを使う）。 */
export function isPartPrimitive(p: ElevationPrimitive): boolean {
  const k = p.meta?.kind;
  return k === 'post' || k === 'jack' || k === 'board' || k === 'rail' || k === 'raise';
}
