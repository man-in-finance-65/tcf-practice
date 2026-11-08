// Claude API wrapper: key storage, JSON generation, streaming, and the shared
// "spinner → error → Try again" UI that every API call goes through.
import { RUNTIME_NOTE } from './prompts.js';

// ?bundle makes esm.sh serve the SDK as one file instead of ~165 small modules,
// which phones on mobile data fetch slowly one after another.
const SDK_URL = 'https://esm.sh/@anthropic-ai/sdk@1.2.0?bundle';
let sdk = null;

// Loaded on first API call (and preloaded by index.html), so the key and home
// screens never wait for the ~120 KB library.
async function loadSdk() {
  if (!sdk) {
    try {
      sdk = (await import(SDK_URL)).default;
    } catch (err) {
      throw new Error(`Could not load the Claude library from esm.sh. Check your internet connection.\nDetails: ${err.message}`);
    }
  }
  return sdk;
}

const MODEL = 'claude-sonnet-4-6';
const KEY_STORAGE = 'tcf.apiKey';

// ---------- API key (localStorage only) ----------

export function hasKey() {
  return Boolean(localStorage.getItem(KEY_STORAGE));
}

export function saveKey(key) {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearKey() {
  localStorage.removeItem(KEY_STORAGE);
}

export function maskedKey() {
  const k = localStorage.getItem(KEY_STORAGE) || '';
  return k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••';
}

// A fresh client per call: the key is read from localStorage at call time and
// never kept in a long-lived variable.
function client(Anthropic) {
  const apiKey = localStorage.getItem(KEY_STORAGE);
  if (!apiKey) throw new Error('No API key saved. Go back to the home screen and enter it.');
  // The SDK refuses to run in a browser unless told to: it means the key is visible
  // to this page. Acceptable here because it's your own key on your own device.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

// The skill text goes in first, untouched; the runtime note is a second block so
// the "sacred" prompt stays verbatim.
function systemBlocks(skillPrompt) {
  return [
    { type: 'text', text: skillPrompt },
    { type: 'text', text: RUNTIME_NOTE },
  ];
}

// ---------- Calls ----------

/**
 * One non-streaming call that must return a single JSON object.
 * `validate(obj)` should throw with a readable message if the shape is wrong.
 */
export async function generateJSON(skillPrompt, userMessage, { maxTokens = 16000, validate } = {}) {
  const Anthropic = await loadSdk();
  let msg;
  try {
    msg = await client(Anthropic).messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemBlocks(skillPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (err) {
    throw describeError(err, Anthropic);
  }
  checkStop(msg.stop_reason);

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  // The model sometimes wraps JSON in ``` fences despite instructions; taking the
  // outermost braces tolerates that without hiding a genuinely broken reply.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`Claude's reply contained no JSON exercise data. Start of reply: "${text.slice(0, 200)}"`);
  }
  let obj;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Claude's reply wasn't valid exercise data (${e.message}). Start: "${text.slice(start, start + 200)}"`);
  }
  if (validate) validate(obj);
  return obj;
}

/**
 * Streaming call. `onText(fullTextSoFar)` fires on every delta so the caller can
 * re-render feedback section by section as it arrives.
 */
export async function streamText(skillPrompt, userMessage, onText, { maxTokens = 16000 } = {}) {
  const Anthropic = await loadSdk();
  let full = '';
  try {
    const stream = client(Anthropic).messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemBlocks(skillPrompt),
      messages: [{ role: 'user', content: userMessage }],
    });
    // 'text' events carry only the new fragment; we pass the accumulated text so the
    // renderer can re-parse markdown headings that arrive split across deltas.
    stream.on('text', (delta) => {
      full += delta;
      onText(full);
    });
    // finalMessage() rejects if the stream errors mid-way (network drop, overload),
    // so a half-finished evaluation can never look like a complete one.
    const msg = await stream.finalMessage();
    checkStop(msg.stop_reason);
  } catch (err) {
    throw describeError(err, Anthropic);
  }
  return full;
}

function checkStop(stopReason) {
  if (stopReason === 'max_tokens') {
    throw new Error('Claude\'s reply was cut off (length limit reached). Try again.');
  }
  if (stopReason === 'refusal') {
    throw new Error('Claude declined to answer this request. Try again.');
  }
}

// Turn SDK errors into messages that say what happened and what to do.
function describeError(err, Anthropic) {
  if (!(err instanceof Anthropic.APIError)) return err instanceof Error ? err : new Error(String(err));
  const detail = err.error?.error?.message || err.message;
  let msg;
  if (err instanceof Anthropic.AuthenticationError) {
    msg = 'Your API key was rejected (401). Check it, or click "Clear key" and enter it again.';
  } else if (err instanceof Anthropic.PermissionDeniedError) {
    msg = 'Permission denied (403): this key is not allowed to make this request.';
  } else if (err instanceof Anthropic.NotFoundError) {
    msg = `Model not found (404): "${MODEL}" is not available to your account.`;
  } else if (err instanceof Anthropic.RateLimitError) {
    msg = 'Too many requests (429). Wait a few seconds, then try again.';
  } else if (err instanceof Anthropic.InternalServerError) {
    msg = err.status === 529
      ? 'Claude\'s servers are overloaded (529). Try again in a moment.'
      : `Anthropic server error (${err.status}). Try again.`;
  } else if (err instanceof Anthropic.APIConnectionError) {
    msg = 'Could not reach api.anthropic.com. Check your internet connection.';
  } else if (err.status === 402) {
    msg = 'Billing problem (402): check your credits at console.anthropic.com.';
  } else {
    msg = `API error${err.status ? ` (${err.status})` : ''}.`;
  }
  return new Error(`${msg}\nDetails: ${detail}`);
}

// ---------- Shared loading / error UI ----------

/**
 * Runs `task(container)` with a spinner in `container`. On failure it shows the
 * error and a "Try again" button, and only resolves once the task succeeds, so
 * callers can simply `await` it and never see a swallowed error.
 * A task that streams may replace the container's contents itself.
 */
export function apiStep(container, label, task) {
  return new Promise((resolve) => {
    const attempt = async () => {
      container.innerHTML = `<div class="loading"><span class="spinner"></span>${label}</div>`;
      try {
        resolve(await task(container));
      } catch (err) {
        console.error(err);
        container.innerHTML = '';
        const box = document.createElement('div');
        box.className = 'error-box';
        const p = document.createElement('p');
        p.textContent = err.message;
        const btn = document.createElement('button');
        btn.textContent = 'Try again';
        btn.onclick = attempt;
        box.append(p, btn);
        container.append(box);
      }
    };
    attempt();
  });
}
