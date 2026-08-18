# yt-dlp JavaScript Runtime Note

For YouTube extraction, yt-dlp’s EJS guide states that an external JavaScript runtime is required for JavaScript challenges. The project’s Node.js 22 image meets the guide’s Node 22+ requirement; Node is enabled explicitly with `--js-runtimes node` when it is on `PATH`.

Source: [yt-dlp EJS external JavaScript runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Public-client limitation

The yt-dlp extractor documentation says its default YouTube clients are selected to avoid externally enforced PO-token requirements where possible, but some sources still require an externally supplied token or other platform access. Native Media Studio preserves those documented defaults and does not configure credential, cookie, token, or verification-bypass handling.

Source: [yt-dlp YouTube extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/extractors).
