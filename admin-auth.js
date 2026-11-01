(function () {
  "use strict";

  const TOKEN_KEY = "study_admin_session_token";
  const $ = function (id) { return document.getElementById(id); };
  let workspaceOpened = false;
  const USER_APP_URL = "https://mondaljeet126580-bit.github.io/Trader-theory-questions/";

  function setUserAppLink(token) {
    const link = $("open-user-app-link");
    if (!link || !token) return;
    link.href = USER_APP_URL + "#admin_session=" + encodeURIComponent(token);
    link.classList.remove("hidden");
    link.setAttribute("aria-label", "Open the Exam Prep User App with temporary private access");
  }

  function hideUserAppLink() {
    const link = $("open-user-app-link");
    if (!link) return;
    link.classList.add("hidden");
    link.href = USER_APP_URL;
  }

  function message(text, error) {
    const target = $("admin-auth-message");
    target.textContent = text;
    target.style.color = error ? "#fca5a5" : "#86efac";
  }

  async function unlockAdmin() {
    const button = $("admin-login-btn");
    const passcode = $("admin-passcode").value;

    if (!passcode) {
      message("Admin passcode লিখুন।", true);
      return;
    }

    button.disabled = true;
    button.textContent = "যাচাই হচ্ছে...";

    try {
      const result = await window.supabaseClient.rpc("unlock_study_admin", {
        p_passcode: passcode
      });

      if (result.error) throw result.error;
      const token = result.data;
      if (typeof token !== "string" || token.length < 32) {
        $("admin-passcode").value = "";
        throw new Error("Passcode সঠিক নয় অথবা সাময়িক lock সক্রিয় হয়েছে।");
      }

      // Keep only the short-lived server token (never the passcode) so the
      // main app can read private questions after same-browser navigation.
      localStorage.setItem(TOKEN_KEY, token);
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
      setUserAppLink(token);
      $("admin-passcode").value = "";
      $("admin-login-panel").classList.add("hidden");
      $("admin-workspace").classList.remove("hidden");
      $("admin-session-label").textContent = "Admin Panel unlocked in this browser (expires in 4 hours).";
      workspaceOpened = true;

      await window.WBPAdmin.init();
      message("Admin Panel unlock হয়েছে।", false);
    } catch (error) {
      message("Admin access পাওয়া যায়নি: " + (error.message || String(error)), true);
      $("admin-passcode").value = "";
    } finally {
      button.disabled = false;
      button.textContent = workspaceOpened ? "Admin unlocked" : "Unlock Admin Panel";
    }
  }

  async function lockAdmin() {
    let token = "";
    try {
      token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {}

    if (token && window.supabaseClient) {
      try {
        await window.supabaseClient.rpc("study_admin_lock_session", {
          p_token: token
        });
      } catch (error) {
        console.warn("Admin session revoke request did not complete.", error);
      }
    }

    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (_) {}
    workspaceOpened = false;
    hideUserAppLink();
    $("admin-workspace").classList.add("hidden");
    $("admin-login-panel").classList.remove("hidden");
    $("admin-passcode").value = "";
    $("admin-login-btn").textContent = "Unlock Admin Panel";
    $("admin-login-btn").disabled = false;
    message("Admin Panel locked হয়েছে।", false);
  }

  function init() {
    $("admin-login-btn").addEventListener("click", unlockAdmin);
    $("admin-logout-btn").addEventListener("click", lockAdmin);
    $("admin-passcode").addEventListener("keydown", function (event) {
      if (event.key === "Enter") unlockAdmin();
    });

    let existingToken = "";
    try {
      existingToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (_) {}
    if (existingToken) {
      $("admin-passcode").value = "";
      $("admin-passcode").placeholder = "এই browser-এ Admin unlock করা আছে";
      message("এই browser-এর Admin session যাচাই হচ্ছে...", false);

      setUserAppLink(existingToken);
      window.supabaseClient.rpc("study_admin_load_content", { p_token: existingToken })
        .then(function (result) {
          if (result.error) throw result.error;
          return window.WBPAdmin.init();
        })
        .then(function () {
          $("admin-login-panel").classList.add("hidden");
          $("admin-workspace").classList.remove("hidden");
          $("admin-session-label").textContent = "Admin Panel unlocked in this browser (expires in 4 hours).";
          workspaceOpened = true;
          $("admin-login-btn").textContent = "Admin unlocked";
        })
        .catch(function (error) {
          lockAdmin().then(function () {
            message("Admin session শেষ হয়েছে: " + error.message, true);
          });
        });
    } else {
      message("শুধু Admin passcode দিয়ে unlock করুন।", false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
