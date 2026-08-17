# Project TODO

- [x] Define the authorized-use policy, conversion limits, and secure job lifecycle.
- [x] Add a persistent conversion-job schema with signed-token delivery metadata and expiry status.
- [x] Implement URL validation, metadata inspection, and normalized format discovery through yt-dlp.
- [x] Implement guarded video conversion with source-quality selection, container selection, and ffmpeg stream merging.
- [x] Implement guarded audio extraction with format and bitrate selection through yt-dlp and ffmpeg.
- [x] Implement server-sent progress updates with a resilient job polling fallback.
- [x] Implement 15-minute signed download links with one-time delivery and file cleanup.
- [x] Build recent session conversion history with usable expiry state and download controls.
- [x] Build the responsive Apple-inspired landing and conversion interface.
- [x] Add a container-ready Dockerfile, docker-compose configuration, and one-command self-hosting documentation.
- [x] Add tests for URL policy, download-token expiry, and job-state behavior.
- [x] Validate type checks, automated tests, local interface rendering, and production build.
- [x] Prepare a detailed reusable implementation prompt and repository handoff.
- [x] Fix active conversion progress when the server-sent event stream disconnects.
- [x] Align file cleanup with the exact 15-minute expiry boundary without early deletion.
- [x] Add lifecycle and one-time-delivery behavior tests.
- [x] Add an explicit one-time download invalidation test.
- [x] Test the real post-download invalidation flow and second-claim rejection.
