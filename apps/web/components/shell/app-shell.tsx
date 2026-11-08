import type { ReactNode } from 'react';
import { DataFreshnessBadge } from '../data-freshness-badge';
import { DisclaimerNote } from '../disclaimer-note';
import { LogoutButton } from './logout-button';
import { NavLinks } from './nav-links';
import { ThemeToggle } from './theme-toggle';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="bg-sidebar text-sidebar-fg sticky top-0 hidden h-dvh w-60 shrink-0 flex-col px-3.5 pt-5 pb-3.5 lg:flex">
        <div className="mb-6 flex h-12 items-center gap-3 px-2">
          <span
            aria-hidden
            className="bg-brand-mark grid size-9 shrink-0 -rotate-3 place-items-center rounded-full text-xs font-extrabold tracking-wide text-[#28342d]"
          >
            SA
          </span>
          <span className="truncate font-extrabold">Stock Assistant</span>
        </div>
        <nav aria-label="Điều hướng chính" className="flex-1">
          <NavLinks variant="sidebar" />
        </nav>
        <p className="text-sidebar-fg/75 border-sidebar-fg/20 border-t px-3 pt-3 text-xs">
          Phiên bản {process.env.STOKTOK_VERSION || 'dev'}
        </p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-surface/95 border-border sticky top-0 z-10 flex h-14 items-center justify-between gap-2 border-b px-4 backdrop-blur lg:h-16 lg:px-7">
          <span className="truncate font-extrabold lg:invisible">Stock Assistant</span>
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
