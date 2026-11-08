// CO — Compréhension Orale: generate a series, show questions, play audio once,
// then answer one question at a time (50 s each).
import { apiStep, generateJSON } from './api.js';
import { CO_GENERATOR } from './prompts.js';
import { startHuberman } from './timer.js';
import { createQuiz, renderResults, validateQuestions, createLevelTracker, levelNote, esc } from './quiz.js';

const SECONDS_PER_QUESTION = 50;
const tracker = createLevelTracker(); // session state: survives mode switches
const usedTopics = [];

/** Renders CO mode into `container`. Returns a cleanup function. */
export function start(container) {
  let alive = true;
  let quiz = null;
  startHuberman();
  warmUpVoices();

  const run = async () => {
    container.innerHTML = `
      <h2>Compréhension Orale <span class="level">${tracker.level}</span></h2>
      <div class="co-body"></div>`;
    const body = container.querySelector('.co-body');

    const userMsg = [
      `level: ${tracker.level}`,
      `Topics already used this session (never repeat): ${usedTopics.join(', ') || 'none'}`,
      'Generate one new CO series now.',
    ].join('\n');
    const data = await apiStep(body, 'Generating a listening series…', () =>
      generateJSON(CO_GENERATOR, userMsg, {
        validate: (o) => {
          if (typeof o.script !== 'string' || !o.script.trim()) throw new Error('Claude’s reply has no audio script.');
          validateQuestions(o.questions, 4);
        },
      }));
    if (!alive) return;
    if (data.topic) usedTopics.push(data.topic);

    body.innerHTML = `
      <p class="instructions">Read all 4 questions first. Then press <strong>Play audio</strong> — you hear it once.
      After the audio, each question gets ${SECONDS_PER_QUESTION} seconds.</p>
      <div class="audio-bar"><button class="primary play">▶ Play audio</button><span class="audio-status muted"></span></div>
      <div class="quiz"></div>
      <div class="after"></div>`;
    quiz = createQuiz(body.querySelector('.quiz'), data.questions, { seconds: SECONDS_PER_QUESTION });

    const playBtn = body.querySelector('.play');
    const status = body.querySelector('.audio-status');
    const audioBar = body.querySelector('.audio-bar');
    const audioDone = await new Promise((resolve) => {
      // Runs straight from a tap (Play or Try again): iOS requires that.
      const play = () => {
        playBtn.disabled = true;
        speak(data.script, {
          onStatus: (s) => { status.textContent = s; },
          onEnd: () => resolve('Audio finished.'),
          onError: (msg) => {
            // Never strand the learner: say what failed, allow a retry or reading the script.
            status.textContent = '';
            const box = document.createElement('div');
            box.className = 'error-box';
            box.innerHTML = `<p>${esc(msg)}</p>`;
            const retry = document.createElement('button');
            retry.textContent = 'Try again';
            retry.onclick = () => { box.remove(); play(); };
            const read = document.createElement('button');
            read.textContent = 'Read the script instead';
            read.onclick = () => {
              box.remove();
              audioBar.after(Object.assign(document.createElement('blockquote'), { textContent: data.script }));
              resolve('Reading the script instead of listening.');
            };
            box.append(retry, read);
            audioBar.after(box);
          },
        });
      };
      playBtn.onclick = play;
    });
    if (!alive) return;
    status.textContent = audioDone;

    const answers = await quiz.start();
    if (!alive) return;

    const after = body.querySelector('.after');
    renderResults(after, { mode: 'CO', questions: data.questions, answers, source: data.script });
    const level = tracker.record(answers);
    after.insertAdjacentHTML('beforeend', `
      ${levelNote(level, tracker.level)}
      <details><summary>Show the audio script</summary><blockquote>${esc(data.script)}</blockquote></details>
      <button class="primary next">Next series</button>`);
    after.querySelector('.next').onclick = run;
    after.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  run();
  return () => {
    alive = false;
    quiz?.stop();
    window.speechSynthesis?.cancel();
  };
}

// ---------- Text-to-speech ----------

// Voices load asynchronously (Safari only starts after the first getVoices call).
// Asking when CO opens means they're ready by the time the learner taps Play,
// so speak() never has to wait.
function warmUpVoices() {
  if ('speechSynthesis' in window) speechSynthesis.getVoices();
}

function frenchVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.lang === 'fr-FR') || voices.find((v) => v.lang === 'fr-CA') ||
    voices.find((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('fr')) || null;
}

const liveUtterances = []; // Chrome can garbage-collect utterances and never fire onend.

// Must run synchronously inside the tap handler, with no await before speak():
// iOS Safari only plays speech started directly by a user gesture and otherwise
// does nothing at all, without firing any error.
function speak(script, { onStatus, onEnd, onError }) {
  if (!('speechSynthesis' in window)) {
    onError('This browser has no text-to-speech (Web Speech API), so the audio can’t play.');
    return;
  }
  let started = false;
  let finished = false;
  const fail = (msg) => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    speechSynthesis.cancel();
    onError(msg);
  };

  const voice = frenchVoice();
  // Safari can drop an utterance queued right after cancel(), so only cancel if needed.
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
  // Chrome stops long utterances after ~15 s, so speak sentence by sentence.
  const parts = script.match(/[^.!?]+[.!?]*/g)?.map((t) => t.trim()).filter(Boolean) || [script];
  liveUtterances.length = 0;
  parts.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice?.lang || 'fr-FR';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onstart = () => { started = true; };
    if (i === parts.length - 1) {
      u.onend = () => {
        if (finished) return;
        finished = true;
        clearTimeout(watchdog);
        onEnd();
      };
    }
    u.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return; // we cancelled it ourselves
      fail(`The audio failed to play (${e.error}).`);
    };
    liveUtterances.push(u);
    speechSynthesis.speak(u);
  });
  onStatus(voice ? `Playing… (voice: ${voice.name})` : 'Playing… (no French voice found on this device — pronunciation may be off)');

  // A blocked or broken speech engine fires no event at all. Without this the
  // questions would stay locked forever with no explanation.
  const watchdog = setTimeout(() => {
    if (!started) {
      fail('The audio didn’t start. Turn the volume up and check your phone isn’t on silent, then tap Try again. If it still doesn’t play, read the script instead.');
    }
  }, 5000);
}
