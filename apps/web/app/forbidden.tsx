import { LogoutButton } from '../components/shell/logout-button';

export default function Forbidden() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
      <h1 className="text-xl font-semibold">Không có quyền truy cập</h1>
      <p>Tài khoản này không được phép dùng stoktok.</p>
      <LogoutButton />
    </main>
  );
}
