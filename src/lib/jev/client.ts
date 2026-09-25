import {
  compositeFit,
  deriveReuse,
  DOMAIN_FIT,
  FIT_QUESTIONS,
  fitStateOf,
  FUNCTION_FIT,
  KEYWORD_SEVERITY,
  KEYWORD_SEVERITY_QUESTION,
  MUST_HAVE_COVERAGE,
  normalizeScore,
  SENIORITY_FIT,
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
  probability?: Record<string, number>;
  probabilities?: Record<string, number> | number[];
}

function asProbabilityMap(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Per-answer probabilities for a choice question. Falls back to a spike on the picked answer. */
function choiceDistribution(
  answer: RawAnswer | undefined,
  allowed: readonly string[],
  selected: string
): Record<string, number> {
  const raw = asProbabilityMap(answer?.probability) ?? asProbabilityMap(answer?.probabilities);
  if (raw) {
    const out: Record<string, number> = {};
    for (const key of allowed) out[key] = Math.max(0, raw[key] ?? 0);
    const sum = Object.values(out).reduce((total, value) => total + value, 0);
    if (sum > 0) {
      if (sum > 1.05) {
        for (const key of allowed) out[key] = out[key] / sum;
      }
      return out;
    }
  }
  const out: Record<string, number> = {};
  for (const key of allowed) out[key] = key === selected ? 1 : 0;
  return out;
}

function validateChoice(value: string, allowed: readonly string[], field: string): string {
  if (!allowed.includes(value)) {
    throw new Error(`Jev returned invalid choice for ${field}: ${value}`);
  }
  return value;
}

/** Probability mass over ordered score levels. Keys are our level names, not "0"/"1". */
function scoreDistribution(answer: RawAnswer | undefined, levels: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const listed = answer?.probabilities;
  if (Array.isArray(listed)) {
    levels.forEach((key, index) => {
      const raw = listed[index];
      out[key] = typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
    });
  } else {
    const raw = asProbabilityMap(listed);
    levels.forEach((key, index) => {
      const value = raw?.[key] ?? raw?.[String(index)] ?? 0;
      out[key] = Math.max(0, value);
    });
  }
  const sum = Object.values(out).reduce((total, value) => total + value, 0);
  if (sum > 0) {
    if (sum > 1.05) {
      for (const key of levels) out[key] = out[key] / sum;
    }
    return out;
  }
  const idx = Math.round(Math.min(levels.length - 1, Math.max(0, answer?.score ?? 0)));
  for (const key of levels) out[key] = 0;
  out[levels[idx]] = 1;
  return out;
}

function argmax(distribution: Record<string, number>, levels: readonly string[]): string {
  let best = levels[0];
  let probability = -1;
  for (const key of levels) {
    const value = distribution[key] ?? 0;
    if (value > probability) {
      probability = value;
      best = key;
    }
  }
  return best;
}

function dimensionScore(answer: RawAnswer | undefined, distribution: Record<string, number>, levels: readonly string[]): number {
  if (typeof answer?.score === "number" && Number.isFinite(answer.score)) {
    return normalizeScore(answer.score, levels.length);
  }
  const expected = levels.reduce((sum, key, index) => sum + index * (distribution[key] ?? 0), 0);
  return normalizeScore(expected, levels.length);
}

async function ask(
  state: object,
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
  const keywordQuestions = { keyword_severity: KEYWORD_SEVERITY_QUESTION };
  const [answers, keywordAnswers] = await Promise.all([
    ask(fitStateOf(state), FIT_QUESTIONS, opts.apiKey, opts.model),
    state.missing_keywords.length > 0
      ? ask(state, keywordQuestions, opts.apiKey, opts.model)
      : Promise.resolve(null),
  ]);

  const functionDist = scoreDistribution(answers.function_fit, FUNCTION_FIT);
  const seniorityDist = scoreDistribution(answers.seniority_fit, SENIORITY_FIT);
  const domainDist = scoreDistribution(answers.domain_fit, DOMAIN_FIT);
  const mustDist = scoreDistribution(answers.must_have_coverage, MUST_HAVE_COVERAGE);
  const dimension_scores = {
    function_fit: dimensionScore(answers.function_fit, functionDist, FUNCTION_FIT),
    seniority_fit: dimensionScore(answers.seniority_fit, seniorityDist, SENIORITY_FIT),
    domain_fit: dimensionScore(answers.domain_fit, domainDist, DOMAIN_FIT),
    must_have_coverage: dimensionScore(answers.must_have_coverage, mustDist, MUST_HAVE_COVERAGE),
  };
  const blockerYes = Math.min(1, Math.max(0, answers.hard_requirement_blocker?.noul ?? 0));
  const blocker = blockerYes >= 0.5;
  const keyword = keywordAnswers
    ? (validateChoice(String(keywordAnswers.keyword_severity?.choice ?? ""), KEYWORD_SEVERITY, "keyword_severity") as Scorecard["keyword_severity"])
    : "cosmetic_synonym_gap";

  const scorecard: Scorecard = {
    function_fit: argmax(functionDist, FUNCTION_FIT) as Scorecard["function_fit"],
    seniority_fit: argmax(seniorityDist, SENIORITY_FIT) as Scorecard["seniority_fit"],
    domain_fit: argmax(domainDist, DOMAIN_FIT) as Scorecard["domain_fit"],
    must_have_coverage: argmax(mustDist, MUST_HAVE_COVERAGE) as Scorecard["must_have_coverage"],
    hard_requirement_blocker: blocker,
    reuse_recommendation: deriveReuse({ ...dimension_scores, blocker }),
    fit_confidence: compositeFit(dimension_scores),
    keyword_severity: keyword,
    dimension_scores,
    distributions: {
      function_fit: functionDist,
      seniority_fit: seniorityDist,
      domain_fit: domainDist,
      must_have_coverage: mustDist,
      hard_requirement_blocker: { none: 1 - blockerYes, blocker: blockerYes },
      keyword_severity: keywordAnswers
        ? choiceDistribution(keywordAnswers.keyword_severity, KEYWORD_SEVERITY, keyword)
        : { cosmetic_synonym_gap: 1, moderate_gap: 0, critical_disqualifier: 0 },
    },
    confidences: {
      function_fit: answers.function_fit?.confidence,
      seniority_fit: answers.seniority_fit?.confidence,
      domain_fit: answers.domain_fit?.confidence,
      must_have_coverage: answers.must_have_coverage?.confidence,
      hard_requirement_blocker: answers.hard_requirement_blocker?.confidence,
      keyword_severity: keywordAnswers?.keyword_severity?.confidence,
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
