// ============================================================
// E-8-v2h-fix: コマ格子と皿(ジャッキ上端)の関係（現場の組み方・鮎澤氏）。
//   ・支柱の 1 コマ目 = 皿から 250mm、以降 450 刻み
//   ・ジャッキ巻き（皿の可動域）= 40〜490mm
//   ・GL からのコマ高さ = 皿 + 250 + 450×(n−1)
//   ・スタートからの逆算: 皿 = スタート − 250 − 450×(n−1) が 40〜490 に入る n を選ぶ
// 旧実装の「ジャッキ上端 = GL+150 固定・そこから 450 刻み」は誤り。
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  FIRST_KOMA_OFFSET_MM, JACK_WIND_MAX_MM, JACK_WIND_MIN_MM, KOMA_PITCH_MM, POST_KOMA_SIZES,
  jackTopForStartMm, komaIndexOfStart, komaLevelsFromJackMm, komaLevelsMm,
  postSegmentsMm, railKomaLevelsMm, splitPostKoma,
} from '../komaGrid';

describe('定数（現場仕様）', () => {
  it('1 コマ目は皿+250、ピッチ 450、ジャッキ巻きは 40〜490', () => {
    expect(FIRST_KOMA_OFFSET_MM).toBe(250);
    expect(KOMA_PITCH_MM).toBe(450);
    expect([JACK_WIND_MIN_MM, JACK_WIND_MAX_MM]).toEqual([40, 490]);
  });
});

describe('jackTopForStartMm: スタートから皿を逆算', () => {
  it('現場の実例: スタート 1400 → 皿 250・3 コマ目', () => {
    expect(jackTopForStartMm(1400)).toBe(250);
    expect(komaIndexOfStart(1400)).toBe(3);
    // 皿 + 250 + 450×(3−1) = 250 + 250 + 900 = 1400
    expect(250 + FIRST_KOMA_OFFSET_MM + KOMA_PITCH_MM * 2).toBe(1400);
  });

  it('どのスタートでも皿はジャッキ巻きの可動域に入る', () => {
    for (let start = 330; start <= 3000; start += 10) {
      const jack = jackTopForStartMm(start);
      expect(jack, `start=${start}`).toBeGreaterThanOrEqual(JACK_WIND_MIN_MM);
      expect(jack, `start=${start}`).toBeLessThanOrEqual(JACK_WIND_MAX_MM);
    }
  });

  it('逆算した皿からコマを積み上げると必ずスタートに戻る', () => {
    for (let start = 330; start <= 3000; start += 10) {
      const jack = jackTopForStartMm(start);
      const n = komaIndexOfStart(start);
      expect(jack + FIRST_KOMA_OFFSET_MM + KOMA_PITCH_MM * (n - 1), `start=${start}`).toBe(start);
    }
  });

  it('スタートが 1 コマ目に届かないほど低ければ下限に丸める（規格外の保険）', () => {
    expect(jackTopForStartMm(200)).toBe(JACK_WIND_MIN_MM);
  });

  it('450 ごとに同じ皿へ戻る（n が 1 つ増えるだけ）', () => {
    expect(jackTopForStartMm(1400)).toBe(jackTopForStartMm(1400 + 450));
    expect(komaIndexOfStart(1400 + 450)).toBe(komaIndexOfStart(1400) + 1);
  });
});

describe('komaLevelsMm / komaLevelsFromJackMm', () => {
  it('皿から見たコマ列は 皿+250 起点の 450 刻み', () => {
    expect(komaLevelsFromJackMm(250, 1500)).toEqual([500, 950, 1400]);
    expect(komaLevelsFromJackMm(150, 1500)).toEqual([400, 850, 1300]);
  });

  it('上端ちょうどは含み、超えたら含まない', () => {
    expect(komaLevelsFromJackMm(250, 1400)).toEqual([500, 950, 1400]);
    expect(komaLevelsFromJackMm(250, 1399)).toEqual([500, 950]);
  });

  it('逆順・ピッチ 0 以下は空（無限ループにしない）', () => {
    expect(komaLevelsMm(1000, 500)).toEqual([]);
    expect(komaLevelsMm(0, 2000, 0)).toEqual([]);
    expect(komaLevelsMm(0, 2000, -450)).toEqual([]);
  });

  it('コマ列はスタートを必ず含む（床・手摺が同じ列に乗る）', () => {
    for (const start of [1100, 1400, 1850, 2000, 330]) {
      const jack = jackTopForStartMm(start);
      expect(komaLevelsFromJackMm(jack, start + 3600), `start=${start}`).toContain(start);
    }
  });
});

// ============================================================
// E-8-v2j: 手摺が付くコマは決まっている（従来の「全コマに手摺」は誤り）。
//   下端コマ / 上端コマ / 各作業床の +1 コマ(450=中さん)・+2 コマ(900=上さん)
// ============================================================
describe('railKomaLevelsMm: 手摺が付くコマ', () => {
  // H=5000 → スタート1400・2段・皿250。コマ列は 500 から 450 刻みで 5000 まで。
  const koma = komaLevelsFromJackMm(250, 5000);
  const floors = [1400, 3200];

  it('床2段の物件は 下端 / 各床+450・+900 / 上端 のみ', () => {
    expect(koma).toEqual([500, 950, 1400, 1850, 2300, 2750, 3200, 3650, 4100, 4550, 5000]);
    expect(railKomaLevelsMm(koma, floors)).toEqual([500, 1850, 2300, 3650, 4100, 5000]);
  });

  it('作業床そのものの高さには手摺は付かない', () => {
    const rails = railKomaLevelsMm(koma, floors);
    for (const f of floors) expect(rails).not.toContain(f);
  });

  it('手摺は必ずコマ列の上に乗る', () => {
    for (const h of railKomaLevelsMm(koma, floors)) expect(koma).toContain(h);
  });

  it('コマ列の外へははみ出さない（最上段の +900 が天端を超えても足さない）', () => {
    const rails = railKomaLevelsMm(koma, [...floors, 4550]);
    expect(Math.max(...rails)).toBeLessThanOrEqual(5000);
    expect(rails).toContain(5000);
  });

  it('コマが無ければ空', () => {
    expect(railKomaLevelsMm([], floors)).toEqual([]);
  });
});

// ============================================================
// E-8-v2j: 支柱は規格部材（8/6/4/2/1 コマ品）の組み合わせ。
//   上合わせ＝大きい部材を上に、端数の小部材を下に。大きい物から順に使う。
// ============================================================
describe('splitPostKoma: 支柱の規格部材への分割', () => {
  it('規格は 8/6/4/2/1 コマ品', () => {
    expect(POST_KOMA_SIZES).toEqual([8, 6, 4, 2, 1]);
  });

  it('現場の例どおりに割れる（下から上の並び）', () => {
    expect(splitPostKoma(10)).toEqual([2, 8]);
    expect(splitPostKoma(9)).toEqual([1, 8]);
    expect(splitPostKoma(7)).toEqual([1, 6]);
    expect(splitPostKoma(5)).toEqual([1, 4]);
    expect(splitPostKoma(3)).toEqual([1, 2]);
  });

  it('規格ちょうどなら 1 部材', () => {
    for (const n of POST_KOMA_SIZES) expect(splitPostKoma(n)).toEqual([n]);
  });

  it('大きい部材が必ず上に来る（下から昇順）', () => {
    for (let n = 1; n <= 30; n++) {
      const segs = splitPostKoma(n);
      expect(segs.reduce((a, b) => a + b, 0), `n=${n}`).toBe(n);
      expect(segs, `n=${n}`).toEqual([...segs].sort((a, b) => a - b));
      expect(segs[segs.length - 1], `n=${n}`).toBe(Math.max(...segs));
    }
  });

  it('0 以下は空', () => {
    expect(splitPostKoma(0)).toEqual([]);
    expect(splitPostKoma(-3)).toEqual([]);
  });
});

describe('postSegmentsMm: 分割した支柱の実座標', () => {
  it('部材長は 450×コマ数で、下から隙間なく積まれる', () => {
    const segs = postSegmentsMm(250, 10, 99999);
    expect(segs.map((s) => s.komaCount)).toEqual([2, 8]);
    expect(segs[0]).toMatchObject({ bottomMm: 250, topMm: 250 + 450 * 2 });
    expect(segs[1]).toMatchObject({ bottomMm: 1150, topMm: 250 + 450 * 10 });
  });

  it('最上段は天端でクリップする（描画範囲を変えない）', () => {
    const segs = postSegmentsMm(250, 10, 4000);
    expect(segs[segs.length - 1].topMm).toBe(4000);
  });

  it('継ぎ目をまたいでもコマ格子が連続する（上段の1コマ目もコマ列上）', () => {
    const jack = 250;
    const n = 14;
    const koma = komaLevelsFromJackMm(jack, jack + 450 * n);
    for (const seg of postSegmentsMm(jack, n, jack + 450 * n)) {
      expect(koma).toContain(seg.bottomMm + FIRST_KOMA_OFFSET_MM);
    }
  });

  it('コマ 0 なら段も無い', () => {
    expect(postSegmentsMm(250, 0, 5000)).toEqual([]);
  });
});
