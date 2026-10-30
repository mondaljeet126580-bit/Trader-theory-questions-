(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  const TOKEN_KEY = "study_admin_session_token";

  App.currentUser = null;
  App.subjectIds = {};
  App.mockStartedAt = null;
  App.performanceSaving = false;

  function currentAdminToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || "";
    } catch (_) { return ""; }
  }

  App.lastLoadedAdminToken = null;
  App.questionRefreshInProgress = false;

  App.refreshQuestionData = async function (options) {
    const settings = options || {};
    if (this.questionRefreshInProgress) return;
    this.questionRefreshInProgress = true;

    const previousSubject = this.currentSubject;
    const previousCount = (questionsDatabase[previousSubject] || []).length;
    const previousRangeTo = Number(this.configRange.to) || previousCount;
    const wasFullRange = previousRangeTo >= previousCount || previousRangeTo === 100;
    const status = $("app-data-status");

    if (status && !settings.initial) {
      status.textContent = "Admin session অনুযায়ী প্রশ্ন ও Subject আবার লোড হচ্ছে...";
    }

    try {
      const data = await window.WBPQuestionStore.load();
      const freshDatabase = {};
      const freshNames = {};
      const freshIds = {};

      data.subjects.forEach(subject => {
        freshDatabase[subject.key] = data.questions[subject.key] || [];
        freshNames[subject.key] = subject.name;
        freshIds[subject.key] = subject.id;
      });

      Object.keys(questionsDatabase).forEach(key => delete questionsDatabase[key]);
      Object.keys(freshDatabase).forEach(key => {
        questionsDatabase[key] = freshDatabase[key];
      });

      this.subjectNames = freshNames;
      this.subjectIds = freshIds;

      const keys = Object.keys(questionsDatabase);
      this.currentSubject = keys.includes(previousSubject)
        ? previousSubject
        : (keys[0] || "");

      const currentCount = (questionsDatabase[this.currentSubject] || []).length;
      if (settings.initial) {
        this.configRange.from = 1;
        this.configRange.to = currentCount || 1;
        this.configRange.specialFilter = null;
      } else {
        this.configRange.from = Math.max(1, Math.min(
          Number(this.configRange.from) || 1,
          currentCount || 1
        ));
        this.configRange.to = wasFullRange
          ? (currentCount || 1)
          : Math.max(this.configRange.from, Math.min(previousRangeTo, currentCount || 1));
      }

      const searchInput = $("subject-search-input");
      this.renderSubjectTabs(searchInput ? searchInput.value : "");
      this.syncMaxBounds();
      this.updateGeminiFloatingBar();

      const title = $("dynamic-title");
      if (title && this.currentSubject) {
        title.textContent = this.getSubjectDisplayName(this.currentSubject) + " — WBP & KP Exam Hub";
      }

      const total = keys.reduce((sum, key) => sum + (questionsDatabase[key] || []).length, 0);
      const countNode = $("telemetry-total-count");
      if (countNode) countNode.textContent = total.toLocaleString("en-IN");

      const hasAdminAccess = !!currentAdminToken();
      this.lastLoadedAdminToken = currentAdminToken();

      if (status) {
        status.textContent = hasAdminAccess
          ? "Admin unlock active — তোমার private ও published প্রশ্ন লোড হয়েছে।"
          : "Guest mode — published প্রশ্ন দেখা যাচ্ছে। তোমার private প্রশ্ন দেখতে Admin Panel unlock করো।";
      }

      // If the user returns to Study Mode after visiting the Admin Panel,
      // redraw the current question list from the refreshed database.
      const readView = $("read-view");
      if (!settings.initial && readView && !readView.classList.contains("hidden")) {
        this.renderReadContainerList();
      }

      if (!keys.length && status) {
        status.textContent = "এখনও কোনো published Subject নেই। Admin Panel থেকে private Subject যোগ করে unlock করুন।";
      }

      return data;
    } catch (error) {
      console.error("Question data could not be refreshed.", error);
      if (status) {
        status.textContent = "Supabase থেকে প্রশ্ন লোড হয়নি: " + (error.message || String(error));
      }
      throw error;
    } finally {
      this.questionRefreshInProgress = false;
    }
  };

  App.init = async function () {
    try {
      // Load Supabase subjects/questions first so saved subject preferences
      // can be restored against the real current subject list.
      await this.refreshQuestionData({ initial: true });
      this.loadLocalStorageBuffers();

      const keys = Object.keys(questionsDatabase);
      if (!keys.includes(this.currentSubject)) this.currentSubject = keys[0] || "";

      const searchInput = $("subject-search-input");
      this.renderSubjectTabs(searchInput ? searchInput.value : "");
      this.syncMaxBounds();
      this.updateGeminiFloatingBar();
      this.goHome();
    } catch (error) {
      console.error("Initial question load failed.", error);
    }
  };

  // Returning from admin.html can restore this page from the browser's
  // back-forward cache. In that case DOMContentLoaded does not run again.
  // Refresh the question bank on BFCache restore and whenever the Admin
  // token changes while this page becomes active.
  async function refreshAfterAdminReturn(force) {
    const token = currentAdminToken();
    if (!force && token === App.lastLoadedAdminToken) return;
    try {
      await App.refreshQuestionData({ preserveView: true });
    } catch (error) {
      console.error("Could not refresh after returning from Admin Panel.", error);
    }
  }

  // Always refresh on return, even when the Admin token did not change:
  // questions may have been added/deleted or subjects modified in admin.html.
  window.addEventListener("pageshow", function () {
    refreshAfterAdminReturn(true);
  });

  window.addEventListener("focus", function () {
    refreshAfterAdminReturn(true);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      refreshAfterAdminReturn(true);
    }
  });

  // If Admin is opened in another tab, refresh this tab when its token changes.
  window.addEventListener("storage", function (event) {
    if (event.key === TOKEN_KEY) refreshAfterAdminReturn(true);
  });

  const originalStartMockMode = App.startMockMode;
  App.startMockMode = function () {
    originalStartMockMode.call(this);
    if (!$("mock-view").classList.contains("hidden")) {
      this.mockStartedAt = new Date().toISOString();
      const status = $("performance-save-status");
      if (status) status.textContent = "";
    }
  };

  const originalSubmitMock = App.submitMock;
  App.submitMock = async function () {
    if (this.performanceSaving || !this.mockState.activePool.length) return;

    const startedAt = this.mockStartedAt || new Date().toISOString();
    const submittedAt = Date.now();
    let correct = 0;
    let wrong = 0;
    let unanswered = 0;

    const answers = this.mockState.activePool.map((question, index) => {
      const selected = this.mockState.selections[index] || null;
      const isCorrect = !!selected && selected === question.correct;
      if (!selected) unanswered += 1;
      else if (isCorrect) correct += 1;
      else wrong += 1;

      return {
        question_id: question.id || null,
        question_no: question.no,
        question_bn: question.bn || question.question || "",
        options: question.options || {},
        selected_answer: selected,
        correct_answer: question.correct,
        is_correct: isCorrect
      };
    });

    const total = this.mockState.activePool.length;
    const score = total ? Number(((correct / total) * 100).toFixed(2)) : 0;
    const durationSeconds = Math.max(0, Math.round((submittedAt - new Date(startedAt).getTime()) / 1000));
    const target = $("mock-target-select").value;
    const mode = this.configRange.specialFilter === "BOOKMARK"
      ? "starred"
      : (target === "WRONG" ? "wrong" : "mock");

    this.performanceSaving = true;
    originalSubmitMock.call(this);

    const status = $("performance-save-status");
    if (status) status.textContent = "Performance history সংরক্ষণ হচ্ছে...";
    try {
      await window.WBPQuestionStore.savePerformance({
        subjectKey: this.currentSubject,
        subjectName: this.getSubjectDisplayName(this.currentSubject),
        mode: mode,
        totalQuestions: total,
        correctCount: correct,
        wrongCount: wrong,
        unansweredCount: unanswered,
        score: score,
        durationSeconds: durationSeconds,
        startedAt: startedAt,
        answers: answers
      });

      if (status) status.textContent = currentAdminToken()
        ? "✓ তোমার Performance Supabase-এ private ভাবে সংরক্ষিত হয়েছে।"
        : "✓ তোমার Performance এই browser-এ সংরক্ষিত হয়েছে। Admin unlock করলে cloud history-ও ব্যবহার হবে।";
    } catch (error) {
      console.error("Performance history could not be saved.", error);
      if (status) status.textContent = "Performance save হয়নি: " + (error.message || String(error));
    } finally {
      this.performanceSaving = false;
      this.mockStartedAt = null;
    }
  };

  function makeStat(value, label) {
    const box = document.createElement("div");
    box.className = "glass-panel";
    const title = document.createElement("div");
    title.className = "q-title";
    title.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    box.appendChild(title);
    box.appendChild(strong);
    return box;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "তারিখ পাওয়া যায়নি";
    return date.toLocaleString("bn-IN", { dateStyle: "medium", timeStyle: "short" });
  }

  function renderSessionCard(session, index) {
    const card = document.createElement("details");
    card.className = "performance-card";

    const summary = document.createElement("summary");
    summary.textContent = (index + 1) + ". " + session.subject_name + " — " + Number(session.score).toFixed(1) + "%";
    card.appendChild(summary);

    const date = document.createElement("div");
    date.className = "perf-date";
    date.textContent = formatDate(session.submitted_at);
    card.appendChild(date);

    const metrics = document.createElement("div");
    metrics.className = "perf-metrics";
    metrics.textContent =
      "মোট " + session.total_questions +
      " • সঠিক " + session.correct_count +
      " • ভুল " + session.wrong_count +
      " • স্কিপ " + session.unanswered_count +
      " • সময় " + Math.floor((session.duration_seconds || 0) / 60) + " মিনিট";
    card.appendChild(metrics);

    const mode = document.createElement("div");
    mode.className = "perf-date";
    mode.textContent = "Mode: " + (session.mode || "mock");
    card.appendChild(mode);

    (Array.isArray(session.answers) ? session.answers : []).forEach(function (answer, answerIndex) {
      const row = document.createElement("div");
      row.className = "performance-answer";
      const result = answer.is_correct ? "সঠিক" : (answer.selected_answer ? "ভুল" : "স্কিপ");
      row.textContent = (answerIndex + 1) + ". " + (answer.question_bn || ("প্রশ্ন " + answer.question_no)) +
        " | তোমার উত্তর: " + (answer.selected_answer || "দেওয়া হয়নি") +
        " | সঠিক উত্তর: " + (answer.correct_answer || "—") + " | " + result;
      card.appendChild(row);
    });

    return card;
  }

  App.showPerformance = async function () {
    this.switchView("performance-view");
    $("performance-list").textContent = "তোমার history লোড হচ্ছে...";

    try {
      const result = await window.WBPQuestionStore.listPerformance();
      const sessions = result.sessions || [];
      const attempts = result.questionAttempts || [];
      const average = sessions.length
        ? sessions.reduce((sum, item) => sum + Number(item.score || 0), 0) / sessions.length
        : 0;
      const best = sessions.length
        ? Math.max.apply(null, sessions.map(item => Number(item.score || 0)))
        : 0;

      const summary = $("performance-view").querySelector(".grid-3");
      summary.innerHTML = "";
      summary.appendChild(makeStat(String(sessions.length), "মোট Mock Test"));
      summary.appendChild(makeStat(average.toFixed(1) + "%", "গড় নম্বর"));
      summary.appendChild(makeStat(best.toFixed(1) + "%", "সেরা নম্বর"));

      const target = $("performance-list");
      target.innerHTML = "";
      const historyMode = currentAdminToken()
        ? "Supabase private history"
        : "এই browser-এর local history";
      const modeNote = document.createElement("div");
      modeNote.className = "muted";
      modeNote.textContent = "History source: " + historyMode;
      target.appendChild(modeNote);

      if (!sessions.length && !attempts.length) {
        const empty = document.createElement("div");
        empty.className = "glass-panel";
        empty.textContent = "এখনও কোনো Test জমা হয়নি। নতুন Mock Test জমা দিলে তার ফলাফল এখানে দেখা যাবে।";
        target.appendChild(empty);
      } else {
        sessions.forEach(function (session, index) {
          target.appendChild(renderSessionCard(session, index));
        });
      }

      if (attempts.length) {
        const heading = document.createElement("h3");
        heading.textContent = "আগের Individual Question History";
        target.appendChild(heading);

        attempts.forEach(function (attempt, index) {
          const card = document.createElement("article");
          card.className = "performance-card";

          const title = document.createElement("strong");
          title.textContent = (index + 1) + ". Question ID " + attempt.question_id +
            " — " + (attempt.is_correct ? "সঠিক" : "ভুল");
          card.appendChild(title);

          const detail = document.createElement("div");
          detail.className = "perf-metrics";
          detail.textContent = "তোমার উত্তর: " + (attempt.selected_answer || "দেওয়া হয়নি") +
            " • Context: " + (attempt.context_type || "practice");
          card.appendChild(detail);

          const date = document.createElement("div");
          date.className = "perf-date";
          date.textContent = formatDate(attempt.attempted_at);
          card.appendChild(date);
          target.appendChild(card);
        });
      }
    } catch (error) {
      console.error("Performance history could not be loaded.", error);
      $("performance-list").textContent = "Performance history লোড হয়নি: " + (error.message || String(error));
    }
  };
})();
