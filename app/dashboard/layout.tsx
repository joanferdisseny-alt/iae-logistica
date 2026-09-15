import type { ReactNode } from "react";
import { signOut } from "@/app/auth/actions";
import { DashboardShell } from "@/app/dashboard/shell";
import { requireAccess } from "@/lib/auth/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export default async function DashboardLayout({
  children
}: {
  children: ReactNode;
}) {
  const { user, profile } = await requireAccess();

  return (
    <DashboardShell
      roleCode={profile?.app_roles?.code ?? "reader"}
      roleName={profile?.app_roles?.name ?? "Sin rol"}
      signOutAction={signOut}
      userLabel={profile?.full_name ?? user.email ?? "Usuario"}
    >
      {children}
    </DashboardShell>
  );
}
