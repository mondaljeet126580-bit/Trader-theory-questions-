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

  function consumeAdminSessionFromHash() {
    try {
      const rawHash = String(window.location.hash || "").replace(/^#/, "");
      if (!rawHash) return false;

      const pair = rawHash.split("&").find(function (part) {
        return part.split("=")[0] === "admin_session";
      });
      const token = pair ? decodeURIComponent(pair.slice(pair.indexOf("=") + 1)) : "";
      if (!/^[a-f0-9]{64}$/i.test(token)) return false;

      // The temporary bearer token is removed from the address bar immediately.
      localStorage.setItem(TOKEN_KEY, token);
      window.history.replaceState(
        window.history.state,
        document.title,
        window.location.pathname + window.location.search
      );
      return true;
    } catch (error) {
      console.error("Admin session handoff could not be stored.", error);
      return false;
    }
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
          ? "Admin session active — সব Subject ও Question লোড হয়েছে।"
          : "Public mode — সব Published Subject ও Question সবার জন্য দেখা যাচ্ছে।";
      }

      // If the user returns to Study Mode after visiting the Admin Panel,
      // redraw the current question list from the refreshed database.
      const readView = $("read-view");
      if (!settings.initial && readView && !readView.classList.contains("hidden")) {
        this.renderReadContainerList();
      }

      if (!keys.length && status) {
        status.textContent = "এখনও কোনো published Subject নেই। Local Admin ZIP থেকে Subject যোগ করে User App-এ access পাঠান।";
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
      // A local-only Admin Panel can pass its short-lived token in the URL
      // fragment. Save it to this User App origin and immediately clear it.
      consumeAdminSessionFromHash();

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

    // Populate the animated score summary on the result/review screen.
    const resultFill = $("result-score-fill");
    if (resultFill) resultFill.style.width = score + "%";
    const orbitText = $("result-score-orbit-text");
    if (orbitText) orbitText.textContent = score.toFixed(0) + "%";

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

      if (status) status.textContent = "✓ Mock Test Performance Supabase-এ সংরক্ষিত হয়েছে। My Performance-এ সব Submitted Test দেখা যাবে।";
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

  const selectedPerformanceSessionIds = new Set();

  function performanceQuestionIndex() {
    const index = {};
    Object.values(questionsDatabase || {}).forEach(function (rows) {
      (rows || []).forEach(function (question) {
        if (question && question.id != null) index[String(question.id)] = question;
      });
    });
    return index;
  }

  function optionText(options, key) {
    if (!key) return "দেওয়া হয়নি";
    return options && options[key] ? key + ") " + options[key] : key;
  }

  function buildSessionGeminiExport(session, index, questionIndex) {
    const answers = Array.isArray(session.answers) ? session.answers : [];
    const lines = [
      "EXAM PREP — MOCK TEST PERFORMANCE",
      "Test: " + (index + 1),
      "Subject: " + (session.subject_name || "Unknown"),
      "Date: " + formatDate(session.submitted_at),
      "Score: " + Number(session.score || 0).toFixed(1) + "%",
      "Total Questions: " + session.total_questions,
      "Correct: " + session.correct_count + " | Wrong: " + session.wrong_count + " | Skipped: " + session.unanswered_count,
      "Duration: " + (session.duration_seconds || 0) + " seconds",
      "",
      "ANSWER-BY-ANSWER REVIEW"
    ];

    answers.forEach(function (answer, answerIndex) {
      const linked = answer.question_id != null ? questionIndex[String(answer.question_id)] : null;
      const options = answer.options || (linked && linked.options) || {};
      const explanation = answer.explanation || (linked && linked.explanation) || "";
      const state = answer.is_correct ? "CORRECT" : (answer.selected_answer ? "WRONG" : "SKIPPED");
      lines.push("");
      lines.push("Q" + (answer.question_no || answerIndex + 1) + ": " + (answer.question_bn || (linked && (linked.bn || linked.question)) || "Question text unavailable"));
      if (answer.en || (linked && linked.en)) lines.push("English: " + (answer.en || linked.en));
      Object.keys(options).forEach(function (key) {
        lines.push(key + ") " + options[key]);
      });
      lines.push("Your answer: " + optionText(options, answer.selected_answer));
      lines.push("Correct answer: " + optionText(options, answer.correct_answer));
      lines.push("Result: " + state);
      if (explanation) lines.push("Explanation: " + explanation);
    });
    return lines.join("\n");
  }

  async function copyPerformanceText(text, feedbackElement) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      if (feedbackElement) feedbackElement.textContent = "✓ Gemini-তে Paste করার জন্য কপি হয়েছে।";
    } catch (_) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.focus();
      area.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch (error) {}
      area.remove();
      if (feedbackElement) feedbackElement.textContent = ok
        ? "✓ Gemini-তে Paste করার জন্য কপি হয়েছে।"
        : "কপি হয়নি। Browser clipboard permission চালু করুন।";
      if (!ok) throw new Error("Clipboard permission denied.");
    }
  }

  function updateGeminiPerformanceToolbar() {
    const selectedCount = selectedPerformanceSessionIds.size;
    const status = $("gemini-performance-selection-status");
    const copyButton = $("copy-selected-performance");
    if (status) status.textContent = selectedCount + " / 20টি Test নির্বাচন করা হয়েছে";
    if (copyButton) {
      copyButton.disabled = selectedCount === 0;
      copyButton.textContent = "✦ Selected Tests Copy (" + selectedCount + ")";
    }
  }

  function renderSessionCard(session, index, questionIndex) {
    const card = document.createElement("article");
    card.className = "performance-session-card";

    const head = document.createElement("div");
    head.className = "performance-session-head";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "performance-session-select";
    checkbox.checked = selectedPerformanceSessionIds.has(String(session.id));
    checkbox.setAttribute("aria-label", "Select this mock test for Gemini");
    checkbox.addEventListener("change", function () {
      const id = String(session.id);
      if (checkbox.checked) {
        if (!selectedPerformanceSessionIds.has(id) && selectedPerformanceSessionIds.size >= 20) {
          checkbox.checked = false;
          const feedback = $("gemini-performance-copy-feedback");
          if (feedback) feedback.textContent = "একসঙ্গে সর্বোচ্চ ২০টি Test নির্বাচন করতে পারবে।";
          return;
        }
        selectedPerformanceSessionIds.add(id);
      } else {
        selectedPerformanceSessionIds.delete(id);
      }
      updateGeminiPerformanceToolbar();
    });
    head.appendChild(checkbox);

    const titleBlock = document.createElement("div");
    titleBlock.style.flex = "1";
    const title = document.createElement("div");
    title.className = "performance-session-title";
    title.textContent = (index + 1) + ". " + (session.subject_name || "Mock Test");
    titleBlock.appendChild(title);
    const date = document.createElement("div");
    date.className = "performance-session-date";
    date.textContent = formatDate(session.submitted_at) + " · " + (session.mode || "mock").toUpperCase();
    titleBlock.appendChild(date);
    head.appendChild(titleBlock);

    const score = document.createElement("div");
    score.className = "performance-session-score";
    score.textContent = Number(session.score || 0).toFixed(1) + "%";
    head.appendChild(score);
    card.appendChild(head);

    const progress = document.createElement("div");
    progress.className = "performance-session-progress";
    const fill = document.createElement("span");
    fill.style.width = Math.max(0, Math.min(100, Number(session.score || 0))) + "%";
    progress.appendChild(fill);
    card.appendChild(progress);

    const metricGrid = document.createElement("div");
    metricGrid.className = "performance-session-metrics";
    [
      ["মোট", session.total_questions, ""],
      ["সঠিক", session.correct_count, "correct"],
      ["ভুল", session.wrong_count, "wrong"],
      ["স্কিপ", session.unanswered_count, "skipped"]
    ].forEach(function (item) {
      const metric = document.createElement("div");
      metric.className = "performance-metric " + item[2];
      const value = document.createElement("b");
      value.textContent = String(item[1] ?? 0);
      const label = document.createElement("span");
      label.textContent = item[0];
      metric.appendChild(value);
      metric.appendChild(label);
      metricGrid.appendChild(metric);
    });
    card.appendChild(metricGrid);

    const body = document.createElement("div");
    body.className = "performance-session-body";

    const answers = Array.isArray(session.answers) ? session.answers : [];
    const answerDetails = document.createElement("details");
    answerDetails.className = "performance-session-details";
    const answerSummary = document.createElement("summary");
    answerSummary.textContent = "📋 উত্তরপত্র ও বিস্তারিত বিশ্লেষণ দেখুন (" + answers.length + ")";
    answerDetails.appendChild(answerSummary);

    answers.forEach(function (answer, answerIndex) {
      const linked = answer.question_id != null ? questionIndex[String(answer.question_id)] : null;
      const options = answer.options || (linked && linked.options) || {};
      const explanation = answer.explanation || (linked && linked.explanation) || "";
      const state = answer.is_correct ? "correct" : (answer.selected_answer ? "wrong" : "skipped");
      const resultText = state === "correct" ? "সঠিক উত্তর" : (state === "wrong" ? "ভুল উত্তর" : "উত্তর দেওয়া হয়নি");

      const row = document.createElement("div");
      row.className = "performance-answer-card " + state;
      const question = document.createElement("div");
      question.className = "performance-answer-question";
      question.textContent = "Q" + (answer.question_no || answerIndex + 1) + ". " +
        (answer.question_bn || (linked && (linked.bn || linked.question)) || "Question text unavailable");
      row.appendChild(question);

      const meta = document.createElement("div");
      meta.className = "performance-answer-meta";
      meta.textContent = "তোমার উত্তর: " + optionText(options, answer.selected_answer) +
        " · সঠিক উত্তর: " + optionText(options, answer.correct_answer) +
        " · " + resultText;
      row.appendChild(meta);

      if (explanation) {
        const explain = document.createElement("div");
        explain.className = "performance-answer-explanation";
        explain.textContent = "💡 ব্যাখ্যা: " + explanation;
        row.appendChild(explain);
      }
      answerDetails.appendChild(row);
    });
    body.appendChild(answerDetails);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "performance-session-copy";
    copyButton.textContent = "✨ এই Test Gemini Analysis-এর জন্য Copy করুন";
    copyButton.addEventListener("click", async function () {
      await copyPerformanceText(buildSessionGeminiExport(session, index, questionIndex), $("gemini-performance-copy-feedback"));
    });
    body.appendChild(copyButton);

    card.appendChild(body);
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

      const summary = $("performance-view").querySelector(".performance-stat-grid");
      summary.innerHTML = "";
      [
        ["মোট Mock Test", String(sessions.length)],
        ["গড় নম্বর", average.toFixed(1) + "%"],
        ["সেরা নম্বর", best.toFixed(1) + "%"]
      ].forEach(function (item) {
        const stat = document.createElement("div");
        stat.className = "glass-panel performance-stat";
        const label = document.createElement("span");
        label.textContent = item[0];
        const value = document.createElement("strong");
        value.textContent = item[1];
        stat.appendChild(label);
        stat.appendChild(value);
        summary.appendChild(stat);
      });
      const countLabel = $("performance-list-count");
      if (countLabel) countLabel.textContent = sessions.length + " tests";

      const target = $("performance-list");
      target.innerHTML = "";
      const modeNote = document.createElement("div");
      modeNote.className = "muted";
      modeNote.textContent = "এই browser থেকে জমা দেওয়া Mock Test Supabase-এ সংরক্ষিত।";
      target.appendChild(modeNote);

      const keyButton = $("copy-mcp-performance-key");
      if (keyButton) {
        keyButton.onclick = async function () {
          const key = window.WBPQuestionStore.getPerformanceAccessKey();
          const display = $("mcp-performance-key");
          if (display) {
            display.textContent = key;
            display.classList.remove("hidden");
          }
          try {
            await navigator.clipboard.writeText(key);
            keyButton.textContent = "✓ MCP Access Key Copy হয়েছে";
          } catch (_) {
            keyButton.textContent = "নিচের Key কপি করুন";
          }
        };
      }

      if (!sessions.length && !attempts.length) {
        const empty = document.createElement("div");
        empty.className = "glass-panel";
        empty.textContent = "এই browser থেকে এখনও কোনো Mock Test submit করা হয়নি। নতুন Test submit করলে Supabase-এ সংরক্ষিত হবে।";
        target.appendChild(empty);
      } else {
        const questionIndex = performanceQuestionIndex();
        const sessionById = {};
        sessions.forEach(function (session) { sessionById[String(session.id)] = session; });
        sessions.forEach(function (session, index) {
          target.appendChild(renderSessionCard(session, index, questionIndex));
        });

        $("copy-latest-performance").onclick = async function () {
          if (!sessions.length) return;
          await copyPerformanceText(buildSessionGeminiExport(sessions[0], 0, questionIndex), $("gemini-performance-copy-feedback"));
        };

        $("copy-selected-performance").onclick = async function () {
          const selected = sessions.filter(function (session) {
            return selectedPerformanceSessionIds.has(String(session.id));
          }).slice(0, 20);
          if (!selected.length) return;
          const output = [
            "EXAM PREP — MULTIPLE MOCK TEST PERFORMANCE ANALYSIS",
            "You are my exam coach. Analyze these selected tests together. Identify repeated mistakes, weak subjects/topics, concepts I should revise, and give me a prioritized study plan.",
            "Selected tests: " + selected.length + " (maximum 20)",
            ""
          ];
          selected.forEach(function (session, selectedIndex) {
            const originalIndex = sessions.findIndex(function (item) { return String(item.id) === String(session.id); });
            output.push(buildSessionGeminiExport(session, originalIndex, questionIndex));
            output.push("\n" + "=".repeat(48) + "\n");
          });
          await copyPerformanceText(output.join("\n"), $("gemini-performance-copy-feedback"));
        };

        $("select-latest-20-performance").onclick = function () {
          selectedPerformanceSessionIds.clear();
          sessions.slice(0, 20).forEach(function (session) {
            selectedPerformanceSessionIds.add(String(session.id));
          });
          target.querySelectorAll(".performance-session-select").forEach(function (checkbox) {
            checkbox.checked = selectedPerformanceSessionIds.has(checkbox.closest(".performance-session-card")?.querySelector(".performance-session-select")?.dataset?.id);
          });
          // Checkbox IDs are attached below by renderSessionCard, so update by card order.
          target.querySelectorAll(".performance-session-select").forEach(function (checkbox, index) {
            checkbox.checked = index < 20;
          });
          updateGeminiPerformanceToolbar();
        };

        $("clear-performance-selection").onclick = function () {
          selectedPerformanceSessionIds.clear();
          target.querySelectorAll(".performance-session-select").forEach(function (checkbox) { checkbox.checked = false; });
          updateGeminiPerformanceToolbar();
          $("gemini-performance-copy-feedback").textContent = "Selection Clear হয়েছে।";
        };
        updateGeminiPerformanceToolbar();
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
