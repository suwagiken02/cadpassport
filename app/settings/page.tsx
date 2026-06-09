'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import {
  useHandrailSettingsStore,
  adjustPriorityOnToggle,
  defaultsForUnit,
  DEFAULT_DIMENSION_VISIBILITY,
  type DimensionVisibility,
  type UnitSystem,
} from '@/stores/handrailSettingsStore';
import { supabase } from '@/lib/supabase/client';
import {
  ALL_HANDRAIL_SIZES,
  INCH_ALL_HANDRAIL_SIZES,
  DEFAULT_ENABLED_SIZES,
  DEFAULT_PRIORITY_CONFIG,
  type HandrailLengthMm,
  type PriorityConfig,
} from '@/types';
import DraggablePriorityList from '@/components/settings/DraggablePriorityList';
import DimensionVisibilityCheckboxes from '@/components/dimension/DimensionVisibilityCheckboxes';

export default function SettingsPage() {
  const router = useRouter();
  const { user, profile, updateProfile } = useAuthStore();
  const {
    unitSystem,
    setUnitSystem,
    enabledSizes: storeEnabledSizes,
    priorityConfig: storePriorityConfig,
    dimensionVisibility: storeDimensionVisibility,
    loading: handrailLoading,
    loadHandrailSettings,
    saveHandrailSettings: storeSaveHandrailSettings,
    savePriorityConfig: storeSavePriorityConfig,
    updateDimensionVisibility: storeUpdateDimensionVisibility,
  } = useHandrailSettingsStore();

  // 既存 state
  const [companyName, setCompanyName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeTab, setActiveTab] = useState<'enabled' | 'priority'>('enabled');

  // Task A: 統一保存ボタン用 local state
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  // CAD パスポート: 規格も他の部材設定と同じく local 編集バッファで保持（保存ボタンまで DB に反映しない）
  const [unitSystemLocal, setUnitSystemLocal] = useState<UnitSystem>('metric');
  const [enabledSizesLocal, setEnabledSizesLocal] = useState<HandrailLengthMm[]>([...DEFAULT_ENABLED_SIZES]);
  const [priorityConfigLocal, setPriorityConfigLocal] = useState<PriorityConfig>({
    ...DEFAULT_PRIORITY_CONFIG,
    order: [...DEFAULT_PRIORITY_CONFIG.order],
  });
  const [dimensionVisibilityLocal, setDimensionVisibilityLocal] = useState<DimensionVisibility>({ ...DEFAULT_DIMENSION_VISIBILITY });

  // 規格別の選択可能サイズ全集合（使用部材グリッド / 並べ替え順に使用）。local バッファの規格に追従。
  const allSizes = unitSystemLocal === 'inch' ? INCH_ALL_HANDRAIL_SIZES : ALL_HANDRAIL_SIZES;

  useEffect(() => {
    if (profile) setCompanyName(profile.company_name || '');
  }, [profile]);

  // 部材設定を初回ロード
  useEffect(() => {
    loadHandrailSettings();
  }, [loadHandrailSettings]);

  // Task A: store 値 → local state 同期 (= 初回ロード後 + 他箇所での変更追従 + 保存完了後の確定)
  // 規格切替 (handleSwitchUnit) は store を変更せず local のみ更新するため、この effect は
  // 切替では発火せず、ロード時と保存完了時（store.unitSystem 等が確定した時）に local を確定値へ揃える。
  useEffect(() => {
    if (!handrailLoading) {
      setUnitSystemLocal(unitSystem);
      setEnabledSizesLocal([...storeEnabledSizes]);
      setPriorityConfigLocal({ ...storePriorityConfig, order: [...storePriorityConfig.order] });
      setDimensionVisibilityLocal({ ...storeDimensionVisibility });
    }
  }, [handrailLoading, unitSystem, storeEnabledSizes, storePriorityConfig, storeDimensionVisibility]);

  // Task A: dirty 判定
  const isDirty = useMemo(() => {
    if (companyName !== (profile?.company_name || '')) return true;
    if (logoFile !== null) return true;
    // CAD パスポート: 規格（保存済み store 値との差分）
    if (unitSystemLocal !== unitSystem) return true;
    // enabledSizes: 配列内容比較 (= sort 済比較)
    const a = [...enabledSizesLocal].sort();
    const b = [...storeEnabledSizes].sort();
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) return true;
    // priorityConfig: order + counts
    const pcl = priorityConfigLocal;
    const pcs = storePriorityConfig;
    if (pcl.mainCount !== pcs.mainCount || pcl.subCount !== pcs.subCount || pcl.adjustCount !== pcs.adjustCount) return true;
    if (pcl.order.length !== pcs.order.length || pcl.order.some((v, i) => v !== pcs.order[i])) return true;
    // dimensionVisibility: 全 key 比較
    const dvKeys = Object.keys(dimensionVisibilityLocal) as (keyof DimensionVisibility)[];
    if (dvKeys.some((k) => dimensionVisibilityLocal[k] !== storeDimensionVisibility[k])) return true;
    return false;
  }, [
    companyName, profile, logoFile,
    unitSystemLocal, unitSystem,
    enabledSizesLocal, storeEnabledSizes,
    priorityConfigLocal, storePriorityConfig,
    dimensionVisibilityLocal, storeDimensionVisibility,
  ]);

  // Task A: 使用部材チェックボックス (= local state 更新 + adjustPriorityOnToggle で priorityConfig 連動)
  const handleToggleSizeLocal = (size: HandrailLengthMm) => {
    const wasOn = enabledSizesLocal.includes(size);
    const next = wasOn
      ? enabledSizesLocal.filter((s) => s !== size)
      : [...enabledSizesLocal, size];
    if (next.length === 0) return; // 全 OFF 防止
    // 規格別 ALL 順で並べる（インチ規格はインチ ALL 順）
    const ordered = allSizes.filter((s) => next.includes(s));
    setEnabledSizesLocal(ordered);
    // priorityConfig 連動 (= adjustPriorityOnToggle 経由、 store 動作再現)
    const nextConfig = adjustPriorityOnToggle(priorityConfigLocal, size, !wasOn);
    if (nextConfig !== priorityConfigLocal) {
      setPriorityConfigLocal(nextConfig);
    }
  };

  // CAD パスポート: 規格切替（他の部材設定と同じく local バッファのみ更新 → dirty 化。
  // store / DB へは保存ボタン押下時にまとめて反映する。新規割付にだけ効く設計は維持）。
  const handleSwitchUnit = (unit: UnitSystem) => {
    if (unit === unitSystemLocal) return;
    const { enabledSizes, priorityConfig } = defaultsForUnit(unit);
    setUnitSystemLocal(unit);
    setEnabledSizesLocal([...enabledSizes]);
    setPriorityConfigLocal({ ...priorityConfig, order: [...priorityConfig.order] });
  };

  // Task A: ロゴ ファイル選択 (= 案 b: 保存時 upload、 ここでは保持のみ)
  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoFile(file);
    // ローカル preview (= URL.createObjectURL)
    const url = URL.createObjectURL(file);
    setLogoPreviewUrl(url);
  };

  // Task A: 統一保存ボタン
  const handleSaveAll = async () => {
    if (!user) return;
    setSaving(true);
    try {
      let logoUrl: string | undefined = undefined;
      // ロゴ upload (= 案 b: 保存時に Storage 触る)
      if (logoFile) {
        const ext = logoFile.name.split('.').pop();
        const path = `logos/${user.id}.${ext}`;
        const { error } = await supabase.storage.from('assets').upload(path, logoFile, { upsert: true });
        if (!error) {
          const { data } = supabase.storage.from('assets').getPublicUrl(path);
          logoUrl = data.publicUrl;
        }
      }
      // profile 更新 (= 会社名 + ロゴ、 logoUrl undefined なら updateProfile 内 if (logoUrl) ガードで既存 logo 維持)
      await updateProfile(companyName, logoUrl);
      // CAD パスポート: 規格(unit_system)を保存（変更があるときのみ。store.unitSystem も更新 → dirty クリア）
      if (unitSystemLocal !== unitSystem) {
        await setUnitSystem(unitSystemLocal);
      }
      // 部材設定 (= store action 経由、 内部で DB 保存)
      await storeSaveHandrailSettings(enabledSizesLocal);
      await storeSavePriorityConfig(priorityConfigLocal);
      // 寸法表示
      await storeUpdateDimensionVisibility(dimensionVisibilityLocal);
      // ロゴ ファイルクリア
      setLogoFile(null);
      if (logoPreviewUrl) {
        URL.revokeObjectURL(logoPreviewUrl);
        setLogoPreviewUrl(null);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  // Task A: 戻る確認
  const handleBack = () => {
    if (isDirty && !confirm('保存していません。 離れますか？')) return;
    router.back();
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 bg-dark-surface border-b border-dark-border px-4 py-3">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <button onClick={handleBack} className="text-accent text-sm px-3 py-2">
            ← 戻る
          </button>
          <h1 className="font-bold">設定</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-md mx-auto p-4 pb-24 space-y-6">
        <section>
          <h2 className="text-sm text-dimension mb-2 font-bold">会社情報</h2>
          <div className="bg-dark-surface border border-dark-border rounded-xl p-4 space-y-4">
            <div>
              <label className="block text-sm text-dimension mb-1">会社名</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="諏訪技建株式会社"
                className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="block text-sm text-dimension mb-1">会社ロゴ</label>
              {(logoPreviewUrl || profile?.logo_url) && (
                <img
                  src={logoPreviewUrl ?? profile?.logo_url ?? ''}
                  alt="Logo"
                  className="w-24 h-24 object-contain bg-white rounded-lg mb-2"
                />
              )}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoSelect}
                className="text-sm text-dimension"
              />
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-sm text-dimension mb-2 font-bold">規格</h2>
          <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleSwitchUnit('metric')}
                disabled={handrailLoading}
                className={`flex-1 h-10 rounded-md text-sm font-bold transition-colors disabled:opacity-50 ${
                  unitSystemLocal === 'metric' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                メートル
              </button>
              <button
                type="button"
                onClick={() => handleSwitchUnit('inch')}
                disabled={handrailLoading}
                className={`flex-1 h-10 rounded-md text-sm font-bold transition-colors disabled:opacity-50 ${
                  unitSystemLocal === 'inch' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                }`}
              >
                インチ
              </button>
            </div>
            <p className="mt-2 text-[11px] text-dimension">
              規格を切り替えると、使用部材・自動割付優先がその規格の既定サイズに載せ替わります。<br />
              保存済み図面の部材は変わりません（新しく配置・自動割付する部材にだけ効きます）。
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-sm text-dimension mb-2 font-bold">部材設定</h2>

          {/* タブ切替 */}
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setActiveTab('enabled')}
              className={`flex-none h-9 px-3 rounded-md text-sm font-bold transition-colors ${
                activeTab === 'enabled' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              使用部材
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('priority')}
              className={`flex-none h-9 px-3 rounded-md text-sm font-bold transition-colors ${
                activeTab === 'priority' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
              }`}
            >
              自動割付優先
            </button>
          </div>

          <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
            {activeTab === 'enabled' && (
              <>
            <p className="text-xs text-dimension mb-3">
              会社で保有している手摺サイズのみ ON にしてください。<br />
              OFF のサイズは自動割付・パレットで使用されません。
            </p>
            <div className="grid grid-cols-2 gap-2">
              {allSizes.map((size) => {
                const on = enabledSizesLocal.includes(size);
                const disabled = handrailLoading || (on && enabledSizesLocal.length <= 1);
                return (
                  <label
                    key={size}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors cursor-pointer ${
                      on ? 'border-accent bg-accent/10' : 'border-dark-border bg-dark-bg'
                    } ${disabled && !on ? 'opacity-40' : ''}`}
                  >
                    <span className={`text-sm font-mono font-bold ${on ? 'text-accent' : 'text-dimension'}`}>
                      {size}mm
                    </span>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={disabled && on}
                      onChange={() => handleToggleSizeLocal(size)}
                      className="w-5 h-5 accent-accent"
                    />
                  </label>
                );
              })}
            </div>
            {enabledSizesLocal.length <= 1 && (
              <p className="mt-2 text-[11px] text-yellow-500">
                最低 1 サイズは ON にしておく必要があります
              </p>
            )}
              </>
            )}

            {activeTab === 'priority' && (
              <div className="flex flex-col gap-2">
                <div className="text-sm text-gray-600">
                  ドラッグで並べ替えできます。上が優先度高。
                </div>
                <DraggablePriorityList
                  value={priorityConfigLocal}
                  enabledSizes={enabledSizesLocal}
                  onChange={setPriorityConfigLocal}
                />
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-sm text-dimension mb-2 font-bold">寸法表示</h2>
          <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
            <p className="text-xs text-dimension mb-3">
              図面に表示する寸法線の段を選択します。<br />
              マスタートグル (図面右上 / フッター設定) が OFF のときは全段非表示です。
            </p>
            <DimensionVisibilityCheckboxes
              value={dimensionVisibilityLocal}
              onChange={(updates) => setDimensionVisibilityLocal((prev) => ({ ...prev, ...updates }))}
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm text-dimension mb-2 font-bold">アカウント</h2>
          <div className="bg-dark-surface border border-dark-border rounded-xl p-4">
            <p className="text-sm text-dimension">
              メール: {user?.email}
            </p>
          </div>
        </section>
      </main>

      {/* Task A: 統一保存ボタン (= 画面下 fixed) */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-dark-surface border-t border-dark-border px-4 py-3 safe-area-bottom">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleSaveAll}
            disabled={!isDirty || saving}
            className="w-full py-3 bg-accent text-white font-bold rounded-lg disabled:opacity-50"
          >
            {saving ? '保存中...' : saved ? '保存しました' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
