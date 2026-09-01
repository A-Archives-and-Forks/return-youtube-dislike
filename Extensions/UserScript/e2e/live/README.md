# Live YouTube smoke

This suite attaches over CDP to an already-running Brave profile. It is deliberately separate from `test:all` and CI.
The same page-level checks run in either userscript or extension mode; installation, storage, and protocol failure
coverage remain in the hermetic suites.

## Browser preparation

1. Open `brave://inspect/#remote-debugging` in the target Brave profile and enable **Allow remote debugging for this
   browser instance**. Set `RYD_CDP_ENDPOINT` to the explicit HTTP or WebSocket endpoint exposed by that Brave instance;
   `http://127.0.0.1:9222` is a common HTTP example, but use the actual port shown by Brave.
2. Use a dedicated two-item playlist containing two allowlisted public or unlisted test videos. Both must be accessible
   to the signed-in profile and must have different rendered dislike counts.
3. Enable exactly one runtime:
   - `userscript`: disable the browser extension and every other Return YouTube Dislike userscript, run
     `npm run build:live:userscript`, import
     `test-results/live-build/userscript/Return Youtube Dislike.user.js` into Tampermonkey, and enable it.
   - `extension`: disable every Return YouTube Dislike userscript and any store-installed copy of the extension, run
     `npm run build:live:extension`, then enable or reload only the unpacked extension at
     `Extensions/combined/dist/chrome`.
     Every live build receives a fresh random build ID even when its semantic version is unchanged. Import or reload the
     runtime **after the final live build command**; rebuilding again invalidates the installed copy for this smoke.
4. Keep the Brave window open and do not interact with the tab created by the suite. The suite creates, uses, and closes
   only its own tab.

Only the explicit live-test builds expose page markers containing their runtime, version, and exact build ID. Normal
production builds do not expose them. The suite reads the expected ID from the generated `live-build.json`, verifies
that the installed runtime exposes that exact ID and expected version, and verifies that the other runtime marker is
absent before every scenario. A stale installed script or extension therefore fails even when it has the same version.
There is no environment override for the build ID.

The read-only smoke still loads real YouTube and allows the installed runtime to read from the production RYD API,
including eager registration when the selected runtime has no confirmed identity. It does not mock API responses, but
it blocks production `POST /interact/*` requests before transmission as described below.

## Non-voting smoke

Set the following in PowerShell. Video IDs are the 11-character values from YouTube URLs, and the playlist URL must
start on `RYD_LIVE_WATCH_A`.

```powershell
$env:RYD_LIVE_YOUTUBE="1"
$env:RYD_LIVE_PRODUCTION_API="1"
$env:RYD_CDP_ENDPOINT="http://127.0.0.1:9222"
$env:RYD_LIVE_RUNTIME="userscript"
$env:RYD_LIVE_EXPECTED_CHANNEL="@your-test-channel"
$env:RYD_LIVE_WATCH_A="AAAAAAAAAAA"
$env:RYD_LIVE_WATCH_B="BBBBBBBBBBB"
$env:RYD_LIVE_SHORT="CCCCCCCCCCC"
$env:RYD_LIVE_PLAYLIST_URL="https://www.youtube.com/watch?v=AAAAAAAAAAA&list=PLAYLIST_ID"
# Optional overrides for the cold channel-navigation smoke. These are the defaults:
$env:RYD_LIVE_NAV_CHANNEL_URL="https://www.youtube.com/@SmashTrash"
$env:RYD_LIVE_NAV_SHORT="iKQhN7omLM4"
# Optional; the consecutive watch-sidebar stress defaults to three hops and accepts 1 through 10.
$env:RYD_LIVE_SIDEBAR_HOPS="3"
npm run test:live:youtube
```

The navigation smoke performs a real hard load and reload of `RYD_LIVE_NAV_CHANNEL_URL`, finds an exact visible link to
`RYD_LIVE_NAV_SHORT`, and clicks that link. It fails rather than falling back to direct navigation when the configured
channel no longer contains the exact card. It proves the channel-to-Short transition reused the same document, verifies
that the selected runtime initialized the current Short (including exactly one visible synthetic control in userscript
mode), clicks YouTube's visible **Next video** control, proves that transition also reused the document, and verifies a
new current video ID and initialized control. The channel-to-Short check runs first in the fresh suite tab so earlier
watch or Shorts visits cannot warm the page lifecycle it is meant to exercise.

YouTube can occasionally focus the visible **Next video** button without acting on its first trusted click. The live
driver waits five seconds for that first click, prints `LIVE_CHECKPOINT shorts-next-control.retrying`, and makes exactly
one more trusted click with the remaining 25-second navigation budget. If the URL still does not advance, the scenario
fails; it never loops or clicks a reaction control as part of this retry.

After the Shorts URL advances, the driver deliberately leaves playback running while YouTube hydrates the new reel,
the production `/votes` response arrives, and the current dislike control renders. It pauses only after those checks,
so a newly selected Short may play briefly before the `LIVE_CHECKPOINT playback.paused` message appears.

The watch-sidebar stress starts with the allowlisted `RYD_LIVE_WATCH_A`, then takes the first eligible visible
`#related` watch link on each page for the configured number of consecutive SPA hops. Previously visited IDs are
skipped. Every hop waits for the exact production `/votes?videoId=<target>` response and a rendered dislike count,
requires exactly one visible ratio bar for the selected runtime with valid reaction-control geometry, and samples that
same bar and count for four seconds to catch delayed YouTube pruning. It never clicks Like or Dislike. Deterministic
evidence paths are overwritten on each run at
`test-results/live-youtube/sidebar-stress/{runtime}-sidebar-hop-{01..N}.png`. The same scenario runs in userscript and
extension mode.

Every non-voting live scenario installs a BrowserContext deny route before it starts and aborts every production
`POST /interact/*` request. The accompanying request observer intentionally does not require a page frame, so attempts
from an extension or service worker also fail the scenario. The guard applies to the entire attached browser context;
do not use another tab in that Brave profile to react to a video while the smoke is running.

Automatic media-ended transitions for both watch pages and Shorts stay in the deterministic hermetic Playwright suite.
This production smoke intentionally exercises the visible Shorts **Next video** control only: live autoplay timing,
recommendation queues, ads, and account experiments are not stable enough to make an exact production transition a
reliable gate. The existing two-item playlist smoke continues to cover an explicit watch-page SPA transition.

The default channel dataset can drift as its public page changes. Override both variables with a channel URL and Short
that are deliberately kept together. The channel URL is restricted to a plain HTTPS `youtube.com/@handle` page or its
`featured`, `shorts`, or `videos` tab; the target must be an 11-character video ID.

An additional cold channel-to-watch scenario is available only when its exact link is deterministic on the configured
channel page. Opt in with an 11-character ID; otherwise that scenario is skipped:

```powershell
$env:RYD_LIVE_NAV_WATCH="DDDDDDDDDDD"
```

For the interactive Brave run, use `npm run test:live:youtube:interactive`. Before requesting any reaction approval,
it runs the read-only scenarios plus responsive visual checks. Enter `SKIP` at the prompt to finish without reactions.
The visual pass checks the watch-page ratio bar at widths 1280, 768, and 390. In userscript mode it also checks the
modern Shorts synthetic dislike control, its geometry, and its rendered count at those widths. In extension mode it
checks the active reel's native Like/Dislike pair at all three widths: exact action-host, button, and icon sizes;
typography; spacing; common reel ownership; ordering; and viewport containment. Cropped evidence images are written
under `test-results/live-youtube/responsive/`. If YouTube's native Like/Dislike pill is horizontally clipped by its own
mobile page overflow, the ratio bar may share only that same native left/right footprint; any extra overflow introduced
by the RYD bar still fails.

The interactive runner prints `LIVE_STAGE_START`, `LIVE_STAGE_COMPLETE`, and `LIVE_CHECKPOINT` records while it works.
In particular, `LIVE_CHECKPOINT playback.paused` means the runner deliberately paused the current YouTube video while
validating it; a stationary frame after that message is expected and is not evidence that Brave froze. Navigation,
account, runtime, control, and production `/votes` waits have their own checkpoints, so the last line identifies the
pending operation.

If a scenario fails, the runner records page errors, unhandled promise rejections, console errors, and the latest RYD
API request outcomes before closing its test tab. It writes a JSON snapshot under
`test-results/live-youtube/diagnostics/` and prints its absolute path as `LIVE_FAILURE_SNAPSHOT`. The snapshot includes
the URL, runtime markers, Shorts renderer IDs and links, action-bar and synthetic-control ownership, video paused state,
and recent API paths/statuses. Anonymous identity and proof-related query values are redacted. Preserve this file when
reporting a live-only failure; ordinary direct interactive runs otherwise have no Playwright trace.

Use `RYD_LIVE_RUNTIME="extension"` after manually switching the enabled runtime to execute the same smoke against the
extension. The expected version defaults to the local userscript candidate version or root package version; set
`RYD_LIVE_EXPECTED_VERSION` only when deliberately validating another installed build.

## Optional production reaction matrix

The reaction test is skipped by default. It covers all six Like/Dislike state transitions on `RYD_LIVE_WATCH_B` and the
allowlisted Short, asserts one logical production handshake for every transition, and returns each video to its initial
reaction state. A handshake contains one to three matching `/interact/vote` puzzle requests followed by exactly one
matching successful `/interact/confirmVote`. Any fourth vote request, changed identity/video/value, extra confirmation,
or other interaction traffic fails the run. It does not retry cleanup blindly if the state cannot be verified.
If click dispatch, the post-click state wait, or a handshake fails after a vote attempt while the UI already appears to
be back at its initial state, cleanup does not trust the UI alone: it confirms an away-and-back reaction round trip with
the same anonymous identity. A failed cleanup confirmation or identity mismatch reports the exact video URL for manual
restoration.

The matrix also captures the initial state and every post-transition state, for seven watch images and seven Shorts
images. Before each screenshot it reads both `aria-pressed` values, verifies the exact expected mutually-exclusive
state, and requires a numeric dislike count. Watch captures additionally require a visible, non-overlapping ratio bar
with sane geometry. Userscript Shorts captures reuse the strict native-vs-synthetic control geometry checks, including
the 48x78 action host, 24x24 icon, typography, spacing, active-reel ownership, and duplicate-control checks. Evidence is
written with deterministic names under
`test-results/live-youtube/reactions/{runtime}/{watch|short}-{0..6}-{neutral|liked|disliked}.png`. A failed visual check
still enters the same verified restoration path before the scenario reports the failure.

The exact live-build marker proves that the freshly generated test build is present and that the opposite runtime is
absent. It cannot detect an additional normal build of the same runtime, so the manual single-runtime preparation above
is mandatory.

Only after approving those real YouTube and production RYD writes, create a runtime-and-video-specific token immediately
before the run. It expires after two minutes and is consumed once locally, so the userscript token cannot silently
authorize a later extension run.

```powershell
$env:RYD_LIVE_VOTES="$env:RYD_LIVE_RUNTIME`:$env:RYD_LIVE_WATCH_B`:$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"
npm run test:live:youtube
Remove-Item Env:RYD_LIVE_VOTES
```

After the live run, turn off **Allow remote debugging for this browser instance** or restart the test Brave profile.
