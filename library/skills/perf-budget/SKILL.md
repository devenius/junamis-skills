---
name: perf-budget
version: "1.0.0"
description: Use to measure performance against budgets the user has set: JavaScript bundle size, API latency, and Core Web Vitals on a named URL. Records measurements over repeated runs and compares them to docs/perf/budgets.md. Read-only on code. Do not use to optimize code; that is a follow-up task. Do not use for Vercel billing or function-cost analysis.
---

# perf-budget

Measure, compare to a budget, and report. Never guess a number.

## Budgets

Read `docs/perf/budgets.md`. If it does not exist, create it with empty budgets and ask the user to set values. Do not invent budgets.

```markdown
# Performance budgets

| Metric | Budget | Scope |
|---|---|---|
| Initial JS (gzip) | 170 KB | /  |
| API p95 latency | 300 ms | GET /api/items |
| LCP | 2.5 s | https://<url> |
```

## Steps

1. **Bundle.** Run the project's build. Measure gzip size of the entry chunks from the build output. Record the build command and tool version.
2. **API latency.** For each endpoint in the budget, send 20 GET requests sequentially. Record p50 and p95. Read-only endpoints only.
3. **Web Vitals.** If a URL is given, run a Lighthouse or Playwright trace with the tool already in the project, three runs. Record the median.
4. **Compare.** For each metric: within budget, over budget, or not measured. Over budget is a finding, with the amount over.
5. **Write.** `docs/reviews/perf-<YYYY-MM-DD>.md` with a table of metric, budget, measured, status, method.

## Gotchas

- One run is noise. Use the runs listed above and report the spread.
- Measure on the same machine and conditions every time, and say which.
- Do not compare a dev build to a production budget. Build for production first.
- Latency from a laptop is not latency from the region users are in. Name the location.

## Finish

```yaml
agent: perf-budget
job: measure performance against budgets
status: complete | blocked | failed
artifacts:
  - path: docs/reviews/perf-<YYYY-MM-DD>.md
    kind: created
  - path: docs/perf/budgets.md
    kind: read-only
findings:
  - id: F1
    severity: high
    summary: initial JS 240 KB gzip over 170 KB budget
    evidence: <build output file and size>
decisions_owed:
  - set budget values for <metric>?
next: user
```

Use `status: blocked` when no budgets are set and the user has not answered. Use `next: maintainer` only if the user asks for optimization work.
