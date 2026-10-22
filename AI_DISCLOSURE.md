# AI disclosure (PocketTrainer web)

This web version was written by an AI assistant (Claude, Anthropic) working in a coding session, on request of the student author, who chose the idea, the
features, and the rules (what must be safe, what must be honest). The author reviews and owns the code. Nothing here uses an AI service at run time: the Assistant is
rule-based, and "Ask ChatGPT" only opens a link with text the user has read and can change.

| Part | New or based on existing work | AI role |
|---|---|---|
| `js/mlp.js`, `js/mlp_ref.js`, `js/trainer.js` | Re-written in JavaScript from the author's own Android Kotlin code (`Mlp.kt`, `Trainer.kt`): same network, same shadow-check idea, same checkpoint idea. The two-slot atomic checkpoint, the second-worker shadow and the 1e-4 limit are new here | AI wrote the code from the author's design and checked it against the Android numbers |
| `js/train-worker.js`, `js/shadow-worker.js`, `js/train-client.js` | New | AI |
| `js/store.js`, `js/db.js`, `js/zip.js`, `js/util.js` | New (ideas from `Store.kt`) | AI |
| `js/importer.js`, `js/net.js` | Ported from the Android `GitHubImport.kt`, `Setup.kt`, `Net.kt` (same limits and rules); Hugging Face listing is the same as Android | AI |
| `js/advice.js` | Ported from `Advice.kt` | AI |
| `js/tabular.js`, `js/pages/tables.js` | New | AI |
| `js/pages/image.js` | New. Uses the open-source onnxruntime-web (MIT, vendored in `vendor/`) | AI |
| `js/pages/*.js`, `js/main.js`, `js/ui.js`, `js/chatgpt.js`, `css/app.css`, `index.html` | New; layout is the same single-column phone layout as the author's phone app, shown in a centred 9:16 frame on computers (changed on the author's request after a first wide-screen sidebar version) | AI |
| `i18n/*.json`, `tools/android_strings_table.py` | Translations table reused from the Android app; new strings in `tools/web_strings.py` | Machine-assisted translations; may contain mistakes |
| `data/train_*`, `data/test_*` | CIFAR-10 photos (Krizhevsky 2009) turned into 2048 numbers by the public ResNet50 (torchvision, BSD-3). Made by the author's earlier tool | Not AI-made data |
| `data/iris.csv`, `data/wine.csv` | UCI Machine Learning Repository (CC BY 4.0) | Public data |
| `vendor/` | onnxruntime-web 1.23.2, Microsoft, MIT | Third-party, unchanged |
| `tests/*.py` | Playwright scripts that drive a headless browser and write `tests/results.json` | AI |

The author's own work: the project idea (protect on-device training from silent errors), the rules for safe downloads, the choice of models and licenses,
reviewing and testing the result, and the honest notes shown in the app.
