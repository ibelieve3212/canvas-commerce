"use client";

import * as React from "react";
import type { AuthUser } from "@/server/auth/session";

const UserContext = React.createContext<AuthUser | null>(null);

export function UserContextProvider({
  initialUser,
  children,
}: {
  initialUser: AuthUser;
  children: React.ReactNode;
}) {
  return (
    <UserContext.Provider value={initialUser}>{children}</UserContext.Provider>
  );
}

export function useCurrentUser(): AuthUser | null {
  return React.use(UserContext);
}
