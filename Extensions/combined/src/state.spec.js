/**
 * @jest-environment jsdom
 */

jest.mock("./buttons", () => {
  const dislikeTextContainer = {
    innerText: "native dislike",
    removeAttribute: jest.fn(),
  };
  const likeButton = {
    classList: { contains: () => false },
    native: { getAttribute: (name) => (name === "aria-label" ? "35 likes" : "false") },
  };
  const dislikeButton = {
    classList: { contains: () => false },
    native: { getAttribute: () => "false" },
  };
  return {
    getButtons: () => ({ children: [] }),
    getDislikeButton: () => dislikeButton,
    getDislikeTextContainer: () => dislikeTextContainer,
    getLikeButton: () => likeButton,
    getLikeTextContainer: () => ({ innerText: "35" }),
  };
});

jest.mock("./bar", () => ({
  createRateBar: jest.fn(),
}));

jest.mock("./config", () => ({
  DEV_API_URL: "https://example.test",
  PROD_API_URL: "https://example.test",
  config: {},
  getApiEndpoint: (pathname) => `https://example.test${pathname}`,
  isDevelopment: () => false,
}));

jest.mock("./utils", () => ({
  createObserver: () => ({ observe: jest.fn() }),
  getBrowser: () => undefined,
  getColorFromTheme: () => undefined,
  getVideoId: (url) => new URL(url).searchParams.get("v"),
  initializeLogging: () => undefined,
  localize: (key) => key,
  numberFormat: (value) => String(value),
  querySelector: (selectors, root) => root?.native ?? null,
}));

import { createRateBar } from "./bar";
import { getDislikeTextContainer } from "./buttons";
import { setState } from "./state";

const dislikeTextContainer = getDislikeTextContainer();

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  dislikeTextContainer.innerText = "native dislike";
  dislikeTextContainer.removeAttribute.mockClear();
  createRateBar.mockClear();
  global.fetch = jest.fn();
  window.history.replaceState(null, "", "/watch?v=abcdefghijk");
});

afterAll(() => {
  delete global.fetch;
});

test("a delayed outgoing request failure cannot overwrite the destination before its successful initialization", async () => {
  const outgoing = deferred();
  const destinationResponse = {
    ok: true,
    json: jest.fn(async () => ({ dislikes: 65, likes: 35, rating: 3.5 })),
  };
  fetch.mockReturnValueOnce(outgoing.promise).mockResolvedValueOnce(destinationResponse);
  const testState = { dislikes: 0, likes: 0, previousState: "neutral", videoId: null };

  const outgoingInitialization = setState(testState);
  await Promise.resolve();
  expect(fetch).toHaveBeenCalledTimes(1);

  window.history.replaceState(null, "", "/watch?v=zyxwvutsrqp");
  outgoing.reject(new TypeError("outgoing request failed"));
  await outgoingInitialization;

  expect(dislikeTextContainer.innerText).toBe("native dislike");
  expect(createRateBar).not.toHaveBeenCalled();

  await setState(testState);

  expect(dislikeTextContainer.innerText).toBe("65");
  expect(createRateBar).toHaveBeenCalledWith(35, 65);
  expect(testState.videoId).toBe("zyxwvutsrqp");
});

test.each([
  ["non-2xx", { ok: false, error: new Error("unavailable") }],
  [
    "malformed JSON",
    {
      ok: true,
      json: async () => {
        throw new SyntaxError("invalid JSON");
      },
    },
  ],
])("a delayed outgoing %s response cannot write an error into the destination controls", async (name, response) => {
  const outgoing = deferred();
  fetch.mockReturnValueOnce(outgoing.promise);
  const testState = { dislikes: 0, likes: 0, previousState: "neutral", videoId: null };

  const initialization = setState(testState);
  await Promise.resolve();
  window.history.replaceState(null, "", "/watch?v=zyxwvutsrqp");
  // Resolve the request only after navigation so every failure path exercises the stale-video guard.
  outgoing.resolve(response);
  await initialization;

  expect(dislikeTextContainer.innerText).toBe("native dislike");
  expect(createRateBar).not.toHaveBeenCalled();
});
