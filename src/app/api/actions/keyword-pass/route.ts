import { ActionConflict, ActionNotFound, keywordPass } from "@/lib/actions";
import { readResumeRaw, VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

// Returns the donor's raw markdown for the keyword-pass modal.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id query param is required" }, { status: 400 });
  try {
    const result = readResumeRaw(id);
    if (!result) return Response.json({ error: `Resume not found: ${id}` }, { status: 404 });
    return Response.json({ raw: result.raw, candidate: result.candidate });
  } catch (err) {
    const status = err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err) }, { status });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { jdId, candidateId, company, role, content, overwrite } = body ?? {};
    if (!jdId || !candidateId || !company || !role || typeof content !== "string") {
      return Response.json(
        { error: "jdId, candidateId, company, role and content are required" },
        { status: 400 }
      );
    }
    const result = await keywordPass({ jdId, candidateId, company, role, content, overwrite });
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
