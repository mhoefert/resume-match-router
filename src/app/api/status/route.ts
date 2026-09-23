import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { loadCorpus, resolveInVault, resolveVaultPath, vaultExists } from "@/lib/vault";

export const dynamic = "force-dynamic";

function pythonExporterAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const exporter = resolveInVault("tools", "export_docx.py");
      if (!existsSync(exporter)) return resolve(false);
      execFile(process.env.PYTHON_BIN || "python3", ["-c", "import docx"], { timeout: 10_000 }, (err) =>
        resolve(!err)
      );
    } catch {
      resolve(false);
    }
  });
}

export async function GET() {
  const vaultPath = resolveVaultPath();
  const exists = vaultExists();
  let corpusSize = 0;
  if (exists) {
    try {
      corpusSize = loadCorpus().length;
    } catch {
      corpusSize = 0;
    }
  }
  return Response.json({
    vaultPath,
    vaultExists: exists,
    mode: process.env.TYPESAFE_API_KEY?.trim() ? "jev" : "mock",
    corpusSize,
    shortlist: process.env.JEV_SHORTLIST || "30",
    pythonExporterAvailable: exists ? await pythonExporterAvailable() : false,
  });
}
