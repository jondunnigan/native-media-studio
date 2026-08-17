# Upstream Source Availability Notes

## Observed preview behavior

On 2026-08-17, the preview runtime successfully launched `yt-dlp` after local provisioning, which eliminated the prior `spawn yt-dlp ENOENT` error. A live inspection request then reached YouTube but received the platform message that the server must sign in to confirm it is not a bot. This demonstrates an upstream verification block rather than a missing executable or application process failure.

The preview interface exposes the URL field and the required authorization acknowledgement before inspection can begin. The guided source-availability state is verified against the same upstream rejection condition rather than a fabricated frontend-only error.

For the controlled preview check, the application submitted the openly licensed test URL only after the acknowledgement was selected. The request is an inspection-only metadata call; it does not create a conversion or retrieve a media file.

After restarting the development server, a fresh browser session loaded the source-inspection interface and entered the same controlled URL to validate that shared mutation-cache logging is suppressed for the guided availability condition.

The fresh client selected the required acknowledgement and initiated the inspection request against the known managed-preview verification block. The next verification checks both the rendered notice and absence of the prior global mutation-error log.

Validation completed: the fresh client rendered the guided “This source is unavailable from this server” notice, and the browser console contained no output after the request. The prior global `[API Mutation Error]` presentation is therefore suppressed for this intentionally handled condition.

## Source findings

The yt-dlp project’s issue discussion notes that YouTube blocks anonymous access from many datacenter IP addresses and describes IP blocks as outside yt-dlp’s control. [yt-dlp issue #12475](https://github.com/yt-dlp/yt-dlp/issues/12475)

YouTube’s Terms of Service contain restrictions on downloading content except where the service expressly authorizes it, with permission from YouTube and applicable rights holders, or as permitted by law. [YouTube Terms of Service](https://www.youtube.com/static?template=terms)

## Product decision

Native Media Studio will not add account-cookie import, account credential handling, CAPTCHA solving, or any other verification-bypass workflow. The supported path is a self-hosted deployment from a network where the authorized source is publicly accessible. The interface should identify source rejection as an upstream availability condition, not misrepresent it as a missing app dependency.
