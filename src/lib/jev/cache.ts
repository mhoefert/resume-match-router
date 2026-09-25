import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { EvaluationState, Scorecard } from "./contract";

/** Bump when the saved scorecard shape changes so older files are ignored. */
const CACHE_FORMAT = 2;

export function jevCacheDir(): string {
  return process.env.JEV_CACHE_DIR?.trim() || path.join(process.cwd(), ".cache", "jev");
}

/** Hash of everything that can change a Jev answer: model, questions, and the state we send. */
export function evaluationCacheKey(model: string, state: EvaluationState, questions: object): string {
  const payload = JSON.stringify({ format: CACHE_FORMAT, model, state, questions });
  return createHash("sha256").update(payload).digest("hex");
}

function cacheFile(key: string, dir: string): string {
  return path.join(dir, `${key}.json`);
}

function isScorecard(value: unknown): value is Scorecard {
  if (!value || typeof value !== "object") return false;
  const card = value as Scorecard;
  return (
    card.source === "jev" &&
    typeof card.fit_confidence === "number" &&
    !!card.dimension_scores &&
    !!card.distributions &&
    typeof card.distributions.function_fit === "object"
  );
}

export function readCachedScorecard(key: string, dir = jevCacheDir()): Scorecard | null {
  try {
    const raw = fs.readFileSync(cacheFile(key, dir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isScorecard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedScorecard(key: string, scorecard: Scorecard, dir = jevCacheDir()): void {
  if (scorecard.source !== "jev") return;
  fs.mkdirSync(dir, { recursive: true });
  const dest = cacheFile(key, dir);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(scorecard));
  fs.renameSync(tmp, dest);
}
