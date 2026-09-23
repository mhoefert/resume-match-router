import { ActionNotFound, escalate } from "@/lib/actions";
import { VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jdId } = body ?? {};
    if (!jdId) return Response.json({ error: "jdId is required" }, { status: 400 });
    return Response.json({ jd: escalate(jdId) });
  } catch (err) {
    const status =
      err instanceof ActionNotFound ? err.status : err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
