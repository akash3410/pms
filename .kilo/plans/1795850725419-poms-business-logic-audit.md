# POMS Business Logic Inventory — Implementation Plan

## Goal
Produce a comprehensive, read-only Business Logic Inventory documenting only what is actually implemented in the POMS Django backend, organized by application and business module. Output only under `docs/business-logic-inventory/`. No source changes, no gap/risk/test analysis.

## Deliverables (files to create)
- `docs/business-logic-inventory/README.md` — overview, how to read, module index
- `docs/business-logic-inventory/01-accounts.md`
- `docs/business-logic-inventory/02-rbac.md`
- `docs/business-logic-inventory/03-orders.md`
- `docs/business-logic-inventory/04-production.md`
- `docs/business-logic-inventory/05-targets.md`
- `docs/business-logic-inventory/06-audit.md`
- `docs/business-logic-inventory/07-reports.md`
- `docs/business-logic-inventory/08-common.md`
- `docs/business-logic-inventory/09-workflows.md` — Mermaid diagrams for major processes
- `docs/business-logic-inventory/10-evidence-index.md` — file/class/function/line references

## Per-logic entry template
1. Business Logic Name
2. What it does (observed)
3. Business purpose (only if inferable)
4. Step-by-step flow
5. Trigger / entry point
6. Inputs & conditions
7. Outputs / DB changes
8. Users/roles (where applicable)
9. Connections to other logic
10. Concrete example
11. Source references

## Execution Steps
1. Read project config: settings, urls, apps, migrations (schema), models.
2. For each app, read models, serializers, views, services, selectors, managers, signals, urls, tests (for behavior evidence only).
3. Trace execution flows end-to-end; document only reachable/implemented behavior.
4. Distinguish implemented vs documented-but-unimplemented.
5. Write deliverables; use plain language; Mermaid diagrams for major workflows.
6. Validate: all apps covered; no secrets; only new files under target dir; git status clean otherwise.

## Constraints
- Read-only on source; only create files under `docs/business-logic-inventory/`.
- No correctness/gap/risk/test-coverage classification.
- Do not invent business rules; describe observed behavior when purpose unclear.
