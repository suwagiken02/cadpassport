'use client';

import React from 'react';
import { useHandrailSettingsStore, type DimensionVisibility } from '@/stores/handrailSettingsStore';
import { DIM_VIS_DEFAULT, dimVisibilityItems } from '@/lib/konva/dimensionVisibility';

// Phase J-5: 寸法線の段別 ON/OFF チェックボックス共通コンポーネント。
// 設定画面 (/settings) と SettingsPanel (スマホ)、editor 右上 (PC) の 3 箇所で共有。
// 状態は handrailSettingsStore (DB 連動、会社単位) を直接読み書き。
// S-5e-4: 対象階(floors)から動的生成。floors 省略時は [1,2]（{1,2} で従来 6 項目・同順）。

type DimensionVisibilityCheckboxesProps = {
  disabled?: boolean;
  value?: DimensionVisibility;
  onChange?: (updates: Record<string, boolean>) => void;
  /** 対象階（建物が存在する階）。省略時は [1,2]。 */
  floors?: number[];
};

export default function DimensionVisibilityCheckboxes({ disabled = false, value, onChange, floors }: DimensionVisibilityCheckboxesProps) {
  const items = React.useMemo(() => dimVisibilityItems(floors), [floors]);
  const storeDimensionVisibility = useHandrailSettingsStore(s => s.dimensionVisibility);
  const storeUpdate = useHandrailSettingsStore(s => s.updateDimensionVisibility);

  // controlled 判定: value + onChange 両方渡されたら controlled mode (= /settings 画面)
  // そうでなければ uncontrolled (= store 直接読み書き、 SettingsPanel + editor 右上 既存挙動維持)
  const isControlled = value !== undefined && onChange !== undefined;
  const dimensionVisibility = isControlled ? value : storeDimensionVisibility;
  const handleChange = (updates: Record<string, boolean>) => {
    if (isControlled) {
      onChange!(updates);
    } else {
      storeUpdate(updates);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map(item => {
        // S-5e-4: 未設定キー(3F+)は種別デフォルト。{1,2} の 6 キーは常に定義済で従来同値。
        const checked = dimensionVisibility[item.key] ?? DIM_VIS_DEFAULT[item.cat];
        return (
          <label
            key={item.key}
            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
              checked
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-dark-border bg-dark-bg text-dimension'
            } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={(e) => {
                if (disabled) return;
                handleChange({ [item.key]: e.target.checked });
              }}
              className="w-4 h-4 accent-accent shrink-0"
            />
            <span className="text-xs font-bold whitespace-nowrap">{item.label}</span>
          </label>
        );
      })}
    </div>
  );
}
