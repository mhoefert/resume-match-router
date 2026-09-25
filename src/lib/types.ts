import type { Scorecard } from "./jev/contract";

export interface JdSummary {
  /** Filename without .md */
  id: string;
  title: string;
  company: string;
  role: string;
  source: string;
  tags: string[];
  dateClipped: string;
  path: string;
}

export interface JdDetail extends JdSummary {
  body: string;
  wordCount: number;
}

export interface ResumeCandidate {
  /** Basename without .md, e.g. RESUME-Everlab-PM */
  id: string;
  name: string;
  /** applications/<company>/ folder name */
  company: string;
  path: string;
  folder: string;
}

export interface MatchResult {
  candidate: ResumeCandidate;
  scorecard: Scorecard;
  missingKeywords: string[];
  prerankScore: number;
}

export interface EvaluateResponse {
  jd: JdSummary;
  results: MatchResult[];
  mode: "jev" | "mock";
  fallbackReason?: string;
  durationMs: number;
  corpusSize: number;
  evaluatedCount: number;
  /** Effective number of candidates sent to the evaluator. */
  shortlist: number;
  concurrency: number;
  /** How many scorecards in this run were read from the local cache. */
  cacheHits: number;
}
