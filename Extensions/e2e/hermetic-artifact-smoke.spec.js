const fs = require("node:fs");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const {
  ARTIFACT_SMOKE_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_SCENARIO_ID,
  ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID,
  SHARED_ARTIFACT_SCENARIO_IDS,
  assertLoopbackOrigin,
  createPageSignalCollector,
  isArtifactVoteHandshakeValid,
  isSpaDestinationValid,
  prepareHermeticExtensionArtifact,
  readArtifactVoteHandshake,
  runArtifactWatchRenderScenario,
  runArtifactWatchSpaScenario,
  runArtifactWatchSpaVoteScenario,
} = require("./hermetic-artifact-smoke");

const PRODUCTION_API_ORIGIN = "https://returnyoutubedislikeapi.com";
const temporaryDirectories = [];

function createExtensionFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ryd-mv3-source-fixture-"));
  temporaryDirectories.push(directory);
  fs.writeFileSync(
    path.join(directory, "manifest.json"),
    JSON.stringify({ host_permissions: ["*://returnyoutubedislikeapi.com/*"], manifest_version: 3 }),
  );
  fs.writeFileSync(
    path.join(directory, "ryd.background.js"),
    `fetch("${PRODUCTION_API_ORIGIN}/register")\napi.runtime.onInstalled.addListener((details) => {\n  maybeShowChangelog(details);\n});`,
  );
  fs.writeFileSync(path.join(directory, "ryd.content-script.js"), `fetch("${PRODUCTION_API_ORIGIN}/votes")`);
  fs.writeFileSync(path.join(directory, "menu-fixer.js"), "document.documentElement.dataset.menuFixerLoaded = 'true';");
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

test("the artifact smoke is the shared watch-render scenario", () => {
  expect(ARTIFACT_SMOKE_SCENARIO_ID).toBe("watch-render");
  expect(ARTIFACT_WATCH_SPA_SCENARIO_ID).toBe("watch-spa-side-panel");
  expect(ARTIFACT_WATCH_SPA_VOTE_SCENARIO_ID).toBe("watch-spa-dislike-activation");
  expect(SHARED_ARTIFACT_SCENARIO_IDS).toEqual([
    "watch-render",
    "watch-spa-side-panel",
    "watch-spa-dislike-activation",
  ]);
});

function validSpaSnapshot() {
  const outgoing = {
    barCount: 0,
    containerCount: 0,
    controlVideoIds: ["abcdefghijk"],
    hidden: true,
    present: true,
    wrapperCount: 0,
  };
  return {
    actionHostCount: 1,
    barOwnedByDestination: true,
    containerOwnedByDestination: true,
    count: "65",
    currentVideoId: "zyxwvutsrqp",
    destinationBarCount: 1,
    destinationContainerCount: 1,
    destinationControlCount: 1,
    destinationWrapperCount: 1,
    fillRatio: 0.35,
    globalBarCount: 1,
    globalContainerCount: 1,
    globalWrapperCount: 1,
    insideOutgoing: { ...outgoing },
    retainedBefore: { ...outgoing },
    retainedDestination: { ...outgoing, controlVideoIds: ["zyxwvutsrqp"] },
    tooltipText: "35 / 65",
    urlVideoId: "zyxwvutsrqp",
    visibleContainer: true,
    visibleFill: true,
  };
}

const ARTIFACT_USER_ID = "A".repeat(36);

function validVoteHandshake(change = {}) {
  return {
    confirmation: {
      body: { solution: "AAAAAA==", userId: ARTIFACT_USER_ID, videoId: "zyxwvutsrqp" },
      responded: true,
      responseBody: true,
      responseStatus: 200,
    },
    confirmationCount: 1,
    expectedValue: -1,
    expectedVideoId: "zyxwvutsrqp",
    interactionCount: 2,
    interactionPaths: ["/interact/vote", "/interact/confirmVote"],
    sharedUserId: ARTIFACT_USER_ID,
    vote: {
      body: { userId: ARTIFACT_USER_ID, value: -1, videoId: "zyxwvutsrqp" },
    },
    voteCount: 1,
    ...change,
  };
}

test.each(["http://127.0.0.1:43127", "http://localhost:43127", "http://[::1]:43127"])(
  "accepts a loopback-only API origin: %s",
  (origin) => {
    expect(assertLoopbackOrigin(origin)).toBe(origin);
  },
);

test.each(["https://returnyoutubedislikeapi.com", "https://api.example.test", "http://192.168.1.20:43127"])(
  "rejects a non-loopback API origin: %s",
  (origin) => {
    expect(() => assertLoopbackOrigin(origin)).toThrow("Refusing to prepare a hermetic extension artifact");
  },
);

test("redirects eager MV3 background traffic while leaving routed content-script traffic intact", () => {
  const sourceDirectory = createExtensionFixture();
  const prepared = prepareHermeticExtensionArtifact(sourceDirectory, "http://127.0.0.1:43127");
  temporaryDirectories.push(prepared.temporaryRoot);

  expect(prepared.replacements).toEqual({ "ryd.background.js": 1, firstInstallChangelogListener: 1 });
  expect(prepared.routedBundles).toEqual(["ryd.content-script.js"]);
  expect(fs.readFileSync(path.join(prepared.extensionDirectory, "ryd.background.js"), "utf8")).toContain(
    "http://127.0.0.1:43127/register",
  );
  expect(fs.readFileSync(path.join(prepared.extensionDirectory, "ryd.background.js"), "utf8")).toContain(
    "api.runtime.onInstalled.addListener(() => {});",
  );
  expect(fs.readFileSync(path.join(prepared.extensionDirectory, "ryd.content-script.js"), "utf8")).toContain(
    `${PRODUCTION_API_ORIGIN}/votes`,
  );
  expect(fs.readFileSync(path.join(prepared.extensionDirectory, "menu-fixer.js"), "utf8")).toContain("menuFixerLoaded");
  expect(JSON.parse(fs.readFileSync(path.join(prepared.extensionDirectory, "manifest.json"), "utf8"))).toMatchObject({
    host_permissions: expect.arrayContaining(["http://127.0.0.1/*"]),
    manifest_version: 3,
  });
  expect(fs.readFileSync(path.join(sourceDirectory, "ryd.background.js"), "utf8")).toContain(PRODUCTION_API_ORIGIN);
});

test("rejects an extension artifact whose injected auxiliary script was dropped by the build", () => {
  const sourceDirectory = createExtensionFixture();
  fs.rmSync(path.join(sourceDirectory, "menu-fixer.js"));

  expect(() => prepareHermeticExtensionArtifact(sourceDirectory, "http://127.0.0.1:43127")).toThrow(
    /missing menu-fixer\.js/,
  );
});

test.each(["userscript", "extension"])("runs one shared artifact scenario contract for %s", async (runtime) => {
  const events = [];
  const adapter = {
    assertNoPageSignals: jest.fn(async (scenarioId) => events.push(`signals:${scenarioId}`)),
    close: jest.fn(async () => events.push("close")),
    openWatch: jest.fn(async (videoId) => events.push(`open:${videoId}`)),
    runtime,
    start: jest.fn(async () => events.push("start")),
    waitForWatchResult: jest.fn(async (videoId) => ({
      count: "25",
      fillVisible: true,
      rateBarVisible: true,
      videoId,
    })),
  };

  await expect(runArtifactWatchRenderScenario(adapter, { videoId: "abcdefghijk" })).resolves.toMatchObject({
    count: "25",
    runtime,
    scenarioId: "watch-render",
    videoId: "abcdefghijk",
  });
  expect(events).toEqual(["start", "open:abcdefghijk", "signals:watch-render", "close"]);
});

test.each(["userscript", "extension"])("runs the same continuous A-to-B SPA contract for %s", async (runtime) => {
  const events = [];
  const adapter = {
    assertNoPageSignals: jest.fn(async (scenarioId) => events.push(`signals:${scenarioId}`)),
    assertSpaNetwork: jest.fn(async () => ({ fromVideoRequests: 1, interactionRequests: 0, toVideoRequests: 1 })),
    close: jest.fn(async () => events.push("close")),
    navigateSpaWatch: jest.fn(async () => ({
      destination: { destinationReplaced: true },
      outgoing: { beforeBarCount: 1 },
    })),
    openSpaWatch: jest.fn(async (videoId) => events.push(`open:${videoId}`)),
    readSpaWatchSnapshot: jest.fn(async () => validSpaSnapshot()),
    runtime,
    start: jest.fn(async () => events.push("start")),
    waitForWatchResult: jest.fn(async (videoId) => ({ count: "10", fillRatio: 0.9, videoId })),
  };

  await expect(
    runArtifactWatchSpaScenario(adapter, {
      intervalMs: 1,
      stabilityDurationMs: 0,
      stableForMs: 0,
      timeoutMs: 1,
    }),
  ).resolves.toMatchObject({
    destination: { count: "65", fillRatio: 0.35, videoId: "zyxwvutsrqp" },
    initial: { count: "10", fillRatio: 0.9, videoId: "abcdefghijk" },
    readiness: { maxFirstValidMs: 1_000 },
    runtime,
    scenarioId: "watch-spa-side-panel",
    traffic: { fromVideoRequests: 1, interactionRequests: 0, toVideoRequests: 1 },
  });
  expect(adapter.navigateSpaWatch).toHaveBeenCalledWith("abcdefghijk", "zyxwvutsrqp");
  expect(events).toEqual(["start", "open:abcdefghijk", "signals:watch-spa-side-panel", "close"]);
});

test("recognizes only one ordered, successful destination dislike handshake", () => {
  const records = [
    { method: "POST", pathname: "/puzzle/registration" },
    {
      body: { userId: ARTIFACT_USER_ID, value: -1, videoId: "zyxwvutsrqp" },
      method: "POST",
      pathname: "/interact/vote",
    },
    {
      body: { solution: "AAAAAA==", userId: ARTIFACT_USER_ID, videoId: "zyxwvutsrqp" },
      method: "POST",
      pathname: "/interact/confirmVote",
      respondedAt: 123,
      responseBody: true,
      responseStatus: 200,
    },
  ];

  const handshake = readArtifactVoteHandshake(records, 1, "zyxwvutsrqp", -1);
  expect(handshake).toEqual(validVoteHandshake());
  expect(isArtifactVoteHandshakeValid(handshake)).toBe(true);
});

test.each([
  ["duplicate listener requests", (value) => ({ ...value, interactionCount: 4, voteCount: 2, confirmationCount: 2 })],
  ["reversed request order", (value) => ({ ...value, interactionPaths: ["/interact/confirmVote", "/interact/vote"] })],
  [
    "the wrong destination video",
    (value) => ({ ...value, vote: { body: { ...value.vote.body, videoId: "abcdefghijk" } } }),
  ],
  ["the wrong vote value", (value) => ({ ...value, vote: { body: { ...value.vote.body, value: 1 } } })],
  [
    "different vote and confirmation identities",
    (value) => ({
      ...value,
      confirmation: {
        ...value.confirmation,
        body: { ...value.confirmation.body, userId: "B".repeat(36) },
      },
    }),
  ],
  ["a malformed identity", (value) => ({ ...value, sharedUserId: "short-user" })],
  ["a false confirmation", (value) => ({ ...value, confirmation: { ...value.confirmation, responseBody: false } })],
  [
    "a failed confirmation status",
    (value) => ({ ...value, confirmation: { ...value.confirmation, responseStatus: 500 } }),
  ],
  [
    "a malformed proof solution",
    (value) => ({
      ...value,
      confirmation: { ...value.confirmation, body: { ...value.confirmation.body, solution: "AA==" } },
    }),
  ],
  ["an extra vote field", (value) => ({ ...value, vote: { body: { ...value.vote.body, duplicate: true } } })],
])("rejects a post-SPA vote handshake with %s", (_label, mutate) => {
  expect(isArtifactVoteHandshakeValid(mutate(validVoteHandshake()))).toBe(false);
});

test.each(["userscript", "extension"])(
  "runs one post-SPA dislike activation and confirmation contract for %s",
  async (runtime) => {
    const events = [];
    const adapter = {
      activateSpaDislike: jest.fn(async (videoId) => ({
        ariaPressedBefore: "false",
        interactionStartIndex: 7,
        videoId,
      })),
      assertNoPageSignals: jest.fn(async (scenarioId) => events.push(`signals:${scenarioId}`)),
      assertSpaVoteNetwork: jest.fn(async () => ({ fromVideoRequests: 1, toVideoRequests: 1 })),
      close: jest.fn(async () => events.push("close")),
      navigateSpaWatch: jest.fn(async () => ({
        destination: { destinationReplaced: true },
        outgoing: { beforeBarCount: 1 },
      })),
      openSpaWatch: jest.fn(async (videoId) => events.push(`open:${videoId}`)),
      readSpaVoteHandshake: jest.fn(async () => validVoteHandshake()),
      readSpaWatchSnapshot: jest.fn(async () => validSpaSnapshot()),
      runtime,
      start: jest.fn(async () => events.push("start")),
      waitForWatchResult: jest.fn(async (videoId) => ({ count: "10", fillRatio: 0.9, videoId })),
    };

    await expect(
      runArtifactWatchSpaVoteScenario(adapter, {
        handshakeStableForMs: 0,
        handshakeTimeoutMs: 1,
        intervalMs: 1,
        stabilityDurationMs: 0,
        stableForMs: 0,
        timeoutMs: 1,
      }),
    ).resolves.toMatchObject({
      activation: { ariaPressedBefore: "false", videoId: "zyxwvutsrqp" },
      destination: { count: "65", fillRatio: 0.35, videoId: "zyxwvutsrqp" },
      handshake: {
        confirmationRequests: 1,
        confirmationStatus: 200,
        confirmed: true,
        interactionRequests: 2,
        userId: ARTIFACT_USER_ID,
        value: -1,
        videoId: "zyxwvutsrqp",
        voteRequests: 1,
      },
      runtime,
      scenarioId: "watch-spa-dislike-activation",
      traffic: { confirmationRequests: 1, interactionRequests: 2, voteRequests: 1 },
    });
    expect(adapter.activateSpaDislike).toHaveBeenCalledTimes(1);
    expect(adapter.activateSpaDislike).toHaveBeenCalledWith("zyxwvutsrqp");
    expect(adapter.readSpaVoteHandshake).toHaveBeenCalledWith(7, "zyxwvutsrqp", -1);
    expect(adapter.assertSpaVoteNetwork).toHaveBeenCalledWith("abcdefghijk", "zyxwvutsrqp", 7);
    expect(events).toEqual(["start", "open:abcdefghijk", "signals:watch-spa-dislike-activation", "close"]);
  },
);

test("rejects a duplicated post-SPA vote chain and still closes the adapter", async () => {
  const duplicatedHandshake = validVoteHandshake({
    confirmationCount: 2,
    interactionCount: 4,
    interactionPaths: ["/interact/vote", "/interact/confirmVote", "/interact/vote", "/interact/confirmVote"],
    voteCount: 2,
  });
  const adapter = {
    activateSpaDislike: jest.fn(async (videoId) => ({ interactionStartIndex: 0, videoId })),
    assertNoPageSignals: jest.fn(),
    assertSpaVoteNetwork: jest.fn(),
    close: jest.fn(),
    navigateSpaWatch: jest.fn(async () => ({
      destination: { destinationReplaced: true },
      outgoing: { beforeBarCount: 1 },
    })),
    openSpaWatch: jest.fn(),
    readSpaVoteHandshake: jest.fn(async () => duplicatedHandshake),
    readSpaWatchSnapshot: jest.fn(async () => validSpaSnapshot()),
    runtime: "userscript",
    start: jest.fn(),
    waitForWatchResult: jest.fn(async (videoId) => ({ count: "10", fillRatio: 0.9, videoId })),
  };

  await expect(
    runArtifactWatchSpaVoteScenario(adapter, {
      handshakeStableForMs: 0,
      handshakeTimeoutMs: 1,
      intervalMs: 1,
      stabilityDurationMs: 0,
      stableForMs: 0,
      timeoutMs: 1,
    }),
  ).rejects.toThrow("post-SPA dislike handshake did not remain valid");
  expect(adapter.assertSpaVoteNetwork).not.toHaveBeenCalled();
  expect(adapter.assertNoPageSignals).not.toHaveBeenCalled();
  expect(adapter.close).toHaveBeenCalledTimes(1);
});

test("rejects a destination that becomes correct after the explicit latency budget", async () => {
  const adapter = {
    assertNoPageSignals: jest.fn(),
    assertSpaNetwork: jest.fn(),
    close: jest.fn(),
    navigateSpaWatch: jest.fn(async () => ({
      destination: { destinationReplaced: true },
      outgoing: { beforeBarCount: 1 },
    })),
    openSpaWatch: jest.fn(),
    readSpaWatchSnapshot: jest.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return validSpaSnapshot();
    }),
    runtime: "userscript",
    start: jest.fn(),
    waitForWatchResult: jest.fn(async (videoId) => ({ count: "10", fillRatio: 0.9, videoId })),
  };

  await expect(
    runArtifactWatchSpaScenario(adapter, {
      intervalMs: 1,
      maxFirstValidMs: 1,
      stabilityDurationMs: 0,
      stableForMs: 0,
      timeoutMs: 20,
    }),
  ).rejects.toThrow(/first became valid after .*the budget is 1ms/);
  expect(adapter.close).toHaveBeenCalledTimes(1);
});

test.each([
  ["duplicate global bar", { globalBarCount: 2 }],
  ["stale outgoing bar", { insideOutgoing: { ...validSpaSnapshot().insideOutgoing, barCount: 1 } }],
  ["wrong destination ratio", { fillRatio: 0.9 }],
  ["wrong destination count", { count: "10" }],
])("rejects a settled SPA snapshot with %s", (_label, change) => {
  expect(
    isSpaDestinationValid(
      { ...validSpaSnapshot(), ...change },
      {
        expectedCount: 65,
        expectedRatio: 0.35,
        fromVideoId: "abcdefghijk",
        toVideoId: "zyxwvutsrqp",
      },
    ),
  ).toBe(false);
});

test("always closes an artifact adapter after a failed visual assertion", async () => {
  const adapter = {
    assertNoPageSignals: jest.fn(),
    close: jest.fn(),
    openWatch: jest.fn(),
    runtime: "extension",
    start: jest.fn(),
    waitForWatchResult: jest.fn(async () => ({
      count: "25",
      fillVisible: true,
      rateBarVisible: false,
      videoId: "abcdefghijk",
    })),
  };

  await expect(runArtifactWatchRenderScenario(adapter, { videoId: "abcdefghijk" })).rejects.toThrow(
    "extension did not render a visible watch ratio bar",
  );
  expect(adapter.close).toHaveBeenCalledTimes(1);
});

test("turns an otherwise successful artifact result into a failure when the page emitted an error", async () => {
  const adapter = {
    assertNoPageSignals: jest.fn(async () => {
      throw new Error("unexpected browser signals");
    }),
    close: jest.fn(),
    openWatch: jest.fn(),
    runtime: "userscript",
    start: jest.fn(),
    waitForWatchResult: jest.fn(async (videoId) => ({
      count: "25",
      fillVisible: true,
      rateBarVisible: true,
      videoId,
    })),
  };

  await expect(runArtifactWatchRenderScenario(adapter, { videoId: "abcdefghijk" })).rejects.toThrow(
    "unexpected browser signals",
  );
  expect(adapter.close).toHaveBeenCalledTimes(1);
});

function createPageDouble() {
  const page = new EventEmitter();
  page.addInitScript = jest.fn(async () => {});
  page.evaluate = jest.fn(async (callback) => callback());
  page.exposeBinding = jest.fn(async (name, callback) => {
    page.exposedBinding = { callback, name };
  });
  return page;
}

function consoleMessage(
  type,
  text,
  location = { columnNumber: 5, lineNumber: 4, url: "https://www.youtube.com/watch" },
) {
  return {
    location: () => location,
    text: () => text,
    type: () => type,
  };
}

test.each(["userscript", "extension"])(
  "collects clean page signals through one shared %s collector",
  async (runtime) => {
    const page = createPageDouble();
    const collector = await createPageSignalCollector(page, runtime);

    page.emit("console", consoleMessage("warning", "harmless warning"));

    await expect(collector.assertClean("watch-render")).resolves.toEqual({
      consoleErrors: [],
      pageErrors: [],
      runtime,
      unhandledRejections: [],
    });
    expect(page.exposeBinding).toHaveBeenCalledWith("__rydArtifactReportUnhandledRejection", expect.any(Function));
    expect(page.addInitScript).toHaveBeenCalledTimes(1);
  },
);

test.each([
  ["console error", (page) => page.emit("console", consoleMessage("error", "fixture exploded")), "fixture exploded"],
  [
    "failed browser resource load",
    (page) => page.emit("console", consoleMessage("error", "Failed to load resource: net::ERR_FILE_NOT_FOUND")),
    "ERR_FILE_NOT_FOUND",
  ],
  [
    "failed console assertion",
    (page) => page.emit("console", consoleMessage("assert", "bad assertion")),
    "bad assertion",
  ],
  ["page error", (page) => page.emit("pageerror", new TypeError("page exploded")), "page exploded"],
  [
    "unhandled rejection",
    (page) =>
      page.exposedBinding.callback(
        { frame: { url: () => "https://www.youtube.com/watch?v=abcdefghijk" } },
        { message: "promise exploded", name: "Error", stack: "Error: promise exploded" },
      ),
    "promise exploded",
  ],
])("fails a successful scenario on %s with diagnostics", async (_label, emitSignal, expectedDiagnostic) => {
  const page = createPageDouble();
  const collector = await createPageSignalCollector(page, "userscript");
  emitSignal(page);

  await expect(collector.assertClean("watch-render")).rejects.toThrow(
    new RegExp(`userscript emitted unexpected browser signals.*${expectedDiagnostic}`, "s"),
  );
});
