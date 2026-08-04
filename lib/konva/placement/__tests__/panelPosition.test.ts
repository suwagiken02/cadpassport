// ============================================================
// E-8-v3c-fix5: フローティングパネルの位置。
//
// 実機症状: 立面のパレットと操作バーが同じ場所に重なり、隠れた中身を触れなかった。
// 対策の 1 つが「掴んで動かせる」で、動かした先が画面外だと二度と掴めなくなるため、
// クランプだけは pure に切り出してここで担保する（実機確認が主）。
// ============================================================
import { describe, it, expect } from 'vitest';
import { clampPanelPos, defaultPanelPos, dragPanelPos } from '../panelPosition';

const vp = { w: 1200, h: 800 };
const panel = { w: 400, h: 300 };

describe('clampPanelPos', () => {
  it('画面内ならそのまま', () => {
    expect(clampPanelPos({ x: 100, y: 200 }, panel, vp)).toEqual({ x: 100, y: 200 });
  });
  it('左上へはみ出したら余白まで戻す', () => {
    expect(clampPanelPos({ x: -500, y: -500 }, panel, vp)).toEqual({ x: 8, y: 8 });
  });
  it('右下へはみ出したらパネル全体が見える位置まで戻す', () => {
    expect(clampPanelPos({ x: 9999, y: 9999 }, panel, vp))
      .toEqual({ x: 1200 - 400 - 8, y: 800 - 300 - 8 });
  });
  it('画面よりパネルが大きいときは左上に寄せる（タイトルバーが必ず見える）', () => {
    const big = { w: 2000, h: 2000 };
    expect(clampPanelPos({ x: 500, y: 500 }, big, vp)).toEqual({ x: 8, y: 8 });
    expect(clampPanelPos({ x: -500, y: -500 }, big, vp)).toEqual({ x: 8, y: 8 });
  });
  it('スマホ幅でも画面内に収まる', () => {
    const phone = { w: 390, h: 844 };
    const p = clampPanelPos({ x: 380, y: 800 }, { w: 366, h: 420 }, phone);
    expect(p.x + 366).toBeLessThanOrEqual(phone.w);
    expect(p.y + 420).toBeLessThanOrEqual(phone.h);
  });
  it('何度かけても同じ（べき等）', () => {
    const once = clampPanelPos({ x: 9999, y: -9999 }, panel, vp);
    expect(clampPanelPos(once, panel, vp)).toEqual(once);
  });
});

describe('defaultPanelPos', () => {
  it('画面下寄りの中央（従来の固定位置と同じ見え方）', () => {
    expect(defaultPanelPos(panel, vp)).toEqual({ x: (1200 - 400) / 2, y: 800 - 64 - 300 });
  });
  it('縦に余裕が無い画面でも画面外へ出ない', () => {
    const p = defaultPanelPos({ w: 360, h: 700 }, { w: 390, h: 640 });
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeGreaterThanOrEqual(0);
  });
});

describe('dragPanelPos', () => {
  it('掴んだ点からの移動量ぶん動く', () => {
    expect(dragPanelPos({ x: 100, y: 100 }, { x: 150, y: 150 }, { x: 170, y: 130 }, panel, vp))
      .toEqual({ x: 120, y: 80 });
  });
  it('動かしすぎても画面内に留まる', () => {
    const p = dragPanelPos({ x: 100, y: 100 }, { x: 150, y: 150 }, { x: 5000, y: 5000 }, panel, vp);
    expect(p).toEqual({ x: 1200 - 400 - 8, y: 800 - 300 - 8 });
  });
});
