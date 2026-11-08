// Error log: localStorage schema, priority rules, review badges, and the log screen.
//
// Schema (localStorage key "tcf.errorLog.v1") — an array of:
// { id, date (ISO string), mode ("CO"|"CE"), question, correct_answer, learner_answer,
//   error_type, confidence (1-5), review_priority ("HIGH"|"MEDIUM"|"LOW"),
//   calibration_note, evidence }

const STORAGE = 'tcf.errorLog.v1';

const ERROR_TYPES = [
  'MOT_REPRIS', 'NEGATION_MANQUEE', 'INFERENCE_DEGUISEE',
  'OPTION_VRAIE_HORS_TEXTE', 'TEMPS_DEPASSE', 'CASE_VIDE',
];
const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

// Calibration notes from the tcf-error-tagger skill, used when the app tags a
// timeout itself instead of calling Claude.
const LOCAL_NOTES = {
  HIGH: 'Tu étais très confiant(e) mais tu as raté cette question — c’est un angle mort.',
  MEDIUM: 'Tu hésitais, ce qui est correct — cette règle demande plus de pratique.',
  LOW: 'Tu savais que tu ne savais pas — bonne métacognition, à revoir.',
};

export function isValidErrorType(t) {
  return ERROR_TYPES.includes(t);
}

// Same thresholds as the tagger skill (Step 3).
export function priorityFor(confidence) {
  if (confidence >= 4) return 'HIGH';
  if (confidence >= 2) return 'MEDIUM';
  return 'LOW';
}

export function localNoteFor(priority) {
  return LOCAL_NOTES[priority];
}

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    return Array.isArray(data) ? data : [];
  } catch {
    // Corrupt data must not silently become an empty log the user then overwrites.
    throw new Error('The saved error log is corrupted and could not be read. Use "Clear log" to reset it.');
  }
}

export function addError(entry) {
  const all = read();
  all.push({ id: crypto.randomUUID(), date: new Date().toISOString(), ...entry });
  localStorage.setItem(STORAGE, JSON.stringify(all));
}

// Calendar-day age, so an error logged at 23:00 is "J+1" the next morning.
function ageInDays(iso, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOf(now) - startOf(new Date(iso))) / 86400000);
}

function reviewToday(entry) {
  return [1, 3, 7].includes(ageInDays(entry.date));
}

// ---------- Error log screen ----------

export function renderErrorLog(container) {
  let entries;
  try {
    entries = read();
  } catch (err) {
    container.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'error-box';
    box.textContent = err.message;
    const btn = document.createElement('button');
    btn.textContent = 'Clear log';
    btn.onclick = () => { localStorage.removeItem(STORAGE); renderErrorLog(container); };
    box.append(btn);
    container.append(box);
    return;
  }

  container.innerHTML = `
    <h2>Error log</h2>
    <div class="log-controls">
      <label>Error type
        <select id="f-type"><option value="">All</option>${ERROR_TYPES.map((t) => `<option>${t}</option>`).join('')}</select>
      </label>
      <label>Priority
        <select id="f-prio"><option value="">All</option>${PRIORITIES.map((p) => `<option>${p}</option>`).join('')}</select>
      </label>
      <button id="clear-log" class="danger">Clear log</button>
    </div>
    <p class="muted" id="log-count"></p>
    <div class="table-wrap"><table class="log-table">
      <thead><tr><th>Date</th><th>Mode</th><th>Question</th><th>Error type</th><th>Conf.</th><th>Priority</th></tr></thead>
      <tbody></tbody>
    </table></div>`;

  const tbody = container.querySelector('tbody');
  const fType = container.querySelector('#f-type');
  const fPrio = container.querySelector('#f-prio');

  const draw = () => {
    const rows = entries
      .filter((e) => (!fType.value || e.error_type === fType.value) && (!fPrio.value || e.review_priority === fPrio.value))
      .sort((a, b) => b.date.localeCompare(a.date));
    container.querySelector('#log-count').textContent =
      `${rows.length} of ${entries.length} error${entries.length === 1 ? '' : 's'}`;
    tbody.innerHTML = '';
    for (const e of rows) {
      const tr = document.createElement('tr');
      const q = e.question.length > 70 ? `${e.question.slice(0, 70)}…` : e.question;
      tr.innerHTML = `
        <td data-label="Date"></td><td data-label="Mode"></td><td data-label="Question" class="q"></td>
        <td data-label="Error type"></td><td data-label="Conf."></td><td data-label="Priority"></td>`;
      const cells = tr.children;
      cells[0].textContent = new Date(e.date).toLocaleDateString();
      cells[1].textContent = e.mode;
      cells[2].textContent = q;
      cells[2].title = `${e.question}\n\nYour answer: ${e.learner_answer}\nCorrect: ${e.correct_answer}\n\n${e.evidence || ''}`;
      cells[3].textContent = e.error_type;
      cells[4].textContent = e.confidence;
      cells[5].innerHTML = `<span class="prio prio-${e.review_priority}">${e.review_priority}</span>`;
      if (reviewToday(e)) cells[5].insertAdjacentHTML('beforeend', ' <span class="badge">Review today</span>');
      tbody.append(tr);
    }
    if (!rows.length) tbody.innerHTML = '<tr><td colspan="6" class="muted">No errors to show.</td></tr>';
  };

  fType.onchange = draw;
  fPrio.onchange = draw;
  container.querySelector('#clear-log').onclick = () => {
    if (!confirm('Delete every entry in the error log? This cannot be undone.')) return;
    localStorage.removeItem(STORAGE);
    entries = [];
    draw();
  };
  draw();
}
