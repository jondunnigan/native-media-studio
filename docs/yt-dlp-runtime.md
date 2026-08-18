# yt-dlp JavaScript Runtime Note

For YouTube extraction, yt-dlp’s EJS guide states that an external JavaScript runtime is required for JavaScript challenges. The project’s Node.js 22 image meets the guide’s Node 22+ requirement; Node is enabled explicitly with `--js-runtimes node` when it is on `PATH`.

Source: [yt-dlp EJS external JavaScript runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
