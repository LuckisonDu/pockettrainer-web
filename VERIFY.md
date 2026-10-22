# VERIFY (PocketTrainer web)

(Re-run after the switch to the 9:16 phone layout, results unchanged.) Everything below was run by `tests/*.py` in a headless Chromium (Playwright, chromium-1228) on the build server (Linux, CPU only, a shared machine with load ~12).
The numbers are copied from `tests/results.json` and `tests/features_results.json`.

## 1. Training and protection (H=128, 6 epochs = 234 steps, lr=0.05, 3 seeds) — `tests/regress.py`
Android (emulator) for comparison: baseline 87.0 / 86.45 / 87.05 %, protection off + interruption 10 %, protection on + interruption = baseline with 1 repair, crash + resume = baseline.

| Scenario | seed 1 | seed 2 | seed 3 | Repairs |
|---|---|---|---|---|
| Baseline (protection on) | 86.95 % | 85.65 % | 86.95 % | 0 |
| Protection **off** + interruption | 10.0 % (wrong) | 10.0 % (wrong) | 10.0 % (wrong) | 0 |
| Protection **on** + interruption | 86.95 % | 85.65 % | 86.95 % | 1 / 1 / 1 |
| Crash + resume (worker killed at step 120, **page reloaded**, then "Resume from step 120") | 86.95 % | 85.65 % | 86.95 % | 0 |

* The web numbers are within 1.4 points of Android (the batches are shuffled with a different random generator, so they cannot be bit-identical).
* The resumed runs end with exactly the same accuracy as the uninterrupted runs: the checkpoint holds weights, step, curve and settings; the batch order depends only on seed and epoch.
* Seeds 1 and 3 end at the same accuracy by coincidence; their loss curves differ (checked: seed 1 vs 3, H=32, 2 epochs: 1.9755,1.3293,… vs 1.9038,1.1687,…).
* Time for one default run: 41–44 s with the shadow check on (fast version and shadow run at the same time in two workers), 31–34 s with it off.

## 2. Network features — `tests/features.py`
| Check | Result |
|---|---|
| GitHub search "micrograd" | 20 results, 0.9 s (top: tinygrad/tinygrad) |
| Hugging Face models "minilm" | 20 results, 0.3 s (top: sentence-transformers/all-MiniLM-L6-v2) |
| Hugging Face datasets "cifar" | 20 results, 0.3 s (top: uoft-cs/cifar10) |
| Import karpathy/micrograd | 10 files, 69 KB, LICENSE found, 1.3 s; Environment: Analyze / Resolve / Install (SHA-256 of 10 files unchanged) / Test = "Read & edit only" (no recipe keys) |
| Download & set up all-MiniLM-L6-v2 (HF) | 12 text files 745 KB, 15 weight files listed only, 3 skipped, license apache-2.0; missing: torch, tqdm, torch-xla, transformers; "Read & edit only" |
| HF dataset scikit-learn/iris → "Train on its table" | CSV loaded from huggingface.co (CORS ok), 150 rows, preview and column choice shown |

## 3. Tables (same trainer, variable input size) — `tests/features.py`
| Dataset | Rows (train / test) | Setting | Test accuracy | Time |
|---|---|---|---|---|
| iris (UCI) | 120 / 30 | H=16, lr=0.1, 100 epochs | 93.3 % | 0.1 s |
| wine (UCI) | 142 / 36 | H=32, lr=0.1, 100 epochs | 100 % | 0.1 s |

## 4. ONNX model in the browser — `tests/features.py`
Model: `onnx-community/mobilenetv4_conv_small.e2400_r224_in1k` (`onnx/model.onnx`, 15,086,122 bytes, sha256 `ca5b8dbf…8d37`). The repo has no license field; its base model timm/mobilenetv4_conv_small is Apache-2.0, so the page shows the yellow warning.
Image: a cat photo (`tests/sample.jpg`, CC BY-SA, see `tests/SAMPLE_CREDIT.txt`). WASM (CPU): tiger cat 35.5 %, Egyptian cat 23.5 %, tabby 17.3 % (45 ms).
WebGPU (Chromium + SwiftShader software GPU in the headless test): identical top-5, cosine similarity 1.000000, largest logit difference 1.9e-5 → shows "✓ Verified: GPU result matches CPU".
(The WebGPU run is slow here — 15 s — only because the server has no real GPU in the browser; on a normal computer it uses the real GPU.) Without WebGPU the page runs WASM only and says so.

Also run against the LAN copy `a local network copy` (plain http, not a secure origin): import micrograd, iris/wine, and the ONNX WASM run all passed; the page says WebGPU is unavailable there.

Re-run on the 9:16 version (`tests/features.py`, ONNX part only, full log in `tests/features_results.json` → `onnx_run`): WASM (CPU) 76 ms, WebGPU 22,466 ms (SwiftShader software GPU);
both Top-5 = tiger cat 35.5 % · Egyptian cat 23.5 % · tabby 17.3 % · lynx 6.0 % · lion 0.3 %; cosine similarity 1.000000, largest difference 1.91e-5, same top-1 ✓ → "✓ Verified: GPU result matches CPU".
Screenshots (long model name wrapped): (server path omitted).

## 5. Offline (service worker)
After the first load the page, scripts, translations and the 28 MB of data are cached. With the browser set offline and the page reloaded, a training run (H=16, 1 epoch, protection on) finished with 79.7 % accuracy. The ONNX runtime files (24 MB) are cached the first time the Image model page is used.

## 6. Layout (9:16 phone layout) and languages
The app is one 390-px-wide phone column (top bar with Offline tag and settings gear, bottom tabs Projects / Environment / Notes / Assistant; Protection lab, Find, Import, Tables and Image model are entry cards on Projects), shown in a centred 9:16 frame:
1920×1080 window → frame 607.5 × 1080 px (zoom 1.56); 1080×1920 window → frame fills the screen (zoom 2.77). Checked: Tab / Enter / Esc work, buttons and rows are ≥ 44 px (at 390 px width).
After this layout change the whole regression (section 1) and the feature tests (sections 2–5) were run again: the numbers are identical (86.95 / 85.65 / 86.95 %, 10 %, 1 repair, resume = baseline; iris 93.3 %, wine 100 %, offline 79.7 %).
Screenshots: (server path omitted) and `/desktop_1920x1080/` (every tab and key state; `_b`, `_c` are the same screen scrolled down), `/lang/` (简体中文, 繁體中文, Español, Français).
The older wide-screen sidebar version's screenshots are kept in (server path omitted).

## Not covered / honest limits
* Real GPU interruptions cannot be produced from a browser: "system interruption" is a software simulation (said on the page).
* Real-phone Safari/Firefox were not tested here; Chromium only (the code uses standard APIs: module Workers, IndexedDB, Web Crypto, service workers).
* Speech input (Web Speech API) was checked only as "button enabled / disabled by support"; recognition needs a microphone and, in Chrome, Google's cloud.

## ONNX two back-ends re-check (2026-10-21)
`tests/features.py` (RUN=['onnx']), headless Chromium 1228 on localhost: same top-5 on WASM (CPU) and WebGPU; cosine similarity 1.000000, largest difference 1.91e-5, same top-1 (tiger cat 35.5%). Timing: WASM 86 ms; WebGPU 16,867 ms (first run includes shader compile in headless; not a steady-state number). Raw result: `tests/features_results.json`.
