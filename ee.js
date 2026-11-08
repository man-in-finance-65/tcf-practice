// EE — Expression Écrite: TEF Section B opinion letter, 35-minute limit,
// evaluation streamed from Claude section by section.
import { apiStep, streamText } from './api.js';
import { EE_EVALUATOR } from './prompts.js';
import { startHuberman, startCountdown, formatTime } from './timer.js';
import { esc } from './quiz.js';

const WRITING_SECONDS = 35 * 60; // TEF B real exam time
const MIN_WORDS = 200;
const TASK_TYPE = "TEF B: lettre d'opinion, 200 words min, 35 min";
const PROMPT_INDEX = 'tcf.eePromptIndex';

const PROMPTS = [
  'Vous avez lu sur le site d’un journal : « Le télétravail devrait devenir la norme pour tous les emplois de bureau. » Vous écrivez au journal pour donner votre opinion. Présentez au moins trois arguments illustrés d’exemples.',
  'Dans votre ville, la mairie propose d’interdire les voitures dans le centre-ville à partir de l’année prochaine. Vous écrivez au journal local pour réagir à cette proposition. Présentez au moins trois arguments illustrés d’exemples.',
  'Un magazine publie un article intitulé : « Les réseaux sociaux devraient être interdits aux moins de 16 ans. » Vous écrivez au magazine pour donner votre point de vue. Présentez au moins trois arguments illustrés d’exemples.',
  'Une grande entreprise de votre région annonce qu’elle passe à la semaine de quatre jours. Sur un forum, on lit : « Toutes les entreprises devraient faire la même chose. » Vous écrivez un message sur le forum pour donner votre opinion. Présentez au moins trois arguments illustrés d’exemples.',
  'Un journal titre : « Les études universitaires devraient être gratuites pour tout le monde. » Vous écrivez au journal pour exprimer votre opinion. Présentez au moins trois arguments illustrés d’exemples.',
];

// Cycle through the prompts, remembering the position between visits.
function nextPrompt() {
  const i = (Number(localStorage.getItem(PROMPT_INDEX)) || 0) % PROMPTS.length;
  localStorage.setItem(PROMPT_INDEX, String(i + 1));
  return { prompt: PROMPTS[i], number: i + 1 };
}

const countWords = (text) => (text.trim() ? text.trim().split(/\s+/).length : 0);

// Minimal markdown → HTML for the evaluator's output. Escapes first, so model text
// can never inject markup. Re-run on the whole text at every delta: a heading split
// across two deltas renders correctly once its line is complete.
function renderMarkdown(md) {
  return esc(md)
    .split('\n')
    .map((line) => {
      const h = line.match(/^#{1,6}\s+(.*)$/);
      const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      if (h) return `<h4>${inline(h[1])}</h4>`;
      if (/^\s*[-*]\s+/.test(line)) return `<p class="li">• ${inline(line.replace(/^\s*[-*]\s+/, ''))}</p>`;
      return line.trim() ? `<p>${inline(line)}</p>` : '';
    })
    .join('');
}

/** Renders EE mode into `container`. Returns a cleanup function. */
export function start(container) {
  let alive = true;
  let stopTimer = () => {};
  startHuberman();

  const run = () => {
    const { prompt, number } = nextPrompt();
    container.innerHTML = `
      <h2>Expression Écrite <span class="level">TEF B</span></h2>
      <div class="ee-head"><span class="muted">Prompt ${number}/${PROMPTS.length}</span><span class="ee-timer"></span></div>
      <blockquote class="ee-prompt">${esc(prompt)}</blockquote>
      <textarea class="ee-text" lang="fr" spellcheck="false" placeholder="Écrivez votre lettre ici…"></textarea>
      <div class="ee-bar">
        <span class="ee-count">0 mots (minimum ${MIN_WORDS})</span>
        <button class="primary submit">Submit for evaluation</button>
      </div>
      <p class="form-error" hidden></p>
      <div class="ee-feedback"></div>`;

    const textarea = container.querySelector('.ee-text');
    const count = container.querySelector('.ee-count');
    const timerEl = container.querySelector('.ee-timer');
    const submit = container.querySelector('.submit');
    const formError = container.querySelector('.form-error');

    textarea.oninput = () => {
      const n = countWords(textarea.value);
      count.textContent = `${n} mot${n === 1 ? '' : 's'} (minimum ${MIN_WORDS})`;
      count.classList.toggle('ok', n >= MIN_WORDS);
    };

    stopTimer = startCountdown(WRITING_SECONDS, (left) => {
      timerEl.textContent = formatTime(left);
      timerEl.classList.toggle('urgent', left <= 60);
    }, () => {
      textarea.readOnly = true;
      timerEl.textContent = 'Time’s up';
      formError.hidden = false;
      formError.textContent = 'Time’s up — writing is locked. Submit your text for evaluation.';
    });

    submit.onclick = async () => {
      const text = textarea.value.trim();
      if (!text) {
        formError.hidden = false;
        formError.textContent = 'Write something before submitting.';
        return;
      }
      formError.hidden = true;
      stopTimer();
      textarea.readOnly = true;
      submit.disabled = true;

      const userMsg = [
        'exam_type: TEF',
        `task_type: ${TASK_TYPE}`,
        `task_prompt:\n"""\n${prompt}\n"""`,
        `response:\n"""\n${text}\n"""`,
      ].join('\n\n');

      const feedback = container.querySelector('.ee-feedback');
      await apiStep(feedback, 'Evaluating your text…', (el) => {
        let box = null;
        return streamText(EE_EVALUATOR, userMsg, (full) => {
          if (!alive) return;
          // First delta replaces the spinner; later ones re-render in place.
          if (!box) { el.innerHTML = '<div class="feedback-text"></div>'; box = el.firstChild; }
          box.innerHTML = renderMarkdown(full);
        });
      });
      if (!alive) return;
      feedback.insertAdjacentHTML('beforeend', '<button class="primary next">Next prompt</button>');
      feedback.querySelector('.next').onclick = run;
    };
  };

  run();
  return () => { alive = false; stopTimer(); };
}
