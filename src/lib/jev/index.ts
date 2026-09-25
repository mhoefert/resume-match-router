import { evaluationCacheKey, readCachedScorecard, writeCachedScorecard } from "./cache";
import { evaluateCandidate, JevAuthError, type EvaluateOpts } from "./client";
import { evaluateCandidateMock, mockLatency, type MockContext } from "./mock";
import {
  FIT_QUESTIONS,
  KEYWORD_SEVERITY_QUESTION,
  type EvaluationState,
  type Scorecard,
} from "./contract";

export interface Evaluator {
  mode: "jev" | "mock";
  fallbackReason?: string;
  /** Scorecards reused from the local file cache during this batch. */
  cacheHits: number;
  evaluate(
    jdId: string,
    candidateId: string,
    state: EvaluationState,
    ctx?: MockContext
  ): Promise<Scorecard>;
}

/**
 * Returns a Jev-backed evaluator when TYPESAFE_API_KEY is set, otherwise mock.
 * On a 401/403 from the API on the first call, logs a warning and falls back
 * to mock for the rest of the batch (mode reported as "mock").
 */
export function getEvaluator(): Evaluator {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  const model = process.env.JEV_MODEL || "jev-latest";

  if (!apiKey) {
    return {
      mode: "mock",
      cacheHits: 0,
      evaluate: async (jdId, candidateId, state, ctx) => {
        await mockLatency();
        return evaluateCandidateMock(jdId, candidateId, state, ctx);
      },
    };
  }

  const opts: EvaluateOpts = { apiKey, model };
  let fellBack = false;
  let fallbackReason: string | undefined;
  let firstCall = true;
  let cacheHits = 0;

  const evaluator: Evaluator = {
    get mode() {
      return fellBack ? "mock" : "jev";
    },
    get fallbackReason() {
      return fallbackReason;
    },
    get cacheHits() {
      return cacheHits;
    },
    async evaluate(jdId, candidateId, state, ctx) {
      if (fellBack) {
        await mockLatency();
        return evaluateCandidateMock(jdId, candidateId, state, ctx);
      }
      const questions = {
        fit: FIT_QUESTIONS,
        keyword: state.missing_keywords.length > 0 ? KEYWORD_SEVERITY_QUESTION : null,
      };
      const key = evaluationCacheKey(model, state, questions);
      const cached = readCachedScorecard(key);
      if (cached) {
        cacheHits++;
        return cached;
      }
      try {
        const result = await evaluateCandidate(state, opts);
        firstCall = false;
        writeCachedScorecard(key, result);
        return result;
      } catch (err) {
        if (err instanceof JevAuthError && firstCall) {
          console.warn(`[jev] ${err.message} - falling back to mock evaluator for this batch`);
          fellBack = true;
          fallbackReason = err.message;
          await mockLatency();
          return evaluateCandidateMock(jdId, candidateId, state, ctx);
        }
        throw err;
      }
    },
  };
  return evaluator;
}

export { createLimiter } from "./client";
