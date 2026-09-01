const { test, expect } = require("@playwright/test");
const {
  CREDENTIAL_KEY,
  createFakeBackend,
  injectGeneratedUserscript,
  installGmEnvironment,
  installHermeticRoutes,
  openNavigationFixture,
} = require("./harness");
const {
  NAVIGATION_MATRIX,
  USERSCRIPT_MATRIX_RUNTIME,
  installNavigationMatrixFixture,
  runNavigationMatrixScenario,
} = require("./navigation-matrix");

const EXISTING_CREDENTIALS = {
  registrationConfirmed: true,
  userId: "ExistingUserscriptCredential000000000001",
};

for (const scenario of NAVIGATION_MATRIX) {
  test(`userscript navigation matrix: ${scenario.id}`, async ({ context, page }) => {
    await page.setViewportSize(scenario.viewport);
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await context.addInitScript(() => {
      globalThis.__unhandledRejections = [];
      addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        globalThis.__unhandledRejections.push(reason instanceof Error ? reason.message : String(reason));
      });
    });

    const backend = createFakeBackend({
      countsByVideo: {
        [scenario.destination.videoId]: scenario.destination.counts,
        [scenario.origin.videoId]: scenario.origin.counts,
      },
    });
    await installGmEnvironment(context, { [CREDENTIAL_KEY]: EXISTING_CREDENTIALS });
    await installNavigationMatrixFixture(context, scenario);
    await installHermeticRoutes(context, backend);
    await openNavigationFixture(page, {
      pageKind: scenario.origin.kind,
      videoId: scenario.origin.videoId,
    });
    await injectGeneratedUserscript(page);

    await runNavigationMatrixScenario({
      backend,
      page,
      runtime: USERSCRIPT_MATRIX_RUNTIME,
      scenario,
    });

    expect(backend.blockedRequests).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(await page.evaluate(() => globalThis.__unhandledRejections)).toEqual([]);
  });
}
