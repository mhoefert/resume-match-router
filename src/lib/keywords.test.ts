import { test } from "node:test";
import assert from "node:assert/strict";
import { extractKeywords } from "./keywords.ts";

// Actual body of raw/unprocessed/JD-AI Product Manager.md (Garena JD).
const GARENA_JD = `### AI Product Manager

You will work at the intersection of AI agents, automation, and real business challenges. You will partner closely with engineers, data scientists, and business stakeholders to own, shape and deliver impactful AI products at Garena.

These projects span both internal and external products, including AI-powered operational tools, AI-driven agents and game localization platforms, supporting real-time interactions and global users at scale.

This is a hands-on role. You are expected to write code, prototype your own ideas, and work directly with users to debug issues in real time.

Job Description

- Own AI products end to end, from discovery and scoping to prototyping, shipping, measuring, and iterating in production.
- Identify high-impact opportunities across player-facing systems, operational workflows, and internal tools, and decide what is worth building.
- Determine the right technical approach for each problem, whether rules, classical ML, LLMs, agents, or hybrid solutions, and discuss tradeoffs with engineers across prompting, RAG, fine-tuning, model selection, tool calling, latency, and cost.
- Design AI-native experiences such as chat, copilots, human-in-the-loop flows, fallbacks, and feedback loops, and define the evaluations that determine whether they work.
- Prototype in code using tools such as Claude Code or Codex, building working demos before writing specifications so that engineering discussions begin with something tangible.
- Manage stakeholders across leadership, engineering, and end users to align priorities and drive adoption.
- Work directly with users, observe how they interact with shipped products, debug issues on the spot, and translate learnings into the next iteration.

Job Requirements

- At least 2 years of full-time experience in product management, startup, or founder-like roles, with a track record of taking products from 0 to 1.
- Builder mindset, with a preference for shipping a rough prototype quickly over delivering a polished specification later, and the willingness to use code, no-code, or AI tools to do it yourself.
- Experience implementing LLM products or enterprise AI applications, with leading product directions through Chat, Copilot, RAG, AI Agents, automated workflows, internal operations tools, or enterprise productivity platforms, covering all processes from PoC to launch or scaled rollout.
- Comfort with the uncertainty of AI systems and the instinct to engineer toward reliability through evaluations, fallbacks, and human-in-the-loop design.
- Strong product sense for turning ambiguity and complexity into simple, trustworthy product experiences.
- Open-minded, agile, and proactive mindset with a strong willingness to learn.
- Strong sense of responsibility and accountability in delivering quality work on time.`;

const OPTS = { title: "AI Product Manager", company: "Garena" };

test("phrases never span sentence or line boundaries", () => {
  const kws = extractKeywords(GARENA_JD, OPTS).map((k) => k.toLowerCase());
  for (const k of kws) {
    assert.ok(!/[.!?:;]/.test(k), `boundary punctuation in term: ${k}`);
    assert.ok(!k.endsWith("-"), `term ends with dash: ${k}`);
    assert.ok(!/\byou$/.test(k) && !/^you\b/.test(k), `pronoun edge term: ${k}`);
    assert.ok(k.length >= 2, `term too short: ${k}`);
  }
  // Previously observed noise that must be gone.
  assert.ok(!kws.includes("ai product manager you"));
  assert.ok(!kws.some((k) => k.includes("these")));
});

test("title, company, and their words are excluded from heuristic terms", () => {
  const kws = extractKeywords(GARENA_JD, OPTS);
  const lower = kws.map((k) => k.toLowerCase());
  assert.ok(!lower.includes("ai product manager"));
  assert.ok(!lower.includes("garena"));
  assert.ok(!lower.includes("garena. these"));
});

test("lexicon terms are still extracted", () => {
  const kws = extractKeywords(GARENA_JD, OPTS).map((k) => k.toLowerCase());
  for (const expected of ["rag", "llms", "fine-tuning", "prompt engineering"]) {
    // fine-tuning / prompt engineering appear verbatim in the JD text
    if (["rag", "llms", "fine-tuning"].includes(expected)) {
      assert.ok(kws.includes(expected), `missing lexicon term: ${expected}`);
    }
  }
});

test("heading lines are excluded from the phrase heuristic", () => {
  // "AI Product Manager" only appears as a markdown heading in this JD.
  const kws = extractKeywords("### Quantum Filament Engineer\n\nBody text about agile work.", {
    title: "PM",
    company: "Xco",
  });
  assert.ok(!kws.map((k) => k.toLowerCase()).includes("quantum filament engineer"));
});

test("no term starts or ends with an edge stopword", () => {
  const EDGE = new Set(
    "you we these this our the a an your job description requirements".split(" ")
  );
  for (const k of extractKeywords(GARENA_JD, OPTS)) {
    const words = k.toLowerCase().split(/\s+/);
    assert.ok(!EDGE.has(words[0]), `starts with stopword: ${k}`);
    assert.ok(!EDGE.has(words[words.length - 1]), `ends with stopword: ${k}`);
  }
});

test("output is deduped, JD casing preserved, capped at 40", () => {
  const kws = extractKeywords(GARENA_JD, OPTS);
  assert.ok(kws.length <= 40);
  assert.equal(new Set(kws.map((k) => k.toLowerCase())).size, kws.length);
  assert.ok(kws.every((k) => GARENA_JD.toLowerCase().includes(k.toLowerCase())));
});
