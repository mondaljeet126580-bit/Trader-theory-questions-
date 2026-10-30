# Trade Theory Supabase integration — connected state

## Scope

This integration uses only the Supabase project named \`Trader-theory-questions-\` (\`mtrnkalszadyzmanyxvx\`, region \`ap-south-1\`). No WhatsApp/chat tables or policies were changed.

## Existing objects reused

The app uses the already-existing study tables:
- \`public.subjects\`
- \`public.chapters\`
- \`public.mcq_questions\`
- \`public.study_admins\`
- \`public.question_attempts\`
- \`public.user_progress\`
- \`public.mock_test_attempts\`

One existing Auth user is already linked to \`public.study_admins\`; existing Admin/User accounts were not recreated.

## Schema changes

- Added nullable \`owner_id uuid references auth.users(id)\` to \`public.subjects\` and \`public.mcq_questions\`.
- Changed the default for new subject rows to \`is_published = false\`.
- Kept public SELECT policies for published rows and added owner-based SELECT for private rows.
- Replaced broad Admin ALL policies on subjects/questions with separate Admin INSERT/UPDATE/DELETE policies scoped to the Admin's own rows (and legacy rows with null owner). Private content from another owner is not visible merely because someone is an Admin.
- The previous personal History test question (id 16) was assigned to the existing Admin account and set unpublished. The published General Science sample question remains published.
- Added \`public.study_practice_sessions\` for per-user submitted mock-test history with a JSON answer snapshot and score metrics.
- Enabled RLS on the new table. SELECT and INSERT require \`user_id = auth.uid()\`. Explicit \`GRANT SELECT, INSERT TO authenticated\` is applied; anon has no access.
- Added an index for per-user session history.

## Admin access

The Admin Panel requires:
1. A valid existing Supabase Auth email/password sign-in.
2. A matching row in \`public.study_admins\`.
3. A successful call to \`public.verify_study_admin_passcode(text)\`.

The extra passcode is stored as a salted hash in \`app_private.study_admin_passcode\`; raw passcode text is not present in the GitHub files or exposed table data. The \`app_private\` schema is not granted to \`anon\` or \`authenticated\`. The public verification function uses a fixed empty search path, checks \`auth.uid()\` against \`study_admins\`, and applies a five-failures/15-minute lockout. Function execute permission is revoked from PUBLIC and anon and granted only to authenticated.

The numeric passcode is only an extra gate. Supabase Auth remains the primary account password and must not be replaced by the numeric code.

## Data flow

### User app
- Calls Supabase Auth \`getSession()\` and server-verified \`getUser()\`.
- Loads visible subjects and questions from the existing tables.
- RLS returns only published content or rows owned by the signed-in user.
- Saves mock-test session summaries to \`study_practice_sessions\`.
- Loads only the signed-in user's own session history and older \`question_attempts\`.

### Admin Panel
- Signs in through Supabase Auth.
- Queries \`study_admins\` to confirm the current user is an Admin.
- Calls the passcode verification RPC.
- Adds a private subject to \`public.subjects\`.
- Inserts questions into \`public.mcq_questions\` with \`owner_id = auth.uid()\` and \`is_published = false\`.
- Uses 250-row batches for large imports.

## API keys and Data API grants

The browser uses the project's publishable key only. It is not a secret and relies on RLS. No service-role or secret key is present in the repository.

The new \`study_practice_sessions\` table has explicit authenticated SELECT/INSERT grants and no anon grant, because Supabase's 2026 Data API exposure change makes explicit grants important for new public-schema tables.

## Verification already performed

- Admin JWT simulation matched a \`study_admins\` row and the database passcode verification returned true.
- The Admin can see the private History question.
- A different authenticated User can see the published General Science row but not the private History question or private History subject.
- Admin-only insert and read of a temporary private subject/question succeeded inside a transaction that was rolled back.
- The Admin can insert and read their own practice session under RLS inside a transaction that was rolled back.
- The app's scripts still require a real browser sign-in and live end-to-end check before it should be treated as production-verified.

## Operational caveats

- A six-digit passcode is weak on its own. Keep the Supabase Auth password as primary authentication and consider replacing the extra passcode with a longer passphrase.
- New private questions are not published to other users. Publishing UI is deliberately not included.
- Existing browser-only history cannot be imported automatically; only records that were already stored in Supabase and future test submissions are shown.
