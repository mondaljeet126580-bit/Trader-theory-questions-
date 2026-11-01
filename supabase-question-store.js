(function (global) {
  "use strict";

  const TOKEN_KEY = "study_admin_session_token";
  const LOCAL_HISTORY_KEY = "study_local_performance_v1";

  function client() {
    if (!global.supabaseClient) throw new Error("Supabase client চালু হয়নি।");
    return global.supabaseClient;
  }

  function adminToken() {
    try { return global.localStorage.getItem(TOKEN_KEY) || ""; }
    catch (_) { return ""; }
  }

  function removeAdminToken() {
    try { global.localStorage.removeItem(TOKEN_KEY); } catch (_) {}
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
    // The numeric subject_id is the authoritative relationship.
    if (question.subject_id !== null && question.subject_id !== undefined) {
      const byId = subjects.find(function (subject) {
        return Number(subject.id) === Number(question.subject_id);
      });
      if (byId) return byId;
    }

    // Legacy fallback for older rows that have no subject_id.
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
        subjectId: row.subject_id || null,
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

      if (!privateResult.error && privateResult.data) {
        return normalizeRows(privateResult.data);
      }

      const errorMessage = privateResult.error && privateResult.error.message
        ? privateResult.error.message
        : "Admin private data response is empty.";

      if (/session expired|invalid.*session|admin session/i.test(errorMessage)) {
        removeAdminToken();
        // A genuinely expired/revoked token falls back to published Guest data.
      } else {
        // Do not silently hide private subjects when there is a network or RPC error.
        throw new Error("Private Subject load failed: " + errorMessage);
      }
    }

    const [subjects, questions] = await Promise.all([
      fetchAll("subjects", "id,slug,name_bn,name_en,description,is_published,owner_id,sort_order", "id", true),
      fetchAll("mcq_questions", "id,subject_id,subject,no,bn,en,options,correct,explanation,chapter_id,difficulty,topic,source_type,is_published,owner_id,created_at", "id", true)
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

  async function renameSubject(subjectSlug, newName) {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে passcode দিয়ে unlock করুন।");

    const result = await client().rpc("study_admin_rename_subject", {
      p_token: token,
      p_subject_slug: String(subjectSlug || "").trim(),
      p_new_name: String(newName || "").trim()
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

  const DEVICE_KEY_STORAGE = "exam_prep_mock_test_device_key";

  function createDeviceKey() {
    const bytes = new Uint8Array(32);
    global.crypto.getRandomValues(bytes);
    return Array.from(bytes).map(function (value) {
      return value.toString(16).padStart(2, "0");
    }).join("");
  }

  function getPerformanceAccessKey() {
    let key = "";
    try { key = global.localStorage.getItem(DEVICE_KEY_STORAGE) || ""; } catch (_) {}
    if (!/^[a-f0-9]{64}$/i.test(key)) {
      key = createDeviceKey();
      global.localStorage.setItem(DEVICE_KEY_STORAGE, key);
    }
    return key;
  }

  function readLocalHistory() {
    try {
      const parsed = JSON.parse(global.localStorage.getItem(LOCAL_HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function localSessionToPayload(session, subjectLookup) {
    const answers = Array.isArray(session.answers) ? session.answers : [];
    const subject = subjectLookup.find(function (item) {
      return item.key === session.subjectKey || item.name === session.subject_name;
    });
    return {
      client_session_id: String(session.id || ("legacy-" + Date.now() + "-" + Math.random().toString(36).slice(2))).slice(0, 120),
      subject_id: session.subject_id || (subject ? subject.id : null),
      subject_name: session.subjectName || session.subject_name || (subject && subject.name) || session.subjectKey || "Study",
      mode: session.mode || "mock",
      total_questions: Number(session.totalQuestions || session.total_questions || answers.length),
      correct_count: Number(session.correctCount ?? session.correct_count ?? 0),
      wrong_count: Number(session.wrongCount ?? session.wrong_count ?? 0),
      unanswered_count: Number(session.unansweredCount ?? session.unanswered_count ?? 0),
      score: Number(session.score || 0),
      duration_seconds: Number(session.durationSeconds ?? session.duration_seconds ?? 0),
      started_at: session.startedAt || session.started_at || session.submitted_at || new Date().toISOString(),
      submitted_at: session.submitted_at || new Date().toISOString(),
      answers: answers
    };
  }

  async function pushPerformanceToCloud(payload) {
    const result = await client().rpc("submit_study_mock_test", {
      p_device_key: getPerformanceAccessKey(),
      p_session: payload
    });
    if (result.error) throw result.error;
    return result.data;
  }

  async function migrateLocalHistory(subjects) {
    const history = readLocalHistory();
    if (!history.length) return 0;

    let migrated = 0;
    for (const session of history) {
      const payload = localSessionToPayload(session, subjects || []);
      if (!payload.total_questions || payload.answers.length !== payload.total_questions) continue;
      await pushPerformanceToCloud(payload);
      migrated += 1;
    }

    if (migrated === history.length) {
      try { global.localStorage.removeItem(LOCAL_HISTORY_KEY); } catch (_) {}
    } else if (migrated > 0) {
      const remaining = history.filter(function (session) {
        return session && session.id && !String(session.id).startsWith("local-migrated-");
      });
      try { global.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(remaining)); } catch (_) {}
    }
    return migrated;
  }

  async function savePerformance(input) {
    const subjectData = await load();
    const payload = {
      client_session_id: "mock-" + Date.now() + "-" + Math.random().toString(36).slice(2),
      subject_id: subjectData.subjects.find(function (item) {
        return item.key === input.subjectKey;
      })?.id || null,
      subject_name: input.subjectName || input.subjectKey || "Study",
      mode: input.mode || "mock",
      total_questions: Number(input.totalQuestions),
      correct_count: Number(input.correctCount),
      wrong_count: Number(input.wrongCount),
      unanswered_count: Number(input.unansweredCount),
      score: Number(input.score),
      duration_seconds: Number(input.durationSeconds || 0),
      started_at: input.startedAt || new Date().toISOString(),
      submitted_at: new Date().toISOString(),
      answers: input.answers || []
    };

    const legacy = readLocalHistory();
    const safeBackup = Object.assign({ id: payload.client_session_id }, payload);
    legacy.unshift(safeBackup);
    try { global.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(legacy.slice(0, 2000))); } catch (_) {}

    try {
      const result = await pushPerformanceToCloud(payload);
      try {
        const current = readLocalHistory().filter(function (row) {
          return row.id !== payload.client_session_id;
        });
        global.localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(current));
      } catch (_) {}
      return result;
    } catch (error) {
      error.localBackupSaved = true;
      throw error;
    }
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

    let deletedCount = 0;
    const batchSize = 500;
    const ids = questionIds.map(Number);

    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const result = await client().rpc("study_admin_delete_questions", {
        p_token: token,
        p_question_ids: ids.slice(offset, offset + batchSize)
      });
      if (result.error) {
        result.error.deletedBeforeFailure = deletedCount;
        throw result.error;
      }
      deletedCount += Number(result.data && result.data.deletedCount) || 0;
    }

    return { deletedCount: deletedCount };
  }

  async function clearAllQuestions() {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে unlock করুন।");
    const result = await client().rpc("study_admin_clear_all_questions", {
      p_token: token,
      p_confirmation: "DELETE ALL QUESTIONS"
    });
    if (result.error) throw result.error;
    return result.data || { deletedCount: 0 };
  }

  async function clearSubjectQuestions(subjectSlug) {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে unlock করুন।");
    const result = await client().rpc("study_admin_clear_subject_questions", {
      p_token: token,
      p_subject_slug: subjectSlug,
      p_confirmation: subjectSlug
    });
    if (result.error) throw result.error;
    return result.data || { deletedCount: 0 };
  }

  async function deleteSubject(subjectSlug) {
    const token = adminToken();
    if (!token) throw new Error("Admin Panel আগে unlock করুন।");
    const result = await client().rpc("study_admin_delete_subject", {
      p_token: token,
      p_subject_slug: subjectSlug,
      p_confirmation: subjectSlug
    });
    if (result.error) throw result.error;
    return result.data || { deletedQuestions: 0, deletedSubject: subjectSlug };
  }

  async function listPerformance() {
    const subjects = (await load()).subjects || [];
    await migrateLocalHistory(subjects);

    const limit = 500;
    let offset = 0;
    let sessions = [];
    let total = 0;

    while (true) {
      const result = await client().rpc("get_my_study_mock_tests", {
        p_device_key: getPerformanceAccessKey(),
        p_limit: limit,
        p_offset: offset
      });
      if (result.error) throw result.error;

      const rows = result.data && result.data.sessions || [];
      total = Number(result.data && result.data.total) || rows.length;
      sessions = sessions.concat(rows);
      if (rows.length < limit || sessions.length >= total) break;
      offset += limit;
    }

    return {
      sessions: sessions,
      questionAttempts: [],
      total: total
    };
  }

  global.WBPQuestionStore = {
    provider: "supabase-passcode-session",
    load: load,
    addSubject: addSubject,
    renameSubject: renameSubject,
    bulkAddQuestions: bulkAddQuestions,
    listSubjects: listSubjects,
    countQuestions: countQuestions,
    listMyQuestions: listMyQuestions,
    deleteQuestions: deleteQuestions,
    clearAllQuestions: clearAllQuestions,
    clearSubjectQuestions: clearSubjectQuestions,
    deleteSubject: deleteSubject,
    savePerformance: savePerformance,
    listPerformance: listPerformance,
    getPerformanceAccessKey: getPerformanceAccessKey
  };
})(window);
