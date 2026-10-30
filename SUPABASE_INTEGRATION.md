# Trade Theory Supabase integration — passcode-only Admin

## Scope

This integration uses only the Supabase project named Trader-theory-questions- (mtrnkalszadyzmanyxvx, region ap-south-1). No WhatsApp/chat tables or policies were changed.

## Main app

The main app no longer displays a Supabase email/password login form. It opens in Guest mode and reads only published rows through the existing RLS policies.

When the Admin Panel is unlocked in the same browser tab, a temporary Admin session token is held in sessionStorage. The main app can then request the published content plus the existing Admin owner's private subjects/questions. Closing the tab drops the token; the next Admin visit must unlock again.

## Admin access and token flow

1. The Admin Panel has one passcode field only. No account email or Supabase account password is requested.
2. The browser calls public.unlock_study_admin(p_passcode).
3. The database checks the passcode against the salted iterative hash held in the non-exposed app_private.study_admin_passcode table.
4. On success, a high-entropy random token is created. Only its SHA-256 hash is stored in app_private.study_admin_sessions. The browser receives the raw token and stores it in tab-scoped sessionStorage.
5. The token expires after four hours. Each Admin RPC validates the hash and expiry. The token is not stored in GitHub or included in source code.
6. Five failed passcode attempts from the same observed source/IP + user-agent fingerprint cause a 15-minute lockout.
7. The Admin UI's Lock action calls study_admin_lock_session(token) to revoke the server session, then removes the token from the current tab.

The unlock function uses the single existing row in public.study_admins to identify the Admin owner. It returns no token unless exactly one Study Admin is configured.

## Private content and RPC access

Admin RPCs are exposed to the Supabase Data API so they can be called from the static browser app. They are SECURITY DEFINER functions with an empty search path and explicit schema qualification. They require a valid unguessable session token and expiry before returning data or performing writes.

- study_admin_load_content(token): published content plus private content owned by the configured Admin.
- study_admin_create_subject(token, slug, name): creates a private subject owned by the configured Admin.
- study_admin_bulk_add_questions(token, subject_slug, questions): validates and inserts MCQs as private/unpublished.
- study_admin_count_questions(token, subject_slug): counts questions visible to that Admin session.
- study_admin_save_performance(token, session): saves a private performance session under the configured Admin owner.
- study_admin_list_performance(token): reads that owner's performance sessions and legacy question-attempt records.
- study_admin_lock_session(token): revokes the active token when the Admin locks the panel.

The session helper is located in app_private, not an exposed schema. Direct access to the app_private tables is revoked from anon/authenticated roles. The old Auth-based passcode verification RPC was revoked because the new Admin flow does not use it.

## Performance history

- Guest mode: local-only history in the current browser's localStorage; no account login is requested.
- Admin-unlocked tab: Supabase history is saved/fetched under the existing Study Admin owner.
- Existing rows in public.question_attempts for the Admin owner are included in the history display.

Local Guest history does not automatically sync to other browsers/devices. Cloud history is available when the Admin Panel has been unlocked in that tab.

## Existing schema changes already applied

- Added nullable owner_id columns to public.subjects and public.mcq_questions.
- New subjects default to unpublished/private.
- Public SELECT policies continue to return published content. The Admin passcode RPC returns only published rows plus rows owned by its configured Admin.
- Existing personal History question (id 16) remains assigned to the existing Admin owner and unpublished.
- Added public.study_practice_sessions with RLS on user-owned rows for existing authenticated workflows. The new Admin RPC writes/reads it through the verified passcode session.
- Added app_private.study_admin_sessions and app_private.study_admin_guest_attempts, both with RLS enabled and no anon/authenticated table grants.
- Added a salted iterative hash passcode verifier, short-lived tokens, and lockout tracking.
- No chat/WhatsApp database objects were changed.

## Security notes

- The browser contains only the Supabase publishable key.
- No service-role/secret key or raw Admin passcode is in this repository.
- The SECURITY DEFINER RPC functions are callable by anon because the main app has no account login. This is intentional: each function validates a random expiring Admin token before accessing private content. Keep the token unshared and maintain the rate limit.
- Supabase Security Advisor reports public SECURITY DEFINER RPCs callable by anon/authenticated. Those warnings correspond to the deliberate passcode-only gateway; token validation is enforced inside each function. The app_private storage tables themselves have no direct grants.
- A six-digit passcode has limited entropy; a longer passphrase is safer.
- Live browser QA of the complete GitHub Pages deployment is still required.

## Files

- index.html: public Guest-mode app.
- admin.html: single-passcode Admin screen.
- admin-auth.js: unlock/lock and tab-scoped token.
- supabase-client.js: Supabase URL + publishable key.
- supabase-question-store.js: public content and Admin RPC adapter.
- study-app-integration.js: app boot, private content when unlocked, and performance history.
