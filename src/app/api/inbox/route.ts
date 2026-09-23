import { scanInbox, VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ jds: scanInbox() });
  } catch (err) {
    const status = err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err) }, { status });
  }
}
