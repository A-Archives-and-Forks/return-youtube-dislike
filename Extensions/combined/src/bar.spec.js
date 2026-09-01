/** @jest-environment jsdom */

const fs = require("fs");
const path = require("path");

jest.mock("./buttons", () => ({
  getButtons: jest.fn(),
  getDislikeButton: jest.fn(),
  getLikeButton: jest.fn(),
}));

jest.mock("./state", () => ({
  extConfig: {
    coloredBar: false,
    rateBar: null,
    selectors: {
      rateBar: {
        actions: ["#actions"],
        actionsInner: ["#actions-inner"],
        mobileActionBar: ["ytm-slim-video-action-bar-renderer"],
        topRow: ["#top-row"],
      },
    },
    showTooltipPercentage: false,
    tooltipPercentageMode: "dash_like",
  },
  isLikesDisabled: jest.fn(() => false),
  isMobile: jest.fn(() => false),
  isNewDesign: jest.fn(() => true),
  isRoundedDesign: jest.fn(() => true),
  isShorts: jest.fn(() => false),
}));

jest.mock("./utils", () => ({
  getColorFromTheme: jest.fn(() => "red"),
  isInViewport: jest.fn(() => true),
  querySelector: jest.fn((selectors, element) => {
    const scope = element ?? globalThis.document;
    for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
      const match = scope?.querySelector(selector);
      if (match) return match;
    }
    return undefined;
  }),
}));

const { getButtons, getDislikeButton, getLikeButton } = require("./buttons");
const { createRateBar } = require("./bar");
const { isLikesDisabled, isMobile, isNewDesign, isRoundedDesign, isShorts } = require("./state");

describe("rate-bar stylesheet contrast", () => {
  test("uses the same high-contrast negative track recipe as the userscript", () => {
    const stylesheet = fs.readFileSync(path.join(__dirname, "../content-style.css"), "utf8");
    const rule = stylesheet.match(/#ryd-bar-container\s*{([^}]*)}/)?.[1] ?? "";

    expect(rule).toContain("background: #737373");
    expect(rule).toContain("var(--yt-spec-text-primary, #f1f1f1) 55%");
    expect(rule).toContain("var(--yt-spec-base-background, #0f0f0f) 45%");
    expect(rule).not.toContain("--yt-spec-icon-disabled");
  });
});

function watchTree(videoId) {
  return `
    <ytd-watch-flexy video-id="${videoId}">
      <div id="top-row" data-watch-row="${videoId}">
        <div id="actions-inner" data-watch-actions-inner="${videoId}" style="width: 999px">
          <div id="actions" data-watch-actions="${videoId}">
            <div id="top-level-buttons-computed" data-watch-buttons="${videoId}">
              <like-button-view-model><button style="width: 96px"></button></like-button-view-model>
              <dislike-button-view-model><button style="width: 96px"></button></dislike-button-view-model>
            </div>
          </div>
        </div>
      </div>
    </ytd-watch-flexy>`;
}

describe("rate-bar visual ownership", () => {
  beforeEach(() => {
    document.body.innerHTML = `${watchTree("AAAAAAAAAAA")}${watchTree("BBBBBBBBBBB")}`;
    isLikesDisabled.mockReturnValue(false);
    isMobile.mockReturnValue(false);
    isNewDesign.mockReturnValue(true);
    isRoundedDesign.mockReturnValue(true);
    isShorts.mockReturnValue(false);
    const buttons = document.querySelector('[data-watch-buttons="BBBBBBBBBBB"]');
    getButtons.mockReturnValue(buttons);
    getLikeButton.mockReturnValue(buttons.querySelector("like-button-view-model"));
    getDislikeButton.mockReturnValue(buttons.querySelector("dislike-button-view-model"));
  });

  test("mutates only the selected current watch tree when stale duplicate IDs come first", () => {
    const currentButtons = document.querySelector('[data-watch-buttons="BBBBBBBBBBB"]');
    expect(currentButtons.closest("#top-row")).toBe(document.querySelector('[data-watch-row="BBBBBBBBBBB"]'));
    expect(isNewDesign()).toBe(true);
    createRateBar(100, 25);

    const staleRow = document.querySelector('[data-watch-row="AAAAAAAAAAA"]');
    const staleActionsInner = document.querySelector('[data-watch-actions-inner="AAAAAAAAAAA"]');
    const staleActions = document.querySelector('[data-watch-actions="AAAAAAAAAAA"]');
    const currentRow = document.querySelector('[data-watch-row="BBBBBBBBBBB"]');
    const currentActionsInner = document.querySelector('[data-watch-actions-inner="BBBBBBBBBBB"]');
    const currentActions = document.querySelector('[data-watch-actions="BBBBBBBBBBB"]');

    expect(staleRow.style.borderBottom).toBe("");
    expect(staleRow.style.paddingBottom).toBe("");
    expect(staleActionsInner.style.width).toBe("999px");
    expect(staleActions.style.flexDirection).toBe("");
    expect(currentRow.style.paddingBottom).toBe("10px");
    expect(currentActionsInner.style.width).toBe("revert");
    expect(currentActions.style.flexDirection).toBe("row-reverse");
    expect(document.querySelector('[data-watch-buttons="BBBBBBBBBBB"] > .ryd-tooltip')).not.toBeNull();
    expect(document.querySelector('[data-watch-buttons="AAAAAAAAAAA"] > .ryd-tooltip')).toBeNull();
  });
});
