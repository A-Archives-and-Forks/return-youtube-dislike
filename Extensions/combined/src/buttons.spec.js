/** @jest-environment jsdom */

const { extConfig } = require("./state");
const { getButtons, getDislikeButton, getLikeButton, hasRenderedBox, markButtonsForVideo } = require("./buttons");

function controls(id, videoId, attributes = "") {
  return `
    <ytd-menu-renderer class="ytd-watch-metadata" ${attributes}>
      <div id="${id}" data-video-id="${videoId}">
        <segmented-like-dislike-button-view-model>
          <like-button-view-model id="segmented-like-button"><button aria-pressed="false"></button></like-button-view-model>
          <dislike-button-view-model id="segmented-dislike-button"><button aria-pressed="false"></button></dislike-button-view-model>
        </segmented-like-dislike-button-view-model>
      </div>
    </ytd-menu-renderer>`;
}

function setBox(element, { height = 48, width = 320, x = 20, y = 20 } = {}) {
  element.getBoundingClientRect = () => ({
    bottom: y + height,
    height,
    left: x,
    right: x + width,
    top: y,
    width,
    x,
    y,
  });
}

describe("desktop watch button ownership", () => {
  beforeEach(() => {
    history.replaceState({}, "", "/watch?v=BBBBBBBBBBB");
    extConfig.selectors.buttons.regular.desktopMenu = ["ytd-menu-renderer.ytd-watch-metadata > div"];
    extConfig.selectors.buttons.regular.desktopNoMenu = ["#top-level-buttons-computed"];
    document.body.innerHTML = "";
  });

  test("prefers viewport-intersecting destination controls over a positive-size offscreen sibling in the same root", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        ${controls("stale", "AAAAAAAAAAA")}
        ${controls("current", "BBBBBBBBBBB")}
      </ytd-watch-flexy>`;
    setBox(document.querySelector("#stale"), { x: -10_000 });
    setBox(document.querySelector("#current"), { x: 40 });

    expect(getButtons()).toBe(document.querySelector("#current"));
  });

  test("prefers unowned destination controls over initialized outgoing controls when both overlap in the current root", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        ${controls("stale", "AAAAAAAAAAA")}
        ${controls("current", "BBBBBBBBBBB")}
      </ytd-watch-flexy>`;
    const stale = document.querySelector("#stale");
    const current = document.querySelector("#current");
    setBox(stale, { x: 40 });
    setBox(current, { x: 40 });
    markButtonsForVideo(stale, "AAAAAAAAAAA");

    expect(getButtons()).toBe(current);
  });

  test("falls back to a reused marked control when it is the only current-root candidate", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        ${controls("reused", "AAAAAAAAAAA")}
      </ytd-watch-flexy>`;
    const reused = document.querySelector("#reused");
    setBox(reused, { x: 40 });
    markButtonsForVideo(reused, "AAAAAAAAAAA");

    expect(getButtons()).toBe(reused);
  });

  test("ignores hidden, transparent, and inert stale candidates before current controls", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        <div hidden>${controls("hidden-stale", "AAAAAAAAAAA")}</div>
        <div style="opacity: 0">${controls("transparent-stale", "AAAAAAAAAAA")}</div>
        <div inert>${controls("inert-stale", "AAAAAAAAAAA")}</div>
        ${controls("current", "BBBBBBBBBBB")}
      </ytd-watch-flexy>`;
    ["#hidden-stale", "#transparent-stale", "#inert-stale", "#current"].forEach((selector) =>
      setBox(document.querySelector(selector)),
    );

    expect(getButtons()).toBe(document.querySelector("#current"));
    expect(hasRenderedBox(document.querySelector("#hidden-stale"))).toBe(false);
    expect(hasRenderedBox(document.querySelector("#transparent-stale"))).toBe(false);
    expect(hasRenderedBox(document.querySelector("#inert-stale"))).toBe(false);
  });

  test("does not bind rendered controls owned by an explicit outgoing video root", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="AAAAAAAAAAA">
        ${controls("outgoing", "AAAAAAAAAAA")}
      </ytd-watch-flexy>`;
    setBox(document.querySelector("#outgoing"));

    expect(getButtons()).toBeUndefined();
  });

  test("accepts fixed-position current controls even though they have no offset parent", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        ${controls("current", "BBBBBBBBBBB", 'style="position: fixed"')}
      </ytd-watch-flexy>`;
    const current = document.querySelector("#current");
    setBox(current);

    expect(current.offsetParent).toBeNull();
    expect(hasRenderedBox(current)).toBe(true);
    expect(getButtons()).toBe(current);
  });

  test("uses an offscreen current-root candidate as a fallback when no viewport candidate exists", () => {
    document.body.innerHTML = `
      <ytd-watch-flexy video-id="BBBBBBBBBBB">
        ${controls("current", "BBBBBBBBBBB")}
      </ytd-watch-flexy>`;
    const current = document.querySelector("#current");
    setBox(current, { x: -10_000 });

    expect(hasRenderedBox(current)).toBe(true);
    expect(getButtons()).toBe(current);
  });

  test("scopes segmented reaction controls to the selected destination container", () => {
    const originalSegmentedContainer = extConfig.selectors.buttons.segmentedContainer;
    extConfig.selectors.buttons.segmentedContainer = ["segmented-like-dislike-button-view-model"];
    try {
      document.body.innerHTML = `
        <ytd-watch-flexy video-id="BBBBBBBBBBB">
          ${controls("stale", "AAAAAAAAAAA")}
          ${controls("current", "BBBBBBBBBBB")}
        </ytd-watch-flexy>`;
      setBox(document.querySelector("#stale"), { x: -10_000 });
      setBox(document.querySelector("#current"), { x: 40 });

      const current = document.querySelector("#current");
      expect(getButtons()).toBe(current);
      expect(getLikeButton()).toBe(current.querySelector("like-button-view-model"));
      expect(getDislikeButton()).toBe(current.querySelector("dislike-button-view-model"));
    } finally {
      extConfig.selectors.buttons.segmentedContainer = originalSegmentedContainer;
    }
  });
});
