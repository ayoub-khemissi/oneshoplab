# Site language detection + override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a per-site language preference (overrides audit-detected language) and route it through every AI generation, surfaced via a searchable dropdown in the Aperçu tab of `/dashboard/sites/[siteId]`.

**Architecture:** New nullable column `projects.languageOverride` (varchar(8)) stores the merchant's choice; resolver helper `getEffectiveLanguage(projectId)` reads override → falls back to latest audit's `summary.detectedLanguage` → `'en'`. The chat-driven prompts (title/description/tags + dynamic audit + retries) consume an explicit ISO code; image prompts stay in English. UI is a new `<SiteLanguageEditor>` rendered in the overview tab above `<SiteInstructionsEditor>`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict, Drizzle ORM (MySQL), HeroUI v3 (`Autocomplete` + `useFilter`), next-intl (13 locales), pnpm.

**Verification model:** This repo has no automated test suite (per `CLAUDE.md`). Verification at every step is `pnpm typecheck` + `pnpm lint`, plus manual QA at the end. Do **not** introduce a test runner.

**Spec reference:** `docs/superpowers/specs/2026-05-09-site-language-design.md`

---

## Implementation status (post-execution snapshot)

All 8 implementation tasks shipped on `main` between commits `7ef1f41` and `19efae0`:

| Task | Subject | Commit |
|---|---|---|
| 1 | ISO 639-1 language catalogue (`src/lib/i18n/languages.ts`) | `7ef1f41` |
| 2 | `projects.language_override` schema column + drizzle migration `0009` | `93a3930` |
| 3 | `getEffectiveLanguage` resolver (`src/lib/audit/language.ts`) | `908b909` |
| 4 | Wire language through prompts.ts + optims.ts + suggestions.ts + dynamic-audit.ts + retry-job.ts + generate route | `d122353` |
| 5 | Override-aware dynamic audit (`process.ts`) and retry path (`retry-job.ts`) | `44e6f6b` |
| 6 | `updateProjectLanguageAction` server action | `17cef25` |
| 7 | `<SiteLanguageEditor>` component + dashboard page integration | `30b1087` |
| 8 | `SiteLanguage` i18n namespace × 13 locales | `19efae0` |

`pnpm typecheck` passes at every commit. `pnpm lint` (`next lint`) is broken upstream in this Next 16 setup (`Invalid project directory provided, no such directory: …\\lint`) — pre-existing issue unrelated to this feature.

Task 9 below is the remaining manual QA the merchant runs against
`/dashboard/sites/9e18cd9c-a6d1-4a24-9798-efaedc49b16e`.

---

### Task 9: Manual QA

**No code changes.** Validates the implementation end-to-end.

- [ ] **Step 1: Apply the migration locally**

```
pnpm db:migrate
```

Expected: drizzle-kit reports `0009_organic_namor` applied. Confirm via
`DESCRIBE projects;` — `language_override VARCHAR(8) NULL` should be
present.

- [ ] **Step 2: Boot the app**

Two terminals:
- Terminal A: `pnpm dev`
- Terminal B: `pnpm worker:dev`

- [ ] **Step 3: Walk through the QA checklist**

Open `http://localhost:3000/<your-locale>/dashboard/sites/9e18cd9c-a6d1-4a24-9798-efaedc49b16e`.

1. **Default state**: Aperçu tab shows the new "Langue du site" card above the instructions card. Badge reads "Détectée" (or none if the audit hasn't surfaced a language). Dropdown is pre-filled with that detected language.
2. **Search by code**: Type `fr` → "Français" filters in.
3. **Search by endonym**: Type `Fran` → "Français" still filters in.
4. **Save the override**: Pick e.g. `de` → "Deutsch", click Enregistrer. Green "Enregistré" appears for ~2.5s. Reload → dropdown shows Deutsch, badge reads "Personnalisée".
5. **Generate a product field**: Open any product, trigger Description generation. The HTML output is in German.
6. **Clear the override**: Click the clear (×) inside the autocomplete, then Enregistrer. Reload → badge reverts to "Détectée".
7. **Re-audit preserves override**: Set override again, click "Relancer l'audit". After completion, reload → badge still "Personnalisée".

- [ ] **Step 4: Optional — dynamic audit language**

After Step 7, inspect the Activity tab's latest `kie_dynamic_audit` job. Title/description/social posts should be in the override language.

- [ ] **Step 5: If everything passes, the implementation is complete**
