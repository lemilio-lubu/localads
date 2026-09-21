import AdminShell from "../../admin-shell";
import TeamMemberDetailView from "./team-member-detail";

export default async function AdminTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell><TeamMemberDetailView id={id} /></AdminShell>;
}
