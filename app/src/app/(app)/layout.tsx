import { redirect } from "next/navigation";
import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/server/auth/session";
import { UserContextProvider } from "./user-context";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=" + encodeURIComponent("/apps"));

  return (
    <ToastProvider>
      <UserContextProvider initialUser={user}>
        <AppShell>{children}</AppShell>
      </UserContextProvider>
    </ToastProvider>
  );
}
