const { test, expect } = require("@playwright/test");
const {
  CREDENTIAL_KEY,
  VIDEO_A,
  createFakeBackend,
  injectGeneratedUserscript,
  installGmEnvironment,
  installHermeticRoutes,
  openWatchFixture,
} = require("./harness");

const EXISTING_CREDENTIALS = {
  userId: "ExistingUserscriptCredential000000000001",
  registrationConfirmed: true,
};
const BASE_COUNTS = { likes: 300, dislikes: 100 };
const VIEWPORTS = [
  { name: "wide", width: 1280, height: 720 },
  { name: "narrow", width: 768, height: 720 },
  { name: "mobile-sized", width: 390, height: 844 },
];
const TRANSITIONS = [
  {
    action: "like",
    initialState: "neutral",
    nextState: "liked",
    value: 1,
    likesDelta: 1,
    dislikesDelta: 0,
  },
  {
    action: "dislike",
    initialState: "neutral",
    nextState: "disliked",
    value: -1,
    likesDelta: 0,
    dislikesDelta: 1,
  },
  {
    action: "like",
    initialState: "liked",
    nextState: "neutral",
    value: 0,
    likesDelta: -1,
    dislikesDelta: 0,
  },
  {
    action: "dislike",
    initialState: "liked",
    nextState: "disliked",
    value: -1,
    likesDelta: -1,
    dislikesDelta: 1,
  },
  {
    action: "like",
    initialState: "disliked",
    nextState: "liked",
    value: 1,
    likesDelta: 1,
    dislikesDelta: -1,
  },
  {
    action: "dislike",
    initialState: "disliked",
    nextState: "neutral",
    value: 0,
    likesDelta: 0,
    dislikesDelta: -1,
  },
];

function monitorRuntime(page) {
  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function launchVisualFixture({ context, page }, initialState) {
  const runtime = monitorRuntime(page);
  const backend = createFakeBackend({
    countsByVideo: { [VIDEO_A]: BASE_COUNTS },
    fixture: { initialState },
  });
  await installGmEnvironment(context, { [CREDENTIAL_KEY]: EXISTING_CREDENTIALS });
  await installHermeticRoutes(context, backend);
  await openWatchFixture(page, VIDEO_A);
  await injectGeneratedUserscript(page);

  await expect(page.locator('[data-ryd-role="dislike"] #text')).toHaveText(String(BASE_COUNTS.dislikes));
  await expect(page.locator("#return-youtube-dislike-bar-container")).toBeVisible();
  return { backend, ...runtime };
}

async function readVisualContract(page) {
  return page.evaluate(() => {
    const required = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing visual-contract element: ${selector}`);
      return element;
    };
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      };
    };
    const box = (element) => {
      const style = getComputedStyle(element);
      return {
        margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      };
    };
    const control = (role) => {
      const outer = required(`[data-ryd-role="${role}"]`);
      const button = required(`[data-ryd-role="${role}"] button`);
      const icon = required(`[data-ryd-role="${role}"] [data-fixture-icon]`);
      const text = required(`[data-ryd-role="${role}"] #text`);
      const buttonStyle = getComputedStyle(button);
      return {
        ariaPressed: button.getAttribute("aria-pressed"),
        backgroundColor: buttonStyle.backgroundColor,
        button: rect(button),
        buttonBox: box(button),
        classes: [...outer.classList].sort(),
        color: buttonStyle.color,
        icon: rect(icon),
        iconBox: box(icon),
        outer: rect(outer),
        outerBox: box(outer),
        text: rect(text),
        textBox: box(text),
      };
    };

    const surface = required("#top-level-buttons-computed");
    const reactionGroup = required('[data-ryd-role="buttons"]');
    const topRow = required("#top-row");
    const wrapper = required(".ryd-tooltip");
    const barContainer = required("#return-youtube-dislike-bar-container");
    const bar = required("#return-youtube-dislike-bar");
    const tooltip = required("#ryd-dislike-tooltip");
    const reactionGroupStyle = getComputedStyle(reactionGroup);
    const surfaceStyle = getComputedStyle(surface);
    const topRowStyle = getComputedStyle(topRow);
    const barStyle = getComputedStyle(bar);
    const barContainerStyle = getComputedStyle(barContainer);
    const tooltipStyle = getComputedStyle(tooltip);
    const wrapperStyle = getComputedStyle(wrapper);

    return {
      bar: rect(bar),
      barAppearance: {
        backgroundColor: barStyle.backgroundColor,
        borderRadius: barStyle.borderRadius,
      },
      barContainer: rect(barContainer),
      barContainerAppearance: {
        backgroundColor: barContainerStyle.backgroundColor,
        borderRadius: barContainerStyle.borderRadius,
      },
      buttons: rect(surface),
      buttonsBox: box(surface),
      buttonsGap: reactionGroupStyle.gap,
      buttonsPosition: surfaceStyle.position,
      dislike: control("dislike"),
      like: control("like"),
      ownership: {
        barOwnedByButtons: surface.contains(barContainer),
        tooltipDescribedBy: wrapper.getAttribute("aria-describedby"),
        tooltipOwnedByButtons: surface.contains(tooltip),
        tooltipRole: tooltip.getAttribute("role"),
        wrapperOwnedByButtons: wrapper.parentElement === surface,
      },
      reactionGroup: rect(reactionGroup),
      reactionGroupBox: box(reactionGroup),
      topRow: rect(topRow),
      topRowBox: box(topRow),
      topRowStyle: {
        borderBottomWidth: topRowStyle.borderBottomWidth,
        paddingBottom: topRowStyle.paddingBottom,
      },
      tooltipText: tooltip.textContent.replace(/\s+/g, " ").trim(),
      tooltipAppearance: {
        fontSize: tooltipStyle.fontSize,
        lineHeight: tooltipStyle.lineHeight,
        opacity: tooltipStyle.opacity,
        padding: box(tooltip).padding,
        position: tooltipStyle.position,
        visibility: tooltipStyle.visibility,
      },
      unique: {
        bars: document.querySelectorAll("#return-youtube-dislike-bar").length,
        containers: document.querySelectorAll("#return-youtube-dislike-bar-container").length,
        tooltips: document.querySelectorAll("#ryd-dislike-tooltip").length,
        wrappers: document.querySelectorAll(".ryd-tooltip").length,
      },
      viewport: { height: innerHeight, width: innerWidth },
      wrapper: rect(wrapper),
      wrapperAppearance: {
        box: box(wrapper),
        position: wrapperStyle.position,
      },
    };
  });
}

function expectClose(actual, expected, precision = 5) {
  expect(actual).toBeCloseTo(expected, precision);
}

function expectComputedColor(actual, expectedChannel) {
  const srgb = actual.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  const channels = srgb
    ? srgb.slice(1).map((channel) => Number(channel) * 255)
    : actual
        .match(/[\d.]+/g)
        ?.slice(0, 3)
        .map(Number);
  expect(channels).toHaveLength(3);
  channels.forEach((channel) => expect(channel).toBeCloseTo(expectedChannel, 0));
}

function expectControlGeometry(control) {
  expectClose(control.outer.width, 96);
  expectClose(control.outer.height, 36);
  expectClose(control.button.width, 96);
  expectClose(control.button.height, 36);
  expect(control.outerBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "0px", "0px", "0px"],
  });
  expect(control.buttonBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "12px", "0px", "12px"],
  });
  expect(control.iconBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "0px", "0px", "0px"],
  });
  expect(control.textBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "0px", "0px", "0px"],
  });
  expectClose(control.icon.width, 20);
  expectClose(control.icon.height, 20);
  expectClose(control.icon.top + control.icon.height / 2, control.button.top + control.button.height / 2);
  expectClose(control.text.top + control.text.height / 2, control.button.top + control.button.height / 2);
  expectClose(control.text.left - control.icon.right, 6);
}

function expectPressedState(control, pressed) {
  expect(control.ariaPressed).toBe(String(pressed));
  expect(control.classes).toEqual([pressed ? "style-default-active" : "style-text"]);
  expect(control.backgroundColor).toBe(pressed ? "rgb(241, 241, 241)" : "rgb(39, 39, 39)");
  expect(control.color).toBe(pressed ? "rgb(15, 15, 15)" : "rgb(241, 241, 241)");
}

function expectVisualState(snapshot, state, counts, viewport) {
  expect(snapshot.viewport).toEqual({ height: viewport.height, width: viewport.width });
  expect(snapshot.unique).toEqual({ bars: 1, containers: 1, tooltips: 1, wrappers: 1 });
  expect(snapshot.ownership).toEqual({
    barOwnedByButtons: true,
    tooltipDescribedBy: "ryd-dislike-tooltip",
    tooltipOwnedByButtons: true,
    tooltipRole: "tooltip",
    wrapperOwnedByButtons: true,
  });
  expect(snapshot.tooltipText).toBe(`${counts.likes} / ${counts.dislikes}`);
  expect(snapshot.buttonsGap).toBe("0px");
  expect(snapshot.buttonsPosition).toBe("relative");
  expect(snapshot.buttonsBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "0px", "0px", "0px"],
  });
  expect(snapshot.reactionGroupBox).toEqual(snapshot.buttonsBox);
  expect(snapshot.topRowBox).toEqual({
    margin: ["0px", "0px", "0px", "0px"],
    padding: ["0px", "0px", "10px", "0px"],
  });
  expect(snapshot.topRowStyle).toEqual({ borderBottomWidth: "1px", paddingBottom: "10px" });
  expect(snapshot.wrapperAppearance).toEqual({
    box: {
      margin: ["0px", "0px", "0px", "0px"],
      padding: ["0px", "0px", "0px", "0px"],
    },
    position: "absolute",
  });
  expect(snapshot.barContainerAppearance.borderRadius).toBe("2px");
  expectComputedColor(snapshot.barContainerAppearance.backgroundColor, 139);
  expect(snapshot.barAppearance).toEqual({
    backgroundColor: "rgb(241, 241, 241)",
    borderRadius: "2px",
  });
  expect(snapshot.tooltipAppearance).toEqual({
    fontSize: "12px",
    lineHeight: "16px",
    opacity: "0",
    padding: ["6px", "8px", "6px", "8px"],
    position: "absolute",
    visibility: "hidden",
  });

  expectControlGeometry(snapshot.like);
  expectControlGeometry(snapshot.dislike);
  expectPressedState(snapshot.like, state === "liked");
  expectPressedState(snapshot.dislike, state === "disliked");

  expectClose(snapshot.like.outer.right, snapshot.dislike.outer.left);
  expectClose(snapshot.wrapper.left, snapshot.like.outer.left);
  expectClose(snapshot.wrapper.right, snapshot.dislike.outer.right);
  expectClose(snapshot.wrapper.width, snapshot.like.outer.width + snapshot.dislike.outer.width);
  expectClose(snapshot.wrapper.height, 2);
  expectClose(snapshot.wrapper.top - Math.max(snapshot.like.outer.bottom, snapshot.dislike.outer.bottom), 8);
  expectClose(snapshot.barContainer.width, snapshot.wrapper.width);
  expectClose(snapshot.barContainer.height, 2);
  expectClose(snapshot.bar.height, 2);
  expectClose(snapshot.bar.width / snapshot.barContainer.width, counts.likes / (counts.likes + counts.dislikes), 3);
  expect(snapshot.topRow.left).toBeGreaterThanOrEqual(0);
  expect(snapshot.topRow.right).toBeLessThanOrEqual(snapshot.viewport.width);
  expect(snapshot.wrapper.left).toBeGreaterThanOrEqual(snapshot.topRow.left);
  expect(snapshot.wrapper.right).toBeLessThanOrEqual(snapshot.topRow.right);
}

function expectNoStructuralLayoutShift(before, after) {
  const paths = [
    ["topRow"],
    ["buttons"],
    ["reactionGroup"],
    ["wrapper"],
    ["barContainer"],
    ["like", "outer"],
    ["like", "button"],
    ["dislike", "outer"],
    ["dislike", "button"],
  ];
  const dimensions = ["top", "right", "bottom", "left", "width", "height"];
  for (const path of paths) {
    const beforeRect = path.reduce((value, key) => value[key], before);
    const afterRect = path.reduce((value, key) => value[key], after);
    for (const dimension of dimensions) {
      expect(
        Math.abs(afterRect[dimension] - beforeRect[dimension]),
        `${path.join(".")}.${dimension}`,
      ).toBeLessThanOrEqual(0.25);
    }
  }
}

async function waitForBarRatio(page, counts) {
  const expectedRatio = counts.likes / (counts.likes + counts.dislikes);
  await expect
    .poll(() =>
      page.locator("#return-youtube-dislike-bar").evaluate((bar) => {
        const container = bar.parentElement;
        return bar.getBoundingClientRect().width / container.getBoundingClientRect().width;
      }),
    )
    .toBeCloseTo(expectedRatio, 3);
}

async function attachFailureScreenshot(testInfo, page, name) {
  let body;
  try {
    const scope = page.locator("#top-row");
    body = (await scope.count()) > 0 ? await scope.screenshot({ animations: "disabled" }) : await page.screenshot();
  } catch {
    body = await page.screenshot().catch(() => null);
  }
  if (body) {
    await testInfo.attach(`${name}-visual-contract-failure`, { body, contentType: "image/png" });
  }
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} watch visual contract`, () => {
    for (const transition of TRANSITIONS) {
      const name = `${transition.initialState} + ${transition.action} -> ${transition.nextState}`;
      test(name, async ({ context, page }, testInfo) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        try {
          const harness = await launchVisualFixture({ context, page }, transition.initialState);
          const before = await readVisualContract(page);
          expectVisualState(before, transition.initialState, BASE_COUNTS, viewport);

          await page.locator(`[data-ryd-role="${transition.action}"] button`).click();
          await expect.poll(() => harness.backend.requestsFor("POST", "/interact/confirmVote").length).toBe(1);

          const nextCounts = {
            likes: BASE_COUNTS.likes + transition.likesDelta,
            dislikes: BASE_COUNTS.dislikes + transition.dislikesDelta,
          };
          await waitForBarRatio(page, nextCounts);
          const after = await readVisualContract(page);
          expectVisualState(after, transition.nextState, nextCounts, viewport);
          expectNoStructuralLayoutShift(before, after);

          expect(harness.backend.requestsFor("GET", "/votes")).toHaveLength(1);
          expect(harness.backend.requestsFor("POST", "/interact/vote")).toHaveLength(1);
          expect(harness.backend.requestsFor("POST", "/interact/vote")[0].body).toMatchObject({
            userId: EXISTING_CREDENTIALS.userId,
            value: transition.value,
            videoId: VIDEO_A,
          });
          expect(harness.backend.requestsFor("POST", "/interact/confirmVote")).toHaveLength(1);
          expect(harness.backend.blockedRequests).toEqual([]);
          expect(harness.consoleErrors).toEqual([]);
          expect(harness.pageErrors).toEqual([]);
        } catch (error) {
          await attachFailureScreenshot(testInfo, page, `${viewport.name}-${name}`);
          throw error;
        }
      });
    }
  });
}
