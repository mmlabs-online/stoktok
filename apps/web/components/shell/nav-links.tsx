'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS, isNavActive } from './nav';

export function NavLinks({ variant }: { variant: 'sidebar' | 'tabbar' }) {
  const pathname = usePathname();
  const tabbar = variant === 'tabbar';
  return (
    <ul className={tabbar ? 'flex' : 'flex flex-col gap-1'}>
      {NAV_ITEMS.map(({ href, label, shortLabel, icon: Icon }) => {
        const active = isNavActive(pathname, href);
        return (
          <li key={href} className={tabbar ? 'min-w-0 flex-1' : undefined}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={
                tabbar
                  ? `flex min-h-11 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] ${
                      active ? 'text-accent font-semibold' : 'text-fg-muted'
                    }`
                  : `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                      active
                        ? 'bg-bg text-accent border-accent border-l-2 font-semibold'
                        : 'text-fg-muted hover:bg-bg border-l-2 border-transparent'
                    }`
              }
            >
              <Icon aria-hidden className="size-5 shrink-0" />
              <span className="truncate">{tabbar ? shortLabel : label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
