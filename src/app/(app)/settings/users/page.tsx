import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/auth/rbac";
import { requirePageRepo } from "@/lib/data/page";
import { formatDate } from "@/lib/utils/dates";
import { RoleSelect } from "./role-select";

export const metadata: Metadata = { title: "Users" };

export default async function UsersSettingsPage() {
  const { ctx, repo } = await requirePageRepo("settings.users.manage");
  const members = await repo.team.listMembers();

  return (
    <>
      <PageHeader title="Users" description="Team members with access to this organization and their roles." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            New sign-ups have no access until an administrator grants a role. Roles are enforced in the app and by
            database policies. The last administrator cannot be demoted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Since</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.userId}>
                  <TableCell className="font-medium">{m.fullName || "-"}</TableCell>
                  <TableCell>{m.email || "-"}</TableCell>
                  <TableCell>
                    {m.userId === ctx.user.id ? (
                      <Badge variant="default">{ROLE_LABELS[m.role]} (you)</Badge>
                    ) : (
                      <RoleSelect userId={m.userId} role={m.role} />
                    )}
                  </TableCell>
                  <TableCell>{m.isActive ? "Active" : "Deactivated"}</TableCell>
                  <TableCell>{formatDate(m.since)}</TableCell>
                </TableRow>
              ))}
              {members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No members yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
