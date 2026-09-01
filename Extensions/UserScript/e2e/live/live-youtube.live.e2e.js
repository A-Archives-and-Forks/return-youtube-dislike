const { chromium, test } = require("@playwright/test");
const {
  createExtensionLiveRuntimeAdapter,
  createUserscriptLiveRuntimeAdapter,
} = require("../../../e2e/live-runtime-adapter");
const { createSharedLiveScenarioRunner } = require("../../../e2e/shared-live-scenarios");
const { consumeLiveVoteApproval, hasFreshVoteApproval, readLiveOptions } = require("../../live/live-options");
const { LiveYoutubeDriver, VoteTrafficRecorder } = require("./live-youtube-driver");

const options = readLiveOptions();
const scenarioRunner = createSharedLiveScenarioRunner();

test.describe("live YouTube RYD smoke", () => {
  test.skip(options === null, "Set RYD_LIVE_YOUTUBE=1 and the documented allowlist variables to opt in.");
  test.describe.configure({ mode: "serial" });

  let browser;
  let context;
  let page;
  let driver;
  let runtimeAdapter;

  test.beforeAll(async () => {
    try {
      browser = await chromium.connectOverCDP(options.cdpEndpoint, {
        isLocal: true,
        noDefaults: true,
        timeout: 15_000,
      });
    } catch (error) {
      throw new Error(
        `Could not attach to the running Brave/Chromium profile. Enable remote debugging at brave://inspect/#remote-debugging and set RYD_CDP_ENDPOINT to its explicit CDP endpoint, then retry. ${error.message}`,
      );
    }

    [context] = browser.contexts();
    if (!context) throw new Error("The attached Brave/Chromium browser has no default context.");
    page = await context.newPage();
    driver = new LiveYoutubeDriver(page, context);
    const createAdapter =
      options.runtime === "extension" ? createExtensionLiveRuntimeAdapter : createUserscriptLiveRuntimeAdapter;
    runtimeAdapter = createAdapter({
      driver,
      expectedBuildId: options.expectedBuildId,
      expectedVersion: options.expectedVersion,
    });
  });

  test.afterAll(async () => {
    if (page && !page.isClosed()) await page.close();
    if (browser) await browser.close();
  });

  test(`${options?.runtime || "runtime"}: initializes after cold channel-to-Short and Next-video SPA navigation`, async () => {
    test.setTimeout(150_000);
    await scenarioRunner.run(runtimeAdapter, "channel-shorts-navigation", options);
  });

  test(`${options?.runtime || "runtime"}: initializes after optional cold channel-to-watch SPA navigation`, async () => {
    test.setTimeout(120_000);
    test.skip(
      !options?.navigation.watch,
      "Set RYD_LIVE_NAV_WATCH only when the configured channel page contains an exact visible link to that video.",
    );
    await scenarioRunner.run(runtimeAdapter, "channel-watch-navigation", options);
  });

  test(`${options?.runtime || "runtime"}: renders on a signed-in watch page`, async () => {
    await scenarioRunner.run(runtimeAdapter, "watch-render", options);
  });

  test(`${options?.runtime || "runtime"}: reinitializes after reload`, async () => {
    await scenarioRunner.run(runtimeAdapter, "reload", options);
  });

  test(`${options?.runtime || "runtime"}: reinitializes after real playlist SPA navigation`, async () => {
    await scenarioRunner.run(runtimeAdapter, "spa-navigation", options);
  });

  test(`${options?.runtime || "runtime"}: survives consecutive real sidebar SPA navigations`, async () => {
    test.setTimeout(60_000 + options.sidebar.hopCount * 75_000);
    await scenarioRunner.run(runtimeAdapter, "sidebar-navigation-stress", options);
  });

  test(`${options?.runtime || "runtime"}: renders on an allowlisted Short`, async () => {
    await scenarioRunner.run(runtimeAdapter, "shorts-render", options);
  });

  test(`${options?.runtime || "runtime"}: preserves reaction UI geometry across responsive widths`, async () => {
    test.setTimeout(180_000);
    await scenarioRunner.run(runtimeAdapter, "responsive-visual", options);
  });

  test(`${options?.runtime || "runtime"}: covers all reaction transitions on watch and Shorts`, async () => {
    test.setTimeout(0);
    const voteApproval = process.env.RYD_LIVE_VOTES;
    test.skip(
      !hasFreshVoteApproval(voteApproval, options.runtime, options.watchB, Date.now()),
      "Create the documented short-lived RYD_LIVE_VOTES token only after approving the real vote pair.",
    );

    await scenarioRunner.run(runtimeAdapter, "reaction-matrix", options, {
      createRecorder: (videoId) => new VoteTrafficRecorder(context, videoId),
      consumeVoteApproval: async () => {
        driver.assertCurrentVideo(options.watchB);
        await driver.assertRuntime(options.runtime, options.expectedVersion, options.expectedBuildId);
        if (!consumeLiveVoteApproval(voteApproval, options.runtime, options.watchB)) {
          throw new Error("The live reaction approval expired or was already used. No reaction was clicked.");
        }
      },
    });
  });
});
