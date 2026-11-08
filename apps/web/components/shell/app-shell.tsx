import type { ReactNode } from 'react';
import { DataFreshnessBadge } from '../data-freshness-badge';
import { DisclaimerNote } from '../disclaimer-note';
import { LogoutButton } from './logout-button';
import { NavLinks } from './nav-links';
import { ThemeToggle } from './theme-toggle';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-surface border-border sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r p-3 lg:flex">
        <nav aria-label="Điều hướng chính" className="flex-1">
          <NavLinks variant="sidebar" />
        </nav>
        <p className="text-fg-muted px-3 text-xs">Phiên bản {process.env.STOKTOK_VERSION || 'dev'}</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-surface border-border sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b px-4">
          <span className="truncate font-semibold">Stock Assistant</span>
          <div className="flex items-center gap-2">
            <div role="status">
              <DataFreshnessBadge fresh={null} />
            </div>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:p-6 lg:pb-6">
          {children}
        </main>
        <footer className="border-border border-t px-4 py-3 pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-3">
          <DisclaimerNote />
        </footer>
      </div>
      <nav
        aria-label="Điều hướng chính (điện thoại)"
        className="bg-surface border-border fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        <NavLinks variant="tabbar" />
      </nav>
    </div>
  );
}
