# yt-dlp JavaScript Runtime Note

For YouTube extraction, yt-dlp’s EJS guide states that an external JavaScript runtime is required for JavaScript challenges. The project’s Node.js 22 image meets the guide’s Node 22+ requirement; Node is enabled explicitly with `--js-runtimes node` when it is on `PATH`.

Source: [yt-dlp EJS external JavaScript runtime guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS).

## Public-client limitation

The yt-dlp extractor documentation says its default YouTube clients are selected to avoid externally enforced PO-token requirements where possible, but some sources still require an externally supplied token or other platform access. Native Media Studio preserves those documented defaults and does not configure credential, cookie, token, or verification-bypass handling.

Source: [yt-dlp YouTube extractor guidance](https://github.com/yt-dlp/yt-dlp/wiki/extractors).

## Mid-transfer stream expiry versus access denial

YouTube media URLs are time- and session-bound. A `HTTP Error 403: Forbidden` that arrives **after** measurable transfer progress indicates an expiring or rotating stream URL, not a denial of access to the source. A 403 with no transferred bytes indicates the request itself was refused. Native Media Studio classifies these two cases separately and reports them differently, because the remedies differ.

To reduce mid-transfer expiry within supported behavior, conversions run with:

- `--continue` plus raised `--retries` and `--fragment-retries`, so a transfer resumes from the last good byte and re-resolves fresh stream URLs instead of restarting or failing outright.
- `--no-abort-on-unavailable-fragments`, so a single expiring fragment does not end the job.
- A format selector that prefers fragmented (DASH) delivery ahead of progressive delivery, because per-fragment requests are re-signed frequently.
- `--http-chunk-size 10M` with one concurrent fragment, which keeps request pressure low on constrained self-hosted links.

## `MEDIA_MAX_VIDEO_HEIGHT`

Optional. Caps the selected video height, for example `1440`. Long 2160p transfers are where mid-transfer expiry concentrates, so a ceiling helps large jobs finish inside the stream’s validity window. The **Maximum available** quality option represents explicit user intent and deliberately ignores this ceiling. Leave the variable unset for no cap.

None of this configuration supplies credentials, generates access tokens, or bypasses platform access controls.
