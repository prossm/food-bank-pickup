---
description: Create/update a PR to main, summarizing the branch's changes for the food bank's non-technical staff
---

Create (or update) a pull request from the current feature branch (or a branch named as an argument) into `main`, summarizing every commit on the branch that isn't on `main` yet.

Audience: the food bank's non-technical staff and operators. Write in plain product language — what a household signing up by text sees, or what changes for staff, and why it matters. Keep file paths, function names, and jargon out of the main sections (the deploy note may be technical).

Steps:

1. **Establish the true diff against the remote base.** Run `git fetch origin` first, then compare against `origin/main` — never a possibly-stale local `main`:
   - `git log --oneline origin/main..HEAD` — the commit list
   - `git diff --stat origin/main...HEAD` — the changed files

   Commit messages can be terse or misleading; open each commit's diff to see what it actually changed before summarizing. This step matters: a branch whose feature was already merged into `origin/main` will look like it is re-introducing that whole feature when compared against a local `main` that predates the merge — describe only what is genuinely still ahead of `origin/main`.

2. **Check for an existing open PR** for this branch (`gh pr list --head <branch> --base main`). If one exists, update it with `gh pr edit` instead of opening a duplicate.

3. Group changes under these emoji headings, in this order, omitting any that are empty:
   - ⭐ New features
   - 🐞 Bug fixes
   - 🎨 Style tweaks
   - ⚙️ Chores (docs, cleanup, dependencies, tooling)

4. Open with a one-or-two-sentence overview of the release.

5. If anything needs **manual human work** for the shipped code to actually function, end with a **"Note for deploy:"** section listing each item. Treat this broadly, not just migrations. In this repo specifically, scan the diff for:
   - **Migrations that must be run by hand.** Most migrations apply themselves on deploy — the `vercel-build` script runs `migrate` then `seed` before the build — so an ordinary additive `drizzle/NNNN_*.sql` is *not* a deploy note. But the README reserves anything **destructive or data-rewriting** for a manual run against the **Neon SQL editor**; call those out, along with any data backfill a person must perform.
   - **New or changed environment variables** — anything added or renamed (e.g. `DATABASE_URL`, `FOOD_BANK_TZ`, `SLOT_CAPACITY`). Grep the diff for new `process.env.*` reads to catch these, and say where they must be set (Vercel for production, `.env` locally).
   - **Staff-account setup.** There is no self-service sign-up. If this release is the first to need an admin, note that an account is minted by running `npm run admin:sql -- <email> --generate` locally and pasting the printed `INSERT` into the **Neon SQL editor** (the same command resets a password).
   - **External / third-party setup** — webhooks to register, dashboard toggles, API tokens, DNS records, feature flags, a real Twilio number, etc.

   Keep these lines impersonal — don't address anyone by name. They may be technical. If there is genuinely no manual work, omit the section entirely.

6. **Verify before finishing.** After creating or editing the PR, cross-check the description against `gh pr view <n> --json files` — every claim in the body must correspond to a file actually in the PR. If they don't match, the base or the summary is wrong; fix it before reporting done.

7. No Claude / Claude Code attribution anywhere in the title or body.
