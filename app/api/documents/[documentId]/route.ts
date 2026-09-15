import { requireAccess } from "@/lib/auth/context";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const { supabase } = await requireAccess();
  const { documentId } = await params;
  if (!z.string().uuid().safeParse(documentId).success) return new Response("Documento no encontrado", { status: 404 });
  const { data, error } = await supabase.from("inventory_attachments").select("storage_path").eq("id", documentId).maybeSingle();
  if (error) return new Response("No se puede cargar el documento", { status: 503 });
  if (!data?.storage_path) return new Response("Documento no encontrado", { status: 404 });
  const result = await supabase.storage.from("inventory-documents").createSignedUrl(data.storage_path, 60, { download: true });
  if (result.error || !result.data) return new Response("No se puede descargar el documento", { status: 503 });
  return new Response(null, { status: 302, headers: { Location: result.data.signedUrl, "Cache-Control": "private, no-store" } });
}
