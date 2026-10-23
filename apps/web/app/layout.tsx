import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT } from '../components/shell/theme';
import './globals.css';

export const metadata: Metadata = { title: 'Stock Assistant' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-bg text-fg min-h-dvh antialiased">{children}</body>
    </html>
  );
}
