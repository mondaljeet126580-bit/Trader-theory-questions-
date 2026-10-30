(function () {
  "use strict";
  const SUPABASE_URL = "https://mtrnkalszadyzmanyxvx.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kmJy6L4HnacNPouMFK_sFg_ehINaQdC";

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error("Supabase JavaScript SDK লোড হয়নি। ইন্টারনেট সংযোগ পরীক্ষা করুন।");
  }

  window.supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      }
    }
  );
})();
