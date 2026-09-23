import { readJd, VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const jd = readJd(id);
    if (!jd) return Response.json({ error: `JD not found: ${id}` }, { status: 404 });
    return Response.json({ jd });
  } catch (err) {
    const status = err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err) }, { status });
  }
}
