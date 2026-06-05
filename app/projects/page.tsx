'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, DEFAULT_COMPANY_ID } from '@/stores/authStore';
import { useHandrailSettingsStore } from '@/stores/handrailSettingsStore';
import { useTutorialStore } from '@/stores/tutorialStore';
import { supabase } from '@/lib/supabase/client';
import DarkModeToggle from '@/components/DarkModeToggle';
import { Project } from '@/types';

/** 白紙の canvas_data テンプレ（createProject と startGuide で共通） */
function blankCanvasData() {
  return {
    version: '1.0',
    grid: { unitMm: 10, cols: 600, rows: 400 },
    buildings: [],
    roofOverhangs: [],
    obstacles: [],
    handrails: [],
    posts: [],
    antis: [],
    memos: [],
    compass: { angle: 0 },
  };
}

/** 使い方ガイド（練習用）プロジェクトの識別名 */
const GUIDE_PROJECT_NAME = '📘 使い方ガイド（練習用）';

export default function ProjectsPage() {
  const router = useRouter();
  const { user, profile, signOut, loadSession } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'updated' | 'name'>('updated');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newContractor, setNewContractor] = useState('');
  const [creating, setCreating] = useState(false);
  const [guideLoading, setGuideLoading] = useState(false);

  // Phase 3b: プロジェクト共有 URL モーダル用 state
  const [shareModal, setShareModal] = useState<{
    open: boolean;
    projectId: string | null;
  }>({ open: false, projectId: null });
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareExpiresAt, setShareExpiresAt] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadProjects = useCallback(async () => {
    // Day 7 commit B: company_id フィルタは削除。 RLS (= auth.uid() = owner_id) で
    // 自動的に自分の projects のみ取得される。
    const { data } = await supabase
      .from('projects')
      .select('*')
      .order('updated_at', { ascending: false });
    if (data) setProjects(data);
  }, []);

  useEffect(() => {
    loadSession().then(() => loadProjects());
    // 部材設定（手摺サイズの有効/無効）を DB からロード
    useHandrailSettingsStore.getState().loadHandrailSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createProject = async () => {
    if (!newName.trim()) return;
    setCreating(true);

    try {
      // セッション確認（Safari対策: 匿名セッションが切れている場合に再取得）
      const currentUser = useAuthStore.getState().user;
      const ownerId = currentUser ? currentUser.id : null;
      // Day 7 commit B: currentCompanyId をそのまま使う (= ID 認証なら個別 company の id、
      // メアド/Google なら NULL)。 RLS で owner_id ベースのフィルタが効くため、
      // company_id は単に保存するだけで参照系は不要。
      const companyId = useAuthStore.getState().currentCompanyId;

      const { data, error } = await supabase
        .from('projects')
        .insert({
          owner_id: ownerId,
          company_id: companyId,
          name: newName.trim(),
          address: newAddress.trim() || null,
          contractor_name: newContractor.trim() || null,
        })
        .select()
        .single();

      if (error) {
        console.error('[createProject] projects insert error:', error);
        alert(`現場作成エラー: ${error.message}`);
        setCreating(false);
        return;
      }
      if (!data) {
        alert('現場作成エラー: データが返されませんでした');
        setCreating(false);
        return;
      }

      // 図面も自動作成
      const { data: drawing, error: drawingError } = await supabase
        .from('drawings')
        .insert({
          project_id: data.id,
          title: '平面図',
          canvas_data: blankCanvasData(),
        })
        .select()
        .single();

      if (drawingError) {
        console.error('[createProject] drawings insert error:', drawingError);
        alert(`図面作成エラー: ${drawingError.message}`);
        setCreating(false);
        return;
      }

      if (drawing) {
        setProjects(prev => [data, ...prev]);
      }
    } catch (e) {
      console.error('[createProject] unexpected error:', e);
      alert(`予期しないエラー: ${e instanceof Error ? e.message : String(e)}`);
    }

    setCreating(false);
    setShowNewModal(false);
    setNewName('');
    setNewAddress('');
    setNewContractor('');
  };

  const deleteProject = async (id: string) => {
    if (!confirm('このプロジェクトを削除しますか？')) return;
    await supabase.from('drawings').delete().eq('project_id', id);
    await supabase.from('projects').delete().eq('id', id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  // Phase 3b: 共有 URL 発行 (= POST /api/share/create)
  const handleShare = async (projectId: string) => {
    setShareModal({ open: true, projectId });
    setShareUrl(null);
    setShareExpiresAt(null);
    setShareError('');
    setCopied(false);
    setShareLoading(true);
    try {
      const res = await fetch('/api/share/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareError(data.error || '共有 URL の発行に失敗しました');
      } else {
        setShareUrl(`${window.location.origin}/share/${data.token}`);
        setShareExpiresAt(data.expiresAt);
      }
    } catch (e) {
      setShareError(e instanceof Error ? e.message : '共有 URL の発行に失敗しました');
    } finally {
      setShareLoading(false);
    }
  };

  // Phase 3b: 共有 URL を clipboard にコピー
  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError('コピーに失敗しました。 URL を選択して手動でコピーしてください。');
    }
  };

  // Phase 3e: URL 貼り付け取り込み (= LINE 等で受け取った URL から token 抽出 + navigate)
  const SHARE_URL_REGEX = /\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
  const [pasteModal, setPasteModal] = useState(false);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteError, setPasteError] = useState('');

  const handlePasteUrl = () => {
    setPasteError('');
    const trimmed = pasteUrl.trim();
    if (!trimmed) {
      setPasteError('URL を入力してください');
      return;
    }
    const match = trimmed.match(SHARE_URL_REGEX);
    if (!match) {
      setPasteError('正しい共有 URL を入力してください');
      return;
    }
    router.push(`/share/${match[1]}`);
  };

  const openProject = async (projectId: string) => {
    const { data } = await supabase
      .from('drawings')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (data) {
      router.push(`/editor/${data.id}`);
    }
  };

  // 使い方ガイド: 白紙の練習図面を開いてチュートリアルを自動開始する。
  // 既存の練習用プロジェクトがあれば canvas_data を白紙にリセットして再利用、
  // 無ければ createProject と同じ insert ロジックで新規作成する。
  const startGuide = async () => {
    if (guideLoading) return;
    setGuideLoading(true);
    try {
      let drawingId: string | null = null;

      // (b) 読み込み済み projects から練習用プロジェクトを探す
      const existing = projects.find((p) => p.name === GUIDE_PROJECT_NAME);
      if (existing) {
        // (c) 最古 drawing を取得し canvas_data を白紙にリセット
        const { data: drawing } = await supabase
          .from('drawings')
          .select('id')
          .eq('project_id', existing.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();
        if (drawing) {
          const { error: updateError } = await supabase
            .from('drawings')
            .update({ canvas_data: blankCanvasData() })
            .eq('id', drawing.id);
          if (updateError) throw updateError;
          drawingId = drawing.id;
        }
      }

      // (d) 見つからない / drawing が無い → createProject と同じロジックで新規作成
      if (!drawingId) {
        const currentUser = useAuthStore.getState().user;
        const ownerId = currentUser ? currentUser.id : null;
        const companyId = useAuthStore.getState().currentCompanyId;

        const { data: proj, error: projError } = await supabase
          .from('projects')
          .insert({
            owner_id: ownerId,
            company_id: companyId,
            name: GUIDE_PROJECT_NAME,
            address: null,
            contractor_name: null,
          })
          .select()
          .single();
        if (projError || !proj) throw projError ?? new Error('プロジェクト作成に失敗しました');

        const { data: drawing, error: drawingError } = await supabase
          .from('drawings')
          .insert({
            project_id: proj.id,
            title: '平面図',
            canvas_data: blankCanvasData(),
          })
          .select()
          .single();
        if (drawingError || !drawing) throw drawingError ?? new Error('図面作成に失敗しました');

        setProjects((prev) => [proj, ...prev]);
        drawingId = drawing.id;
      }

      // (e) チュートリアル開始 → (f) 編集画面へ遷移
      useTutorialStore.getState().startTutorial();
      router.push(`/editor/${drawingId}`);
    } catch (e) {
      // (g) 失敗時はログ出力して loading 解除
      console.error('[startGuide] error:', e);
      setGuideLoading(false);
    }
  };

  const filtered = projects
    .filter((p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.address || '').toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'ja');
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });

  return (
    <div className="min-h-screen">
      {/* ヘッダー */}
      <header className="sticky top-0 z-10 bg-dark-surface border-b border-dark-border px-4 py-3">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <div>
            <h1 className="text-lg font-bold text-accent">CAD パスポート</h1>
            {profile?.company_name && (
              <p className="text-xs text-dimension">{profile.company_name}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* ダークモード切替（PC のみ。スマホはエディタ内の設定パネルで操作） */}
            <DarkModeToggle />
            <button
              onClick={() => router.push('/settings')}
              className="px-3 py-2 text-sm text-dimension hover:text-canvas rounded-lg"
            >
              設定
            </button>
            <button
              onClick={async () => { await signOut(); router.push('/auth'); }}
              className="px-3 py-2 text-sm text-dimension hover:text-canvas rounded-lg"
            >
              ログアウト
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        {/* 検索・並び替え */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="現場名・住所で検索"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-4 py-2 bg-dark-surface border border-dark-border rounded-lg text-canvas text-sm focus:outline-none focus:border-accent"
          />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'updated' | 'name')}
            className="px-3 py-2 bg-dark-surface border border-dark-border rounded-lg text-canvas text-sm"
          >
            <option value="updated">更新順</option>
            <option value="name">名前順</option>
          </select>
        </div>

        {/* 新規作成ボタン */}
        <button
          type="button"
          onClick={() => setShowNewModal(true)}
          className="w-full mb-3 py-4 bg-accent text-white font-bold rounded-xl text-lg hover:bg-blue-600 transition-colors"
        >
          + 新規プロジェクト作成
        </button>

        {/* Phase 3e: URL 貼り付け取り込みボタン (= secondary、 dark-surface 背景) */}
        <button
          type="button"
          onClick={() => { setPasteModal(true); setPasteUrl(''); setPasteError(''); }}
          className="w-full mb-3 py-4 bg-dark-surface border border-dark-border text-canvas font-bold rounded-xl text-lg hover:bg-dark-border transition-colors"
        >
          URL から取り込み
        </button>

        {/* 使い方ガイド（チュートリアル）: 白紙の練習図面を開いて自動開始。新規ユーザー向けに少し目立たせる */}
        <button
          type="button"
          onClick={startGuide}
          disabled={guideLoading}
          className="w-full mb-6 py-4 bg-accent/10 border-2 border-accent text-accent font-bold rounded-xl text-lg hover:bg-accent/20 transition-colors disabled:opacity-50"
        >
          {guideLoading ? '読み込み中...' : '📘 使い方を見る（チュートリアル）'}
        </button>

        {/* プロジェクト一覧 */}
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-dimension">
            <p className="text-lg mb-2">プロジェクトがありません</p>
            <p className="text-sm">「新規プロジェクト作成」から始めましょう</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="bg-dark-surface border border-dark-border rounded-xl p-4 hover:border-accent transition-colors cursor-pointer"
                onClick={() => openProject(project.id)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-bold text-canvas mb-1">{project.name}</h3>
                    {project.address && (
                      <p className="text-sm text-dimension mb-2">{project.address}</p>
                    )}
                    <p className="text-xs text-dimension">
                      更新: {new Date(project.updated_at).toLocaleDateString('ja-JP')}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleShare(project.id); }}
                    className="ml-2 px-3 py-1 text-xs text-accent hover:bg-accent/10 rounded-lg"
                  >
                    共有
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteProject(project.id); }}
                    className="ml-2 px-3 py-1 text-xs text-red-400 hover:bg-red-400/10 rounded-lg"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 新規作成モーダル */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* 背景overlay（クリックで閉じる） */}
          <div
            className="absolute inset-0 modal-overlay"
            onClick={() => setShowNewModal(false)}
          />
          {/* コンテンツ（overlayの上にrelativeで配置、formタグ不使用） */}
          <div
            className="relative bg-dark-surface border border-dark-border rounded-2xl p-6 w-full max-w-sm"
          >
            <h2 className="text-lg font-bold mb-4">新規プロジェクト</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-dimension mb-1">現場名 *</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createProject(); } }}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                  placeholder="○○邸 足場工事"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm text-dimension mb-1">住所</label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createProject(); } }}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                  placeholder="東京都..."
                />
              </div>
              <div>
                <label className="block text-sm text-dimension mb-1">元請け様名</label>
                <input
                  type="text"
                  value={newContractor}
                  onChange={(e) => setNewContractor(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); createProject(); } }}
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-canvas focus:outline-none focus:border-accent"
                  placeholder="○○工務店"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="flex-1 py-3 bg-dark-bg border border-dark-border rounded-lg text-dimension"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={createProject}
                disabled={!newName.trim() || creating}
                className="flex-1 py-3 bg-accent text-white font-bold rounded-lg disabled:opacity-50"
              >
                {creating ? '作成中...' : '作成'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase 3b: 共有 URL モーダル */}
      {shareModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 modal-overlay" onClick={() => setShareModal({ open: false, projectId: null })} />
          <div className="relative bg-dark-surface border border-dark-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold mb-4">共有 URL</h2>

            {shareLoading && (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin w-6 h-6 border-2 border-accent border-t-transparent rounded-full" />
              </div>
            )}

            {shareUrl && (
              <>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={shareUrl}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    className="flex-1 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-canvas text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-bold whitespace-nowrap"
                  >
                    {copied ? 'コピー済' : 'コピー'}
                  </button>
                </div>
                <p className="text-xs text-dimension mb-2">
                  この URL を共有相手に送ってください。 7 日間有効です。
                  受信者はログイン後にプロジェクトとして取り込めます。
                </p>
                {shareExpiresAt && (
                  <p className="text-xs text-dimension mb-4">
                    有効期限: {new Date(shareExpiresAt).toLocaleDateString('ja-JP', {
                      year: 'numeric', month: 'long', day: 'numeric'
                    })}
                  </p>
                )}
              </>
            )}

            {shareError && (
              <p className="text-red-400 text-sm mb-4">{shareError}</p>
            )}

            <button
              type="button"
              onClick={() => setShareModal({ open: false, projectId: null })}
              className="w-full py-2 text-accent text-sm hover:underline"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Phase 3e: URL 貼り付け取り込みモーダル */}
      {pasteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 modal-overlay" onClick={() => setPasteModal(false)} />
          <div className="relative bg-dark-surface border border-dark-border rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold mb-4">URL から取り込み</h2>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-sm text-dimension mb-1">共有 URL</label>
                <input
                  type="text"
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  placeholder="https://app.cadpassport.com/share/..."
                  className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-lg text-canvas text-sm focus:outline-none focus:border-accent"
                />
                <p className="mt-1 text-[10px] text-dimension">
                  送られた共有 URL をここに貼り付けてください。
                </p>
              </div>
            </div>

            {pasteError && (
              <p className="text-red-400 text-sm mb-4">{pasteError}</p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPasteModal(false)}
                className="flex-1 py-3 bg-dark-bg border border-dark-border rounded-lg text-dimension"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={handlePasteUrl}
                disabled={!pasteUrl.trim()}
                className="flex-1 py-3 bg-accent text-white font-bold rounded-lg disabled:opacity-50"
              >
                開く
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
