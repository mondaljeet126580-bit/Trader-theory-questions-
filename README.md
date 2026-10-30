# WBP & KP Exam MCQ Hub & Mock Simulator

A Bengali-first static MCQ study and mock-test application connected to the existing Trade Theory Supabase project.

## Run / publish

- Open index.html for the main study and mock-test app. It opens in Guest mode without an email or password form.
- Open admin.html for the Admin Panel. Only the Admin Panel asks for the additional passcode.
- To publish with GitHub Pages, choose the main branch and root folder in Settings → Pages.

## Main app access

The main app does not require Supabase email/password sign-in.

- Visitors see subjects and questions marked as published.
- If the Admin Panel is unlocked in the same browser, the main app can also load the Admin's private uploads using the temporary Admin session token, including after navigation, reload, or opening another tab.
- That token is kept in browser localStorage (not the passcode), is validated by the server, and expires after four hours. The Admin Lock action revokes it and clears it from localStorage.
- Closing the tab clears the browser-held token. The Admin must unlock again to view private content.
- No passcode is embedded in HTML or JavaScript.

Without Admin unlock, past performance is stored in that browser's local storage. After Admin unlock, new test results are saved to Supabase under the existing Study Admin owner and are visible only through a valid Admin session. Guest-mode local history does not automatically sync between devices.

## Admin Panel access

The Admin Panel requires only the additional Admin passcode. It does not ask for Supabase email or account password.

The passcode is verified by public.unlock_study_admin(text). That database function checks the stored salted iterative hash and creates a high-entropy, short-lived token. The raw passcode is not included in this repository. Failed attempts are rate-limited by source/IP and user agent; five failures cause a 15-minute lockout.

The token is sent with Admin-only RPC calls. Those functions validate the token and expiry before reading or changing private data. The temporary session token is kept in localStorage so Main App and Admin Panel can share it in the same browser. It is not the passcode, expires server-side after four hours, and is revoked by the Admin Lock action.

## Admin Panel features

- Select an existing subject.
- Create a new subject.
- Paste many question blocks at once.
- Import TXT or JSON files.
- Preview and validate questions before saving.
- Add MCQs with 2–8 options, correct answer, and optional explanation.
- Continue numbering from the subject's latest question.
- Insert questions to the existing public.mcq_questions table in batches of 250.
- Review only your own private Admin-uploaded questions in the "My Uploaded Questions" panel.
- Delete one question or select multiple questions and permanently delete them from Supabase.

New subjects and questions are saved as unpublished/private and assigned to the existing Study Admin owner. Another visitor cannot read them through normal public queries. Only a valid Admin session can fetch the private rows.

Deletion is owner-checked on the server: only rows with the current Admin owner_id, source_type = admin_upload, and is_published = false can be deleted. The related bookmarks, mock-test question links, and individual question_attempts are removed by the database foreign-key cascades. Previously saved study_practice_sessions answer snapshots remain as historical test records.

## My Past Performance

The My Performance view shows:
- Test date and subject.
- Total, correct, wrong, and unanswered question counts.
- Score, average, best score, and duration.
- Per-test answer snapshots.

In Guest mode, this history is stored locally in the current browser. With Admin unlock active, history is saved and fetched from public.study_practice_sessions using the Admin's private session token. Existing historical individual answers from public.question_attempts are also shown during Admin unlock.

## Supabase project

The app is connected to the existing project named Trader-theory-questions- in ap-south-1. It reuses the existing study tables and creates no duplicate study database. It uses the project's publishable key in browser code; no service-role or secret key is included.

Study objects used:
- subjects
- chapters
- mcq_questions
- study_admins
- question_attempts
- study_practice_sessions

New Admin-only database RPCs:
- unlock_study_admin
- study_admin_load_content
- study_admin_create_subject
- study_admin_bulk_add_questions
- study_admin_count_questions
- study_admin_save_performance
- study_admin_list_performance
- study_admin_lock_session

Admin-only session records and passcode hash are stored in the non-exposed app_private schema. The RPC functions use an empty search path, validate the session token, and check its expiry. The short-lived token is a bearer credential: do not copy it to another person or paste it into chat.

No WhatsApp/chat tables or policies were changed.

## Repository files

- index.html — main guest-mode study/mock-test UI.
- admin.html — single-passcode Admin Panel.
- admin.js — bulk question parser, validation, preview, and subject operations.
- admin-auth.js — passcode-only Admin session unlock/lock.
- supabase-client.js — Supabase URL and publishable client configuration.
- supabase-question-store.js — public content, passcode RPC, and performance adapter.
- study-app-integration.js — Guest mode, private content loading, and performance history.
- question-store.js — older IndexedDB preview adapter, retained but not used by the connected pages.
- SUPABASE_INTEGRATION.md — schema and security notes.

## Important notes

- The passcode is six digits, so keep the rate limit active and do not share it. A longer passphrase would be safer.
- Question import has no application-level total-count cap; Supabase API request, row-size, and project limits still apply.
- The current Admin session is tied to the single existing row in study_admins; if you later add more Admins, review whether each should share this passcode system.
- GitHub Pages deployment status still needs a live browser check after the latest commits.
