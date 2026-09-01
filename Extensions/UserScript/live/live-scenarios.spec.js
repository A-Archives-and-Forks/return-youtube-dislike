const path = require("node:path");
const {
  RESPONSIVE_VIEWPORTS,
  runChannelShortsNavigationScenario,
  runProductionReactionMatrixScenario,
  runReactionCycle,
  runResponsiveVisualScenario,
  runSidebarStressScenario,
} = require("../e2e/live/live-scenarios");

const EXPECTED_ACTIONS = {
  neutral: ["like", "like", "dislike", "like", "dislike", "dislike"],
  liked: ["like", "dislike", "like", "dislike", "dislike", "like"],
  disliked: ["like", "dislike", "dislike", "like", "like", "dislike"],
};

function nextState(state, action) {
  if (action === "like") return state === "liked" ? "neutral" : "liked";
  return state === "disliked" ? "neutral" : "disliked";
}

function valueForState(state) {
  if (state === "liked") return 1;
  if (state === "disliked") return -1;
  return 0;
}

function createReactionHarness(
  initialState,
  {
    clickThrowTransition = null,
    failHandshake = null,
    failHandshakes = failHandshake === null ? [] : [failHandshake],
    failedVoteUserId = "shared-user-id",
    rollbackOnClickThrow = false,
    rollbackOnHandshakeFailure = false,
    rollbackOnStateWaitFailure = false,
    stateWaitFailTransition = null,
  } = {},
) {
  const events = [];
  let currentState = initialState;
  let currentVideo = null;
  let handshakeNumber = 0;
  let stateWaitNumber = 0;
  const failedHandshakeNumbers = new Set(failHandshakes);

  const driver = {
    assertCurrentVideo: jest.fn((videoId) => expect(currentVideo).toBe(videoId)),
    assertRuntime: jest.fn(),
    assertSignedIn: jest.fn(),
    clickAction: jest.fn(async (videoId, action) => {
      expect(currentVideo).toBe(videoId);
      currentState = nextState(currentState, action);
      events.push({ action, state: currentState });
      if (events.length === clickThrowTransition) {
        if (rollbackOnClickThrow) currentState = initialState;
        throw new Error("simulated post-dispatch click failure");
      }
    }),
    openShort: jest.fn(async (videoId) => {
      currentVideo = videoId;
    }),
    openWatch: jest.fn(async (videoId) => {
      currentVideo = videoId;
    }),
    readReactionState: jest.fn(async () => currentState),
    waitForDislikeText: jest.fn(async () => "123"),
    waitForReactionState: jest.fn(async (expected) => {
      stateWaitNumber += 1;
      if (stateWaitNumber === stateWaitFailTransition) {
        if (rollbackOnStateWaitFailure) currentState = initialState;
        throw new Error("simulated post-click state-wait failure");
      }
      expect(currentState).toBe(expected);
    }),
  };

  const recorder = {
    mark: jest.fn(() => events.length),
    waitForHandshake: jest.fn(async (value) => {
      handshakeNumber += 1;
      expect(value).toBe(valueForState(currentState));
      if (failedHandshakeNumbers.has(handshakeNumber)) {
        if (rollbackOnHandshakeFailure) currentState = initialState;
        throw new Error("simulated handshake failure");
      }
      return "shared-user-id";
    }),
    voteUserId: jest.fn(() => failedVoteUserId),
  };

  return {
    driver,
    events,
    getState: () => currentState,
    recorder,
  };
}

const OPTIONS = {
  expectedBuildId: "0123456789abcdef0123456789abcdef",
  expectedChannel: "@ryd-test",
  expectedVersion: "3.2.0",
  runtime: "userscript",
};

describe("live Shorts navigation stabilization", () => {
  test("pauses the next Short only after its current control has rendered", async () => {
    const events = [];
    const driver = {
      assertCurrentShortsControl: jest.fn(async (videoId) => {
        events.push(`control:${videoId}`);
        return { count: videoId === "abcdefghijk" ? "100" : "200", synthetic: true, videoId };
      }),
      assertRuntime: jest.fn(),
      assertSignedIn: jest.fn(),
      navigateFromColdChannelToShort: jest.fn(async () => events.push("channel-navigation")),
      navigateToNextShort: jest.fn(async () => {
        events.push("next-navigation");
        return "lmnopqrstuv";
      }),
      pausePlayback: jest.fn(async () => events.push("pause")),
      withNoProductionInteractions: jest.fn(async (action) => action()),
    };
    const options = {
      ...OPTIONS,
      navigation: {
        channelUrl: "https://www.youtube.com/@SmashTrash",
        short: "abcdefghijk",
      },
    };

    await expect(runChannelShortsNavigationScenario(driver, options)).resolves.toEqual({
      initial: { count: "100", synthetic: true, videoId: "abcdefghijk" },
      next: { count: "200", synthetic: true, videoId: "lmnopqrstuv" },
    });

    expect(events).toEqual([
      "channel-navigation",
      "control:abcdefghijk",
      "next-navigation",
      "control:lmnopqrstuv",
      "pause",
    ]);
    expect(driver.pausePlayback).toHaveBeenCalledTimes(1);
  });
});

describe("live watch sidebar stress scenario", () => {
  test.each(["userscript", "extension"])(
    "takes consecutive unvisited related links and soaks one current %s bar after each exact response",
    async (runtime) => {
      const hopVideoIds = ["hopvideo001", "hopvideo002", "hopvideo003"];
      const counts = ["101", "202", "303"];
      let currentVideoId = null;
      let hopIndex = 0;
      const driver = {
        assertCurrentVideo: jest.fn((videoId) => expect(currentVideoId).toBe(videoId)),
        assertRuntime: jest.fn(),
        assertSignedIn: jest.fn(),
        captureWatchRatioVisual: jest.fn(async (_runtime, screenshotPath) => ({
          count: counts[hopIndex - 1],
          screenshotPath,
        })),
        navigateToRelatedWatch: jest.fn(async (excludedVideoIds) => {
          expect(excludedVideoIds).toEqual(["abcdefghijk", ...hopVideoIds.slice(0, hopIndex)]);
          const videoId = hopVideoIds[hopIndex];
          const dislikes = (hopIndex + 1) * 1_000;
          hopIndex += 1;
          currentVideoId = videoId;
          return { body: { dislikes }, videoId };
        }),
        openWatch: jest.fn(async (videoId) => {
          currentVideoId = videoId;
        }),
        soakWatchRatioVisual: jest.fn(async (_runtime, settings) => ({
          count: settings.expectedCount,
          durationMs: settings.durationMs,
          sampleCount: 9,
          videoId: settings.videoId,
        })),
        withNoProductionInteractions: jest.fn(async (action) => action()),
      };
      const makeDirectory = jest.fn();
      const options = { ...OPTIONS, runtime, sidebar: { hopCount: 3 }, watchA: "abcdefghijk" };

      const result = await runSidebarStressScenario(driver, options, {
        makeDirectory,
        outputDirectory: "sidebar-evidence",
        soakDurationMs: 25,
      });

      expect(makeDirectory).toHaveBeenCalledWith("sidebar-evidence");
      expect(driver.openWatch).toHaveBeenCalledWith(options.watchA);
      expect(driver.navigateToRelatedWatch).toHaveBeenCalledTimes(3);
      expect(driver.captureWatchRatioVisual.mock.calls).toEqual(
        hopVideoIds.map((_videoId, index) => [
          runtime,
          path.join("sidebar-evidence", `${runtime}-sidebar-hop-0${index + 1}.png`),
          { presenceTimeoutMs: 1_000 },
        ]),
      );
      expect(driver.soakWatchRatioVisual.mock.calls).toEqual(
        hopVideoIds.map((videoId, index) => [runtime, { durationMs: 25, expectedCount: counts[index], videoId }]),
      );
      expect(driver.assertRuntime).toHaveBeenCalledTimes(4);
      expect(driver.assertSignedIn).toHaveBeenCalledTimes(4);
      expect(driver.withNoProductionInteractions).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        hopCount: 3,
        hops: hopVideoIds.map((videoId, index) => ({
          apiDislikes: (index + 1) * 1_000,
          count: counts[index],
          readyLatencyMs: expect.any(Number),
          readyTimeoutMs: 1_000,
          screenshotPath: path.join("sidebar-evidence", `${runtime}-sidebar-hop-0${index + 1}.png`),
          soak: {
            count: counts[index],
            durationMs: 25,
            sampleCount: 9,
            videoId,
          },
          videoId,
        })),
        outputDirectory: "sidebar-evidence",
        startVideoId: options.watchA,
      });
    },
  );
});

describe("live reaction cycle", () => {
  test.each(["neutral", "liked", "disliked"])(
    "covers all six transitions and restores an initially %s watch video",
    async (initialState) => {
      const harness = createReactionHarness(initialState);
      const beforeFirstAction = jest.fn();

      const result = await runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction,
        videoId: "abcdefghijk",
      });

      expect(harness.driver.openWatch).toHaveBeenCalledWith("abcdefghijk");
      expect(harness.driver.openShort).not.toHaveBeenCalled();
      expect(harness.events.map(({ action }) => action)).toEqual(EXPECTED_ACTIONS[initialState]);
      expect(
        new Set(
          harness.events.map(
            ({ action, state }, index) =>
              `${index ? harness.events[index - 1].state : initialState}:${action}:${state}`,
          ),
        ).size,
      ).toBe(6);
      expect(harness.getState()).toBe(initialState);
      expect(harness.recorder.waitForHandshake).toHaveBeenCalledTimes(6);
      expect(beforeFirstAction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ evidencePaths: [], initialState, userId: "shared-user-id" });
    },
  );

  test("targets Shorts through the same transition implementation", async () => {
    const harness = createReactionHarness("neutral");

    await runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
      isShort: true,
      videoId: "shortsabcde",
    });

    expect(harness.driver.openShort).toHaveBeenCalledWith("shortsabcde");
    expect(harness.driver.openWatch).not.toHaveBeenCalled();
  });

  test("restores the initial state when a production handshake fails mid-cycle", async () => {
    const harness = createReactionHarness("neutral", { failHandshake: 3 });

    await expect(
      runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction: jest.fn(),
        videoId: "abcdefghijk",
      }),
    ).rejects.toThrow("simulated handshake failure");

    expect(harness.getState()).toBe("neutral");
    expect(harness.events.at(-1)).toEqual({ action: "dislike", state: "neutral" });
    expect(harness.recorder.waitForHandshake).toHaveBeenLastCalledWith(0, 3);
  });

  test.each([
    [
      "click dispatch throws",
      { clickThrowTransition: 1, rollbackOnClickThrow: true },
      "simulated post-dispatch click failure",
    ],
    [
      "post-click state wait fails",
      { rollbackOnStateWaitFailure: true, stateWaitFailTransition: 1 },
      "simulated post-click state-wait failure",
    ],
  ])(
    "forces a verified away-and-back cleanup when %s after the UI returns to its initial state",
    async (_failure, harnessOptions, expectedError) => {
      const harness = createReactionHarness("neutral", harnessOptions);

      await expect(
        runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
          beforeFirstAction: jest.fn(),
          videoId: "abcdefghijk",
        }),
      ).rejects.toThrow(expectedError);

      expect(harness.recorder.voteUserId).toHaveBeenCalledWith(1, 0);
      expect(harness.events.slice(-2)).toEqual([
        { action: "dislike", state: "disliked" },
        { action: "dislike", state: "neutral" },
      ]);
      expect(harness.recorder.waitForHandshake.mock.calls).toEqual([
        [-1, 1],
        [0, 2],
      ]);
      expect(harness.getState()).toBe("neutral");
    },
  );

  test("reports the manual-restore URL when cleanup after a post-dispatch click failure cannot be confirmed", async () => {
    const harness = createReactionHarness("neutral", {
      clickThrowTransition: 1,
      failHandshakes: [1],
      rollbackOnClickThrow: true,
    });

    await expect(
      runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction: jest.fn(),
        videoId: "abcdefghijk",
      }),
    ).rejects.toThrow(
      /Automatic cleanup could not be verified\. Manually restore https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/,
    );
  });

  test.each([
    ["first", "neutral", 1, true],
    ["middle", "liked", 3, false],
    ["final", "disliked", 6, false],
  ])(
    "forces a verified away-and-back cleanup after a %s transition handshake fails with the UI at its initial state",
    async (_position, initialState, failHandshake, rollbackOnHandshakeFailure) => {
      const harness = createReactionHarness(initialState, { failHandshake, rollbackOnHandshakeFailure });

      await expect(
        runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
          beforeFirstAction: jest.fn(),
          videoId: "abcdefghijk",
        }),
      ).rejects.toThrow("simulated handshake failure");

      let failedState = initialState;
      for (const action of EXPECTED_ACTIONS[initialState].slice(0, failHandshake)) {
        failedState = nextState(failedState, action);
      }
      const cleanupAction = initialState === "liked" ? "like" : "dislike";
      const awayState = initialState === "neutral" ? "disliked" : "neutral";
      expect(harness.recorder.voteUserId).toHaveBeenCalledWith(valueForState(failedState), failHandshake - 1);
      expect(harness.events.slice(-2)).toEqual([
        { action: cleanupAction, state: awayState },
        { action: cleanupAction, state: initialState },
      ]);
      expect(harness.recorder.waitForHandshake.mock.calls.slice(-2)).toEqual([
        [valueForState(awayState), failHandshake],
        [valueForState(initialState), failHandshake + 1],
      ]);
      expect(harness.getState()).toBe(initialState);
    },
  );

  test("reports the manual-restore URL when the verified cleanup round trip fails", async () => {
    const harness = createReactionHarness("neutral", {
      failHandshakes: [1, 2],
      rollbackOnHandshakeFailure: true,
    });

    await expect(
      runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction: jest.fn(),
        videoId: "abcdefghijk",
      }),
    ).rejects.toThrow(
      /Automatic cleanup could not be verified\. Manually restore https:\/\/www\.youtube\.com\/watch\?v=abcdefghijk/,
    );
  });

  test("reports the manual-restore URL when cleanup cannot match the failed attempt identity", async () => {
    const harness = createReactionHarness("neutral", {
      failHandshake: 1,
      failedVoteUserId: "failed-attempt-user-id",
    });

    await expect(
      runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction: jest.fn(),
        videoId: "abcdefghijk",
      }),
    ).rejects.toThrow(/cleanup reaction did not use the failed attempt's RYD identity/);
  });

  test("restores the initial state when a post-action visual assertion fails", async () => {
    const harness = createReactionHarness("neutral");
    const captureReactionVisual = jest.fn(async ({ index, state }) => {
      if (index === 3) throw new Error("simulated visual failure");
      return `watch-${index}-${state}.png`;
    });

    await expect(
      runReactionCycle(harness.driver, harness.recorder, OPTIONS, {
        beforeFirstAction: jest.fn(),
        captureReactionVisual,
        videoId: "abcdefghijk",
      }),
    ).rejects.toThrow("simulated visual failure");

    expect(captureReactionVisual.mock.calls.map(([capture]) => capture)).toEqual([
      { index: 0, state: "neutral" },
      { index: 1, state: "liked" },
      { index: 2, state: "neutral" },
      { index: 3, state: "disliked" },
    ]);
    expect(harness.getState()).toBe("neutral");
    expect(harness.events.at(-1)).toEqual({ action: "dislike", state: "neutral" });
    expect(harness.recorder.waitForHandshake).toHaveBeenLastCalledWith(0, 3);
  });
});

describe("live production reaction matrix visual evidence", () => {
  test("captures and returns the initial state plus all six transitions for watch and Shorts", async () => {
    const states = new Map([
      ["abcdefghijk", "neutral"],
      ["shortsabcde", "neutral"],
    ]);
    let currentVideo;
    const driver = {
      assertCurrentVideo: jest.fn((videoId) => expect(currentVideo).toBe(videoId)),
      assertRuntime: jest.fn(),
      assertSignedIn: jest.fn(),
      captureReactionStateVisual: jest.fn(async (capture) => {
        expect(states.get(capture.videoId)).toBe(capture.expectedState);
        return { screenshotPath: capture.screenshotPath };
      }),
      clickAction: jest.fn(async (videoId, action) => {
        states.set(videoId, nextState(states.get(videoId), action));
      }),
      openShort: jest.fn(async (videoId) => {
        currentVideo = videoId;
      }),
      openWatch: jest.fn(async (videoId) => {
        currentVideo = videoId;
      }),
      readReactionState: jest.fn(async () => states.get(currentVideo)),
      waitForDislikeText: jest.fn(async () => "123"),
      waitForReactionState: jest.fn(async (expected) => expect(states.get(currentVideo)).toBe(expected)),
    };
    const recorders = [];
    const createRecorder = jest.fn((videoId) => {
      const recorder = {
        mark: jest.fn(() => 0),
        stop: jest.fn(),
        waitForHandshake: jest.fn(async (value) => {
          expect(value).toBe(valueForState(states.get(videoId)));
          return "shared-user-id";
        }),
      };
      recorders.push(recorder);
      return recorder;
    });
    const consumeVoteApproval = jest.fn();
    const makeDirectory = jest.fn();
    const options = {
      ...OPTIONS,
      short: "shortsabcde",
      watchB: "abcdefghijk",
    };
    const outputDirectory = "reaction-evidence";

    const result = await runProductionReactionMatrixScenario(driver, options, createRecorder, consumeVoteApproval, {
      makeDirectory,
      outputDirectory,
    });

    const stateSequence = ["neutral", "liked", "neutral", "disliked", "liked", "disliked", "neutral"];
    const expectedWatch = stateSequence.map((state, index) =>
      path.join(outputDirectory, `watch-${index}-${state}.png`),
    );
    const expectedShort = stateSequence.map((state, index) =>
      path.join(outputDirectory, `short-${index}-${state}.png`),
    );
    expect(makeDirectory).toHaveBeenCalledWith(outputDirectory);
    expect(consumeVoteApproval).toHaveBeenCalledTimes(1);
    expect(driver.captureReactionStateVisual).toHaveBeenCalledTimes(14);
    expect(driver.captureReactionStateVisual.mock.calls.slice(0, 7).map(([capture]) => capture)).toEqual(
      expectedWatch.map((screenshotPath, index) => ({
        expectedState: stateSequence[index],
        isShort: false,
        runtime: "userscript",
        screenshotPath,
        videoId: options.watchB,
      })),
    );
    expect(driver.captureReactionStateVisual.mock.calls.slice(7).map(([capture]) => capture)).toEqual(
      expectedShort.map((screenshotPath, index) => ({
        expectedState: stateSequence[index],
        isShort: true,
        runtime: "userscript",
        screenshotPath,
        videoId: options.short,
      })),
    );
    expect(result).toEqual({
      evidencePaths: [...expectedWatch, ...expectedShort],
      outputDirectory,
      short: { evidencePaths: expectedShort, initialState: "neutral", userId: "shared-user-id" },
      watch: { evidencePaths: expectedWatch, initialState: "neutral", userId: "shared-user-id" },
    });
    expect(recorders).toHaveLength(2);
    expect(recorders.every((recorder) => recorder.stop.mock.calls.length === 1)).toBe(true);
  });
});

describe("live responsive visual scenario", () => {
  test("captures watch and userscript Shorts evidence at all responsive widths without actions", async () => {
    const originalViewport = { height: 900, width: 1440 };
    let currentViewport = originalViewport;
    const driver = {
      assertCurrentShortsControl: jest.fn(),
      assertRuntime: jest.fn(),
      assertSignedIn: jest.fn(),
      captureSyntheticShortsVisual: jest.fn(async (_videoId, screenshotPath) => ({
        screenshotPath,
        viewport: currentViewport,
      })),
      captureWatchRatioVisual: jest.fn(async (_runtime, screenshotPath) => ({
        screenshotPath,
        viewport: currentViewport,
      })),
      openShort: jest.fn(),
      openWatch: jest.fn(),
      readViewportSize: jest.fn(async () => currentViewport),
      setViewportSize: jest.fn(async (viewport) => {
        currentViewport = viewport;
      }),
      waitForDislikeText: jest.fn(async () => "123"),
      withNoProductionInteractions: jest.fn(async (action) => action()),
    };
    const makeDirectory = jest.fn();
    const options = { ...OPTIONS, short: "shortsabcde", watchA: "abcdefghijk" };

    const result = await runResponsiveVisualScenario(driver, options, {
      makeDirectory,
      outputDirectory: "responsive-evidence",
    });

    expect(makeDirectory).toHaveBeenCalledWith("responsive-evidence");
    expect(driver.openWatch).toHaveBeenCalledWith(options.watchA);
    expect(driver.openShort).toHaveBeenCalledWith(options.short);
    expect(driver.assertCurrentShortsControl).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length);
    expect(driver.captureWatchRatioVisual).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length);
    expect(driver.captureSyntheticShortsVisual).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length);
    expect(driver.captureWatchRatioVisual.mock.calls.map(([, screenshotPath]) => screenshotPath)).toEqual(
      RESPONSIVE_VIEWPORTS.map(({ width }) => expect.stringContaining(`userscript-watch-ratio-${width}.png`)),
    );
    expect(driver.captureSyntheticShortsVisual.mock.calls.map(([, screenshotPath]) => screenshotPath)).toEqual(
      RESPONSIVE_VIEWPORTS.map(({ width }) => expect.stringContaining(`userscript-shorts-control-${width}.png`)),
    );
    expect(driver.setViewportSize).toHaveBeenLastCalledWith(originalViewport);
    expect(driver.withNoProductionInteractions).toHaveBeenCalledTimes(1);
    expect(driver.waitForDislikeText).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length * 2);
    expect(result.watch).toHaveLength(RESPONSIVE_VIEWPORTS.length);
    expect(result.shorts).toHaveLength(RESPONSIVE_VIEWPORTS.length);
    expect(result.shortsSkipped).toBeNull();
  });

  test("captures watch and native extension Shorts evidence at all responsive widths without actions", async () => {
    const originalViewport = { height: 900, width: 1440 };
    let currentViewport = originalViewport;
    const driver = {
      assertCurrentShortsControl: jest.fn(),
      assertRuntime: jest.fn(),
      assertSignedIn: jest.fn(),
      captureNativeShortsVisual: jest.fn(async (_videoId, screenshotPath) => ({
        screenshotPath,
        viewport: currentViewport,
      })),
      captureWatchRatioVisual: jest.fn(async (_runtime, screenshotPath) => ({
        screenshotPath,
        viewport: currentViewport,
      })),
      openShort: jest.fn(),
      openWatch: jest.fn(),
      readViewportSize: jest.fn(async () => currentViewport),
      setViewportSize: jest.fn(async (viewport) => {
        currentViewport = viewport;
      }),
      waitForDislikeText: jest.fn(async () => "123"),
      withNoProductionInteractions: jest.fn(async (action) => action()),
    };

    const result = await runResponsiveVisualScenario(
      driver,
      { ...OPTIONS, runtime: "extension", short: "shortsabcde", watchA: "abcdefghijk" },
      { makeDirectory: jest.fn(), outputDirectory: "responsive-evidence" },
    );

    expect(driver.openShort).toHaveBeenCalledWith("shortsabcde");
    expect(driver.assertCurrentShortsControl).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length);
    expect(driver.captureNativeShortsVisual).toHaveBeenCalledTimes(RESPONSIVE_VIEWPORTS.length);
    expect(driver.captureNativeShortsVisual.mock.calls.map(([, screenshotPath]) => screenshotPath)).toEqual(
      RESPONSIVE_VIEWPORTS.map(({ width }) => expect.stringContaining(`extension-shorts-control-${width}.png`)),
    );
    expect(result.shorts).toHaveLength(RESPONSIVE_VIEWPORTS.length);
    expect(result.shortsSkipped).toBeNull();
    expect(driver.setViewportSize).toHaveBeenLastCalledWith(originalViewport);
  });

  test("restores the original viewport when a visual assertion fails", async () => {
    const originalViewport = { height: 800, width: 1200 };
    const driver = {
      assertRuntime: jest.fn(),
      assertSignedIn: jest.fn(),
      captureWatchRatioVisual: jest.fn(async () => Promise.reject(new Error("visual failed"))),
      openWatch: jest.fn(),
      readViewportSize: jest.fn(async () => originalViewport),
      setViewportSize: jest.fn(),
      waitForDislikeText: jest.fn(async () => "123"),
      withNoProductionInteractions: jest.fn(async (action) => action()),
    };

    await expect(
      runResponsiveVisualScenario(
        driver,
        { ...OPTIONS, short: "shortsabcde", watchA: "abcdefghijk" },
        {
          makeDirectory: jest.fn(),
          outputDirectory: "responsive-evidence",
        },
      ),
    ).rejects.toThrow("visual failed");
    expect(driver.setViewportSize).toHaveBeenLastCalledWith(originalViewport);
  });
});
