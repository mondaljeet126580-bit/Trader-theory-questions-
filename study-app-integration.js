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

  App.startMixedMock = function (examType) {
    const configs = {
      wbp: {
        mode: "mixed_wbp",
        title: "WBP Constable Written — Mixed Mock",
        totalQuestions: 85,
        minutes: 60,
        negativeMarking: 0.25
      },
      kp: {
        mode: "mixed_kp",
        title: "Kolkata Police Preliminary — Mixed Mock",
        totalQuestions: 100,
        minutes: 60,
        negativeMarking: 0.25
      }
    };
    const config = configs[String(examType || "").toLowerCase()];
    if (!config) {
      alert("WBP অথবা KP Mixed Mock নির্বাচন করুন।");
      return;
    }

    const entries = Object.entries(questionsDatabase || {})
      .map(function (entry) {
        const key = entry[0];
        const rows = Array.isArray(entry[1]) ? entry[1] : [];
        const label = App.getSubjectDisplayName(key);
        const identity = (key + " " + label).toLowerCase();
        let category = "general";
        if (/math|গণিত/.test(identity)) category = "math";
        else if (/english|ইংরেজি/.test(identity)) category = "english";
        else if (/reason|logical|রিজনিং|যুক্তি/.test(identity)) category = "reasoning";

        return {
          key: key,
          name: label,
          category: category,
          rows: rows.slice().filter(function (q) {
            return q && q.options && q.correct && q.bn;
          }).sort(function () { return Math.random() - 0.5; })
        };
      })
      .filter(function (entry) { return entry.rows.length > 0; })
      .sort(function () { return Math.random() - 0.5; });

    const availableCount = entries.reduce(function (sum, entry) {
      return sum + entry.rows.length;
    }, 0);
    if (availableCount < config.totalQuestions) {
      alert("এই Mixed Mock-এর জন্য " + config.totalQuestions +
        "টি প্রশ্ন দরকার, কিন্তু বর্তমানে " + availableCount + "টি প্রশ্ন পাওয়া গেছে।");
      return;
    }

    const sectionPlan = examType === "wbp"
      ? { general: 25, english: 10, math: 25, reasoning: 25 }
      : { general: 40, math: 30, reasoning: 30 };

    function sampleRoundRobin(subjectEntries, requiredCount) {
      const source = subjectEntries.map(function (entry) {
        return { key: entry.key, name: entry.name, rows: entry.rows.slice() };
      }).sort(function () { return Math.random() - 0.5; });
      const chosen = [];
      let cursor = 0;

      while (chosen.length < requiredCount) {
        let added = false;
        for (let i = 0; i < source.length && chosen.length < requiredCount; i += 1) {
          const entry = source[(i + cursor) % source.length];
          if (!entry || !entry.rows.length) continue;
          const question = entry.rows.pop();
          chosen.push(Object.assign({}, question, {
            _subjectKey: entry.key,
            _subjectName: entry.name
          }));
          added = true;
        }
        if (!added) break;
        cursor += 1;
      }
      return chosen;
    }

    const exactSubjectSplitAvailable = Object.entries(sectionPlan).every(function (item) {
      const category = item[0];
      const required = item[1];
      const available = entries
        .filter(function (entry) { return entry.category === category; })
        .reduce(function (sum, entry) { return sum + entry.rows.length; }, 0);
      return available >= required;
    });

    let pool = [];
    if (exactSubjectSplitAvailable) {
      Object.entries(sectionPlan).forEach(function (item) {
        const category = item[0];
        const required = item[1];
        const chosen = sampleRoundRobin(
          entries.filter(function (entry) { return entry.category === category; }),
          required
        );
        pool = pool.concat(chosen);
      });
      pool.sort(function () { return Math.random() - 0.5; });
    } else {
      // Until all required section banks exist, fairly sample across every populated Subject.
      pool = sampleRoundRobin(entries, config.totalQuestions);
    }

    config.exactSubjectSplit = exactSubjectSplitAvailable;

    if (pool.length !== config.totalQuestions) {
      alert("প্রয়োজনীয় প্রশ্নসংখ্যা তৈরি করা যায়নি।");
      return;
    }

    this.mixedExamConfig = config;
    this.configRange.specialFilter = null;
    $("mock-size-select").value = String(config.totalQuestions);
    $("mock-timer-select").value = String(config.minutes);
    $("mock-target-select").value = "ALL";
    $("mock-order-select").value = "SHUFFLE";

    const oldGetActiveDataset = this.getActiveDataset;
    this.getActiveDataset = function () { return pool; };
    try {
      this.startMockMode();
    } finally {
      this.getActiveDataset = oldGetActiveDataset;
    }

    if ($("mock-view").classList.contains("hidden") ||
        !this.mockState.activePool ||
        this.mockState.activePool.length !== config.totalQuestions) {
      this.mixedExamConfig = null;
      alert("Mixed Mock শুরু করা যায়নি। আবার চেষ্টা করুন।");
      return;
    }
  };

  const originalSubmitMock = App.submitMock;
  App.submitMock = async function () {
    if (this.performanceSaving || !this.mockState.activePool.length) return;

    const examConfig = this.mixedExamConfig || null;
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
        subject_name: question._subjectName || this.getSubjectDisplayName(this.currentSubject),
        subject_key: question._subjectKey || this.currentSubject,
        en: question.en || "",
        options: question.options || {},
        explanation: question.explanation || "",
        selected_answer: selected,
        correct_answer: question.correct,
        is_correct: isCorrect
      };
    });

    const total = this.mockState.activePool.length;
    const negativeMarking = examConfig ? Number(examConfig.negativeMarking || 0.25) : 0;
    const negativeMarks = Number((wrong * negativeMarking).toFixed(2));
    const netMarks = Math.max(0, Number((correct - negativeMarks).toFixed(2)));
    const score = total ? Number(((netMarks / total) * 100).toFixed(2)) : 0;
    const durationSeconds = Math.max(0, Math.round((submittedAt - new Date(startedAt).getTime()) / 1000));
    const target = $("mock-target-select").value;
    const mode = examConfig
      ? examConfig.mode
      : (this.configRange.specialFilter === "BOOKMARK"
        ? "starred"
        : (target === "WRONG" ? "wrong" : "mock"));

    this.performanceSaving = true;
    originalSubmitMock.call(this);

    // Apply the official mixed-exam negative-marking score to the result screen.
    const resultFill = $("result-score-fill");
    if (resultFill) resultFill.style.width = score + "%";
    const orbitText = $("result-score-orbit-text");
    if (orbitText) orbitText.textContent = score.toFixed(0) + "%";
    $("result-percentage").textContent = score.toFixed(1) + "% নম্বর পেয়েছেন";
    $("modal-percentage").textContent = score.toFixed(1) + "% নম্বর পেয়েছেন";
    $("res-summary-line").textContent = examConfig
      ? "মোট প্রশ্ন: " + total + " | " + examConfig.title + " | 60 মিনিট" +
        (examConfig.exactSubjectSplit ? " | Official subject split" : " | Available-subject mixed fallback")
      : "মোট প্রশ্ন: " + total + " | নির্বাচিত বিষয়: " + this.getSubjectDisplayName(this.currentSubject);

    const negativeNote = $("result-negative-note");
    if (negativeNote) {
      if (examConfig) {
        negativeNote.classList.remove("hidden");
        negativeNote.textContent = "Negative marking: প্রতি ভুলে -" +
          negativeMarking.toFixed(2) + " · মোট penalty -" +
          negativeMarks.toFixed(2) + " · Net marks " + netMarks.toFixed(2) + "/" + total +
          (examConfig.exactSubjectSplit ? " · Official subject split" : " · Available Subject mix (Math/English bank incomplete)");
      } else {
        negativeNote.classList.add("hidden");
        negativeNote.textContent = "";
      }
    }

    const status = $("performance-save-status");
    if (status) status.textContent = "Performance history সংরক্ষণ হচ্ছে...";
    try {
      await window.WBPQuestionStore.savePerformance({
        subjectKey: examConfig ? null : this.currentSubject,
        subjectName: examConfig ? examConfig.title : this.getSubjectDisplayName(this.currentSubject),
        mode: mode,
        totalQuestions: total,
        correctCount: correct,
        wrongCount: wrong,
        unansweredCount: unanswered,
        score: score,
        negativeMarking: negativeMarking,
        negativeMarks: negativeMarks,
        netMarks: netMarks,
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
      this.mixedExamConfig = null;
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
      "Test Type: " + (isMixedPerformanceSession(session) ? (session.mode === "mixed_wbp" ? "WBP Mixed Mock" : "KP Mixed Mock") : "Sectional Mock Test"),
      "Subject / Exam: " + (session.subject_name || "Unknown"),
      "Date: " + formatDate(session.submitted_at),
      "Score: " + Number(session.score || 0).toFixed(1) + "%",
      "Total Questions: " + session.total_questions,
      "Correct: " + session.correct_count + " | Wrong: " + session.wrong_count + " | Skipped: " + session.unanswered_count,
      "Negative marking: -" + Number(session.negative_marking || 0).toFixed(2) + " per wrong answer | Total penalty: " + Number(session.negative_marks || 0).toFixed(2),
      "Net Marks: " + Number(session.net_marks || 0).toFixed(2),
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
      lines.push("Subject: " + (answer.subject_name || (linked && linked._subjectName) || session.subject_name || "Unknown"));
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

  let performanceHistoryFilter = "sectional";

  function isMixedPerformanceSession(session) {
    return String(session.mode || "").indexOf("mixed_") === 0;
  }

  function updateGeminiPerformanceToolbar() {
    const selectedCount = selectedPerformanceSessionIds.size;
    const status = $("gemini-performance-selection-status");
    const copyButton = $("copy-selected-performance");
    if (status) status.textContent = selectedCount + "টি Test নির্বাচন করা হয়েছে";
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
    checkbox.dataset.sessionId = String(session.id);
    checkbox.checked = selectedPerformanceSessionIds.has(String(session.id));
    checkbox.setAttribute("aria-label", "Select this mock test for Gemini");
    checkbox.addEventListener("change", function () {
      const id = String(session.id);
      if (checkbox.checked) {
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
    const testTypeLabel = isMixedPerformanceSession(session)
      ? (session.mode === "mixed_wbp" ? "WBP Mixed Mock" : "KP Mixed Mock")
      : (session.subject_name || "Sectional Mock Test");
    title.textContent = (index + 1) + ". " + testTypeLabel;
    titleBlock.appendChild(title);
    const date = document.createElement("div");
    date.className = "performance-session-date";
    date.textContent = formatDate(session.submitted_at) + " · " + (isMixedPerformanceSession(session) ? "MIXED MOCK" : "SECTIONAL MOCK");
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

    if (Number(session.negative_marking || 0) > 0) {
      const net = document.createElement("div");
      net.className = "performance-session-net";
      net.textContent = "Negative marking: -" + Number(session.negative_marking).toFixed(2) +
        " × ভুল " + Number(session.wrong_count || 0) + " = -" +
        Number(session.negative_marks || 0).toFixed(2) +
        " · Net marks: " + Number(session.net_marks || 0).toFixed(2);
      card.appendChild(net);
    }

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
      question.textContent = (answer.subject_name ? "[" + answer.subject_name + "] " : "") +
        "Q" + (answer.question_no || answerIndex + 1) + ". " +
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
    $("performance-list").textContent = "তোমার Mock Test History লোড হচ্ছে...";

    try {
      const result = await window.WBPQuestionStore.listPerformance();
      const sessions = result.sessions || [];
      const currentSessionIds = new Set(sessions.map(function (session) { return String(session.id); }));
      Array.from(selectedPerformanceSessionIds).forEach(function (id) {
        if (!currentSessionIds.has(id)) selectedPerformanceSessionIds.delete(id);
      });
      const attempts = result.questionAttempts || [];
      const sectionalSessions = sessions.filter(function (session) { return !isMixedPerformanceSession(session); });
      const mixedSessions = sessions.filter(isMixedPerformanceSession);
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
      $("sectional-history-count").textContent = sectionalSessions.length;
      $("mixed-history-count").textContent = mixedSessions.length;

      const target = $("performance-list");
      target.innerHTML = "";
      const modeNote = document.createElement("div");
      modeNote.className = "muted";
      modeNote.textContent = "সব Test Supabase-এ এই browser-এর history হিসেবে সংরক্ষিত।";
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
        empty.className = "performance-history-empty";
        empty.textContent = "এখনও কোনো Mock Test জমা হয়নি। Sectional অথবা Mixed Mock Test Submit করলে এখানে History জমা হবে।";
        target.appendChild(empty);
      } else {
        const questionIndex = performanceQuestionIndex();
        const renderHistoryList = function () {
          target.querySelectorAll(".performance-session-card").forEach(function (card) { card.remove(); });
          target.querySelectorAll(".performance-history-empty").forEach(function (card) { card.remove(); });

          const visibleSessions = performanceHistoryFilter === "mixed" ? mixedSessions : sectionalSessions;
          const visibleIds = new Set(visibleSessions.map(function (session) { return String(session.id); }));

          const tabSectional = $("history-tab-sectional");
          const tabMixed = $("history-tab-mixed");
          if (tabSectional) tabSectional.classList.toggle("active", performanceHistoryFilter === "sectional");
          if (tabMixed) tabMixed.classList.toggle("active", performanceHistoryFilter === "mixed");

          if (!visibleSessions.length) {
            const empty = document.createElement("div");
            empty.className = "performance-history-empty";
            empty.textContent = performanceHistoryFilter === "mixed"
              ? "এখনও কোনো WBP/KP Mixed Mock Test জমা হয়নি। Dashboard থেকে Mixed Mock Test শুরু করো।"
              : "এখনও কোনো Sectional Mock Test জমা হয়নি। কোনো Subject থেকে সাধারণ Mock Test Submit করো।";
            target.appendChild(empty);
          } else {
            visibleSessions.forEach(function (session) {
              const originalIndex = sessions.findIndex(function (item) { return String(item.id) === String(session.id); });
              target.appendChild(renderSessionCard(session, originalIndex, questionIndex));
            });
          }

          updateGeminiPerformanceToolbar();
        };

        const bindHistoryTab = function (id, value) {
          const button = $(id);
          if (button) button.onclick = function () {
            performanceHistoryFilter = value;
            renderHistoryList();
          };
        };
        bindHistoryTab("history-tab-sectional", "sectional");
        bindHistoryTab("history-tab-mixed", "mixed");

        $("copy-latest-performance").onclick = async function () {
          if (!sessions.length) return;
          await copyPerformanceText(
            buildSessionGeminiExport(sessions[0], 0, questionIndex),
            $("gemini-performance-copy-feedback")
          );
        };

        $("copy-selected-performance").onclick = async function () {
          const selected = sessions.filter(function (session) {
            return selectedPerformanceSessionIds.has(String(session.id));
          });
          if (!selected.length) return;
          const output = [
            "EXAM PREP — MULTIPLE MOCK TEST PERFORMANCE ANALYSIS",
            "You are my exam coach. Analyze all selected tests together. Identify repeated mistakes, weak subjects/topics, confusing concepts, recurring wrong options, and create a prioritized revision plan. Compare performance across tests and do not assume a reason for an error if the answer history does not show it.",
            "Selected tests: " + selected.length,
            ""
          ];
          selected.forEach(function (session, selectedIndex) {
            const originalIndex = sessions.findIndex(function (item) { return String(item.id) === String(session.id); });
            output.push(buildSessionGeminiExport(session, originalIndex, questionIndex));
            output.push("\n" + "=".repeat(48) + "\n");
          });
          await copyPerformanceText(output.join("\n"), $("gemini-performance-copy-feedback"));
        };

        $("select-all-performance").onclick = function () {
          sessions.forEach(function (session) {
            selectedPerformanceSessionIds.add(String(session.id));
          });
          renderHistoryList();
          $("gemini-performance-copy-feedback").textContent =
            sessions.length + "টি Test নির্বাচন করা হয়েছে। কোনো ২০টি Test-এর সীমা নেই।";
        };

        $("clear-performance-selection").onclick = function () {
          selectedPerformanceSessionIds.clear();
          renderHistoryList();
          $("gemini-performance-copy-feedback").textContent = "Selection Clear হয়েছে।";
        };

        renderHistoryList();
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
