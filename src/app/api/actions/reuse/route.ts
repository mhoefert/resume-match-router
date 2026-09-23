import { ActionConflict, ActionNotFound, reuseAsIs } from "@/lib/actions";
import { VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jdId, candidateId, company, role, overwrite } = body ?? {};
    if (!jdId || !candidateId || !company || !role) {
      return Response.json({ error: "jdId, candidateId, company and role are required" }, { status: 400 });
    }
    const result = await reuseAsIs({ jdId, candidateId, company, role, overwrite });
    return Response.json(result);
  } catch (err) {
    const status =
      err instanceof ActionConflict || err instanceof ActionNotFound
        ? err.status
        : err instanceof VaultPathError
          ? 400
          : 500;
    return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status });
  }
}
