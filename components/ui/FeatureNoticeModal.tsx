'use client';

import { useState } from 'react';

// 機能変更のお知らせモーダル（自動割付ルール変更 v20260704）。
// 文言はここに集約（後で差し替えやすいよう定数化）。AlertDialog と同じ modal-overlay スタイル。

const NOTICE_TITLE = '自動割付が新しくなりました';
const NOTICE_LEAD = '使い方が変わった点が3つあります。';
const NOTICE_ITEMS: Array<{ heading: string; body: string }> = [
  {
    heading: '① 離れは「範囲」で指定します',
    body: '辺ごとに1つずつ入れていた離れが、建物全体で下限〜上限の範囲（例: 700〜950mm）を入れる方式になりました。「中央」か「建物に近い側」を選ぶだけで、各辺にちょうど割れる位置へ自動で配置します。',
  },
  {
    heading: '② 最初の角（⭐）を置かなくても計算できます',
    body: 'スタート角の手動配置が任意になりました。⭐を置かなくても、範囲を入れれば自動で起点を決めて割り付けます（⭐を置けば従来どおりそこが起点になります）。',
  },
  {
    heading: '③ 3階以上に対応しました',
    body: '「上の階を追加」で3階以上を作れて、全階まとめて自動割付できるようになりました。',
  },
];

type Props = {
  /** dontShowAgain=true のとき呼び出し側で dismissNotice() する。 */
  onClose: (dontShowAgain: boolean) => void;
};

export default function FeatureNoticeModal({ onClose }: Props) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div className="fixed inset-0 modal-overlay z-50 flex items-end sm:items-center justify-center">
      <div className="bg-dark-surface border-t sm:border border-dark-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md mx-0 sm:mx-4 max-h-[90vh] overflow-y-auto">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-dark-surface px-5 pt-5 pb-3 border-b border-dark-border">
          <h2 className="text-base font-bold text-canvas">{NOTICE_TITLE}</h2>
          <p className="text-xs text-dimension mt-1">{NOTICE_LEAD}</p>
        </div>

        {/* 本文 */}
        <div className="px-5 py-4 space-y-4">
          {NOTICE_ITEMS.map((item) => (
            <div key={item.heading}>
              <p className="text-sm font-bold text-accent">{item.heading}</p>
              <p className="text-xs text-canvas leading-relaxed mt-1">{item.body}</p>
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 bg-dark-surface px-5 pb-5 pt-3 border-t border-dark-border space-y-3">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="w-4 h-4 accent-accent shrink-0"
            />
            <span className="text-xs text-dimension">今後表示しない</span>
          </label>
          <button
            type="button"
            onClick={() => onClose(dontShowAgain)}
            className="w-full py-2.5 bg-accent text-white rounded-xl text-sm font-bold"
          >
            わかりました
          </button>
        </div>
      </div>
    </div>
  );
}
