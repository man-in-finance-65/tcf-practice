// Shared multiple-choice runner for CO and CE: one active question at a time,
// per-question countdown, confidence slider, results, error tagging, 85/15 rule.
import { startCountdown, formatTime } from './timer.js';
import { apiStep, generateJSON } from './api.js';
import { ERROR_TAGGER } from './prompts.js';
import { addError, priorityFor, localNoteFor, isValidErrorType } from './errorLog.js';

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Throws a readable error if a generator reply isn't a usable MCQ block. */
export function validateQuestions(questions, expectedCount) {
  if (!Array.isArray(questions) || questions.length !== expectedCount) {
    throw new Error(`Claude's reply should contain ${expectedCount} questions but has ${Array.isArray(questions) ? questions.length : 'none'}.`);
  }
  questions.forEach((q, i) => {
    if (!q.text || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Question ${i + 1} in Claude's reply is missing its text or options.`);
    }
    if (!q.options.some((o) => o.id === q.correct_id)) {
      throw new Error(`Question ${i + 1}: the correct answer "${q.correct_id}" isn't one of the options.`);
    }
  });
}

const optionText = (q, id) => q.options.find((o) => o.id === id)?.text ?? '';

/**
 * Renders every question card (locked) into `container`.
 * Returns { start(): Promise<answers>, stop() }.
 * answer = { chosenId|null, timedOut, confidence, correct }
 */
export function createQuiz(container, questions, { seconds, showHint = false }) {
  container.innerHTML = questions.map((q, i) => `
    <article class="q-card locked" data-i="${i}">
      <div class="q-head"><span class="q-num">Question ${i + 1}/${questions.length}</span><span class="q-timer"></span></div>
      <p class="q-text">${esc(q.text)}</p>
      ${showHint && q.keyword_hint ? `<p class="hint">Keyword to scan for: <strong>${esc(q.keyword_hint)}</strong></p>` : ''}
      <div class="options">${q.options.map((o) => `
        <button class="opt" data-id="${esc(o.id)}" disabled><b>${esc(o.id)}</b><span>${esc(o.text)}</span></button>`).join('')}
      </div>
      <div class="confidence" hidden>
        <label>How confident are you? <output>3</output>/5
          <input type="range" min="1" max="5" step="1" value="3">
        </label>
        <div class="conf-scale"><span>1 · guessing</span><span>5 · certain</span></div>
        <button class="primary conf-ok">Confirm</button>
      </div>
    </article>`).join('');

  let stopTimer = () => {};
  let stopped = false;

  function askOne(i) {
    return new Promise((resolve) => {
      const card = container.querySelector(`.q-card[data-i="${i}"]`);
      const opts = [...card.querySelectorAll('.opt')];
      const timerEl = card.querySelector('.q-timer');
      card.classList.replace('locked', 'active');
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      opts.forEach((b) => { b.disabled = false; });

      const finish = (chosenId, timedOut) => {
        stopTimer();
        opts.forEach((b) => { b.disabled = true; b.classList.toggle('chosen', b.dataset.id === chosenId); });
        if (timedOut) timerEl.textContent = 'Time’s up';
        // Confidence is asked even on timeout: it sets the review priority.
        const conf = card.querySelector('.confidence');
        const range = conf.querySelector('input');
        const out = conf.querySelector('output');
        conf.hidden = false;
        range.oninput = () => { out.textContent = range.value; };
        conf.querySelector('.conf-ok').onclick = () => {
          conf.hidden = true;
          card.classList.replace('active', 'done');
          const confidence = Number(range.value);
          card.querySelector('.q-head').insertAdjacentHTML('beforeend', `<span class="muted">confidence ${confidence}/5</span>`);
          resolve({ chosenId, timedOut, confidence, correct: chosenId === questions[i].correct_id });
        };
      };

      opts.forEach((b) => { b.onclick = () => finish(b.dataset.id, false); });
      stopTimer = startCountdown(seconds, (left) => {
        timerEl.textContent = formatTime(left);
        timerEl.classList.toggle('urgent', left <= 10);
      }, () => finish(null, true));
    });
  }

  return {
    async start() {
      const answers = [];
      for (let i = 0; i < questions.length && !stopped; i++) answers.push(await askOne(i));
      return answers;
    },
    stop() { stopped = true; stopTimer(); },
  };
}

/**
 * Shows score + explanations, and tags each wrong answer into the error log.
 * Timeouts are tagged locally as TEMPS_DEPASSE (the tagger skill treats a
 * platform timeout flag as automatic, so an API call would add nothing).
 */
export function renderResults(container, { mode, questions, answers, source }) {
  const correct = answers.filter((a) => a.correct).length;
  container.innerHTML = `
    <h3>Results: ${correct}/${answers.length} (${Math.round((100 * correct) / answers.length)}%)</h3>
    <div class="results"></div>`;
  const list = container.querySelector('.results');

  answers.forEach((a, i) => {
    const q = questions[i];
    const item = document.createElement('div');
    item.className = `result ${a.correct ? 'ok' : 'ko'}`;
    item.innerHTML = `
      <p class="q-text"><strong>${a.correct ? '✔' : '✘'} Q${i + 1}.</strong> ${esc(q.text)}</p>
      <p>Your answer: ${a.timedOut ? '<em>no answer (time’s up)</em>' : `${esc(a.chosenId)} — ${esc(optionText(q, a.chosenId))}`}</p>
      ${a.correct ? '' : `<p>Correct answer: ${esc(q.correct_id)} — ${esc(optionText(q, q.correct_id))}</p>`}
      <p class="explanation">${esc(q.explanation)}</p>
      <div class="tag-slot"></div>`;
    list.append(item);
    if (!a.correct) tagError(item.querySelector('.tag-slot'), { mode, q, a, source });
  });

  return { correct, total: answers.length };
}

function showTag(slot, t) {
  slot.innerHTML = `
    <div class="tag">
      <span class="tag-type">${esc(t.error_type)}</span>
      <span class="prio prio-${esc(t.review_priority)}">${esc(t.review_priority)}</span>
      <p>${esc(t.calibration_note)}</p>
      ${t.evidence ? `<p class="muted">${esc(t.evidence)}</p>` : ''}
    </div>`;
}

function tagError(slot, { mode, q, a, source }) {
  const base = {
    mode,
    question: q.text,
    correct_answer: optionText(q, q.correct_id),
    learner_answer: a.timedOut ? '' : optionText(q, a.chosenId),
    confidence: a.confidence,
  };

  if (a.timedOut) {
    const priority = priorityFor(a.confidence);
    const tag = {
      error_type: 'TEMPS_DEPASSE',
      review_priority: priority,
      calibration_note: localNoteFor(priority),
      evidence: 'Temps écoulé sans réponse.',
    };
    addError({ ...base, ...tag });
    showTag(slot, tag);
    return;
  }

  const input = {
    question: q.text,
    correct_answer: base.correct_answer,
    learner_answer: base.learner_answer,
    source,
    confidence: a.confidence,
    timed_out: false,
  };
  apiStep(slot, 'Classifying this error…', async () => {
    const t = await generateJSON(ERROR_TAGGER, `Classify this wrong answer:\n${JSON.stringify(input, null, 2)}`, {
      maxTokens: 2000,
      validate: (o) => {
        if (o.error) throw new Error(`The error tagger reported: ${o.error} ${JSON.stringify(o.missing ?? '')}`);
        if (!isValidErrorType(o.error_type)) throw new Error(`The error tagger returned an unknown error type: "${o.error_type}".`);
      },
    });
    const tag = {
      error_type: t.error_type,
      // The skill's priority rule is purely numeric (Step 3), so apply it here rather
      // than trust the model to do arithmetic: the log's filters depend on it.
      review_priority: priorityFor(a.confidence),
      calibration_note: t.calibration_note || '',
      evidence: t.evidence || '',
    };
    addError({ ...base, ...tag });
    showTag(slot, tag);
  });
}

/**
 * 85/15 rule: a learner scoring ≥85% on a 10-question block is under-challenged,
 * so the next series moves to B2. A CO series has only 4 questions, so results
 * are pooled across series and judged in consecutive blocks of exactly 10;
 * leftovers carry into the next block so no answer is counted twice or dropped.
 * With 10 questions, ≥85% means at least 9 correct (8/10 = 80% does not pass).
 */
export function createLevelTracker() {
  let pending = [];
  const tracker = {
    level: 'B1',
    /** Returns { leveledUp, counted } — counted = answers waiting toward the next block. */
    record(answers) {
      pending.push(...answers.map((a) => a.correct));
      let leveledUp = false;
      while (pending.length >= 10) {
        const block = pending.splice(0, 10);
        if (block.filter(Boolean).length / 10 >= 0.85) {
          tracker.level = 'B2';
          leveledUp = true;
        }
      }
      return { leveledUp, counted: pending.length };
    },
  };
  return tracker;
}

/** Banner shown under results: level-up message or block progress. */
export function levelNote({ leveledUp, counted }, level) {
  if (leveledUp) return '<div class="levelup">Trop facile — niveau suivant. Next series: B2.</div>';
  return `<p class="muted">Level check: ${counted}/10 answers counted toward the next 10-question block (current level ${level}).</p>`;
}
