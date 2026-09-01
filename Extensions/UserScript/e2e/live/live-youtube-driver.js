const assert = require("node:assert/strict");

const API_ORIGIN = "https://returnyoutubedislikeapi.com";
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const DISLIKE_BUTTON_SELECTORS = [
  "[data-ryd-synthetic-shorts-dislike] button",
  "dislike-button-view-model button",
  "#segmented-dislike-button button",
  "button#segmented-dislike-button",
  "#dislike-button button",
  "ytd-dislike-button-renderer button",
].join(", ");
const LIKE_BUTTON_SELECTORS = [
  "like-button-view-model button",
  "#segmented-like-button button",
  "button#segmented-like-button",
  "#like-button button",
  "ytd-like-button-renderer button",
].join(", ");
const ACTION_BUTTON_SELECTORS = {
  dislike: DISLIKE_BUTTON_SELECTORS,
  like: LIKE_BUTTON_SELECTORS,
};
const RATE_BAR_SELECTORS = {
  extension: { bar: "#ryd-bar", container: "#ryd-bar-container" },
  userscript: { bar: "#return-youtube-dislike-bar", container: "#return-youtube-dislike-bar-container" },
};
const SYNTHETIC_SHORTS_SELECTOR = "[data-ryd-synthetic-shorts-dislike]";
const SHORTS_NEXT_BUTTON_SELECTOR = [
  "ytd-shorts #navigation-button-down button",
  "#navigation-button-down button",
  'ytd-shorts button[aria-label="Next video"]',
].join(", ");
const SHORTS_GEOMETRY = {
  buttonSize: 48,
  controlHeight: 78,
  controlWidth: 48,
  fontSize: 12,
  geometryTolerance: 1,
  iconSize: 24,
  labelHeight: 70,
  lineHeight: 18,
  textTolerance: 0.5,
};
const SHORTS_ACTION_HOST_INSETS = {
  marginBottom: 0,
  marginLeft: 0,
  marginRight: 0,
  marginTop: 0,
  paddingBottom: 8,
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 0,
};
const SHORTS_NEXT_FIRST_CLICK_TIMEOUT = 5_000;
const SHORTS_NEXT_RETRY_TIMEOUT = 25_000;
const SHORTS_VISUAL_PAINT_TIMEOUT = 5_000;
const VISUAL_TOOLTIP_TIMEOUT = 5_000;
const WATCH_RATIO_SOAK_DURATION_MS = 4_000;
const WATCH_RATIO_SOAK_INTERVAL_MS = 500;
const NATIVE_YOUTUBE_TOOLTIP_SELECTOR = [
  "tp-yt-paper-tooltip:not(#ryd-dislike-tooltip)",
  "ytd-tooltip-renderer",
  "ytm-tooltip-renderer",
  ".ytp-tooltip",
  '[role="tooltip"]:not(#ryd-dislike-tooltip):not(.ryd-tooltip)',
].join(", ");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isShortCandidateEligible(element, settings) {
  const rect = element.getBoundingClientRect();
  const intersectsViewport =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < innerHeight &&
    rect.left < innerWidth;
  if (!intersectsViewport) return false;

  const reel = element.closest("ytd-reel-video-renderer, ytm-reel-video-renderer");
  if (!settings.activeShortRequired) return true;
  if (!reel || !settings.expectedShortVideoId) return false;

  const reelRect = reel.getBoundingClientRect();
  const reelIntersectsViewport =
    reelRect.width > 0 &&
    reelRect.height > 0 &&
    reelRect.bottom > 0 &&
    reelRect.right > 0 &&
    reelRect.top < innerHeight &&
    reelRect.left < innerWidth;
  const expectedPath = `/shorts/${settings.expectedShortVideoId}`;
  const rendererVideoId = reel.getAttribute("video-id");
  const matchesVideo = rendererVideoId
    ? rendererVideoId === settings.expectedShortVideoId
    : [...reel.querySelectorAll('a[href*="/shorts/"]')].some((link) => {
        try {
          return new URL(link.getAttribute("href"), location.origin).pathname === expectedPath;
        } catch {
          return false;
        }
      });
  return reelIntersectsViewport && matchesVideo;
}

function readDislikeControlText(button) {
  const syntheticControl = button.closest("[data-ryd-synthetic-shorts-dislike]");
  const textSource = syntheticControl?.querySelector("#text, [role='text']") ?? button;
  return (textSource.innerText ?? textSource.textContent ?? "").replace(/\s+/g, " ").trim();
}

function readShortsIconVisualState(element) {
  const svg = element.querySelector("svg");
  const paintedGraphicCount = svg
    ? [...svg.querySelectorAll("path, circle, ellipse, line, polygon, polyline, rect")].filter((graphic) => {
        if (graphic.tagName.toLowerCase() !== "path") return true;
        return (graphic.getAttribute("d") ?? "").trim().length > 0;
      }).length
    : 0;
  let effectiveOpacity = 1;
  let rendered = true;
  for (let current = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
      rendered = false;
    }
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity)) effectiveOpacity *= opacity;
  }
  return {
    effectiveOpacity,
    paintedGraphicCount,
    rendered,
    svgPresent: svg !== null,
  };
}

function isShortsIconVisualReady(state) {
  return (
    state?.svgPresent === true &&
    state.paintedGraphicCount > 0 &&
    state.rendered === true &&
    state.effectiveOpacity > 0.01
  );
}

async function waitForValue(readValue, predicate, message, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await readValue();
    if (predicate(lastValue)) return lastValue;
    await delay(200);
  }
  throw new Error(`${message}. Last value: ${JSON.stringify(lastValue)}`);
}

async function firstVisible(
  locator,
  label,
  { expectedShortVideoId = null, requireActiveShort = false, requireViewport = false, timeout = 20_000 } = {},
) {
  return waitForValue(
    async () => {
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible())) continue;
        if (requireActiveShort || requireViewport) {
          const isEligible = await candidate.evaluate(isShortCandidateEligible, {
            activeShortRequired: requireActiveShort,
            expectedShortVideoId,
          });
          if (!isEligible) continue;
        }
        return candidate;
      }
      return null;
    },
    Boolean,
    `Timed out waiting for visible ${label}`,
    timeout,
  );
}

async function visibleLocatorIndexes(locator) {
  const indexes = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) indexes.push(index);
  }
  return indexes;
}

function relatedWatchVideoId(element, settings) {
  try {
    const url = new URL(element.getAttribute("href"), settings.origin);
    const videoId = url.searchParams.get("v");
    if (url.origin !== settings.origin || url.pathname !== "/watch") return null;
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || "")) return null;
    if (videoId === settings.currentVideoId || settings.excludedVideoIds.includes(videoId)) return null;
    return videoId;
  } catch {
    return null;
  }
}

async function firstVisibleRelatedWatchLink(page, currentVideoId, excludedVideoIds, timeout = 30_000) {
  const locator = page.locator('#related a[href*="/watch"]');
  const origin = new URL(page.url()).origin;
  return waitForValue(
    async () => {
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible())) continue;
        const videoId = await candidate.evaluate(relatedWatchVideoId, {
          currentVideoId,
          excludedVideoIds,
          origin,
        });
        if (videoId) return { link: candidate, videoId };
      }
      return null;
    },
    Boolean,
    `Timed out waiting for a visible unvisited #related watch link after ${currentVideoId}`,
    timeout,
  );
}

async function firstVisibleExactVideoLink(page, videoId, kind, timeout = 30_000) {
  const locator = page.locator(kind === "short" ? 'a[href*="/shorts/"]' : 'a[href*="/watch"]');
  return waitForValue(
    async () => {
      const count = await locator.count();
      for (let index = 0; index < count; index += 1) {
        const candidate = locator.nth(index);
        if (!(await candidate.isVisible())) continue;
        const isExactTarget = await candidate.evaluate(
          (element, target) => {
            try {
              const url = new URL(element.getAttribute("href"), location.origin);
              if (url.origin !== location.origin) return false;
              if (target.kind === "short") return url.pathname === `/shorts/${target.videoId}`;
              return url.pathname === "/watch" && url.searchParams.get("v") === target.videoId;
            } catch {
              return false;
            }
          },
          { kind, videoId },
        );
        if (isExactTarget) return candidate;
      }
      return null;
    },
    Boolean,
    `Timed out waiting for an exact visible ${kind} link for ${videoId} on the configured channel page`,
    timeout,
  );
}

async function clickWithSingleNavigationRetry({
  click,
  hasNavigated,
  reportProgress,
  retryDetails,
  waitForNavigation,
}) {
  const runAttempt = async (attempt, timeout) => {
    const [navigationResult, clickResult] = await Promise.allSettled([
      waitForNavigation(timeout),
      click(attempt, timeout),
    ]);
    if (navigationResult.status === "fulfilled" && clickResult.status === "fulfilled") return;
    throw navigationResult.status === "rejected" ? navigationResult.reason : clickResult.reason;
  };
  let firstError;
  try {
    await runAttempt(1, SHORTS_NEXT_FIRST_CLICK_TIMEOUT);
    return { retried: false };
  } catch (error) {
    firstError = error;
    if (hasNavigated()) return { retried: false };
  }

  reportProgress("shorts-next-control.retrying", {
    ...retryDetails,
    firstFailure: String(firstError?.message ?? firstError),
    firstTimeoutMs: SHORTS_NEXT_FIRST_CLICK_TIMEOUT,
    retryTimeoutMs: SHORTS_NEXT_RETRY_TIMEOUT,
  });
  try {
    await runAttempt(2, SHORTS_NEXT_RETRY_TIMEOUT);
    return { retried: true };
  } catch (retryError) {
    if (hasNavigated()) return { retried: true };
    throw new Error(
      `YouTube did not navigate after the first Shorts Next click or its single retry. First failure: ${String(firstError?.message ?? firstError)}. Retry failure: ${String(retryError?.message ?? retryError)}`,
      { cause: retryError },
    );
  }
}

function videoIdFromUrl(value) {
  const url = new URL(value);
  if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2] || null;
  return url.searchParams.get("v");
}

function readJsonBody(request) {
  try {
    return request.postDataJSON();
  } catch {
    return null;
  }
}

function assertLogicalVoteHandshake(records, videoId, value) {
  assert.ok(
    records.length >= 2 && records.length <= 4,
    `Expected one to three vote puzzle requests followed by one confirmation; received ${records.length} interaction requests.`,
  );
  const voteCount = records.length - 1;
  assert.deepEqual(
    records.map((record) => record.pathname),
    [...Array(voteCount).fill("/interact/vote"), "/interact/confirmVote"],
    "A logical vote may make at most three matching puzzle requests, then must send exactly one confirmation and no other interaction traffic.",
  );

  const votes = records.slice(0, voteCount);
  const confirmation = records[voteCount];
  const userId = votes[0]?.body?.userId;
  assert.equal(typeof userId, "string", "The vote request has no user ID.");
  for (const vote of votes) {
    assert.equal(vote.body?.userId, userId, "Vote puzzle retries used different user IDs.");
    assert.equal(vote.body?.videoId, videoId, "Vote puzzle retry targeted a different video.");
    assert.equal(vote.body?.value, value, "Vote puzzle retry changed the requested vote value.");
    assert.ok(vote.status >= 200 && vote.status < 300, `Vote request failed with HTTP ${vote.status}.`);
    assert.equal(vote.responseError, null, `Vote response could not be read: ${vote.responseError}`);
  }

  assert.equal(confirmation.body?.userId, userId, "Vote and confirmation used different user IDs.");
  assert.equal(confirmation.body?.videoId, videoId, "Vote confirmation targeted a different video.");
  assert.ok(
    confirmation.status >= 200 && confirmation.status < 300,
    `Vote confirmation failed with HTTP ${confirmation.status}.`,
  );
  assert.equal(
    confirmation.responseError,
    null,
    `Confirmation response could not be read: ${confirmation.responseError}`,
  );
  assert.equal(confirmation.responseBody, true, "The production API did not confirm the vote.");
  return userId;
}

function assertVisibleBox(box, label) {
  assert.ok(box, `${label} has no rendered bounding box.`);
  assert.ok(box.width > 0 && box.height > 0, `${label} has non-positive geometry: ${JSON.stringify(box)}`);
}

function assertBoxInsideViewport(box, viewport, label, tolerance = 1) {
  assertVisibleBox(box, label);
  assert.ok(box.x >= -tolerance, `${label} is clipped past the viewport's left edge.`);
  assert.ok(box.y >= -tolerance, `${label} is clipped past the viewport's top edge.`);
  assert.ok(box.x + box.width <= viewport.width + tolerance, `${label} is clipped past the viewport's right edge.`);
  assert.ok(box.y + box.height <= viewport.height + tolerance, `${label} is clipped past the viewport's bottom edge.`);
}

function assertShortsActionStackGeometry(boxes, viewport, tolerance = 1) {
  assert.ok(Array.isArray(boxes), "The Shorts action-stack geometry is missing.");
  assert.ok(boxes.length >= 5, `Expected the full Shorts action stack; found only ${boxes.length} visible controls.`);
  const center = boxCenterX(boxes[0]);
  boxes.forEach((box, index) => {
    const label = `Shorts action ${index + 1}`;
    assertBoxInsideViewport(box, viewport, label, tolerance);
    assertNear(boxCenterX(box), center, tolerance, `${label} horizontal center`);
    if (index > 0) {
      const previous = boxes[index - 1];
      assert.ok(box.y >= previous.y + previous.height - tolerance, `${label} overlaps the preceding Shorts action.`);
    }
  });
}

function assertWatchRatioViewportAlignment(containerBox, likeBox, dislikeBox, viewport, tolerance = 1) {
  assertVisibleBox(containerBox, "Watch ratio bar");
  assertVisibleBox(likeBox, "Watch like control");
  assertVisibleBox(dislikeBox, "Watch dislike control");

  const controls = [likeBox, dislikeBox];
  const nativeLeft = Math.min(...controls.map((box) => box.x));
  const nativeRight = Math.max(...controls.map((box) => box.x + box.width));
  const nativeControlsAreHorizontallyClipped = nativeLeft < -tolerance || nativeRight > viewport.width + tolerance;
  if (!nativeControlsAreHorizontallyClipped) {
    assertBoxInsideViewport(containerBox, viewport, "Watch ratio bar", tolerance);
    return { nativeControlsAreHorizontallyClipped, nativeLeft, nativeRight };
  }

  for (const [box, label] of [
    [likeBox, "Watch like control"],
    [dislikeBox, "Watch dislike control"],
    [containerBox, "Watch ratio bar"],
  ]) {
    assert.ok(box.y >= -tolerance, `${label} is clipped past the viewport's top edge.`);
    assert.ok(
      box.y + box.height <= viewport.height + tolerance,
      `${label} is clipped past the viewport's bottom edge.`,
    );
  }

  const containerRight = containerBox.x + containerBox.width;
  assertNear(
    containerBox.x,
    nativeLeft,
    tolerance,
    "Clipped watch ratio bar left edge alignment with native reaction controls",
  );
  assertNear(
    containerRight,
    nativeRight,
    tolerance,
    "Clipped watch ratio bar right edge alignment with native reaction controls",
  );
  assert.ok(
    containerBox.x >= nativeLeft - tolerance && containerRight <= nativeRight + tolerance,
    "The watch ratio bar adds horizontal overflow beyond the native reaction controls.",
  );
  return { nativeControlsAreHorizontallyClipped, nativeLeft, nativeRight };
}

function croppedScreenshotClip(boxes, viewport, margin = 12) {
  boxes.forEach((box, index) => assertVisibleBox(box, `Screenshot target ${index + 1}`));
  const left = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.x)) - margin));
  const top = Math.max(0, Math.floor(Math.min(...boxes.map((box) => box.y)) - margin));
  const right = Math.min(viewport.width, Math.ceil(Math.max(...boxes.map((box) => box.x + box.width)) + margin));
  const bottom = Math.min(viewport.height, Math.ceil(Math.max(...boxes.map((box) => box.y + box.height)) + margin));
  assert.ok(right > left && bottom > top, "The cropped screenshot target is outside the viewport.");
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function boxIntersectionWithViewport(box, viewport) {
  if (!box) return null;
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(viewport.width, box.x + box.width);
  const bottom = Math.min(viewport.height, box.y + box.height);
  if (right <= left || bottom <= top) return null;
  return { height: bottom - top, width: right - left, x: left, y: top };
}

function squaredDistanceFromBox(point, box) {
  const deltaX = Math.max(box.x - point.x, 0, point.x - (box.x + box.width));
  const deltaY = Math.max(box.y - point.y, 0, point.y - (box.y + box.height));
  return deltaX * deltaX + deltaY * deltaY;
}

function pointerPositionAwayFromBoxes(boxes, viewport, preferredBox = null) {
  const visiblePreferredBox = boxIntersectionWithViewport(preferredBox, viewport);
  if (visiblePreferredBox) {
    const preferredCandidates = [
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.25, y: 0.75 },
      { x: 0.75, y: 0.75 },
      { x: 0.5, y: 0.25 },
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
      { x: 0.5, y: 0.75 },
    ].map((position) => ({
      x: visiblePreferredBox.x + visiblePreferredBox.width * position.x,
      y: visiblePreferredBox.y + visiblePreferredBox.height * position.y,
    }));
    const safePreferredCandidates = preferredCandidates.filter((point) =>
      boxes.every((box) => squaredDistanceFromBox(point, box) > 0),
    );
    if (safePreferredCandidates.length > 0) {
      return safePreferredCandidates[0];
    }
  }

  const fallbackCandidates = [
    { x: viewport.width * 0.25, y: viewport.height * 0.25 },
    { x: viewport.width * 0.5, y: viewport.height * 0.25 },
    { x: viewport.width * 0.75, y: viewport.height * 0.25 },
    { x: viewport.width * 0.25, y: viewport.height * 0.5 },
    { x: viewport.width * 0.5, y: viewport.height * 0.5 },
    { x: viewport.width * 0.75, y: viewport.height * 0.5 },
    { x: viewport.width * 0.25, y: viewport.height * 0.75 },
    { x: viewport.width * 0.5, y: viewport.height * 0.75 },
    { x: viewport.width * 0.75, y: viewport.height * 0.75 },
  ];
  const ranked = fallbackCandidates
    .map((point) => ({
      distance: Math.min(...boxes.map((box) => squaredDistanceFromBox(point, box))),
      point,
    }))
    .sort((left, right) => right.distance - left.distance);
  assert.ok(ranked[0]?.distance > 0, "Could not place the screenshot pointer away from the reaction controls.");
  return ranked[0].point;
}

function assertNear(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual), `${label} is not a finite number: ${actual}`);
  assert.ok(Number.isFinite(expected), `${label} has no finite reference value: ${expected}`);
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label} must be ${expected} +/- ${tolerance}px; received ${actual}px.`,
  );
}

function boxCenterX(box) {
  return box.x + box.width / 2;
}

function boxCenterY(box) {
  return box.y + box.height / 2;
}

function assertBoxSize(box, width, height, label, tolerance = SHORTS_GEOMETRY.geometryTolerance) {
  assertVisibleBox(box, label);
  assertNear(box.width, width, tolerance, `${label} width`);
  assertNear(box.height, height, tolerance, `${label} height`);
}

function assertHostInsets(style, label) {
  assert.ok(style, `${label} computed style is missing.`);
  for (const [property, expected] of Object.entries(SHORTS_ACTION_HOST_INSETS)) {
    assertNear(style[property], expected, SHORTS_GEOMETRY.geometryTolerance, `${label} ${property}`);
  }
}

function assertCountTypography(actual, native) {
  assert.ok(actual, "Synthetic Shorts count typography is missing.");
  assert.ok(native, "Native Like count typography is missing.");
  for (const style of [
    [native, "Native Like count"],
    [actual, "Synthetic Shorts count"],
  ]) {
    assertNear(style[0].fontSize, SHORTS_GEOMETRY.fontSize, SHORTS_GEOMETRY.textTolerance, `${style[1]} font-size`);
    assertNear(
      style[0].lineHeight,
      SHORTS_GEOMETRY.lineHeight,
      SHORTS_GEOMETRY.textTolerance,
      `${style[1]} line-height`,
    );
  }
  for (const property of ["fontFamily", "fontStyle", "fontWeight"]) {
    assert.equal(
      actual[property],
      native[property],
      `Synthetic Shorts count ${property} does not match the native Like count.`,
    );
  }
}

const REACTION_PRESSED_STATES = {
  disliked: { dislikeState: "true", likeState: "false" },
  liked: { dislikeState: "false", likeState: "true" },
  neutral: { dislikeState: "false", likeState: "false" },
};

function assertReactionPressedStates(actual, expectedState) {
  const expected = REACTION_PRESSED_STATES[expectedState];
  assert.ok(expected, `Unsupported expected YouTube reaction state: ${expectedState}`);
  assert.ok(["true", "false"].includes(actual.likeState), `Unexpected YouTube like state: ${actual.likeState}`);
  assert.ok(
    ["true", "false"].includes(actual.dislikeState),
    `Unexpected YouTube dislike state: ${actual.dislikeState}`,
  );
  assert.ok(
    !(actual.likeState === "true" && actual.dislikeState === "true"),
    "YouTube reported Like and Dislike as selected.",
  );
  assert.equal(actual.likeState, expected.likeState, `Expected YouTube reaction state ${expectedState}.`);
  assert.equal(actual.dislikeState, expected.dislikeState, `Expected YouTube reaction state ${expectedState}.`);
}

function assertSyntheticShortsGeometry(measurement) {
  assert.ok(measurement, "Synthetic Shorts geometry measurement is missing.");
  const { like, next, synthetic } = measurement;
  assert.ok(like, "Native Like geometry is missing.");
  assert.ok(synthetic, "Synthetic Shorts geometry is missing.");
  assert.ok(next, "The action following the synthetic Shorts control is missing.");

  assertBoxSize(like.host, SHORTS_GEOMETRY.controlWidth, SHORTS_GEOMETRY.controlHeight, "Native Like action host");
  assertBoxSize(
    synthetic.host,
    SHORTS_GEOMETRY.controlWidth,
    SHORTS_GEOMETRY.controlHeight,
    "Synthetic Shorts action host",
  );
  assertBoxSize(like.label, SHORTS_GEOMETRY.controlWidth, SHORTS_GEOMETRY.labelHeight, "Native Like label");
  assertBoxSize(synthetic.label, SHORTS_GEOMETRY.controlWidth, SHORTS_GEOMETRY.labelHeight, "Synthetic Shorts label");
  assertBoxSize(like.button, SHORTS_GEOMETRY.buttonSize, SHORTS_GEOMETRY.buttonSize, "Native Like button");
  assertBoxSize(synthetic.button, SHORTS_GEOMETRY.buttonSize, SHORTS_GEOMETRY.buttonSize, "Synthetic Shorts button");
  assertBoxSize(like.icon, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, "Native Like icon container");
  assertBoxSize(synthetic.icon, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, "Synthetic Shorts icon container");
  assertBoxSize(like.svg, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, "Native Like SVG");
  assertBoxSize(synthetic.svg, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, "Synthetic Shorts SVG");
  assertVisibleBox(like.count, "Native Like count");
  assertVisibleBox(synthetic.count, "Synthetic Shorts count");
  assertVisibleBox(next.host, "Action following the synthetic Shorts control");

  assertHostInsets(like.hostStyle, "Native Like action host");
  assertHostInsets(synthetic.hostStyle, "Synthetic Shorts action host");
  assertCountTypography(synthetic.countStyle, like.countStyle);

  const tolerance = SHORTS_GEOMETRY.geometryTolerance;
  const actionCenter = boxCenterX(like.button);
  for (const [box, label] of [
    [like.host, "Native Like action host"],
    [like.label, "Native Like label"],
    [like.icon, "Native Like icon container"],
    [like.svg, "Native Like SVG"],
    [like.count, "Native Like count"],
    [synthetic.host, "Synthetic Shorts action host"],
    [synthetic.label, "Synthetic Shorts label"],
    [synthetic.button, "Synthetic Shorts button"],
    [synthetic.icon, "Synthetic Shorts icon container"],
    [synthetic.svg, "Synthetic Shorts SVG"],
    [synthetic.count, "Synthetic Shorts count"],
    [next.host, "Action following the synthetic Shorts control"],
  ]) {
    assertNear(boxCenterX(box), actionCenter, tolerance, `${label} horizontal center`);
  }

  for (const [control, label] of [
    [like, "Native Like"],
    [synthetic, "Synthetic Shorts"],
  ]) {
    assertNear(boxCenterY(control.icon), boxCenterY(control.button), tolerance, `${label} icon vertical center`);
    assertNear(boxCenterY(control.svg), boxCenterY(control.button), tolerance, `${label} SVG vertical center`);
  }

  assertNear(
    synthetic.host.y - (like.host.y + like.host.height),
    0,
    tolerance,
    "Gap between native Like and synthetic Shorts action hosts",
  );
  assertNear(
    next.host.y - (synthetic.host.y + synthetic.host.height),
    0,
    tolerance,
    "Gap between synthetic Shorts and following action hosts",
  );
}

function assertNativeShortsPairGeometry(measurement) {
  assert.ok(measurement, "Native Shorts pair geometry is missing.");
  const { dislike, like } = measurement;
  assert.ok(like, "Native Shorts Like geometry is missing.");
  assert.ok(dislike, "Native Shorts Dislike geometry is missing.");
  assert.equal(like.videoMatches, true, "The native Shorts Like control is outside the active reel.");
  assert.equal(dislike.videoMatches, true, "The native Shorts Dislike control is outside the active reel.");
  assert.ok(like.reelIndex >= 0, "The native Shorts Like control has no owning reel.");
  assert.equal(dislike.reelIndex, like.reelIndex, "Native Shorts Like and Dislike belong to different reels.");
  assert.ok(like.actionIndex >= 0, "The native Shorts Like control has no owning action stack.");
  assert.equal(
    dislike.actionIndex,
    like.actionIndex + 1,
    "Native Shorts Dislike is not immediately after Like in the active action stack.",
  );

  for (const [action, label] of [
    [like, "Native Shorts Like"],
    [dislike, "Native Shorts Dislike"],
  ]) {
    assertBoxSize(action.host, SHORTS_GEOMETRY.controlWidth, SHORTS_GEOMETRY.controlHeight, `${label} action host`);
    assertBoxSize(action.label, SHORTS_GEOMETRY.controlWidth, SHORTS_GEOMETRY.labelHeight, `${label} label`);
    assertBoxSize(action.button, SHORTS_GEOMETRY.buttonSize, SHORTS_GEOMETRY.buttonSize, `${label} button`);
    assertBoxSize(action.icon, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, `${label} icon container`);
    assertBoxSize(action.svg, SHORTS_GEOMETRY.iconSize, SHORTS_GEOMETRY.iconSize, `${label} SVG`);
    assertVisibleBox(action.count, `${label} count`);
    assertHostInsets(action.hostStyle, `${label} action host`);
  }

  assertCountTypography(dislike.countStyle, like.countStyle);
  assertNear(
    boxCenterX(dislike.host),
    boxCenterX(like.host),
    SHORTS_GEOMETRY.geometryTolerance,
    "Native Shorts action-host horizontal center",
  );
  assertNear(
    boxCenterX(dislike.button),
    boxCenterX(like.button),
    SHORTS_GEOMETRY.geometryTolerance,
    "Native Shorts button horizontal center",
  );
  assertNear(
    dislike.host.y,
    like.host.y + like.host.height,
    SHORTS_GEOMETRY.geometryTolerance,
    "Gap between native Shorts Like and Dislike action hosts",
  );
}

function readNativeShortsActionMeasurement(element, expectedVideoId) {
  const reelSelector = "ytd-reel-video-renderer, ytm-reel-video-renderer";
  const reel = element.closest(reelSelector);
  const host =
    element.closest(
      "like-button-view-model, dislike-button-view-model, ytd-like-button-renderer, ytd-dislike-button-renderer",
    ) ??
    element.closest("label") ??
    element;
  const actionBar = host.parentElement;
  const label = element.closest("label") ?? host.querySelector("label");
  const icon =
    element.querySelector(".ytSpecButtonShapeNextIcon, .yt-spec-button-shape-next__icon, yt-icon") ??
    element.querySelector("svg")?.parentElement ??
    null;
  const svg = icon?.querySelector("svg") ?? element.querySelector("svg");
  const count = [
    ...host.querySelectorAll("#text, [role='text'], .yt-spec-button-shape-next__button-text-content"),
  ].find((candidate) => /\d/.test(candidate.innerText ?? candidate.textContent ?? ""));
  const expectedPath = `/shorts/${expectedVideoId}`;
  const rendererVideoId = reel?.getAttribute("video-id");
  const videoMatches = rendererVideoId
    ? rendererVideoId === expectedVideoId
    : [...(reel?.querySelectorAll('a[href*="/shorts/"]') ?? [])].some((link) => {
        try {
          return new URL(link.getAttribute("href"), location.origin).pathname === expectedPath;
        } catch {
          return false;
        }
      });
  const readBox = (node) => {
    if (!node) return null;
    const box = node.getBoundingClientRect();
    return { height: box.height, width: box.width, x: box.x, y: box.y };
  };
  const cssPixels = (value) => {
    const number = Number.parseFloat(value);
    return Number.isFinite(number) ? number : null;
  };
  const readHostStyle = (node) => {
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      marginBottom: cssPixels(style.marginBottom),
      marginLeft: cssPixels(style.marginLeft),
      marginRight: cssPixels(style.marginRight),
      marginTop: cssPixels(style.marginTop),
      paddingBottom: cssPixels(style.paddingBottom),
      paddingLeft: cssPixels(style.paddingLeft),
      paddingRight: cssPixels(style.paddingRight),
      paddingTop: cssPixels(style.paddingTop),
    };
  };
  const readCountStyle = (node) => {
    if (!node) return null;
    const style = getComputedStyle(node);
    return {
      fontFamily: style.fontFamily,
      fontSize: cssPixels(style.fontSize),
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      lineHeight: cssPixels(style.lineHeight),
    };
  };
  const actionHosts = [...(actionBar?.children ?? [])]
    .filter((candidate) => {
      const button = candidate.matches("button") ? candidate : candidate.querySelector("button");
      if (!button) return false;
      const box = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      return (
        box.width > 0 &&
        box.height > 0 &&
        box.bottom > 0 &&
        box.right > 0 &&
        box.top < innerHeight &&
        box.left < innerWidth &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    })
    .map(readBox);

  return {
    actionIndex: actionBar ? [...actionBar.children].indexOf(host) : -1,
    actionHosts,
    button: readBox(element),
    count: readBox(count),
    countStyle: readCountStyle(count),
    host: readBox(host),
    hostStyle: readHostStyle(host),
    icon: readBox(icon),
    label: readBox(label),
    reelIndex: reel ? [...document.querySelectorAll(reelSelector)].indexOf(reel) : -1,
    svg: readBox(svg),
    videoMatches,
  };
}

class VoteTrafficRecorder {
  constructor(context, videoId, { handshakeTimeout = 120_000 } = {}) {
    this.context = context;
    this.handshakeTimeout = handshakeTimeout;
    this.videoId = videoId;
    this.records = [];
    this.recordsByRequest = new WeakMap();
    this.onRequest = this.onRequest.bind(this);
    this.onResponse = this.onResponse.bind(this);
    context.on("request", this.onRequest);
    context.on("response", this.onResponse);
  }

  onRequest(request) {
    const url = new URL(request.url());
    if (url.origin !== API_ORIGIN || request.method() !== "POST" || !url.pathname.startsWith("/interact/")) return;

    const body = readJsonBody(request);
    const record = {
      body,
      pathname: url.pathname,
      requestedAt: Date.now(),
      responseBody: undefined,
      responseError: null,
      respondedAt: null,
      status: null,
    };
    this.records.push(record);
    this.recordsByRequest.set(request, record);
  }

  onResponse(response) {
    const record = this.recordsByRequest.get(response.request());
    if (!record) return;

    record.status = response.status();
    record.respondedAt = Date.now();
    void response
      .text()
      .then((text) => {
        try {
          record.responseBody = JSON.parse(text);
        } catch {
          record.responseBody = text;
        }
      })
      .catch((error) => {
        record.responseError = error.message;
      });
  }

  mark() {
    return this.records.length;
  }

  hasVote(value, startIndex) {
    return this.records
      .slice(startIndex)
      .some(
        (record) =>
          record.pathname === "/interact/vote" && record.body?.videoId === this.videoId && record.body?.value === value,
      );
  }

  voteUserId(value, startIndex) {
    return this.records
      .slice(startIndex)
      .find(
        (record) =>
          record.pathname === "/interact/vote" && record.body?.videoId === this.videoId && record.body?.value === value,
      )?.body?.userId;
  }

  async waitForHandshake(value, startIndex) {
    const records = await waitForValue(
      () => {
        const current = this.records.slice(startIndex);
        const voteIndex = current.findIndex(
          (record) =>
            record.pathname === "/interact/vote" &&
            record.body?.videoId === this.videoId &&
            record.body?.value === value &&
            record.status !== null,
        );
        const vote = current[voteIndex];
        const confirmation = current.find(
          (record, index) =>
            index > voteIndex &&
            record.pathname === "/interact/confirmVote" &&
            record.body?.videoId === this.videoId &&
            record.body?.userId === vote?.body?.userId &&
            record.responseBody !== undefined,
        );
        return voteIndex >= 0 && confirmation ? current : null;
      },
      Boolean,
      `Timed out waiting for the production vote handshake for value ${value}`,
      this.handshakeTimeout,
    );

    return this.assertOneHandshake(value, startIndex);
  }

  async assertOneHandshake(value, startIndex) {
    let previousLength = -1;
    let stableSince = Date.now();
    const quietPeriodDeadline = Date.now() + 5_000;
    while (Date.now() - stableSince < 500) {
      if (Date.now() >= quietPeriodDeadline) {
        throw new Error("Interaction traffic did not become quiet. Ensure only one RYD runtime is enabled.");
      }
      const currentLength = this.records.length;
      if (currentLength !== previousLength) {
        previousLength = currentLength;
        stableSince = Date.now();
      }
      await delay(100);
    }

    const records = this.records.slice(startIndex);
    return assertLogicalVoteHandshake(records, this.videoId, value);
  }

  stop() {
    this.context.off("request", this.onRequest);
    this.context.off("response", this.onResponse);
  }
}

class LiveYoutubeDriver {
  constructor(page, context, { reportProgress = () => {}, visualTooltipTimeout = VISUAL_TOOLTIP_TIMEOUT } = {}) {
    this.page = page;
    this.context = context;
    this.reportProgress = reportProgress;
    this.visualTooltipTimeout = visualTooltipTimeout;
    this.readOnlyInteractionGuard = null;
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(30_000);
  }

  async readViewportSize() {
    return this.page.evaluate(() => ({ height: innerHeight, width: innerWidth }));
  }

  async setViewportSize(viewport) {
    await this.page.setViewportSize(viewport);
    await waitForValue(
      () => this.readViewportSize(),
      (current) => current.width === viewport.width && current.height === viewport.height,
      `Timed out resizing the live tab to ${viewport.width}x${viewport.height}`,
    );
    await this.page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
  }

  async readLargestVisibleVideoBox(viewport) {
    const videos = this.page.locator("video");
    let largest = null;
    let largestVisibleArea = 0;
    for (let index = 0; index < (await videos.count()); index += 1) {
      const video = videos.nth(index);
      if (!(await video.isVisible())) continue;
      const box = await video.boundingBox();
      const visibleBox = boxIntersectionWithViewport(box, viewport);
      const visibleArea = visibleBox ? visibleBox.width * visibleBox.height : 0;
      if (visibleArea > largestVisibleArea) {
        largest = box;
        largestVisibleArea = visibleArea;
      }
    }
    return largest;
  }

  async captureCroppedScreenshot(screenshotPath, boxes, { waitForVisualReadiness = null } = {}) {
    const viewport = await this.readViewportSize();
    const clip = croppedScreenshotClip(boxes, viewport);
    const videoBox = await this.readLargestVisibleVideoBox(viewport);
    const pointer = pointerPositionAwayFromBoxes(boxes, viewport, videoBox);
    await this.page.mouse.move(pointer.x, pointer.y);
    await waitForValue(
      async () => {
        const tooltips = this.page.locator(NATIVE_YOUTUBE_TOOLTIP_SELECTOR);
        const visibleTooltips = [];
        for (let index = 0; index < (await tooltips.count()); index += 1) {
          const tooltip = tooltips.nth(index);
          if (await tooltip.isVisible()) {
            visibleTooltips.push((await tooltip.innerText()).replace(/\s+/g, " ").trim() || "<empty tooltip>");
          }
        }
        return visibleTooltips;
      },
      (visibleTooltips) => visibleTooltips.length === 0,
      "Timed out waiting for native YouTube tooltips to hide before screenshot capture",
      this.visualTooltipTimeout,
    );
    if (waitForVisualReadiness) await waitForVisualReadiness();
    await this.page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    await this.page.screenshot({
      animations: "disabled",
      caret: "hide",
      clip,
      path: screenshotPath,
    });
    return clip;
  }

  async waitForShortsVisualPaint(buttons, timeout = SHORTS_VISUAL_PAINT_TIMEOUT) {
    return waitForValue(
      () => Promise.all(buttons.map((button) => button.evaluate(readShortsIconVisualState))),
      (states) => states.every(isShortsIconVisualReady),
      "Timed out waiting for the visible Shorts reaction icons to finish painting",
      timeout,
    );
  }

  async withNoProductionInteractions(action) {
    if (this.readOnlyInteractionGuard) {
      this.readOnlyInteractionGuard.depth += 1;
      try {
        return await action();
      } finally {
        this.readOnlyInteractionGuard.depth -= 1;
      }
    }

    const guard = {
      abortedRequests: [],
      depth: 1,
      observedRequests: [],
      routeErrors: [],
    };
    this.readOnlyInteractionGuard = guard;
    const routeMatcher = (url) => url.origin === API_ORIGIN && url.pathname.startsWith("/interact/");
    const onRequest = (request) => {
      const url = new URL(request.url());
      if (url.origin !== API_ORIGIN || request.method() !== "POST" || !url.pathname.startsWith("/interact/")) return;
      guard.observedRequests.push({ method: request.method(), pathname: url.pathname });
    };
    const onRoute = async (route) => {
      const request = route.request();
      if (request.method() !== "POST") {
        await route.fallback();
        return;
      }

      const url = new URL(request.url());
      guard.abortedRequests.push({ method: request.method(), pathname: url.pathname });
      try {
        await route.abort("blockedbyclient");
      } catch (error) {
        guard.routeErrors.push(error.message);
      }
    };
    let requestListenerInstalled = false;
    let routeInstalled = false;
    let result;
    let actionError;
    try {
      await this.context.route(routeMatcher, onRoute);
      routeInstalled = true;
      this.context.on("request", onRequest);
      requestListenerInstalled = true;
      try {
        result = await action();
      } catch (error) {
        actionError = error;
      }
      await delay(250);
    } finally {
      if (requestListenerInstalled) this.context.off("request", onRequest);
      try {
        if (routeInstalled) await this.context.unroute(routeMatcher, onRoute);
      } finally {
        this.readOnlyInteractionGuard = null;
      }
    }
    assert.deepEqual(
      {
        abortedRequests: guard.abortedRequests,
        observedRequests: guard.observedRequests,
        routeErrors: guard.routeErrors,
      },
      { abortedRequests: [], observedRequests: [], routeErrors: [] },
      "The read-only live scenario attempted a production interaction. The request was blocked before transmission.",
    );
    if (actionError) throw actionError;
    return result;
  }

  async inspectWatchRatioVisual(
    runtime,
    { expectedCount = null, presenceTimeoutMs = 20_000, waitForPresence = false } = {},
  ) {
    const selectors = RATE_BAR_SELECTORS[runtime];
    if (!selectors) throw new Error(`Unsupported live visual runtime: ${runtime}`);

    const containers = this.page.locator(selectors.container);
    const bars = this.page.locator(selectors.bar);
    if (waitForPresence) {
      await firstVisible(containers, `${runtime} watch ratio bar`, { timeout: presenceTimeoutMs });
      await firstVisible(bars, `${runtime} watch ratio fill`, { timeout: presenceTimeoutMs });
    }

    const [visibleContainerIndexes, visibleBarIndexes] = await Promise.all([
      visibleLocatorIndexes(containers),
      visibleLocatorIndexes(bars),
    ]);
    assert.equal(
      visibleContainerIndexes.length,
      1,
      `Expected exactly one visible ${runtime} watch ratio bar; found ${visibleContainerIndexes.length}.`,
    );
    assert.equal(
      visibleBarIndexes.length,
      1,
      `Expected exactly one visible ${runtime} watch ratio fill; found ${visibleBarIndexes.length}.`,
    );

    const count = await this.waitForDislikeText();
    if (expectedCount !== null) {
      assert.equal(count, expectedCount, "The current watch dislike count changed during the ratio-bar soak.");
    }
    const container = containers.nth(visibleContainerIndexes[0]);
    const bar = bars.nth(visibleBarIndexes[0]);
    const likeButton = await this.visibleLikeButton();
    const dislikeButton = await this.visibleDislikeButton();
    await container.scrollIntoViewIfNeeded();

    const wrapper = container.locator(
      "xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' ryd-tooltip ')][1]",
    );
    const [barBox, containerBox, dislikeBox, likeBox, wrapperBox, viewport] = await Promise.all([
      bar.boundingBox(),
      container.boundingBox(),
      dislikeButton.boundingBox(),
      likeButton.boundingBox(),
      wrapper.boundingBox(),
      this.readViewportSize(),
    ]);

    assert.match(count, /\d/, "The watch dislike control has no rendered count.");
    assertVisibleBox(barBox, "Watch ratio fill");
    assertVisibleBox(wrapperBox, "Watch ratio wrapper");
    const viewportAlignment = assertWatchRatioViewportAlignment(containerBox, likeBox, dislikeBox, viewport);
    assert.ok(barBox.x >= containerBox.x - 1, "The watch ratio fill starts outside its container.");
    assert.ok(
      barBox.x + barBox.width <= containerBox.x + containerBox.width + 1,
      "The watch ratio fill extends outside its container.",
    );
    assert.ok(
      containerBox.y >= Math.max(likeBox.y + likeBox.height, dislikeBox.y + dislikeBox.height) - 4,
      "The watch ratio bar overlaps the reaction controls.",
    );
    const expectedWrapperWidth = likeBox.width + dislikeBox.width;
    assert.ok(
      wrapperBox.width >= expectedWrapperWidth * 0.75 && wrapperBox.width <= expectedWrapperWidth * 1.25,
      `The watch ratio wrapper width ${wrapperBox.width} does not track the reaction controls (${expectedWrapperWidth}).`,
    );

    return {
      count,
      geometry: { bar: barBox, container: containerBox, dislike: dislikeBox, like: likeBox, wrapper: wrapperBox },
      viewport,
      viewportAlignment,
    };
  }

  async assertWatchRatioVisual(runtime, options = {}) {
    return this.inspectWatchRatioVisual(runtime, options);
  }

  async captureWatchRatioVisual(runtime, screenshotPath, { expectedCount = null, presenceTimeoutMs = 20_000 } = {}) {
    const measurement = await this.inspectWatchRatioVisual(runtime, {
      expectedCount,
      presenceTimeoutMs,
      waitForPresence: true,
    });
    const { container, dislike, like, wrapper } = measurement.geometry;
    const clip = await this.captureCroppedScreenshot(screenshotPath, [like, dislike, container, wrapper]);
    return {
      ...measurement,
      screenshotPath,
      screenshotClip: clip,
    };
  }

  async soakWatchRatioVisual(
    runtime,
    { durationMs = WATCH_RATIO_SOAK_DURATION_MS, expectedCount, intervalMs = WATCH_RATIO_SOAK_INTERVAL_MS, videoId },
  ) {
    assert.match(expectedCount, /\d/, "A rendered dislike count is required before soaking the watch ratio bar.");
    assert.match(videoId, VIDEO_ID_PATTERN, "A valid current video ID is required for the watch ratio-bar soak.");
    assert.ok(
      Number.isFinite(durationMs) && durationMs >= 0,
      "The watch ratio-bar soak duration must be non-negative.",
    );
    assert.ok(Number.isFinite(intervalMs) && intervalMs > 0, "The watch ratio-bar soak interval must be positive.");

    const deadline = Date.now() + durationMs;
    let lastMeasurement;
    let sampleCount = 0;
    this.reportProgress("watch-ratio-soak.start", { durationMs, expectedCount, runtime, videoId });
    do {
      this.assertCurrentVideo(videoId);
      lastMeasurement = await this.assertWatchRatioVisual(runtime, { expectedCount });
      sampleCount += 1;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await delay(Math.min(intervalMs, remaining));
    } while (true);
    this.reportProgress("watch-ratio-soak.complete", { durationMs, expectedCount, runtime, sampleCount, videoId });

    return { count: lastMeasurement.count, durationMs, sampleCount, videoId };
  }

  async captureSyntheticShortsVisual(videoId, screenshotPath) {
    this.assertCurrentVideo(videoId);
    const controls = this.page.locator(SYNTHETIC_SHORTS_SELECTOR);
    const control = await firstVisible(controls, `synthetic Shorts dislike control for ${videoId}`, {
      expectedShortVideoId: videoId,
      requireActiveShort: true,
      requireViewport: true,
    });
    const button = await firstVisible(control.locator("button"), "synthetic Shorts dislike button", {
      expectedShortVideoId: videoId,
      requireActiveShort: true,
      requireViewport: true,
    });
    const likeButton = await this.visibleLikeButton();
    const countLocator = control.locator("#text, [role='text']").first();
    const count = await waitForValue(
      () => countLocator.evaluate((element) => (element.innerText ?? element.textContent ?? "").trim()),
      (text) => /\d/.test(text),
      "The synthetic Shorts dislike control has no rendered count",
      30_000,
    );
    await control.scrollIntoViewIfNeeded();

    const measurement = await control.evaluate((element, expectedVideoId) => {
      const actionBar = element.closest("reel-action-bar-view-model");
      const reel = element.closest("ytd-reel-video-renderer, ytm-reel-video-renderer");
      const likeHost = element.previousElementSibling;
      const nextHost = element.nextElementSibling;
      const likeLabel = likeHost?.querySelector("label") ?? null;
      const likeButton = likeHost?.querySelector("button") ?? null;
      const likeIcon = likeButton?.querySelector(".ytSpecButtonShapeNextIcon") ?? null;
      const likeSvg = likeIcon?.querySelector("svg") ?? likeButton?.querySelector("svg") ?? null;
      const likeCount = likeHost?.querySelector("#text, [role='text']") ?? null;
      const syntheticLabel = element.querySelector("label");
      const syntheticButton = element.querySelector("button");
      const syntheticIcon = syntheticButton?.querySelector(".ytSpecButtonShapeNextIcon") ?? null;
      const syntheticSvg = syntheticIcon?.querySelector("svg") ?? syntheticButton?.querySelector("svg") ?? null;
      const syntheticCount = element.querySelector("#text, [role='text']");
      const expectedPath = `/shorts/${expectedVideoId}`;
      const rendererVideoId = reel?.getAttribute("video-id");
      const videoMatches = rendererVideoId
        ? rendererVideoId === expectedVideoId
        : [...(reel?.querySelectorAll('a[href*="/shorts/"]') ?? [])].some((link) => {
            try {
              return new URL(link.getAttribute("href"), location.origin).pathname === expectedPath;
            } catch {
              return false;
            }
          });

      const readBox = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        return { height: box.height, width: box.width, x: box.x, y: box.y };
      };
      const cssPixels = (value) => {
        const number = Number.parseFloat(value);
        return Number.isFinite(number) ? number : null;
      };
      const readHostStyle = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          marginBottom: cssPixels(style.marginBottom),
          marginLeft: cssPixels(style.marginLeft),
          marginRight: cssPixels(style.marginRight),
          marginTop: cssPixels(style.marginTop),
          paddingBottom: cssPixels(style.paddingBottom),
          paddingLeft: cssPixels(style.paddingLeft),
          paddingRight: cssPixels(style.paddingRight),
          paddingTop: cssPixels(style.paddingTop),
        };
      };
      const readCountStyle = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return {
          fontFamily: style.fontFamily,
          fontSize: cssPixels(style.fontSize),
          fontStyle: style.fontStyle,
          fontWeight: style.fontWeight,
          lineHeight: cssPixels(style.lineHeight),
        };
      };
      const actionHosts = [...(actionBar?.children ?? [])]
        .filter((candidate) => {
          const button = candidate.matches("button") ? candidate : candidate.querySelector("button");
          if (!button) return false;
          const box = candidate.getBoundingClientRect();
          const style = getComputedStyle(candidate);
          return (
            box.width > 0 &&
            box.height > 0 &&
            box.bottom > 0 &&
            box.right > 0 &&
            box.top < innerHeight &&
            box.left < innerWidth &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        })
        .map(readBox);

      return {
        actionHosts,
        activeVideoId: element.getAttribute("data-ryd-video-id"),
        geometry: {
          like: {
            button: readBox(likeButton),
            count: readBox(likeCount),
            countStyle: readCountStyle(likeCount),
            host: readBox(likeHost),
            hostStyle: readHostStyle(likeHost),
            icon: readBox(likeIcon),
            label: readBox(likeLabel),
            svg: readBox(likeSvg),
          },
          next: { host: readBox(nextHost) },
          synthetic: {
            button: readBox(syntheticButton),
            count: readBox(syntheticCount),
            countStyle: readCountStyle(syntheticCount),
            host: readBox(element),
            hostStyle: readHostStyle(element),
            icon: readBox(syntheticIcon),
            label: readBox(syntheticLabel),
            svg: readBox(syntheticSvg),
          },
        },
        likeIsImmediatePreviousAction:
          likeHost?.matches("like-button-view-model") === true && likeHost?.parentElement === actionBar,
        nativeDislikes: actionBar?.querySelectorAll("dislike-button-view-model, #dislike-button").length ?? -1,
        nextIsImmediateAction: nextHost !== null && nextHost.parentElement === actionBar,
        syntheticControls: actionBar?.querySelectorAll("[data-ryd-synthetic-shorts-dislike]").length ?? -1,
        videoMatches,
      };
    }, videoId);
    const viewport = await this.readViewportSize();

    assert.equal(measurement.activeVideoId, videoId, "The synthetic Shorts control targets the wrong video.");
    assert.equal(measurement.videoMatches, true, "The synthetic Shorts control is outside the active reel.");
    assert.equal(measurement.nativeDislikes, 0, "The modern Shorts action bar unexpectedly has a native dislike.");
    assert.equal(measurement.syntheticControls, 1, "The active Shorts action bar has duplicate synthetic controls.");
    assert.equal(
      measurement.likeIsImmediatePreviousAction,
      true,
      "The synthetic Shorts control is not immediately after the native Like action.",
    );
    assert.equal(
      measurement.nextIsImmediateAction,
      true,
      "The synthetic Shorts control has no immediately following action.",
    );
    assert.equal(await button.getAttribute("aria-label"), "Dislike this video");
    assert.equal(await button.getAttribute("aria-disabled"), "false");
    assert.ok(["true", "false"].includes(await button.getAttribute("aria-pressed")), "Invalid Shorts pressed state.");
    assert.match(count, /\d/, "The synthetic Shorts dislike count is not numeric.");
    assertSyntheticShortsGeometry(measurement.geometry);
    assertBoxInsideViewport(measurement.geometry.like.host, viewport, "Native Like action host");
    assertBoxInsideViewport(measurement.geometry.synthetic.host, viewport, "Synthetic Shorts action host");
    assertBoxInsideViewport(measurement.geometry.next.host, viewport, "Action following the synthetic Shorts control");
    assertShortsActionStackGeometry(measurement.actionHosts, viewport);

    const clip = await this.captureCroppedScreenshot(screenshotPath, measurement.actionHosts, {
      waitForVisualReadiness: () => this.waitForShortsVisualPaint([likeButton, button]),
    });
    return {
      count,
      geometry: measurement.geometry,
      screenshotPath,
      screenshotClip: clip,
      viewport,
    };
  }

  async captureNativeShortsVisual(videoId, screenshotPath) {
    this.assertCurrentVideo(videoId);
    const count = await this.waitForDislikeText();
    assert.match(count, /\d/, "The native Shorts dislike control has no rendered numeric count.");
    const [likeButton, dislikeButton] = await Promise.all([this.visibleLikeButton(), this.visibleDislikeButton()]);
    await Promise.all([likeButton.scrollIntoViewIfNeeded(), dislikeButton.scrollIntoViewIfNeeded()]);
    const [dislike, like, viewport] = await Promise.all([
      dislikeButton.evaluate(readNativeShortsActionMeasurement, videoId),
      likeButton.evaluate(readNativeShortsActionMeasurement, videoId),
      this.readViewportSize(),
    ]);
    const geometry = { dislike, like };
    assertNativeShortsPairGeometry(geometry);
    assertBoxInsideViewport(like.host, viewport, "Shorts Like action");
    assertBoxInsideViewport(dislike.host, viewport, "Shorts Dislike action");
    assertShortsActionStackGeometry(like.actionHosts, viewport);
    const clip = await this.captureCroppedScreenshot(screenshotPath, like.actionHosts, {
      waitForVisualReadiness: () => this.waitForShortsVisualPaint([likeButton, dislikeButton]),
    });
    return {
      count,
      geometry,
      screenshotClip: clip,
      screenshotPath,
      viewport,
    };
  }

  async captureReactionStateVisual({ expectedState, isShort, runtime, screenshotPath, videoId }) {
    this.assertCurrentVideo(videoId);
    const pressedStates = await this.readReactionPressedStates();
    assertReactionPressedStates(pressedStates, expectedState);
    const count = await this.waitForDislikeText();
    assert.match(count, /\d/, "The dislike control has no rendered numeric count.");

    let visual;
    if (!isShort) {
      visual = await this.captureWatchRatioVisual(runtime, screenshotPath);
    } else if (runtime === "userscript") {
      visual = await this.captureSyntheticShortsVisual(videoId, screenshotPath);
    } else {
      visual = await this.captureNativeShortsVisual(videoId, screenshotPath);
    }

    return {
      ...visual,
      count,
      expectedState,
      isShort,
      pressedStates,
      runtime,
      screenshotPath,
      videoId,
    };
  }

  async pausePlayback() {
    const pauseResult = await this.page.locator("video").evaluateAll((videos) => {
      const result = { pauseFailures: [], pausedVideos: 0 };
      videos.forEach((video) => {
        try {
          video.pause();
          result.pausedVideos += 1;
        } catch (error) {
          result.pauseFailures.push(String(error?.message ?? error));
        }
      });
      return result;
    });
    this.reportProgress("playback.paused", {
      explanation: "The live smoke pauses media intentionally while it validates the current page",
      ...pauseResult,
      url: this.page.url(),
    });
    return pauseResult;
  }

  async assertSignedIn(expectedChannel) {
    this.reportProgress("signed-in-account.waiting", { expectedChannel });
    const avatar = await firstVisible(this.page.locator("#avatar-btn"), "signed-in YouTube account avatar");
    await avatar.click();
    try {
      await waitForValue(
        () =>
          this.page.locator("ytd-multi-page-menu-renderer a[href], tp-yt-iron-dropdown a[href]").evaluateAll(
            (links, channel) =>
              links.filter((link) => {
                const rect = link.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return false;
                try {
                  return (
                    new URL(link.getAttribute("href"), location.origin).pathname.replace(/\/$/, "") === `/${channel}`
                  );
                } catch {
                  return false;
                }
              }).length,
            expectedChannel,
          ),
        (matches) => matches === 1,
        `Timed out waiting for the signed-in account menu entry for ${expectedChannel}`,
      );
    } finally {
      await this.page.keyboard.press("Escape");
    }
    this.reportProgress("signed-in-account.confirmed", { expectedChannel });
  }

  async assertRuntime(runtime, expectedVersion, expectedBuildId) {
    assert.match(
      expectedBuildId ?? "",
      /^[a-f0-9]{32}$/,
      "An exact 32-character live build ID is required before testing an installed runtime.",
    );
    const markers = await this.page.locator("html").evaluate((element) => ({
      extensionBuild: element.getAttribute("data-ryd-extension-build"),
      extension: element.getAttribute("data-ryd-extension-version"),
      userscriptBuild: element.getAttribute("data-ryd-userscript-build"),
      userscript: element.getAttribute("data-ryd-userscript-version"),
    }));
    const otherRuntime = runtime === "userscript" ? "extension" : "userscript";
    assert.equal(markers[runtime], expectedVersion, `Expected ${runtime} version ${expectedVersion} to be active.`);
    assert.equal(
      markers[`${runtime}Build`],
      expectedBuildId,
      `Expected the installed ${runtime} live build to match the freshly generated artifact.`,
    );
    assert.equal(markers[otherRuntime], null, `Disable the ${otherRuntime} before running the ${runtime} smoke.`);
    assert.equal(
      markers[`${otherRuntime}Build`],
      null,
      `Disable the ${otherRuntime} before running the ${runtime} smoke.`,
    );
    this.reportProgress("runtime.confirmed", { expectedBuildId, expectedVersion, runtime });
  }

  async assertCurrentShortsControl(videoId, runtime) {
    this.reportProgress("shorts-control.waiting", { runtime, videoId });
    this.assertCurrentVideo(videoId);
    assert.ok(this.page.url().includes("/shorts/"), "The current live page is not a Shorts page.");
    const button = await this.visibleDislikeButton();
    const [count, measurement] = await Promise.all([
      button.evaluate(readDislikeControlText),
      button.evaluate(
        (element, settings) => {
          const syntheticHost = element.closest(settings.syntheticSelector);
          const reel = element.closest("ytd-reel-video-renderer, ytm-reel-video-renderer");
          const expectedPath = `/shorts/${settings.videoId}`;
          const rendererVideoId = reel?.getAttribute("video-id");
          const videoMatches = rendererVideoId
            ? rendererVideoId === settings.videoId
            : [...(reel?.querySelectorAll('a[href*="/shorts/"]') ?? [])].some((link) => {
                try {
                  return new URL(link.getAttribute("href"), location.origin).pathname === expectedPath;
                } catch {
                  return false;
                }
              });
          const visibleSyntheticControls = [...(reel?.querySelectorAll(settings.syntheticSelector) ?? [])].filter(
            (control) => {
              const rect = control.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.bottom > 0 &&
                rect.right > 0 &&
                rect.top < innerHeight &&
                rect.left < innerWidth
              );
            },
          );
          const actionBar = element.closest("reel-action-bar-view-model, ytd-reel-player-overlay-renderer");
          const visibleActionButtons = [...(actionBar?.querySelectorAll("button") ?? [])].filter((control) => {
            const rect = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.bottom > 0 &&
              rect.right > 0 &&
              rect.top < innerHeight &&
              rect.left < innerWidth &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          });
          return {
            actionLabels: visibleActionButtons.map(
              (control) => control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
            ),
            pressed: element.getAttribute("aria-pressed"),
            synthetic: syntheticHost !== null,
            syntheticVideoId: syntheticHost?.getAttribute("data-ryd-video-id") ?? null,
            videoMatches,
            visibleSyntheticControls: visibleSyntheticControls.length,
            visibleActionButtons: visibleActionButtons.length,
          };
        },
        { syntheticSelector: SYNTHETIC_SHORTS_SELECTOR, videoId },
      ),
    ]);

    assert.equal(measurement.videoMatches, true, `The rendered Shorts control is not owned by video ${videoId}.`);
    assert.ok(
      ["true", "false"].includes(measurement.pressed),
      "The current Shorts control has no valid pressed state.",
    );
    assert.match(count, /\d/, "The current Shorts dislike control has no rendered count.");
    assert.ok(
      measurement.visibleActionButtons >= 5,
      `The current Shorts reel rendered only ${measurement.visibleActionButtons} visible action controls: ${measurement.actionLabels.join(
        ", ",
      )}`,
    );
    if (runtime === "userscript") {
      assert.equal(measurement.synthetic, true, "The userscript did not render its synthetic current Shorts control.");
      assert.equal(measurement.syntheticVideoId, videoId, "The synthetic Shorts control targets a stale video ID.");
      assert.equal(
        measurement.visibleSyntheticControls,
        1,
        "The current Shorts reel must contain exactly one visible userscript synthetic dislike control.",
      );
    }

    const result = {
      actionLabels: measurement.actionLabels,
      count,
      synthetic: measurement.synthetic,
      videoId,
      visibleActionButtons: measurement.visibleActionButtons,
    };
    this.reportProgress("shorts-control.confirmed", result);
    return result;
  }

  async withVotesResponse(videoId, action) {
    this.reportProgress("ryd-votes-response.waiting", { videoId });
    const responsePromise = this.context.waitForEvent("response", {
      predicate: (response) => {
        const url = new URL(response.url());
        if (url.origin !== API_ORIGIN || url.pathname !== "/votes" || url.searchParams.get("videoId") !== videoId) {
          return false;
        }
        try {
          return response.request().frame().page() === this.page;
        } catch {
          return false;
        }
      },
      timeout: 30_000,
    });
    const [response, result] = await Promise.all([responsePromise, action()]);
    assert.ok(response.ok(), `The production /votes request for ${videoId} failed with HTTP ${response.status()}.`);
    const body = await response.json();
    assert.equal(typeof body.dislikes, "number", `The production /votes response for ${videoId} has no dislike count.`);
    this.reportProgress("ryd-votes-response.received", { status: response.status(), videoId });
    return { body, result };
  }

  async navigateFromColdChannel(channelUrl, videoId, kind) {
    const expectedChannelUrl = new URL(channelUrl);
    this.reportProgress("cold-channel.load.start", { channelUrl, kind, videoId });
    await this.page.goto(channelUrl, { waitUntil: "domcontentloaded" });
    await this.page.reload({ waitUntil: "domcontentloaded" });
    const actualChannelUrl = new URL(this.page.url());
    assert.equal(actualChannelUrl.origin, expectedChannelUrl.origin, "The cold channel load left youtube.com.");
    assert.equal(
      actualChannelUrl.pathname.replace(/\/$/, ""),
      expectedChannelUrl.pathname.replace(/\/$/, ""),
      "The cold channel load did not remain on the configured channel path.",
    );
    this.reportProgress("cold-channel.load.complete", { channelUrl: this.page.url(), kind, videoId });

    this.reportProgress("cold-channel.target-link.waiting", { kind, videoId });
    const target = await firstVisibleExactVideoLink(this.page, videoId, kind);
    this.reportProgress("cold-channel.target-link.found", { kind, videoId });
    const documentMarker = await this.page.evaluate(() => {
      const value = `${Date.now()}-${Math.random()}`;
      globalThis.__rydLiveSpaDocumentMarker = value;
      return value;
    });
    await this.withVotesResponse(videoId, async () => {
      this.reportProgress("cold-channel.target-link.clicking", { kind, videoId });
      await target.scrollIntoViewIfNeeded();
      await Promise.all([this.page.waitForURL((url) => videoIdFromUrl(url.toString()) === videoId), target.click()]);
      await this.waitForVideo(videoId);
    });
    assert.equal(
      await this.page.evaluate(() => globalThis.__rydLiveSpaDocumentMarker),
      documentMarker,
      `The channel-to-${kind} transition replaced the document instead of using YouTube SPA navigation.`,
    );
    this.reportProgress("cold-channel.navigation.confirmed", { kind, url: this.page.url(), videoId });
  }

  async navigateFromColdChannelToShort(channelUrl, videoId) {
    await this.navigateFromColdChannel(channelUrl, videoId, "short");
  }

  async navigateFromColdChannelToWatch(channelUrl, videoId) {
    await this.navigateFromColdChannel(channelUrl, videoId, "watch");
  }

  async navigateToNextShort(previousVideoId) {
    this.assertCurrentVideo(previousVideoId);
    this.reportProgress("shorts-next-control.waiting", { previousVideoId });
    const nextButton = await firstVisible(this.page.locator(SHORTS_NEXT_BUTTON_SELECTOR), "Shorts Next video button", {
      expectedShortVideoId: previousVideoId,
      requireViewport: true,
    });
    this.reportProgress("shorts-next-control.found", { previousVideoId });
    const documentMarker = await this.page.evaluate(() => {
      const value = `${Date.now()}-${Math.random()}`;
      globalThis.__rydLiveSpaDocumentMarker = value;
      return value;
    });
    const votesResponses = [];
    const onResponse = (response) => {
      const url = new URL(response.url());
      if (url.origin !== API_ORIGIN || url.pathname !== "/votes") return;
      try {
        if (response.request().frame().page() !== this.page) return;
      } catch {
        return;
      }
      votesResponses.push(response);
    };

    this.context.on("response", onResponse);
    let nextVideoId;
    try {
      const isNextShortUrl = (value) => {
        const url = value instanceof URL ? value : new URL(value);
        const candidate = videoIdFromUrl(url.toString());
        return (
          url.pathname.startsWith("/shorts/") && VIDEO_ID_PATTERN.test(candidate || "") && candidate !== previousVideoId
        );
      };
      await clickWithSingleNavigationRetry({
        click: async (attempt, timeout) => {
          this.reportProgress("shorts-next-control.clicking", { attempt, previousVideoId });
          await nextButton.scrollIntoViewIfNeeded({ timeout });
          await nextButton.click({ timeout });
        },
        hasNavigated: () => isNextShortUrl(this.page.url()),
        reportProgress: this.reportProgress,
        retryDetails: { previousVideoId },
        waitForNavigation: (timeout) => this.page.waitForURL(isNextShortUrl, { timeout }),
      });
      nextVideoId = videoIdFromUrl(this.page.url());
      assert.match(nextVideoId, VIDEO_ID_PATTERN, "The Shorts Next video navigation produced an invalid video ID.");
      assert.notEqual(nextVideoId, previousVideoId, "The Shorts Next video control did not advance to a new video.");
      await this.waitForVideoUrl(nextVideoId);

      this.reportProgress("ryd-votes-response.waiting", { videoId: nextVideoId });
      const response = await waitForValue(
        () =>
          Promise.resolve(
            votesResponses.find((candidate) => new URL(candidate.url()).searchParams.get("videoId") === nextVideoId),
          ),
        Boolean,
        `Timed out waiting for the production /votes response for next Short ${nextVideoId}`,
        30_000,
      );
      assert.ok(
        response.ok(),
        `The production /votes request for ${nextVideoId} failed with HTTP ${response.status()}.`,
      );
      const body = await response.json();
      assert.equal(typeof body.dislikes, "number", `The production /votes response for ${nextVideoId} has no count.`);
      this.reportProgress("ryd-votes-response.received", { status: response.status(), videoId: nextVideoId });
    } finally {
      this.context.off("response", onResponse);
    }

    assert.equal(
      await this.page.evaluate(() => globalThis.__rydLiveSpaDocumentMarker),
      documentMarker,
      "The Shorts Next video transition replaced the document instead of using YouTube SPA navigation.",
    );
    this.reportProgress("shorts-next-navigation.confirmed", {
      previousVideoId,
      url: this.page.url(),
      videoId: nextVideoId,
    });
    return nextVideoId;
  }

  async waitForVideoUrl(videoId) {
    this.reportProgress("video-url.waiting", { videoId });
    await waitForValue(
      () => Promise.resolve(videoIdFromUrl(this.page.url())),
      (currentVideoId) => currentVideoId === videoId,
      `Timed out waiting for YouTube video ${videoId}`,
    );
    this.reportProgress("video-url.confirmed", { url: this.page.url(), videoId });
  }

  async waitForVideo(videoId) {
    await this.waitForVideoUrl(videoId);
    await this.pausePlayback();
  }

  assertCurrentVideo(videoId) {
    assert.equal(
      videoIdFromUrl(this.page.url()),
      videoId,
      `The live tab is no longer on the allowlisted video ${videoId}.`,
    );
  }

  async openPlaylist(url, videoId) {
    return this.withVotesResponse(videoId, async () => {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
      await this.waitForVideo(videoId);
    });
  }

  async openWatch(videoId) {
    return this.withVotesResponse(videoId, async () => {
      await this.page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: "domcontentloaded" });
      await this.waitForVideo(videoId);
    });
  }

  async reload(videoId) {
    return this.withVotesResponse(videoId, async () => {
      await this.page.reload({ waitUntil: "domcontentloaded" });
      await this.waitForVideo(videoId);
    });
  }

  async navigateWithinPlaylist(videoId) {
    const links = this.page.locator(`a[href*="watch?v=${videoId}"]`);
    const link = await firstVisible(links, `playlist link for ${videoId}`);
    const documentMarker = await this.page.evaluate(() => {
      const value = `${Date.now()}-${Math.random()}`;
      globalThis.__rydLiveSpaDocumentMarker = value;
      return value;
    });
    await this.withVotesResponse(videoId, async () => {
      await link.scrollIntoViewIfNeeded();
      await Promise.all([this.page.waitForURL((url) => videoIdFromUrl(url.toString()) === videoId), link.click()]);
      await this.waitForVideo(videoId);
    });
    assert.equal(
      await this.page.evaluate(() => globalThis.__rydLiveSpaDocumentMarker),
      documentMarker,
      "The playlist transition replaced the document instead of using YouTube SPA navigation.",
    );
  }

  async navigateToRelatedWatch(excludedVideoIds = []) {
    const currentVideoId = videoIdFromUrl(this.page.url());
    assert.match(currentVideoId, VIDEO_ID_PATTERN, "The sidebar stress scenario must start on a watch video.");
    const exclusions = [...new Set(excludedVideoIds)];
    for (const excludedVideoId of exclusions) {
      assert.match(excludedVideoId, VIDEO_ID_PATTERN, "Sidebar navigation exclusions must be valid video IDs.");
    }

    this.reportProgress("related-watch-link.waiting", { currentVideoId, excludedVideoIds: exclusions });
    const { link, videoId } = await firstVisibleRelatedWatchLink(this.page, currentVideoId, [
      ...new Set([...exclusions, currentVideoId]),
    ]);
    this.reportProgress("related-watch-link.found", { currentVideoId, videoId });
    const documentMarker = await this.page.evaluate(() => {
      const value = `${Date.now()}-${Math.random()}`;
      globalThis.__rydLiveSpaDocumentMarker = value;
      return value;
    });

    const { body } = await this.withVotesResponse(videoId, async () => {
      await link.scrollIntoViewIfNeeded();
      const targetVideoId = await link.evaluate(relatedWatchVideoId, {
        currentVideoId,
        excludedVideoIds: [...new Set([...exclusions, currentVideoId])],
        origin: new URL(this.page.url()).origin,
      });
      assert.equal(targetVideoId, videoId, "The selected #related link changed before it could be clicked.");
      this.reportProgress("related-watch-link.clicking", { currentVideoId, videoId });
      await Promise.all([this.page.waitForURL((url) => videoIdFromUrl(url.toString()) === videoId), link.click()]);
      await this.waitForVideo(videoId);
    });

    assert.equal(
      await this.page.evaluate(() => globalThis.__rydLiveSpaDocumentMarker),
      documentMarker,
      "The #related watch transition replaced the document instead of using YouTube SPA navigation.",
    );
    this.reportProgress("related-watch-navigation.confirmed", {
      apiDislikes: body.dislikes,
      currentVideoId,
      url: this.page.url(),
      videoId,
    });
    return { body, videoId };
  }

  async openShort(videoId) {
    return this.withVotesResponse(videoId, async () => {
      await this.page.goto(`https://www.youtube.com/shorts/${videoId}`, { waitUntil: "domcontentloaded" });
      await this.waitForVideo(videoId);
    });
  }

  async visibleDislikeButton() {
    return this.visibleActionButton("dislike");
  }

  async visibleLikeButton() {
    return this.visibleActionButton("like");
  }

  async visibleActionButton(action) {
    const selectors = ACTION_BUTTON_SELECTORS[action];
    if (!selectors) throw new Error(`Unsupported YouTube reaction action: ${action}`);

    const isShort = this.page.url().includes("/shorts/");
    const videoId = videoIdFromUrl(this.page.url());
    const locator = isShort
      ? this.page.locator(selectors)
      : this.page
          .locator(`ytd-watch-flexy[video-id="${videoId}"], ytd-watch-grid[video-id="${videoId}"]`)
          .locator(selectors);
    return firstVisible(locator, `YouTube ${action} button`, {
      expectedShortVideoId: isShort ? videoIdFromUrl(this.page.url()) : null,
      requireActiveShort: isShort,
      requireViewport: isShort,
    });
  }

  async waitForDislikeText({ differentFrom = null } = {}) {
    return waitForValue(
      async () => (await this.visibleDislikeButton()).evaluate(readDislikeControlText),
      (text) => /\d/.test(text) && (differentFrom === null || text !== differentFrom),
      "The enabled RYD runtime did not render a dislike count",
      30_000,
    );
  }

  async readVoteState() {
    return (await this.visibleDislikeButton()).getAttribute("aria-pressed");
  }

  async readLikeState() {
    return (await this.visibleLikeButton()).getAttribute("aria-pressed");
  }

  async readReactionPressedStates() {
    const [likeState, dislikeState] = await Promise.all([this.readLikeState(), this.readVoteState()]);
    assert.ok(["true", "false"].includes(likeState), `Unexpected YouTube like state: ${likeState}`);
    assert.ok(["true", "false"].includes(dislikeState), `Unexpected YouTube dislike state: ${dislikeState}`);
    assert.ok(!(likeState === "true" && dislikeState === "true"), "YouTube reported Like and Dislike as selected.");
    return { dislikeState, likeState };
  }

  async readReactionState() {
    const { dislikeState, likeState } = await this.readReactionPressedStates();
    if (likeState === "true") return "liked";
    if (dislikeState === "true") return "disliked";
    return "neutral";
  }

  async waitForVoteState(expected) {
    return waitForValue(
      () => this.readVoteState(),
      (state) => state === String(expected),
      `Timed out waiting for dislike aria-pressed=${expected}`,
    );
  }

  async waitForReactionState(expected) {
    return waitForValue(
      () => this.readReactionState(),
      (state) => state === expected,
      `Timed out waiting for YouTube reaction state ${expected}`,
    );
  }

  async clickDislike(videoId) {
    return this.clickAction(videoId, "dislike");
  }

  async clickLike(videoId) {
    return this.clickAction(videoId, "like");
  }

  async clickAction(videoId, action) {
    this.assertCurrentVideo(videoId);
    const selectors = ACTION_BUTTON_SELECTORS[action];
    if (!selectors) throw new Error(`Unsupported YouTube reaction action: ${action}`);

    const isShort = this.page.url().includes("/shorts/");
    const locator = isShort
      ? this.page.locator(selectors)
      : this.page
          .locator(`ytd-watch-flexy[video-id="${videoId}"], ytd-watch-grid[video-id="${videoId}"]`)
          .locator(selectors);
    const button = await firstVisible(locator, `${action} button for allowlisted video ${videoId}`, {
      expectedShortVideoId: isShort ? videoId : null,
      requireActiveShort: isShort,
      requireViewport: isShort,
    });
    this.assertCurrentVideo(videoId);
    await button.scrollIntoViewIfNeeded();
    this.assertCurrentVideo(videoId);
    await button.click();
  }
}

module.exports = {
  LiveYoutubeDriver,
  VoteTrafficRecorder,
  WATCH_RATIO_SOAK_DURATION_MS,
  assertReactionPressedStates,
  assertLogicalVoteHandshake,
  assertNativeShortsPairGeometry,
  assertShortsActionStackGeometry,
  assertSyntheticShortsGeometry,
  assertWatchRatioViewportAlignment,
  clickWithSingleNavigationRetry,
  croppedScreenshotClip,
  firstVisibleRelatedWatchLink,
  isShortCandidateEligible,
  isShortsIconVisualReady,
  pointerPositionAwayFromBoxes,
  readDislikeControlText,
  relatedWatchVideoId,
  videoIdFromUrl,
};
