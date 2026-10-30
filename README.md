# WBP & KP Exam MCQ Hub & Mock Simulator

A Bengali-first, single-file MCQ study and mock-test app for WBP/KP exam practice.

## Run the app

This project uses plain HTML, CSS, and JavaScript. There is no Node.js build step or package installation.

- Open \`index.html\` in a modern browser to run the study and mock-test app.
- Open \`admin.html\` to manage subjects and bulk-import questions in the local preview.
- To publish with GitHub Pages, open **Settings → Pages**, select deployment from the \`main\` branch and root folder, then save.

## Current features

- Subject tabs and subject-name search.
- Study mode with question explanations and page navigation.
- Mock tests with configurable question count, timer, and question order.
- Review of correct, wrong, and unanswered questions.
- Bookmarks and filters for previously wrong or skipped questions.
- Single and bulk prompts for Gemini.
- Separate Admin Panel for subject creation and bulk MCQ import.
- Text and JSON question import with validation and preview.
- Browser-local question bank stored in IndexedDB; existing progress settings stay in Local Storage.

## Admin Panel: bulk question format

From \`index.html\`, open **Admin Panel**, choose a subject, then paste multiple question blocks or upload a TXT/JSON file.

Example:

\`\`\`text
Q1: ভারতের রাজধানী কী?
English: What is the capital of India?
A) মুম্বাই
B) নয়াদিল্লি
C) কলকাতা
D) চেন্নাই
Answer: B
Explanation: নয়াদিল্লি ভারতের রাজধানী।

Q2: ২ + ২ = কত?
A) ২
B) ৩
C) ৪
D) ৫
উত্তর: C
ব্যাখ্যা: ২-এর সঙ্গে ২ যোগ করলে ৪ হয়।
\`\`\`

JSON arrays are also accepted. Each question must have question text, at least two options, and a correct answer matching one of the option keys. Question numbers are assigned automatically after the last saved number in that subject.

There is no application-defined question-count cap. Imports are written in batches. In local preview, the browser's available IndexedDB storage quota and device capacity still apply.

## Local preview and data persistence

The Admin Panel currently writes only to the current browser's IndexedDB. The main app reads that same local question bank on startup. Local additions do not sync to another browser, device, or visitor.

**The Admin Panel is not yet protected by Supabase authentication.** It is a local-only preview and must not be treated as a production-secure Admin area until the Supabase Auth role check and database policies have been connected.

## Supabase integration status

Supabase is intentionally not connected in this stage. No Supabase project, users, tables, rows, policies, or credentials have been read or changed.

The \`WBPQuestionStore\` interface in \`question-store.js\` separates question storage from the UI. The current implementation uses IndexedDB. A later Supabase implementation can provide the same operations while preserving the Admin Panel and study UI.

Before connecting, inspect the existing Supabase schema and Auth role setup, then map the app to the existing tables and existing Admin/User accounts. Do not create duplicate tables or copy credentials into GitHub. Never put a Supabase service-role key in browser code.

See [SUPABASE_INTEGRATION.md](SUPABASE_INTEGRATION.md) for the planned connection and access-control checks.

## Original sample question data

The starter questions are bundled in \`index.html\`. On the first app load, they are copied into IndexedDB. New questions added through the Admin Panel are stored alongside them.

## Repository files

- \`index.html\` — main app interface and study/mock-test logic.
- \`admin.html\` — Admin Panel UI (local preview).
- \`admin.js\` — bulk question parser, validation, preview, and subject controls.
- \`question-store.js\` — IndexedDB question repository adapter.
- \`README.md\` — setup and usage guide.
- \`SUPABASE_INTEGRATION.md\` — plan for connecting the existing Supabase project later.
