(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  let workspaceOpened = false;

  function message(text, error) {
    const target = $("admin-auth-message");
    target.textContent = text;
    target.style.color = error ? "#fca5a5" : "#86efac";
  }

  async function signInAndUnlock() {
    const button = $("admin-login-btn");
    const email = $("admin-email").value.trim();
    const password = $("admin-account-password").value;
    const passcode = $("admin-passcode").value;

    if (!email || !password || !passcode) {
      message("Email, Supabase password এবং Admin passcode—তিনটিই দিতে হবে।", true);
      return;
    }

    button.disabled = true;
    button.textContent = "যাচাই হচ্ছে...";

    try {
      const supabase = window.supabaseClient;
      if (!supabase) throw new Error("Supabase client চালু হয়নি।");

      const login = await supabase.auth.signInWithPassword({ email: email, password: password });
      if (login.error || !login.data.user) {
        throw new Error(login.error ? login.error.message : "Supabase sign-in ব্যর্থ হয়েছে।");
      }

      const verifiedUser = await supabase.auth.getUser();
      if (verifiedUser.error || !verifiedUser.data.user) {
        throw new Error("Supabase session যাচাই করা যায়নি।");
      }

      const admin = await supabase
        .from("study_admins")
        .select("user_id")
        .eq("user_id", verifiedUser.data.user.id)
        .maybeSingle();

      if (admin.error) throw admin.error;
      if (!admin.data) {
        throw new Error("এই account-এর study Admin permission নেই।");
      }

      const check = await supabase.rpc("verify_study_admin_passcode", {
        p_passcode: passcode
      });

      if (check.error) throw check.error;
      if (check.data !== true) {
        $("admin-passcode").value = "";
        throw new Error("Admin passcode সঠিক নয়, অথবা সাময়িক lock সক্রিয় হয়েছে।");
      }

      $("admin-account-password").value = "";
      $("admin-passcode").value = "";
      $("admin-login-panel").classList.add("hidden");
      $("admin-workspace").classList.remove("hidden");
      $("admin-session-label").textContent = "Admin হিসেবে signed in: " + verifiedUser.data.user.email;
      message("Admin permission যাচাই হয়েছে।", false);
      workspaceOpened = true;

      await window.WBPAdmin.init();
    } catch (error) {
      message("Admin access পাওয়া যায়নি: " + (error.message || String(error)), true);
    } finally {
      button.disabled = false;
      button.textContent = workspaceOpened ? "Admin unlocked" : "Sign in & unlock Admin";
    }
  }

  async function signOut() {
    try {
      await window.supabaseClient.auth.signOut();
    } finally {
      workspaceOpened = false;
      $("admin-workspace").classList.add("hidden");
      $("admin-login-panel").classList.remove("hidden");
      $("admin-account-password").value = "";
      $("admin-passcode").value = "";
      $("admin-login-btn").textContent = "Sign in & unlock Admin";
      $("admin-login-btn").disabled = false;
      message("Sign out হয়েছে।", false);
    }
  }

  function init() {
    $("admin-login-btn").addEventListener("click", signInAndUnlock);
    $("admin-logout-btn").addEventListener("click", signOut);

    ["admin-email", "admin-account-password", "admin-passcode"].forEach(function (id) {
      $(id).addEventListener("keydown", function (event) {
        if (event.key === "Enter") signInAndUnlock();
      });
    });

    window.supabaseClient.auth.getSession().then(function (result) {
      const session = result.data && result.data.session;
      if (session && session.user && session.user.email) {
        $("admin-email").value = session.user.email;
        message("Supabase session পাওয়া গেছে। Account password ও Admin passcode দিয়ে unlock করুন।", false);
      } else {
        message("তোমার বিদ্যমান Supabase Admin account দিয়ে sign in করো।", false);
      }
    }).catch(function (error) {
      message("Session পড়া যায়নি: " + error.message, true);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
