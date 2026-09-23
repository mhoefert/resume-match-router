/**
 * Hybrid keyword pipeline: curated cross-discipline lexicon + proper-noun
 * heuristics, used to pre-rank the resume corpus and to compute the
 * missing-keywords list shown to the user and sent to Jev.
 */

const LEXICON: string[] = [
  // Engineering / data / AI
  "SQL", "Python", "TypeScript", "JavaScript", "React", "Next.js", "Node.js",
  "LangGraph", "LangChain", "RAG", "LLM", "LLMs", "fine-tuning", "prompt engineering",
  "machine learning", "deep learning", "NLP", "computer vision", "embeddings",
  "vector database", "transformers", "PyTorch", "TensorFlow", "scikit-learn",
  "MLOps", "AI agents", "agentic", "copilot", "chatbot", "evaluations", "evals",
  "human-in-the-loop", "model selection", "tool calling", "Claude Code", "Codex",
  "OpenAI", "Anthropic", "GPT-4", "reinforcement learning", "A/B testing",
  "experimentation", "feature flags", "observability", "Datadog", "Grafana",
  // Product / PM craft
  "roadmap", "OKRs", "KPIs", "stakeholder management", "product management",
  "product strategy", "product sense", "discovery", "prioritization",
  "user research", "user interviews", "usability testing", "design systems",
  "wireframes", "prototyping", "PRD", "go-to-market", "GTM", "pricing",
  "monetization", "growth", "retention", "activation", "funnel", "churn",
  "product-market fit", "0 to 1", "B2B", "B2C", "SaaS", "enterprise",
  "agile", "scrum", "kanban", "sprint", "Jira", "Confluence", "Figma", "Notion",
  "Linear", "Asana", "Amplitude", "Mixpanel", "Segment", "Heap",
  // Data stack / BI
  "Tableau", "Looker", "dbt", "Snowflake", "BigQuery", "Redshift", "Databricks",
  "Spark", "Kafka", "Airflow", "ETL", "data pipeline", "data warehouse",
  "analytics", "dashboards", "Excel", "Power BI",
  // Infra / cloud / devops
  "Kubernetes", "Docker", "AWS", "GCP", "Azure", "Terraform", "CI/CD",
  "microservices", "REST", "GraphQL", "gRPC", "serverless", "Linux", "Git",
  // Business tools / CRM / marketing
  "Salesforce", "HubSpot", "Marketo", "SEO", "SEM", "Google Analytics",
  "content marketing", "email marketing", "CRM", "Zendesk", "Intercom",
  // Fintech / regulated domains
  "fintech", "lending", "payments", "KYC", "AML", "compliance", "risk management",
  "fraud", "underwriting", "banking", "insurance", "insurtech", "regtech",
  "HIPAA", "SOC 2", "GDPR", "PCI DSS", "ISO 27001", "security clearance",
  // Ops / general
  "operations", "automation", "workflow", "vendor management", "budgeting",
  "forecasting", "P&L", "unit economics", "cross-functional", "mentorship",
  "hiring", "localization", "marketplace", "e-commerce", "gaming",
];

const STOPWORDS = new Set(
  `the and for with you your our their this that will are have has been not but who what when where how why all any each more most other some such only own same than too very can just about into over after should would could may might must shall job description requirements role work team company join us he she they it his her its i we these those
   January February March April May June July August September October November December
   Monday Tuesday Wednesday Thursday Friday Saturday Sunday
   Singapore Sydney Melbourne Australia London Vancouver Toronto Canada Hong Kong India Japan
   AI PM CEO CTO COO VP HR IT JD FAQ EOE`.toLowerCase().split(/\s+/)
);

/** Words that invalidate a capitalised-phrase candidate when on either edge. */
const EDGE_WORDS = new Set(
  `you we these this our the a an your job description requirements he she they it his her their its i those that and or of in on at to from by with as is are was were be been
   design manage own build identify determine prototype work use create lead drive develop support ensure`.split(
    /\s+/
  )
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWord(haystack: string, needle: string): boolean {
  const base = needle.toLowerCase();
  const variants = [base, base + "s", base.endsWith("s") ? base.slice(0, -1) : base + "es"];
  const lower = haystack.toLowerCase();
  return variants.some((v) => new RegExp(`\\b${escapeRe(v)}\\b`).test(lower));
}

export interface ExtractOptions {
  /** JD title — excluded (with each of its words) from heuristic terms. */
  title?: string;
  /** Hiring company — excluded (with each of its words) from heuristic terms. */
  company?: string;
}

export function extractKeywords(jdText: string, opts?: ExtractOptions): string[] {
  const counts = new Map<string, { count: number; first: number }>();
  const displayMap = new Map<string, string>();
  const lower = jdText.toLowerCase();

  const record = (key: string, display: string, pos: number) => {
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.first = Math.min(existing.first, pos);
    } else {
      counts.set(key, { count: 1, first: pos });
      displayMap.set(key, display);
    }
  };

  // (a) lexicon — matched over the full JD text
  for (const term of LEXICON) {
    const re = new RegExp(`\\b${escapeRe(term.toLowerCase())}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower))) record(term.toLowerCase(), term, m.index);
  }

  // (b) heuristics: ALL-CAPS acronyms (2-6) and capitalised multi-word proper nouns.
  // Heading lines are excluded and the text is split into sentence/line segments
  // first so phrases never span punctuation or line boundaries.
  const titleCompany = new Set<string>();
  for (const src of [opts?.title, opts?.company]) {
    if (!src) continue;
    const s = src.toLowerCase().trim();
    if (s) {
      titleCompany.add(s);
      s.split(/\s+/).forEach((w) => titleCompany.add(w));
    }
  }

  const noHeadings = jdText
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");

  const acronymRe = /\b[A-Z][A-Z0-9&-]{1,5}\b/g;
  let m: RegExpExecArray | null;
  while ((m = acronymRe.exec(noHeadings))) {
    const w = m[0];
    if (
      !STOPWORDS.has(w.toLowerCase()) &&
      !titleCompany.has(w.toLowerCase()) &&
      !/^\d+$/.test(w) &&
      !w.endsWith("-")
    ) {
      record(w.toLowerCase(), w, m.index);
    }
  }

  const properRe = /\b([A-Z][A-Za-z0-9.+#&-]*(?:\s+[A-Z][A-Za-z0-9.+#&-]*){1,3})\b/g;
  for (const seg of noHeadings.split(/[.!?:;\r\n|•]/)) {
    properRe.lastIndex = 0;
    while ((m = properRe.exec(seg))) {
      const phrase = m[1].trim();
      const words = phrase.split(/\s+/);
      if (
        phrase.length < 3 ||
        phrase.length > 40 ||
        phrase.endsWith("-") ||
        /[.!?:;]/.test(phrase) ||
        EDGE_WORDS.has(words[0].toLowerCase()) ||
        EDGE_WORDS.has(words[words.length - 1].toLowerCase()) ||
        STOPWORDS.has(words[0].toLowerCase()) ||
        STOPWORDS.has(words[words.length - 1].toLowerCase()) ||
        titleCompany.has(phrase.toLowerCase()) ||
        words.every((w) => STOPWORDS.has(w.toLowerCase()))
      ) {
        continue;
      }
      record(phrase.toLowerCase(), phrase, m.index);
    }
  }

  const items = [...counts.entries()].map(([key, v]) => ({
    key,
    display: displayMap.get(key) ?? key,
    count: v.count,
    first: v.first,
  }));
  items.sort((a, b) => b.count - a.count || a.first - b.first);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    out.push(it.display);
    if (out.length >= 40) break;
  }
  return out;
}

export function diffKeywords(keywords: string[], resumeText: string): string[] {
  return keywords.filter((k) => !hasWord(resumeText, k));
}

export function prerankScore(keywords: string[], resumeText: string): number {
  if (keywords.length === 0) return 0;
  const present = keywords.filter((k) => hasWord(resumeText, k)).length;
  return present / keywords.length;
}
