import { readResumeRaw, VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id query param is required" }, { status: 400 });
  try {
    const result = readResumeRaw(id);
    if (!result) return Response.json({ error: `Resume not found: ${id}` }, { status: 404 });
    return Response.json(result);
  } catch (err) {
    const status = err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err) }, { status });
  }
}
