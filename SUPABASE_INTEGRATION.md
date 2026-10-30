# Supabase connection plan (not connected yet)

## Current status

This document is a preparation note only.

- Supabase has not been accessed during this setup stage.
- No Supabase tables, rows, users, Auth settings, or Row Level Security (RLS) policies have been read or changed.
- No Supabase URL, anon key, service-role key, Admin password, or User password is stored in this repository.
- The Admin Panel currently uses the browser's IndexedDB only. It is not a secure, server-backed Admin area.

## Existing project must be inspected before integration

When the owner asks to connect Supabase, first inspect the existing project rather than assuming table names or creating a new schema.

1. Identify the existing subject and question tables, column names, primary keys, relationships, sort/order fields, and any existing views or RPCs.
2. Inspect the existing Supabase Auth users and determine how Admin versus regular User is represented. Preserve the existing accounts; do not create duplicate Admin or User accounts.
3. Check current RLS policies and grants before changing anything. Preserve working policies and avoid destructive schema changes.
4. Map the existing rows into the app's question shape:
   - \`bn\` / question text
   - optional \`en\`
   - \`options\`
   - \`correct\`
   - optional \`explanation\`
   - subject relationship and display name
5. Verify the Admin account's permissions with a real authenticated session. The browser must not decide that a person is Admin merely because a local flag, URL parameter, or JavaScript variable says so.

## Required security behavior

- Keep the user's existing Supabase Auth accounts.
- Use the existing trusted role source, such as a protected profile/roles table or trusted \`app_metadata\`, after inspecting the actual project.
- Enforce write permissions with RLS/database policies, not only by hiding buttons in HTML.
- Regular Users may read only what the existing app's intended access model permits.
- Only authenticated Admin users may create subjects or insert/update/delete questions.
- Use only the Supabase publishable/anon client key in browser code. Never expose a service-role key or database password in GitHub or client-side JavaScript.
- Keep sign-in credentials out of this repository.

## Storage adapter contract

The current UI talks to \`window.WBPQuestionStore\` in \`question-store.js\`. A future Supabase adapter should preserve these operations:

- \`load(seedData, seedNames)\` — retrieve subjects and question data for the app.
- \`listSubjects()\` — list subjects for the Admin selector.
- \`countQuestions(subjectKey)\` — count questions in a subject.
- \`addSubject(key, name)\` — create a subject after Admin authorization.
- \`bulkAddQuestions(subjectKey, questions)\` — insert a large import in controlled batches.

The future adapter should fetch all existing rows using pagination when needed. It should not assume that one response contains the complete question bank.

## Local data created during preview

Question imports made in \`admin.html\` are local to that browser's IndexedDB. They are not automatically uploaded to Supabase. When the cloud connection is authorized, compare local and remote data first, detect duplicates, and ask before any migration or bulk upload. Do not overwrite existing remote records automatically.
