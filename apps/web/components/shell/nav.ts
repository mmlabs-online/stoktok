import { BookOpen, Eye, LayoutDashboard, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/', label: 'Tài sản', shortLabel: 'Tài sản', icon: LayoutDashboard },
  { href: '/transactions', label: 'Sổ giao dịch', shortLabel: 'Giao dịch', icon: BookOpen },
  { href: '/watchlist', label: 'Danh sách theo dõi', shortLabel: 'Theo dõi', icon: Eye },
  { href: '/settings', label: 'Cài đặt', shortLabel: 'Cài đặt', icon: Settings },
];

export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
