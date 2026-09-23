import { evaluateCandidate, JevAuthError, type EvaluateOpts } from "./client";
import { evaluateCandidateMock, mockLatency, type MockContext } from "./mock";
import type { EvaluationState, Scorecard } from "./contract";

export interface Evaluator {
  mode: "jev" | "mock";
  fallbackReason?: string;
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

  const evaluator: Evaluator = {
    get mode() {
      return fellBack ? "mock" : "jev";
    },
    get fallbackReason() {
      return fallbackReason;
    },
    async evaluate(jdId, candidateId, state, ctx) {
      if (fellBack) {
        await mockLatency();
        return evaluateCandidateMock(jdId, candidateId, state, ctx);
      }
      try {
        const result = await evaluateCandidate(state, opts);
        firstCall = false;
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
