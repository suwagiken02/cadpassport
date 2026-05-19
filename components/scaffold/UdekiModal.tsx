'use client';

import React, { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCanvasStore } from '@/stores/canvasStore';
import { Handrail, HandrailLengthMm } from '@/types';
import { mmToGrid } from '@/lib/konva/gridUtils';
import { getHandrailColor } from '@/lib/konva/handrailColors';

type Props = { onClose: () => void };

const UDEKI_LENGTHS: HandrailLengthMm[] = [600, 900, 1200];

export default function UdekiModal({ onClose }: Props) {
  const { canvasData, selectedIds, addHandrails } = useCanvasStore();
  const [lengthMm, setLengthMm] = useState<HandrailLengthMm>(600);
  const [target, setTarget] = useState<'all' | 'selected'>('all');

  const handlePlace = () => {
    const buildings = canvasData.buildings;
    if (buildings.length === 0) { onClose(); return; }

    // 対象の手摺を取得
    const handrails = target === 'all'
      ? canvasData.handrails
      : canvasData.handrails.filter(h => selectedIds.includes(h.id));

    // 建物のバウンディングボックスを計算
    const bboxes = buildings.map(b => {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of b.points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { minX, minY, maxX, maxY };
    });

    const lengthGrid = mmToGrid(lengthMm);
    const newHandrails: Handrail[] = [];

    // 既存手摺+新規手摺の重複チェック用セット
    const existingSet = new Set(
      canvasData.handrails.map(h => `${h.x},${h.y},${h.direction},${h.lengthMm}`)
    );

    // 部分的重なり判定 (= 同 direction + 同 axis + range overlap、 既存配置を優先)
    const isOverlappingExisting = (
      x: number,
      y: number,
      dir: 'horizontal' | 'vertical',
      lenMm: number
    ): boolean => {
      const newStart = dir === 'horizontal' ? x : y;
      const newEnd = newStart + lenMm / 10;
      const axisVal = dir === 'horizontal' ? y : x;
      return canvasData.handrails.some((h) => {
        if (h.direction !== dir) return false;
        const hAxis = dir === 'horizontal' ? h.y : h.x;
        if (hAxis !== axisVal) return false;
        const hStart = dir === 'horizontal' ? h.x : h.y;
        const hEnd = hStart + h.lengthMm / 10;
        return newStart < hEnd && newEnd > hStart;
      });
    };

    const tryAdd = (x: number, y: number, dir: 'horizontal' | 'vertical') => {
      const key = `${x},${y},${dir},${lengthMm}`;
      if (existingSet.has(key)) return;
      if (isOverlappingExisting(x, y, dir, lengthMm)) return;
      newHandrails.push({ id: uuidv4(), x, y, lengthMm, direction: dir, color: getHandrailColor(lengthMm) });
      existingSet.add(key);
    };

    // 横手摺 → 上面・下面の端点から縦方向の腕木
    const horizontals = handrails.filter(h => h.direction === 'horizontal');
    for (const hr of horizontals) {
      const hrLenGrid = mmToGrid(hr.lengthMm);
      const endpoints = [
        { x: hr.x, y: hr.y },
        { x: hr.x + hrLenGrid, y: hr.y },
      ];
      for (const ep of endpoints) {
        for (const bb of bboxes) {
          if (ep.x < bb.minX || ep.x > bb.maxX) continue;
          // 上面（端点が建物の上）→ 南向き（下方向）
          if (ep.y <= bb.minY) {
            tryAdd(ep.x, ep.y, 'vertical');
          }
          // 下面（端点が建物の下）→ 北向き（上方向）
          if (ep.y >= bb.maxY) {
            tryAdd(ep.x, ep.y - lengthGrid, 'vertical');
          }
        }
      }
    }

    // 縦手摺 → 左面・右面の端点から横方向の腕木
    const verticals = handrails.filter(h => h.direction === 'vertical');
    for (const vr of verticals) {
      const vrLenGrid = mmToGrid(vr.lengthMm);
      const endpoints = [
        { x: vr.x, y: vr.y },
        { x: vr.x, y: vr.y + vrLenGrid },
      ];
      for (const ep of endpoints) {
        for (const bb of bboxes) {
          if (ep.y < bb.minY || ep.y > bb.maxY) continue;
          // 左面（端点が建物の左）→ 東向き（右方向）
          if (ep.x <= bb.minX) {
            tryAdd(ep.x, ep.y, 'horizontal');
          }
          // 右面（端点が建物の右）→ 西向き（左方向）
          if (ep.x >= bb.maxX) {
            tryAdd(ep.x - lengthGrid, ep.y, 'horizontal');
          }
        }
      }
    }

    if (newHandrails.length > 0) {
      addHandrails(newHandrails);
    }
    onClose();
  };

  const hasHandrails = target === 'all'
    ? canvasData.handrails.some(h => h.direction === 'horizontal' || h.direction === 'vertical')
    : canvasData.handrails.some(h => (h.direction === 'horizontal' || h.direction === 'vertical') && selectedIds.includes(h.id));

  return (
    <div className="fixed inset-0 modal-overlay flex items-end sm:items-center justify-center z-50" onClick={onClose}>
      <div className="bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-dark-border flex items-center justify-between">
          <h2 className="font-bold text-lg">腕木一括配置</h2>
          <button onClick={onClose} className="text-dimension hover:text-canvas px-2">✕</button>
        </div>

        <div className="p-4 space-y-4">
          {/* 長さ選択 */}
          <div>
            <p className="text-sm text-dimension mb-2">腕木の長さ</p>
            <div className="flex gap-2">
              {UDEKI_LENGTHS.map(l => (
                <button key={l} onClick={() => setLengthMm(l)}
                  className={`flex-1 py-2 rounded-lg text-sm font-mono border transition-colors ${
                    lengthMm === l ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                  }`}
                >{l}</button>
              ))}
            </div>
          </div>

          {/* 対象選択 */}
          <div>
            <p className="text-sm text-dimension mb-2">対象</p>
            <div className="flex gap-2">
              <button onClick={() => setTarget('all')}
                className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                  target === 'all' ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                }`}
              >全ての手摺</button>
              <button onClick={() => setTarget('selected')}
                className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                  target === 'selected' ? 'border-accent bg-accent/15 text-accent' : 'border-dark-border text-dimension'
                }`}
              >選択中の手摺のみ</button>
            </div>
          </div>

          {!hasHandrails && (
            <p className="text-xs text-red-400">
              {target === 'selected' ? '選択中に横手摺がありません' : '横手摺がありません'}
            </p>
          )}

          <button onClick={handlePlace} disabled={!hasHandrails}
            className="w-full py-3 bg-accent text-white font-bold rounded-xl text-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            配置する
          </button>
        </div>
      </div>
    </div>
  );
}
