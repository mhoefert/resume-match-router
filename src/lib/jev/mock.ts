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

export function mockLatency(): Promise<void> {
  return new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
}

export function evaluateCandidateMock(
  jdId: string,
  candidateId: string,
  state: EvaluationState
): Scorecard {
  const rand = seededRandom(hash(jdId + "::" + candidateId));
  const jdText = state.job_description.text;
  const resumeText = state.candidate_resume.text;
  const keywords = extractKeywords(jdText);
  const present = keywords.length - diffKeywords(keywords, resumeText).length;
  const overlap = keywords.length ? present / keywords.length : 0;

  const base = 0.35 + overlap * 0.6;
  const jitter = (rand() - 0.5) * 0.1;
  const fit = Math.min(0.99, Math.max(0.02, base + jitter));
  const fit_confidence = Math.round(fit * 100);

  const blocker = BLOCKER_RE.test(jdText) && rand() > 0.5;

  const missing = state.missing_keywords.length;
  const keyword_severity =
    missing <= 2 ? "cosmetic_synonym_gap" : missing <= 6 ? "moderate_gap" : "critical_disqualifier";

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
