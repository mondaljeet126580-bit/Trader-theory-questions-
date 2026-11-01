# WBP & KP Exam MCQ Hub & Mock Simulator

A Bengali-first static MCQ study and mock-test application connected to the existing Trade Theory Supabase project.

## Run / publish

- Open index.html for the main study and mock-test app. It opens in Guest mode without an email or password form.
- The Admin Panel is a standalone single-file HTML (`Exam_Prep_Local_Admin.html`) kept on the owner's phone; it is not linked, committed, or hosted inside the public User App.
- To publish with GitHub Pages, choose the main branch and root folder in Settings → Pages.

## Main app access

The main app does not require Supabase email/password sign-in.

- Visitors see subjects and questions marked as published.
- The User App has no Admin Panel button or published Admin UI.
- Open the local Admin HTML, unlock it, then use its **Open Exam Prep User App** link. This transfers a short-lived Admin session through a URL fragment; the User App stores it in its own browser origin and immediately clears the fragment from the address bar.
- The token is not the passcode, is validated by Supabase, expires after four hours, and is revoked by the Admin Lock action.
- The local Admin page keeps its short-lived token in memory only; closing it requires another unlock. The User App stores a transferred token in its own site storage until expiry or Admin Lock.
- No passcode is embedded in HTML or JavaScript.

Without Admin unlock, past performance is stored in that browser's local storage. After Admin unlock, new test results are saved to Supabase under the existing Study Admin owner and are visible only through a valid Admin session. Guest-mode local history does not automatically sync between devices.

## Admin Panel access

The standalone local Admin HTML requires only the additional Admin passcode. It does not ask for Supabase email or account password. The Admin HTML is not committed to the public GitHub Pages branch.

The passcode is verified by public.unlock_study_admin(text). That database function checks the stored salted iterative hash and creates a high-entropy, short-lived token. The raw passcode is not included in this repository. Failed attempts are rate-limited by source/IP and user agent; five failures cause a 15-minute lockout.

The token is sent with Admin-only RPC calls. Those functions validate the token and expiry before reading or changing private data. The temporary session token is kept in localStorage so Main App and Admin Panel can share it in the same browser. It is not the passcode, expires server-side after four hours, and is revoked by the Admin Lock action.

## Admin Panel features

- Select an existing subject.
- Create a new subject.
- Paste many question blocks at once.
- Import TXT or JSON files.
- Preview and validate questions before saving.
- Import text-based, selectable PDF files as well as TXT/JSON files. PDF text is extracted in the browser with Mozilla PDF.js; scanned/image-only PDFs are not OCR-processed.
- Add MCQs with 2–8 options, correct answer, and optional explanation.
- Continue numbering from the subject's latest question.
- Insert questions to the existing public.mcq_questions table in batches of 250, linked by a required subject_id foreign key.
- Review only your own private Admin-uploaded questions in the "My Uploaded Questions" panel.
- Delete one owned upload or select multiple owned uploads.
- Permanently clear every MCQ from one selected Subject while keeping the Subject.
- Permanently clear every MCQ across all Subjects while keeping Subject records.
- Delete any selected Subject together with its MCQs, Chapters, and Theory Notes.

New subjects and questions are saved as unpublished/private and assigned to the existing Study Admin owner. Each MCQ must carry a subject_id foreign key, and the subject slug is stored in the legacy subject text field. The UI groups each question by subject_id, so an MCQ cannot appear in another Subject. Another visitor cannot read private rows through normal public queries. Only a valid Admin session can fetch the private rows.

The four original bundled public starter subjects are also seeded in Supabase: General Science, WBP/KP GK & Current Affairs, Mathematics, and Reasoning & General Intelligence. This keeps the original subject selector populated instead of showing only the first subject row.

Deletion is owner-checked on the server: only rows with the current Admin owner_id, source_type = admin_upload, and is_published = false can be deleted. The related bookmarks, mock-test question links, and individual question_attempts are removed by the database foreign-key cascades. Previously saved study_practice_sessions answer snapshots remain as historical test records.

## Database reset completed

All 13 existing MCQ rows were deleted from public.mcq_questions across all six Subjects, as requested. The six Subject records remain. Related bookmarks, question_attempts, and mock_test_questions rows were removed by foreign-key cascades. Theory Notes and Performance session rows were preserved. The MCQ subject_id column is now required for all future inserts.

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
- Exam_Prep_Local_Admin.html — one self-contained local Admin page; keep it on your phone and do not publish it.
- supabase-client.js — Supabase URL and publishable client configuration.
- supabase-question-store.js — public content, passcode RPC, and performance adapter.
- study-app-integration.js — Guest mode, private content loading, and performance history.
- question-store.js — older IndexedDB preview adapter, retained but not used by the connected pages.
- SUPABASE_INTEGRATION.md — schema and security notes.

## Important notes

- The passcode is six digits, so keep the rate limit active and do not share it. A longer passphrase would be safer.
- Question import has no application-level total-count cap; Supabase API request, row-size, and project limits still apply.
- The current Admin session is tied to the single existing row in study_admins; if you later add more Admins, review whether each should share this passcode system.
- Subject names can be changed from the local Admin ZIP. The internal slug and subject_id relationship stay unchanged, so existing questions remain attached to the same Subject.
- All local Admin actions still require an internet connection because Supabase is the shared cloud database.
- GitHub Pages deployment status still needs a live browser check after the latest commits.
