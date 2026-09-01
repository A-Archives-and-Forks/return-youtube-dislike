const { LiveYoutubeDriver } = require("../e2e/live/live-youtube-driver");

class FakeBrowserContext {
  constructor() {
    this.listeners = new Map();
    this.routes = [];
    this.routeCalls = 0;
    this.unrouteCalls = 0;
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  async route(matcher, handler) {
    this.routeCalls += 1;
    this.routes.push({ handler, matcher });
  }

  async unroute(matcher, handler) {
    this.unrouteCalls += 1;
    this.routes = this.routes.filter((route) => route.matcher !== matcher || route.handler !== handler);
  }

  async dispatch(request) {
    for (const listener of this.listeners.get("request") ?? []) listener(request);

    const route = {
      abort: jest.fn().mockResolvedValue(undefined),
      fallback: jest.fn().mockResolvedValue(undefined),
      request: () => request,
    };
    for (const registered of [...this.routes].reverse()) {
      if (registered.matcher(new URL(request.url()))) {
        await registered.handler(route);
        break;
      }
    }
    return route;
  }
}

function createDriver(context) {
  const page = {
    setDefaultNavigationTimeout: jest.fn(),
    setDefaultTimeout: jest.fn(),
  };
  return new LiveYoutubeDriver(page, context);
}

function request(method, url) {
  return {
    frame: jest.fn(() => {
      throw new Error("Service-worker requests do not have a frame");
    }),
    method: () => method,
    url: () => url,
  };
}

describe("live read-only production-interaction guard", () => {
  test("installs the route first, aborts a frame-less interaction POST, and reports the attempt", async () => {
    const context = new FakeBrowserContext();
    const driver = createDriver(context);
    const frameLessRequest = request("POST", "https://returnyoutubedislikeapi.com/interact/vote?source=service-worker");
    let interceptedRoute;

    await expect(
      driver.withNoProductionInteractions(async () => {
        expect(context.routeCalls).toBe(1);
        interceptedRoute = await context.dispatch(frameLessRequest);
      }),
    ).rejects.toThrow("attempted a production interaction");

    expect(interceptedRoute.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(interceptedRoute.fallback).not.toHaveBeenCalled();
    expect(frameLessRequest.frame).not.toHaveBeenCalled();
    expect(context.unrouteCalls).toBe(1);
    expect(context.routes).toEqual([]);
  });

  test("shares one deny route across nested read-only guards", async () => {
    const context = new FakeBrowserContext();
    const driver = createDriver(context);
    const frameLessRequest = request("POST", "https://returnyoutubedislikeapi.com/interact/confirmVote");

    await expect(
      driver.withNoProductionInteractions(() =>
        driver.withNoProductionInteractions(async () => {
          await context.dispatch(frameLessRequest);
        }),
      ),
    ).rejects.toThrow("attempted a production interaction");

    expect(context.routeCalls).toBe(1);
    expect(context.unrouteCalls).toBe(1);
    expect(frameLessRequest.frame).not.toHaveBeenCalled();
  });

  test("allows non-interaction traffic and removes the route after success", async () => {
    const context = new FakeBrowserContext();
    const driver = createDriver(context);
    const result = await driver.withNoProductionInteractions(async () => {
      const unrelatedRoute = await context.dispatch(request("POST", "https://www.youtube.com/youtubei/v1/player"));
      expect(unrelatedRoute.abort).not.toHaveBeenCalled();
      return "complete";
    });

    expect(result).toBe("complete");
    expect(context.routeCalls).toBe(1);
    expect(context.unrouteCalls).toBe(1);
    expect(context.routes).toEqual([]);
  });
});
