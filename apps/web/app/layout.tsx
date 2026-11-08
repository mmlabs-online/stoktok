import type { Metadata } from 'next';
import { Nunito } from 'next/font/google';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '../components/shell/theme';
import './globals.css';

// Self-hosted at build time by next/font: no request to Google at runtime.
const nunito = Nunito({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '600', '700', '800'],
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
