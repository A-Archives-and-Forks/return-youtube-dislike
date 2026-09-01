const {
  LIVE_RUNTIME_PROFILES,
  createExtensionLiveRuntimeAdapter,
  createUserscriptLiveRuntimeAdapter,
} = require("./live-runtime-adapter");
const {
  SHARED_LIVE_SCENARIO_IDS,
  assertSharedLiveScenarioAdapter,
  createSharedLiveScenarioRunner,
} = require("./shared-live-scenarios");

const EXPECTED_SCENARIO_IDS = [
  "channel-shorts-navigation",
  "channel-watch-navigation",
  "watch-render",
  "reload",
  "spa-navigation",
  "sidebar-navigation-stress",
  "shorts-render",
  "responsive-visual",
  "reaction-matrix",
];
const EXPECTED_BUILD_ID = "0123456789abcdef0123456789abcdef";

const ALL_DRIVER_METHODS = [
  "assertCurrentShortsControl",
  "assertCurrentVideo",
  "assertRuntime",
  "assertSignedIn",
  "captureReactionStateVisual",
  "captureNativeShortsVisual",
  "captureSyntheticShortsVisual",
  "captureWatchRatioVisual",
  "clickAction",
  "navigateFromColdChannelToShort",
  "navigateFromColdChannelToWatch",
  "navigateToNextShort",
  "navigateToRelatedWatch",
  "navigateWithinPlaylist",
  "openPlaylist",
  "openShort",
  "openWatch",
  "pausePlayback",
  "readReactionState",
  "readViewportSize",
  "reload",
  "setViewportSize",
  "soakWatchRatioVisual",
  "waitForDislikeText",
  "waitForReactionState",
  "withNoProductionInteractions",
];

function createDriver(overrides = {}) {
  return {
    ...Object.fromEntries(ALL_DRIVER_METHODS.map((method) => [method, jest.fn()])),
    ...overrides,
  };
}

function createAdapter(runtime, driver = createDriver(), expectedBuildId = EXPECTED_BUILD_ID) {
  const options = { driver, expectedBuildId, expectedVersion: runtime === "userscript" ? "3.2.0" : "4.0.4" };
  return runtime === "userscript"
    ? createUserscriptLiveRuntimeAdapter(options)
    : createExtensionLiveRuntimeAdapter(options);
}

function createImplementations(events) {
  const implementationNames = [
    "runChannelShortsNavigationScenario",
    "runChannelWatchNavigationScenario",
    "runWatchRenderScenario",
    "runReloadScenario",
    "runSpaNavigationScenario",
    "runSidebarStressScenario",
    "runShortsRenderScenario",
    "runResponsiveVisualScenario",
    "runProductionReactionMatrixScenario",
  ];
  return Object.fromEntries(
    implementationNames.map((name) => [
      name,
      jest.fn(async (_driver, options) => {
        events.push({ implementation: name, runtime: options.runtime });
        return `${options.runtime}:${name}`;
      }),
    ]),
  );
}

describe("shared live runtime profiles", () => {
  test("preserves each runtime's selectors and control-ownership capabilities", () => {
    expect(LIVE_RUNTIME_PROFILES.userscript).toMatchObject({
      capabilities: {
        backgroundVoteTransport: false,
        credentialStore: "gm-storage",
        ownsShortsDislikeControl: true,
        shortsControlModel: "synthetic-owned",
        shortsVisualModel: "strict-synthetic",
      },
      buildMarkerAttribute: "data-ryd-userscript-build",
      markerAttribute: "data-ryd-userscript-version",
      selectors: {
        rateBar: "#return-youtube-dislike-bar",
        rateBarContainer: "#return-youtube-dislike-bar-container",
        shortsDislikeControl: "[data-ryd-synthetic-shorts-dislike]",
      },
    });
    expect(LIVE_RUNTIME_PROFILES.extension).toMatchObject({
      capabilities: {
        backgroundVoteTransport: true,
        credentialStore: "browser.storage",
        ownsShortsDislikeControl: false,
        shortsControlModel: "native-youtube",
        shortsVisualModel: "native-pair",
      },
      buildMarkerAttribute: "data-ryd-extension-build",
      markerAttribute: "data-ryd-extension-version",
      selectors: {
        rateBar: "#ryd-bar",
        rateBarContainer: "#ryd-bar-container",
        shortsDislikeControl: null,
      },
    });
    expect(Object.isFrozen(LIVE_RUNTIME_PROFILES.userscript.capabilities)).toBe(true);
    expect(Object.isFrozen(LIVE_RUNTIME_PROFILES.extension.selectors)).toBe(true);
  });

  test.each(["userscript", "extension"])("binds runtime-sensitive driver calls for %s", async (runtime) => {
    const driver = createDriver();
    const adapter = createAdapter(runtime, driver);

    await adapter.driver.assertRuntime(runtime, adapter.expectedVersion, adapter.expectedBuildId);
    await adapter.driver.assertCurrentShortsControl("abcdefghijk", runtime);
    await adapter.driver.captureWatchRatioVisual(runtime, "watch.png");
    await adapter.driver.captureReactionStateVisual({
      expectedState: "neutral",
      isShort: false,
      runtime,
      screenshotPath: "reaction.png",
      videoId: "abcdefghijk",
    });

    expect(driver.assertRuntime).toHaveBeenCalledWith(runtime, adapter.expectedVersion, adapter.expectedBuildId);
    expect(driver.assertCurrentShortsControl).toHaveBeenCalledWith("abcdefghijk", runtime);
    expect(driver.captureWatchRatioVisual).toHaveBeenCalledWith(runtime, "watch.png");
    expect(driver.captureReactionStateVisual).toHaveBeenCalledWith(
      expect.objectContaining({ runtime, videoId: "abcdefghijk" }),
    );
  });

  test("rejects scenario options and calls for another runtime", async () => {
    const adapter = createAdapter("userscript");

    expect(() => adapter.createScenarioOptions({ runtime: "extension" })).toThrow(
      "The configured scenario runtime does not match",
    );
    expect(() => adapter.driver.assertRuntime("extension", adapter.expectedVersion)).toThrow(
      "The asserted runtime does not match",
    );
  });

  test.each([undefined, "", "stale", "A".repeat(32)])(
    "rejects a missing or malformed exact live build ID: %p",
    (expectedBuildId) => {
      expect(() =>
        createUserscriptLiveRuntimeAdapter({
          driver: createDriver(),
          expectedBuildId,
          expectedVersion: "3.2.0",
        }),
      ).toThrow("expected live build ID must be a 32-character lowercase hexadecimal value");
    },
  );

  test("binds the exact generated live build ID into runtime checks", async () => {
    const driver = createDriver();
    const expectedBuildId = "0123456789abcdef0123456789abcdef";
    const adapter = createAdapter("userscript", driver, expectedBuildId);

    await adapter.driver.assertRuntime("userscript", adapter.expectedVersion, expectedBuildId);

    expect(driver.assertRuntime).toHaveBeenCalledWith("userscript", adapter.expectedVersion, expectedBuildId);
    expect(adapter.createScenarioOptions()).toMatchObject({ expectedBuildId });
    expect(() => adapter.driver.assertRuntime("userscript", adapter.expectedVersion, "f".repeat(32))).toThrow(
      "live build ID does not match",
    );
  });
});

describe("shared live scenario contract", () => {
  test("publishes one stable ordered scenario ID list", () => {
    expect(SHARED_LIVE_SCENARIO_IDS).toEqual(EXPECTED_SCENARIO_IDS);
    expect(Object.isFrozen(SHARED_LIVE_SCENARIO_IDS)).toBe(true);
  });

  test.each(["userscript", "extension"])("validates the complete contract for %s", (runtime) => {
    const adapter = createAdapter(runtime);
    expect(assertSharedLiveScenarioAdapter(adapter)).toEqual(EXPECTED_SCENARIO_IDS);
  });

  test("requires each runtime's Shorts visual model from the shared responsive scenario", () => {
    const driver = createDriver();
    delete driver.captureSyntheticShortsVisual;

    expect(() => assertSharedLiveScenarioAdapter(createAdapter("userscript", driver), ["responsive-visual"])).toThrow(
      "must implement captureSyntheticShortsVisual()",
    );
    expect(assertSharedLiveScenarioAdapter(createAdapter("extension", driver), ["responsive-visual"])).toEqual([
      "responsive-visual",
    ]);

    const extensionDriver = createDriver();
    delete extensionDriver.captureNativeShortsVisual;
    expect(() =>
      assertSharedLiveScenarioAdapter(createAdapter("extension", extensionDriver), ["responsive-visual"]),
    ).toThrow("must implement captureNativeShortsVisual()");
  });

  test("executes the same scenario IDs through both runtime adapters", async () => {
    const events = [];
    const implementations = createImplementations(events);
    const runner = createSharedLiveScenarioRunner({ implementations });
    const services = {
      consumeVoteApproval: jest.fn(),
      createRecorder: jest.fn(),
      visualOptions: { outputDirectory: "evidence" },
      sidebarOptions: { outputDirectory: "sidebar-evidence" },
    };

    const userscriptResults = await runner.runAll(createAdapter("userscript"), {}, services);
    const extensionResults = await runner.runAll(createAdapter("extension"), {}, services);

    expect(userscriptResults.map(({ id }) => id)).toEqual(EXPECTED_SCENARIO_IDS);
    expect(extensionResults.map(({ id }) => id)).toEqual(EXPECTED_SCENARIO_IDS);
    expect(events.map(({ runtime }) => runtime)).toEqual([
      ...EXPECTED_SCENARIO_IDS.map(() => "userscript"),
      ...EXPECTED_SCENARIO_IDS.map(() => "extension"),
    ]);
    expect(Object.values(implementations).every((implementation) => implementation.mock.calls.length === 2)).toBe(true);
  });

  test("rejects unknown IDs before invoking a scenario implementation", async () => {
    const implementations = createImplementations([]);
    const runner = createSharedLiveScenarioRunner({ implementations });

    await expect(runner.run(createAdapter("userscript"), "not-a-scenario")).rejects.toThrow(
      "Unknown shared live scenario: not-a-scenario",
    );
    expect(Object.values(implementations).every((implementation) => implementation.mock.calls.length === 0)).toBe(true);
  });
});
