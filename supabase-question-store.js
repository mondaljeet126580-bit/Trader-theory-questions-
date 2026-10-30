(function (global) {
  "use strict";

  const SUBJECT_COLUMNS = "id,slug,name_bn,name_en,description,is_published,owner_id,sort_order";
  const QUESTION_COLUMNS = "id,subject,no,bn,en,options,correct,explanation,chapter_id,difficulty,topic,source_type,is_published,owner_id,created_at";

  function client() {
    if (!global.supabaseClient) throw new Error("Supabase client চালু হয়নি।");
    return global.supabaseClient;
  }

  async function requireUser() {
    const result = await client().auth.getUser();
    if (result.error || !result.data.user) {
      throw new Error("প্রথমে আপনার Supabase account দিয়ে লগইন করুন।");
    }
    return result.data.user;
  }

  async function fetchAll(table, columns, orderColumn) {
    const pageSize = 1000;
    let start = 0;
    const all = [];
    while (true) {
      const response = await client()
        .from(table)
        .select(columns)
        .order(orderColumn, { ascending: true })
        .range(start, start + pageSize - 1);

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

  function questionSubjectMatch(question, subjects) {
    const raw = String(question.subject || "").trim().toLowerCase();
    return subjects.find(function (subject) {
      return [subject.slug, subject.name_bn, subject.name_en]
        .filter(Boolean)
        .some(function (value) { return String(value).trim().toLowerCase() === raw; });
    });
  }

  async function load() {
    await requireUser();

    const subjects = await fetchAll("subjects", SUBJECT_COLUMNS, "id");
    const questions = await fetchAll("mcq_questions", QUESTION_COLUMNS, "id");

    const grouped = {};
    subjects.forEach(function (subject) { grouped[subject.slug] = []; });

    questions.forEach(function (row) {
      let subject = questionSubjectMatch(row, subjects);
      if (!subject && row.chapter_id) {
        // The app can still display a question if its legacy subject label differs
        // from the chapter's parent subject; do not silently discard it.
        subject = subjects.find(function (item) {
          return String(item.name_en || "").toLowerCase() === String(row.subject || "").toLowerCase();
        });
      }
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
        difficulty: row.difficulty,
        topic: row.topic,
        isPublished: row.is_published
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
          ownerId: subject.owner_id,
          isPublished: subject.is_published
        };
      }),
      questions: grouped
    };
  }

  async function listSubjects() {
    const response = await client()
      .from("subjects")
      .select(SUBJECT_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });
    if (response.error) throw response.error;
    return (response.data || []).map(function (subject) {
      return {
        id: subject.id,
        key: subject.slug,
        name: subjectLabel(subject),
        nameEn: subject.name_en || "",
        nameBn: subject.name_bn || "",
        ownerId: subject.owner_id,
        isPublished: subject.is_published
      };
    });
  }

  async function countQuestions(subjectKey) {
    const subjects = await listSubjects();
    const subject = subjects.find(function (item) { return item.key === subjectKey; });
    if (!subject) return 0;

    const label = subject.nameEn || subject.nameBn || subject.name;
    const response = await client()
      .from("mcq_questions")
      .select("id", { count: "exact", head: true })
      .eq("subject", label);
    if (response.error) throw response.error;
    return response.count || 0;
  }

  async function addSubject(key, name) {
    const user = await requireUser();
    const slug = String(key || "").trim();
    const cleanName = String(name || "").trim();
    if (!slug || !cleanName) throw new Error("বিষয়ের নাম দেওয়া আবশ্যক।");

    const response = await client()
      .from("subjects")
      .insert({
        slug: slug,
        name_bn: cleanName,
        name_en: cleanName,
        description: "Private study subject",
        sort_order: 999,
        is_published: false,
        owner_id: user.id
      })
      .select(SUBJECT_COLUMNS)
      .single();

    if (response.error) throw response.error;
    return { id: response.data.id, key: response.data.slug, name: subjectLabel(response.data) };
  }

  async function bulkAddQuestions(subjectKey, sourceQuestions) {
    const user = await requireUser();
    const subjects = await listSubjects();
    const subject = subjects.find(function (item) { return item.key === subjectKey; });
    if (!subject) throw new Error("নির্বাচিত বিষয়টি পাওয়া যায়নি।");
    if (!Array.isArray(sourceQuestions) || !sourceQuestions.length) {
      throw new Error("সংরক্ষণের মতো কোনো সঠিক প্রশ্ন পাওয়া যায়নি।");
    }

    const label = subject.nameEn || subject.nameBn || subject.name;
    const latest = await client()
      .from("mcq_questions")
      .select("no")
      .eq("subject", label)
      .order("no", { ascending: false })
      .limit(1);

    if (latest.error) throw latest.error;
    const firstNumber = Math.max(0, ...((latest.data || []).map(function (row) {
      return Number(row.no) || 0;
    }))) + 1;

    const rows = sourceQuestions.map(function (item, index) {
      return {
        subject: label,
        no: firstNumber + index,
        bn: item.bn,
        en: item.en || "",
        options: item.options,
        correct: item.correct,
        explanation: item.explanation || "",
        chapter_id: null,
        difficulty: "medium",
        topic: "",
        source_type: "admin_upload",
        is_published: false,
        owner_id: user.id
      };
    });

    const batchSize = 250;
    let saved = 0;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const response = await client()
        .from("mcq_questions")
        .insert(rows.slice(offset, offset + batchSize));
      if (response.error) {
        response.error.savedBeforeFailure = saved;
        throw response.error;
      }
      saved += Math.min(batchSize, rows.length - offset);
    }

    return { count: saved, firstNumber: firstNumber, lastNumber: firstNumber + saved - 1 };
  }

  async function savePerformance(input) {
    const user = await requireUser();
    const subjects = await listSubjects();
    const subject = subjects.find(function (item) { return item.key === input.subjectKey; });
    const response = await client()
      .from("study_practice_sessions")
      .insert({
        user_id: user.id,
        subject_id: subject ? subject.id : null,
        subject_name: input.subjectName || (subject && subject.name) || input.subjectKey,
        mode: input.mode || "mock",
        total_questions: input.totalQuestions,
        correct_count: input.correctCount,
        wrong_count: input.wrongCount,
        unanswered_count: input.unansweredCount,
        score: input.score,
        duration_seconds: input.durationSeconds || 0,
        started_at: input.startedAt || new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        answers: input.answers || []
      })
      .select("id")
      .single();

    if (response.error) throw response.error;
    return response.data;
  }

  async function listPerformance(limit) {
    const user = await requireUser();
    const [sessions, legacy] = await Promise.all([
      client().from("study_practice_sessions")
        .select("id,subject_name,mode,total_questions,correct_count,wrong_count,unanswered_count,score,duration_seconds,started_at,submitted_at,answers")
        .eq("user_id", user.id)
        .order("submitted_at", { ascending: false })
        .limit(limit || 50),
      client().from("question_attempts")
        .select("id,question_id,selected_answer,is_correct,context_type,attempted_at")
        .eq("user_id", user.id)
        .order("attempted_at", { ascending: false })
        .limit(50)
    ]);

    if (sessions.error) throw sessions.error;
    if (legacy.error) throw legacy.error;

    return {
      sessions: sessions.data || [],
      questionAttempts: legacy.data || []
    };
  }

  global.WBPQuestionStore = {
    provider: "supabase",
    load: load,
    addSubject: addSubject,
    bulkAddQuestions: bulkAddQuestions,
    listSubjects: listSubjects,
    countQuestions: countQuestions,
    savePerformance: savePerformance,
    listPerformance: listPerformance
  };
})(window);
