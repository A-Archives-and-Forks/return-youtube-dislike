const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { WATCH_RATIO_SOAK_DURATION_MS } = require("./live-youtube-driver");

const RESPONSIVE_VIEWPORTS = [
  { height: 720, width: 1280 },
  { height: 720, width: 768 },
  { height: 844, width: 390 },
];

const REACTION_CYCLES = {
  neutral: ["like", "like", "dislike", "like", "dislike", "dislike"],
  liked: ["like", "dislike", "like", "dislike", "dislike", "like"],
  disliked: ["like", "dislike", "dislike", "like", "like", "dislike"],
};

function nextReactionState(state, action) {
  if (action === "like") return state === "liked" ? "neutral" : "liked";
  if (action === "dislike") return state === "disliked" ? "neutral" : "disliked";
  throw new Error(`Unsupported reaction action: ${action}`);
}

function reactionValue(state) {
  if (state === "liked") return 1;
  if (state === "disliked") return -1;
  if (state === "neutral") return 0;
  throw new Error(`Unsupported reaction state: ${state}`);
}

async function assertLivePreconditions(driver, options) {
  await driver.assertSignedIn(options.expectedChannel);
  await driver.assertRuntime(options.runtime, options.expectedVersion, options.expectedBuildId);
}

async function runWatchRenderScenario(driver, options) {
  return driver.withNoProductionInteractions(async () => {
    await driver.openPlaylist(options.playlistUrl, options.watchA);
    await assertLivePreconditions(driver, options);
    return driver.waitForDislikeText();
  });
}

async function runReloadScenario(driver, options) {
  return driver.withNoProductionInteractions(async () => {
    await driver.openPlaylist(options.playlistUrl, options.watchA);
    await assertLivePreconditions(driver, options);
    await driver.waitForDislikeText();
    await driver.reload(options.watchA);
    await assertLivePreconditions(driver, options);
    return driver.waitForDislikeText();
  });
}

async function runSpaNavigationScenario(driver, options) {
  return driver.withNoProductionInteractions(async () => {
    await driver.openPlaylist(options.playlistUrl, options.watchA);
    await assertLivePreconditions(driver, options);
    const watchACount = await driver.waitForDislikeText();
    await driver.navigateWithinPlaylist(options.watchB);
    await assertLivePreconditions(driver, options);
    const watchBCount = await driver.waitForDislikeText({ differentFrom: watchACount });
    assert.match(watchACount, /\d/);
    assert.match(watchBCount, /\d/);
    assert.notEqual(
      watchBCount,
      watchACount,
      "Choose allowlisted playlist videos whose rendered dislike counts differ so stale SPA UI can be detected.",
    );
    return { watchACount, watchBCount };
  });
}

async function runSidebarStressScenario(
  driver,
  options,
  {
    makeDirectory = (directory) => fs.mkdirSync(directory, { recursive: true }),
    outputDirectory = path.resolve(__dirname, "../../../../test-results/live-youtube/sidebar-stress"),
    readyTimeoutMs = 1_000,
    soakDurationMs = WATCH_RATIO_SOAK_DURATION_MS,
  } = {},
) {
  const hopCount = options.sidebar?.hopCount;
  assert.ok(Number.isSafeInteger(hopCount) && hopCount > 0, "A positive sidebar stress hop count is required.");
  assert.ok(
    Number.isFinite(readyTimeoutMs) && readyTimeoutMs > 0,
    "A positive ratio-bar readiness budget is required.",
  );
  makeDirectory(outputDirectory);

  return driver.withNoProductionInteractions(async () => {
    await driver.openWatch(options.watchA);
    await assertLivePreconditions(driver, options);
    const visitedVideoIds = [options.watchA];
    const hops = [];

    for (let index = 0; index < hopCount; index += 1) {
      const { body, videoId } = await driver.navigateToRelatedWatch(visitedVideoIds);
      assert.equal(typeof body.dislikes, "number", `Sidebar hop ${index + 1} has no production dislike count.`);
      assert.ok(!visitedVideoIds.includes(videoId), `Sidebar hop ${index + 1} revisited ${videoId}.`);
      driver.assertCurrentVideo(videoId);
      await assertLivePreconditions(driver, options);

      const screenshotPath = path.join(
        outputDirectory,
        `${options.runtime}-sidebar-hop-${String(index + 1).padStart(2, "0")}.png`,
      );
      const readinessStartedAt = Date.now();
      const visual = await driver.captureWatchRatioVisual(options.runtime, screenshotPath, {
        presenceTimeoutMs: readyTimeoutMs,
      });
      const readyLatencyMs = Date.now() - readinessStartedAt;
      assert.ok(
        readyLatencyMs <= readyTimeoutMs,
        `Sidebar hop ${index + 1} ratio bar took ${readyLatencyMs}ms; the budget is ${readyTimeoutMs}ms.`,
      );
      assert.match(visual.count, /\d/, `Sidebar hop ${index + 1} did not render a dislike count.`);
      const soak = await driver.soakWatchRatioVisual(options.runtime, {
        durationMs: soakDurationMs,
        expectedCount: visual.count,
        videoId,
      });

      visitedVideoIds.push(videoId);
      hops.push({
        apiDislikes: body.dislikes,
        count: visual.count,
        readyLatencyMs,
        readyTimeoutMs,
        screenshotPath,
        soak,
        videoId,
      });
    }

    return { hopCount, hops, outputDirectory, startVideoId: options.watchA };
  });
}

async function runShortsRenderScenario(driver, options) {
  return driver.withNoProductionInteractions(async () => {
    await driver.openShort(options.short);
    await assertLivePreconditions(driver, options);
    return driver.waitForDislikeText();
  });
}

async function runChannelShortsNavigationScenario(driver, options) {
  return driver.withNoProductionInteractions(async () => {
    await driver.navigateFromColdChannelToShort(options.navigation.channelUrl, options.navigation.short);
    await assertLivePreconditions(driver, options);
    const initial = await driver.assertCurrentShortsControl(options.navigation.short, options.runtime);

    const nextVideoId = await driver.navigateToNextShort(options.navigation.short);
    await driver.assertRuntime(options.runtime, options.expectedVersion, options.expectedBuildId);
    const next = await driver.assertCurrentShortsControl(nextVideoId, options.runtime);
    await driver.pausePlayback();
    assert.notEqual(
      next.videoId,
      initial.videoId,
      "The Shorts Next video scenario did not change the current video ID.",
    );
    return { initial, next };
  });
}

async function runChannelWatchNavigationScenario(driver, options) {
  if (!options.navigation.watch) {
    throw new Error("RYD_LIVE_NAV_WATCH is required for the optional channel-to-watch scenario.");
  }

  return driver.withNoProductionInteractions(async () => {
    await driver.navigateFromColdChannelToWatch(options.navigation.channelUrl, options.navigation.watch);
    await assertLivePreconditions(driver, options);
    const count = await driver.waitForDislikeText();
    return { count, videoId: options.navigation.watch };
  });
}

async function runResponsiveVisualScenario(
  driver,
  options,
  {
    makeDirectory = (directory) => fs.mkdirSync(directory, { recursive: true }),
    outputDirectory = path.resolve(__dirname, "../../../../test-results/live-youtube/responsive"),
  } = {},
) {
  makeDirectory(outputDirectory);
  return driver.withNoProductionInteractions(async () => {
    const originalViewport = await driver.readViewportSize();
    const watch = [];
    const shorts = [];

    try {
      await driver.setViewportSize(RESPONSIVE_VIEWPORTS[0]);
      await driver.openWatch(options.watchA);
      await assertLivePreconditions(driver, options);
      for (let index = 0; index < RESPONSIVE_VIEWPORTS.length; index += 1) {
        const viewport = RESPONSIVE_VIEWPORTS[index];
        if (index > 0) await driver.setViewportSize(viewport);
        await driver.waitForDislikeText();
        watch.push(
          await driver.captureWatchRatioVisual(
            options.runtime,
            path.join(outputDirectory, `${options.runtime}-watch-ratio-${viewport.width}.png`),
          ),
        );
      }

      await driver.setViewportSize(RESPONSIVE_VIEWPORTS[0]);
      await driver.openShort(options.short);
      await assertLivePreconditions(driver, options);
      for (let index = 0; index < RESPONSIVE_VIEWPORTS.length; index += 1) {
        const viewport = RESPONSIVE_VIEWPORTS[index];
        if (index > 0) await driver.setViewportSize(viewport);
        await driver.assertCurrentShortsControl(options.short, options.runtime);
        await driver.waitForDislikeText();
        const screenshotPath = path.join(outputDirectory, `${options.runtime}-shorts-control-${viewport.width}.png`);
        shorts.push(
          options.runtime === "userscript"
            ? await driver.captureSyntheticShortsVisual(options.short, screenshotPath)
            : await driver.captureNativeShortsVisual(options.short, screenshotPath),
        );
      }
    } finally {
      await driver.setViewportSize(originalViewport);
    }

    return {
      outputDirectory,
      shorts,
      shortsSkipped: null,
      watch,
    };
  });
}

async function restoreReactionStateUnchecked(
  driver,
  recorder,
  options,
  videoId,
  initialState,
  expectedUserId,
  isShort,
  failedAttempt,
) {
  try {
    driver.assertCurrentVideo(videoId);
  } catch {
    if (isShort) await driver.openShort(videoId);
    else await driver.openWatch(videoId);
    await assertLivePreconditions(driver, options);
  }

  const currentState = await driver.readReactionState();
  if (currentState === initialState && !failedAttempt) return;

  const attemptedUserId = failedAttempt?.userId;
  const assertCleanupUserId = (userId, roundTripUserId) => {
    assert.equal(typeof userId, "string", "The cleanup reaction has no anonymous RYD identity.");
    if (expectedUserId) {
      assert.equal(userId, expectedUserId, "The cleanup reaction used a different anonymous RYD identity.");
    }
    if (attemptedUserId) {
      assert.equal(userId, attemptedUserId, "The cleanup reaction did not use the failed attempt's RYD identity.");
    }
    if (roundTripUserId) {
      assert.equal(userId, roundTripUserId, "The cleanup round trip changed anonymous RYD identity.");
    }
  };
  const performCleanupTransition = async (action, targetState, roundTripUserId) => {
    const mark = recorder.mark();
    await driver.clickAction(videoId, action);
    await driver.waitForReactionState(targetState);
    const userId = await recorder.waitForHandshake(reactionValue(targetState), mark);
    assertCleanupUserId(userId, roundTripUserId);
    return userId;
  };

  if (currentState === initialState) {
    const action = initialState === "liked" ? "like" : "dislike";
    const awayState = initialState === "neutral" ? "disliked" : "neutral";
    const awayUserId = await performCleanupTransition(action, awayState);
    await performCleanupTransition(action, initialState, awayUserId);
    return;
  }

  const action =
    initialState === "neutral"
      ? currentState === "liked"
        ? "like"
        : "dislike"
      : initialState === "liked"
        ? "like"
        : "dislike";
  await performCleanupTransition(action, initialState);
}

async function restoreReactionState(
  driver,
  recorder,
  options,
  videoId,
  initialState,
  expectedUserId,
  isShort,
  failedAttempt,
) {
  try {
    await restoreReactionStateUnchecked(
      driver,
      recorder,
      options,
      videoId,
      initialState,
      expectedUserId,
      isShort,
      failedAttempt,
    );
  } catch (error) {
    const url = isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`;
    throw new Error(`Automatic cleanup could not be verified. Manually restore ${url}. ${error.message}`, {
      cause: error,
    });
  }
}

async function runReactionCycle(
  driver,
  recorder,
  options,
  { beforeFirstAction, captureReactionVisual = null, isShort = false, videoId },
) {
  if (isShort) await driver.openShort(videoId);
  else await driver.openWatch(videoId);
  await assertLivePreconditions(driver, options);
  await driver.waitForDislikeText();

  const initialState = await driver.readReactionState();
  const actions = REACTION_CYCLES[initialState];
  assert.ok(actions, `Unsupported initial YouTube reaction state: ${initialState}`);

  let authorized = false;
  let completed = false;
  let expectedUserId;
  let failedAttempt;
  let currentState = initialState;
  const evidencePaths = [];
  const captureEvidence = async (index) => {
    if (!captureReactionVisual) return;
    const screenshotPath = await captureReactionVisual({ index, state: currentState });
    assert.equal(typeof screenshotPath, "string", "The reaction visual capture did not return an evidence path.");
    evidencePaths.push(screenshotPath);
  };
  try {
    await captureEvidence(0);
    driver.assertCurrentVideo(videoId);
    await assertLivePreconditions(driver, options);
    if (beforeFirstAction) await beforeFirstAction();
    authorized = true;

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      const expectedState = nextReactionState(currentState, action);
      const mark = recorder.mark();
      const value = reactionValue(expectedState);
      failedAttempt = { mark, userId: undefined, value };
      await driver.clickAction(videoId, action);
      await driver.waitForReactionState(expectedState);
      const userId = await recorder.waitForHandshake(value, mark);
      failedAttempt.userId = userId;
      if (expectedUserId) assert.equal(userId, expectedUserId, "The transition cycle changed anonymous RYD identity.");
      expectedUserId = userId;
      failedAttempt = undefined;
      currentState = expectedState;
      await driver.waitForDislikeText();
      await captureEvidence(index + 1);
    }

    assert.equal(currentState, initialState, "The six-transition cycle did not return to its initial state.");
    completed = true;
    return { evidencePaths, initialState, userId: expectedUserId };
  } finally {
    if (authorized && !completed) {
      if (failedAttempt && !failedAttempt.userId && typeof recorder.voteUserId === "function") {
        try {
          failedAttempt.userId = recorder.voteUserId(failedAttempt.value, failedAttempt.mark);
        } catch {
          failedAttempt.userId = undefined;
        }
      }
      await restoreReactionState(
        driver,
        recorder,
        options,
        videoId,
        initialState,
        expectedUserId,
        isShort,
        failedAttempt,
      );
    }
  }
}

async function runProductionReactionMatrixScenario(
  driver,
  options,
  createRecorder,
  consumeVoteApproval,
  visualOptions = {},
) {
  const makeDirectory = visualOptions.makeDirectory ?? ((directory) => fs.mkdirSync(directory, { recursive: true }));
  const outputDirectory =
    visualOptions.outputDirectory ??
    path.resolve(__dirname, "../../../../test-results/live-youtube/reactions", options.runtime);
  makeDirectory(outputDirectory);
  const captureFor =
    (kind, videoId, isShort) =>
    async ({ index, state }) => {
      const screenshotPath = path.join(outputDirectory, `${kind}-${index}-${state}.png`);
      const evidence = await driver.captureReactionStateVisual({
        expectedState: state,
        isShort,
        runtime: options.runtime,
        screenshotPath,
        videoId,
      });
      assert.equal(
        evidence?.screenshotPath,
        screenshotPath,
        `The ${kind} reaction capture did not write the requested evidence path.`,
      );
      return screenshotPath;
    };

  const watchRecorder = createRecorder(options.watchB);
  let watchResult;
  try {
    watchResult = await runReactionCycle(driver, watchRecorder, options, {
      beforeFirstAction: consumeVoteApproval,
      captureReactionVisual: captureFor("watch", options.watchB, false),
      videoId: options.watchB,
    });
  } finally {
    watchRecorder.stop();
  }

  const shortRecorder = createRecorder(options.short);
  try {
    const shortResult = await runReactionCycle(driver, shortRecorder, options, {
      captureReactionVisual: captureFor("short", options.short, true),
      isShort: true,
      videoId: options.short,
    });
    assert.equal(
      shortResult.userId,
      watchResult.userId,
      "Watch and Shorts votes used different anonymous RYD identities.",
    );
    return {
      evidencePaths: [...watchResult.evidencePaths, ...shortResult.evidencePaths],
      outputDirectory,
      short: shortResult,
      watch: watchResult,
    };
  } finally {
    shortRecorder.stop();
  }
}

async function restoreNeutralStateUnchecked(driver, recorder, options, dislikeMark, expectedUserId) {
  let state;
  try {
    driver.assertCurrentVideo(options.watchB);
    state = await driver.readVoteState();
  } catch {
    await driver.openWatch(options.watchB);
    await assertLivePreconditions(driver, options);
    state = await driver.readVoteState();
  }

  if (state === "false") {
    if (recorder.hasVote(-1, dislikeMark)) {
      throw new Error(
        `The YouTube button is neutral but the production -1 vote may remain. Manually verify and restore https://www.youtube.com/watch?v=${options.watchB}.`,
      );
    }
    return;
  }
  if (state !== "true") {
    throw new Error(
      `Could not verify the YouTube dislike state. Manually restore https://www.youtube.com/watch?v=${options.watchB}.`,
    );
  }

  const neutralMark = recorder.mark();
  await driver.clickDislike(options.watchB);
  await driver.waitForVoteState(false);
  const neutralUserId = await recorder.waitForHandshake(0, neutralMark);
  if (expectedUserId && neutralUserId !== expectedUserId) {
    throw new Error(
      `The neutral vote used a different identity from the dislike vote. Manually verify and restore https://www.youtube.com/watch?v=${options.watchB}.`,
    );
  }
}

async function restoreNeutralState(driver, recorder, options, dislikeMark, expectedUserId) {
  try {
    await restoreNeutralStateUnchecked(driver, recorder, options, dislikeMark, expectedUserId);
  } catch (error) {
    throw new Error(
      `Automatic cleanup could not be verified. Manually restore https://www.youtube.com/watch?v=${options.watchB}. ${error.message}`,
      { cause: error },
    );
  }
}

async function runReversibleVoteScenario(driver, recorder, options, consumeVoteApproval) {
  await driver.openWatch(options.watchB);
  await assertLivePreconditions(driver, options);
  await driver.waitForDislikeText();
  const initialLikeState = await driver.readLikeState();
  const initialDislikeState = await driver.readVoteState();
  assert.equal(initialLikeState, "false", "The allowlisted vote video must not already be liked.");
  assert.equal(initialDislikeState, "false", "The allowlisted vote video must not already be disliked.");

  const dislikeMark = recorder.mark();
  let cleanupRequired = false;
  let dislikeUserId;
  try {
    driver.assertCurrentVideo(options.watchB);
    await assertLivePreconditions(driver, options);
    await consumeVoteApproval();
    cleanupRequired = true;
    await driver.clickDislike(options.watchB);
    await driver.waitForVoteState(true);
    dislikeUserId = await recorder.waitForHandshake(-1, dislikeMark);
  } finally {
    if (cleanupRequired) {
      await restoreNeutralState(
        driver,
        recorder,
        options,
        dislikeMark,
        dislikeUserId || recorder.voteUserId(-1, dislikeMark),
      );
    }
  }
  await driver.waitForDislikeText();
}

module.exports = {
  RESPONSIVE_VIEWPORTS,
  runChannelShortsNavigationScenario,
  runChannelWatchNavigationScenario,
  runProductionReactionMatrixScenario,
  runReactionCycle,
  runReloadScenario,
  runReversibleVoteScenario,
  runResponsiveVisualScenario,
  runSidebarStressScenario,
  runShortsRenderScenario,
  runSpaNavigationScenario,
  runWatchRenderScenario,
};
