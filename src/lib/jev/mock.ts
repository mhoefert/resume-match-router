import type { EvaluationState, Scorecard } from "./contract";
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

  // Rank-normalised fit: top of the shortlist lands near 92, bottom near 25,
  // with +/-6 seeded jitter. Falls back to raw overlap when no range is given.
  let base: number;
  if (ctx?.prerank !== undefined && ctx.prerankMin !== undefined && ctx.prerankMax !== undefined) {
    const span = ctx.prerankMax - ctx.prerankMin;
    const norm = span > 0 ? (ctx.prerank - ctx.prerankMin) / span : 0.5;
    base = 25 + norm * 67;
  } else {
    base = 25 + overlap * 67;
  }
  const jitter = (rand() - 0.5) * 12;
  const fit = Math.min(0.99, Math.max(0.02, (base + jitter) / 100));
  const fit_confidence = Math.round(fit * 100);

  const blocker = BLOCKER_RE.test(jdText) && rand() > 0.35;

  const missing = state.missing_keywords.length;
  const fracMissing = keywords.length ? missing / keywords.length : 0;
  const effFrac = fracMissing * (0.4 + rand() * 0.8);
  const keyword_severity =
    effFrac < 0.35 ? "cosmetic_synonym_gap" : effFrac < 0.65 ? "moderate_gap" : "critical_disqualifier";

  const discipline_alignment =
    overlap > 0.55 ? "exact_match" : overlap > 0.25 ? "adjacent_transferable" : "unrelated_mismatch";
  const seniority_delta =
    fit > 0.75
      ? "at_level"
      : rand() < 0.5
        ? "stretch_senior"
        : rand() < 0.5
          ? "junior_to_jd"
          : "overqualified";
  const domain_overlap =
    overlap > 0.6
      ? "direct_industry"
      : overlap > 0.4
        ? "adjacent_regulated"
        : overlap > 0.2
          ? "generalist_only"
          : "distant_sector";
  const reuse_recommendation = blocker
    ? "reject_unfit"
    : fit > 0.8
      ? "reuse_as_is"
      : fit > 0.6
        ? "light_keyword_pass"
        : fit > 0.45
          ? "escalate_full_compile"
          : "reject_unfit";

  const conf = (floor: number) => Math.min(1, floor + rand() * 0.3);

  return {
    discipline_alignment,
    seniority_delta,
    domain_overlap,
    hard_requirement_blocker: blocker,
    reuse_recommendation,
    fit_confidence,
    keyword_severity,
    confidences: {
      discipline_alignment: conf(0.6),
      seniority_delta: conf(0.55),
      domain_overlap: conf(0.55),
      hard_requirement_blocker: conf(0.6),
      reuse_recommendation: conf(0.6),
      fit_confidence: conf(0.65),
      keyword_severity: conf(0.6),
    },
    source: "mock",
  };
}
