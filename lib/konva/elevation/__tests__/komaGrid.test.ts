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
  FIRST_KOMA_OFFSET_MM, JACK_WIND_MAX_MM, JACK_WIND_MIN_MM, KOMA_PITCH_MM,
  jackTopForStartMm, komaIndexOfStart, komaLevelsFromJackMm, komaLevelsMm,
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
