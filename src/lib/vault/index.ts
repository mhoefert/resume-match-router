import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { JdDetail, JdSummary, ResumeCandidate } from "../types";

export function resolveVaultPath(): string {
  const raw = process.env.VAULT_PATH || "./reference-vault/career-engine";
  return path.resolve(process.cwd(), raw);
}

/** Resolve a path and ensure it stays inside the vault. Throws on escape. */
export function resolveInVault(...segments: string[]): string {
  const vault = resolveVaultPath();
  const resolved = path.resolve(vault, ...segments);
  if (resolved !== vault && !resolved.startsWith(vault + path.sep)) {
    throw new VaultPathError(`Path escapes VAULT_PATH: ${resolved}`);
  }
  return resolved;
}

export class VaultPathError extends Error {}

export function vaultExists(): boolean {
  return fs.existsSync(resolveVaultPath());
}

export function parseFrontmatter(filePath: string): { data: Record<string, unknown>; content: string } {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);
  return { data: parsed.data as Record<string, unknown>, content: parsed.content };
}

export function serializeFrontmatter(data: Record<string, unknown>, content: string): string {
  return matter.stringify(content, data);
}

function unquote(v: unknown): string {
  if (v == null) return "";
  let s = String(v).trim();
  // strip repeated layers of surrounding quotes: "\"\"" -> ""
  while (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

function secondLevelDomain(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  } catch {
    return null;
  }
}

export function jdSummaryFromFile(filePath: string): JdSummary {
  const { data } = parseFrontmatter(filePath);
  const title = unquote(data.title) || path.basename(filePath, ".md");
  const source = unquote(data.source);

  let company = unquote(data.company);
  if (!company && title.includes(" | ")) company = title.split(" | ").slice(1).join(" | ").trim();
  if (!company && source) {
    const sld = secondLevelDomain(source);
    if (sld) company = sld.charAt(0).toUpperCase() + sld.slice(1);
  }
  if (!company) company = "Unknown";

  let role = unquote(data.role);
  if (!role) role = title.split(" | ")[0].trim();

  const tags = Array.isArray(data.tags) ? data.tags.map(String) : [];
  const dateClipped = data.date_clipped ? String(data.date_clipped) : "";

  return {
    id: path.basename(filePath, ".md"),
    title,
    company,
    role,
    source,
    tags,
    dateClipped,
    path: filePath,
  };
}

export function scanInbox(): JdSummary[] {
  const dir = resolveInVault("raw", "unprocessed");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => jdSummaryFromFile(path.join(dir, f)));
}

export function readJd(id: string): JdDetail | null {
  const filePath = resolveInVault("raw", "unprocessed", `${id}.md`);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
  const summary = jdSummaryFromFile(filePath);
  const { content } = parseFrontmatter(filePath);
  const body = content.trim();
  return { ...summary, body, wordCount: body.split(/\s+/).filter(Boolean).length };
}

/** Strip <style> blocks, frontmatter, and [[wikilinks]] for text sent to Jev. */
export function cleanResumeText(raw: string): string {
  let text = raw;
  if (text.trimStart().startsWith("---")) {
    try {
      text = matter(text).content;
    } catch {
      /* keep raw */
    }
  }
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
  return text.trim();
}

function manifestActiveIds(): Set<string> | null {
  const manifestPath = resolveInVault("applications", "compounding-memory.md");
  if (!fs.existsSync(manifestPath)) return null;
  const text = fs.readFileSync(manifestPath, "utf8");
  const active = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.includes("Ingested & Active")) continue;
    const m = line.match(/\[\[(.+)\]\]/);
    if (m) active.add(m[1].split("|")[0].trim());
  }
  return active;
}

export interface CorpusEntry extends ResumeCandidate {
  text: string;
}

export function loadCorpus(opts?: { includeAll?: boolean }): CorpusEntry[] {
  const appsDir = resolveInVault("applications");
  if (!fs.existsSync(appsDir)) return [];
  const active = opts?.includeAll ? null : manifestActiveIds();
  const out: CorpusEntry[] = [];
  for (const folder of fs.readdirSync(appsDir).sort()) {
    const folderPath = path.join(appsDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    for (const file of fs.readdirSync(folderPath).sort()) {
      if (!/^RESUME-.*\.md$/.test(file)) continue;
      const id = path.basename(file, ".md");
      if (active && !active.has(id)) continue;
      const filePath = path.join(folderPath, file);
      out.push({
        id,
        name: id,
        company: folder,
        folder,
        path: filePath,
        text: cleanResumeText(fs.readFileSync(filePath, "utf8")),
      });
    }
  }
  return out;
}

export function findCandidate(candidateId: string): CorpusEntry | null {
  const appsDir = resolveInVault("applications");
  if (!fs.existsSync(appsDir)) return null;
  const target = `${candidateId}.md`;
  for (const folder of fs.readdirSync(appsDir)) {
    const folderPath = path.join(appsDir, folder);
    if (!fs.statSync(folderPath).isDirectory()) continue;
    const candidate = path.join(folderPath, target);
    if (fs.existsSync(candidate)) {
      const filePath = resolveInVault("applications", folder, target);
      const raw = fs.readFileSync(filePath, "utf8");
      return {
        id: candidateId,
        name: candidateId,
        company: folder,
        folder,
        path: filePath,
        text: cleanResumeText(raw),
      };
    }
  }
  return null;
}

export function readResumeRaw(candidateId: string): { raw: string; cleaned: string; candidate: ResumeCandidate } | null {
  const appsDir = resolveInVault("applications");
  if (!fs.existsSync(appsDir)) return null;
  const target = `${candidateId}.md`;
  for (const folder of fs.readdirSync(appsDir)) {
    const filePath = resolveInVault("applications", folder, target);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const raw = fs.readFileSync(filePath, "utf8");
      return {
        raw,
        cleaned: cleanResumeText(raw),
        candidate: { id: candidateId, name: candidateId, company: folder, folder, path: filePath },
      };
    }
  }
  return null;
}
