/**
 * @jest-environment jsdom
 */

const {
  LiveYoutubeDriver,
  assertNativeShortsPairGeometry,
  assertReactionPressedStates,
  assertShortsActionStackGeometry,
  assertSyntheticShortsGeometry,
  assertWatchRatioViewportAlignment,
  clickWithSingleNavigationRetry,
  croppedScreenshotClip,
  firstVisibleRelatedWatchLink,
  isShortCandidateEligible,
  isShortsIconVisualReady,
  readDislikeControlText,
  relatedWatchVideoId,
} = require("../e2e/live/live-youtube-driver");

const VISIBLE_RECT = {
  bottom: 200,
  height: 100,
  left: 10,
  right: 110,
  top: 100,
  width: 100,
};

const ACTION_HOST_STYLE = {
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  paddingBottom: 8,
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
};
const COUNT_STYLE = {
  fontFamily: '"Roboto", "Arial", sans-serif',
  fontSize: 12,
  fontStyle: "normal",
  fontWeight: "400",
  lineHeight: 18,
};

function box(x, y, width, height) {
  return { height, width, x, y };
}

function validSyntheticShortsGeometry() {
  return {
    like: {
      button: box(100, 10, 48, 48),
      count: box(110, 58, 28, 14),
      countStyle: { ...COUNT_STYLE },
      host: box(100, 10, 48, 78),
      hostStyle: { ...ACTION_HOST_STYLE },
      icon: box(112, 22, 24, 24),
      label: box(100, 10, 48, 70),
      svg: box(112, 22, 24, 24),
    },
    next: {
      host: box(100, 166, 48, 78),
    },
    synthetic: {
      button: box(100, 88, 48, 48),
      count: box(109, 136, 30, 14),
      countStyle: { ...COUNT_STYLE },
      host: box(100, 88, 48, 78),
      hostStyle: { ...ACTION_HOST_STYLE },
      icon: box(112, 100, 24, 24),
      label: box(100, 88, 48, 70),
      svg: box(112, 100, 24, 24),
    },
  };
}

function validNativeShortsPairGeometry() {
  const syntheticGeometry = validSyntheticShortsGeometry();
  const enrich = (geometry, actionIndex) => ({
    ...geometry,
    actionIndex,
    reelIndex: 2,
    videoMatches: true,
  });
  return {
    dislike: enrich(syntheticGeometry.synthetic, 4),
    like: enrich(syntheticGeometry.like, 3),
  };
}

function renderShort({ href, rendererVideoId } = {}) {
  document.body.innerHTML = `
    <ytd-reel-video-renderer${rendererVideoId ? ` video-id="${rendererVideoId}"` : ""}>
      ${href ? `<a href="${href}"></a>` : ""}
      <button type="button">Dislike</button>
    </ytd-reel-video-renderer>
  `;
  const reel = document.querySelector("ytd-reel-video-renderer");
  const button = reel.querySelector("button");
  reel.getBoundingClientRect = jest.fn(() => VISIBLE_RECT);
  button.getBoundingClientRect = jest.fn(() => VISIBLE_RECT);
  return { button, reel };
}

const activeShortSettings = (videoId) => ({
  activeShortRequired: true,
  expectedShortVideoId: videoId,
});

beforeEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 768 });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1024 });
  document.body.innerHTML = "";
});

describe("exact installed live-build identity", () => {
  const buildId = "0123456789abcdef0123456789abcdef";

  function createDriver(markers) {
    const page = {
      locator: jest.fn((selector) => {
        expect(selector).toBe("html");
        return { evaluate: jest.fn(async () => markers) };
      }),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
    return new LiveYoutubeDriver(page, {});
  }

  test.each(["userscript", "extension"])("accepts only the exact installed %s live build", async (runtime) => {
    const otherRuntime = runtime === "userscript" ? "extension" : "userscript";
    const markers = {
      extension: null,
      extensionBuild: null,
      userscript: null,
      userscriptBuild: null,
      [runtime]: runtime === "userscript" ? "3.2.0" : "4.0.4",
      [`${runtime}Build`]: buildId,
    };
    const driver = createDriver(markers);

    await expect(driver.assertRuntime(runtime, markers[runtime], buildId)).resolves.toBeUndefined();
    expect(markers[otherRuntime]).toBeNull();
  });

  test("rejects a stale userscript build even when its version matches", async () => {
    const driver = createDriver({
      extension: null,
      extensionBuild: null,
      userscript: "3.2.0",
      userscriptBuild: "f".repeat(32),
    });

    await expect(driver.assertRuntime("userscript", "3.2.0", buildId)).rejects.toThrow(
      "match the freshly generated artifact",
    );
  });

  test.each([undefined, "", "stale", "A".repeat(32)])(
    "refuses to test without a valid exact build ID: %p",
    async (expectedBuildId) => {
      const driver = createDriver({
        extension: null,
        extensionBuild: null,
        userscript: "3.2.0",
        userscriptBuild: buildId,
      });

      await expect(driver.assertRuntime("userscript", "3.2.0", expectedBuildId)).rejects.toThrow(
        "exact 32-character live build ID",
      );
    },
  );

  test("rejects an enabled opposite runtime even when the selected marker is exact", async () => {
    const driver = createDriver({
      extension: "4.0.4",
      extensionBuild: "f".repeat(32),
      userscript: "3.2.0",
      userscriptBuild: buildId,
    });

    await expect(driver.assertRuntime("userscript", "3.2.0", buildId)).rejects.toThrow(
      "Disable the extension before running the userscript smoke",
    );
  });
});

describe("isShortCandidateEligible", () => {
  test("accepts an exact renderer video-id without requiring a Shorts link", () => {
    const { button } = renderShort({ rendererVideoId: "current-video" });

    expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(true);
  });

  test("accepts an exact Shorts link when the renderer has no video-id", () => {
    const { button } = renderShort({ href: "/shorts/current-video?feature=share" });

    expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(true);
  });

  test("rejects a matching descendant link when the renderer video-id identifies another Short", () => {
    const { button } = renderShort({ href: "/shorts/current-video", rendererVideoId: "outgoing-video" });

    expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(false);
  });

  test.each(["/shorts/current-video-extra", "/shorts/current-video/related", "/shorts/other-video"])(
    "rejects a non-exact Shorts link: %s",
    (href) => {
      const { button } = renderShort({ href });

      expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(false);
    },
  );

  test("rejects an exact video outside the viewport", () => {
    const { button, reel } = renderShort({ rendererVideoId: "current-video" });
    reel.getBoundingClientRect = jest.fn(() => ({ ...VISIBLE_RECT, bottom: -1, top: -101 }));

    expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(false);
  });

  test("rejects an action button outside the viewport even when its renderer intersects", () => {
    const { button } = renderShort({ rendererVideoId: "current-video" });
    button.getBoundingClientRect = jest.fn(() => ({ ...VISIBLE_RECT, left: 1100, right: 1200 }));

    expect(isShortCandidateEligible(button, activeShortSettings("current-video"))).toBe(false);
  });
});

describe("readDislikeControlText", () => {
  test("reads a synthetic control count from the sibling of its inner button", () => {
    document.body.innerHTML = `
      <div data-ryd-synthetic-shorts-dislike>
        <div>
          <button type="button" aria-pressed="false"><svg></svg></button>
          <div><span id="text" role="text">1.2K</span></div>
        </div>
      </div>
    `;

    expect(readDislikeControlText(document.querySelector("button"))).toBe("1.2K");
  });

  test("continues to read native dislike text from the button", () => {
    document.body.innerHTML = `<button type="button"><span role="text">456</span></button>`;

    expect(readDislikeControlText(document.querySelector("button"))).toBe("456");
  });
});

describe("relatedWatchVideoId", () => {
  const settings = {
    currentVideoId: "abcdefghijk",
    excludedVideoIds: ["excluded001"],
    origin: "https://www.youtube.com",
  };

  function read(href, overrides = {}) {
    const link = document.createElement("a");
    link.setAttribute("href", href);
    return relatedWatchVideoId(link, { ...settings, ...overrides });
  }

  test("accepts an exact same-origin watch target while preserving harmless query parameters", () => {
    expect(read("/watch?v=targetvid01&pp=sidebar")).toBe("targetvid01");
  });

  test.each([
    ["/watch?v=abcdefghijk", "current video"],
    ["/watch?v=excluded001", "previously visited video"],
    ["/watch?v=too-short", "invalid video ID"],
    ["/shorts/targetvid01", "Shorts URL"],
    ["https://example.com/watch?v=targetvid01", "cross-origin URL"],
    ["https://www.youtube.com.evil.example/watch?v=targetvid01", "lookalike host"],
  ])("rejects a %s (%s)", (href) => {
    expect(read(href)).toBeNull();
  });
});

describe("firstVisibleRelatedWatchLink", () => {
  function relatedLink(href, { visible = true, label = href } = {}) {
    const element = document.createElement("a");
    element.setAttribute("href", href);
    element.textContent = label;
    return {
      element,
      evaluate: async (callback, settings) => callback(element, settings),
      isVisible: async () => visible,
    };
  }

  function relatedPage(candidates) {
    const locator = {
      count: async () => candidates.length,
      nth: (index) => candidates[index],
    };
    return {
      locator,
      page: {
        locator: jest.fn(() => locator),
        url: jest.fn(() => "https://www.youtube.com/watch?v=abcdefghijk"),
      },
    };
  }

  test("selects the first visible exact generic related anchor without renderer or thumbnail markup", async () => {
    const offscreenThumbnail = relatedLink("/watch?v=targetvid01&pp=thumbnail", {
      label: "thumbnail duplicate",
      visible: false,
    });
    const currentVideo = relatedLink("/watch?v=abcdefghijk", { label: "current video" });
    const excludedVideo = relatedLink("/watch?v=excluded001", { label: "visited video" });
    const genericTitle = relatedLink("/watch?v=targetvid01&pp=title", { label: "generic title link" });
    const visibleThumbnailDuplicate = relatedLink("/watch?v=targetvid01&pp=thumbnail", {
      label: "visible thumbnail duplicate",
    });
    const laterTarget = relatedLink("/watch?v=latervideo1", { label: "later target" });
    const { page } = relatedPage([
      offscreenThumbnail,
      currentVideo,
      excludedVideo,
      genericTitle,
      visibleThumbnailDuplicate,
      laterTarget,
    ]);

    await expect(firstVisibleRelatedWatchLink(page, "abcdefghijk", ["excluded001"], 100)).resolves.toEqual({
      link: genericTitle,
      videoId: "targetvid01",
    });
    expect(page.locator).toHaveBeenCalledTimes(1);
    expect(page.locator).toHaveBeenCalledWith('#related a[href*="/watch"]');
  });
});

describe("live playback diagnostics", () => {
  test("reports that playback was intentionally paused", async () => {
    const videos = [{ pause: jest.fn() }, { pause: jest.fn() }];
    const page = {
      locator: jest.fn(() => ({ evaluateAll: async (callback) => callback(videos) })),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
      url: jest.fn(() => "https://www.youtube.com/shorts/abcdefghijk"),
    };
    const reportProgress = jest.fn();
    const driver = new LiveYoutubeDriver(page, {}, { reportProgress });

    await expect(driver.pausePlayback()).resolves.toEqual({ pauseFailures: [], pausedVideos: 2 });

    expect(videos.every(({ pause }) => pause.mock.calls.length === 1)).toBe(true);
    expect(reportProgress).toHaveBeenCalledWith("playback.paused", {
      explanation: "The live smoke pauses media intentionally while it validates the current page",
      pauseFailures: [],
      pausedVideos: 2,
      url: "https://www.youtube.com/shorts/abcdefghijk",
    });
  });

  test("catches individual synchronous pause failures without waiting on media playback", async () => {
    const videos = [
      { pause: jest.fn(() => undefined) },
      {
        pause: jest.fn(() => {
          throw new Error("media state unavailable");
        }),
      },
    ];
    const page = {
      locator: jest.fn(() => ({ evaluateAll: async (callback) => callback(videos) })),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
      url: jest.fn(() => "https://www.youtube.com/shorts/abcdefghijk"),
    };
    const driver = new LiveYoutubeDriver(page, {});

    await expect(driver.pausePlayback()).resolves.toEqual({
      pauseFailures: ["media state unavailable"],
      pausedVideos: 1,
    });
  });

  test("waits for a new video URL without pausing until the caller requests stable playback", async () => {
    const videos = [{ pause: jest.fn() }];
    const page = {
      locator: jest.fn(() => ({ evaluateAll: async (callback) => callback(videos) })),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
      url: jest.fn(() => "https://www.youtube.com/shorts/abcdefghijk"),
    };
    const driver = new LiveYoutubeDriver(page, {});

    await driver.waitForVideoUrl("abcdefghijk");
    expect(page.locator).not.toHaveBeenCalled();
    expect(videos[0].pause).not.toHaveBeenCalled();

    await driver.waitForVideo("abcdefghijk");
    expect(page.locator).toHaveBeenCalledWith("video");
    expect(videos[0].pause).toHaveBeenCalledTimes(1);
  });
});

describe("watch ratio-bar soak", () => {
  test("rechecks the current video, bar geometry, and stable count for the requested interval", async () => {
    const page = {
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
    const reportProgress = jest.fn();
    const driver = new LiveYoutubeDriver(page, {}, { reportProgress });
    driver.assertCurrentVideo = jest.fn();
    driver.assertWatchRatioVisual = jest.fn(async () => ({ count: "123" }));

    const result = await driver.soakWatchRatioVisual("userscript", {
      durationMs: 1,
      expectedCount: "123",
      intervalMs: 1,
      videoId: "targetvid01",
    });

    expect(driver.assertCurrentVideo).toHaveBeenCalledWith("targetvid01");
    expect(driver.assertWatchRatioVisual).toHaveBeenCalledWith("userscript", { expectedCount: "123" });
    expect(result).toEqual({
      count: "123",
      durationMs: 1,
      sampleCount: driver.assertWatchRatioVisual.mock.calls.length,
      videoId: "targetvid01",
    });
    expect(reportProgress).toHaveBeenNthCalledWith(1, "watch-ratio-soak.start", {
      durationMs: 1,
      expectedCount: "123",
      runtime: "userscript",
      videoId: "targetvid01",
    });
    expect(reportProgress).toHaveBeenLastCalledWith("watch-ratio-soak.complete", {
      durationMs: 1,
      expectedCount: "123",
      runtime: "userscript",
      sampleCount: result.sampleCount,
      videoId: "targetvid01",
    });
  });
});

describe("reaction visual capture hygiene", () => {
  function createCapturePage(tooltip, videoBoxes = []) {
    const tooltipList = {
      count: jest.fn(async () => 1),
      nth: jest.fn(() => tooltip),
    };
    const videos = videoBoxes.map((measurement) => ({
      boundingBox: jest.fn(async () => measurement),
      isVisible: jest.fn(async () => true),
    }));
    const videoList = {
      count: jest.fn(async () => videos.length),
      nth: jest.fn((index) => videos[index]),
    };
    return {
      evaluate: jest.fn(async () => undefined),
      locator: jest.fn((selector) => (selector === "video" ? videoList : tooltipList)),
      mouse: { move: jest.fn(async () => undefined) },
      screenshot: jest.fn(async () => undefined),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
  }

  test("parks the pointer inside the largest visible video and outside controls before capturing", async () => {
    const tooltip = {
      innerText: jest.fn(async () => "I like this"),
      isVisible: jest.fn().mockResolvedValueOnce(true).mockResolvedValue(false),
    };
    const preloadedVideo = box(0, 0, 320, 180);
    const currentVideo = box(100, 40, 800, 640);
    const page = createCapturePage(tooltip, [preloadedVideo, currentVideo]);
    const driver = new LiveYoutubeDriver(page, {}, { visualTooltipTimeout: 1_000 });
    const control = box(900, 500, 48, 78);
    driver.readViewportSize = jest.fn(async () => ({ height: 720, width: 1280 }));

    await expect(driver.captureCroppedScreenshot("short-liked.png", [control])).resolves.toEqual({
      height: 102,
      width: 72,
      x: 888,
      y: 488,
    });

    const [pointerX, pointerY] = page.mouse.move.mock.calls[0];
    expect({ x: pointerX, y: pointerY }).toEqual({ x: 500, y: 360 });
    expect(pointerX).toBeGreaterThan(currentVideo.x);
    expect(pointerX).toBeLessThan(currentVideo.x + currentVideo.width);
    expect(pointerY).toBeGreaterThan(currentVideo.y);
    expect(pointerY).toBeLessThan(currentVideo.y + currentVideo.height);
    expect(
      pointerX < control.x ||
        pointerX > control.x + control.width ||
        pointerY < control.y ||
        pointerY > control.y + control.height,
    ).toBe(true);
    expect(tooltip.isVisible).toHaveBeenCalledTimes(2);
    expect(page.mouse.move.mock.invocationCallOrder[0]).toBeLessThan(page.screenshot.mock.invocationCallOrder[0]);
    expect(page.screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ path: "short-liked.png", clip: { height: 102, width: 72, x: 888, y: 488 } }),
    );
  });

  test("fails within the configured bound instead of capturing a persistent native tooltip", async () => {
    const tooltip = {
      innerText: jest.fn(async () => "I like this"),
      isVisible: jest.fn(async () => true),
    };
    const page = createCapturePage(tooltip);
    const driver = new LiveYoutubeDriver(page, {}, { visualTooltipTimeout: 1 });
    driver.readViewportSize = jest.fn(async () => ({ height: 720, width: 1280 }));

    await expect(driver.captureCroppedScreenshot("obscured.png", [box(900, 500, 48, 78)])).rejects.toThrow(
      /Timed out waiting for native YouTube tooltips.*I like this/,
    );

    expect(page.mouse.move).toHaveBeenCalledTimes(1);
    expect(page.screenshot).not.toHaveBeenCalled();
  });
});

describe("watch reaction screenshot bounds", () => {
  function visibleBoxLocator(measurement) {
    const locator = {
      boundingBox: jest.fn(async () => measurement),
      count: jest.fn(async () => 1),
      isVisible: jest.fn(async () => true),
      nth: jest.fn(() => locator),
      scrollIntoViewIfNeeded: jest.fn(async () => undefined),
    };
    return locator;
  }

  test("passes the full ratio wrapper to the crop so its bottom label is retained", async () => {
    const viewport = { height: 300, width: 500 };
    const likeBox = box(100, 100, 80, 40);
    const dislikeBox = box(180, 100, 80, 40);
    const containerBox = box(100, 144, 160, 2);
    const barBox = box(100, 144, 120, 2);
    const wrapperBox = box(100, 140, 160, 62);
    const like = visibleBoxLocator(likeBox);
    const dislike = visibleBoxLocator(dislikeBox);
    const bar = visibleBoxLocator(barBox);
    const wrapper = visibleBoxLocator(wrapperBox);
    const container = visibleBoxLocator(containerBox);
    container.locator = jest.fn(() => wrapper);
    const page = {
      locator: jest.fn((selector) => (selector === "#return-youtube-dislike-bar-container" ? container : bar)),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
    const driver = new LiveYoutubeDriver(page, {});
    driver.captureCroppedScreenshot = jest.fn(async (_path, boxes) => croppedScreenshotClip(boxes, viewport));
    driver.readViewportSize = jest.fn(async () => viewport);
    driver.visibleDislikeButton = jest.fn(async () => dislike);
    driver.visibleLikeButton = jest.fn(async () => like);
    driver.waitForDislikeText = jest.fn(async () => "123");

    const result = await driver.captureWatchRatioVisual("userscript", "watch-liked.png");

    expect(driver.captureCroppedScreenshot).toHaveBeenCalledWith("watch-liked.png", [
      likeBox,
      dislikeBox,
      containerBox,
      wrapperBox,
    ]);
    expect(result.screenshotClip.y + result.screenshotClip.height).toBe(wrapperBox.y + wrapperBox.height + 12);
    expect(result.screenshotClip.y + result.screenshotClip.height).toBeGreaterThan(
      containerBox.y + containerBox.height + 12,
    );
  });

  test("rejects duplicate visible runtime bars before taking evidence", async () => {
    const candidates = [{ isVisible: jest.fn(async () => true) }, { isVisible: jest.fn(async () => true) }];
    const duplicateContainers = {
      count: jest.fn(async () => candidates.length),
      nth: jest.fn((index) => candidates[index]),
    };
    const bar = visibleBoxLocator(box(100, 144, 120, 2));
    const page = {
      locator: jest.fn((selector) =>
        selector === "#return-youtube-dislike-bar-container" ? duplicateContainers : bar,
      ),
      setDefaultNavigationTimeout: jest.fn(),
      setDefaultTimeout: jest.fn(),
    };
    const driver = new LiveYoutubeDriver(page, {});

    await expect(driver.captureWatchRatioVisual("userscript", "duplicate.png")).rejects.toThrow(
      "Expected exactly one visible userscript watch ratio bar; found 2.",
    );
  });
});

describe("live Shorts Next navigation retry", () => {
  test("retries exactly once when YouTube ignores the first trusted click", async () => {
    let navigated = false;
    const click = jest.fn().mockResolvedValue(undefined);
    const reportProgress = jest.fn();
    const waitForNavigation = jest
      .fn()
      .mockRejectedValueOnce(new Error("first navigation timed out"))
      .mockImplementationOnce(async () => {
        navigated = true;
      });

    await expect(
      clickWithSingleNavigationRetry({
        click,
        hasNavigated: () => navigated,
        reportProgress,
        retryDetails: { previousVideoId: "abcdefghijk" },
        waitForNavigation,
      }),
    ).resolves.toEqual({ retried: true });

    expect(click.mock.calls).toEqual([
      [1, 5_000],
      [2, 25_000],
    ]);
    expect(waitForNavigation.mock.calls.map(([timeout]) => timeout)).toEqual([5_000, 25_000]);
    expect(reportProgress).toHaveBeenCalledTimes(1);
    expect(reportProgress).toHaveBeenCalledWith("shorts-next-control.retrying", {
      firstFailure: "first navigation timed out",
      firstTimeoutMs: 5_000,
      previousVideoId: "abcdefghijk",
      retryTimeoutMs: 25_000,
    });
  });

  test("fails after the single retry instead of clicking a third time", async () => {
    const click = jest.fn().mockResolvedValue(undefined);
    const reportProgress = jest.fn();
    const waitForNavigation = jest
      .fn()
      .mockRejectedValueOnce(new Error("first navigation timed out"))
      .mockRejectedValueOnce(new Error("retry navigation timed out"));

    await expect(
      clickWithSingleNavigationRetry({
        click,
        hasNavigated: () => false,
        reportProgress,
        retryDetails: { previousVideoId: "abcdefghijk" },
        waitForNavigation,
      }),
    ).rejects.toThrow(/first Shorts Next click or its single retry/);

    expect(click).toHaveBeenCalledTimes(2);
    expect(waitForNavigation).toHaveBeenCalledTimes(2);
    expect(reportProgress).toHaveBeenCalledTimes(1);
  });

  test("does not retry when navigation completed at the first timeout boundary", async () => {
    let navigated = false;
    const click = jest.fn().mockResolvedValue(undefined);
    const reportProgress = jest.fn();
    const waitForNavigation = jest.fn(async () => {
      navigated = true;
      throw new Error("navigation event timed out after the URL changed");
    });

    await expect(
      clickWithSingleNavigationRetry({
        click,
        hasNavigated: () => navigated,
        reportProgress,
        retryDetails: { previousVideoId: "abcdefghijk" },
        waitForNavigation,
      }),
    ).resolves.toEqual({ retried: false });

    expect(click).toHaveBeenCalledTimes(1);
    expect(reportProgress).not.toHaveBeenCalled();
  });
});

describe("watch ratio viewport alignment", () => {
  const viewport = { height: 844, width: 375 };
  const like = box(-25.828, 700, 80.77, 40);
  const dislike = box(54.942, 700, 84.658, 40);

  test("allows the ratio bar to share YouTube's native horizontal clipping exactly", () => {
    const container = box(-25.828, 744, 165.428, 2);

    expect(assertWatchRatioViewportAlignment(container, like, dislike, viewport)).toEqual({
      nativeControlsAreHorizontallyClipped: true,
      nativeLeft: -25.828,
      nativeRight: 139.6,
    });
  });

  test("rejects ratio-bar clipping that extends beyond the native reaction controls", () => {
    const container = box(-35.828, 744, 175.428, 2);

    expect(() => assertWatchRatioViewportAlignment(container, like, dislike, viewport)).toThrow(
      /left edge alignment with native reaction controls/,
    );
  });

  test("retains the strict viewport assertion when native controls are in bounds", () => {
    const inBoundsLike = box(10, 700, 80, 40);
    const inBoundsDislike = box(90, 700, 85, 40);
    const clippedContainer = box(-2, 744, 177, 2);

    expect(() => assertWatchRatioViewportAlignment(clippedContainer, inBoundsLike, inBoundsDislike, viewport)).toThrow(
      /Watch ratio bar is clipped past the viewport's left edge/,
    );
  });
});

describe("assertReactionPressedStates", () => {
  test.each([
    ["neutral", { dislikeState: "false", likeState: "false" }],
    ["liked", { dislikeState: "false", likeState: "true" }],
    ["disliked", { dislikeState: "true", likeState: "false" }],
  ])("accepts the exact mutually-exclusive %s state", (expectedState, pressedStates) => {
    expect(() => assertReactionPressedStates(pressedStates, expectedState)).not.toThrow();
  });

  test("rejects a valid but unexpected pressed state", () => {
    expect(() => assertReactionPressedStates({ dislikeState: "false", likeState: "true" }, "neutral")).toThrow(
      /Expected YouTube reaction state neutral/,
    );
  });

  test("rejects Like and Dislike being selected together", () => {
    expect(() => assertReactionPressedStates({ dislikeState: "true", likeState: "true" }, "liked")).toThrow(
      /Like and Dislike as selected/,
    );
  });

  test("rejects an invalid pressed-state value", () => {
    expect(() => assertReactionPressedStates({ dislikeState: null, likeState: "false" }, "neutral")).toThrow(
      /Unexpected YouTube dislike state/,
    );
  });
});

describe("assertSyntheticShortsGeometry", () => {
  test("accepts the measured native Shorts action geometry", () => {
    expect(() => assertSyntheticShortsGeometry(validSyntheticShortsGeometry())).not.toThrow();
  });

  test.each([
    ["icon container", "icon"],
    ["SVG", "svg"],
  ])("rejects an 8px-wide synthetic %s", (_label, property) => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic[property].width = 8;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(
      new RegExp(`Synthetic Shorts ${property === "svg" ? "SVG" : "icon container"} width`),
    );
  });

  test("rejects a synthetic action host with a 16px margin", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.hostStyle.marginTop = 16;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(/Synthetic Shorts action host marginTop/);
  });

  test("rejects a gap between Like and the synthetic action", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.host.y += 16;
    measurement.next.host.y += 16;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(
      /Gap between native Like and synthetic Shorts action hosts/,
    );
  });

  test("rejects a gap between the synthetic and following actions", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.next.host.y += 2;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(
      /Gap between synthetic Shorts and following action hosts/,
    );
  });

  test.each([
    ["button", "width", 44, /Synthetic Shorts button width/],
    ["label", "height", 68, /Synthetic Shorts label height/],
    ["host", "height", 80, /Synthetic Shorts action host height/],
  ])("rejects a mismatched synthetic %s %s", (part, dimension, value, message) => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic[part][dimension] = value;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(message);
  });

  test("rejects incorrect action-host padding", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.hostStyle.paddingBottom = 0;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(/Synthetic Shorts action host paddingBottom/);
  });

  test.each([
    ["fontSize", 14, /Synthetic Shorts count font-size/],
    ["lineHeight", 16, /Synthetic Shorts count line-height/],
    ["fontFamily", "Arial", /Synthetic Shorts count fontFamily/],
  ])("rejects mismatched count %s", (property, value, message) => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.countStyle[property] = value;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(message);
  });

  test("rejects a control that is off the native action-column center", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.button.x += 2;

    expect(() => assertSyntheticShortsGeometry(measurement)).toThrow(/Synthetic Shorts button horizontal center/);
  });

  test("allows a one-pixel fractional rendering difference", () => {
    const measurement = validSyntheticShortsGeometry();
    measurement.synthetic.button.width = 47;
    measurement.synthetic.svg.height = 24.75;
    measurement.next.host.x = 101;

    expect(() => assertSyntheticShortsGeometry(measurement)).not.toThrow();
  });
});

describe("assertNativeShortsPairGeometry", () => {
  test("accepts an exact active native Like/Dislike action pair", () => {
    expect(() => assertNativeShortsPairGeometry(validNativeShortsPairGeometry())).not.toThrow();
  });

  test("rejects controls selected from different retained Shorts reels", () => {
    const measurement = validNativeShortsPairGeometry();
    measurement.dislike.reelIndex = 1;

    expect(() => assertNativeShortsPairGeometry(measurement)).toThrow(/belong to different reels/);
  });

  test("rejects a native Dislike that is not immediately after Like", () => {
    const measurement = validNativeShortsPairGeometry();
    measurement.dislike.actionIndex += 1;

    expect(() => assertNativeShortsPairGeometry(measurement)).toThrow(/not immediately after Like/);
  });

  test("rejects a shrunken native Dislike icon", () => {
    const measurement = validNativeShortsPairGeometry();
    measurement.dislike.icon.width = 8;

    expect(() => assertNativeShortsPairGeometry(measurement)).toThrow(/Native Shorts Dislike icon container width/);
  });

  test("rejects broken native action-stack spacing", () => {
    const measurement = validNativeShortsPairGeometry();
    measurement.dislike.host.y += 12;

    expect(() => assertNativeShortsPairGeometry(measurement)).toThrow(
      /Gap between native Shorts Like and Dislike action hosts/,
    );
  });

  test("rejects native Dislike count typography that diverges from Like", () => {
    const measurement = validNativeShortsPairGeometry();
    measurement.dislike.countStyle.fontFamily = "Comic Sans MS";

    expect(() => assertNativeShortsPairGeometry(measurement)).toThrow(/count fontFamily does not match/);
  });
});

describe("live Shorts full-stack visual readiness", () => {
  const viewport = { height: 844, width: 390 };
  const validStack = () => [0, 1, 2, 3, 4].map((index) => box(330, 100 + index * 78, 48, 78));

  test("accepts five aligned visible controls and painted icons", () => {
    expect(() => assertShortsActionStackGeometry(validStack(), viewport)).not.toThrow();
    expect(
      isShortsIconVisualReady({
        effectiveOpacity: 1,
        paintedGraphicCount: 1,
        rendered: true,
        svgPresent: true,
      }),
    ).toBe(true);
  });

  test("rejects an incomplete Shorts stack", () => {
    expect(() => assertShortsActionStackGeometry(validStack().slice(0, 4), viewport)).toThrow(
      /full Shorts action stack/,
    );
  });

  test("rejects a misaligned or clipped control", () => {
    const misaligned = validStack();
    misaligned[3].x -= 8;
    expect(() => assertShortsActionStackGeometry(misaligned, viewport)).toThrow(/horizontal center/);

    const clipped = validStack();
    clipped[4].y = 800;
    expect(() => assertShortsActionStackGeometry(clipped, viewport)).toThrow(/bottom edge/);
  });

  test.each([
    ["unhydrated SVG", { effectiveOpacity: 1, paintedGraphicCount: 0, rendered: true, svgPresent: true }],
    ["missing SVG", { effectiveOpacity: 1, paintedGraphicCount: 0, rendered: true, svgPresent: false }],
    ["hidden ancestor", { effectiveOpacity: 0, paintedGraphicCount: 1, rendered: true, svgPresent: true }],
    ["non-rendered ancestor", { effectiveOpacity: 1, paintedGraphicCount: 1, rendered: false, svgPresent: true }],
  ])("does not screenshot a %s as a ready icon", (_label, state) => {
    expect(isShortsIconVisualReady(state)).toBe(false);
  });
});
