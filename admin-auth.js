(function () {
  "use strict";

  const TOKEN_KEY = "study_admin_session_token";
  const $ = function (id) { return document.getElementById(id); };
  let workspaceOpened = false;

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

      // Keep the temporary bearer token only in this browser tab, never the passcode.
      sessionStorage.setItem(TOKEN_KEY, token);
      $("admin-passcode").value = "";
      $("admin-login-panel").classList.add("hidden");
      $("admin-workspace").classList.remove("hidden");
      $("admin-session-label").textContent = "Admin Panel unlocked for this tab.";
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

  function lockAdmin() {
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
    workspaceOpened = false;
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
    try { existingToken = sessionStorage.getItem(TOKEN_KEY) || ""; } catch (_) {}
    if (existingToken) {
      $("admin-passcode").value = "";
      $("admin-passcode").placeholder = "এই tab-এ আগেই unlock করা আছে";
      message("এই tab-এর Admin session পাওয়া গেছে।", false);
      window.WBPAdmin.init().then(function () {
        $("admin-login-panel").classList.add("hidden");
        $("admin-workspace").classList.remove("hidden");
        $("admin-session-label").textContent = "Admin Panel unlocked for this tab.";
        workspaceOpened = true;
        $("admin-login-btn").textContent = "Admin unlocked";
      }).catch(function (error) {
        lockAdmin();
        message("Admin session শেষ হয়েছে: " + error.message, true);
      });
    } else {
      message("শুধু Admin passcode দিয়ে unlock করুন।", false);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
