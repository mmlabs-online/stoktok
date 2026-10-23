import { EmptyState } from '../../../components/empty-state';

export default function Page() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Danh sách theo dõi</h1>
      <EmptyState
        title="Chưa có nội dung"
        description="Màn hình này sẽ được xây dựng ở ticket sau."
      />
    </div>
  );
}
