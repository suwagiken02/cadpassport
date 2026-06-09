'use client';

import { create } from 'zustand';
import { supabase } from '@/lib/supabase/client';
import { useAuthStore, DEFAULT_COMPANY_ID } from '@/stores/authStore';
import {
  HandrailLengthMm,
  DEFAULT_ENABLED_SIZES,
  ALL_HANDRAIL_SIZES,
  INCH_DEFAULT_ENABLED_SIZES,
  INCH_ALL_HANDRAIL_SIZES,
  PriorityConfig,
  DEFAULT_PRIORITY_CONFIG,
  INCH_DEFAULT_PRIORITY_CONFIG,
} from '@/types';

/** CAD パスポート: メートル/インチ規格 */
export type UnitSystem = 'metric' | 'inch';

/** Phase 0b: 現在の company_id を取得（authStore 未ロード時は Default Company にフォールバック） */
const getCompanyId = () => useAuthStore.getState().currentCompanyId ?? DEFAULT_COMPANY_ID;

/** Day 7 commit C: 現在ユーザーの owner_id を取得 (= 認証必須、 ANON 時は null)。
 *  null 返却時は呼び出し側で console.error + 早期 return (= middleware で防がれる前提)。 */
const getOwnerId = (): string | null => {
  const uid = useAuthStore.getState().user?.id;
  return uid && uid !== 'anonymous' ? uid : null;
};

// Phase J-5: 寸法線の段別表示設定
export type DimensionVisibility = {
  roof1F: boolean;
  wall1F: boolean;
  scaffold1F: boolean;
  roof2F: boolean;
  wall2F: boolean;
  scaffold2F: boolean;
};

export const DEFAULT_DIMENSION_VISIBILITY: DimensionVisibility = {
  roof1F: true, wall1F: true, scaffold1F: false,
  roof2F: true, wall2F: true, scaffold2F: false,
};

function parseDimensionVisibility(raw: unknown): DimensionVisibility {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_DIMENSION_VISIBILITY };
  const r = raw as Record<string, unknown>;
  const pick = (k: keyof DimensionVisibility) =>
    typeof r[k] === 'boolean' ? (r[k] as boolean) : DEFAULT_DIMENSION_VISIBILITY[k];
  return {
    roof1F: pick('roof1F'),
    wall1F: pick('wall1F'),
    scaffold1F: pick('scaffold1F'),
    roof2F: pick('roof2F'),
    wall2F: pick('wall2F'),
    scaffold2F: pick('scaffold2F'),
  };
}

type HandrailSettingsStore = {
  /** CAD パスポート: 現在の規格（メートル/インチ）。既定 'metric'。 */
  unitSystem: UnitSystem;
  /** 現在有効な手摺サイズ（部材パレット・自動割付で使用可能なサイズ） */
  enabledSizes: HandrailLengthMm[];
  /** 優先部材リスト設定（自動割付用） */
  priorityConfig: PriorityConfig;
  /** Phase J-5: 寸法線の段別表示 ON/OFF */
  dimensionVisibility: DimensionVisibility;
  /** ロード中フラグ（初回 load 前は true） */
  loading: boolean;
  /** DB から設定を読み込む（アプリ起動時に呼ぶ） */
  loadHandrailSettings: () => Promise<void>;
  /** 設定を更新して DB に保存 */
  saveHandrailSettings: (sizes: HandrailLengthMm[]) => Promise<void>;
  /** 優先部材リスト設定を保存 */
  savePriorityConfig: (config: PriorityConfig) => Promise<void>;
  /** サイズ単位のトグル（UI のスイッチから呼ぶ） */
  toggleSize: (size: HandrailLengthMm) => Promise<void>;
  /** Phase J-5: 寸法線の段別表示を更新して DB に保存 (楽観的更新) */
  updateDimensionVisibility: (updates: Partial<DimensionVisibility>) => Promise<void>;
  /** CAD パスポート: 規格を切り替える。enabledSizes / priorityConfig をその規格の既定へ載せ替えて保存。 */
  setUnitSystem: (unit: UnitSystem) => Promise<void>;
};

/** その規格の有効サイズ全集合（保存値のサニタイズ・並べ替えに使用） */
const ALL_VALID_SIZES = new Set<number>([...ALL_HANDRAIL_SIZES, ...INCH_ALL_HANDRAIL_SIZES]);

/** enabled_sizes を HandrailLengthMm[] にサニタイズ（メートル・インチ両規格の値を許容、不正値は除去） */
function sanitize(raw: unknown): HandrailLengthMm[] {
  if (!Array.isArray(raw)) return [...DEFAULT_ENABLED_SIZES];
  return raw.filter((v): v is HandrailLengthMm => typeof v === 'number' && ALL_VALID_SIZES.has(v));
}

/** サイズ配列を降順・重複排除で整える（規格非依存。メートルでも従来の ALL 順と一致）。 */
function orderSizes(sizes: HandrailLengthMm[]): HandrailLengthMm[] {
  return Array.from(new Set(sizes)).sort((a, b) => b - a);
}

/** 規格 → 既定の enabledSizes / priorityConfig（新しいコピーを返す）。 */
export function defaultsForUnit(unit: UnitSystem): { enabledSizes: HandrailLengthMm[]; priorityConfig: PriorityConfig } {
  if (unit === 'inch') {
    return {
      enabledSizes: [...INCH_DEFAULT_ENABLED_SIZES],
      priorityConfig: { ...INCH_DEFAULT_PRIORITY_CONFIG, order: [...INCH_DEFAULT_PRIORITY_CONFIG.order] },
    };
  }
  return {
    enabledSizes: [...DEFAULT_ENABLED_SIZES],
    priorityConfig: { ...DEFAULT_PRIORITY_CONFIG, order: [...DEFAULT_PRIORITY_CONFIG.order] },
  };
}

/** チェック ON/OFF に応じて priorityConfig を調整 (= /settings 画面の local state 用に export)
 *  - OFF: order から該当サイズを除外末尾に移動、元セクションの Count を -1
 *  - ON: 未登録なら除外末尾に追加、登録済みなら位置維持
 */
export function adjustPriorityOnToggle(
  cfg: PriorityConfig,
  size: HandrailLengthMm,
  nowEnabled: boolean,
): PriorityConfig {
  const { order, mainCount, subCount, adjustCount } = cfg;
  const idx = order.indexOf(size);
  const mainEnd = mainCount;
  const subEnd = mainCount + subCount;
  const adjustEnd = mainCount + subCount + adjustCount;

  if (nowEnabled) {
    // ON
    if (idx >= 0) return cfg; // 既に order にあれば位置維持
    return {
      ...cfg,
      order: [...order, size],
    };
  }

  // OFF
  if (idx < 0) return cfg; // もともと order に無い
  let newMain = mainCount;
  let newSub = subCount;
  let newAdjust = adjustCount;
  if (idx < mainEnd) newMain--;
  else if (idx < subEnd) newSub--;
  else if (idx < adjustEnd) newAdjust--;
  // 除外セクションから OFF する場合は Count 変化なし

  const filtered = order.filter((s) => s !== size);
  return {
    order: [...filtered, size] as HandrailLengthMm[],
    mainCount: newMain,
    subCount: newSub,
    adjustCount: newAdjust,
  };
}

export const useHandrailSettingsStore = create<HandrailSettingsStore>((set, get) => ({
  unitSystem: 'metric',
  enabledSizes: [...DEFAULT_ENABLED_SIZES],
  priorityConfig: { ...DEFAULT_PRIORITY_CONFIG, order: [...DEFAULT_PRIORITY_CONFIG.order] },
  dimensionVisibility: { ...DEFAULT_DIMENSION_VISIBILITY },
  loading: true,

  loadHandrailSettings: async () => {
    try {
      // Day 7 commit C: RLS で auto フィルタ (= auth.uid() = owner_id)、 自分のレコードのみ返る
      const { data, error } = await supabase
        .from('handrail_settings')
        .select('enabled_sizes, priority_config, dimension_visibility, unit_system')
        .limit(1)
        .maybeSingle();
      if (error) {
        console.warn('[handrailSettings] load error, using defaults:', error.message);
        set({
          unitSystem: 'metric',
          enabledSizes: [...DEFAULT_ENABLED_SIZES],
          priorityConfig: { ...DEFAULT_PRIORITY_CONFIG, order: [...DEFAULT_PRIORITY_CONFIG.order] },
          dimensionVisibility: { ...DEFAULT_DIMENSION_VISIBILITY },
          loading: false,
        });
        return;
      }
      // unit_system（null/旧データなら 'metric'）
      const unitSystem: UnitSystem = data?.unit_system === 'inch' ? 'inch' : 'metric';
      // enabled_sizes（既存ロジック。保存済み値を尊重し、規格で上書きしない）
      const enabledSizes = data?.enabled_sizes
        ? sanitize(data.enabled_sizes)
        : [...defaultsForUnit(unitSystem).enabledSizes];
      // priority_config（null/旧データなら規格別 DEFAULT フォールバック）
      const rawPc = data?.priority_config as Partial<PriorityConfig> | null | undefined;
      const priorityConfig: PriorityConfig = rawPc && Array.isArray(rawPc.order)
        ? {
            order: sanitize(rawPc.order),
            mainCount: typeof rawPc.mainCount === 'number' ? rawPc.mainCount : DEFAULT_PRIORITY_CONFIG.mainCount,
            subCount: typeof rawPc.subCount === 'number' ? rawPc.subCount : DEFAULT_PRIORITY_CONFIG.subCount,
            adjustCount: typeof rawPc.adjustCount === 'number' ? rawPc.adjustCount : DEFAULT_PRIORITY_CONFIG.adjustCount,
          }
        : { ...defaultsForUnit(unitSystem).priorityConfig };
      // Phase J-5: dimension_visibility（null/旧データなら DEFAULT）
      const dimensionVisibility = parseDimensionVisibility(data?.dimension_visibility);
      set({ unitSystem, enabledSizes, priorityConfig, dimensionVisibility, loading: false });
    } catch (e) {
      console.warn('[handrailSettings] load exception:', e);
      set({
        unitSystem: 'metric',
        enabledSizes: [...DEFAULT_ENABLED_SIZES],
        priorityConfig: { ...DEFAULT_PRIORITY_CONFIG, order: [...DEFAULT_PRIORITY_CONFIG.order] },
        dimensionVisibility: { ...DEFAULT_DIMENSION_VISIBILITY },
        loading: false,
      });
    }
  },

  saveHandrailSettings: async (sizes) => {
    // 降順・重複排除で並べる（規格非依存。メートルは従来の ALL 順と一致）
    const ordered = orderSizes(sizes);
    set({ enabledSizes: ordered });
    try {
      // Day 7 commit C: 認証必須 (= ANON 時は middleware で防がれる前提)
      const ownerId = getOwnerId();
      if (!ownerId) {
        console.error('[handrailSettings] save skipped: not authenticated');
        return;
      }
      const companyId = getCompanyId();
      // Day 7 commit C: RLS で auto フィルタ。 既存レコードを update、 無ければ insert
      const { data: existing } = await supabase
        .from('handrail_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('handrail_settings')
          .update({ enabled_sizes: ordered, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('handrail_settings')
          .insert({ owner_id: ownerId, company_id: companyId, enabled_sizes: ordered });
      }
    } catch (e) {
      console.warn('[handrailSettings] save exception:', e);
    }
  },

  savePriorityConfig: async (config) => {
    // 楽観的更新: 先に state を更新して UI 即応、失敗時はログのみ
    set({ priorityConfig: { ...config, order: [...config.order] } });
    try {
      // Day 7 commit C: 認証必須 (= ANON 時は middleware で防がれる前提)
      const ownerId = getOwnerId();
      if (!ownerId) {
        console.error('[handrailSettings] savePriorityConfig skipped: not authenticated');
        return;
      }
      const companyId = getCompanyId();
      // Day 7 commit C: RLS で auto フィルタ。 既存レコードを update、 無ければ insert
      const { data: existing } = await supabase
        .from('handrail_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('handrail_settings')
          .update({ priority_config: config, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('handrail_settings')
          .insert({ owner_id: ownerId, company_id: companyId, priority_config: config });
      }
    } catch (e) {
      console.warn('[handrailSettings] savePriorityConfig exception:', e);
    }
  },

  toggleSize: async (size) => {
    const { enabledSizes, priorityConfig, saveHandrailSettings, savePriorityConfig } = get();
    const wasOn = enabledSizes.includes(size);
    const next = wasOn
      ? enabledSizes.filter(s => s !== size)
      : [...enabledSizes, size];
    // 全OFF防止: 少なくとも 1 つは必ず残す
    if (next.length === 0) return;

    // priorityConfig を連動調整（OFF→除外末尾へ、ON→除外末尾に追加）
    const nextConfig = adjustPriorityOnToggle(priorityConfig, size, !wasOn);

    // 2 リクエストで保存（enabled_sizes と priority_config は別カラムのため直列 UPDATE）
    await saveHandrailSettings(next);
    if (nextConfig !== priorityConfig) {
      await savePriorityConfig(nextConfig);
    }
  },

  // Phase J-5: 寸法線の段別表示を更新 (楽観的更新 + DB 保存)
  updateDimensionVisibility: async (updates) => {
    const cur = get().dimensionVisibility;
    const next = { ...cur, ...updates };
    set({ dimensionVisibility: next });
    try {
      // Day 7 commit C: 認証必須 (= ANON 時は middleware で防がれる前提)
      const ownerId = getOwnerId();
      if (!ownerId) {
        console.error('[handrailSettings] updateDimensionVisibility skipped: not authenticated');
        return;
      }
      const companyId = getCompanyId();
      // Day 7 commit C: RLS で auto フィルタ。 既存レコードを update、 無ければ insert
      const { data: existing } = await supabase
        .from('handrail_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('handrail_settings')
          .update({ dimension_visibility: next, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('handrail_settings')
          .insert({ owner_id: ownerId, company_id: companyId, dimension_visibility: next });
      }
    } catch (e) {
      console.warn('[handrailSettings] updateDimensionVisibility exception:', e);
    }
  },

  // CAD パスポート: 規格(unit_system)を DB に保存し、ストアの保存済み値(unitSystem)を更新する。
  // 規格の切替自体（enabledSizes / priorityConfig の規格既定への載せ替え）は /settings の
  // local state 側で行い、即時の DB 自動保存はしない。この経路は保存ボタン押下時にのみ呼ばれ、
  // unit_system を確実に永続化する（enabled_sizes / priority_config は別アクションで保存）。
  setUnitSystem: async (unit) => {
    set({ unitSystem: unit });
    try {
      // Day 7 commit C: 認証必須 (= ANON 時は middleware で防がれる前提)
      const ownerId = getOwnerId();
      if (!ownerId) {
        console.error('[handrailSettings] setUnitSystem skipped: not authenticated');
        return;
      }
      const companyId = getCompanyId();
      // Day 7 commit C: RLS で auto フィルタ。 既存レコードを update、 無ければ insert
      const { data: existing } = await supabase
        .from('handrail_settings')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        await supabase
          .from('handrail_settings')
          .update({ unit_system: unit, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('handrail_settings')
          .insert({ owner_id: ownerId, company_id: companyId, unit_system: unit });
      }
    } catch (e) {
      console.warn('[handrailSettings] setUnitSystem exception:', e);
    }
  },
}));
