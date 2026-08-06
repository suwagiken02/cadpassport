'use client';
import { useEffect } from 'react';
import { startAuthTracking } from '@/lib/analytics';

/**
 * 行動計測の起動（副作用のみ、UI は描画しない）。
 *
 * ログインの検知はここ 1 箇所（Supabase の onAuthStateChange）。
 * Google ログインは外部サイトへ飛んでから戻るため、authStore.signIn を通らない。
 * 方式ごとに仕込むと必ず取りこぼすので、認証の入口はここに集約する。
 */
export default function AnalyticsInit() {
  useEffect(() => { startAuthTracking(); }, []);
  return null;
}
