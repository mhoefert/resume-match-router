import {
  compositeFit,
  deriveReuse,
  DOMAIN_FIT,
  FUNCTION_FIT,
  KEYWORD_SEVERITY,
  MUST_HAVE_COVERAGE,
  SENIORITY_FIT,
  type DimensionScores,
  type EvaluationState,
  type Scorecard,
} from "./contract";
import { diffKeywords, extractKeywords } from "../keywords";

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
}

const BLOCKER_RE = /citizen|clearance|permanent resident|licen[cs]e required/i;

export interface MockContext {
  /** This candidate's deterministic pre-rank score (fraction of JD keywords present). */
  prerank?: number;
  /** Min/max prerank across the evaluated shortlist, for rank-normalisation. */
  prerankMin?: number;
  prerankMax?: number;
}

export function mockLatency(): Promise<void> {
  return new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Two neighbouring levels whose expectation equals `norm` on 0–1. */
function distributionAround(levels: readonly string[], norm: number): Record<string, number> {
  const top = levels.length - 1;
  const expected = clamp01(norm) * top;
  const lo = Math.min(top, Math.floor(expected));
  const hi = Math.min(top, lo + 1);
  const frac = expected - lo;
  const out: Record<string, number> = {};
  for (const key of levels) out[key] = 0;
  if (lo === hi) out[levels[lo]] = 1;
  else {
    out[levels[lo]] = 1 - frac;
    out[levels[hi]] = frac;
  }
  return out;
}

function winner(levels: readonly string[], distribution: Record<string, number>): string {
  return levels.reduce((best, key) => ((distribution[key] ?? 0) > (distribution[best] ?? 0) ? key : best));
}

export function evaluateCandidateMock(
  jdId: string,
  candidateId: string,
  state: EvaluationState,
  ctx?: MockContext
): Scorecard {
  const rand = seededRandom(hash(jdId + "::" + candidateId));
  const jdText = state.job_description.text;
  const resumeText = state.candidate_resume.text;
  const keywords = extractKeywords(jdText, {
    title: state.job_description.title,
    company: state.job_description.company,
  });
  const present = keywords.length - diffKeywords(keywords, resumeText).length;
  const overlap = keywords.length ? present / keywords.length : 0;

  let anchor: number;
  if (ctx?.prerank !== undefined && ctx.prerankMin !== undefined && ctx.prerankMax !== undefined) {
    const span = ctx.prerankMax - ctx.prerankMin;
    const norm = span > 0 ? (ctx.prerank - ctx.prerankMin) / span : 0.5;
    anchor = 0.2 + norm * 0.7;
  } else {
    anchor = 0.2 + overlap * 0.7;
  }

  const dimension_scores: DimensionScores = {
    function_fit: clamp01(anchor + (rand() - 0.4) * 0.2),
    seniority_fit: clamp01(anchor * 0.85 + (rand() - 0.5) * 0.25),
    domain_fit: clamp01(overlap * 0.9 + (rand() - 0.5) * 0.2),
    must_have_coverage: clamp01(overlap + (rand() - 0.45) * 0.2),
  };

  const blocker = BLOCKER_RE.test(jdText) && rand() > 0.35;
  const missing = state.missing_keywords.length;
  const fracMissing = keywords.length ? missing / keywords.length : 0;
  const effFrac = fracMissing * (0.4 + rand() * 0.8);
  const keyword_severity =
    effFrac < 0.35 ? "cosmetic_synonym_gap" : effFrac < 0.65 ? "moderate_gap" : "critical_disqualifier";

  const functionDist = distributionAround(FUNCTION_FIT, dimension_scores.function_fit);
  const seniorityDist = distributionAround(SENIORITY_FIT, dimension_scores.seniority_fit);
  const domainDist = distributionAround(DOMAIN_FIT, dimension_scores.domain_fit);
  const mustDist = distributionAround(MUST_HAVE_COVERAGE, dimension_scores.must_have_coverage);
  const conf = (floor: number) => Math.min(1, floor + rand() * 0.3);
  const blockerP = blocker ? 0.62 + rand() * 0.3 : rand() * 0.38;
  const keywordDist: Record<string, number> = {};
  for (const key of KEYWORD_SEVERITY) keywordDist[key] = key === keyword_severity ? 1 : 0;

  return {
    function_fit: winner(FUNCTION_FIT, functionDist) as Scorecard["function_fit"],
    seniority_fit: winner(SENIORITY_FIT, seniorityDist) as Scorecard["seniority_fit"],
    domain_fit: winner(DOMAIN_FIT, domainDist) as Scorecard["domain_fit"],
    must_have_coverage: winner(MUST_HAVE_COVERAGE, mustDist) as Scorecard["must_have_coverage"],
    hard_requirement_blocker: blocker,
    reuse_recommendation: deriveReuse({ ...dimension_scores, blocker }),
    fit_confidence: compositeFit(dimension_scores),
    keyword_severity,
    dimension_scores,
    distributions: {
      function_fit: functionDist,
      seniority_fit: seniorityDist,
      domain_fit: domainDist,
      must_have_coverage: mustDist,
      hard_requirement_blocker: { none: 1 - blockerP, blocker: blockerP },
      keyword_severity: keywordDist,
    },
    confidences: {
      function_fit: conf(0.6),
      seniority_fit: conf(0.55),
      domain_fit: conf(0.55),
      must_have_coverage: conf(0.6),
      hard_requirement_blocker: conf(0.6),
      keyword_severity: conf(0.6),
    },
    source: "mock",
  };
}
