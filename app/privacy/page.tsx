'use client';

import { useRouter } from 'next/navigation';

export default function PrivacyPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold text-accent mb-2">プライバシーポリシー</h1>
        <p className="text-sm text-dimension mb-6">CADパスポート / CADPASSPORT</p>

        <div className="space-y-2">
          <h2 className="text-lg font-bold mt-8 mb-3">第1章 基本方針</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第1条(基本方針)</h3>
          <p className="text-sm leading-relaxed">
            諏訪技建株式会社(以下「当社」といいます。)は、CADパスポート(CADPASSPORT)(以下「本サービス」といいます。)において取得する個人情報を、個人情報保護法その他関連法令に従い適切に取り扱います。
          </p>

          <h2 className="text-lg font-bold mt-8 mb-3">第2章 取得する情報</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第2条(取得する情報)</h3>
          <p className="text-sm leading-relaxed">
            当社は、以下の情報を取得する場合があります。
          </p>

          <div>
            <h4 className="text-sm font-bold mt-3 mb-1">1. アカウント登録情報</h4>
            <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
              <li>氏名</li>
              <li>メールアドレス</li>
              <li>生年月日</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold mt-3 mb-1">2. ログイン関連情報</h4>
            <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
              <li>Google アカウントのプロフィール情報</li>
              <li>パスワード復旧用 4 桁 PIN(ハッシュ化保存)</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold mt-3 mb-1">3. サービス利用情報</h4>
            <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
              <li>作成した図面データ</li>
              <li>操作履歴</li>
              <li>利用端末情報</li>
              <li>IP アドレス</li>
              <li>ブラウザ情報</li>
            </ul>
          </div>

          <div>
            <h4 className="text-sm font-bold mt-3 mb-1">4. 利用状況の記録(統計データ)</h4>
            <p className="text-sm leading-relaxed">
              本サービスを使いやすくするため、どの画面がどれくらい使われているかを記録します。記録するのは次のものです。
            </p>
            <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
              <li>開いた画面と、その画面にいた時間</li>
              <li>行った操作の種類と回数(例:自動配置、保存、出力)</li>
              <li>操作がうまくいったかどうか、うまくいかなかった場所</li>
              <li>利用者を数えるための記号(お名前や ID とは結び付かない形にしたもの)</li>
              <li>アプリのバージョン</li>
            </ul>
            <p className="text-sm leading-relaxed mt-2">
              次のものは記録しません。
            </p>
            <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
              <li>図面の中身(建物の形、寸法、現場の住所、プロジェクト名、元請け様名など)</li>
              <li>お名前、メールアドレス、電話番号などの個人を特定できる情報</li>
              <li>メモなどに入力された文章</li>
            </ul>
          </div>

          <h2 className="text-lg font-bold mt-8 mb-3">第3章 利用目的</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第3条(利用目的)</h3>
          <p className="text-sm leading-relaxed">
            取得した情報は、以下の目的で利用します。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>本サービス提供・運営のため</li>
            <li>ユーザー認証のため</li>
            <li>パスワード復旧・本人確認のため</li>
            <li>図面データ保存のため</li>
            <li>サービス改善・不具合対応のため</li>
            <li>不正利用防止のため</li>
            <li>お問い合わせ対応のため</li>
            <li>重要なお知らせ配信のため</li>
            <li>将来の有料プラン提供・請求対応のため</li>
          </ul>
          <p className="text-sm leading-relaxed mt-3">
            このうち「利用状況の記録(統計データ)」は、本サービスを使いやすくすることだけに使います。広告や、お客様ごとの分析には使いません。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>操作が止まりやすい場所を見つけて、直すため</li>
            <li>使われていない機能を整理するため</li>
            <li>不具合を見つけて、再び起きないようにするため</li>
          </ul>

          <h2 className="text-lg font-bold mt-8 mb-3">第4章 データ保存・安全管理</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第4条(クラウドサービス利用)</h3>
          <p className="text-sm leading-relaxed">
            本サービスでは、Supabase 社のクラウドサービスを利用しています。
          </p>
          <p className="text-sm leading-relaxed">
            データベース、認証、ストレージ等の情報は、Supabase 社のサーバ上で管理されます。
          </p>
          <p className="text-sm leading-relaxed">
            サーバは、日本国外(米国またはアジア地域等)に設置される場合があります。
          </p>

          <h3 className="text-base font-bold mt-4 mb-2">第5条(国外へのデータ移転)</h3>
          <p className="text-sm leading-relaxed">
            当社は、クラウドサービス利用に伴い、個人情報を国外サーバへ保存する場合があります。
          </p>
          <p className="text-sm leading-relaxed">
            当社は、個人情報保護法に基づき、適切な安全管理措置を講じた事業者を利用し、必要な契約・管理を行います。
          </p>

          <h3 className="text-base font-bold mt-4 mb-2">第6条(安全管理措置)</h3>
          <p className="text-sm leading-relaxed">
            当社は、個人情報および図面データの漏えい・紛失・改ざん防止のため、以下の対策を行います。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>通信の暗号化(SSL/TLS)</li>
            <li>アクセス制限</li>
            <li>パスワード・PIN の暗号化保存</li>
            <li>不正アクセス対策</li>
            <li>クラウドサービス側のセキュリティ利用</li>
          </ul>

          <h2 className="text-lg font-bold mt-8 mb-3">第5章 第三者提供</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第7条(第三者提供)</h3>
          <p className="text-sm leading-relaxed">
            当社は、以下の場合を除き、ユーザー本人の同意なく個人情報を第三者へ提供しません。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>法令に基づく場合</li>
            <li>人命・財産保護のため必要な場合</li>
            <li>業務委託先へ必要範囲で提供する場合</li>
            <li>不正利用防止・セキュリティ対応のため必要な場合</li>
          </ul>
          <p className="text-sm leading-relaxed mt-3">
            「利用状況の記録(統計データ)」は、第三者へ提供しません。外部の解析サービスも使っていません。記録は本サービスのデータベースの中だけに保存します。
          </p>

          <h2 className="text-lg font-bold mt-8 mb-3">第6章 保存期間・退会・データ削除</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第8条(利用状況の記録の保存期間)</h3>
          <p className="text-sm leading-relaxed">
            「利用状況の記録(統計データ)」は、記録した日から 180 日で削除します。
          </p>
          <p className="text-sm leading-relaxed">
            記録の停止をご希望の場合は、お問い合わせ窓口までご連絡ください。
          </p>

          <h3 className="text-base font-bold mt-4 mb-2">第9条(退会時の取り扱い)</h3>
          <p className="text-sm leading-relaxed">
            ユーザーが退会した場合、当社は一定期間経過後にアカウント情報および図面データを削除します。
          </p>
          <p className="text-sm leading-relaxed">
            ただし、以下の場合は一部情報を保持することがあります。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>法令上必要な場合</li>
            <li>不正利用防止のため必要な場合</li>
            <li>障害・紛争対応のため必要な場合</li>
          </ul>

          <h2 className="text-lg font-bold mt-8 mb-3">第7章 Cookie 等</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第10条(Cookie 等の利用)</h3>
          <p className="text-sm leading-relaxed">
            本サービスでは、ログイン状態維持、利便性向上、アクセス解析等のため Cookie 等を利用する場合があります。
          </p>
          <p className="text-sm leading-relaxed">
            ユーザーは、ブラウザ設定により Cookie を無効化できますが、一部機能が利用できなくなる場合があります。
          </p>

          <h2 className="text-lg font-bold mt-8 mb-3">第8章 ユーザーの権利</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第11条(開示・訂正・削除等)</h3>
          <p className="text-sm leading-relaxed">
            ユーザーは、当社に対し、自身の個人情報について以下を請求できます。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>開示</li>
            <li>訂正</li>
            <li>削除</li>
            <li>利用停止</li>
          </ul>
          <p className="text-sm leading-relaxed mt-2">
            請求を希望する場合は、お問い合わせ窓口までご連絡ください。
          </p>

          <h2 className="text-lg font-bold mt-8 mb-3">第9章 改訂</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第12条(ポリシー変更)</h3>
          <p className="text-sm leading-relaxed">
            当社は、法令改正やサービス内容変更等に応じて、本ポリシーを改訂する場合があります。
          </p>
          <p className="text-sm leading-relaxed">
            重要な変更を行う場合は、本サービス上で告知します。
          </p>

          <h2 className="text-lg font-bold mt-8 mb-3">第10章 お問い合わせ窓口</h2>

          <h3 className="text-base font-bold mt-4 mb-2">第13条(お問い合わせ)</h3>
          <p className="text-sm leading-relaxed">
            個人情報の取り扱いに関するお問い合わせは、以下までご連絡ください。
          </p>
          <ul className="list-disc pl-5 text-sm leading-relaxed space-y-1">
            <li>運営者:諏訪技建株式会社</li>
            <li>所在地:長野県諏訪市四賀433-1</li>
            <li>メールアドレス:suwagiken02@gmail.com</li>
          </ul>
        </div>

        <p className="mt-8 text-xs text-dimension">制定日:2026 年 5 月 7 日</p>
        <p className="text-xs text-dimension">最終改訂日:2026 年 8 月 6 日</p>

        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) {
              router.back();
            } else {
              router.push('/');
            }
          }}
          className="mt-8 w-full py-3 text-accent text-sm hover:underline"
        >
          ← 戻る
        </button>
      </div>
    </div>
  );
}
