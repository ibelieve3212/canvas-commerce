import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?redirect=/admin/users");
  }
  if (user.role !== "ADMIN") {
    redirect("/apps");
  }
  return <>{children}</>;
}
