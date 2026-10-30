(function () {
  "use strict";

  const $ = function (id) { return document.getElementById(id); };
  let lastValidQuestions = [];
  let lastErrors = [];
  let eventsInstalled = false;
  let uploadedQuestions = [];
  let selectedQuestionIds = new Set();

  function escapeHTML(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function setMessage(id, message, isError) {
    const el = $(id);
    if (!el) return;
    el.textContent = message;
    el.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function parseQuestionObject(source, index) {
    const item = source && typeof source === "object" ? source : {};
    const rawOptions = item.options || item.choices || {};
    const options = {};

    if (Array.isArray(rawOptions)) {
      rawOptions.forEach(function (value, optionIndex) {
        options[String.fromCharCode(65 + optionIndex)] = String(value == null ? "" : value).trim();
      });
    } else {
      Object.keys(rawOptions).forEach(function (key) {
        options[String(key).trim().toUpperCase()] = String(rawOptions[key] == null ? "" : rawOptions[key]).trim();
      });
    }

    const question = {
      bn: String(item.bn || item.question || item.text || item.q || item.prompt || "").trim(),
      en: String(item.en || item.english || "").trim(),
      options: options,
      correct: String(item.correct || item.answer || item.answerKey || item.correctAnswer || "").trim().toUpperCase(),
      explanation: String(item.explanation || item.reason || item.solution || "").trim()
    };

    const errors = [];
    if (!question.bn) errors.push("প্রশ্নের লেখা নেই");
    if (Object.keys(question.options).length < 2) errors.push("কমপক্ষে ২টি অপশন দরকার");
    if (!question.correct || !question.options[question.correct]) errors.push("সঠিক উত্তর options-এর সঙ্গে মেলেনি");
    Object.keys(question.options).forEach(function (key) {
      if (!question.options[key]) errors.push("Option " + key + " ফাঁকা");
    });

    return { question: question, errors: errors, sourceIndex: index };
  }

  function isQuestionStart(line) {
    return /^(?:(?:Q|Question)\s*(?:No\.?\s*)?#?\s*[0-9০-৯]*\s*[:.)-]|প্রশ্ন\s*(?:নং\s*)?[0-9০-৯]*\s*[:.)-]|[0-9০-৯]+\s*[.)])\s*/i.test(line.trim());
  }

  function isAnswerLine(line) {
    return /^(?:answer|ans|correct(?:\s+answer)?|উত্তর|সঠিক\s*উত্তর)\s*[:=.-]/i.test(line.trim());
  }

  function isExplanationLine(line) {
    return /^(?:explanation|ব্যাখ্যা|কারণ|সমাধান)\s*[:=.-]/i.test(line.trim());
  }

  function isEnglishLine(line) {
    return /^(?:english|en)\s*[:=.-]/i.test(line.trim());
  }

  function splitIntoBlocks(text) {
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const blocks = [];
    let current = [];

    function flush() {
      const cleaned = current.filter(function (line) { return line.trim() !== ""; });
      if (cleaned.length) blocks.push(cleaned);
      current = [];
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const trimmed = line.trim();

      if (/^(?:-{3,}|={3,}|\*{3,})$/.test(trimmed)) {
        flush();
        continue;
      }

      if (trimmed && isQuestionStart(trimmed) && current.some(function (part) { return part.trim(); })) {
        flush();
      }

      if (!trimmed && current.some(isAnswerLine)) {
        let lookAhead = "";
        for (let j = i + 1; j < lines.length; j += 1) {
          if (lines[j].trim()) { lookAhead = lines[j].trim(); break; }
        }
        if (lookAhead && !isExplanationLine(lookAhead) && !isEnglishLine(lookAhead)) {
          flush();
          continue;
        }
      }

      current.push(line);
    }

    flush();
    return blocks;
  }

  function parseTextBlock(lines, index) {
    const questionParts = [];
    const explanationParts = [];
    const options = {};
    let english = "";
    let answer = "";

    lines.forEach(function (originalLine, lineIndex) {
      const line = originalLine.trim();
      if (!line) return;

      const optionMatch = line.match(/^\(?([A-H])\)?\s*[\).:]\s*(.+)$/i);
      if (optionMatch) {
        options[optionMatch[1].toUpperCase()] = optionMatch[2].trim();
        return;
      }

      if (isAnswerLine(line)) {
        const answerMatch = line.match(/(?:answer|ans|correct(?:\s+answer)?|উত্তর|সঠিক\s*উত্তর)\s*[:=.-]\s*\(?([A-H])\)?/i);
        if (answerMatch) answer = answerMatch[1].toUpperCase();
        return;
      }

      if (isExplanationLine(line)) {
        explanationParts.push(line.replace(/^(?:explanation|ব্যাখ্যা|কারণ|সমাধান)\s*[:=.-]\s*/i, ""));
        return;
      }

      if (isEnglishLine(line)) {
        english = line.replace(/^(?:english|en)\s*[:=.-]\s*/i, "").trim();
        return;
      }

      let questionLine = line;
      if (lineIndex === 0) {
        questionLine = line.replace(/^(?:(?:Q|Question)\s*(?:No\.?\s*)?#?\s*[0-9০-৯]*|প্রশ্ন\s*(?:নং\s*)?[0-9০-৯]*|[0-9০-৯]+)\s*[:.)-]?\s*/i, "");
      }
      questionParts.push(questionLine);
    });

    const result = parseQuestionObject({
      bn: questionParts.join(" ").trim(),
      en: english,
      options: options,
      correct: answer,
      explanation: explanationParts.join(" ").trim()
    }, index);

    return result;
  }

  function parseBulkInput(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return { valid: [], errors: ["প্রশ্নের লেখা Paste করুন।"] };

    if (trimmed[0] === "[" || trimmed[0] === "{") {
      try {
        const decoded = JSON.parse(trimmed);
        const array = Array.isArray(decoded) ? decoded : (Array.isArray(decoded.questions) ? decoded.questions : [decoded]);
        const valid = [];
        const errors = [];
        array.forEach(function (item, index) {
          const parsed = parseQuestionObject(item, index + 1);
          if (parsed.errors.length) errors.push("প্রশ্ন " + (index + 1) + ": " + parsed.errors.join(", "));
          else valid.push(parsed.question);
        });
        return { valid: valid, errors: errors };
      } catch (error) {
        return { valid: [], errors: ["JSON পড়া যায়নি: " + error.message] };
      }
    }

    const blocks = splitIntoBlocks(trimmed);
    const valid = [];
    const errors = [];

    blocks.forEach(function (block, index) {
      const parsed = parseTextBlock(block, index + 1);
      if (parsed.errors.length) {
        errors.push("ব্লক " + (index + 1) + ": " + parsed.errors.join(", ") + " — " + block[0].slice(0, 70));
      } else {
        valid.push(parsed.question);
      }
    });

    return { valid: valid, errors: errors };
  }

  function generateSubjectKey(name, subjects) {
    let base = String(name).toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    if (!base) base = "custom_subject";
    if (!subjects.some(function (subject) { return subject.key === base; })) return base;

    let suffix = 2;
    while (subjects.some(function (subject) { return subject.key === base + "_" + suffix; })) suffix += 1;
    return base + "_" + suffix;
  }

  async function refreshSubjects(preferredKey) {
    const subjects = await WBPQuestionStore.listSubjects();
    const select = $("subject-select");
    const previous = preferredKey || select.value;
    select.innerHTML = "";

    subjects.forEach(function (subject) {
      const option = document.createElement("option");
      option.value = subject.key;
      option.textContent = subject.name;
      select.appendChild(option);
    });

    if (previous && subjects.some(function (subject) { return subject.key === previous; })) {
      select.value = previous;
    }

    await refreshSubjectCount();
    await refreshMyQuestions();
    return subjects;
  }

  async function refreshSubjectCount() {
    const key = $("subject-select").value;
    if (!key) {
      $("subject-count").textContent = "কোনো Subject পাওয়া যায়নি।";
      return;
    }
    const count = await WBPQuestionStore.countQuestions(key);
    $("subject-count").textContent = "এই Subject-এ বর্তমানে " + count + "টি প্রশ্ন সংরক্ষিত আছে।";
  }

  function updateDeleteControls() {
    const count = selectedQuestionIds.size;
    const button = $("delete-selected-questions-btn");
    button.disabled = count === 0;
    button.textContent = "🗑️ Selected Delete (" + count + ")";
    $("select-all-my-questions").checked =
      uploadedQuestions.length > 0 && count === uploadedQuestions.length;
  }

  function renderMyQuestions() {
    const target = $("my-questions-list");
    target.innerHTML = "";
    const summary = $("my-questions-summary");
    selectedQuestionIds.clear();

    if (!uploadedQuestions.length) {
      summary.textContent = "এই Subject-এ তোমার নিজের upload করা কোনো private প্রশ্ন নেই।";
      target.textContent = "তুমি নতুন প্রশ্ন Save করলে সেগুলি এখানে দেখা যাবে।";
      updateDeleteControls();
      return;
    }

    summary.textContent = "এই Subject-এ তোমার " +
      uploadedQuestions.length.toLocaleString("en-IN") +
      "টি private uploaded question আছে। এখানে থেকে একটি করে অথবা একাধিক নির্বাচন করে Delete করতে পারবে।";

    uploadedQuestions.forEach(function (question) {
      const card = document.createElement("article");
      card.className = "my-question-card";

      const head = document.createElement("div");
      head.className = "my-question-head";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "delete-question-check";
      checkbox.setAttribute("aria-label", "প্রশ্ন " + question.no + " নির্বাচন করুন");
      checkbox.addEventListener("change", function () {
        const id = String(question.id);
        if (checkbox.checked) selectedQuestionIds.add(id);
        else selectedQuestionIds.delete(id);
        updateDeleteControls();
      });

      const content = document.createElement("div");
      content.className = "my-question-text";
      content.textContent = "Q" + question.no + ". " + question.bn;

      const meta = document.createElement("div");
      meta.className = "my-question-meta";
      meta.textContent = "Database ID: " + question.id +
        (question.created_at ? " • Added: " + new Date(question.created_at).toLocaleDateString("bn-IN") : "");

      const textWrap = document.createElement("div");
      textWrap.style.flex = "1";
      textWrap.appendChild(content);
      textWrap.appendChild(meta);

      head.appendChild(checkbox);
      head.appendChild(textWrap);
      card.appendChild(head);

      const options = document.createElement("div");
      options.className = "my-question-options";
      options.textContent = Object.keys(question.options || {}).map(function (key) {
        return key + ") " + question.options[key];
      }).join("   •   ") + "\nসঠিক উত্তর: " + (question.correct || "—") +
        (question.explanation ? "\nব্যাখ্যা: " + question.explanation : "");
      card.appendChild(options);

      const actions = document.createElement("div");
      actions.className = "my-question-actions";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger";
      deleteButton.textContent = "🗑️ Delete this question";
      deleteButton.addEventListener("click", function () {
        deleteMyQuestions([question.id]);
      });
      actions.appendChild(deleteButton);
      card.appendChild(actions);
      target.appendChild(card);
    });

    updateDeleteControls();
  }

  async function refreshMyQuestions() {
    const subjectKey = $("subject-select").value;
    const target = $("my-questions-list");
    if (!subjectKey) {
      uploadedQuestions = [];
      renderMyQuestions();
      return;
    }

    target.textContent = "তোমার upload করা প্রশ্ন লোড হচ্ছে...";
    $("my-questions-summary").textContent = "Supabase থেকে নিজের প্রশ্ন আনা হচ্ছে...";
    try {
      uploadedQuestions = await WBPQuestionStore.listMyQuestions(subjectKey);
      renderMyQuestions();
    } catch (error) {
      uploadedQuestions = [];
      selectedQuestionIds.clear();
      target.textContent = "নিজের প্রশ্ন লোড করা যায়নি: " + error.message;
      $("my-questions-summary").textContent = "Admin session পরীক্ষা করুন অথবা Refresh চাপুন।";
      updateDeleteControls();
    }
  }

  async function deleteMyQuestions(questionIds) {
    const ids = (questionIds || []).map(Number).filter(Number.isFinite);
    if (!ids.length) return;
    const prompt = ids.length === 1
      ? "এই প্রশ্নটি Supabase থেকে স্থায়ীভাবে Delete করতে চাও? এটি আর Admin upload list-এ থাকবে না।"
      : "নির্বাচিত " + ids.length + "টি প্রশ্ন Supabase থেকে স্থায়ীভাবে Delete করতে চাও?";
    if (!window.confirm(prompt)) return;

    const button = $("delete-selected-questions-btn");
    button.disabled = true;
    try {
      const result = await WBPQuestionStore.deleteQuestions(ids);
      setMessage("subject-message",
        (result.deletedCount || 0).toLocaleString("en-IN") +
        "টি প্রশ্ন Supabase থেকে স্থায়ীভাবে Delete হয়েছে।");
      await refreshSubjectCount();
      await refreshMyQuestions();
    } catch (error) {
      const deletedBeforeFailure = Number(error.deletedBeforeFailure) || 0;
      if (deletedBeforeFailure > 0) {
        setMessage("subject-message",
          deletedBeforeFailure + "টি প্রশ্ন Delete হয়েছে, কিন্তু পরের batch ব্যর্থ হয়েছে: " + error.message,
          true);
        await refreshSubjectCount();
        await refreshMyQuestions();
      } else {
        setMessage("subject-message", "Delete করা যায়নি: " + error.message, true);
        button.disabled = false;
        updateDeleteControls();
      }
    }
  }

  function renderPreview(parsed) {
    lastValidQuestions = parsed.valid;
    lastErrors = parsed.errors;

    $("preview-panel").classList.remove("hidden");
    $("valid-count").textContent = parsed.valid.length.toLocaleString("en-IN");
    $("error-count").textContent = parsed.errors.length.toLocaleString("en-IN");
    $("option-count").textContent = parsed.valid.reduce(function (sum, question) {
      return sum + Object.keys(question.options).length;
    }, 0).toLocaleString("en-IN");

    $("parse-errors").textContent = parsed.errors.slice(0, 30).join("\n");
    if (parsed.errors.length > 30) {
      $("parse-errors").textContent += "\nআরও " + (parsed.errors.length - 30) + "টি সমস্যা আছে।";
    }

    const target = $("preview-list");
    target.innerHTML = "";
    parsed.valid.slice(0, 12).forEach(function (question, index) {
      const card = document.createElement("article");
      card.className = "preview-item";
      const title = document.createElement("strong");
      title.textContent = (index + 1) + ". " + question.bn;
      const details = document.createElement("p");
      details.textContent = Object.keys(question.options).map(function (key) {
        return key + ") " + question.options[key];
      }).join("   •   ") + "\nসঠিক উত্তর: " + question.correct +
        (question.explanation ? "\nব্যাখ্যা: " + question.explanation : "");
      card.appendChild(title);
      card.appendChild(details);
      target.appendChild(card);
    });

    if (parsed.valid.length > 12) {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent = "প্রথম ১২টি প্রশ্ন দেখানো হয়েছে। মোট সঠিক প্রশ্ন " + parsed.valid.length + "টি।";
      target.appendChild(note);
    }

    $("save-btn").disabled = parsed.valid.length === 0 || !$("subject-select").value;
  }

  async function addSubject() {
    const name = $("new-subject-name").value.trim();
    if (!name) {
      setMessage("subject-message", "Subject-এর নাম লিখুন।", true);
      return;
    }

    try {
      const subjects = await WBPQuestionStore.listSubjects();
      const key = generateSubjectKey(name, subjects);
      await WBPQuestionStore.addSubject(key, name);
      await refreshSubjects(key);
      $("new-subject-name").value = "";
      setMessage("subject-message", "Subject যোগ হয়েছে: " + name + " (" + key + ")");
    } catch (error) {
      setMessage("subject-message", "Subject যোগ করা যায়নি: " + error.message, true);
    }
  }

  async function saveQuestions() {
    const subjectKey = $("subject-select").value;
    if (!subjectKey || !lastValidQuestions.length) return;

    const button = $("save-btn");
    button.disabled = true;
    button.textContent = "সংরক্ষণ হচ্ছে...";

    try {
      const result = await WBPQuestionStore.bulkAddQuestions(subjectKey, lastValidQuestions);
      await refreshSubjectCount();
      await refreshMyQuestions();
      setMessage("subject-message",
        result.count.toLocaleString("en-IN") + "টি প্রশ্ন সংরক্ষিত হয়েছে। নম্বর " +
        result.firstNumber + " থেকে " + result.lastNumber + "।");
      button.textContent = "✓ সংরক্ষণ সম্পন্ন";
      lastValidQuestions = [];
      $("valid-count").textContent = "0";
      $("save-btn").disabled = true;
    } catch (error) {
      setMessage("subject-message", "সংরক্ষণ ব্যর্থ: " + error.message, true);
      button.textContent = "আবার চেষ্টা করুন";
      button.disabled = false;
    }
  }

  async function readSelectedFile(file) {
    if (!file) return;
    try {
      $("bulk-text").value = await file.text();
      renderPreview(parseBulkInput($("bulk-text").value));
    } catch (error) {
      setMessage("subject-message", "ফাইল পড়া যায়নি: " + error.message, true);
    }
  }

  function installEvents() {
    $("add-subject-btn").addEventListener("click", addSubject);
    $("subject-select").addEventListener("change", function () {
      refreshSubjectCount();
      refreshMyQuestions();
      $("save-btn").disabled = !lastValidQuestions.length;
    });
    $("refresh-my-questions-btn").addEventListener("click", refreshMyQuestions);
    $("select-all-my-questions").addEventListener("change", function () {
      const shouldSelect = this.checked;
      selectedQuestionIds.clear();
      const checkboxes = $("my-questions-list").querySelectorAll(".delete-question-check");
      checkboxes.forEach(function (checkbox, index) {
        checkbox.checked = shouldSelect;
        if (shouldSelect && uploadedQuestions[index]) {
          selectedQuestionIds.add(String(uploadedQuestions[index].id));
        }
      });
      updateDeleteControls();
    });
    $("delete-selected-questions-btn").addEventListener("click", function () {
      deleteMyQuestions(Array.from(selectedQuestionIds));
    });
    $("preview-btn").addEventListener("click", function () {
      renderPreview(parseBulkInput($("bulk-text").value));
    });
    $("save-btn").addEventListener("click", saveQuestions);
    $("clear-text-btn").addEventListener("click", function () {
      $("bulk-text").value = "";
      lastValidQuestions = [];
      lastErrors = [];
      $("preview-panel").classList.add("hidden");
    });
    $("load-format-btn").addEventListener("click", function () {
      $("bulk-text").value = [
        "Q1: ভারতের রাজধানী কী?",
        "English: What is the capital of India?",
        "A) মুম্বাই",
        "B) নয়াদিল্লি",
        "C) কলকাতা",
        "D) চেন্নাই",
        "Answer: B",
        "Explanation: নয়াদিল্লি ভারতের রাজধানী।",
        "",
        "Q2: ২ + ২ = কত?",
        "A) ২",
        "B) ৩",
        "C) ৪",
        "D) ৫",
        "উত্তর: C",
        "ব্যাখ্যা: ২-এর সঙ্গে ২ যোগ করলে ৪ হয়।"
      ].join("\n");
      renderPreview(parseBulkInput($("bulk-text").value));
    });
    $("load-json-btn").addEventListener("click", function () {
      $("bulk-text").value = JSON.stringify([
        {
          bn: "ভারতের রাজধানী কী?",
          en: "What is the capital of India?",
          options: { A: "মুম্বাই", B: "নয়াদিল্লি", C: "কলকাতা", D: "চেন্নাই" },
          correct: "B",
          explanation: "নয়াদিল্লি ভারতের রাজধানী।"
        },
        {
          bn: "২ + ২ = কত?",
          options: { A: "২", B: "৩", C: "৪", D: "৫" },
          correct: "C",
          explanation: "২-এর সঙ্গে ২ যোগ করলে ৪ হয়।"
        }
      ], null, 2);
      renderPreview(parseBulkInput($("bulk-text").value));
    });
    $("question-file").addEventListener("change", function (event) {
      readSelectedFile(event.target.files && event.target.files[0]);
    });
  }

  async function init() {
    if (!eventsInstalled) {
      installEvents();
      eventsInstalled = true;
    }
    try {
      await WBPQuestionStore.load();
      await refreshSubjects();
      setMessage("subject-message", "Supabase থেকে private ও published Subject লোড হয়েছে।");
    } catch (error) {
      setMessage("subject-message", "Question store চালু করা যায়নি: " + error.message, true);
      $("add-subject-btn").disabled = true;
      $("preview-btn").disabled = true;
    }
  }

  window.WBPAdminParser = Object.freeze({ parseBulkInput: parseBulkInput });
  window.WBPAdmin = Object.freeze({ init: init });
})();
