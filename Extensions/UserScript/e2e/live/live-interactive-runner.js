const readline = require("node:readline");
const { chromium } = require("@playwright/test");
const {
  createExtensionLiveRuntimeAdapter,
  createUserscriptLiveRuntimeAdapter,
} = require("../../../e2e/live-runtime-adapter");
const { createSharedLiveScenarioRunner } = require("../../../e2e/shared-live-scenarios");
const { consumeLiveVoteApproval, hasFreshVoteApproval, readLiveOptions } = require("../../live/live-options");
const { LiveRunDiagnostics, runLoggedStage } = require("./live-diagnostics");
const { LiveYoutubeDriver, VoteTrafficRecorder } = require("./live-youtube-driver");

const scenarioRunner = createSharedLiveScenarioRunner();

function readApprovalLine() {
  const input = readline.createInterface({ input: process.stdin, terminal: false });
  return new Promise((resolve) => {
    input.once("line", (line) => {
      input.close();
      resolve(line.trim());
    });
  });
}

async function main() {
  const options = readLiveOptions();
  if (!options) throw new Error("Set RYD_LIVE_YOUTUBE=1 and the documented allowlist variables to opt in.");

  let browser;
  let diagnostics;
  let page;
  try {
    console.log("WAITING_FOR_BRAVE_DEBUG_APPROVAL");
    browser = await chromium.connectOverCDP(options.cdpEndpoint, {
      isLocal: true,
      noDefaults: true,
      timeout: 120_000,
    });
    const [context] = browser.contexts();
    if (!context) throw new Error("The attached Chromium browser has no default context.");

    page = await context.newPage();
    diagnostics = new LiveRunDiagnostics(page, context, { runtime: options.runtime });
    await diagnostics.start();
    const driver = new LiveYoutubeDriver(page, context, {
      reportProgress: (name, details) => diagnostics.checkpoint(name, details),
    });
    const createAdapter =
      options.runtime === "extension" ? createExtensionLiveRuntimeAdapter : createUserscriptLiveRuntimeAdapter;
    const runtimeAdapter = createAdapter({
      driver,
      expectedBuildId: options.expectedBuildId,
      expectedVersion: options.expectedVersion,
    });
    console.log("BRAVE_CONNECTED");

    const readOnly = {};
    readOnly.channelShorts = await runLoggedStage(diagnostics, "read-only.channel-to-shorts-and-next", () =>
      scenarioRunner.run(runtimeAdapter, "channel-shorts-navigation", options),
    );
    if (options.navigation.watch) {
      readOnly.channelWatch = await runLoggedStage(diagnostics, "read-only.channel-to-watch", () =>
        scenarioRunner.run(runtimeAdapter, "channel-watch-navigation", options),
      );
    } else {
      readOnly.channelWatch = null;
      diagnostics.checkpoint("read-only.channel-to-watch.skipped", {
        reason: "RYD_LIVE_NAV_WATCH is not configured",
      });
    }
    readOnly.reload = await runLoggedStage(diagnostics, "read-only.reload", () =>
      scenarioRunner.run(runtimeAdapter, "reload", options),
    );
    readOnly.responsive = await runLoggedStage(diagnostics, "read-only.responsive-visual", () =>
      scenarioRunner.run(runtimeAdapter, "responsive-visual", options),
    );
    readOnly.short = await runLoggedStage(diagnostics, "read-only.short-render", () =>
      scenarioRunner.run(runtimeAdapter, "shorts-render", options),
    );
    readOnly.spa = await runLoggedStage(diagnostics, "read-only.playlist-spa", () =>
      scenarioRunner.run(runtimeAdapter, "spa-navigation", options),
    );
    readOnly.sidebarStress = await runLoggedStage(diagnostics, "read-only.sidebar-stress", () =>
      scenarioRunner.run(runtimeAdapter, "sidebar-navigation-stress", options),
    );
    readOnly.watch = await runLoggedStage(diagnostics, "read-only.watch-render", () =>
      scenarioRunner.run(runtimeAdapter, "watch-render", options),
    );
    console.log(`READ_ONLY_COMPLETE ${JSON.stringify(readOnly)}`);
    console.log(
      `READY_FOR_REACTION_APPROVAL runtime=${options.runtime} watch=${options.watchB} short=${options.short}`,
    );

    diagnostics.checkpoint("reaction-approval.waiting", {
      instruction: "Enter SKIP to close the live-test tab without production reactions",
    });
    const approval = await readApprovalLine();
    if (approval === "SKIP") {
      console.log("REACTION_MATRIX_SKIPPED");
      return;
    }
    if (!hasFreshVoteApproval(approval, options.runtime, options.watchB, Date.now())) {
      throw new Error("The supplied live reaction approval is missing, expired, or does not match this run.");
    }

    const reaction = await runLoggedStage(diagnostics, "reaction-matrix", () =>
      scenarioRunner.run(runtimeAdapter, "reaction-matrix", options, {
        createRecorder: (videoId) => new VoteTrafficRecorder(context, videoId),
        consumeVoteApproval: async () => {
          driver.assertCurrentVideo(options.watchB);
          await driver.assertRuntime(options.runtime, options.expectedVersion, options.expectedBuildId);
          if (!consumeLiveVoteApproval(approval, options.runtime, options.watchB)) {
            throw new Error("The live reaction approval expired or was already used. No reaction was clicked.");
          }
        },
      }),
    );
    console.log(`REACTION_MATRIX_COMPLETE ${JSON.stringify(reaction)}`);
  } catch (error) {
    if (diagnostics) {
      try {
        const snapshotPath = await diagnostics.persistFailureSnapshot(error);
        console.error(`LIVE_FAILURE_SNAPSHOT ${snapshotPath}`);
      } catch (snapshotError) {
        console.error(`LIVE_FAILURE_SNAPSHOT_FAILED ${snapshotError.message}`);
      }
    }
    throw error;
  } finally {
    diagnostics?.stop();
    if (page && !page.isClosed()) await page.close();
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
