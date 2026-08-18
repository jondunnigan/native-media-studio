# Egg Import Compatibility

The corrected `egg-native-media-studio.json` uses the **PTDL v2** format. Its `docker_images` object now follows the `display name → Docker image` direction that Pterodactyl’s current egg parser stores directly. The previous reversed form placed the image URI in the display-name position and could cause the panel’s import or subsequent egg handling to fail.

The repository includes `scripts/pterodactyl-egg.test.mjs`, which checks the exact fields consumed by Pterodactyl Panel’s PTDL v2 parser: metadata, image map, startup configuration, install script, and every variable field. The test is based on the parser implementation in the Pterodactyl Panel source and is included in the standard `pnpm test` run.

## Corrected import steps

1. Download the newly corrected `pterodactyl/egg-native-media-studio.json` from this repository version, not an earlier copy.
2. In Pterodactyl **Admin Area → Nests → Import Egg**, select that JSON file and complete the import.
3. After the egg appears, retain the published image value `ghcr.io/jondunnigan/native-media-studio:latest`.
4. Create the server and set `DATABASE_URL` and `JWT_SECRET` in the server variables.

If a 500 error still occurs after importing this corrected file, inspect the Panel log immediately after the failed upload. A Panel-side issue such as a database write failure, PHP upload limit, or an incompatible/modified Panel installation can still produce a generic 500 response independently of the egg JSON.
