# Site language detection + override — design

**Date**: 2026-05-09
**Scope**: One feature, single implementation cycle.

## Goal

Persist a per-site language preference that drives every AI generation on
that site. The audit pipeline already detects a language from the catalog
(`audits.summary.detectedLanguage`); today, that detection only powers the
"dynamic audit" run during the audit itself — the per-product generation
endpoint (`POST /api/products/generate`) ignores it and relies on a brittle
"Match the source language" instruction in the prompts.

Two outcomes:

1. The detected language flows into every generation (title, description,
   tags, images, dynamic audit, retried jobs).
2. The merchant can override it from the **Aperçu** tab on
   `/dashboard/sites/[siteId]` via a searchable dropdown that matches by
   ISO 639-1 code or endonym (e.g. `fr` or `Français`).

The override is a project-level setting that survives re-audits.

## Non-goals

- Improving the language detector itself. `detectLanguage()` in
  `src/lib/audit/score.ts` only knows 5 stopword sets (en/fr/es/de/it); we
  don't expand it. Anything outside those 5 falls back to `'en'` until the
  user overrides.
- Localising language names to the UI locale. Endonyms only.
- Surfacing the resolved language on the per-product page or per-generation
  result. Out of scope for this slice.

## Architecture

```
projects.languageOverride (NEW: varchar(8), nullable)
                  │
                  ▼
       getEffectiveLanguage(projectId)
                  │
                  ├── languageOverride (if set) ─────────┐
                  │                                       │
                  └── audits.summary.detectedLanguage    │
                       (latest completed audit)          ▼
                                  │              languageCode (ISO 639-1)
                                  └────fallback───────────┐
                                       to 'en'             ▼
                                                 used by:
                                                  - /api/products/generate
                                                  - retry-job.ts (kie_dynamic_audit retries)
                                                  - process.ts (initial dynamic audit)
                                                       │
                                                       ▼
                                          languageNameForPrompt(code)
                                                  → 'French' / 'English' / …
                                                  → injected into system + user prompts
```

### Data layer

**Schema change** (`src/lib/db/schema.ts`, table `projects`):

```ts
languageOverride: varchar('language_override', { length: 8 }),
```

Placed adjacent to `customInstructions` to group site-level settings.

**Migration**: produced by `pnpm db:generate` (drizzle-kit). Applied via
`pnpm db:migrate`. No data backfill — existing rows stay NULL, which is
the "no override, use detection" sentinel.

**Helper** (new file `src/lib/audit/language.ts`):

```ts
export async function getEffectiveLanguage(projectId: string | null): Promise<string>;
```

Resolution priority:
1. If `projectId` is null → return `'en'` (legacy anon audits and orphan
   jobs have no project to read either an override or a paired audit
   from; we don't try to walk the row by `domain` for this fallback).
2. `projects.languageOverride` if non-null/non-empty.
3. Latest audit's `summary.detectedLanguage` for this project (looked up
   by `projectId`, ordered by `createdAt desc`, no status filter — we
   accept `running`/`failed` rows because their summary may still hold a
   prior detection).
4. `'en'`.

Pure read, no side-effects. One DB call for the project, one for the
latest audit (only fired when the project has no override). The nullable
signature reflects the schema: `audits.projectId` and `jobs.projectId`
are both nullable.

### Static language catalog

**New file** `src/lib/i18n/languages.ts` (separate from `src/i18n/`, which
is reserved for next-intl UI routing):

```ts
export interface LanguageEntry {
  /** ISO 639-1 two-letter code, lowercase. */
  code: string;
  /** Self-designation. Used in the dropdown UI. */
  name: string;
  /** English name. Used in LLM prompts so prompt strings stay stable
   *  regardless of UI locale. */
  promptName: string;
}

export const LANGUAGES: readonly LanguageEntry[];

export function findLanguage(code: string | null | undefined): LanguageEntry | null;
export function languageNameForPrompt(code: string | null | undefined): string; // → 'English' default
```

Static, hand-curated table of ~180 ISO 639-1 entries. No npm dependency.
Sorted alphabetically by endonym in the source for editability.

### AI pipeline wiring

**`/api/products/generate/route.ts`**

- `LoadedSnapshot` gains `languageCode: string`, populated via
  `getEffectiveLanguage(projectId)` inside `loadSnapshot`.
- `runChatOptim` and `startImageOptim` calls pass the resolved code through.
- `FIELD_DEFAULT_PROMPT` strings drop the "Match the source language."
  fragment — the explicit code now governs.

**`src/lib/ai/optims.ts` and `src/lib/ai/image-optim.ts`**

- `ChatOptimRequest` and `StartImageOptimRequest` gain `languageCode: string`.
- The chat builders are called with `languageCode`.

**`src/lib/ai/prompts.ts`**

- `buildTitleRewritePrompt(p, userPrompt, languageCode)` — system prompt
  ends with `Write the output in ${promptName}.`
- `buildDescriptionRewritePrompt(...)` — same change in system prompt.
- `buildTagSuggestionPrompt(...)` — system prompt clarifies tag language.
- `buildSuggestionPrompt(field, p, languageCode)` — point 4 changes from
  the conditional "if French, write in French" to `Write the prompts in
  ${promptName}.`
- The 3 image-angle prompts stay in English (better for gpt-image-2).
  Merchant-supplied instructions still flow through unchanged.

**`src/lib/ai/dynamic-audit.ts` and `src/lib/ai/retry-job.ts`**

- Local `LANGUAGE_NAMES` maps deleted; both files import
  `languageNameForPrompt` from `@/lib/i18n/languages`.
- `retry-job.ts` (the `kie_dynamic_audit` retry path) reads
  `getEffectiveLanguage(job.projectId)` instead of `input.language` from
  the stored payload. Rationale: an override set after the first run is
  "a future generation" per the product spec — the retry must respect it.
  If `job.projectId` is null (orphan job) the helper falls back to `'en'`
  via the same path as a legacy audit, which is acceptable for retries of
  pre-existing orphan rows.

**`src/lib/audit/process.ts`**

- We already have `result.report.detectedLanguage` in memory at the call
  site, so we don't reuse `getEffectiveLanguage` here (it would re-query
  for the audit row we just produced). Instead, the resolution is inlined:

  ```ts
  let language = result.report.detectedLanguage;
  if (row.projectId) {
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, row.projectId),
      columns: { languageOverride: true }
    });
    language = project?.languageOverride ?? language;
  }
  ```

  This preserves today's behaviour for legacy anon audits
  (`row.projectId === null`) while letting an override win on re-audits.

### UI

**Server action** (`src/lib/auth-actions.ts`)

```ts
export async function updateProjectLanguageAction(formData: FormData): Promise<void>;
```

- Reads `projectId` and `languageCode` from `formData`.
- Verifies ownership (`projects.userId === session.user.id`), same guard
  as `updateProjectInstructionsAction`.
- Validates the code via `findLanguage(code)`. Empty / unknown → writes
  `null` (= revert to detection).
- Updates `projects.languageOverride`, calls
  `revalidatePath('/dashboard/sites/${projectId}')`.

**Component** `src/components/site-language-editor.tsx`

- `'use client'`, mirrors the structure and saved-state UX of
  `SiteInstructionsEditor` (dirty tracking, transition pending state,
  inline "Saved" feedback for ~2.5s).
- Renders a `<Card variant="secondary">` with header (label + Globe icon),
  a HeroUI `Autocomplete` (single-select), and a Save button.
- Below the label: a small badge —
  - `Détectée` (muted) if `initialOverride === null` and
    `detectedLanguage !== null`,
  - `Personnalisée` (accent) if `initialOverride !== null`,
  - hidden if both null (audit hasn't completed yet).
- Autocomplete behaviour:
  - `selectionMode="single"`, value is the ISO code.
  - Each `ListBox.Item` has `id={code}` and
    `textValue={`${code} ${name}`}`, displaying the endonym with the code
    in monospace next to it.
  - Filter via `Autocomplete.Filter filter={contains}` from `useFilter()`,
    case-insensitive — matches "fr" → "fr Français" and "Fran" → same.
    No accent normalisation; `useFilter({ sensitivity: 'base' })` already
    treats `é` and `e` as equivalent.
  - Clear button reverts the in-memory selection to `null`. On Save with
    `null`, the override column is cleared.
- Initial value:
  - If `initialOverride` is set, the dropdown shows the override.
  - Otherwise it shows the detected language (so the field is never empty
    when there's a known answer); the badge says "Détectée" so the user
    knows the value isn't yet persisted as override. A Save click on the
    same value upgrades it from "Détectée" to "Personnalisée".

**Page integration**
(`src/app/[locale]/dashboard/sites/[siteId]/page.tsx`)

- Inside the `activeTab === 'overview'` block, the new
  `<SiteLanguageEditor>` is rendered just above `<SiteInstructionsEditor>`.
- `project.languageOverride` is selected from the projects query (no
  schema change to that query — it already pulls `customInstructions` and
  the new column is on the same row).

### i18n

New translation namespace `SiteLanguage` with keys:

```
SiteLanguage.label
SiteLanguage.hint
SiteLanguage.placeholder       (search field placeholder, e.g. "Rechercher (code ou nom)")
SiteLanguage.searchPlaceholder
SiteLanguage.detectedBadge
SiteLanguage.customBadge
SiteLanguage.empty             (ListBox empty state, "Aucune langue trouvée")
SiteLanguage.saveButton
SiteLanguage.saved
```

All 13 locale files (`messages/*.json`) get the namespace populated. Per
CLAUDE.md, missing keys throw at runtime in next-intl, so this isn't
optional.

The endonyms in `LANGUAGES` are the same string regardless of UI locale —
they're not translated.

## Behavioral edge cases

- **No completed audit yet**: `getEffectiveLanguage` falls back to `'en'`.
  The editor shows an empty Autocomplete with no badge until the audit
  completes; setting an override still works.
- **Audit detected language is one we don't know about**: detector only
  emits codes from its 5-language table, so this can't happen today. If it
  ever does (catalog drift), `findLanguage(code)` returns `null` and the
  badge is suppressed; the dropdown lets the merchant pick a real value.
- **Re-audit after override**: the new detection is written to
  `audits.summary.detectedLanguage` as before; `languageOverride` is
  untouched. The badge stays "Personnalisée".
- **User clears the override**: column flips to NULL, future generations
  use the detected language. If the user hits Save without changing
  anything when the badge says "Détectée", the override column is
  populated with that detected code (intentional — they're confirming).

## Files changed / created

**Created**
- `src/lib/i18n/languages.ts` — static catalog + helpers
- `src/lib/audit/language.ts` — `getEffectiveLanguage(projectId)`
- `src/components/site-language-editor.tsx` — UI component
- `src/lib/db/migrations/000X_add_project_language_override.sql` — drizzle-generated

**Modified**
- `src/lib/db/schema.ts` — `projects.languageOverride` column
- `src/lib/auth-actions.ts` — `updateProjectLanguageAction`
- `src/app/[locale]/dashboard/sites/[siteId]/page.tsx` — render
  `<SiteLanguageEditor>` above `<SiteInstructionsEditor>`
- `src/app/api/products/generate/route.ts` — pass `languageCode` through
- `src/lib/ai/optims.ts` — `languageCode` on `ChatOptimRequest`
- `src/lib/ai/image-optim.ts` — `languageCode` on `StartImageOptimRequest`
- `src/lib/ai/prompts.ts` — explicit language in all 4 builders, drop
  "Match the source language."
- `src/lib/ai/dynamic-audit.ts` — import shared `languageNameForPrompt`
- `src/lib/ai/retry-job.ts` — same dedup, plus read effective language
  from project at retry time
- `src/lib/audit/process.ts` — read effective language for the dynamic
  audit at the end of an audit run
- `messages/{en,fr,es,de,it,pt,ru,pl,tr,ar,zh,ja,ko}.json` —
  `SiteLanguage` namespace

## Out of scope (future work)

- Surfacing the resolved language on each product page (subtle "Generated
  in: French" tag).
- Per-product language override (a product page in a different language
  on a multilingual storefront).
- Improving `detectLanguage()` to support all 13 UI locales — currently
  capped at 5.
- Localising endonyms to the UI locale.

## Verification

- `pnpm typecheck` — no `any`, strict types preserved across the new
  function signatures.
- `pnpm lint` — repo conventions.
- Manual QA on the target site
  (`/dashboard/sites/9e18cd9c-a6d1-4a24-9798-efaedc49b16e`):
  1. Open the Aperçu tab — verify the badge says "Détectée" and the
     dropdown is pre-filled with the detected language.
  2. Type `fr` in the search → "Français" filters in. Type `Fran` → same.
  3. Pick a different language, save, reload → badge says "Personnalisée".
  4. Trigger a per-product generation → result is in the chosen language.
  5. Clear the override, save, reload → badge reverts to "Détectée".
  6. Re-launch the audit → override is preserved across the re-audit.
- No automated test suite per CLAUDE.md; verification = typecheck + lint
  + the manual QA above.
