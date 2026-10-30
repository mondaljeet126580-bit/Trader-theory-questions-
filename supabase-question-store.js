(function (global) {
  "use strict";

  const TOKEN_KEY = "study_admin_session_token";
  const LOCAL_HISTORY_KEY = "study_local_performance_v1";

  function client() {
    if (!global.supabaseClient) throw new Error("Supabase client চালু হয়নি।");
    return global.supabaseClient;
  }

  function adminToken() {
    try { return global.sessionStorage.getItem(TOKEN_KEY) || ""; }
    catch (_) { return ""; }
  }

  async function fetchAll(table, columns, orderColumn, publishedOnly) {
    const pageSize = 1000;
    let start = 0;
    const all = [];
    while (true) {
      let query = client().from(table).select(columns).order(orderColumn, { ascending: true });
      if (publishedOnly) query = query.eq("is_published", true);
      const response = await query.range(start, start + pageSize - 1);
      if (response.error) throw response.error;
      const rows = response.data || [];
      all.push.apply(all, rows);
      if (rows.length < pageSize) break;
      start += pageSize;
    }
    return all;
  }

  function subjectLabel(subject) {
    return subject.name_bn || subject.name_en || subject.slug;
  }

  function matchSubject(question, subjects) {
    const raw = String(question.subject || "").trim().toLowerCase();
    return subjects.find(function (subject) {
      return [subject.slug, subject.name_bn, subject.name_en]
        .filter(Boolean)
        .some(function (value) { return String(value).trim().toLowerCase() === raw; });
    });
  }

  function normalizeRows(payload) {
    const subjects = Array.isArray(payload.subjects) ? payload.subjects : [];
    const rows = Array.isArray(payload.questions) ? payload.questions : [];
    const grouped = {};
    subjects.forEach(function (subject) { grouped[subject.slug] = []; });

    rows.forEach(function (row) {
      const subject = matchSubject(row, subjects);
      if (!subject) return;
      if (!grouped[subject.slug]) grouped[subject.slug] = [];

      grouped[subject.slug].push({
        id: row.id,
        no: row.no,
        bn: row.bn,
        en: row.en || "",
        options: row.options || {},
        correct: row.correct,
        explanation: row.explanation || "",
        difficulty: row.difficulty || "medium",
        topic: row.topic || "",
        isPublished: !!row.is_published,
        ownerId: row.owner_id || null,
        sourceType: row.source_type || "",
        createdAt: row.created_at || null
      });
    });

    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (a, b) { return (a.no || 0) - (b.no || 0); });
    });

    return {
      subjects: subjects.map(function (subject) {
        return {
          id: subject.id,
          key: subject.slug,
          name: subjectLabel(subject),
          nameEn: subject.name_en || "",
          nameBn: subject.name_bn || "",
          ownerId: subject.owner_id || null,
          isPublished: !!subject.is_published
        };
      }),
      questions: grouped
    };
  }

  async function load() {
    const token = adminToken();
    if (token) {
      const privateResult = await client().rpc("study_admin_load_content", {
        p_token: token
      });
      if (!privateResult.error && privateResult.data) return normalizeRows(privateResult.data);
      try { global.sessionStorage.removeItem(TOKEN_KEY); } catch (_) {}
    }

    const [subjects, questions] = await Promise.all([
      fetchAll("subjects", "id,slug,name_bn,name_en,description,is_published,owner_id,sort_order", "id", true),
      fetchAll("mcq_questions", "id,subject,no,bn,en,options,correct,explanation,chapter_id,difficulty,topic,source_type,is_published,owner_id,created_at", "id", true)
    ]);

    return normalizeRows({ subjects: subjects, questions: questions });
  }

  async function listSubjects() {
    const data = await load();
    return data.subjects;
  }

  async function countQuestions(subjectKey) {
    const token = adminToken();
    if (token) {
      const result = await client().rpc("study_admin_count_questions", {
        p_token: token,
        p_subject_slug: subjectKey
      });
      if (result.error) throw result.error;
      return Number(result.data) || 0;
    }

    const data = await load();
    return (data.questions[subjectKey] || []).length;
  }

  async function addSubject(key, name) {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে passcode দিয়ে unlock করুন।");

    const result = await client().rpc("study_admin_create_subject", {
      p_token: token,
      p_slug: String(key || "").trim(),
      p_name: String(name || "").trim()
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function bulkAddQuestions(subjectKey, sourceQuestions) {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে passcode দিয়ে unlock করুন।");
    if (!Array.isArray(sourceQuestions) || !sourceQuestions.length) {
      throw new Error("সংরক্ষণের মতো কোনো সঠিক প্রশ্ন পাওয়া যায়নি।");
    }

    let saved = 0;
    let firstNumber = null;
    let lastNumber = null;
    const batchSize = 250;

    for (let offset = 0; offset < sourceQuestions.length; offset += batchSize) {
      const batch = sourceQuestions.slice(offset, offset + batchSize);
      const result = await client().rpc("study_admin_bulk_add_questions", {
        p_token: token,
        p_subject_slug: subjectKey,
        p_questions: batch
      });
      if (result.error) {
        result.error.savedBeforeFailure = saved;
        throw result.error;
      }
      const info = result.data || {};
      if (firstNumber === null) firstNumber = Number(info.firstNumber);
      lastNumber = Number(info.lastNumber);
      saved += Number(info.count) || batch.length;
    }

    return { count: saved, firstNumber: firstNumber, lastNumber: lastNumber };
  }

  function readLocalHistory() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(LOCAL_HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  async function savePerformance(input) {
    const token = adminToken();
    const subjectData = await load();
    const subject = subjectData.subjects.find(function (item) {
      return item.key === input.subjectKey;
    });

    const payload = {
      subject_id: subject ? subject.id : null,
      subject_name: input.subjectName || (subject && subject.name) || input.subjectKey || "Study",
      mode: input.mode || "mock",
      total_questions: input.totalQuestions,
      correct_count: input.correctCount,
      wrong_count: input.wrongCount,
      unanswered_count: input.unansweredCount,
      score: input.score,
      duration_seconds: input.durationSeconds || 0,
      started_at: input.startedAt || new Date().toISOString(),
      answers: input.answers || []
    };

    if (token) {
      const result = await client().rpc("study_admin_save_performance", {
        p_token: token,
        p_session: payload
      });
      if (result.error) throw result.error;
      return result.data;
    }

    const history = readLocalHistory();
    const session = Object.assign({
      id: "local-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      submitted_at: new Date().toISOString()
    }, payload);
    history.unshift(session);
    global.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(history.slice(0, 500)));
    return session;
  }

  async function listMyQuestions(subjectKey) {
    const token = adminToken();
    if (!token) throw new Error("প্রথমে Admin Panel unlock করুন।");

    const result = await client().rpc("study_admin_list_my_questions", {
      p_token: token,
      p_subject_slug: subjectKey || null
    });
    if (result.error) throw result.error;
    return Array.isArray(result.data) ? result.data : [];
  }

  async function deleteQuestions(questionIds) {
    const token = adminToken();
    if (!token) throw new Error("প্রথমে Admin Panel unlock করুন।");
    if (!Array.isArray(questionIds) || !questionIds.length) {
      throw new Error("Delete করার জন্য প্রশ্ন নির্বাচন করুন।");
    }

    const result = await client().rpc("study_admin_delete_questions", {
      p_token: token,
      p_question_ids: questionIds.map(Number)
    });
    if (result.error) throw result.error;
    return result.data || { deletedCount: 0 };
  }

  async function listPerformance() {
    const token = adminToken();
    if (token) {
      const result = await client().rpc("study_admin_list_performance", {
        p_token: token
      });
      if (result.error) throw result.error;
      return {
        sessions: result.data && result.data.sessions || [],
        questionAttempts: result.data && result.data.questionAttempts || []
      };
    }
    return { sessions: readLocalHistory(), questionAttempts: [] };
  }

  global.WBPQuestionStore = {
    provider: "supabase-passcode-session",
    load: load,
    addSubject: addSubject,
    bulkAddQuestions: bulkAddQuestions,
    listSubjects: listSubjects,
    countQuestions: countQuestions,
    listMyQuestions: listMyQuestions,
    deleteQuestions: deleteQuestions,
    savePerformance: savePerformance,
    listPerformance: listPerformance
  };
})(window);
