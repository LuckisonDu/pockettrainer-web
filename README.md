# PocketTrainer (web)

Train and run a small AI on your own phone or laptop, offline. Congressional App Challenge 2026 entry (web version; iOS and Android versions exist too).

**Open it:** https://luckisondu.github.io/pockettrainer-web/

# PocketTrainer (web version)

Train a small AI **in your browser**. It double-checks every training step with a second, independent calculation and repairs itself
if something goes wrong. Same features and the same look as the iOS / Android apps: a single-column phone layout with a top "Offline" tag, a settings gear and bottom tabs
(Projects / Environment / Notes / Assistant). On a computer the app sits in a centred 9:16 portrait frame (full window height, width = height × 9/16, grey margins);
in a portrait window it fills the screen. Desktop and phone browsers show the same interface. Works offline after the first load.

## Run it
No build step, no framework, no CDN. Plain HTML + CSS + JavaScript (ES modules). `file://` does not work for modules/workers, so serve the folder:

```
python3 -m http.server 8000        # then open http://localhost:8000
```

Any static web host works (GitHub Pages, nginx ...). Use a recent Chrome, Edge, Firefox or Safari. Search / import / download need internet;
everything else (editing, training, protection, checkpoints, notes) works offline.

**Offline / install / WebGPU need a secure origin:** `http://localhost` or any `https://` address. Over plain `http://<LAN address>` everything else still works
(SHA-256 has a pure-JS fallback), but the service worker (offline cache) and WebGPU are not available.

## What you can do
Projects (entry cards for Protection lab, Find projects, Import, Tables, Image model) · Editor + Run (model.py with line numbers, parameters synced with the code) · Output + loss/accuracy chart · Protection lab
(simulate an interruption, simulate a crash and resume, compare None / Checkpoint-only / Our method, measure my computer) · Environment
(Analyze → Resolve → Install → Test) · Find projects (GitHub + Hugging Face search, Download & set up) · Import from GitHub ·
Tables (train on a CSV/JSONL table) · Image model (ONNX in the browser, WASM vs WebGPU check) · Notes · Assistant (offline, rule-based) ·
Ask ChatGPT on every page · Settings · 5 languages (English, 简体中文, 繁體中文, Español, Français).

## How the protection works
* The network is a two-layer MLP (2048 → H → 10, ReLU, cross-entropy, SGD, batch 128, fixed seed), written by hand with `Float32Array` (`js/mlp.js`).
* Training runs in a **Web Worker** (`js/train-worker.js`), so the page never freezes.
* **Shadow check:** each step is computed twice. The fast version is in `js/mlp.js`; a second, differently written version (one sample at a time, 64-bit sums)
  is in `js/mlp_ref.js` and runs in a second worker at the same time. If the cosine distance of the two weight updates is > 1e-4, the first result is thrown away and recomputed
  (up to 3 times, then the shadow result is used).
* **Atomic checkpoints:** every N steps (default 20) the model is written to IndexedDB into the slot that is *not* current, read back and checked with a CRC32, and only then the
  pointer is switched. If the page is closed in the middle of a write, the old checkpoint is still complete. When the page is opened again it offers "Resume from step N".
* **Simulations (honest note):** browsers do not expose real GPU interruptions, so "system interruption" is a *software simulation* (one NaN is injected into the first calculation).
  "Crash" kills the training worker in the middle of training; the checkpoint in IndexedDB lets it continue with the same result.

## Files
| File | What it does |
|---|---|
| `index.html`, `css/app.css` | Page shell and the 9:16 phone layout (one 390-px-wide column, scaled with CSS `zoom` to fit the frame), light/dark colours |
| `js/main.js` | Start-up, frame size, top bar and bottom tabs, router (`#/editor` ...), keyboard support (Tab / Enter / Esc) |
| `js/mlp.js` | The neural network: init, forward, backward, evaluate, cosine distance (fast version) |
| `js/mlp_ref.js` | The independent "shadow" version used by the protection |
| `js/trainer.js` | Training loop, shadow check, atomic checkpoints, simulated interruption |
| `js/train-worker.js`, `js/shadow-worker.js` | Web Workers (training / shadow calculation / environment test / compare / measure) |
| `js/train-client.js` | Page-side controller: state, crash simulation, resume |
| `js/store.js`, `js/db.js` | IndexedDB: projects, files, history, runs, notes, settings |
| `js/data.js` | Loads the built-in features (float16 → float32) and checks their SHA-256 |
| `js/net.js`, `js/importer.js` | The only network code: https + host whitelist, GitHub import, Hugging Face listing, requirement scanner, weights download |
| `js/tabular.js`, `js/pages/tables.js` | CSV/JSONL tables → standardised numbers → same trainer |
| `js/pages/image.js`, `vendor/` | ONNX model in the browser (onnxruntime-web 1.23.2, MIT, vendored) |
| `js/pages/*.js` | One file per screen |
| `js/chatgpt.js` | "Ask ChatGPT" sheet (copies the text you reviewed and opens a link; never sends anything itself) |
| `js/advice.js` | Offline rule-based coach and Key takeaways |
| `js/i18n.js`, `i18n/*.json`, `tools/` | Translations (`tools/make_i18n.py` builds the JSON from `android_strings_table.py` + `web_strings.py`) |
| `js/zip.js` | Tiny zip writer for Export |
| `sw.js`, `manifest.webmanifest` | Offline (service worker) and "install as app" |
| `data/` | CIFAR-10 subset as ResNet50 features (5,000 train + 2,000 test, float16), iris.csv, wine.csv |
| `tests/` | Playwright scripts used for `VERIFY.md` (parameters are written at the top of each file) |

## Safety rules for downloads
HTTPS only; hosts `github.com`, `api.github.com`, `raw.githubusercontent.com`, `huggingface.co` (and `*.huggingface.co`, `*.hf.co`); text extensions only;
≤ 512 KB per file, ≤ 200 files, ≤ 5 MB total; model weights are only listed and downloaded one by one (≤ 50 MB). Downloaded code is **only shown and edited, never run**
(there is no `eval` anywhere). SHA-256 and source URL of every file are recorded. Non-commercial or unknown licenses show a yellow warning.

## Limits
The 9:16 frame is scaled with CSS `zoom` (Chrome, Edge, Safari, Firefox 126+). Touch targets are at least 44 px (in the 390-px layout).
Training uses the CPU (JavaScript), about 40 s for the default run on a laptop. "Run" understands only the four recipe keys
(`hidden_units`, `learning_rate`, `epochs`, `seed`), not full Python. Chrome's speech input may use Google's cloud (not offline).
WebGPU needs a recent desktop Chrome/Edge; without it the Image model page runs the WASM/CPU back-end only and says so.
