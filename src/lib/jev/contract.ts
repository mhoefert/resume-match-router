/**
 * Role-agnostic Jev evaluation contract.
 * Jev (TypeSafe System One, POST https://api.typesafe.ai/v1/systemone) answers typed
 * questions about a `state`; it never generates prose. Question types:
 *  - choice: { type, instructions, criteria: Record<key, description> } -> { choice, probability, confidence }
 *  - score:  { type, instructions, criteria: ordered levels } -> { score (fractional index), probabilities, confidence }
 *  - noul:   { type, instructions, yes?, no? } -> { noul: number (probability of yes, 0-1) }
 *
 * Fit is four single-dimension Scores. The /100 is a weighted sum of those scores in code.
 * Questions in one request share one state, so the keyword list is a second request.
 */

export const FUNCTION_FIT = ["unrelated", "partial", "adjacent", "match"] as const;
export const SENIORITY_FIT = ["far", "stretch", "near", "aligned"] as const;
export const DOMAIN_FIT = ["distant", "generalist", "analogous", "direct"] as const;
export const MUST_HAVE_COVERAGE = ["few", "some", "most", "complete"] as const;
export const REUSE_RECOMMENDATION = ["reuse_as_is", "light_keyword_pass", "escalate_full_compile", "reject_unfit"] as const;
export const KEYWORD_SEVERITY = ["cosmetic_synonym_gap", "moderate_gap", "critical_disqualifier"] as const;

export type FunctionFit = (typeof FUNCTION_FIT)[number];
export type SeniorityFit = (typeof SENIORITY_FIT)[number];
export type DomainFit = (typeof DOMAIN_FIT)[number];
export type MustHaveCoverage = (typeof MUST_HAVE_COVERAGE)[number];
export type ReuseRecommendation = (typeof REUSE_RECOMMENDATION)[number];
export type KeywordSeverity = (typeof KEYWORD_SEVERITY)[number];

export interface DimensionScores {
  /** Expected score on 0–1. Level index divided by (level count - 1). */
  function_fit: number;
  seniority_fit: number;
  domain_fit: number;
  must_have_coverage: number;
}

export interface Scorecard {
  function_fit: FunctionFit;
  seniority_fit: SeniorityFit;
  domain_fit: DomainFit;
  must_have_coverage: MustHaveCoverage;
  hard_requirement_blocker: boolean;
  /** Derived from the dimension scores and the blocker. Not a Jev answer. */
  reuse_recommendation: ReuseRecommendation;
  /** 0–100 weighted composite of the four dimension scores. */
  fit_confidence: number;
  keyword_severity: KeywordSeverity;
  dimension_scores: DimensionScores;
  /** Raw confidences per Jev question, 0–1. */
  confidences: Partial<
    Record<
      | "function_fit"
      | "seniority_fit"
      | "domain_fit"
      | "must_have_coverage"
      | "hard_requirement_blocker"
      | "keyword_severity",
      number
    >
  >;
  /** Probability mass Jev assigned to each allowed answer, 0–1. */
  distributions: {
    function_fit: Record<string, number>;
    seniority_fit: Record<string, number>;
    domain_fit: Record<string, number>;
    must_have_coverage: Record<string, number>;
    hard_requirement_blocker: Record<string, number>;
    keyword_severity: Record<string, number>;
  };
  source: "jev" | "mock";
}

export const SCORE_WEIGHTS = {
  function_fit: 0.35,
  seniority_fit: 0.25,
  domain_fit: 0.15,
  must_have_coverage: 0.25,
} as const;

/** Map a fractional level index onto 0–1. */
export function normalizeScore(score: number, levelCount: number): number {
  const top = Math.max(1, levelCount - 1);
  if (!Number.isFinite(score)) return 0;
  return Math.min(1, Math.max(0, score / top));
}

/** Weighted sum of four 0–1 dimension scores, rounded to 0–100. */
export function compositeFit(dimensions: DimensionScores): number {
  const raw =
    SCORE_WEIGHTS.function_fit * dimensions.function_fit +
    SCORE_WEIGHTS.seniority_fit * dimensions.seniority_fit +
    SCORE_WEIGHTS.domain_fit * dimensions.domain_fit +
    SCORE_WEIGHTS.must_have_coverage * dimensions.must_have_coverage;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100);
}

/**
 * Least-effort route from the dimension scores.
 * A blocker rejects. Otherwise function and must-have coverage decide;
 * seniority only gates "submit unchanged."
 */
export function deriveReuse(input: DimensionScores & { blocker: boolean }): ReuseRecommendation {
  if (input.blocker) return "reject_unfit";
  if (input.function_fit >= 2 / 3 && input.seniority_fit >= 0.6 && input.must_have_coverage >= 2 / 3) {
    return "reuse_as_is";
  }
  if (input.function_fit >= 0.5 && input.must_have_coverage >= 0.4) return "light_keyword_pass";
  if (input.function_fit >= 1 / 3) return "escalate_full_compile";
  return "reject_unfit";
}

type Level = { situation: string; not_for: string };

export interface JevQuestionChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}
export interface JevQuestionScore {
  type: "score";
  instructions: string;
  criteria: Level[];
}
export interface JevQuestionNoul {
  type: "noul";
  instructions: string;
  yes?: string;
  no?: string;
}
export type JevQuestion = JevQuestionChoice | JevQuestionScore | JevQuestionNoul;

const COMPARE =
  "Compare `candidate_resume.text` with `job_description.text`. Use `job_description.title` only as a label for the role, not as proof of the work.";

export const FIT_QUESTIONS: Record<string, JevQuestion> = {
  function_fit: {
    type: "score",
    instructions: `${COMPARE} How close is the resume's primary day-to-day craft to the craft this job is hiring for? Judge by responsibilities and deliverables. Ignore seniority, industry, and job titles.`,
    criteria: [
      {
        situation:
          "The resume's day-to-day work produces different deliverables from the ones this job is hiring for.",
        not_for: "Some tasks overlap with the job.",
      },
      {
        situation:
          "Some tasks overlap, but the core deliverable of the job is not what the resume spends most of its time on.",
        not_for: "The main craft is the same as the job, or a close neighbour of it.",
      },
      {
        situation:
          "The resume's main craft is a neighbour of the job: shared stakeholders and a large share of the same tasks, with a visible ramp on the rest.",
        not_for: "The primary craft and core deliverables already match the job.",
      },
      {
        situation:
          "The resume's primary craft and core deliverables match the job's day-to-day work. The title may differ, and some tools may differ.",
        not_for: "Only a neighbouring craft overlaps.",
      },
    ],
  },
  seniority_fit: {
    type: "score",
    instructions: `${COMPARE} How close is the resume's demonstrated scope (ownership, years, team or budget influence) to the level this job asks for? Ignore craft and industry.`,
    criteria: [
      {
        situation:
          "Demonstrated scope is clearly off the job: more than one level under it, or a large step down from it.",
        not_for: "Scope is about one band away from the job.",
      },
      {
        situation:
          "Demonstrated scope is about one band off the job, close enough that a hiring manager might still consider it.",
        not_for: "Scope is in the same band as the job.",
      },
      {
        situation:
          "Demonstrated scope is in the same band as the job, with a small gap in years, team size, or ownership.",
        not_for: "Scope matches the level the job asks for.",
      },
      {
        situation: "Demonstrated scope matches the level the job asks for.",
        not_for: "Scope is a band above or below the job.",
      },
    ],
  },
  domain_fit: {
    type: "score",
    instructions: `${COMPARE} How close is the product and customer context on the resume to the hiring company's context in the job description? A different industry label can still be a direct match when the product and customers are the same kind.`,
    criteria: [
      {
        situation: "The resume's industries share little operating context with the hiring company's sector.",
        not_for: "The resume shows transferable generalist work.",
      },
      {
        situation:
          "The resume shows transferable generalist work and no specific overlap with this company's product or customers.",
        not_for: "A neighbouring product or customer context is evidenced.",
      },
      {
        situation:
          "The resume shows a neighbouring product or customer context that shares constraints with this company, even if the vertical name differs.",
        not_for: "The product and customers are the same kind as this company.",
      },
      {
        situation:
          "The resume shows the same kind of product and customers as this company, even if the industry label is worded differently.",
        not_for: "Only a neighbouring context overlaps.",
      },
    ],
  },
  must_have_coverage: {
    type: "score",
    instructions: `${COMPARE} Of the requirements the job states as required, how many are evidenced by concrete work on the resume? Wording may differ. Ignore nice-to-have items.`,
    criteria: [
      {
        situation: "Most requirements the job states as required are not evidenced on the resume.",
        not_for: "About half of the stated requirements are evidenced.",
      },
      {
        situation: "About half of the stated requirements are evidenced with concrete work.",
        not_for: "Most stated requirements are evidenced.",
      },
      {
        situation:
          "Most stated requirements are evidenced. A few tools or terms are missing or worded differently.",
        not_for: "Every stated requirement is evidenced.",
      },
      {
        situation:
          "Every requirement the job states as required is evidenced with concrete work on the resume. Wording may differ from the job description.",
        not_for: "A stated requirement is still missing.",
      },
    ],
  },
  hard_requirement_blocker: {
    type: "noul",
    instructions:
      "Does `job_description.text` state a mandatory, non-negotiable requirement (citizenship or permanent residency, security clearance, professional licence or certification, specific degree, or a legal work-authorisation constraint) that `candidate_resume.text` does not evidence? Ignore soft preferences and nice-to-have items.",
    yes: "A mandatory legal, clearance, licence, or eligibility requirement in the job description is absent from the resume.",
    no: "No such mandatory requirement exists, or every mandatory requirement is evidenced on the resume.",
  },
};

export const KEYWORD_SEVERITY_QUESTION: JevQuestion = {
  type: "choice",
  instructions:
    "`missing_keywords` lists terms that appear in `job_description.text` but not in `candidate_resume.text`. Judge how damaging their absence is to this application.",
  criteria: {
    cosmetic_synonym_gap: "The resume already evidences the same skills under different wording; a synonym swap fixes it.",
    moderate_gap: "Some missing terms represent real but learnable skills or tools; the application is weaker but viable.",
    critical_disqualifier: "At least one missing term is a mandatory skill, tool, or qualification whose absence would fail the screen.",
  },
};

/** Shape of the state assembled for one candidate. The fit request omits `missing_keywords`. */
export interface EvaluationState {
  job_description: { title: string; company: string; text: string };
  candidate_resume: { name: string; text: string };
  missing_keywords: string[];
}

export interface FitState {
  job_description: EvaluationState["job_description"];
  candidate_resume: EvaluationState["candidate_resume"];
}

export function fitStateOf(state: EvaluationState): FitState {
  return {
    job_description: state.job_description,
    candidate_resume: state.candidate_resume,
  };
}
