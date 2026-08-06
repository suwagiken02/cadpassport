/** @type {import('next').NextConfig} */

// ビルドの版を計測へ渡す（events.app_version）。
//   実機で「直したはずが直っていない」の多くは、古いバンドルが動いていることが原因。
//   （PWA の Service Worker が前のビルドを持ち続ける等）
//   セッションごとに版が見えれば、コードの問題か配信の問題かをすぐ切り分けられる。
const appVersion = (() => {
  try {
    const pkg = require('./package.json');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    return `${pkg.version}+${stamp}`;
  } catch {
    return 'unknown';
  }
})();

const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
};

module.exports = nextConfig;
