// App shell: API key setup, home screen, and hash routing between modes.
import { hasKey, saveKey, clearKey, maskedKey } from './api.js';
import { renderErrorLog } from './errorLog.js';
import * as co from './co.js';
import * as ce from './ce.js';
import * as ee from './ee.js';

const view = document.getElementById('view');
const keyStatus = document.getElementById('key-status');
let cleanup = null; // stops the current mode's timers/audio when leaving it

const MODES = [
  { route: 'co', title: 'CO — Compréhension Orale', desc: 'Listen to a short audio and answer 4 questions.', start: co.start },
  { route: 'ce', title: 'CE — Compréhension Écrite', desc: 'Read a text and answer 10 questions.', start: ce.start },
  { route: 'ee', title: 'EE — Expression Écrite', desc: 'Write a TEF B opinion letter and get it graded.', start: ee.start },
  { route: 'log', title: 'Error log', desc: 'Review your mistakes by type and priority.', start: (el) => { renderErrorLog(el); } },
];

function renderKeyStatus() {
  if (!hasKey()) { keyStatus.innerHTML = ''; return; }
  keyStatus.innerHTML = `<span class="key-chip" title="API key (masked)"></span><button class="small">Clear key</button>`;
  keyStatus.querySelector('.key-chip').textContent = maskedKey();
  keyStatus.querySelector('button').onclick = () => {
    if (!confirm('Remove the saved API key from this browser?')) return;
    clearKey();
    location.hash = '';
    route();
  };
}

function renderKeySetup() {
  view.innerHTML = `
    <section class="setup">
      <h2>Enter your Anthropic API key</h2>
      <p>The key is saved only in this browser (localStorage) and sent only to api.anthropic.com.
      Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
      <form>
        <input type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…" required>
        <button class="primary" type="submit">Save key</button>
      </form>
      <p class="form-error" hidden></p>
    </section>`;
  const form = view.querySelector('form');
  form.onsubmit = (e) => {
    e.preventDefault();
    const value = form.querySelector('input').value.trim();
    const err = view.querySelector('.form-error');
    if (!value.startsWith('sk-ant-')) {
      err.hidden = false;
      err.textContent = 'That doesn’t look like an Anthropic API key. It should start with "sk-ant-".';
      return;
    }
    saveKey(value);
    route();
  };
}

function renderHome() {
  view.innerHTML = `<div class="cards">${MODES.map((m) => `
    <section class="card">
      <h2>${m.title}</h2>
      <p>${m.desc}</p>
      <a class="button primary" href="#${m.route}">Start</a>
    </section>`).join('')}</div>`;
}

function route() {
  cleanup?.();
  cleanup = null;
  window.scrollTo(0, 0);
  renderKeyStatus();
  if (!hasKey()) return renderKeySetup();

  const mode = MODES.find((m) => m.route === location.hash.slice(1));
  if (!mode) return renderHome();
  view.innerHTML = '';
  const back = document.createElement('a');
  back.href = '#';
  back.className = 'back';
  back.textContent = '← Home';
  const panel = document.createElement('div');
  view.append(back, panel);
  cleanup = mode.start(panel) || null;
}

window.addEventListener('hashchange', route);
route();
