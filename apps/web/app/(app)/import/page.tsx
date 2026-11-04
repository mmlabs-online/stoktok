import { EmptyState } from '../../../components/empty-state';
import { requireUser } from '../../../server/auth/require-user';

export default async function Page() {
  await requireUser();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Nhập sao kê</h1>
      <EmptyState
        title="Chưa có nội dung"
        description="Màn hình này sẽ được xây dựng ở ticket sau."
      />
    </div>
  );
}
