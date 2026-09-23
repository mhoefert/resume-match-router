import { createLimiter, getEvaluator } from "@/lib/jev";
import { diffKeywords, extractKeywords, prerankScore } from "@/lib/keywords";
import type { EvaluateResponse, MatchResult } from "@/lib/types";
import { loadCorpus, readJd, VaultPathError } from "@/lib/vault";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jdId?: string; includeAll?: boolean };
    if (!body.jdId) return Response.json({ error: "jdId is required" }, { status: 400 });

    const jd = readJd(body.jdId);
    if (!jd) return Response.json({ error: `JD not found: ${body.jdId}` }, { status: 404 });

    const corpus = loadCorpus({ includeAll: body.includeAll });
    const keywords = extractKeywords(jd.body, { title: jd.title, company: jd.company });

    const shortlistEnv = (process.env.JEV_SHORTLIST || "30").trim().toLowerCase();
    const shortlist = shortlistEnv === "all" ? corpus.length : Math.max(1, parseInt(shortlistEnv, 10) || 30);

    const scored = corpus
      .map((c) => ({ c, prerank: prerankScore(keywords, c.text) }))
      .sort((a, b) => b.prerank - a.prerank)
      .slice(0, shortlist);

    const prerankMin = scored.length ? scored[scored.length - 1].prerank : 0;
    const prerankMax = scored.length ? scored[0].prerank : 0;

    const evaluator = getEvaluator();
    const concurrency = Math.max(1, parseInt(process.env.JEV_CONCURRENCY || "16", 10) || 16);
    const limit = createLimiter(concurrency);

    const start = Date.now();
    const results: MatchResult[] = await Promise.all(
      scored.map(({ c, prerank }) =>
        limit(async () => {
          const missingKeywords = diffKeywords(keywords, c.text);
          const state = {
            job_description: { title: jd.title, company: jd.company, text: jd.body },
            candidate_resume: { name: c.name, text: c.text },
            missing_keywords: missingKeywords,
          };
          const scorecard = await evaluator.evaluate(jd.id, c.id, state, {
            prerank,
            prerankMin,
            prerankMax,
          });
          return { candidate: c, scorecard, missingKeywords, prerankScore: prerank };
        })
      )
    );
    const durationMs = Date.now() - start;

    results.sort((a, b) => b.scorecard.fit_confidence - a.scorecard.fit_confidence);

    const response: EvaluateResponse = {
      jd,
      results,
      mode: evaluator.mode,
      durationMs,
      corpusSize: corpus.length,
      evaluatedCount: results.length,
    };
    if (evaluator.fallbackReason) response.fallbackReason = evaluator.fallbackReason;
    return Response.json(response);
  } catch (err) {
    const status = err instanceof VaultPathError ? 400 : 500;
    return Response.json({ error: String(err) }, { status });
  }
}
