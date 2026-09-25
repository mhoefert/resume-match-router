import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluationCacheKey, readCachedScorecard, writeCachedScorecard } from "./jev/cache.ts";
import type { Scorecard } from "./jev/contract.ts";

const questions = { discipline_alignment: { type: "choice", instructions: "Compare craft." } };

const state = {
  job_description: { title: "PM", company: "Acme", text: "Ship a billing product." },
  candidate_resume: { name: "Ada", text: "Shipped billing." },
  missing_keywords: ["SQL"],
};

function card(): Scorecard {
  return {
    function_fit: "match",
    seniority_fit: "aligned",
    domain_fit: "direct",
    must_have_coverage: "most",
    hard_requirement_blocker: false,
    reuse_recommendation: "reuse_as_is",
    fit_confidence: 80,
    keyword_severity: "moderate_gap",
    dimension_scores: {
      function_fit: 0.9,
      seniority_fit: 0.8,
      domain_fit: 0.7,
      must_have_coverage: 0.75,
    },
    confidences: {},
    distributions: {
      function_fit: { match: 1 },
      seniority_fit: { aligned: 1 },
      domain_fit: { direct: 1 },
      must_have_coverage: { most: 1 },
      hard_requirement_blocker: { none: 1, blocker: 0 },
      keyword_severity: { moderate_gap: 1 },
    },
    source: "jev",
  };
}

test("cache key changes when the resume or model changes", () => {
  const base = evaluationCacheKey("jev-latest", state, questions);
  const otherResume = evaluationCacheKey(
    "jev-latest",
    {
      ...state,
      candidate_resume: { ...state.candidate_resume, text: "Different resume." },
    },
    questions
  );
  const otherModel = evaluationCacheKey("jev-other", state, questions);
  assert.notEqual(base, otherResume);
  assert.notEqual(base, otherModel);
  assert.equal(base, evaluationCacheKey("jev-latest", state, questions));
});

test("round trip writes and reads a jev scorecard", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cache-"));
  const key = evaluationCacheKey("jev-latest", state, questions);
  assert.equal(readCachedScorecard(key, dir), null);
  writeCachedScorecard(key, card(), dir);
  const loaded = readCachedScorecard(key, dir);
  assert.equal(loaded?.fit_confidence, 80);
  assert.equal(loaded?.source, "jev");
});

test("an old discipline scorecard is ignored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cache-"));
  const key = evaluationCacheKey("jev-latest", state, questions);
  const dest = path.join(dir, `${key}.json`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dest,
    JSON.stringify({
      discipline_alignment: "exact_match",
      fit_confidence: 40,
      distributions: { discipline_alignment: { exact_match: 1 } },
      source: "jev",
    })
  );
  assert.equal(readCachedScorecard(key, dir), null);
});

test("mock scorecards are not stored", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-cache-"));
  const key = evaluationCacheKey("jev-latest", state, questions);
  writeCachedScorecard(key, { ...card(), source: "mock" }, dir);
  assert.equal(fs.readdirSync(dir).length, 0);
});
