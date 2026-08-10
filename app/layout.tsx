import type { Metadata, Viewport } from 'next';
import './globals.css';
import DarkModeInit from '@/components/DarkModeInit';
import AnalyticsInit from '@/components/AnalyticsInit';
import { DevToolsExposer } from '@/components/DevToolsExposer';
import { PWARegister } from '@/components/PWARegister';

export const metadata: Metadata = {
  title: 'CAD パスポート - 足場平面図アプリ',
  description: 'くさび式足場の平面図をスマホで直感的に作成',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'CAD パスポート',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#378ADD',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-dark-bg text-canvas antialiased">
        <DarkModeInit />
        <AnalyticsInit />
        <DevToolsExposer />
        <PWARegister />
        {children}
      </body>
    </html>
  );
}
