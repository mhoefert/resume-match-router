"use client";

import { useCallback, useEffect, useState } from "react";

/* ---------- shared types (mirror of src/lib/types.ts, client-safe) ---------- */

interface JdSummary {
  id: string;
  title: string;
  company: string;
  role: string;
  source: string;
  tags: string[];
  dateClipped: string;
  path: string;
}
interface JdDetail extends JdSummary {
  body: string;
  wordCount: number;
}
interface Scorecard {
  discipline_alignment: string;
  seniority_delta: string;
  domain_overlap: string;
  hard_requirement_blocker: boolean;
  reuse_recommendation: string;
  fit_confidence: number;
  keyword_severity: string;
  source: string;
}
interface MatchResult {
  candidate: { id: string; name: string; company: string; folder: string };
  scorecard: Scorecard;
  missingKeywords: string[];
  prerankScore: number;
}
interface EvaluateResponse {
  jd: JdSummary;
  results: MatchResult[];
  mode: "jev" | "mock";
  fallbackReason?: string;
  durationMs: number;
  corpusSize: number;
  evaluatedCount: number;
}
interface StatusResponse {
  vaultPath: string;
  vaultExists: boolean;
  mode: string;
  corpusSize: number;
  shortlist: string;
  pythonExporterAvailable: boolean;
}

type Toast = { id: number; kind: "success" | "error"; text: string };

const FAV_COLOURS: Record<string, string> = {
  exact_match: "bg-emerald-100 text-emerald-800 border-emerald-200",
  at_level: "bg-emerald-100 text-emerald-800 border-emerald-200",
  direct_industry: "bg-emerald-100 text-emerald-800 border-emerald-200",
  reuse_as_is: "bg-emerald-100 text-emerald-800 border-emerald-200",
  adjacent_transferable: "bg-amber-100 text-amber-800 border-amber-200",
  stretch_senior: "bg-amber-100 text-amber-800 border-amber-200",
  adjacent_regulated: "bg-amber-100 text-amber-800 border-amber-200",
  light_keyword_pass: "bg-amber-100 text-amber-800 border-amber-200",
  moderate_gap: "bg-amber-100 text-amber-800 border-amber-200",
  unrelated_mismatch: "bg-rose-100 text-rose-800 border-rose-200",
  junior_to_jd: "bg-rose-100 text-rose-800 border-rose-200",
  distant_sector: "bg-rose-100 text-rose-800 border-rose-200",
  reject_unfit: "bg-rose-100 text-rose-800 border-rose-200",
  critical_disqualifier: "bg-rose-100 text-rose-800 border-rose-200",
};

function badge(label: string, extra = "") {
  return (
    <span
      key={label}
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
        FAV_COLOURS[label] ?? "bg-slate-100 text-slate-700 border-slate-200"
      } ${extra}`}
    >
      {label.replaceAll("_", " ")}
    </span>
  );
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export default function Home() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [inbox, setInbox] = useState<JdSummary[]>([]);
  const [inboxLoaded, setInboxLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [jd, setJd] = useState<JdDetail | null>(null);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [evalResp, setEvalResp] = useState<EvaluateResponse | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [showBody, setShowBody] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [kpModal, setKpModal] = useState<{
    candidateId: string;
    missingKeywords: string[];
    severity: string;
    raw: string;
    company: string;
    role: string;
  } | null>(null);
  const [includeAll, setIncludeAll] = useState(false);

  const toast = useCallback((kind: Toast["kind"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<StatusResponse>("/api/status"));
    } catch (e) {
      toast("error", `Status failed: ${String(e)}`);
    }
  }, [toast]);

  const scanInbox = useCallback(async () => {
    try {
      const data = await api<{ jds: JdSummary[] }>("/api/inbox");
      setInbox(data.jds);
      setInboxLoaded(true);
    } catch (e) {
      toast("error", `Inbox scan failed: ${String(e)}`);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await api<StatusResponse>("/api/status");
        if (!cancelled) setStatus(s);
      } catch (e) {
        if (!cancelled) toast("error", `Status failed: ${String(e)}`);
      }
      try {
        const data = await api<{ jds: JdSummary[] }>("/api/inbox");
        if (!cancelled) {
          setInbox(data.jds);
          setInboxLoaded(true);
        }
      } catch (e) {
        if (!cancelled) toast("error", `Inbox scan failed: ${String(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runEvaluate = useCallback(
    async (jdId: string, all: boolean) => {
      setEvaluating(true);
      setEvalResp(null);
      try {
        const resp = await api<EvaluateResponse>("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jdId, includeAll: all }),
        });
        setEvalResp(resp);
      } catch (e) {
        toast("error", `Evaluate failed: ${String(e)}`);
      } finally {
        setEvaluating(false);
      }
    },
    [toast]
  );

  const selectJd = async (id: string) => {
    setSelectedId(id);
    setEvalResp(null);
    setShowBody(false);
    try {
      const { jd } = await api<{ jd: JdDetail }>(`/api/jd/${encodeURIComponent(id)}`);
      setJd(jd);
      setCompany(jd.company);
      setRole(jd.role);
      runEvaluate(jd.id, includeAll);
    } catch (e) {
      toast("error", String(e));
    }
  };

  const evaluate = async () => {
    if (!jd) return;
    runEvaluate(jd.id, includeAll);
  };

  const afterAction = async (jdMoved: boolean) => {
    if (jdMoved) {
      await scanInbox();
      await refreshStatus();
      setSelectedId(null);
      setJd(null);
      setEvalResp(null);
    } else {
      await scanInbox();
    }
  };

  const doReuse = async (candidateId: string, overwrite = false) => {
    if (!jd) return;
    if (!overwrite && !window.confirm(`Reuse ${candidateId} as-is for ${company} - ${role}?`)) return;
    try {
      const res = await api<{ resumePath: string; docxOk: boolean; exportLog: string }>(
        "/api/actions/reuse",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jdId: jd.id, candidateId, company, role, overwrite }),
        }
      );
      toast(
        res.docxOk ? "success" : "error",
        `Saved ${res.resumePath}${res.docxOk ? " + docx" : " (docx failed: " + res.exportLog + ")"}`
      );
      await afterAction(true);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && window.confirm(`${err.message}\nOverwrite?`)) {
        return doReuse(candidateId, true);
      }
      toast("error", String(err.message));
    }
  };

  const openKeywordPass = async (r: MatchResult) => {
    try {
      const data = await api<{ raw: string }>(`/api/resume?id=${encodeURIComponent(r.candidate.id)}`);
      setKpModal({
        candidateId: r.candidate.id,
        missingKeywords: r.missingKeywords,
        severity: r.scorecard.keyword_severity,
        raw: data.raw,
        company,
        role,
      });
    } catch (e) {
      toast("error", String(e));
    }
  };

  const doKeywordPass = async (overwrite = false) => {
    if (!kpModal || !jd) return;
    try {
      const res = await api<{ resumePath: string; docxOk: boolean; exportLog: string }>(
        "/api/actions/keyword-pass",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jdId: jd.id,
            candidateId: kpModal.candidateId,
            company: kpModal.company,
            role: kpModal.role,
            content: kpModal.raw,
            overwrite,
          }),
        }
      );
      toast(
        res.docxOk ? "success" : "error",
        `Saved ${res.resumePath}${res.docxOk ? " + docx" : " (docx failed: " + res.exportLog + ")"}`
      );
      setKpModal(null);
      await afterAction(true);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && window.confirm(`${err.message}\nOverwrite?`)) {
        return doKeywordPass(true);
      }
      toast("error", String(err.message));
    }
  };

  const doEscalate = async () => {
    if (!jd) return;
    try {
      await api("/api/actions/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdId: jd.id }),
      });
      toast("success", `Escalated ${jd.id} for full compile`);
      await afterAction(false);
      setJd((prev) => (prev ? { ...prev, tags: ["jd-unprocessed"] } : prev));
    } catch (e) {
      toast("error", String(e));
    }
  };

  const statusPill = !status
    ? { text: "Loading...", cls: "bg-slate-100 text-slate-600", title: "Loading status" }
    : !status.vaultExists
      ? { text: "Vault missing", cls: "bg-rose-100 text-rose-800", title: "VAULT_PATH does not exist" }
      : status.mode === "jev"
        ? { text: "Jev live", cls: "bg-emerald-100 text-emerald-800", title: "Jev live: jev-latest" }
        : evalResp?.fallbackReason
          ? {
              text: "Mock mode",
              cls: "bg-amber-100 text-amber-800",
              title: `fell back to mock: ${evalResp.fallbackReason}`,
            }
          : { text: "Mock mode", cls: "bg-amber-100 text-amber-800", title: "TYPESAFE_API_KEY not set" };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white px-4 py-3 shadow-sm flex items-center gap-4 flex-wrap">
        <h1 className="text-lg font-semibold">Resume Match Router</h1>
        <span
          title={statusPill.title}
          className={`rounded px-2 py-0.5 text-xs font-medium ${statusPill.cls}`}
        >
          {statusPill.text}
        </span>
        {status && (
          <span className="text-xs text-slate-500">
            {status.vaultPath} · corpus {status.corpusSize} · shortlist {status.shortlist}
            {status.pythonExporterAvailable ? " · docx exporter ok" : " · docx exporter missing"}
          </span>
        )}
        <button
          onClick={scanInbox}
          className="ml-auto rounded bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-sm font-medium"
        >
          Scan Inbox
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside className="w-72 shrink-0 border-r border-slate-200 bg-white overflow-y-auto p-2">
          {!inboxLoaded || inbox.length === 0 ? (
            <p className="text-sm text-slate-500 p-3">
              {inboxLoaded ? "Inbox empty - click Scan Inbox" : "Loading inbox..."}
            </p>
          ) : (
            inbox.map((j) => (
              <button
                key={j.id}
                onClick={() => selectJd(j.id)}
                className={`w-full text-left rounded p-2 mb-1 border ${
                  selectedId === j.id
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-transparent hover:bg-slate-100"
                }`}
              >
                <div className="text-sm font-medium truncate">{j.title}</div>
                <div className="text-xs text-slate-500">
                  {j.company} · {j.dateClipped}
                </div>
                <div className="mt-1 flex gap-1 flex-wrap">
                  {j.tags.map((t) => badge(t))}
                </div>
              </button>
            ))
          )}
        </aside>

        {/* Main */}
        <main className="flex-1 overflow-y-auto p-4">
          {!jd ? (
            <p className="text-slate-500 text-sm">Select a JD from the inbox.</p>
          ) : (
            <>
              {/* JD card */}
              <section className="rounded-lg border border-slate-200 bg-white p-4 mb-4 shadow-sm">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-xl font-semibold">{jd.title}</h2>
                    <div className="text-sm text-slate-500 mt-1">
                      {jd.company} · {jd.role} · {jd.dateClipped} · {jd.wordCount} words
                      {jd.source && (
                        <>
                          {" · "}
                          <a
                            href={jd.source}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:underline"
                          >
                            source
                          </a>
                        </>
                      )}
                    </div>
                    <div className="mt-2 flex gap-1 flex-wrap">{jd.tags.map((t) => badge(t))}</div>
                  </div>
                  <button
                    onClick={doEscalate}
                    className="rounded bg-white hover:bg-amber-50 border border-amber-300 text-amber-700 px-3 py-1.5 text-sm font-medium"
                  >
                    Escalate
                  </button>
                </div>

                <div className="mt-3 flex gap-3 items-end flex-wrap">
                  <label className="text-xs text-slate-500">
                    Company override
                    <input
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      className="block mt-0.5 rounded bg-white border border-slate-300 px-2 py-1 text-sm text-slate-900 w-56"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    Role override
                    <input
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                      className="block mt-0.5 rounded bg-white border border-slate-300 px-2 py-1 text-sm text-slate-900 w-56"
                    />
                  </label>
                </div>

                <button
                  onClick={() => setShowBody((s) => !s)}
                  className="mt-3 text-xs text-indigo-600 hover:underline"
                >
                  {showBody ? "Hide full JD" : "Show full JD"}
                </button>
                {showBody && (
                  <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700 bg-slate-50 rounded p-3 max-h-96 overflow-y-auto border border-slate-200">
                    {jd.body}
                  </pre>
                )}

                <div className="mt-4 flex items-center gap-3">
                  <button
                    onClick={evaluate}
                    disabled={evaluating}
                    className="rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50 px-4 py-1.5 text-sm font-medium"
                  >
                    {evaluating ? "Evaluating..." : "Re-evaluate"}
                  </button>
                  <label className="text-xs text-slate-500 flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={includeAll}
                      onChange={(e) => {
                        setIncludeAll(e.target.checked);
                        if (jd) runEvaluate(jd.id, e.target.checked);
                      }}
                    />
                    include all resumes (ignore manifest filter)
                  </label>
                </div>
              </section>

              {/* Evaluation results */}
              {evaluating && (
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-slate-200 animate-pulse border border-slate-200" />
                  ))}
                </div>
              )}
              {evalResp && (
                <>
                  <p className="text-xs text-slate-500 mb-2">
                    Evaluated {evalResp.evaluatedCount} of {evalResp.corpusSize} resumes in{" "}
                    {evalResp.durationMs} ms · mode: {evalResp.mode}
                    {evalResp.fallbackReason ? ` (fallback: ${evalResp.fallbackReason})` : ""}
                  </p>
                  <div className="space-y-2">
                    {evalResp.results.map((r, i) => {
                      const shown = r.missingKeywords.slice(0, 12);
                      const extra = r.missingKeywords.length - shown.length;
                      return (
                        <div
                          key={r.candidate.id}
                          className={`rounded-lg border p-3 bg-white shadow-sm ${
                            r.scorecard.hard_requirement_blocker
                              ? "border-rose-300"
                              : "border-slate-200"
                          }`}
                        >
                          <div className="flex items-center gap-4 flex-wrap">
                            <span className="text-slate-500 text-sm w-6">#{i + 1}</span>
                            <div className="w-40">
                              <div className="text-2xl font-bold">
                                {r.scorecard.fit_confidence}
                                <span className="text-xs font-normal text-slate-500">/100</span>
                              </div>
                              <div className="h-1.5 rounded bg-slate-200 mt-1">
                                <div
                                  className={`h-1.5 rounded ${
                                    r.scorecard.fit_confidence >= 70
                                      ? "bg-emerald-500"
                                      : r.scorecard.fit_confidence >= 45
                                        ? "bg-amber-500"
                                        : "bg-red-500"
                                  }`}
                                  style={{ width: `${r.scorecard.fit_confidence}%` }}
                                />
                              </div>
                            </div>
                            <div className="flex-1 min-w-48">
                              <div className="text-sm font-medium truncate">{r.candidate.name}</div>
                              <div className="text-xs text-slate-500">{r.candidate.folder}</div>
                              <div className="mt-1 flex gap-1 flex-wrap">
                                {r.scorecard.hard_requirement_blocker && (
                                  <span className="inline-block rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-800 uppercase">
                                    Blocker
                                  </span>
                                )}
                                {badge(r.scorecard.discipline_alignment)}
                                {badge(r.scorecard.seniority_delta)}
                                {badge(r.scorecard.domain_overlap)}
                                {badge(r.scorecard.reuse_recommendation)}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => doReuse(r.candidate.id)}
                                className="rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1 text-xs font-medium"
                              >
                                Reuse As-Is
                              </button>
                              <button
                                onClick={() => openKeywordPass(r)}
                                className="rounded bg-white hover:bg-slate-50 px-2.5 py-1 text-xs border border-slate-300 text-slate-700"
                              >
                                Keyword Pass
                              </button>
                              <button
                                onClick={doEscalate}
                                className="rounded bg-white hover:bg-amber-50 px-2.5 py-1 text-xs border border-amber-300 text-amber-700"
                              >
                                Escalate
                              </button>
                            </div>
                          </div>
                          {r.missingKeywords.length > 0 && (
                            <div className="mt-2 flex gap-1 flex-wrap items-center">
                              <span className="text-[10px] text-slate-500 uppercase mr-1">
                                missing
                              </span>
                              {shown.map((k) => (
                                <span
                                  key={k}
                                  className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700"
                                >
                                  {k}
                                </span>
                              ))}
                              {extra > 0 && (
                                <span className="text-[10px] text-slate-500">+{extra} more</span>
                              )}
                              {badge(r.scorecard.keyword_severity)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {/* Keyword Pass modal */}
      {kpModal && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-6 z-50">
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-[95vw] max-w-6xl h-[88vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h3 className="font-semibold">Keyword Pass - {kpModal.candidateId}</h3>
              <button
                onClick={() => setKpModal(null)}
                className="text-slate-500 hover:text-slate-700 text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="flex flex-1 min-h-0">
              <div className="w-64 shrink-0 border-r border-slate-200 bg-white p-3 overflow-y-auto">
                <div className="text-xs uppercase text-slate-500 mb-2">Missing keywords</div>
                <div className="flex gap-1 flex-wrap mb-3">
                  {kpModal.missingKeywords.map((k) => (
                    <span
                      key={k}
                      className="rounded bg-slate-100 border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-700"
                    >
                      {k}
                    </span>
                  ))}
                </div>
                {badge(kpModal.severity)}
                <button
                  onClick={() => navigator.clipboard.writeText(kpModal.missingKeywords.join("\n"))}
                  className="mt-3 w-full rounded bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-2 py-1 text-xs"
                >
                  Copy missing keywords
                </button>
                <div className="mt-4 space-y-2">
                  <label className="block text-xs text-slate-500">
                    Company
                    <input
                      value={kpModal.company}
                      onChange={(e) => setKpModal({ ...kpModal, company: e.target.value })}
                      className="mt-0.5 w-full rounded bg-white border border-slate-300 px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Role
                    <input
                      value={kpModal.role}
                      onChange={(e) => setKpModal({ ...kpModal, role: e.target.value })}
                      className="mt-0.5 w-full rounded bg-white border border-slate-300 px-2 py-1 text-sm text-slate-900"
                    />
                  </label>
                </div>
              </div>
              <div className="flex-1 min-h-0 flex flex-col">
                <p className="px-3 pt-2 pb-1 text-[11px] text-slate-500">
                  The Critical Alignment Assessment header and keyword tables are stripped
                  automatically by export_docx.py.
                </p>
                <textarea
                  value={kpModal.raw}
                  onChange={(e) => setKpModal({ ...kpModal, raw: e.target.value })}
                  className="flex-1 min-h-0 bg-white text-slate-900 border-t border-slate-200 text-xs font-mono p-3 resize-none outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-slate-200">
              <button
                onClick={() => setKpModal(null)}
                className="rounded bg-white px-3 py-1.5 text-sm border border-slate-300 text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => doKeywordPass()}
                className="rounded bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-sm font-medium"
              >
                Save & Export
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded px-4 py-2 text-sm shadow-lg border max-w-md break-words ${
              t.kind === "success"
                ? "bg-white border-slate-200 border-l-4 border-l-emerald-500 text-slate-800"
                : "bg-white border-slate-200 border-l-4 border-l-rose-500 text-slate-800"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
