# Shared extension/userscript browser contract

`shared-live-scenarios.js` publishes the ordered behavioral scenario IDs used by both runtimes. The runtime adapters
bind the selected runtime, version, and exact generated live-build ID into the existing live driver while retaining
runtime-specific ratio-bar, tooltip, credential-store, transport, and Shorts-control capabilities.

`hermetic-artifact-smoke.js` makes three shared scenarios executable against both generated artifacts and one
extension-specific stale-response race executable against the generated MV3 artifact:

- `watch-render` verifies the first rendered count and visible ratio bar.
- `watch-spa-side-panel` clicks the related-video link from A to B using non-proportional 90/10 and 35/65 fixtures.
  It retains hidden copies of A's initialized controls both before and inside the new current root, replaces B's action
  container during settling, and then requires exactly one B-owned count/bar/tooltip with no RYD bars left in any
  retained tree. Readiness must remain valid for 300 ms, after which the exact invariant is sampled continuously for
  another second. The result includes first-valid latency and sample counts.
- `watch-spa-dislike-activation` reuses that exact A-to-B replacement setup, clicks the one visible B-owned Dislike
  button once, and requires one ordered `/interact/vote` plus `/interact/confirmVote` chain for B with value `-1` and
  the same confirmed 36-character user ID. Confirmation must return HTTP 200 with the literal JSON value `true`, and
  the exact one-vote/one-confirmation invariant must remain stable for another second so a duplicated listener fails.
  The userscript chain is observed through its routed fake backend; the extension chain is observed at the loopback MV3
  background server. Both paths reject unexpected or escaped traffic and page errors, unhandled rejections, and console
  errors.
- `extension-watch-spa-delayed-outgoing-failure` holds A's `/votes` response, navigates to B, releases A as malformed,
  and requires B to initialize exactly once without ever showing A's error or data. This proves that navigation queued
  during an in-flight initialization is not swallowed and that stale failures are as harmless as stale successes.

```powershell
node Extensions/e2e/hermetic-artifact-smoke.js
```

The userscript is injected into an isolated context with GM shims. The extension is loaded as a real unpacked MV3
artifact in an isolated persistent Chromium profile, and the smoke requires its service worker to start.

## Extension API safety

The extension background eagerly registers as soon as its service worker starts. That can happen before Playwright can
install a context route, so routing the production origin after `launchPersistentContext()` is not a safe hermetic
strategy.

The adapter therefore starts a loopback fake API first, copies the current `dist/chrome` artifact into an owned OS
temporary directory, replaces the exact production origin in the background bundle, and adds only the corresponding
loopback host permission. It refuses non-loopback origins or a missing replacement point. The content-script bundle is
left byte-for-byte intact: Chromium blocks HTTPS-page content scripts from reaching loopback under Private Network
Access, so a BrowserContext route fulfills its normal API-origin requests instead. That route is installed before any
YouTube page is created or navigated. The temporary background bundle also replaces the exact first-install changelog
listener with a no-op so a fresh profile cannot open the changelog and request its remote font before the catch-all is
ready. A missing exact listener fails preparation. The tracked build output is never modified. Both the derived
artifact and its browser profile are removed after the run.

A future dedicated Webpack test build can replace this derivation with the following equivalent hook:

1. Define an API-base compile constant only when a hermetic-build flag is enabled.
2. Reject a hermetic API base whose parsed hostname is not `127.0.0.1`, `::1`, or `localhost`.
3. Use that constant from `Extensions/combined/src/config.js` for both background and content-script bundles.
4. Add the loopback host match to the generated test manifest only; never to release manifests.
5. Start the fake server before building so its allocated origin is compiled into the artifact, then launch the
   persistent context.

The artifact smoke is part of `npm run test:e2e:systematic` and `npm run test:all`. Its colocated Jest tests cover the
shared catalog, runtime binding, capability validation, loopback guard, derived-artifact transformation, signal
collection, and cleanup behavior. The browser run rejects stale/current ownership mistakes, missed initialization,
duplicate activation, unexpected traffic, console errors, page errors, unhandled rejections, and a missing auxiliary
extension script.

## Authenticated live-build identity

The authenticated Brave suite is intentionally separate from this hermetic runner. `build:live:userscript` and
`build:live:extension` generate a fresh 32-character build ID, compile it into the page marker, and write the same ID to
the runtime's `live-build.json`. The live suite reads that file and requires an exact marker match before every shared
scenario. Rebuilding without reinstalling or reloading the runtime therefore fails even when the semantic version did
not change. See `Extensions/UserScript/e2e/live/README.md` for the complete preparation and safety contract.
