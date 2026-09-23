import {
  DISCIPLINE_ALIGNMENT,
  DOMAIN_OVERLAP,
  EVALUATION_QUESTIONS,
  fitScoreToConfidence,
  KEYWORD_SEVERITY,
  KEYWORD_SEVERITY_QUESTION,
  REUSE_RECOMMENDATION,
  SENIORITY_DELTA,
  type EvaluationState,
  type JevQuestion,
  type Scorecard,
} from "./contract";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export class JevAuthError extends Error {}

interface RawAnswer {
  choice?: string;
  noul?: number;
  score?: number;
  confidence?: number;
}

function validateChoice(value: string, allowed: readonly string[], field: string): string {
  if (!allowed.includes(value)) {
    throw new Error(`Jev returned invalid choice for ${field}: ${value}`);
  }
  return value;
}

async function ask(
  state: EvaluationState,
  questions: Record<string, JevQuestion>,
  apiKey: string,
  model: string
): Promise<Record<string, RawAnswer>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, state, questions }),
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      throw new JevAuthError(`Jev auth failed: HTTP ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Jev request failed: HTTP ${res.status} ${await res.text().catch(() => "")}`);
    }
    const data = (await res.json()) as { answers?: Record<string, RawAnswer> };
    if (!data.answers) throw new Error("Jev response missing answers");
    return data.answers;
  } finally {
    clearTimeout(timer);
  }
}

export interface EvaluateOpts {
  apiKey: string;
  model: string;
}

export async function evaluateCandidate(
  state: EvaluationState,
  opts: EvaluateOpts
): Promise<Scorecard> {
  const questions: Record<string, JevQuestion> = { ...EVALUATION_QUESTIONS };
  if (state.missing_keywords.length > 0) {
    questions.keyword_severity = KEYWORD_SEVERITY_QUESTION;
  }
  const answers = await ask(state, questions, opts.apiKey, opts.model);

  const pick = <T extends string>(field: string, allowed: readonly T[]): T =>
    validateChoice(String(answers[field]?.choice ?? ""), allowed, field) as T;

  const scorecard: Scorecard = {
    discipline_alignment: pick("discipline_alignment", DISCIPLINE_ALIGNMENT),
    seniority_delta: pick("seniority_delta", SENIORITY_DELTA),
    domain_overlap: pick("domain_overlap", DOMAIN_OVERLAP),
    hard_requirement_blocker: (answers.hard_requirement_blocker?.noul ?? 0) >= 0.5,
    reuse_recommendation: pick("reuse_recommendation", REUSE_RECOMMENDATION),
    fit_confidence: fitScoreToConfidence(answers.fit_confidence?.score ?? 0),
    keyword_severity:
      state.missing_keywords.length > 0
        ? pick("keyword_severity", KEYWORD_SEVERITY)
        : "cosmetic_synonym_gap",
    confidences: {
      discipline_alignment: answers.discipline_alignment?.confidence,
      seniority_delta: answers.seniority_delta?.confidence,
      domain_overlap: answers.domain_overlap?.confidence,
      hard_requirement_blocker: answers.hard_requirement_blocker?.confidence,
      reuse_recommendation: answers.reuse_recommendation?.confidence,
      fit_confidence: answers.fit_confidence?.confidence,
      keyword_severity: answers.keyword_severity?.confidence,
    },
    source: "jev",
  };
  return scorecard;
}

/** Minimal p-limit: run tasks with at most `limit` in flight. */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    const run = queue.shift();
    if (run) run();
  };
  return async function limiter<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active++;
    try {
      return await fn();
    } finally {
      next();
    }
  };
}
