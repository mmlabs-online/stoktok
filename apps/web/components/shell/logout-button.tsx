import { signOutAction } from '../../app/login/actions';

export function LogoutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="border-border rounded border px-3 py-1 text-sm">
        Đăng xuất
      </button>
    </form>
  );
}
