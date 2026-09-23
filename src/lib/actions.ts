import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  findCandidate,
  parseFrontmatter,
  resolveInVault,
  serializeFrontmatter,
  jdSummaryFromFile,
  type VaultPathError,
} from "./vault";

const execFileAsync = promisify(execFile);

export class ActionConflict extends Error {
  status = 409;
}
export class ActionNotFound extends Error {
  status = 404;
}

const ILLEGAL_FILENAME = /[/\\:*?"<>|]/g;

function sanitise(s: string): string {
  return s.replace(ILLEGAL_FILENAME, "").trim();
}

export function targetResumePath(company: string, role: string): { dir: string; base: string; mdPath: string } {
  const c = sanitise(company) || "Unknown";
  const r = sanitise(role) || "PM";
  const base = `RESUME-${c}-[${r}]`;
  const dir = resolveInVault("applications", c);
  return { dir, base, mdPath: path.join(dir, `${base}.md`) };
}

async function exportDocx(mdPath: string): Promise<{ docxPath: string; docxOk: boolean; exportLog: string }> {
  const docxPath = mdPath.replace(/\.md$/, ".docx");
  const exporter = resolveInVault("tools", "export_docx.py");
  const python = process.env.PYTHON_BIN || "python3";
  try {
    const { stdout, stderr } = await execFileAsync(python, [exporter, mdPath, docxPath], {
      timeout: 60_000,
    });
    const ok = fs.existsSync(docxPath);
    return { docxPath, docxOk: ok, exportLog: [stdout, stderr].filter(Boolean).join("\n").trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      docxPath,
      docxOk: false,
      exportLog: [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim(),
    };
  }
}

function moveJdToProcessed(jdId: string, updates: Record<string, unknown>): string {
  const src = resolveInVault("raw", "unprocessed", `${jdId}.md`);
  const dest = resolveInVault("raw", "processed", `${jdId}.md`);
  if (!fs.existsSync(src)) throw new ActionNotFound(`JD not found: ${jdId}`);
  const { data, content } = parseFrontmatter(src);
  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const newTags = tags.map((t) => (t === "jd-unprocessed" ? "jd-match" : t));
  if (!newTags.includes("jd-match")) newTags.push("jd-match");
  const merged = { ...data, ...updates, tags: newTags };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, serializeFrontmatter(merged, content));
  fs.unlinkSync(src);
  return dest;
}

export interface ActionResult {
  resumePath: string;
  docxPath: string;
  docxOk: boolean;
  exportLog: string;
  jdPath: string;
}

export async function reuseAsIs(args: {
  jdId: string;
  candidateId: string;
  company: string;
  role: string;
  overwrite?: boolean;
}): Promise<ActionResult> {
  const donor = findCandidate(args.candidateId);
  if (!donor) throw new ActionNotFound(`Candidate not found: ${args.candidateId}`);

  const { dir, base, mdPath } = targetResumePath(args.company, args.role);
  if (path.resolve(donor.path) === path.resolve(mdPath)) {
    throw new ActionConflict("Target equals donor path; refusing to overwrite the donor.");
  }
  if (fs.existsSync(mdPath) && !args.overwrite) {
    throw new ActionConflict(`Target resume already exists: ${mdPath}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(donor.path, mdPath);

  const docx = await exportDocx(mdPath);

  const jdPath = moveJdToProcessed(args.jdId, {
    status: "matched-reuse",
    matched_resume: `[[${base}]]`,
    matched_donor: `[[${donor.id}]]`,
    matched_date: new Date().toISOString().slice(0, 10),
  });

  return { resumePath: mdPath, jdPath, ...docx };
}

export async function keywordPass(args: {
  jdId: string;
  candidateId: string;
  company: string;
  role: string;
  content: string;
  overwrite?: boolean;
}): Promise<ActionResult> {
  const donor = findCandidate(args.candidateId);
  if (!donor) throw new ActionNotFound(`Candidate not found: ${args.candidateId}`);

  const { dir, base, mdPath } = targetResumePath(args.company, args.role);
  if (path.resolve(donor.path) === path.resolve(mdPath)) {
    throw new ActionConflict("Target equals donor path; refusing to overwrite the donor.");
  }
  if (fs.existsSync(mdPath) && !args.overwrite) {
    throw new ActionConflict(`Target resume already exists: ${mdPath}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(mdPath, args.content);

  const docx = await exportDocx(mdPath);

  const jdPath = moveJdToProcessed(args.jdId, {
    status: "compiled",
    compiled_resume: `[[${base}]]`,
    matched_donor: `[[${donor.id}]]`,
    matched_date: new Date().toISOString().slice(0, 10),
  });

  return { resumePath: mdPath, jdPath, ...docx };
}

export function escalate(jdId: string) {
  const filePath = resolveInVault("raw", "unprocessed", `${jdId}.md`);
  if (!fs.existsSync(filePath)) throw new ActionNotFound(`JD not found: ${jdId}`);
  const { data, content } = parseFrontmatter(filePath);
  const merged = {
    ...data,
    tags: ["jd-unprocessed"],
    status: "escalate-full-compile",
    escalated_date: new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(filePath, serializeFrontmatter(merged, content));
  return jdSummaryFromFile(filePath);
}

export type { VaultPathError };
