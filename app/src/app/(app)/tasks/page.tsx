import { PageHeader } from "@/components/shell/page-header";
import { TasksBrowser } from "@/features/tasks/tasks-browser";

export default function TasksPage() {
  return (
    <>
      <PageHeader title="任务中心" description="查看所有生成批次及状态" />
      <TasksBrowser />
    </>
  );
}
