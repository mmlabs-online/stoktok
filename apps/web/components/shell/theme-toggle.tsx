'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { getServerSnapshot, getSnapshot, setTheme, subscribe } from './theme';
import type { ThemeMode } from './theme';

const NEXT: Record<ThemeMode, ThemeMode> = { system: 'light', light: 'dark', dark: 'system' };
const LABEL: Record<ThemeMode, string> = { system: 'Hệ thống', light: 'Sáng', dark: 'Tối' };
const ICON = { system: Monitor, light: Sun, dark: Moon };

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const Icon = ICON[mode];
  return (
    <button
      type="button"
      onClick={() => setTheme(NEXT[mode])}
      aria-label={`Giao diện: ${LABEL[mode]}`}
      title={`Giao diện: ${LABEL[mode]}`}
      className="text-fg-muted hover:bg-bg inline-flex size-11 items-center justify-center rounded-lg"
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}
