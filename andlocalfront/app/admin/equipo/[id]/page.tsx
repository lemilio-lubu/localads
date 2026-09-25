import { redirect } from "next/navigation";

/* La ficha del miembro pasó a ser un modal sobre la lista, como el detalle de
   cliente o de transacción. Esta ruta se conserva para que los enlaces
   guardados sigan funcionando: abre la lista con esa ficha ya abierta. */
export default async function AdminTeamMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/equipo?miembro=${encodeURIComponent(id)}`);
}
