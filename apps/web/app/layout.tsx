import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '../components/shell/theme';
import './globals.css';

// Nunito is committed in app/fonts (SIL OFL 1.1), so builds need no network.
const nunito = localFont({
  src: [
    { path: './fonts/Nunito-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Nunito-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Nunito-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/Nunito-800.woff2', weight: '800', style: 'normal' },
  ],
  variable: '--font-nunito',
  display: 'swap',
});

export const metadata: Metadata = { title: 'Stock Assistant' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" className={nunito.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-bg text-fg min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
