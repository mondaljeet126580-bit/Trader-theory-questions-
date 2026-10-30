# WBP & KP Exam MCQ Hub & Mock Simulator

A Bengali-first MCQ study and mock-test application connected to the existing **Trade Theory Supabase project**.

## Run / publish

This is a static HTML, CSS, and JavaScript app. It does not require a Node build step.

- Open \`index.html\` for the user study and mock-test app.
- Open \`admin.html\` for the protected Admin Panel.
- The app uses the existing Supabase Auth accounts. Sign in with the email/password already registered in the Trade Theory Supabase project.
- To publish with GitHub Pages, choose deployment from the \`main\` branch and root folder in **Settings → Pages**.

## Supabase project and access model

The app is connected to the existing project named \`Trader-theory-questions-\` in \`ap-south-1\`. It uses the project's publishable key in browser code; no service-role key or database password is included.

- Users must sign in with Supabase Auth to open the app.
- The current Admin account is checked against the existing \`public.study_admins\` table.
- The Admin Panel requires both the existing Supabase account password and the additional Admin passcode. The passcode is verified by a database function; it is not embedded in the HTML or JavaScript.
- The passcode is stored only as a salted hash in the non-exposed \`app_private\` schema. The verification function is executable only by authenticated users and checks Admin membership. Five failed attempts cause a 15-minute lockout.
- Never put a Supabase service-role or secret key in this repository.

## Admin Panel

The Admin Panel supports:

- Selecting an existing subject.
- Creating a new subject.
- Pasting many question blocks at once.
- Importing TXT or JSON files.
- Previewing and validating questions before saving.
- Importing MCQs with 2–8 options, correct answer, and optional explanation.
- Automatically continuing question numbers within a subject.
- Writing rows to the existing \`public.subjects\` and \`public.mcq_questions\` tables in batches of 250.

New subjects and questions are created with \`owner_id = auth.uid()\` and \`is_published = false\`. They remain private to their owner. Other users cannot read unpublished questions or subjects. Publishing content is not exposed as an Admin action in this version.

## Personal data and past performance

The user app reads only published content and content owned by the signed-in account, as enforced by Row Level Security (RLS).

Mock-test submissions are stored in \`public.study_practice_sessions\`. Each record contains the signed-in user's ID, subject, score, correct/wrong/skipped totals, duration, timestamps, and answer snapshot. RLS restricts SELECT and INSERT to the owning user.

The **My Performance** view shows the signed-in user's session history, average score, best score, and older individual answer records from \`public.question_attempts\`.

The database already had one individual question-attempt record for the Admin account, but no prior mock-test session. New sessions are recorded from this app after submission.

## Existing database objects used

Existing study tables reused by the app:

- \`subjects\`
- \`chapters\`
- \`mcq_questions\`
- \`study_admins\`
- \`question_attempts\`
- \`mock_test_attempts\` (existing records retained)
- \`user_progress\` (existing records retained)

One new study-only table was added: \`study_practice_sessions\`. No WhatsApp/chat tables were changed.

Two nullable owner columns were added to the existing \`subjects\` and \`mcq_questions\` tables. Existing published General Science sample content remains public; the old personal History test row was assigned to the Admin owner and marked unpublished/private.

## Repository files

- \`index.html\` — main study/mock-test UI.
- \`admin.html\` — Admin sign-in and bulk question management UI.
- \`admin.js\` — bulk question parser, validation, preview, and subject operations.
- \`admin-auth.js\` — Admin Auth and database passcode verification.
- \`supabase-client.js\` — Supabase URL and publishable client configuration.
- \`supabase-question-store.js\` — Supabase question and performance data adapter.
- \`study-app-integration.js\` — sign-in, private question loading, performance history.
- \`question-store.js\` — old IndexedDB preview adapter, retained but not used by the connected pages.
- \`SUPABASE_INTEGRATION.md\` — current schema, security and operating notes.

## Important notes

- The additional Admin passcode is a short numeric code. Keep Supabase Auth enabled as the primary login and retain the database lockout/RLS controls. A longer passphrase is safer.
- Question import size is not limited by an application-level question count cap, but Supabase request, row-size, and project limits still apply.
- Performance history begins recording new mock-test submissions after this deployment. Previous ad-hoc browser-only tests cannot be reconstructed unless they were already stored in Supabase.
