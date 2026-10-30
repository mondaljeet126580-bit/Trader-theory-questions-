(function (global) {
  "use strict";

  const DB_NAME = "wbp-kp-question-bank";
  const DB_VERSION = 1;
  const BATCH_SIZE = 250;

  const BUILTIN_SUBJECTS = [
    { key: "general_science", name: "সাধারণ বিজ্ঞান (Science)" },
    { key: "wbp_kp_gk", name: "জিকে ও কারেন্ট অ্যাফেয়ার্স (GK & CA)" },
    { key: "mathematics", name: "গণিত (Mathematics)" },
    { key: "reasoning", name: "রিজনিং ও জিআই (Reasoning)" }
  ];

  let databasePromise;

  function openDatabase() {
    if (!global.indexedDB) {
      return Promise.reject(new Error("এই ব্রাউজারে IndexedDB সমর্থিত নয়।"));
    }
    if (databasePromise) return databasePromise;

    databasePromise = new Promise(function (resolve, reject) {
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains("subjects")) {
          db.createObjectStore("subjects", { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains("questions")) {
          const questions = db.createObjectStore("questions", { keyPath: "id" });
          questions.createIndex("bySubject", "subjectKey", { unique: false });
          questions.createIndex("bySubjectAndNumber", ["subjectKey", "no"], { unique: true });
        }
      };

      request.onsuccess = function () {
        const db = request.result;
        db.onversionchange = function () {
          db.close();
          databasePromise = null;
        };
        resolve(db);
      };
      request.onerror = function () {
        databasePromise = null;
        reject(request.error || new Error("ডেটাবেস খোলা যায়নি।"));
      };
      request.onblocked = function () {
        reject(new Error("অন্য একটি ট্যাব ডেটাবেস আপগ্রেড আটকে রেখেছে। অন্য ট্যাব বন্ধ করে আবার চেষ্টা করুন।"));
      };
    });

    return databasePromise;
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error("ডেটাবেস রিকোয়েস্ট ব্যর্থ হয়েছে।")); };
    });
  }

  function transactionDone(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onabort = transaction.onerror = function () {
        reject(transaction.error || new Error("ডেটাবেসে সংরক্ষণ করা যায়নি।"));
      };
    });
  }

  async function readAll(storeName) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, "readonly");
    const resultPromise = requestResult(tx.objectStore(storeName).getAll());
    const donePromise = transactionDone(tx);
    const results = await resultPromise;
    await donePromise;
    return results;
  }

  async function readOne(storeName, key) {
    const db = await openDatabase();
    const tx = db.transaction(storeName, "readonly");
    const resultPromise = requestResult(tx.objectStore(storeName).get(key));
    const donePromise = transactionDone(tx);
    const result = await resultPromise;
    await donePromise;
    return result;
  }

  async function writeSetup(subjects, questions) {
    if (!subjects.length && !questions.length) return;
    const db = await openDatabase();
    const tx = db.transaction(["subjects", "questions"], "readwrite");
    const subjectStore = tx.objectStore("subjects");
    const questionStore = tx.objectStore("questions");

    subjects.forEach(function (subject) { subjectStore.put(subject); });
    questions.forEach(function (question) { questionStore.put(question); });

    await transactionDone(tx);
  }

  function normalizeQuestion(subjectKey, no, source) {
    const options = {};
    Object.keys(source.options || {}).forEach(function (key) {
      const optionKey = String(key).trim().toUpperCase();
      if (optionKey) options[optionKey] = String(source.options[key] == null ? "" : source.options[key]).trim();
    });

    return {
      id: subjectKey + "::" + no,
      subjectKey: subjectKey,
      no: no,
      bn: String(source.bn || source.question || source.text || "").trim(),
      en: String(source.en || "").trim(),
      options: options,
      correct: String(source.correct || source.answer || "").trim().toUpperCase(),
      explanation: String(source.explanation || "").trim(),
      createdAt: source.createdAt || new Date().toISOString()
    };
  }

  async function load(seedData, seedNames) {
    const data = seedData || {};
    const names = seedNames || {};
    const existingSubjects = await readAll("subjects");
    const existingQuestions = await readAll("questions");
    const subjectMap = new Map(existingSubjects.map(function (item) { return [item.key, item]; }));
    const questionsBySubject = new Map();

    existingQuestions.forEach(function (question) {
      if (!questionsBySubject.has(question.subjectKey)) questionsBySubject.set(question.subjectKey, []);
      questionsBySubject.get(question.subjectKey).push(question);
    });

    const subjectsToWrite = [];
    const questionsToWrite = [];
    const subjectSeeds = new Map();

    BUILTIN_SUBJECTS.forEach(function (item) { subjectSeeds.set(item.key, item.name); });
    Object.keys(data).forEach(function (key) {
      subjectSeeds.set(key, names[key] || subjectSeeds.get(key) || key.replace(/_/g, " "));
    });

    subjectSeeds.forEach(function (name, key) {
      let subject = subjectMap.get(key);
      if (!subject) {
        subject = {
          key: key,
          name: name,
          createdAt: new Date().toISOString(),
          seeded: false
        };
        subjectMap.set(key, subject);
        subjectsToWrite.push(subject);
      } else if (names[key] && subject.name !== names[key]) {
        subject.name = names[key];
        subjectsToWrite.push(subject);
      }

      if (Object.prototype.hasOwnProperty.call(data, key) && !subject.seeded) {
        const alreadySaved = questionsBySubject.get(key) || [];
        let nextNo = alreadySaved.reduce(function (max, item) {
          return Math.max(max, Number(item.no) || 0);
        }, 0) + 1;

        (Array.isArray(data[key]) ? data[key] : []).forEach(function (question) {
          const row = normalizeQuestion(key, nextNo, question);
          questionsToWrite.push(row);
          nextNo += 1;
        });

        subject.seeded = true;
        subjectsToWrite.push(subject);
      }
    });

    await writeSetup(subjectsToWrite, questionsToWrite);

    const allSubjects = await readAll("subjects");
    const allQuestions = await readAll("questions");
    const grouped = {};
    allSubjects.forEach(function (subject) { grouped[subject.key] = []; });
    allQuestions.forEach(function (question) {
      if (!grouped[question.subjectKey]) grouped[question.subjectKey] = [];
      grouped[question.subjectKey].push({
        no: question.no,
        bn: question.bn,
        en: question.en,
        options: question.options,
        correct: question.correct,
        explanation: question.explanation
      });
    });
    Object.keys(grouped).forEach(function (key) {
      grouped[key].sort(function (a, b) { return a.no - b.no; });
    });

    return {
      subjects: allSubjects.sort(function (a, b) { return a.name.localeCompare(b.name, "bn"); }),
      questions: grouped
    };
  }

  async function addSubject(key, name) {
    const cleanKey = String(key || "").trim();
    const cleanName = String(name || "").trim();
    if (!cleanKey || !cleanName) throw new Error("বিষয়ের নাম দেওয়া আবশ্যক।");

    const db = await openDatabase();
    const tx = db.transaction("subjects", "readwrite");
    const store = tx.objectStore("subjects");
    store.add({
      key: cleanKey,
      name: cleanName,
      createdAt: new Date().toISOString(),
      seeded: true
    });
    await transactionDone(tx);
    return { key: cleanKey, name: cleanName };
  }

  async function bulkAddQuestions(subjectKey, sourceQuestions) {
    const key = String(subjectKey || "").trim();
    if (!key) throw new Error("প্রথমে একটি বিষয় নির্বাচন করুন।");
    if (!Array.isArray(sourceQuestions) || !sourceQuestions.length) {
      throw new Error("সংরক্ষণের মতো কোনো সঠিক প্রশ্ন পাওয়া যায়নি।");
    }

    const db = await openDatabase();
    const subject = await readOne("subjects", key);
    if (!subject) throw new Error("নির্বাচিত Subject পাওয়া যায়নি।");

    const readTx = db.transaction("questions", "readonly");
    const existingRequest = readTx.objectStore("questions").index("bySubject").getAll(key);
    const existingPromise = requestResult(existingRequest);
    const readDone = transactionDone(readTx);
    const existing = await existingPromise;
    await readDone;

    let nextNo = existing.reduce(function (max, item) {
      return Math.max(max, Number(item.no) || 0);
    }, 0) + 1;

    const firstNumber = nextNo;
    const preparedRows = sourceQuestions.map(function (source, index) {
      const row = normalizeQuestion(key, nextNo + index, source);
      if (!row.bn || Object.keys(row.options).length < 2 || !row.correct || !row.options[row.correct]) {
        throw new Error("প্রশ্ন " + (index + 1) + " সংরক্ষণের উপযোগী নয়: প্রশ্ন, অন্তত ২টি অপশন এবং সঠিক উত্তর আবশ্যক।");
      }
      return row;
    });

    let savedCount = 0;
    for (let offset = 0; offset < preparedRows.length; offset += BATCH_SIZE) {
      const chunk = preparedRows.slice(offset, offset + BATCH_SIZE);
      const tx = db.transaction("questions", "readwrite");
      const store = tx.objectStore("questions");
      chunk.forEach(function (row) {
        store.add(row);
        savedCount += 1;
      });
      try {
        await transactionDone(tx);
      } catch (error) {
        error.savedCountBeforeFailure = savedCount - chunk.length;
        throw error;
      }
    }

    subject.lastUpdatedAt = new Date().toISOString();
    const subjectTx = db.transaction("subjects", "readwrite");
    subjectTx.objectStore("subjects").put(subject);
    await transactionDone(subjectTx);

    return { count: savedCount, firstNumber: firstNumber, lastNumber: firstNumber + savedCount - 1 };
  }

  async function listSubjects() {
    return (await readAll("subjects")).sort(function (a, b) {
      return a.name.localeCompare(b.name, "bn");
    });
  }

  async function countQuestions(subjectKey) {
    const db = await openDatabase();
    const tx = db.transaction("questions", "readonly");
    const request = tx.objectStore("questions").index("bySubject").count(String(subjectKey));
    const resultPromise = requestResult(request);
    const donePromise = transactionDone(tx);
    const count = await resultPromise;
    await donePromise;
    return count;
  }

  global.WBPQuestionStore = {
    provider: "indexeddb-local",
    load: load,
    addSubject: addSubject,
    bulkAddQuestions: bulkAddQuestions,
    listSubjects: listSubjects,
    countQuestions: countQuestions
  };
})(window);
