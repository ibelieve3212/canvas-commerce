import { getCurrentUser } from "@/server/auth/session";
import { SettingsClient } from "@/features/settings/settings-client";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const isAdmin = user?.role === "ADMIN";

  return <SettingsClient isAdmin={isAdmin} />;
}
