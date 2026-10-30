(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  const supabase = function () { return window.supabaseClient; };

  App.currentUser = null;
  App.subjectIds = {};
  App.mockStartedAt = null;
  App.performanceSaving = false;

  function authMessage(text, isError) {
    const node = $("auth-message");
    node.textContent = text || "";
    node.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function showAuthGate(message) {
    $("auth-gate").classList.remove("hidden");
    $("auth-gate").style.display = "block";
    $("auth-password").value = "";
    $("app-session-bar").classList.add("hidden");
    document.querySelector(".app-container").classList.add("hidden");
    if (message) authMessage(message, false);
  }

  async function verifyCurrentUser() {
    const result = await supabase().auth.getUser();
    if (result.error) throw result.error;
    if (!result.data.user) throw new Error("তোমার Supabase session পাওয়া যায়নি।");
    return result.data.user;
  }

  App.init = async function () {
    $("auth-login-btn").addEventListener("click", () => this.signIn());
    $("app-logout-btn").addEventListener("click", () => this.signOut());

    ["auth-email", "auth-password"].forEach(id => {
      $(id).addEventListener("keydown", event => {
        if (event.key === "Enter") this.signIn();
      });
    });

    try {
      const sessionResult = await supabase().auth.getSession();
      if (sessionResult.error) throw sessionResult.error;
      if (!sessionResult.data.session) {
        showAuthGate("তোমার আগে থেকে থাকা Supabase User বা Admin account দিয়ে Sign in করো।");
        return;
      }

      const user = await verifyCurrentUser();
      await this.loadForSignedInUser(user);
    } catch (error) {
      console.error("Supabase authentication initialization failed.", error);
      showAuthGate("Supabase সংযোগ বা login যাচাই হয়নি: " + (error.message || String(error)));
    }
  };

  App.signIn = async function () {
    const button = $("auth-login-btn");
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    if (!email || !password) {
      authMessage("Email এবং password লিখুন।", true);
      return;
    }

    button.disabled = true;
    button.textContent = "Sign in হচ্ছে...";
    try {
      const response = await supabase().auth.signInWithPassword({
        email: email,
        password: password
      });
      if (response.error) throw response.error;
      const user = await verifyCurrentUser();
      await this.loadForSignedInUser(user);
    } catch (error) {
      authMessage("Sign in ব্যর্থ: " + (error.message || String(error)), true);
    } finally {
      button.disabled = false;
      button.textContent = "Sign in";
    }
  };

  App.signOut = async function () {
    const response = await supabase().auth.signOut();
    if (response.error) {
      authMessage("Sign out করা যায়নি: " + response.error.message, true);
      return;
    }
    this.currentUser = null;
    showAuthGate("Sign out হয়েছে।");
  };

  App.loadForSignedInUser = async function (user) {
    try {
      const data = await window.WBPQuestionStore.load();
      Object.keys(questionsDatabase).forEach(key => delete questionsDatabase[key]);

      this.subjectNames = {};
      this.subjectIds = {};
      data.subjects.forEach(subject => {
        questionsDatabase[subject.key] = data.questions[subject.key] || [];
        this.subjectNames[subject.key] = subject.name;
        this.subjectIds[subject.key] = subject.id;
      });

      const keys = Object.keys(questionsDatabase);
      if (!keys.includes(this.currentSubject)) this.currentSubject = keys[0] || "";
      this.configRange.from = 1;
      this.configRange.to = (questionsDatabase[this.currentSubject] || []).length || 1;
      this.configRange.specialFilter = null;

      this.currentUser = user;
      $("app-user-email").textContent = "Signed in: " + (user.email || "Supabase user");
      $("app-session-bar").classList.remove("hidden");
      $("auth-gate").classList.add("hidden");
      document.querySelector(".app-container").classList.remove("hidden");
      authMessage("", false);

      this.loadLocalStorageBuffers();
      if (!keys.includes(this.currentSubject)) this.currentSubject = keys[0] || "";
      this.renderSubjectTabs();
      this.syncMaxBounds();
      this.updateGeminiFloatingBar();
      this.goHome();

      if (!keys.length) {
        $("subject-tabs-container").textContent = "এখনও কোনো visible Subject নেই। Admin Panel থেকে private Subject তৈরি করুন।";
      }
    } catch (error) {
      console.error("Supabase data load failed.", error);
      showAuthGate("Database থেকে প্রশ্ন লোড হয়নি: " + (error.message || String(error)));
    }
  };

  const originalStartMockMode = App.startMockMode;
  App.startMockMode = function () {
    originalStartMockMode.call(this);
    if (!$("mock-view").classList.contains("hidden")) {
      this.mockStartedAt = new Date().toISOString();
      $("performance-save-status").textContent = "";
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

    $("performance-save-status").textContent = "এই Mock Test-এর ফলাফল Supabase-এ সংরক্ষণ হচ্ছে...";
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
      $("performance-save-status").textContent = "✓ তোমার Past Performance Supabase-এ সংরক্ষিত হয়েছে।";
    } catch (error) {
      console.error("Could not save practice performance.", error);
      $("performance-save-status").textContent =
        "ফলাফল এইবার cloud history-তে সংরক্ষণ করা যায়নি: " + (error.message || String(error));
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
      const status = answer.is_correct ? "সঠিক" : (answer.selected_answer ? "ভুল" : "স্কিপ");
      row.textContent = (answerIndex + 1) + ". " + (answer.question_bn || ("প্রশ্ন " + answer.question_no)) +
        " | তোমার উত্তর: " + (answer.selected_answer || "দেওয়া হয়নি") +
        " | সঠিক উত্তর: " + (answer.correct_answer || "—") + " | " + status;
      card.appendChild(row);
    });

    return card;
  }

  App.showPerformance = async function () {
    this.switchView("performance-view");
    $("performance-list").textContent = "তোমার history লোড হচ্ছে...";
    $("perf-legacy-note").textContent = "";

    try {
      const result = await window.WBPQuestionStore.listPerformance(100);
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

      $("perf-legacy-note").textContent = attempts.length
        ? "আগের question_attempts history-তে " + attempts.length + "টি individual answer record পাওয়া গেছে। নতুন test এখন থেকে পূর্ণ session হিসেবে সংরক্ষিত হবে।"
        : "এখনও পুরোনো individual answer record নেই।";

      const target = $("performance-list");
      target.innerHTML = "";
      if (!sessions.length) {
        const empty = document.createElement("div");
        empty.className = "glass-panel";
        empty.textContent = "এখনও কোনো Mock Test Supabase history-তে জমা হয়নি। নতুন Mock Test জমা দিলে তার ফলাফল এখানে দেখা যাবে।";
        target.appendChild(empty);
      } else {
        sessions.forEach(function (session, index) {
          target.appendChild(renderSessionCard(session, index));
        });
      }

      if (attempts.length) {
        const older = document.createElement("div");
        older.className = "glass-panel";
        older.textContent = "আগের individual question attempt: " + attempts.length + "টি (সঠিক " +
          attempts.filter(item => item.is_correct).length + "টি)।";
        target.appendChild(older);
      }
    } catch (error) {
      console.error("Performance history could not be loaded.", error);
      $("performance-list").textContent = "Performance history লোড হয়নি: " + (error.message || String(error));
    }
  };
})();
