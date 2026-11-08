// CE — Compréhension Écrite: one text + 10 questions, 90 s per question.
import { apiStep, generateJSON } from './api.js';
import { CE_GENERATOR } from './prompts.js';
import { startHuberman } from './timer.js';
import { createQuiz, renderResults, validateQuestions, createLevelTracker, levelNote, esc } from './quiz.js';

const SECONDS_PER_QUESTION = 90;
const tracker = createLevelTracker(); // a CE series is exactly one 10-question block
const usedTopics = [];
const usedTextTypes = [];

/** Renders CE mode into `container`. Returns a cleanup function. */
export function start(container) {
  let alive = true;
  let quiz = null;
  startHuberman();

  const run = async () => {
    container.innerHTML = `
      <h2>Compréhension Écrite <span class="level">${tracker.level}</span></h2>
      <div class="ce-body"></div>`;
    const body = container.querySelector('.ce-body');

    const userMsg = [
      `level: ${tracker.level}`,
      `Topics already used this session (never repeat): ${usedTopics.join(', ') || 'none'}`,
      `Text types already used this session: ${usedTextTypes.join(', ') || 'none'}`,
      'Generate one new CE block now.',
    ].join('\n');
    const data = await apiStep(body, 'Generating a reading text and 10 questions… (this can take a minute)', () =>
      generateJSON(CE_GENERATOR, userMsg, {
        validate: (o) => {
          if (typeof o.text !== 'string' || !o.text.trim()) throw new Error('Claude’s reply has no reading text.');
          validateQuestions(o.questions, 10);
        },
      }));
    if (!alive) return;
    if (data.topic) usedTopics.push(data.topic);
    if (data.text_type) usedTextTypes.push(data.text_type);

    body.innerHTML = `
      <div class="ce-layout">
        <article class="ce-text">
          ${data.text_type ? `<p class="muted">${esc(data.text_type)}</p>` : ''}
          ${data.text.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}
        </article>
        <div class="ce-questions">
          <p class="instructions">Read the question, scan the text for the keyword, answer. ${SECONDS_PER_QUESTION} s per question.</p>
          <div class="quiz"></div>
          <div class="after"></div>
        </div>
      </div>`;
    quiz = createQuiz(body.querySelector('.quiz'), data.questions, { seconds: SECONDS_PER_QUESTION, showHint: true });
    const answers = await quiz.start();
    if (!alive) return;

    const after = body.querySelector('.after');
    renderResults(after, { mode: 'CE', questions: data.questions, answers, source: data.text });
    after.insertAdjacentHTML('beforeend', `
      ${levelNote(tracker.record(answers), tracker.level)}
      <button class="primary next">Next text</button>`);
    after.querySelector('.next').onclick = run;
    after.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  run();
  return () => { alive = false; quiz?.stop(); };
}
