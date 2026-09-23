/**
 * Role-agnostic Jev evaluation contract.
 * Jev (TypeSafe System One, POST https://api.typesafe.ai/v1/systemone) answers typed
 * questions about a `state`; it never generates prose. Question types:
 *  - choice: { type, instructions, criteria: Record<key, description> } -> { choice, probability: Record<key, number>, confidence }
 *  - score:  { type, instructions, criteria: string[] (2-10 ordered levels) } -> { score (fractional index), probabilities, confidence }
 *  - noul:   { type, instructions, yes?, no? } -> { noul: number (probability of yes, 0-1) }
 */

export const DISCIPLINE_ALIGNMENT = ["exact_match", "adjacent_transferable", "unrelated_mismatch"] as const;
export const SENIORITY_DELTA = ["junior_to_jd", "at_level", "stretch_senior", "overqualified"] as const;
export const DOMAIN_OVERLAP = ["direct_industry", "adjacent_regulated", "generalist_only", "distant_sector"] as const;
export const REUSE_RECOMMENDATION = ["reuse_as_is", "light_keyword_pass", "escalate_full_compile", "reject_unfit"] as const;
export const KEYWORD_SEVERITY = ["cosmetic_synonym_gap", "moderate_gap", "critical_disqualifier"] as const;

export type DisciplineAlignment = (typeof DISCIPLINE_ALIGNMENT)[number];
export type SeniorityDelta = (typeof SENIORITY_DELTA)[number];
export type DomainOverlap = (typeof DOMAIN_OVERLAP)[number];
export type ReuseRecommendation = (typeof REUSE_RECOMMENDATION)[number];
export type KeywordSeverity = (typeof KEYWORD_SEVERITY)[number];

export interface Scorecard {
  discipline_alignment: DisciplineAlignment;
  seniority_delta: SeniorityDelta;
  domain_overlap: DomainOverlap;
  hard_requirement_blocker: boolean;
  reuse_recommendation: ReuseRecommendation;
  /** 1-100 calibrated match probability. */
  fit_confidence: number;
  keyword_severity: KeywordSeverity;
  /** Raw confidences per question, 0-1, for the UI tooltip. */
  confidences: Partial<Record<keyof Omit<Scorecard, "confidences" | "source">, number>>;
  source: "jev" | "mock";
}

/** Ten ordered levels for fit_confidence; score index s in [0,9] maps to 1-100 via fitScoreToConfidence. */
export const FIT_LEVELS: readonly string[] = [
  "Different profession entirely; almost nothing on the resume addresses the JD's core responsibilities.",
  "Same broad field but the resume's function, seniority, and domain all miss; would be screened out on first read.",
  "One of function, seniority, or domain matches; the other two are clearly off.",
  "Function matches; seniority or domain is a significant gap; several must-have requirements are absent.",
  "Function and seniority match; domain is distant; roughly half of the must-have requirements are evidenced.",
  "Function, seniority, and an adjacent domain match; most must-haves evidenced, wording differs from the JD.",
  "Strong match on function, seniority, and domain; a few JD-specific tools or terms are missing.",
  "Near-complete match; only cosmetic wording gaps; a recruiter would shortlist this resume as-is.",
  "Resume reads as if written for this JD; every must-have is evidenced with concrete outcomes.",
  "Resume exceeds every stated requirement with directly relevant, quantified evidence; ideal candidate on paper.",
];

export function fitScoreToConfidence(score: number, levels = FIT_LEVELS.length): number {
  const clamped = Math.min(Math.max(score, 0), levels - 1);
  return Math.round(1 + (clamped / (levels - 1)) * 99);
}

export interface JevQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
export interface JevQuestionScore {
  type: "score";
  instructions: string;
  criteria: string[];
}
export interface JevQuestionNoul {
  type: "noul";
  instructions: string;
  yes?: string;
  no?: string;
}
export type JevQuestion = JevQuestionChoice | JevQuestionScore | JevQuestionNoul;

export const EVALUATION_QUESTIONS: Record<string, JevQuestion> = {
  discipline_alignment: {
    type: "choice",
    instructions:
      "Compare the candidate resume's core function (the craft they practise day to day) with the function the job description is hiring for. Judge by responsibilities and deliverables, not job titles.",
    criteria: {
      exact_match: "Same craft and same kind of deliverables; the candidate already does this job under a possibly different title.",
      adjacent_transferable: "Neighbouring craft with substantial overlap in skills and stakeholders; a credible transfer with some ramp-up.",
      unrelated_mismatch: "Different profession; the resume's core work does not map onto the JD's responsibilities.",
    },
  },
  seniority_delta: {
    type: "choice",
    instructions:
      "Compare the candidate's demonstrated level (scope, ownership, years, team and budget influence) with the level the job description asks for.",
    criteria: {
      junior_to_jd: "Candidate is at least one level below what the JD requires in scope or years.",
      at_level: "Candidate's demonstrated scope and experience match the level the JD requires.",
      stretch_senior: "JD is one level above the candidate; a reasonable stretch that a hiring manager might accept.",
      overqualified: "Candidate is clearly above the role; the JD would be a step down in scope or seniority.",
    },
  },
  domain_overlap: {
    type: "choice",
    instructions:
      "Compare the industries, sectors, and regulatory contexts evidenced on the resume with the industry and sector of the hiring company as described in the job description.",
    criteria: {
      direct_industry: "Resume shows experience in the same industry or product category as the hiring company.",
      adjacent_regulated: "Resume shows experience in an adjacent industry that shares regulatory or operating constraints with the hiring company.",
      generalist_only: "Resume shows transferable generalist experience with no specific industry overlap.",
      distant_sector: "Resume's industries are far from the hiring company's sector with little transferable context.",
    },
  },
  hard_requirement_blocker: {
    type: "noul",
    instructions:
      "Does the job description state a mandatory, non-negotiable requirement (citizenship or permanent residency, security clearance, professional licence or certification, specific degree, or a legal work-authorisation constraint) that the resume does not evidence? Ignore soft preferences and 'nice to have' items.",
    yes: "A mandatory legal, clearance, licence, or eligibility requirement in the JD is absent from the resume.",
    no: "No such mandatory requirement exists, or every mandatory requirement is evidenced on the resume.",
  },
  reuse_recommendation: {
    type: "choice",
    instructions:
      "Decide the least-effort action that would make this resume a competitive application for this job description.",
    criteria: {
      reuse_as_is: "Submit this resume unchanged; it already targets this function, level, and domain.",
      light_keyword_pass: "The chassis is right; swap in the JD's exact terminology in a few existing sentences.",
      escalate_full_compile: "The role is worth pursuing but no existing resume fits; a ground-up rewrite is needed.",
      reject_unfit: "The candidate should not apply for this role with any version of this resume.",
    },
  },
  fit_confidence: {
    type: "score",
    instructions:
      "How likely is this resume, submitted as-is, to pass a recruiter's screen for this job description? Pick the level whose description best matches the evidence.",
    criteria: [...FIT_LEVELS],
  },
};

export const KEYWORD_SEVERITY_QUESTION: JevQuestion = {
  type: "choice",
  instructions:
    "The state lists terms that appear in the job description but not in the candidate resume. Judge how damaging their absence is to this application.",
  criteria: {
    cosmetic_synonym_gap: "The resume already evidences the same skills under different wording; a synonym swap fixes it.",
    moderate_gap: "Some missing terms represent real but learnable skills or tools; the application is weaker but viable.",
    critical_disqualifier: "At least one missing term is a mandatory skill, tool, or qualification whose absence would fail the screen.",
  },
};

/** Shape of the `state` object sent to Jev for one candidate. Keep keys stable; they are referenced in instructions. */
export interface EvaluationState {
  job_description: { title: string; company: string; text: string };
  candidate_resume: { name: string; text: string };
  missing_keywords: string[];
}
