const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const {
  VIDEO_A,
  VIDEO_B,
  createFakeBackend,
  installGmEnvironment,
  openNavigationFixture,
  openWatchFixture,
} = require("../UserScript/e2e/harness");
const { assertInvariantContinuously, waitForStableInvariant } = require("./continuous-invariants");
const { LIVE_RUNTIME_PROFILES } = require("./live-runtime-adapter");
const { SHARED_LIVE_SCENARIO_IDS } = require("./shared-live-scenarios");

const REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const PRODUCTION_API_ORIGIN = "https://returnyoutubedislikeapi.com";
const ARTIFACT_SMOKE_SCENARIO_ID = "watch-render";
const ARTIFACT_WATCH_SPA_SCENARIO_ID = "watch-spa-side-panel";
const ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID = "watch-spa-dislike-activation";
const ARTIFACT_EXTENSION_DELAYED_FAILURE_SCENARIO_ID = "extension-watch-spa-delayed-outgoing-failure";
const SHARED_ARTIFACT_SCENARIO_IDS = Object.freeze([
  ARTIFACT_SMOKE_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID,
]);
const SPA_COUNTS = Object.freeze({
  [VIDEO_A]: Object.freeze({ dislikes: 10, likes: 90 }),
  [VIDEO_B]: Object.freeze({ dislikes: 65, likes: 35 }),
});
const DEFAULT_EXTENSION_ARTIFACT = path.join(REPOSITORY_ROOT, "Extensions", "combined", "dist", "chrome");
const DEFAULT_USERSCRIPT_ARTIFACT = path.join(
  REPOSITORY_ROOT,
  "Extensions",
  "UserScript",
  "Return Youtube Dislike.user.js",
);
const ZERO_DIFFICULTY_PUZZLE = {
  challenge: Buffer.alloc(16).toString("base64"),
  difficulty: 0,
};
const ARTIFACT_UNHANDLED_REJECTION_BINDING = "__rydArtifactReportUnhandledRejection";
const CONSOLE_FAILURE_TYPES = new Set(["assert", "error"]);

function serializeBrowserError(error) {
  return {
    message: error?.message ?? String(error),
    name: error?.name ?? "Error",
    stack: error?.stack ?? null,
  };
}

async function createPageSignalCollector(page, runtime) {
  assert.ok(page && typeof page.on === "function", "A Playwright page is required to collect browser signals.");
  assert.ok(["extension", "userscript"].includes(runtime), "A supported runtime is required for page diagnostics.");

  const consoleErrors = [];
  const pageErrors = [];
  const unhandledRejections = [];

  page.on("console", (message) => {
    if (!CONSOLE_FAILURE_TYPES.has(message.type())) return;
    consoleErrors.push({
      location: message.location(),
      text: message.text(),
      type: message.type(),
    });
  });
  page.on("pageerror", (error) => pageErrors.push(serializeBrowserError(error)));

  await page.exposeBinding(ARTIFACT_UNHANDLED_REJECTION_BINDING, (source, rejection) => {
    unhandledRejections.push({
      ...rejection,
      frameUrl: source.frame?.url() ?? null,
    });
  });
  await page.addInitScript(
    ({ bindingName }) => {
      globalThis.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        let serialized;
        if (reason instanceof Error || (reason && typeof reason.message === "string")) {
          serialized = {
            message: reason.message,
            name: typeof reason.name === "string" ? reason.name : "Error",
            stack: reason.stack ?? null,
          };
        } else {
          let value;
          try {
            value = JSON.stringify(reason);
          } catch {
            value = String(reason);
          }
          serialized = {
            message: value === undefined ? String(reason) : value,
            name: "UnhandledRejection",
            stack: null,
          };
        }
        void Promise.resolve(globalThis[bindingName](serialized)).catch(() => {});
      });
    },
    { bindingName: ARTIFACT_UNHANDLED_REJECTION_BINDING },
  );

  const snapshot = () => ({
    consoleErrors: consoleErrors.map((signal) => ({ ...signal, location: { ...signal.location } })),
    pageErrors: pageErrors.map((signal) => ({ ...signal })),
    runtime,
    unhandledRejections: unhandledRejections.map((signal) => ({ ...signal })),
  });

  return {
    async assertClean(scenarioId) {
      assert.equal(typeof scenarioId, "string", "A scenario id is required when checking page signals.");
      await page.evaluate(() => new Promise((resolve) => globalThis.setTimeout(resolve, 0)));
      const diagnostics = snapshot();
      const failureCount =
        diagnostics.consoleErrors.length + diagnostics.pageErrors.length + diagnostics.unhandledRejections.length;
      assert.equal(
        failureCount,
        0,
        `${runtime} emitted unexpected browser signals during ${scenarioId}: ${JSON.stringify(diagnostics, null, 2)}`,
      );
      return diagnostics;
    },
    snapshot,
  };
}

function assertLoopbackOrigin(value) {
  const url = new URL(value);
  assert.ok(["http:", "https:"].includes(url.protocol), "The hermetic API origin must use HTTP or HTTPS.");
  assert.ok(
    ["127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname),
    `Refusing to prepare a hermetic extension artifact for non-loopback origin ${url.origin}.`,
  );
  assert.equal(url.pathname, "/", "The hermetic API value must be an origin without a path.");
  return url.origin;
}

function removeOwnedTemporaryDirectory(directory, prefix) {
  if (!directory) return;
  const resolvedDirectory = path.resolve(directory);
  const resolvedTemporaryRoot = path.resolve(os.tmpdir());
  assert.equal(path.dirname(resolvedDirectory), resolvedTemporaryRoot, "Refusing to remove a non-temporary directory.");
  assert.ok(path.basename(resolvedDirectory).startsWith(prefix), "Refusing to remove an unowned temporary directory.");
  fs.rmSync(resolvedDirectory, { force: true, recursive: true });
}

function prepareHermeticExtensionArtifact(sourceDirectory, apiOrigin) {
  const origin = assertLoopbackOrigin(apiOrigin);
  const source = path.resolve(sourceDirectory);
  for (const requiredFile of ["manifest.json", "menu-fixer.js", "ryd.background.js", "ryd.content-script.js"]) {
    if (!fs.existsSync(path.join(source, requiredFile))) {
      throw new Error(`The extension artifact is missing ${requiredFile}: ${source}`);
    }
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ryd-mv3-e2e-"));
  const extensionDirectory = path.join(temporaryRoot, "extension");
  fs.cpSync(source, extensionDirectory, { recursive: true });

  const backgroundBundlePath = path.join(extensionDirectory, "ryd.background.js");
  const backgroundSource = fs.readFileSync(backgroundBundlePath, "utf8");
  const replacementCount = backgroundSource.split(PRODUCTION_API_ORIGIN).length - 1;
  if (replacementCount < 1) {
    removeOwnedTemporaryDirectory(temporaryRoot, "ryd-mv3-e2e-");
    throw new Error("ryd.background.js has no production API origin to replace; rebuild the extension before testing.");
  }
  const transformedBackground = backgroundSource.replaceAll(PRODUCTION_API_ORIGIN, origin);
  assert.equal(
    transformedBackground.includes(PRODUCTION_API_ORIGIN),
    false,
    "ryd.background.js still contains the production API origin after transformation.",
  );
  const changelogListener = `api.runtime.onInstalled.addListener((details) => {
  maybeShowChangelog(details);
});`;
  if (!transformedBackground.includes(changelogListener)) {
    removeOwnedTemporaryDirectory(temporaryRoot, "ryd-mv3-e2e-");
    throw new Error("ryd.background.js has no recognized first-install changelog listener to suppress.");
  }
  const hermeticBackground = transformedBackground.replace(
    changelogListener,
    "api.runtime.onInstalled.addListener(() => {});",
  );
  fs.writeFileSync(backgroundBundlePath, hermeticBackground);

  const contentScriptPath = path.join(extensionDirectory, "ryd.content-script.js");
  const contentScriptSource = fs.readFileSync(contentScriptPath, "utf8");
  if (!contentScriptSource.includes(PRODUCTION_API_ORIGIN)) {
    removeOwnedTemporaryDirectory(temporaryRoot, "ryd-mv3-e2e-");
    throw new Error("ryd.content-script.js has no production API origin for the pre-navigation route to intercept.");
  }

  const manifestPath = path.join(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const apiUrl = new URL(origin);
  const loopbackPermission = `${apiUrl.protocol}//${apiUrl.hostname}/*`;
  manifest.host_permissions = [...new Set([...(manifest.host_permissions ?? []), loopbackPermission])];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    extensionDirectory,
    loopbackPermission,
    replacements: { "ryd.background.js": replacementCount, firstInstallChangelogListener: 1 },
    routedBundles: ["ryd.content-script.js"],
    temporaryRoot,
  };
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        resolve(text);
      }
    });
    request.on("error", reject);
  });
}

async function startHermeticApiServer({ dislikes = 25, likes = 100 } = {}) {
  const records = [];
  const unexpectedRequests = [];
  const server = http.createServer(async (request, response) => {
    const origin = `http://${request.headers.host}`;
    const url = new URL(request.url, origin);
    const record = {
      body: await readRequestBody(request),
      method: request.method,
      pathname: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
    };
    records.push(record);

    const headers = {
      "access-control-allow-headers": "Accept, Content-Type",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-origin": "*",
      "content-type": "application/json; charset=utf-8",
    };
    if (request.method === "OPTIONS") {
      record.respondedAt = Date.now();
      record.responseBody = null;
      record.responseStatus = 204;
      response.writeHead(204, headers);
      response.end();
      return;
    }

    let body;
    if (request.method === "GET" && url.pathname === "/configs/selectors") body = {};
    else if (request.method === "GET" && url.pathname === "/votes") body = { dislikes, likes, rating: 4.5 };
    else if (request.method === "GET" && url.pathname === "/puzzle/registration") body = ZERO_DIFFICULTY_PUZZLE;
    else if (request.method === "POST" && url.pathname === "/puzzle/registration") body = true;
    else if (request.method === "POST" && url.pathname === "/interact/vote") body = ZERO_DIFFICULTY_PUZZLE;
    else if (request.method === "POST" && url.pathname === "/interact/confirmVote") body = true;
    else {
      unexpectedRequests.push(record);
      record.respondedAt = Date.now();
      record.responseBody = { error: "unexpected hermetic request" };
      record.responseStatus = 404;
      response.writeHead(404, headers);
      response.end(JSON.stringify(record.responseBody));
      return;
    }

    record.respondedAt = Date.now();
    record.responseBody = body;
    record.responseStatus = 200;
    response.writeHead(200, headers);
    response.end(JSON.stringify(body));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    origin: `http://127.0.0.1:${address.port}`,
    records,
    unexpectedRequests,
  };
}

async function installArtifactRoutes(context, backend, { passthroughOrigin = null } = {}) {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:") {
      await route.continue();
      return;
    }
    if (passthroughOrigin && url.origin === passthroughOrigin) {
      await route.continue();
      return;
    }
    await backend.handle(route);
  });
}

async function waitForWatchResult(page, runtime, videoId) {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  await page.waitForFunction(
    ({ rateBarContainer, videoId: expectedVideoId }) => {
      const watch = document.querySelector(`ytd-watch-flexy[video-id="${expectedVideoId}"]`);
      const dislikeText = watch
        ? document.querySelector('[data-ryd-role="dislike"] #text, [data-ryd-role="dislike"] [role="text"]')
        : null;
      const count = (dislikeText?.textContent ?? "").replace(/\s+/g, " ").trim();
      const bar = document.querySelector(rateBarContainer);
      return watch && bar && /\d/.test(count);
    },
    { rateBarContainer: profile.selectors.rateBarContainer, videoId },
  );

  return page.evaluate(
    ({ rateBar, rateBarContainer, videoId: expectedVideoId }) => {
      const dislikeText = document.querySelector(
        '[data-ryd-role="dislike"] #text, [data-ryd-role="dislike"] [role="text"]',
      );
      const container = document.querySelector(rateBarContainer);
      const fill = document.querySelector(rateBar);
      const visible = (element) => {
        const box = element?.getBoundingClientRect();
        return Boolean(box && box.width > 0 && box.height > 0);
      };
      return {
        count: (dislikeText?.textContent ?? "").replace(/\s+/g, " ").trim(),
        fillRatio:
          container && fill && container.getBoundingClientRect().width > 0
            ? fill.getBoundingClientRect().width / container.getBoundingClientRect().width
            : null,
        fillVisible: visible(fill),
        rateBarVisible: visible(container),
        videoId: document.querySelector("ytd-watch-flexy")?.getAttribute("video-id") ?? null,
        expectedVideoId,
      };
    },
    { ...profile.selectors, videoId },
  );
}

async function prepareSpaOutgoingControls(page, fromVideoId) {
  return page.evaluate((expectedVideoId) => {
    const fixturePage = document.querySelector("#fixture-page");
    const currentSection = fixturePage?.querySelector(
      `[data-fixture-page-kind="watch"][data-fixture-video-id="${expectedVideoId}"]`,
    );
    const outgoingTopRow = currentSection?.querySelector("#top-row");
    if (!fixturePage || !currentSection || !outgoingTopRow) {
      throw new Error(`The outgoing watch fixture for ${expectedVideoId} is not ready.`);
    }
    if (!outgoingTopRow.querySelector(".ryd-tooltip")) {
      throw new Error(`The outgoing watch fixture for ${expectedVideoId} has no initialized ratio bar.`);
    }

    const beforeHolder = document.createElement("div");
    beforeHolder.hidden = true;
    beforeHolder.setAttribute("data-artifact-outgoing-position", "before-current-root");
    beforeHolder.setAttribute("data-artifact-outgoing-video-id", expectedVideoId);
    beforeHolder.appendChild(outgoingTopRow.cloneNode(true));
    fixturePage.before(beforeHolder);

    globalThis.__artifactInsideOutgoingActions = outgoingTopRow.cloneNode(true);
    return {
      beforeBarCount: beforeHolder.querySelectorAll(".ryd-tooltip").length,
      fromVideoId: expectedVideoId,
    };
  }, fromVideoId);
}

async function preparePendingSpaOutgoingControls(page, fromVideoId) {
  return page.evaluate((expectedVideoId) => {
    const fixturePage = document.querySelector("#fixture-page");
    const currentSection = fixturePage?.querySelector(
      `[data-fixture-page-kind="watch"][data-fixture-video-id="${expectedVideoId}"]`,
    );
    const outgoingTopRow = currentSection?.querySelector("#top-row");
    if (!fixturePage || !currentSection || !outgoingTopRow) {
      throw new Error(`The pending outgoing watch fixture for ${expectedVideoId} is not ready.`);
    }

    const beforeHolder = document.createElement("div");
    beforeHolder.hidden = true;
    beforeHolder.setAttribute("data-artifact-outgoing-position", "before-current-root");
    beforeHolder.setAttribute("data-artifact-outgoing-video-id", expectedVideoId);
    beforeHolder.appendChild(outgoingTopRow.cloneNode(true));
    fixturePage.before(beforeHolder);

    globalThis.__artifactInsideOutgoingActions = outgoingTopRow.cloneNode(true);
    return {
      beforeBarCount: beforeHolder.querySelectorAll(".ryd-tooltip").length,
      fromVideoId: expectedVideoId,
    };
  }, fromVideoId);
}

async function finishSpaDestinationReplacement(page, toVideoId) {
  return page.evaluate(
    ({ expectedLikes, expectedVideoId }) => {
      const currentSection = document.querySelector(
        `#fixture-page [data-fixture-page-kind="watch"][data-fixture-video-id="${expectedVideoId}"]`,
      );
      if (!currentSection) throw new Error(`The destination watch fixture for ${expectedVideoId} is missing.`);
      if (!globalThis.__artifactInsideOutgoingActions) {
        throw new Error("The retained inside-current-root outgoing controls are missing.");
      }

      const insideHolder = document.createElement("div");
      insideHolder.hidden = true;
      insideHolder.setAttribute("data-artifact-outgoing-position", "inside-current-root");
      insideHolder.setAttribute(
        "data-artifact-outgoing-video-id",
        globalThis.__artifactInsideOutgoingActions
          .querySelector("[data-fixture-control-video-id]")
          ?.getAttribute("data-fixture-control-video-id") ?? "unknown",
      );
      insideHolder.appendChild(globalThis.__artifactInsideOutgoingActions);
      currentSection.appendChild(insideHolder);
      delete globalThis.__artifactInsideOutgoingActions;

      const replaced = globalThis.__navigationFixture.replaceCurrentWatchActions({ retainOutgoing: true });
      if (!replaced) throw new Error(`The destination action container for ${expectedVideoId} was not replaced.`);
      const destinationActions = currentSection.querySelector(
        `#top-level-buttons-computed[data-fixture-watch-actions-replacement="${expectedVideoId}"]`,
      );
      const likeButton = destinationActions?.querySelector('[data-ryd-role="like"] button');
      if (!likeButton) throw new Error(`The replacement controls for ${expectedVideoId} have no Like button.`);
      likeButton.setAttribute("aria-label", `${expectedLikes} likes`);
      const likeText = likeButton.querySelector("#text, [role='text']");
      if (likeText) likeText.textContent = String(expectedLikes);
      return { destinationReplaced: true, insideBarCount: insideHolder.querySelectorAll(".ryd-tooltip").length };
    },
    { expectedLikes: SPA_COUNTS[toVideoId].likes, expectedVideoId: toVideoId },
  );
}

async function observeSpaDestinationDislikeText(page, videoId) {
  await page.evaluate((expectedVideoId) => {
    globalThis.__artifactDestinationDislikeTextObserver?.disconnect();
    const currentRoot = document.querySelector(
      `#fixture-page [data-fixture-page-kind="watch"][data-fixture-video-id="${expectedVideoId}"]`,
    );
    const count = currentRoot?.querySelector(
      `#top-level-buttons-computed[data-fixture-watch-actions-replacement="${expectedVideoId}"] ` +
        `[data-fixture-control-video-id="${expectedVideoId}"] [data-ryd-role="dislike"] #text`,
    );
    if (!count) throw new Error(`The destination dislike text for ${expectedVideoId} is missing.`);
    const read = () => (count.textContent ?? "").replace(/\s+/g, " ").trim();
    globalThis.__artifactDestinationDislikeTexts = [read()];
    globalThis.__artifactDestinationDislikeTextObserver = new MutationObserver(() => {
      globalThis.__artifactDestinationDislikeTexts.push(read());
    });
    globalThis.__artifactDestinationDislikeTextObserver.observe(count, {
      characterData: true,
      childList: true,
      subtree: true,
    });
  }, videoId);
}

async function readSpaWatchSnapshot(page, runtime, fromVideoId, toVideoId) {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  return page.evaluate(
    ({ fromVideoId: outgoingVideoId, profile: runtimeProfile, toVideoId: destinationVideoId }) => {
      const normalizedText = (element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim();
      const visibleBox = (element) => {
        const box = element?.getBoundingClientRect();
        return box && box.width > 0 && box.height > 0
          ? { height: box.height, width: box.width, x: box.x, y: box.y }
          : null;
      };
      const retainedState = (selector) => {
        const holder = document.querySelector(selector);
        return {
          barCount: holder?.querySelectorAll(runtimeProfile.selectors.rateBar).length ?? -1,
          containerCount: holder?.querySelectorAll(runtimeProfile.selectors.rateBarContainer).length ?? -1,
          controlVideoIds: [...(holder?.querySelectorAll("[data-fixture-control-video-id]") ?? [])].map((control) =>
            control.getAttribute("data-fixture-control-video-id"),
          ),
          hidden: holder?.hidden === true,
          present: holder !== null,
          wrapperCount: holder?.querySelectorAll(".ryd-tooltip").length ?? -1,
        };
      };

      const currentRoot = document.querySelector(
        `#fixture-page [data-fixture-page-kind="watch"][data-fixture-video-id="${destinationVideoId}"]`,
      );
      const actionHost = currentRoot?.querySelector(
        `#top-level-buttons-computed[data-fixture-watch-actions-replacement="${destinationVideoId}"]`,
      );
      const controls = actionHost?.querySelector(`[data-fixture-control-video-id="${destinationVideoId}"]`);
      const countElement = controls?.querySelector(
        '[data-ryd-role="dislike"] #text, [data-ryd-role="dislike"] [role="text"]',
      );
      const wrapper = actionHost?.querySelector(":scope > .ryd-tooltip");
      const container = wrapper?.querySelector(runtimeProfile.selectors.rateBarContainer);
      const fill = container?.querySelector(runtimeProfile.selectors.rateBar);
      const tooltip = wrapper?.querySelector(runtimeProfile.selectors.tooltipContent);
      const containerBox = visibleBox(container);
      const fillBox = visibleBox(fill);
      const currentVideoId = currentRoot?.querySelector("ytd-watch-flexy")?.getAttribute("video-id") ?? null;
      const url = new URL(location.href);

      return {
        actionHostCount:
          currentRoot?.querySelectorAll(
            `#top-level-buttons-computed[data-fixture-watch-actions-replacement="${destinationVideoId}"]`,
          ).length ?? 0,
        barOwnedByDestination: Boolean(fill && fill.closest("#top-level-buttons-computed") === actionHost),
        containerOwnedByDestination: Boolean(
          container && container.closest("#top-level-buttons-computed") === actionHost,
        ),
        count: normalizedText(countElement),
        currentVideoId,
        destinationBarCount: actionHost?.querySelectorAll(runtimeProfile.selectors.rateBar).length ?? 0,
        destinationContainerCount: actionHost?.querySelectorAll(runtimeProfile.selectors.rateBarContainer).length ?? 0,
        destinationControlCount:
          actionHost?.querySelectorAll(`[data-fixture-control-video-id="${destinationVideoId}"]`).length ?? 0,
        destinationWrapperCount: actionHost?.querySelectorAll(":scope > .ryd-tooltip").length ?? 0,
        fillRatio: containerBox && fillBox ? fillBox.width / containerBox.width : null,
        globalBarCount: document.querySelectorAll(runtimeProfile.selectors.rateBar).length,
        globalContainerCount: document.querySelectorAll(runtimeProfile.selectors.rateBarContainer).length,
        globalWrapperCount: document.querySelectorAll(".ryd-tooltip").length,
        insideOutgoing: retainedState(
          `[data-artifact-outgoing-position="inside-current-root"][data-artifact-outgoing-video-id="${outgoingVideoId}"]`,
        ),
        retainedDestination: retainedState(`[data-fixture-retained-settling-watch-actions="${destinationVideoId}"]`),
        retainedBefore: retainedState(
          `[data-artifact-outgoing-position="before-current-root"][data-artifact-outgoing-video-id="${outgoingVideoId}"]`,
        ),
        tooltipText: normalizedText(tooltip),
        urlVideoId: url.pathname === "/watch" ? url.searchParams.get("v") : null,
        visibleContainer: containerBox !== null,
        visibleFill: fillBox !== null,
      };
    },
    { fromVideoId, profile, toVideoId },
  );
}

function isSpaDestinationValid(snapshot, { expectedCount, expectedRatio, fromVideoId, toVideoId }) {
  const outgoingRetained = [snapshot.retainedBefore, snapshot.insideOutgoing];
  const hasNoRydBar = (state) =>
    state.present === true &&
    state.hidden === true &&
    state.wrapperCount === 0 &&
    state.containerCount === 0 &&
    state.barCount === 0;
  return (
    snapshot.urlVideoId === toVideoId &&
    snapshot.currentVideoId === toVideoId &&
    snapshot.actionHostCount === 1 &&
    snapshot.destinationControlCount === 1 &&
    snapshot.destinationWrapperCount === 1 &&
    snapshot.destinationContainerCount === 1 &&
    snapshot.destinationBarCount === 1 &&
    snapshot.globalWrapperCount === 1 &&
    snapshot.globalContainerCount === 1 &&
    snapshot.globalBarCount === 1 &&
    snapshot.barOwnedByDestination === true &&
    snapshot.containerOwnedByDestination === true &&
    snapshot.visibleContainer === true &&
    snapshot.visibleFill === true &&
    snapshot.count === String(expectedCount) &&
    snapshot.tooltipText.includes(`${SPA_COUNTS[toVideoId].likes} / ${expectedCount}`) &&
    Number.isFinite(snapshot.fillRatio) &&
    Math.abs(snapshot.fillRatio - expectedRatio) <= 0.02 &&
    outgoingRetained.every((state) => hasNoRydBar(state) && state.controlVideoIds.includes(fromVideoId)) &&
    hasNoRydBar(snapshot.retainedDestination) &&
    snapshot.retainedDestination.controlVideoIds.includes(toVideoId)
  );
}

async function clickSpaDestinationDislike(page, videoId) {
  const selector =
    `#fixture-page [data-fixture-page-kind="watch"][data-fixture-video-id="${videoId}"] ` +
    `#top-level-buttons-computed[data-fixture-watch-actions-replacement="${videoId}"] ` +
    `[data-fixture-control-video-id="${videoId}"] [data-ryd-role="dislike"] button`;
  const buttons = page.locator(selector);
  assert.equal(await buttons.count(), 1, `Expected exactly one destination Dislike activation target for ${videoId}.`);
  const button = buttons.first();
  assert.equal(
    await button.isVisible(),
    true,
    `The destination Dislike activation target for ${videoId} is not visible.`,
  );
  const ariaPressedBefore = await button.getAttribute("aria-pressed");
  await button.click();
  return { ariaPressedBefore, selector, videoId };
}

function interactionRecordsSince(records, startIndex) {
  return records
    .slice(startIndex)
    .filter(
      (record) => record.method === "POST" && ["/interact/vote", "/interact/confirmVote"].includes(record.pathname),
    );
}

function readArtifactVoteHandshake(records, startIndex, videoId, value) {
  const interactions = interactionRecordsSince(records, startIndex);
  const votes = interactions.filter((record) => record.pathname === "/interact/vote");
  const confirmations = interactions.filter((record) => record.pathname === "/interact/confirmVote");
  const vote = votes[0] ?? null;
  const confirmation = confirmations[0] ?? null;
  const userId = vote?.body?.userId ?? null;
  return {
    confirmation: confirmation
      ? {
          body: confirmation.body,
          responded: Number.isFinite(confirmation.respondedAt),
          responseBody: confirmation.responseBody,
          responseStatus: confirmation.responseStatus,
        }
      : null,
    confirmationCount: confirmations.length,
    expectedValue: value,
    expectedVideoId: videoId,
    interactionPaths: interactions.map((record) => record.pathname),
    interactionCount: interactions.length,
    sharedUserId:
      typeof userId === "string" && userId.length > 0 && confirmation?.body?.userId === userId ? userId : null,
    vote: vote ? { body: vote.body } : null,
    voteCount: votes.length,
  };
}

function enqueueRecordedSuccessfulVoteResponses(backend) {
  backend.enqueue("POST", "/interact/vote", (record) => {
    record.responseBody = ZERO_DIFFICULTY_PUZZLE;
    record.responseStatus = 200;
    return { body: record.responseBody };
  });
  backend.enqueue("POST", "/interact/confirmVote", (record) => {
    record.responseBody = true;
    record.responseStatus = 200;
    return { body: record.responseBody };
  });
}

function isArtifactVoteHandshakeValid(snapshot) {
  if (
    snapshot.interactionCount !== 2 ||
    snapshot.voteCount !== 1 ||
    snapshot.confirmationCount !== 1 ||
    typeof snapshot.sharedUserId !== "string" ||
    !/^[A-Za-z0-9]{36}$/.test(snapshot.sharedUserId) ||
    snapshot.interactionPaths?.join(",") !== "/interact/vote,/interact/confirmVote" ||
    snapshot.confirmation?.responded !== true ||
    snapshot.confirmation?.responseStatus !== 200 ||
    snapshot.confirmation?.responseBody !== true
  ) {
    return false;
  }
  const voteBody = snapshot.vote?.body;
  const confirmationBody = snapshot.confirmation?.body;
  let solutionBytes = null;
  try {
    solutionBytes = Buffer.from(confirmationBody?.solution ?? "", "base64");
  } catch {
    // The validity result below reports malformed proof material without throwing from a polling predicate.
  }
  return (
    voteBody?.userId === snapshot.sharedUserId &&
    voteBody?.videoId === snapshot.expectedVideoId &&
    voteBody?.value === snapshot.expectedValue &&
    Object.keys(voteBody).sort().join(",") === "userId,value,videoId" &&
    confirmationBody?.userId === snapshot.sharedUserId &&
    confirmationBody?.videoId === snapshot.expectedVideoId &&
    Object.keys(confirmationBody).sort().join(",") === "solution,userId,videoId" &&
    typeof confirmationBody?.solution === "string" &&
    solutionBytes?.length === 4
  );
}

function assertSpaStatsTraffic(backend, fromVideoId, toVideoId) {
  const votesFor = (videoId) =>
    backend.requestsFor("GET", "/votes").filter((request) => request.query.videoId === videoId);
  assert.equal(votesFor(fromVideoId).length, 1, `Expected one stats request for outgoing video ${fromVideoId}.`);
  assert.equal(votesFor(toVideoId).length, 1, `Expected one stats request for destination video ${toVideoId}.`);
  assert.deepEqual(
    backend.blockedRequests,
    [],
    `The SPA scenario attempted unexpected network traffic: ${JSON.stringify(backend.blockedRequests)}`,
  );
  return { fromVideoRequests: votesFor(fromVideoId).length, toVideoRequests: votesFor(toVideoId).length };
}

function assertSpaBackendTraffic(backend, fromVideoId, toVideoId) {
  const stats = assertSpaStatsTraffic(backend, fromVideoId, toVideoId);
  assert.equal(backend.requestsFor("POST", "/interact/vote").length, 0, "The read-only SPA scenario submitted a vote.");
  assert.equal(
    backend.requestsFor("POST", "/interact/confirmVote").length,
    0,
    "The read-only SPA scenario confirmed a vote.",
  );
  return {
    ...stats,
    interactionRequests: 0,
  };
}

function readSpaTraffic(backend) {
  return backend.requests.map(({ method, pathname, query }) => ({ method, pathname, query }));
}

async function readWatchDiagnostics(page, runtime, videoId) {
  const profile = LIVE_RUNTIME_PROFILES[runtime];
  return page.evaluate(
    ({ rateBar, rateBarContainer, videoId: expectedVideoId }) => ({
      bodyText: (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
      currentVideoId: document.querySelector("ytd-watch-flexy")?.getAttribute("video-id") ?? null,
      dislikeText:
        document
          .querySelector('[data-ryd-role="dislike"] #text, [data-ryd-role="dislike"] [role="text"]')
          ?.textContent?.trim() ?? null,
      expectedVideoId,
      fillPresent: document.querySelector(rateBar) !== null,
      rateBarPresent: document.querySelector(rateBarContainer) !== null,
      setStateCalls: globalThis.__rydSetStateCalls ?? 0,
    }),
    { ...profile.selectors, videoId },
  );
}

class HermeticUserscriptArtifactAdapter {
  constructor({
    artifactPath = DEFAULT_USERSCRIPT_ARTIFACT,
    backendOptions = {},
    browserType = chromium,
    headless = true,
  } = {}) {
    this.artifactPath = path.resolve(artifactPath);
    this.backendOptions = backendOptions;
    this.browserType = browserType;
    this.headless = headless;
    this.profile = LIVE_RUNTIME_PROFILES.userscript;
    this.runtime = "userscript";
  }

  async start() {
    if (!fs.existsSync(this.artifactPath)) throw new Error(`Generated userscript is missing: ${this.artifactPath}`);
    this.backend = createFakeBackend(this.backendOptions);
    enqueueRecordedSuccessfulVoteResponses(this.backend);
    this.browser = await this.browserType.launch({ headless: this.headless });
    this.context = await this.browser.newContext({ serviceWorkers: "block" });
    await installGmEnvironment(this.context);
    await installArtifactRoutes(this.context, this.backend);
    this.page = await this.context.newPage();
    this.pageSignals = await createPageSignalCollector(this.page, this.runtime);
  }

  async openWatch(videoId) {
    await openWatchFixture(this.page, videoId);
    await this.page.addScriptTag({ path: this.artifactPath });
  }

  async openSpaWatch(videoId) {
    await openNavigationFixture(this.page, { pageKind: "watch", videoId });
    await this.page.addScriptTag({ path: this.artifactPath });
  }

  async navigateSpaWatch(fromVideoId, toVideoId) {
    const outgoing = await prepareSpaOutgoingControls(this.page, fromVideoId);
    await this.page.locator("#watch-related").click();
    const destination = await finishSpaDestinationReplacement(this.page, toVideoId);
    return { destination, outgoing };
  }

  async activateSpaDislike(videoId) {
    const interactionStartIndex = this.backend.requests.length;
    const activation = await clickSpaDestinationDislike(this.page, videoId);
    return { ...activation, interactionStartIndex };
  }

  async readSpaVoteHandshake(interactionStartIndex, videoId, value) {
    return readArtifactVoteHandshake(this.backend.requests, interactionStartIndex, videoId, value);
  }

  async assertSpaVoteNetwork(fromVideoId, toVideoId, interactionStartIndex) {
    const stats = assertSpaStatsTraffic(this.backend, fromVideoId, toVideoId);
    const requestsAfterActivation = this.backend.requests.slice(interactionStartIndex);
    assert.ok(
      requestsAfterActivation.every(
        (record) => record.method === "POST" && ["/interact/vote", "/interact/confirmVote"].includes(record.pathname),
      ),
      `The userscript made unexpected requests after activation: ${JSON.stringify(
        readSpaTraffic({
          requests: requestsAfterActivation,
        }),
      )}`,
    );
    return stats;
  }

  async readSpaWatchSnapshot(fromVideoId, toVideoId) {
    return readSpaWatchSnapshot(this.page, this.runtime, fromVideoId, toVideoId);
  }

  async assertSpaNetwork(fromVideoId, toVideoId) {
    return assertSpaBackendTraffic(this.backend, fromVideoId, toVideoId);
  }

  async readSpaTraffic() {
    return { routedRequests: readSpaTraffic(this.backend) };
  }

  async waitForWatchResult(videoId) {
    let result;
    try {
      result = await waitForWatchResult(this.page, this.runtime, videoId);
    } catch (error) {
      const diagnostics = {
        page: await readWatchDiagnostics(this.page, this.runtime, videoId),
        pageSignals: this.pageSignals.snapshot(),
        productionOriginRequests: this.backend.requests,
      };
      throw new Error(`${error.message}\nUserscript artifact diagnostics: ${JSON.stringify(diagnostics, null, 2)}`, {
        cause: error,
      });
    }
    assert.equal(this.backend.blockedRequests.length, 0, "The userscript attempted unexpected network traffic.");
    return result;
  }

  async assertNoPageSignals(scenarioId) {
    return this.pageSignals.assertClean(scenarioId);
  }

  async close() {
    await this.context?.close();
    await this.browser?.close();
  }
}

class HermeticExtensionArtifactAdapter {
  constructor({
    apiServer,
    artifactDirectory = DEFAULT_EXTENSION_ARTIFACT,
    backendOptions = {},
    browserType = chromium,
    channel = "chromium",
    headless = true,
  } = {}) {
    if (!apiServer?.origin) throw new TypeError("The extension adapter requires a running hermetic API server.");
    this.apiServer = apiServer;
    this.artifactDirectory = path.resolve(artifactDirectory);
    this.backendOptions = backendOptions;
    this.browserType = browserType;
    this.channel = channel;
    this.headless = headless;
    this.profile = LIVE_RUNTIME_PROFILES.extension;
    this.runtime = "extension";
  }

  async start() {
    this.backend = createFakeBackend(this.backendOptions);
    this.backend.enqueue("GET", "/configs/selectors", {
      body: { rateBar: { oldDesignActions: ["#top-level-buttons-computed"] } },
    });
    this.apiRecordStart = this.apiServer.records.length;
    this.preparedArtifact = prepareHermeticExtensionArtifact(this.artifactDirectory, this.apiServer.origin);
    this.profileDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ryd-mv3-profile-"));
    const extensionPath = this.preparedArtifact.extensionDirectory;
    this.context = await this.browserType.launchPersistentContext(this.profileDirectory, {
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, "--no-first-run"],
      channel: this.channel,
      headless: this.headless,
      serviceWorkers: "allow",
    });
    await installArtifactRoutes(this.context, this.backend, { passthroughOrigin: this.apiServer.origin });

    this.worker = this.context.serviceWorkers()[0];
    if (!this.worker) this.worker = await this.context.waitForEvent("serviceworker", { timeout: 15_000 });
    assert.match(this.worker.url(), /^chrome-extension:\/\//, "The real MV3 background worker did not start.");
    this.page = await this.context.newPage();
    this.pageSignals = await createPageSignalCollector(this.page, this.runtime);
  }

  async openWatch(videoId) {
    await openWatchFixture(this.page, videoId);
  }

  async openSpaWatch(videoId) {
    await openNavigationFixture(this.page, { pageKind: "watch", videoId });
  }

  async navigateSpaWatch(fromVideoId, toVideoId) {
    const outgoing = await prepareSpaOutgoingControls(this.page, fromVideoId);
    await this.page.locator("#watch-related").click();
    const destination = await finishSpaDestinationReplacement(this.page, toVideoId);
    return { destination, outgoing };
  }

  deferNextStatsRequest() {
    return this.backend.defer("GET", "/votes");
  }

  async navigateSpaWatchWhilePending(fromVideoId, toVideoId) {
    const outgoing = await preparePendingSpaOutgoingControls(this.page, fromVideoId);
    await this.page.locator("#watch-related").click();
    const destination = await finishSpaDestinationReplacement(this.page, toVideoId);
    await observeSpaDestinationDislikeText(this.page, toVideoId);
    return { destination, outgoing };
  }

  async readDestinationDislikeTextHistory() {
    return this.page.evaluate(() => [...(globalThis.__artifactDestinationDislikeTexts ?? [])]);
  }

  readStatsRequestTimings() {
    return this.backend.requestsFor("GET", "/votes").map(({ at, query, respondedAt }) => ({
      at,
      query: { ...query },
      respondedAt,
    }));
  }

  async activateSpaDislike(videoId) {
    const interactionStartIndex = this.apiServer.records.length;
    const activation = await clickSpaDestinationDislike(this.page, videoId);
    return { ...activation, interactionStartIndex };
  }

  async readSpaVoteHandshake(interactionStartIndex, videoId, value) {
    return readArtifactVoteHandshake(this.apiServer.records, interactionStartIndex, videoId, value);
  }

  async assertSpaVoteNetwork(fromVideoId, toVideoId, interactionStartIndex) {
    const stats = assertSpaStatsTraffic(this.backend, fromVideoId, toVideoId);
    assert.equal(
      this.backend.requestsFor("POST", "/interact/vote").length,
      0,
      "The extension content script bypassed its background vote transport.",
    );
    assert.equal(
      this.backend.requestsFor("POST", "/interact/confirmVote").length,
      0,
      "The extension content script bypassed its background confirmation transport.",
    );
    const backgroundAfterActivation = this.apiServer.records
      .slice(interactionStartIndex)
      .filter((record) => record.method !== "OPTIONS");
    assert.ok(
      backgroundAfterActivation.every(
        (record) => record.method === "POST" && ["/interact/vote", "/interact/confirmVote"].includes(record.pathname),
      ),
      `The extension background made unexpected requests after activation: ${JSON.stringify(backgroundAfterActivation)}`,
    );
    assert.equal(this.apiServer.unexpectedRequests.length, 0, "The extension made an unexpected test-server request.");
    return stats;
  }

  async readSpaWatchSnapshot(fromVideoId, toVideoId) {
    return readSpaWatchSnapshot(this.page, this.runtime, fromVideoId, toVideoId);
  }

  async assertSpaNetwork(fromVideoId, toVideoId) {
    const traffic = assertSpaBackendTraffic(this.backend, fromVideoId, toVideoId);
    assert.equal(this.apiServer.unexpectedRequests.length, 0, "The extension made an unexpected test-server request.");
    return traffic;
  }

  async readSpaTraffic() {
    return {
      backgroundRequests: this.apiServer.records.map(({ method, pathname, query }) => ({ method, pathname, query })),
      routedRequests: readSpaTraffic(this.backend),
    };
  }

  async waitForWatchResult(videoId) {
    let result;
    try {
      result = await waitForWatchResult(this.page, this.runtime, videoId);
    } catch (error) {
      const diagnostics = {
        apiRecords: this.apiServer.records,
        page: await readWatchDiagnostics(this.page, this.runtime, videoId),
        pageSignals: this.pageSignals.snapshot(),
        productionOriginRequests: this.backend.requests,
        unexpectedRequests: this.apiServer.unexpectedRequests,
        workerUrl: this.worker.url(),
      };
      throw new Error(`${error.message}\nExtension artifact diagnostics: ${JSON.stringify(diagnostics, null, 2)}`, {
        cause: error,
      });
    }
    assert.deepEqual(
      this.backend.blockedRequests,
      [],
      `The extension attempted unexpected network traffic: ${JSON.stringify(this.backend.blockedRequests)}`,
    );
    const unexpectedRoutedRequests = this.backend.requests.filter(
      (request) => request.method !== "GET" || !["/configs/selectors", "/votes"].includes(request.pathname),
    );
    assert.deepEqual(
      unexpectedRoutedRequests,
      [],
      "The extension content script made an unexpected production-origin request.",
    );
    assert.equal(this.apiServer.unexpectedRequests.length, 0, "The extension made an unexpected test-server request.");
    return { ...result, workerUrl: this.worker.url() };
  }

  async assertNoPageSignals(scenarioId) {
    return this.pageSignals.assertClean(scenarioId);
  }

  async close() {
    await this.context?.close();
    removeOwnedTemporaryDirectory(this.profileDirectory, "ryd-mv3-profile-");
    removeOwnedTemporaryDirectory(this.preparedArtifact?.temporaryRoot, "ryd-mv3-e2e-");
  }
}

async function runArtifactWatchRenderScenario(adapter, { videoId = VIDEO_A } = {}) {
  assert.ok(
    SHARED_LIVE_SCENARIO_IDS.includes(ARTIFACT_SMOKE_SCENARIO_ID),
    `${ARTIFACT_SMOKE_SCENARIO_ID} must remain in the shared scenario catalog.`,
  );
  assert.ok(
    ["extension", "userscript"].includes(adapter?.runtime),
    "A supported artifact runtime adapter is required.",
  );
  for (const method of ["start", "openWatch", "waitForWatchResult", "assertNoPageSignals", "close"]) {
    assert.equal(
      typeof adapter[method],
      "function",
      `The ${adapter.runtime} artifact adapter must implement ${method}().`,
    );
  }

  try {
    await adapter.start();
    await adapter.openWatch(videoId);
    const result = await adapter.waitForWatchResult(videoId);
    assert.equal(result.videoId, videoId);
    assert.equal(result.rateBarVisible, true, `${adapter.runtime} did not render a visible watch ratio bar.`);
    assert.equal(result.fillVisible, true, `${adapter.runtime} did not render a visible watch ratio fill.`);
    assert.match(result.count, /\d/, `${adapter.runtime} did not render a numeric dislike count.`);
    await adapter.assertNoPageSignals(ARTIFACT_SMOKE_SCENARIO_ID);
    return { ...result, runtime: adapter.runtime, scenarioId: ARTIFACT_SMOKE_SCENARIO_ID };
  } finally {
    await adapter.close();
  }
}

function assertArtifactRuntimeAdapter(adapter, methods) {
  assert.ok(
    ["extension", "userscript"].includes(adapter?.runtime),
    "A supported artifact runtime adapter is required.",
  );
  for (const method of methods) {
    assert.equal(
      typeof adapter[method],
      "function",
      `The ${adapter.runtime} artifact adapter must implement ${method}().`,
    );
  }
}

function createArtifactSpaScenarioConfiguration({
  fromVideoId = VIDEO_A,
  intervalMs = 50,
  maxFirstValidMs = 1_000,
  stableForMs = 300,
  stabilityDurationMs = 1_000,
  timeoutMs = 15_000,
  toVideoId = VIDEO_B,
} = {}) {
  const fromCounts = SPA_COUNTS[fromVideoId];
  const toCounts = SPA_COUNTS[toVideoId];
  if (!fromCounts || !toCounts) {
    throw new TypeError("The SPA scenario requires configured non-proportional video counts.");
  }
  if (!Number.isFinite(maxFirstValidMs) || maxFirstValidMs < 0) {
    throw new TypeError("The SPA first-valid latency budget must be a non-negative finite number.");
  }
  const fromRatio = fromCounts.likes / (fromCounts.likes + fromCounts.dislikes);
  const toRatio = toCounts.likes / (toCounts.likes + toCounts.dislikes);
  assert.notEqual(fromRatio, toRatio, "The A/B fixture ratios must not be proportional.");
  return {
    fromCounts,
    fromRatio,
    fromVideoId,
    intervalMs,
    maxFirstValidMs,
    stabilityDurationMs,
    stableForMs,
    timeoutMs,
    toCounts,
    toRatio,
    toVideoId,
    validityOptions: {
      expectedCount: toCounts.dislikes,
      expectedRatio: toRatio,
      fromVideoId,
      toVideoId,
    },
  };
}

async function runArtifactWatchSpaSetup(adapter, configuration) {
  const {
    fromCounts,
    fromRatio,
    fromVideoId,
    intervalMs,
    maxFirstValidMs,
    stabilityDurationMs,
    stableForMs,
    timeoutMs,
    toVideoId,
    validityOptions,
  } = configuration;

  await adapter.openSpaWatch(fromVideoId);
  const initial = await adapter.waitForWatchResult(fromVideoId);
  assert.equal(initial.videoId, fromVideoId, "The outgoing watch fixture reported the wrong video ID.");
  assert.equal(initial.count, String(fromCounts.dislikes), "The outgoing watch rendered the wrong dislike count.");
  assert.ok(
    Number.isFinite(initial.fillRatio) && Math.abs(initial.fillRatio - fromRatio) <= 0.02,
    `The outgoing watch rendered ratio ${initial.fillRatio}; expected ${fromRatio}.`,
  );

  const mutation = await adapter.navigateSpaWatch(fromVideoId, toVideoId);
  assert.equal(mutation.outgoing.beforeBarCount, 1, "The retained outgoing fixture had no initialized A bar.");
  assert.equal(mutation.destination.destinationReplaced, true, "The destination actions were not replaced.");

  let readiness;
  try {
    readiness = await waitForStableInvariant({
      intervalMs,
      isValid: (snapshot) => isSpaDestinationValid(snapshot, validityOptions),
      label: `${adapter.runtime} destination watch ownership`,
      read: () => adapter.readSpaWatchSnapshot(fromVideoId, toVideoId),
      stableForMs,
      timeoutMs,
    });
  } catch (error) {
    if (typeof adapter.readSpaTraffic === "function") {
      error.message += ` Traffic: ${JSON.stringify(await adapter.readSpaTraffic())}`;
    }
    throw error;
  }
  assert.ok(
    readiness.firstValidMs <= maxFirstValidMs,
    `${adapter.runtime} destination watch first became valid after ${readiness.firstValidMs}ms; ` +
      `the budget is ${maxFirstValidMs}ms.`,
  );
  const stability = await assertInvariantContinuously({
    durationMs: stabilityDurationMs,
    intervalMs,
    isValid: (snapshot) => isSpaDestinationValid(snapshot, validityOptions),
    label: `${adapter.runtime} settled watch SPA UI`,
    read: () => adapter.readSpaWatchSnapshot(fromVideoId, toVideoId),
  });
  const destination = readiness.value;
  return {
    destination: {
      count: destination.count,
      fillRatio: destination.fillRatio,
      globalBarCount: destination.globalBarCount,
      retainedOutgoingBars: destination.retainedBefore.barCount + destination.insideOutgoing.barCount,
      tooltipText: destination.tooltipText,
      videoId: destination.currentVideoId,
    },
    initial: { count: initial.count, fillRatio: initial.fillRatio, videoId: initial.videoId },
    readiness: {
      firstValidMs: readiness.firstValidMs,
      invalidSamples: readiness.invalidSamples,
      maxFirstValidMs,
      sampleCount: readiness.sampleCount,
      stableForMs: readiness.stableForMs,
    },
    stability: { elapsedMs: stability.elapsedMs, sampleCount: stability.sampleCount },
  };
}

async function runArtifactWatchSpaScenario(adapter, options = {}) {
  assert.ok(
    SHARED_ARTIFACT_SCENARIO_IDS.includes(ARTIFACT_WATCH_SPA_SCENARIO_ID),
    `${ARTIFACT_WATCH_SPA_SCENARIO_ID} must remain in the shared artifact scenario catalog.`,
  );
  assertArtifactRuntimeAdapter(adapter, [
    "assertSpaNetwork",
    "assertNoPageSignals",
    "close",
    "navigateSpaWatch",
    "openSpaWatch",
    "readSpaWatchSnapshot",
    "start",
    "waitForWatchResult",
  ]);
  const configuration = createArtifactSpaScenarioConfiguration(options);

  try {
    await adapter.start();
    const result = await runArtifactWatchSpaSetup(adapter, configuration);
    const traffic = await adapter.assertSpaNetwork(configuration.fromVideoId, configuration.toVideoId);
    await adapter.assertNoPageSignals(ARTIFACT_WATCH_SPA_SCENARIO_ID);
    return {
      ...result,
      runtime: adapter.runtime,
      scenarioId: ARTIFACT_WATCH_SPA_SCENARIO_ID,
      traffic,
    };
  } finally {
    await adapter.close();
  }
}

async function runArtifactWatchSpaVoteScenario(
  adapter,
  { handshakeStableForMs = 1_000, handshakeTimeoutMs = 10_000, voteValue = -1, ...spaOptions } = {},
) {
  assert.ok(
    SHARED_ARTIFACT_SCENARIO_IDS.includes(ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID),
    `${ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID} must remain in the shared artifact scenario catalog.`,
  );
  assertArtifactRuntimeAdapter(adapter, [
    "activateSpaDislike",
    "assertNoPageSignals",
    "assertSpaVoteNetwork",
    "close",
    "navigateSpaWatch",
    "openSpaWatch",
    "readSpaVoteHandshake",
    "readSpaWatchSnapshot",
    "start",
    "waitForWatchResult",
  ]);
  assert.equal(voteValue, -1, "The shared post-SPA activation scenario must submit a dislike value of -1.");
  const configuration = createArtifactSpaScenarioConfiguration(spaOptions);

  try {
    await adapter.start();
    const result = await runArtifactWatchSpaSetup(adapter, configuration);
    const activation = await adapter.activateSpaDislike(configuration.toVideoId);
    assert.ok(
      Number.isInteger(activation.interactionStartIndex) && activation.interactionStartIndex >= 0,
      "The adapter did not return a valid interaction record boundary.",
    );
    assert.equal(activation.videoId, configuration.toVideoId, "The adapter activated the wrong destination video.");

    let handshake;
    try {
      handshake = await waitForStableInvariant({
        intervalMs: configuration.intervalMs,
        isValid: isArtifactVoteHandshakeValid,
        label: `${adapter.runtime} post-SPA dislike handshake`,
        read: () => adapter.readSpaVoteHandshake(activation.interactionStartIndex, configuration.toVideoId, voteValue),
        stableForMs: handshakeStableForMs,
        timeoutMs: handshakeTimeoutMs,
      });
    } catch (error) {
      if (typeof adapter.readSpaTraffic === "function") {
        error.message += ` Traffic: ${JSON.stringify(await adapter.readSpaTraffic())}`;
      }
      throw error;
    }
    const handshakeSnapshot = handshake.value;
    const network = await adapter.assertSpaVoteNetwork(
      configuration.fromVideoId,
      configuration.toVideoId,
      activation.interactionStartIndex,
    );
    await adapter.assertNoPageSignals(ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID);

    return {
      ...result,
      activation: { ariaPressedBefore: activation.ariaPressedBefore, videoId: activation.videoId },
      handshake: {
        confirmationRequests: handshakeSnapshot.confirmationCount,
        confirmationStatus: handshakeSnapshot.confirmation.responseStatus,
        confirmed: handshakeSnapshot.confirmation.responseBody === true,
        firstValidMs: handshake.firstValidMs,
        interactionRequests: handshakeSnapshot.interactionCount,
        sampleCount: handshake.sampleCount,
        stableForMs: handshake.stableForMs,
        userId: handshakeSnapshot.sharedUserId,
        value: voteValue,
        videoId: configuration.toVideoId,
        voteRequests: handshakeSnapshot.voteCount,
      },
      runtime: adapter.runtime,
      scenarioId: ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID,
      traffic: {
        ...network,
        confirmationRequests: handshakeSnapshot.confirmationCount,
        interactionRequests: handshakeSnapshot.interactionCount,
        voteRequests: handshakeSnapshot.voteCount,
      },
    };
  } finally {
    await adapter.close();
  }
}

async function runExtensionDelayedOutgoingFailureScenario(
  adapter,
  { fromVideoId = VIDEO_A, maxDestinationRequestDelayMs = 250, requestTimeoutMs = 5_000, toVideoId = VIDEO_B } = {},
) {
  assert.equal(adapter?.runtime, "extension", "The delayed outgoing failure scenario requires the extension runtime.");
  assertArtifactRuntimeAdapter(adapter, [
    "assertNoPageSignals",
    "assertSpaNetwork",
    "close",
    "deferNextStatsRequest",
    "navigateSpaWatchWhilePending",
    "openSpaWatch",
    "readDestinationDislikeTextHistory",
    "readSpaWatchSnapshot",
    "readStatsRequestTimings",
    "start",
    "waitForWatchResult",
  ]);
  const configuration = createArtifactSpaScenarioConfiguration({ fromVideoId, toVideoId });

  try {
    await adapter.start();
    const outgoingRequest = adapter.deferNextStatsRequest();
    await adapter.openSpaWatch(fromVideoId);
    let requestTimeout;
    try {
      await Promise.race([
        outgoingRequest.seen,
        new Promise((resolve, reject) => {
          requestTimeout = setTimeout(
            () => reject(new Error(`The outgoing ${fromVideoId} stats request was not observed.`)),
            requestTimeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(requestTimeout);
    }

    const mutation = await adapter.navigateSpaWatchWhilePending(fromVideoId, toVideoId);
    assert.equal(mutation.outgoing.beforeBarCount, 0, "The intentionally pending outgoing request rendered a bar.");
    assert.equal(mutation.destination.destinationReplaced, true, "The destination actions were not replaced.");

    const releasedAt = Date.now();
    outgoingRequest.release({ body: "{", status: 200 });
    const readiness = await waitForStableInvariant({
      intervalMs: configuration.intervalMs,
      isValid: (snapshot) => isSpaDestinationValid(snapshot, configuration.validityOptions),
      label: "extension destination after delayed outgoing failure",
      read: () => adapter.readSpaWatchSnapshot(fromVideoId, toVideoId),
      stableForMs: configuration.stableForMs,
      timeoutMs: configuration.timeoutMs,
    });
    const destination = readiness.value;

    const textHistory = await adapter.readDestinationDislikeTextHistory();
    assert.ok(textHistory.length >= 1, "The destination dislike text history was not recorded.");
    assert.ok(
      textHistory.every((text) => text === "" || text === String(configuration.toCounts.dislikes)),
      `The outgoing failure wrote into the destination dislike UI: ${JSON.stringify(textHistory)}`,
    );

    const timings = adapter.readStatsRequestTimings();
    const destinationRequests = timings.filter((record) => record.query.videoId === toVideoId);
    assert.equal(destinationRequests.length, 1, `Expected one destination stats request for ${toVideoId}.`);
    const destinationRequestDelayMs = destinationRequests[0].at - releasedAt;
    assert.ok(
      destinationRequestDelayMs <= maxDestinationRequestDelayMs,
      `The queued destination initialization waited ${destinationRequestDelayMs}ms after A settled; ` +
        `the budget is ${maxDestinationRequestDelayMs}ms.`,
    );
    const traffic = await adapter.assertSpaNetwork(fromVideoId, toVideoId);
    await adapter.assertNoPageSignals(ARTIFACT_EXTENSION_DELAYED_FAILURE_SCENARIO_ID);

    return {
      destination: {
        count: destination.count,
        fillRatio: destination.fillRatio,
        videoId: destination.currentVideoId,
      },
      destinationRequestDelayMs,
      runtime: adapter.runtime,
      scenarioId: ARTIFACT_EXTENSION_DELAYED_FAILURE_SCENARIO_ID,
      textHistory,
      traffic,
    };
  } finally {
    await adapter.close();
  }
}

async function runBothArtifactSmokes() {
  const apiServer = await startHermeticApiServer();
  try {
    const results = [];
    for (const adapter of [
      new HermeticUserscriptArtifactAdapter(),
      new HermeticExtensionArtifactAdapter({ apiServer }),
    ]) {
      results.push(await runArtifactWatchRenderScenario(adapter));
    }
    const backendOptions = { countsByVideo: SPA_COUNTS };
    for (const adapter of [
      new HermeticUserscriptArtifactAdapter({ backendOptions }),
      new HermeticExtensionArtifactAdapter({ apiServer, backendOptions }),
    ]) {
      results.push(await runArtifactWatchSpaScenario(adapter));
    }
    for (const adapter of [
      new HermeticUserscriptArtifactAdapter({ backendOptions }),
      new HermeticExtensionArtifactAdapter({ apiServer, backendOptions }),
    ]) {
      results.push(await runArtifactWatchSpaVoteScenario(adapter));
    }
    results.push(
      await runExtensionDelayedOutgoingFailureScenario(
        new HermeticExtensionArtifactAdapter({ apiServer, backendOptions }),
      ),
    );
    return results;
  } finally {
    await apiServer.close();
  }
}

if (require.main === module) {
  runBothArtifactSmokes()
    .then((results) => process.stdout.write(`${JSON.stringify(results, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  ARTIFACT_EXTENSION_DELAYED_FAILURE_SCENARIO_ID,
  ARTIFACT_SMOKE_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID,
  HermeticExtensionArtifactAdapter,
  HermeticUserscriptArtifactAdapter,
  SHARED_ARTIFACT_SCENARIO_IDS,
  SPA_COUNTS,
  assertLoopbackOrigin,
  createPageSignalCollector,
  isArtifactVoteHandshakeValid,
  isSpaDestinationValid,
  prepareHermeticExtensionArtifact,
  readArtifactVoteHandshake,
  runArtifactWatchRenderScenario,
  runArtifactWatchSpaScenario,
  runArtifactWatchSpaVoteScenario,
  runBothArtifactSmokes,
  runExtensionDelayedOutgoingFailureScenario,
  startHermeticApiServer,
};
