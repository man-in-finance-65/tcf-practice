# TCF/TEF Practice

A personal practice app for the TCF Canada / TEF Canada French exams. Static files only: no build step, no server, no npm.
Claude (`claude-sonnet-4-6`) writes the exercises and grades your answers, called straight from your browser with your own API key.

**Modes**

- **CO (Compréhension Orale):** 4 questions shown first, then the audio plays once in your browser's French voice. You get 50 seconds per question.
- **CE (Compréhension Écrite):** one text and 10 questions, each with a keyword hint. You get 90 seconds per question.
- **EE (Expression Écrite):** a TEF Section B opinion letter (200 words minimum, 35 minutes). Claude's evaluation streams in section by section.
- **Error log:** every wrong CO/CE answer, classified by error type and review priority. Errors that are 1, 3 or 7 days old get a "Review today" badge.

A 60-minute Huberman session timer starts with your first practice mode and keeps running when you switch modes.
On a phone it's a small square in the top-right corner; on a computer it's a sidebar.

## Add your API key

1. Create a key at <https://console.anthropic.com/settings/keys>. API usage is billed separately from a claude.ai subscription.
2. Open the app. On first visit it asks for the key; paste it and click **Save key**.
3. The key is stored only in this browser's `localStorage` and sent only to `api.anthropic.com`. After saving, the header shows it masked (`sk-ant-…abcd`).
4. **Clear key** in the header removes it.

Anyone with access to your browser profile can read a key stored in `localStorage`. Use this app only on your own devices, and consider a key with a spending limit.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```bash
cd tcf-platform
```

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages

1. Push this folder to a GitHub repository, with `index.html` at the repository root.
2. On GitHub, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, then branch `main`, folder `/ (root)`, and click **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell; loads `app.js` as an ES module |
| `styles.css` | All styles; phone-first, desktop layout from 768px |
| `app.js` | Key setup, home screen, routing between modes |
| `api.js` | Claude calls (JSON + streaming), readable error messages, spinner / Try again UI |
| `prompts.js` | The four skill system prompts, copied verbatim from each `SKILL.md`, plus a short runtime note |
| `timer.js` | Huberman session timer and the countdown used by questions and EE |
| `quiz.js` | Shared question runner for CO/CE: confidence slider, results, error tagging, 85/15 rule |
| `co.js`, `ce.js`, `ee.js` | One file per practice mode |
| `errorLog.js` | Error log storage, filters, review badges |

**Level-up (85/15) rule:** answers are pooled into blocks of 10. A score of 9 or 10 out of 10 switches the next series to B2. CO series have 4 questions, so leftover answers carry over into the next block.

**Saved data:** only the API key, the error log (`tcf.errorLog.v1`) and the position in the EE prompt cycle are stored. Everything else, including the session timer and current level, resets when you reload the page.

**SDK:** `@anthropic-ai/sdk` is loaded from esm.sh, pinned to version 1.2.0 so an SDK update can't silently break the site.
