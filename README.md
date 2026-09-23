# Resume Match Router

Local triage dashboard that matches incoming job descriptions (JD inbox in an
Obsidian `career-engine` vault) against the existing resume corpus, then lets you
route each JD to one of three outcomes: **Reuse As-Is**, **Keyword Pass**, or
**Escalate** (full compile).

## Architecture

- **Next.js App Router + TypeScript + Tailwind** (dark slate theme, no UI deps).
- **Hybrid keyword pipeline** (`src/lib/keywords.ts`): a curated ~150-term
  cross-discipline lexicon plus proper-noun/acronym heuristics extracts JD
  keywords; `prerankScore` ranks the whole corpus deterministically and only the
  top `JEV_SHORTLIST` candidates are sent to the evaluator.
- **Jev contract** (`src/lib/jev/contract.ts`): verbatim copy of the TypeSafe
  System One evaluation contract. `src/lib/jev/client.ts` POSTs the
  `EvaluationState` plus typed questions to `https://api.typesafe.ai/v1/systemone`
  and validates the returned choice/score/noul answers.
- **Mock fallback** (`src/lib/jev/index.ts`, `mock.ts`): when
  `TYPESAFE_API_KEY` is empty the deterministic mock evaluator produces seeded
  scorecards (same JD+candidate always scores the same). If a real key returns
  401/403 on the first call of a batch, the whole batch falls back to mock and
  the response reports `mode: "mock"` with `fallbackReason`.
- **Vault layer** (`src/lib/vault/`): all file access resolves under
  `VAULT_PATH` with a `startsWith` confinement check. JD parsing via
  `gray-matter`; resumes get `<style>` blocks, frontmatter and `[[wikilinks]]`
  stripped before being sent to Jev. When
  `applications/compounding-memory.md` exists only resumes marked
  `Ingested & Active` are loaded (`?includeAll` overrides).
- **Actions** (`src/lib/actions.ts`): `reuseAsIs` copies the donor resume to
  `applications/{Company}/RESUME-{Company}-[{Role}].md`, exports a sibling
  `.docx` via `tools/export_docx.py` (`PYTHON_BIN`), and moves the JD to
  `raw/processed/` with `status: matched-reuse`. `keywordPass` writes edited
  markdown with `status: compiled`. `escalate` tags the JD
  `escalate-full-compile` in place. Existing targets return 409 unless
  `overwrite: true`; the donor is never overwritten.

## Quickstart (Mac)

```bash
cp .env.example .env.local
# edit .env.local: VAULT_PATH="/Users/michaelhoefert/Obsidian/Second Brain/career-engine"
pip3 install python-docx
npm install
npm run dev
# open http://localhost:3000
```

On this repo's dev machine a `reference-vault` symlink points at the vault so
the default relative `VAULT_PATH` works out of the box.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VAULT_PATH` | `./reference-vault/career-engine` | career-engine folder; relative resolved against repo root |
| `TYPESAFE_API_KEY` | _(empty)_ | Jev API key; empty = mock evaluator |
| `JEV_MODEL` | `jev-latest` | model name sent to System One |
| `JEV_SHORTLIST` | `30` | top-N after pre-rank; `all` evaluates full corpus |
| `JEV_CONCURRENCY` | `16` | max parallel evaluations |
| `PYTHON_BIN` | `python3` | interpreter for docx export |

## API

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/status` | - | vault path, exists, mode, corpus size, exporter availability |
| `GET /api/inbox` | - | `{jds: JdSummary[]}` from `raw/unprocessed` |
| `GET /api/jd/[id]` | - | full JD detail incl. body + wordCount |
| `POST /api/evaluate` | `{jdId, includeAll?}` | `EvaluateResponse` sorted by fit_confidence desc |
| `GET /api/resume?id=` | - | donor raw markdown + cleaned text |
| `POST /api/actions/reuse` | `{jdId, candidateId, company, role, overwrite?}` | `{resumePath, docxPath, docxOk, exportLog, jdPath}` |
| `POST /api/actions/keyword-pass` | same + `{content}` | same (GET returns donor raw md for the modal) |
| `POST /api/actions/escalate` | `{jdId}` | updated JD summary |

All errors are `{error}` JSON with appropriate status codes (400 path escapes,
404 missing, 409 target exists).

## Note: reuse-as-is vs AGENTS-CAREER ledger

The vault's AGENTS-CAREER ledger workflow historically tracks resume versions
differently; this tool implements the chosen spec: **copy the donor + export a
.docx sibling, never overwrite the donor**, and record `matched_donor` /
`matched_resume` wikilinks on the processed JD frontmatter.
