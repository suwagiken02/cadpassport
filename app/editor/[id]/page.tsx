'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase/client';
import ModeToolbar from '@/components/toolbar/ModeToolbar';
import PartSelector from '@/components/toolbar/PartSelector';
import CompassWidget from '@/components/canvas/CompassWidget';
import OperationGuideBar from '@/components/canvas/OperationGuideBar';
import BuildingTemplateModal from '@/components/building/BuildingTemplateModal';
import FloorSelector from '@/components/toolbar/FloorSelector';
import ExportModal from '@/components/output/ExportModal';
import ScaffoldStartModal from '@/components/scaffold/ScaffoldStartModal';
import RoofObjectModal from '@/components/canvas/RoofObjectModal';
import FloorPickerModal from '@/components/canvas/FloorPickerModal';
import { buildingIdForPolygonOnFloor } from '@/lib/konva/floorScope';
import { directionInputLabels } from '@/lib/directionInputLabels';
import UdekiModal from '@/components/scaffold/UdekiModal';
import AutoLayoutModal from '@/components/scaffold/AutoLayoutModal';
import AlertDialog from '@/components/ui/AlertDialog';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import FeatureNoticeModal from '@/components/ui/FeatureNoticeModal';
import CalculatorModal from '@/components/ui/CalculatorModal';
import { isNoticeDismissed, dismissNotice } from '@/lib/notice';
import HeightInputModal from '@/components/canvas/HeightInputModal';
import RidgeLineInputModal from '@/components/canvas/RidgeLineInputModal';
import AreaCalculationModal from '@/components/canvas/AreaCalculationModal';
import ElevationModal from '@/components/elevation/ElevationModal';
import AreaDesignationModeBar from '@/components/scaffold/AreaDesignationModeBar';
import HandrailReorderModal from '@/components/scaffold/HandrailReorderModal';
import MoveSelectCategoryModal from '@/components/scaffold/MoveSelectCategoryModal';
import MoveSelectRangePanel from '@/components/scaffold/MoveSelectRangePanel';
import MoveSelectMovePanel from '@/components/scaffold/MoveSelectMovePanel';
import ReorderModeBar from '@/components/scaffold/ReorderModeBar';
import DarkModeToggle from '@/components/DarkModeToggle';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import SettingsPanel from '@/components/toolbar/SettingsPanel';
import TutorialOverlay from '@/components/tutorial/TutorialOverlay';
import DimensionVisibilityCheckboxes from '@/components/dimension/DimensionVisibilityCheckboxes';
import MemoCreateModal from '@/components/memo/MemoCreateModal';
import DirectionInputModal from '@/components/building/DirectionInputModal';
import PinDistanceInputModal from '@/components/canvas/PinDistanceInputModal';
import ProjectEditModal from '@/components/project/ProjectEditModal';
import PageTabsContainer from '@/components/editor/PageTabsContainer';
import CanvasContextMenu from '@/components/editor/CanvasContextMenu';
import { CanvasData, PaperSize, ScaleOption } from '@/types';

// Konvaはクライアントサイドのみ
const GridCanvas = dynamic(() => import('@/components/canvas/GridCanvas'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full bg-dark-bg">
      <div className="animate-spin w-8 h-8 border-2 border-accent border-t-transparent rounded-full" />
    </div>
  ),
});

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const drawingId = params.id as string;

  const {
    setDrawingId,
    setProjectId,
    setCanvasData,
    canvasData,
    mode,
    isDirty,
    saveStatus,
    setSaveStatus,
    undo,
    redo,
    history,
    zoomToFitContent,
    showDimensions,
    toggleShowDimensions,
    showGridGuide,
    toggleShowGridGuide,
    isDarkMode,
    toggleDarkMode,
    isDuplicateMode,
    toggleDuplicateMode,
    showKidare,
    toggleShowKidare,
    isReorderMode,
    toggleReorderMode,
    selectedLineIds,
    setSelectedLineIds,
    reorderHandrails,
    showScaffoldStart,
    setShowScaffoldStart,
    showAutoLayout,
    setShowAutoLayout,
    showBuildingModal: showBuildingModalStore,
    setShowBuildingModal: setShowBuildingModalStore,
    showCalculator,
    setShowCalculator,
    showBuilding2FModal: showBuilding2FModalStore,
    setShowBuilding2FModal: setShowBuilding2FModalStore,
    showSettings,
    setShowSettings,
    showSettingsPanel,
    showPartSelector,
    showMemoCreateModal,
    setShowMemoCreateModal,
    showInnerPost,
    setShowInnerPost,
    directionPoints,
    directionPointsHistory,
    clearDirectionPoints,
    removeLastDirectionPoint,
    showDirectionInputModal,
    setShowDirectionInputModal,
    lastCompletedDirectionSession,
    setLastCompletedDirectionSession,
    setDirectionPoints,
    autoOpenRoofForBuildingId,
    setAutoOpenRoofForBuildingId,
    pendingBuildingFloor,
    setPendingBuildingFloor,
    pendingTargetType,
    setPendingTargetType,
    pendingObstacleType,
    setPendingObstacleType,
    addObstacle,
    showDirectionGuide,
    toggleDirectionGuide,
    isMeasuring,
    toggleMeasuring,
    measureResultMm,
    measureAxisMode,
    setMeasureAxisMode,
    measurePoint1,
    measurePoint2,
    setMeasurePoint1,
    setMeasurePoint2,
    setMeasureCursor,
    setMeasureResultMm,
    selectedIds,
    addBuilding,
    setMode,
    buildingInputMethod,
    setBuildingInputMethod,
    showDimensionLines,
    toggleShowDimensionLines,
    canvasSize,
    setCanvasSize,
    alertMessage,
    setAlertMessage,
  } = useCanvasStore();
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [showBuilding2FModal, setShowBuilding2FModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showScaffoldStartModal, setShowScaffoldStartModal] = useState(false);
  // bothmode から⭐設定を開いた場合の固定階(2F誘導)。通常起動は undefined。
  const [scaffoldStartLockFloor, setScaffoldStartLockFloor] = useState<number | undefined>(undefined);
  const [showUdekiModal, setShowUdekiModal] = useState(false);
  const [showAutoLayoutModal, setShowAutoLayoutModal] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  // 自動割付ルール変更のお知らせ（初回表示・「今後表示しない」で抑止）
  const [showFeatureNotice, setShowFeatureNotice] = useState(false);
  const [drawingTitle, setDrawingTitle] = useState('');
  const [siteName, setSiteName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  // 起動時自動全範囲表示 (= #1): drawingId ごとに 1 回 fit するための ref フラグ
  const fittedForDrawingIdRef = useRef<string | null>(null);
  // 編集モーダル用 state (= γ、 元請け様名追加)
  const [projectAddress, setProjectAddress] = useState('');
  const [projectContractor, setProjectContractor] = useState('');
  const [showProjectEditModal, setShowProjectEditModal] = useState(false);

  // 画面サイズ計測
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setCanvasSize({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // 自動割付ルール変更のお知らせ: 初回表示（localStorage 判定は client の useEffect 内＝SSR 安全）。
  useEffect(() => {
    if (!isNoticeDismissed()) setShowFeatureNotice(true);
  }, []);

  // 部材設定を（まだ読み込まれていなければ）DB からロード
  useEffect(() => {
    useHandrailSettingsStore.getState().loadHandrailSettings();
  }, []);

  // 認証セッションを hydrate（E-4.1）。エディタを直接開く/リロードすると authStore は匿名
  // (email='') で初期化され loadSession が呼ばれず、管理者限定機能(立面図など)の判定が
  // 効かなくなる。ここで復元 → user 反映後に reactive に再評価される（完了前は匿名=非表示）。
  useEffect(() => {
    useAuthStore.getState().loadSession();
  }, []);

  // 選択カテゴリロックを localStorage から復元 (= default 全 false、 不正値は無視)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('ashiba-plan:selectLock');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (
          parsed && typeof parsed === 'object'
          && typeof parsed.parts === 'boolean'
          && typeof parsed.building === 'boolean'
          && typeof parsed.obstacle === 'boolean'
          && typeof parsed.roof === 'boolean'
          && typeof parsed.dimension === 'boolean'
        ) {
          useCanvasStore.setState({ selectLock: parsed });
        }
      }
    } catch {
      // localStorage アクセス不可 / JSON parse 失敗 は default 維持
    }
  }, []);

  // 図面データ読み込み
  useEffect(() => {
    if (!drawingId) return;
    setDrawingId(drawingId);
    // 現場切替時の作業 state 一括リセット (= #5、 modal/mode/preview/history 等を初期化)
    useCanvasStore.getState().resetForDrawingChange();

    const loadDrawing = async () => {
      const { data: drawing } = await supabase
        .from('drawings')
        .select('*, projects(name, address, contractor_name)')
        .eq('id', drawingId)
        .single();

      if (drawing) {
        setCanvasData(drawing.canvas_data as CanvasData);
        setProjectId(drawing.project_id);
        setDrawingTitle(drawing.title);
        if (drawing.projects) {
          const p = drawing.projects as { name: string; address: string | null; contractor_name: string | null };
          setSiteName(p.name);
          setProjectAddress(p.address ?? '');
          setProjectContractor(p.contractor_name ?? '');
        }
      }
    };
    loadDrawing();
  }, [drawingId, setDrawingId, setProjectId, setCanvasData]);

  // 起動時自動全範囲表示 (= #1): コンテンツ + canvasSize 確定後、 drawingId ごとに 1 回。
  // E-6f: 建物レス(立面のみ等)ページも対象にするためコンテンツ総数で判定・content 基準にフィット。
  const contentCount = canvasData.buildings.length + (canvasData.elevationViews?.length ?? 0)
    + canvasData.obstacles.length + canvasData.memos.length;
  useEffect(() => {
    if (!drawingId) return;
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    if (contentCount === 0) return;
    if (fittedForDrawingIdRef.current === drawingId) return;
    zoomToFitContent(canvasSize.width, canvasSize.height, 3000);
    fittedForDrawingIdRef.current = drawingId;
  }, [drawingId, contentCount, canvasSize.width, canvasSize.height, zoomToFitContent]);


  // 保存
  const handleSave = useCallback(async () => {
    if (!drawingId) return;
    setSaveStatus('saving');
    const { error } = await supabase
      .from('drawings')
      .update({
        canvas_data: canvasData as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq('id', drawingId);

    // プロジェクトのupdated_atも更新
    const projectId = useCanvasStore.getState().projectId;
    if (projectId) {
      await supabase
        .from('projects')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', projectId);
    }

    setSaveStatus(error ? 'error' : 'saved');
    if (!error) useCanvasStore.setState({ isDirty: false });
    setTimeout(() => setSaveStatus('idle'), 2000);
  }, [drawingId, canvasData, setSaveStatus]);

  // 出力処理
  const handleExport = useCallback(
    async (settings: {
      format: 'pdf' | 'png' | 'dxf';
      paperSize: PaperSize;
      scale: ScaleOption;
      allPages?: boolean;
      onProgress?: (p: { current: number; total: number; title: string }) => void;
    }) => {
      try {
        if (settings.format === 'png') {
          const { exportToPng } = await import('@/lib/export/pngExport');
          await exportToPng(siteName);
        } else if (settings.format === 'pdf') {
          let exportedPages = 1; // 完了案内に出すページ数（全ページ出力時に上書き）
          const store = useCanvasStore.getState();
          const pdfSettings = {
            format: 'pdf' as const,
            paperSize: settings.paperSize,
            scale: settings.scale,
            companyName: useAuthStore.getState().profile?.company_name || '',
            siteName,
            date: new Date().toLocaleDateString('ja-JP'),
          };
          if (settings.allPages && store.projectId) {
            // E-7: 物件の全ページを1つの PDF に。ページごとに canvasData を差し替えて描く。
            const { exportAllPagesToPdf } = await import('@/lib/export/multiPageExport');
            const count = await exportAllPagesToPdf({
              projectId: store.projectId,
              settings: pdfSettings,
              onProgress: settings.onProgress,
            });
            if (count === 0) throw new Error('出力できるページがありません');
            exportedPages = count;
          } else {
            const { exportToPdf } = await import('@/lib/export/pdfExport');
            const { withFittedPrintView } = await import('@/lib/export/exportViewport');
            // E-7-1: 印刷枠が画面外にはみ出していると、その部分が白紙で出力される（背景・グリッドは
            //   ビューポート分しか描かれないため）。キャプチャの間だけビューを寄せ、終わったら戻す。
            await withFittedPrintView(
              canvasData, settings.paperSize, settings.scale, store.printAreaCenter,
              (view) => exportToPdf(
                canvasData, pdfSettings, store.printAreaCenter, view.zoom, view.panX, view.panY,
              ),
            );
          }
          // PDF 保存完了案内 (= UA 判定で端末別文言)
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
          const deviceMsg = /iPhone|iPad|iPod/.test(ua)
            ? '『ファイル』 アプリの「ダウンロード」 で確認できます。'
            : /Android/i.test(ua)
            ? 'ダウンロードフォルダ または Files アプリで確認できます。'
            : 'ダウンロードフォルダに保存されました。';
          const pagesMsg = exportedPages > 1 ? `（全${exportedPages}ページ）` : '';
          useCanvasStore.getState().setAlertMessage(`PDFを保存しました${pagesMsg}\n\n${deviceMsg}`);
        } else {
          const { exportToDxf } = await import('@/lib/export/dxfExport');
          exportToDxf(canvasData, siteName);
        }
        setShowExportModal(false);
      } catch (e) {
        console.error('[handleExport] error:', e);
        alert(`出力エラー: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [canvasData, siteName]
  );

  return (
    <div className="h-screen flex flex-col bg-dark-bg overflow-hidden">
      {/* ヘッダー */}
      <header className="flex-shrink-0 bg-dark-surface border-b border-dark-border px-3 py-2 flex items-center justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => {
              if (isDirty) {
                setShowBackConfirm(true);
              } else {
                router.push('/projects');
              }
            }}
            className="text-accent text-sm px-2 py-1 flex-shrink-0"
          >
            ←
          </button>
          <div
            className="cursor-pointer min-w-0"
            onClick={() => setShowProjectEditModal(true)}
          >
            <h1 className="text-sm font-bold truncate max-w-[90px] sm:max-w-[150px]">{siteName}</h1>
            <p className="text-xs text-dimension truncate">{drawingTitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* アンドゥ/リドゥ */}
          <button
            onClick={() => {
              const s = useCanvasStore.getState();
              // ケースA: 壁方向入力モード中で履歴がある → 1点戻す
              if (s.buildingInputMethod === 'direction' && s.directionPointsHistory.length > 0) {
                s.undoDirectionPoint();
                return;
              }
              // ケースB: 壁方向入力モード中で起点のみ → モード終了
              if (s.buildingInputMethod === 'direction' && s.directionPoints.length > 0 && s.directionPointsHistory.length === 0) {
                s.clearDirectionPoints();
                s.setBuildingInputMethod('template');
                s.setMode('select');
                return;
              }
              // ケースC: 建物完成直後 → 建物を消して壁方向入力モードを再開
              if (s.lastCompletedDirectionSession) {
                const session = s.lastCompletedDirectionSession;
                s.setAutoOpenRoofForBuildingId(null);
                s.undo();
                s.setDirectionPoints(session.points);
                s.setBuildingInputMethod('direction');
                s.setMode('building');
                s.setLastCompletedDirectionSession(null);
                return;
              }
              // 寸法計測
              if (isMeasuring && (measurePoint1 || measurePoint2)) {
                setMeasurePoint1(null);
                setMeasurePoint2(null);
                setMeasureCursor(null);
                setMeasureResultMm(null);
                return;
              }
              // 通常undo
              undo();
            }}
            disabled={
              (buildingInputMethod === 'direction' && (directionPoints.length > 0 || directionPointsHistory.length > 0))
                ? false
                : lastCompletedDirectionSession
                ? false
                : isMeasuring
                ? !(measurePoint1 || measurePoint2)
                : history.past.length === 0
            }
            className="px-2 py-1 text-lg disabled:opacity-30 text-dimension hover:text-canvas"
            title="元に戻す"
          >
            ↩
          </button>
          <button
            onClick={redo}
            disabled={history.future.length === 0}
            className="px-2 py-1 text-lg disabled:opacity-30 text-dimension hover:text-canvas"
            title="やり直し"
          >
            ↪
          </button>

          {/* 保存 */}
          <button
            onClick={handleSave}
            className={`px-3 py-1 rounded-lg text-sm font-bold ml-1 ${
              saveStatus === 'saved'
                ? 'bg-success text-white'
                : saveStatus === 'error'
                ? 'bg-red-500 text-white'
                : isDirty
                ? 'bg-accent text-white'
                : 'bg-dark-bg text-dimension border border-dark-border'
            }`}
          >
            {saveStatus === 'saving'
              ? '...'
              : saveStatus === 'saved'
              ? '保存済'
              : saveStatus === 'error'
              ? 'エラー'
              : '保存'}
          </button>

          {/* 寸法計測（スマホのみ） */}
          <button
            onClick={toggleMeasuring}
            className={`sm:hidden px-3 py-1 rounded-lg text-sm font-bold border transition-colors ${
              isMeasuring
                ? 'bg-accent text-white border-accent'
                : 'bg-dark-bg border-dark-border text-dimension'
            }`}
            title="寸法計測"
          >
            📏
          </button>

          {/* 出力 */}
          {/* スマホ用計測結果表示 */}
          {isMeasuring && measureResultMm !== null && (
            <div className="sm:hidden fixed top-14 right-3 z-40 px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-mono font-bold shadow-lg">
              {measureResultMm}mm
            </div>
          )}
          {/* スマホ用軸切替 */}
          {isMeasuring && (
            <div className="sm:hidden fixed top-14 left-3 z-40 flex gap-1 bg-dark-surface border border-dark-border rounded-lg p-0.5 shadow-lg">
              {(['free', 'x', 'y'] as const).map(m => (
                <button key={m}
                  onClick={() => setMeasureAxisMode(m)}
                  className={`px-2 py-1 rounded text-xs font-bold ${
                    measureAxisMode === m ? 'bg-accent text-white' : 'text-dimension'
                  }`}
                >{m === 'free' ? '⇱' : m === 'x' ? '↔' : '↕'}</button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowExportModal(true)}
            className="px-2 sm:px-3 py-1 bg-dark-bg border border-dark-border rounded-lg text-sm text-dimension hover:text-canvas flex-shrink-0"
            title="出力"
          >
            <span className="sm:hidden">📤</span>
            <span className="hidden sm:inline">出力</span>
          </button>
          {/* ダークモード切替（PC のみ。スマホは下メニュー「設定」内のスイッチで操作） */}
          <DarkModeToggle />
        </div>
      </header>

      {/* ページ(シート)タブ (= E-6a、 現物件の複数 drawing をタブ切替) */}
      <PageTabsContainer />

      {/* キャンバスエリア */}
      <div ref={containerRef} data-canvas-container className="flex-1 relative overflow-hidden">
        {canvasSize.width > 0 && canvasSize.height > 0 && (
          <GridCanvas width={canvasSize.width} height={canvasSize.height} />
        )}
        <CompassWidget />
        <OperationGuideBar />

        {/* スマホ用 全体表示ボタン (E-6f: 全ページ常時表示・コンテンツ基準にフィット) */}
        <button
          onClick={() => {
            const vw = canvasSize.width || window.innerWidth;
            const vh = canvasSize.height || (window.innerHeight - 120);
            zoomToFitContent(vw, vh, 3000);
          }}
          className="sm:hidden absolute top-3 right-3 p-2 bg-dark-surface border border-dark-border rounded-lg shadow-lg text-dimension z-10"
          title="全体表示"
        >
          🔍
        </button>

        {/* 右上ボタン群（PC） */}
        <div className="hidden sm:flex absolute top-3 right-3 flex-col gap-2 z-10" style={{ display: showSettingsPanel ? undefined : 'none' }}>
          {/* 全体表示ボタン (E-6f: 全ページ常時表示・コンテンツ基準にフィット) */}
          {(
            <button
              onClick={() => {
                const vw = canvasSize.width || window.innerWidth;
                const vh = canvasSize.height || (window.innerHeight - 120);
                zoomToFitContent(vw, vh, 3000);
              }}
              className="w-10 h-10 bg-dark-surface border border-dark-border rounded-xl flex items-center justify-center text-dimension hover:text-canvas shadow-lg transition-colors"
              title="全体表示"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8.5" cy="8.5" r="5.5" />
                <line x1="12.5" y1="12.5" x2="17" y2="17" />
                <line x1="6" y1="8.5" x2="11" y2="8.5" />
                <line x1="8.5" y1="6" x2="8.5" y2="11" />
              </svg>
            </button>
          )}

          {/* 寸法表示トグル */}
          <button
            onClick={toggleShowDimensions}
            className={`w-10 h-10 border rounded-xl flex items-center justify-center shadow-lg transition-colors ${
              showDimensions
                ? 'bg-accent border-accent text-white'
                : 'bg-dark-surface border-dark-border text-dimension hover:text-canvas'
            }`}
            title={showDimensions ? '寸法を非表示' : '寸法を表示'}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="1" y1="17" x2="17" y2="17" />
              <line x1="1" y1="17" x2="1" y2="1" />
              <line x1="1" y1="5" x2="4" y2="5" />
              <line x1="1" y1="9" x2="3" y2="9" />
              <line x1="1" y1="13" x2="4" y2="13" />
              <line x1="5" y1="17" x2="5" y2="14" />
              <line x1="9" y1="17" x2="9" y2="15" />
              <line x1="13" y1="17" x2="13" y2="14" />
            </svg>
          </button>

          {/* 寸法線トグル（方位別スパン寸法） */}
          <button
            onClick={toggleShowDimensionLines}
            className={`w-10 h-10 border rounded-xl flex items-center justify-center shadow-lg transition-colors ${
              showDimensionLines
                ? 'bg-accent border-accent text-white'
                : 'bg-dark-surface border-dark-border text-dimension hover:text-canvas'
            }`}
            title={showDimensionLines ? '寸法線を非表示' : '寸法線を表示'}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="2" y1="2" x2="2" y2="16" />
              <line x1="16" y1="2" x2="16" y2="16" />
              <line x1="2" y1="9" x2="16" y2="9" />
              <line x1="5" y1="7" x2="2" y2="9" />
              <line x1="5" y1="11" x2="2" y2="9" />
              <line x1="13" y1="7" x2="16" y2="9" />
              <line x1="13" y1="11" x2="16" y2="9" />
            </svg>
          </button>

          {/* Phase J-5: 寸法線の段別チェックボックス (マスター ON 時のみ表示) */}
          {showDimensionLines && (
            <div className="bg-dark-surface border border-dark-border rounded-xl p-2 shadow-lg">
              {/* S-5e-4: 対象階を present-floors 化。{1,2} では従来 6 項目・同順。 */}
              <DimensionVisibilityCheckboxes
                disabled={!showDimensionLines}
                floors={Array.from(new Set(canvasData.buildings.map(b => b.floor ?? 1))).sort((a, b) => a - b)}
              />

            </div>
          )}

          {/* 離れ表示トグル */}
          <button
            onClick={toggleShowKidare}
            className={`w-10 h-10 border rounded-xl flex items-center justify-center shadow-lg transition-colors ${
              showKidare
                ? 'bg-accent border-accent text-white'
                : 'bg-dark-surface border-dark-border text-dimension hover:text-canvas'
            }`}
            title={showKidare ? '離れを非表示' : '離れを表示'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 12 L21 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M3 8 L3 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M21 8 L21 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <path d="M6 12 L8 10 M6 12 L8 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M18 12 L16 10 M18 12 L16 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          {/* 寸法計測ボタン */}
          <button
            onClick={toggleMeasuring}
            className={`w-10 h-10 border rounded-xl flex items-center justify-center shadow-lg transition-colors ${
              isMeasuring
                ? 'bg-accent border-accent text-white'
                : 'bg-dark-surface border-dark-border text-dimension hover:text-canvas'
            }`}
            title="寸法計測（2点指定）"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M4 20 L20 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="4" cy="20" r="2" fill="currentColor"/>
              <circle cx="20" cy="4" r="2" fill="currentColor"/>
            </svg>
          </button>
          {isMeasuring && measureResultMm !== null && (
            <div className="px-2 py-1 bg-accent/20 border border-accent rounded-lg text-xs font-mono font-bold text-accent text-center">
              {measureResultMm}mm
            </div>
          )}
          {isMeasuring && (
            <div className="flex gap-1 bg-dark-surface border border-dark-border rounded-lg p-0.5">
              {(['free', 'x', 'y'] as const).map(m => (
                <button key={m}
                  onClick={() => setMeasureAxisMode(m)}
                  className={`flex-1 px-2 py-1 rounded text-[10px] font-bold ${
                    measureAxisMode === m ? 'bg-accent text-white' : 'text-dimension'
                  }`}
                >{m === 'free' ? '⇱' : m === 'x' ? '↔' : '↕'}</button>
              ))}
            </div>
          )}

          {/* R-1k(R-1i): 旧・屋根設定ボタンは撤去。屋根は「躯体 → 屋根」で領域を作成し、
              平面の出幅点線タップで編集/削除する（屋根オブジェクト方式に一本化）。 */}

        </div>


        {/* スケールバー */}
        <ScaleBar />
      </div>

      {/* 部材選択パネル */}
      {(showPartSelector || mode === 'obstacle') && <PartSelector />}

      {/* キャンバスのコンテキストメニュー（右クリック/長押し・コピー/切り取り/貼り付け/削除・E-6c） */}
      <CanvasContextMenu />

      {/* モードツールバー */}
      <ModeToolbar />

      {/* 選択移動モードの 3 ステップ UI (各コンポーネントが step に応じて表示制御) */}
      <MoveSelectCategoryModal />
      <MoveSelectRangePanel />
      <MoveSelectMovePanel />
      <ReorderModeBar />

      {/* 壁方向入力の確定ボタン */}
      {mode === 'building' && buildingInputMethod === 'direction' && directionPoints.length >= 1 && (
        <div className="fixed bottom-20 sm:bottom-6 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-50 flex gap-1 sm:gap-3 px-2 sm:px-0">
          <button
            onClick={() => {
              clearDirectionPoints();
              setBuildingInputMethod('template');
              setPendingTargetType('building'); // R-1e-fix7b: 屋根描き中断時も target をリセット
              setMode('select');
            }}
            className="flex-1 sm:flex-none h-11 sm:h-auto px-2 sm:px-5 sm:py-2.5 bg-dark-surface border border-dark-border rounded-xl text-sm text-dimension font-bold shadow-lg whitespace-nowrap"
          >
            キャンセル
          </button>
          <button
            onClick={toggleDirectionGuide}
            className={`flex-1 sm:flex-none h-11 sm:h-auto px-2 sm:px-4 sm:py-2.5 rounded-xl text-sm font-bold shadow-lg border transition-colors whitespace-nowrap ${
              showDirectionGuide ? 'bg-orange-500 text-white border-orange-500' : 'bg-dark-surface border-dark-border text-dimension'
            }`}
          >
            {showDirectionGuide ? 'ガイドON' : 'ガイドOFF'}
          </button>
          <button
            onClick={() => setShowDirectionInputModal(true)}
            className="flex-1 sm:flex-none h-11 sm:h-auto px-2 sm:px-5 sm:py-2.5 bg-accent/80 text-white rounded-xl text-sm font-bold shadow-lg whitespace-nowrap"
          >
            {directionInputLabels(pendingTargetType === 'roof').addSegment}
          </button>
          {directionPoints.length >= 3 && (
            <button
              onClick={() => {
                const newId = uuidv4();
                const pts = [...directionPoints];
                if (pendingTargetType === 'roof') {
                  // R-1e-fix7b: 屋根領域を描き終えた → 乗る建物に紐づけて設定モーダルへ。
                  // R-1h-3: 屋根が乗る建物は編集中の階から選ぶ（総二階では 1F/2F の外形が重なり、
                  //   従来は配列順で先の建物＝常に 1F に紐づいていた）。
                  const buildingId = buildingIdForPolygonOnFloor(pts, canvasData.buildings, useCanvasStore.getState().activeFloor);
                  if (buildingId) useCanvasStore.getState().setRoofSettingsTarget({ buildingId, polygon: pts });
                  setPendingTargetType('building');
                } else if (pendingTargetType === 'obstacle' && pendingObstacleType) {
                  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
                  const minX = Math.min(...xs), minY = Math.min(...ys);
                  const maxX = Math.max(...xs), maxY = Math.max(...ys);
                  addObstacle({ id: newId, type: pendingObstacleType, x: minX, y: minY, width: maxX - minX, height: maxY - minY, points: pts });
                  setPendingTargetType('building');
                  setPendingObstacleType(null);
                } else {
                  addBuilding({ id: newId, type: 'polygon', points: pts, fill: '#3d3d3a', floor: pendingBuildingFloor });
                  // R-1e: 屋根は「屋根モード」で別作業。作成直後の屋根モーダル自動オープンは廃止（押し付けない）。
                  setPendingBuildingFloor(1);
                }
                setLastCompletedDirectionSession({ points: pts });
                clearDirectionPoints();
                setBuildingInputMethod('template');
                setMode('select');
              }}
              className="flex-1 sm:flex-none h-11 sm:h-auto px-2 sm:px-5 sm:py-2.5 bg-accent text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg whitespace-nowrap"
            >
              {directionInputLabels(pendingTargetType === 'roof').confirm}（{directionPoints.length}点）
            </button>
          )}
        </div>
      )}

      {/* モーダル */}
      {showDirectionInputModal && (
        <DirectionInputModal onClose={() => setShowDirectionInputModal(false)} />
      )}
      <RoofObjectModal />
      {/* R-1k: 高さ/棟/屋根ツールの起動直後に対象階を訊く（複数階のときのみ） */}
      <FloorPickerModal />
      <PinDistanceInputModal />
      {(showBuildingModal || showBuildingModalStore) && (
        <BuildingTemplateModal onClose={() => { setShowBuildingModal(false); setShowBuildingModalStore(false); }} />
      )}
      {(showBuilding2FModal || showBuilding2FModalStore) && (
        <BuildingTemplateModal
          floor={2}
          floor1Building={[...canvasData.buildings].sort((a, b) => (b.floor ?? 1) - (a.floor ?? 1))[0]}
          onClose={() => { setShowBuilding2FModal(false); setShowBuilding2FModalStore(false); }}
        />
      )}
      <FloorSelector />
      {showExportModal && (
        <ExportModal
          onClose={() => setShowExportModal(false)}
          onExport={async (settings) => {
            await handleExport(settings);
            setShowExportModal(false);
          }}
          siteName={siteName}
        />
      )}
      {(showScaffoldStartModal || showScaffoldStart) && (
        <ScaffoldStartModal onClose={() => { setShowScaffoldStartModal(false); setShowScaffoldStart(false); setScaffoldStartLockFloor(undefined); }} lockFloor={scaffoldStartLockFloor} />
      )}
      {(showUdekiModal || showInnerPost) && (
        <UdekiModal onClose={() => { setShowUdekiModal(false); setShowInnerPost(false); }} />
      )}
      {alertMessage && (
        <AlertDialog message={alertMessage} onClose={() => setAlertMessage(null)} />
      )}
      {showFeatureNotice && (
        <FeatureNoticeModal
          onClose={(dontShowAgain) => {
            if (dontShowAgain) dismissNotice();
            setShowFeatureNotice(false);
          }}
        />
      )}
      {showCalculator && (
        <CalculatorModal onClose={() => setShowCalculator(false)} />
      )}
      <HeightInputModal />
      <RidgeLineInputModal />
      <AreaCalculationModal siteName={siteName} />
      <ElevationModal />
      <AreaDesignationModeBar />
      {showBackConfirm && (
        <ConfirmDialog
          title="未保存の変更があります"
          message="戻るとこれまでの編集内容が失われます。"
          primaryLabel="保存して戻る"
          secondaryLabel="保存せずに戻る"
          cancelLabel="キャンセル"
          onPrimary={async () => {
            setShowBackConfirm(false);
            await handleSave();
            // 保存失敗時 (= saveStatus === 'error') は留まり、 既存 UI で通知
            if (useCanvasStore.getState().saveStatus !== 'error') {
              router.push('/projects');
            }
          }}
          onSecondary={() => {
            setShowBackConfirm(false);
            router.push('/projects');
          }}
          onCancel={() => setShowBackConfirm(false)}
        />
      )}
      {(showAutoLayoutModal || showAutoLayout) && (
        <AutoLayoutModal onClose={() => { setShowAutoLayoutModal(false); setShowAutoLayout(false); }} onOpenScaffoldStart={(lockFloor) => { setScaffoldStartLockFloor(lockFloor); setShowScaffoldStartModal(true); }} />
      )}
      {selectedLineIds.length >= 2 && (
        <HandrailReorderModal
          lineIds={selectedLineIds}
          buildingPoints={canvasData.buildings[0]?.points}
          onClose={() => setSelectedLineIds([])}
          onConfirm={(newOrder) => {
            reorderHandrails(selectedLineIds, newOrder);
            setSelectedLineIds([]);
          }}
        />
      )}
      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
      {/* チュートリアル overlay (= デフォルト OFF、 設定メニューから手動起動) */}
      <TutorialOverlay />
      {showMemoCreateModal && (
        <MemoCreateModal onClose={() => setShowMemoCreateModal(false)} />
      )}
      {/* R-1k(R-1i): 旧・屋根設定モーダル(RoofSettingsModal)の描画箇所を撤去。
          屋根の作成/編集/削除は RoofObjectModal（屋根オブジェクト）に一本化した。 */}
      {showProjectEditModal && (
        <ProjectEditModal
          initialName={siteName}
          initialAddress={projectAddress}
          initialContractor={projectContractor}
          onClose={() => setShowProjectEditModal(false)}
          onSave={async ({ name, address, contractor_name }) => {
            const projectId = useCanvasStore.getState().projectId;
            if (!projectId) return;
            const { error } = await supabase.from('projects').update({
              name,
              address: address || null,
              contractor_name: contractor_name || null,
              updated_at: new Date().toISOString(),
            }).eq('id', projectId);
            if (error) {
              alert(`保存エラー: ${error.message}`);
              return;
            }
            setSiteName(name);
            setProjectAddress(address);
            setProjectContractor(contractor_name);
          }}
        />
      )}
    </div>
  );
}

/** スケールバー */
function ScaleBar() {
  const { zoom } = useCanvasStore();
  const GRID_PX = 3;
  const gridPx = GRID_PX * zoom;

  // 100mmをpxで計算（10グリッド = 100mm）
  const hundredMmPx = 10 * gridPx;
  // 画面に収まるスケールを選択
  let scaleMm = 100;
  let barPx = hundredMmPx;
  if (barPx > 150) { scaleMm = 50; barPx = hundredMmPx / 2; }
  if (barPx > 150) { scaleMm = 20; barPx = hundredMmPx / 5; }
  if (barPx < 30) { scaleMm = 500; barPx = hundredMmPx * 5; }
  if (barPx < 30) { scaleMm = 1000; barPx = hundredMmPx * 10; }

  return (
    <div className="absolute bottom-20 left-3 flex items-center gap-1 bg-dark-bg/80 rounded px-2 py-1">
      <div
        className="h-0.5 bg-dimension"
        style={{ width: `${barPx}px` }}
      />
      <span className="text-xs text-dimension">{scaleMm}mm</span>
    </div>
  );
}
