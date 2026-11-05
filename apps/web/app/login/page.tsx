import { redirect } from 'next/navigation';
import { authenticate } from '../../server/auth/require-user';
import { safeNext } from '../../server/auth/login-path';
import { signInAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  if ((await authenticate()).kind === 'ok') redirect(safeNext(next));

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-semibold">Đăng nhập</h1>
      <form action={signInAction} className="space-y-3">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label className="block space-y-1">
          <span>Email</span>
          <input
            type="email"
            name="email"
            required
            maxLength={320}
            autoComplete="username"
            className="border-border bg-surface w-full rounded border px-3 py-2"
          />
        </label>
        <label className="block space-y-1">
          <span>Mật khẩu</span>
          <input
            type="password"
            name="password"
            required
            maxLength={256}
            autoComplete="current-password"
            className="border-border bg-surface w-full rounded border px-3 py-2"
          />
        </label>
        {error === '1' ? (
          <p role="alert" className="text-sm">
            Đăng nhập không thành công. Kiểm tra email và mật khẩu.
          </p>
        ) : null}
        <button type="submit" className="border-border rounded border px-4 py-2 font-medium">
          Đăng nhập
        </button>
      </form>
    </main>
  );
}
