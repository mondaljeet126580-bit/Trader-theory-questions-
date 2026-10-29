# WBP & KP Exam MCQ Hub & Mock Simulator

A Bengali-first, single-file MCQ study and mock-test app for WBP/KP exam practice.

## Run the app

This project currently uses plain HTML, CSS, and JavaScript. There is no Node.js build step or package installation.

- Open `index.html` in a modern browser to run it locally.
- To publish it with GitHub Pages, open the repository's **Settings → Pages**, choose deployment from the `main` branch and the root folder, then save. GitHub will show the published URL after deployment is ready.

## Current features

- Subject tabs and subject-name search.
- Study mode with question explanations and page navigation.
- Mock tests with configurable question count, timer, and question order.
- Review of correct, wrong, and unanswered questions.
- Bookmarks and filters for previously wrong or skipped questions.
- Question-number selection and bulk/single prompts for Gemini.
- Browser-local storage for bookmarks, settings, Gemini selections, wrong-question history, and skipped-question history.

## Current data and persistence

The bundled `questionsDatabase` is in `index.html`. The current starter dataset contains **6 questions across 4 subjects**; add or replace question objects there to populate the full question bank.

Progress is stored in the current browser's local storage. It is not synchronized across browsers or devices. **Supabase is not configured in this version**: no database client, credentials, migrations, or remote data operations are included.

## Question object shape

Each subject contains an array of question objects. For example:

```js
{
  no: 1,
  bn: "বাংলায় প্রশ্নের লেখা",
  en: "Optional English translation",
  options: {
    A: "প্রথম বিকল্প",
    B: "দ্বিতীয় বিকল্প",
    C: "তৃতীয় বিকল্প",
    D: "চতুর্থ বিকল্প"
  },
  correct: "A",
  explanation: "সঠিক উত্তরের সংক্ষিপ্ত ব্যাখ্যা"
}
```

The `en` and `explanation` fields are optional. Keep `no` unique within each subject and set `correct` to one of the option keys.

## Repository structure

- `index.html` — the complete app, styles, bundled sample questions, and client-side logic.
- `README.md` — run instructions, current features, and implementation notes.

Do not place private API keys or service-role credentials in this client-side HTML file. When a remote backend is added, use the appropriate public client configuration and enforce access through server-side policies.
