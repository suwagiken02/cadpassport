'use client';
import React, { useState, useEffect } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { ModeType, getScaffoldStartByFloor } from '@/types';
import { MAX_BUILDING_FLOOR } from '@/lib/konva/floorLimits';
import ConfirmDialog from '@/components/ui/ConfirmDialog';

export default function ModeToolbar() {
  const { mode, setMode, isMeasuring, toggleMeasuring, showPartSelector, canvasData, isMagnetPinMode, setMagnetPinMode, isReorderMode, toggleReorderMode, isHeightMarkerMode, setHeightMarkerMode, selectActive, setSelectActive, selectLock, setSelectLock } = useCanvasStore();
  const [showKutaiMenu, setShowKutaiMenu] = useState(false);
  const [showAshibaMenu, setShowAshibaMenu] = useState(false);
  const [dismissedStage, setDismissedStage] = useState<string | null>(null);
  // 平米計算: 足場 0 個時の確認 dialog (= 平米計算 Phase D-1、 局所性高いため store 経由でなく useState)
  const [showNoScaffoldConfirm, setShowNoScaffoldConfirm] = useState(false);

  // 躯体グループ（建物・障害物・高さマーカー）
  const isKutaiMode = mode === 'building' || mode === 'obstacle' || mode === 'roof' || isHeightMarkerMode;

  const mainButtons = [
    { id: 'select' as const, label: '選択', icon: '↖', color: '#378ADD' },
    { id: 'kutai' as const, label: '躯体', icon: '⌂', color: '#4ECDC4' },
    { id: 'ashiba' as const, label: '足場', icon: '▦', color: '#FFD700' },
    { id: 'buzai' as const, label: '部材', icon: '━', color: '#FFA500' },
    { id: 'memo' as const, label: 'メモ', icon: 'T', color: '#DDA0DD' },
    { id: 'calculator' as const, label: '電卓', icon: '🧮', color: '#EC4899' },
    { id: 'erase' as const, label: '消去', icon: '✕', color: '#EF4444' },
    { id: 'settings' as const, label: '設定', icon: '⚙', color: '#96CEB4' },
  ];

  // ガイド点滅
  const hasBuildings = canvasData.buildings.length > 0;
  // S-5e-1: 3F+ の星(scaffoldStartByFloor のみに載る)も検出。{1,2}/legacy は従来と同真偽。
  const hasScaffoldStart = Object.values(getScaffoldStartByFloor(canvasData)).some(Boolean) || !!canvasData.scaffoldStart;
  const hasHandrails = canvasData.handrails.length > 0;

  const getCurrentStage = (): string | null => {
    if (!hasBuildings) return 'kutai';
    // 足場構成整理 ステップ1: 'scaffold' ボタン廃止に伴い、 stage 名を 'ashiba' に変更。
    // 足場開始未設定時は足場ボタンを点滅させ、 サブメニュー先頭の「開始位置」 へ誘導する。
    if (!hasScaffoldStart) return 'ashiba';
    return 'buzai';
  };

  const currentStage = getCurrentStage();
  const highlightId = (currentStage && currentStage !== dismissedStage) ? currentStage : null;

  // ステージが変わったらdismissをリセット
  useEffect(() => {
    setDismissedStage(null);
  }, [hasBuildings, hasScaffoldStart]);

  const handleMainButton = (id: string) => {
    const stage = getCurrentStage();
    if (stage === 'kutai') setDismissedStage('kutai');
    if (stage === 'ashiba') setDismissedStage('ashiba');
    if (stage === 'buzai' && (id === 'buzai' || id === 'ashiba')) setDismissedStage('buzai');
    if (isMeasuring) toggleMeasuring();
    // ピンモードは「magnet-pin 自身」以外のボタン押下で解除（既存 isMeasuring と同パターン）
    if (id !== 'magnet-pin' && isMagnetPinMode) setMagnetPinMode(false);
    // 高さマーカーモードは「kutai 自身」以外のボタン押下で解除 (= 既存 obstacle と同パターン、 Task #8 Phase C)
    if (id !== 'kutai' && isHeightMarkerMode) setHeightMarkerMode(false);
    // Phase K-1: 入れ替えモードはどのメインボタン押下でも解除 (足場メニューから再開可)
    if (isReorderMode) toggleReorderMode();
    // erase mode 中に「erase / select 以外のボタン」 押下時、 erase 解除 (= 誤タップ削除防止)
    // (= 既存 isMeasuring / isMagnetPinMode / isReorderMode と同パターン)
    if (mode === 'erase' && id !== 'erase' && id !== 'select') {
      setMode('select');
    }
    if (id === 'magnet-pin') {
      setMagnetPinMode(!isMagnetPinMode);
      return;
    }
    // ピン→電卓 置換: 電卓ボタンでモーダルを開く（ピン機能本体は温存・上の magnet-pin 分岐は dead path）。
    if (id === 'calculator') {
      useCanvasStore.getState().setShowCalculator(true);
      return;
    }
    if (id === 'select') {
      // 既に select かつ active なら toggle で OFF、 それ以外なら ON で select モードへ
      if (mode === 'select' && selectActive) {
        setSelectActive(false);
      } else {
        setMode('select');
        setSelectActive(true);
      }
    } else if (id === 'erase') {
      // トグル動作: 既に erase なら select に戻す (= 削除モード OFF)
      setMode(mode === 'erase' ? 'select' : 'erase');
    } else if (id === 'memo') {
      // トグル化: メモモード中 (= mode='memo') で再タップなら mode リセット + modal close
      if (mode === 'memo') {
        setMode('select');
        useCanvasStore.getState().setShowMemoCreateModal(false);
      } else {
        useCanvasStore.getState().setShowMemoCreateModal(true);
      }
    } else if (id === 'kutai') {
      // トグル化: 躯体モード中 (= isKutaiMode) で再タップなら mode リセット + 関連 state 全閉じ
      if (isKutaiMode) {
        setMode('select');
        setHeightMarkerMode(false);
        setShowKutaiMenu(false);
        useCanvasStore.getState().setShowBuildingModal(false);
        useCanvasStore.getState().setShowBuilding2FModal(false);
      } else {
        setShowKutaiMenu(true);
      }
    } else if (id === 'buzai') {
      useCanvasStore.getState().togglePartSelector();
    } else if (id === 'ashiba') {
      setShowAshibaMenu(true);
    } else if (id === 'settings') {
      if (window.innerWidth < 640) {
        useCanvasStore.getState().setShowSettings(true);
      } else {
        useCanvasStore.getState().toggleSettingsPanel();
      }
    }
  };

  const isActive = (id: string) => {
    if (id === 'select') return mode === 'select' && selectActive && !isMeasuring;
    if (id === 'kutai') return isKutaiMode && !isMeasuring;
    if (id === 'buzai') return showPartSelector;
    if (id === 'memo') return mode === 'memo' && !isMeasuring;
    if (id === 'magnet-pin') return isMagnetPinMode;
    if (id === 'erase') return mode === 'erase' && !isMeasuring;
    return false;
  };

  return (
    <>
      {/* 躯体選択メニュー */}
      {showKutaiMenu && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowKutaiMenu(false)} />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-dark-surface border border-dark-border rounded-2xl shadow-2xl p-4 flex gap-3 flex-wrap justify-center max-w-[calc(100vw-32px)]">
            <button
              data-tutorial-id="kutai-building1f"
              onClick={() => {
                useCanvasStore.getState().setShowBuildingModal(true);
                setShowKutaiMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⌂</span>
              <span className="text-sm font-bold">建物1F</span>
            </button>
            <button
              onClick={() => {
                const s = useCanvasStore.getState();
                // N階一般化 P2 / S-5e-1: 既存最上階+1 を追加 (上限 MAX_BUILDING_FLOOR)。実際の階番号は配置時に算出。
                const maxFloor = s.canvasData.buildings.reduce((m, b) => Math.max(m, b.floor ?? 1), 0);
                if (maxFloor >= MAX_BUILDING_FLOOR) {
                  s.setAlertMessage(`足場図は${MAX_BUILDING_FLOOR}階まで対応しています`);
                  setShowKutaiMenu(false);
                  return;
                }
                s.setShowBuilding2FModal(true);
                setShowKutaiMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⌂</span>
              <span className="text-sm font-bold">上の階を追加</span>
            </button>
            <button
              data-tutorial-id="kutai-obstacle"
              onClick={() => {
                setMode('obstacle');
                setShowKutaiMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⬒</span>
              <span className="text-sm font-bold">障害物</span>
            </button>
            <button
              data-tutorial-id="kutai-height"
              onClick={() => {
                setHeightMarkerMode(true);
                setShowKutaiMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">↕</span>
              <span className="text-sm font-bold">高さ</span>
            </button>
            <button
              data-tutorial-id="kutai-roof"
              onClick={() => {
                setMode('roof');
                setShowKutaiMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⌒</span>
              <span className="text-sm font-bold">屋根</span>
            </button>
          </div>
        </>
      )}

      {/* 足場メニュー */}
      {showAshibaMenu && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setShowAshibaMenu(false)} />
          <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-dark-surface border border-dark-border rounded-2xl shadow-2xl p-4 flex gap-3 flex-wrap justify-center max-w-[calc(100vw-32px)]">
            {/* 足場開始（canvas 上の ★ アイコンと色統一: #FFD700 ゴールド系 = Tailwind yellow-400） */}
            <button
              data-tutorial-id="ashiba-start"
              onClick={() => {
                const s = useCanvasStore.getState();
                if (s.canvasData.buildings.length === 0) {
                  s.setAlertMessage('建物がありません。先に躯体メニューから建物を作成してください');
                  setShowAshibaMenu(false);
                  return;
                }
                s.setShowScaffoldStart(true);
                setShowAshibaMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-yellow-400/10 border-2 border-yellow-400 text-yellow-400 hover:bg-yellow-400/20 transition-colors"
            >
              <span className="text-3xl mb-1">⚑</span>
              <span className="text-xs font-bold">足場開始</span>
            </button>
            {/* 移動（選択移動モードに入る: カテゴリ別＋選択範囲のみ移動） */}
            <button
              data-tutorial-id="ashiba-move"
              onClick={() => {
                useCanvasStore.getState().enterMoveSelectMode();
                setShowAshibaMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">↔</span>
              <span className="text-xs font-bold">移動</span>
            </button>
            {/* 入れ替え（既存の toggleReorderMode を呼ぶ） */}
            <button
              data-tutorial-id="ashiba-reorder"
              onClick={() => {
                useCanvasStore.getState().toggleReorderMode();
                setShowAshibaMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⇄</span>
              <span className="text-xs font-bold">入れ替え</span>
            </button>
            {/* 自動配置（旧・自動割付） */}
            <button
              data-tutorial-id="ashiba-autolayout"
              onClick={() => {
                const s = useCanvasStore.getState();
                if (s.canvasData.buildings.length === 0) {
                  s.setAlertMessage('建物がありません。先に躯体メニューから建物を作成してください');
                  setShowAshibaMenu(false);
                  return;
                }
                s.setShowAutoLayout(true);
                setShowAshibaMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">⚡</span>
              <span className="text-xs font-bold">自動配置</span>
            </button>
            {/* 自動内柱配置（旧機能保持） */}
            <button
              onClick={() => {
                useCanvasStore.getState().setShowInnerPost(true);
                setShowAshibaMenu(false);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">●</span>
              <span className="text-xs font-bold">自動内柱配置</span>
            </button>
            {/* 平米計算 (= 平米計算 Phase C + D-1 事前チェック + D-2 1F+2F 分岐) */}
            <button
              data-tutorial-id="ashiba-areacalc"
              onClick={() => {
                const s = useCanvasStore.getState();
                setShowAshibaMenu(false);
                // 事前チェック: 足場 0 個 → ConfirmDialog 表示 (= 床㎡のみ計算するか確認)
                if (s.canvasData.handrails.length === 0) {
                  setShowNoScaffoldConfirm(true);
                  return;
                }
                // 1F + 2F 建物両方あり → 1F足場指定モード突入 (= 平米計算 Phase D-2)
                const has1F = s.canvasData.buildings.some((b) => (b.floor ?? 1) === 1);
                const has2F = s.canvasData.buildings.some((b) => (b.floor ?? 1) === 2);
                if (has1F && has2F) {
                  s.enterAreaDesignationMode();
                  return;
                }
                // 片建物のみ → 直接 modal open
                s.setShowAreaCalcModal(true);
              }}
              className="flex flex-col items-center justify-center w-24 h-24 rounded-xl bg-accent/10 border-2 border-accent text-accent hover:bg-accent/20 transition-colors"
            >
              <span className="text-3xl mb-1">㎡</span>
              <span className="text-xs font-bold">平米計算</span>
            </button>
          </div>
        </>
      )}

      {/* 平米計算: 足場 0 個時の確認 dialog (= 平米計算 Phase D-1) */}
      {showNoScaffoldConfirm && (
        <ConfirmDialog
          title="足場がありません"
          message="建物の延べ床㎡のみ計算しますか？"
          primaryLabel="はい"
          secondaryLabel="いいえ"
          onPrimary={() => {
            setShowNoScaffoldConfirm(false);
            useCanvasStore.getState().setShowAreaCalcModal(true);
          }}
          onSecondary={() => setShowNoScaffoldConfirm(false)}
        />
      )}

      {/* 選択カテゴリロック popover (= mode='select' + selectActive 時のみ表示、 屋根は将来用 placeholder で UI 非表示) */}
      {mode === 'select' && selectActive && !isMeasuring && (
        <div className="fixed bottom-[58px] left-1/2 -translate-x-1/2 z-30 bg-dark-surface border border-dark-border rounded-xl shadow-2xl px-2 py-1 flex gap-1">
          {/* 躯体は select モードで選択 / 移動機能なし (= 屋根と同じ placeholder) のため UI 非表示。
             ※ selectLock.building の state は将来用に維持。 建物選択機能実装時に
             { key: 'building', label: '躯体' } を復活させる。 */}
          {([
            { key: 'parts' as const, label: '部材' },
            { key: 'obstacle' as const, label: '障害物' },
            { key: 'dimension' as const, label: '寸法' },
          ]).map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelectLock({ ...selectLock, [key]: !selectLock[key] })}
              className={`px-2 py-1 rounded text-[11px] font-bold transition-colors ${
                selectLock[key]
                  ? 'bg-red-500/80 text-white'
                  : 'bg-dark-bg text-dimension border border-dark-border'
              }`}
              aria-pressed={selectLock[key]}
              title={selectLock[key] ? `${label}: ロック中（触れない）` : `${label}: 触れる`}
            >
              {selectLock[key] ? '🔒' : ''}{label}
            </button>
          ))}
        </div>
      )}

      <div className="fixed bottom-0 left-0 right-0 z-30 bg-dark-surface border-t border-dark-border safe-area-bottom">
        {/* メインボタン */}
        <div className="flex justify-around items-center px-0.5 py-1">
          {mainButtons.map((m) => (
            <button key={m.id} onClick={() => handleMainButton(m.id)}
              data-tutorial-id={m.id === 'settings' ? 'settings-button' : m.id === 'kutai' ? 'kutai-button' : m.id === 'ashiba' ? 'ashiba-button' : undefined}
              className={`flex-col items-center justify-center py-2 px-1 rounded-lg min-w-[36px] transition-colors flex ${
                isActive(m.id) ? 'bg-accent text-white' : 'text-dimension hover:text-canvas'
              } ${highlightId === m.id || (highlightId === 'buzai' && m.id === 'ashiba') ? 'animate-highlight' : ''}`}
            >
              <span className="text-base leading-none" style={{ color: isActive(m.id) ? 'white' : m.color }}>{m.icon}</span>
              <span className="text-[9px] mt-0.5">{m.label}</span>
            </button>
          ))}
        </div>

      </div>
    </>
  );
}
