const { expect } = require("@playwright/test");
const { assertInvariantContinuously, waitForStableInvariant } = require("../../e2e/continuous-invariants");
const { VIDEO_A, VIDEO_B } = require("./harness");

const WATCH_SIDEBAR_MATRIX = [
  {
    coverage: {
      destination: "shorts",
      dom: ["preloaded-sibling", "active-reel-switch"],
      origin: "shorts",
      timing: ["settled"],
      trigger: "next-control",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "shorts", videoId: VIDEO_B },
    id: "short-next-short-active-reel",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "shorts", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["retain-hidden-outgoing", "replace-controls", "prune-current-bar"],
      origin: "watch",
      timing: ["finish-before-hydration", "destination-count-gated"],
      trigger: "sidebar-link",
      width: "wide-desktop",
    },
    id: "watch-sidebar-watch-retain-prune",
    destination: {
      counts: { dislikes: 300, likes: 100 },
      kind: "watch",
      videoId: VIDEO_B,
    },
    origin: {
      counts: { dislikes: 100, likes: 300 },
      kind: "watch",
      state: "neutral",
      videoId: VIDEO_A,
    },
    timing: {
      destinationCount: "gated",
      navigateFinish: "before-destination-controls",
    },
    transition: {
      destinationControls: "replace",
      outgoing: "retain-hidden-top-row",
      postInit: "prune-current-rate-bar",
      trigger: "persistent-sidebar-link",
    },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["same-current-root", "reuse-exact-control-nodes", "no-useful-control-mutation"],
      origin: "watch",
      timing: ["navigate-finish", "destination-count-gated"],
      trigger: "sidebar-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-sidebar-watch-same-node-route-complete",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    transition: { controls: "reuse-exact-nodes", nativeControlMutations: "none" },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: [
        "connected-hidden-rate-bar",
        "connected-collapsed-rate-bar",
        "malformed-rate-bar",
        "stripped-rate-bar-wrapper-class",
      ],
      origin: "watch",
      timing: ["same-video", "no-navigation-event"],
      trigger: "dom-corruption",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 100, likes: 300 }, kind: "watch", videoId: VIDEO_A },
    id: "watch-current-rate-bar-connected-corruption",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    transition: {
      corruptions: ["hidden-wrapper", "collapsed-wrapper", "missing-fill", "stripped-wrapper-class"],
    },
    viewport: { height: 720, width: 1280 },
  },
];

const NAVIGATION_MATRIX = [
  ...WATCH_SIDEBAR_MATRIX,
  {
    coverage: {
      destination: "watch",
      dom: ["same-current-root", "hidden-outgoing-first", "rendered-destination-second"],
      origin: "watch",
      timing: ["settled"],
      trigger: "sidebar-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-sidebar-watch-same-root-hidden-first",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    transition: { outgoingPresentation: "hidden" },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["same-current-root", "positive-size-offscreen-outgoing-first", "rendered-destination-second"],
      origin: "watch",
      timing: ["settled"],
      trigger: "sidebar-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-sidebar-watch-same-root-offscreen-first",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    transition: { outgoingPresentation: "offscreen" },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: [
        "same-current-root",
        "hidden-outgoing-first",
        "rendered-destination-second",
        "legacy-segmented-duplicate-ids",
      ],
      origin: "watch",
      timing: ["settled"],
      trigger: "sidebar-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-sidebar-watch-legacy-segmented-duplicate-ids",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    transition: { controlMarkup: "legacy-segmented", outgoingPresentation: "hidden" },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["replace-controls"],
      origin: "watch",
      timing: ["settled"],
      trigger: "history-back-forward",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-history-back-forward-replace",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["replace-page-and-controls"],
      origin: "watch",
      timing: ["no-navigate-finish"],
      trigger: "autoplay-ended",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "watch-autoplay-watch-replace-no-finish",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "shorts",
      dom: ["replace-page-and-controls", "delayed-hydration"],
      origin: "watch",
      timing: ["finish-before-hydration"],
      trigger: "direct-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "shorts", videoId: VIDEO_B },
    id: "watch-direct-short-delayed",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["replace-page-and-controls", "delayed-hydration"],
      origin: "shorts",
      timing: ["finish-before-hydration"],
      trigger: "direct-link",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 300, likes: 100 }, kind: "watch", videoId: VIDEO_B },
    id: "short-direct-watch-delayed",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "shorts", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
  {
    coverage: {
      destination: "watch",
      dom: ["replace-current-action-container"],
      origin: "watch",
      timing: ["same-video", "no-navigation-event"],
      trigger: "dom-replacement",
      width: "wide-desktop",
    },
    destination: { counts: { dislikes: 100, likes: 300 }, kind: "watch", videoId: VIDEO_A },
    id: "watch-current-action-container-replace",
    origin: { counts: { dislikes: 100, likes: 300 }, kind: "watch", state: "neutral", videoId: VIDEO_A },
    viewport: { height: 720, width: 1280 },
  },
];

const USERSCRIPT_MATRIX_RUNTIME = {
  name: "userscript",
  selectors: {
    bar: "#return-youtube-dislike-bar",
    container: "#return-youtube-dislike-bar-container",
    tooltip: "#ryd-dislike-tooltip",
    wrapper: ".ryd-tooltip",
    shortsDislike: "[data-ryd-synthetic-shorts-dislike]",
    shortsVideoAttribute: "data-ryd-video-id",
  },
  tooltipText({ dislikes, likes }) {
    return `${likes} / ${dislikes}`;
  },
};

async function installSidebarRetainPruneFixture(context, scenario) {
  await context.addInitScript((matrixScenario) => {
    if (!location.hostname.endsWith("youtube.com")) return;

    addEventListener(
      "DOMContentLoaded",
      () => {
        if (new URL(location.href).searchParams.get("rydNavigationFixture") !== "1") return;

        const fixturePage = document.getElementById("fixture-page");
        if (!fixturePage || !globalThis.__navigationFixture) {
          throw new Error("The navigation matrix requires the navigation-page fixture.");
        }

        const retainedTrees = document.createElement("div");
        retainedTrees.hidden = true;
        retainedTrees.id = "fixture-matrix-retained-trees";
        // Keep the retained outgoing tree before the live page in document
        // order. This reproduces YouTube variants where a first-match query
        // resolves stale connected controls before the current rendered tree.
        fixturePage.before(retainedTrees);

        const sidebar = document.createElement("aside");
        sidebar.id = "fixture-matrix-sidebar";
        sidebar.setAttribute("aria-label", "Fixture sidebar");
        const destinationLink = document.createElement("a");
        destinationLink.id = "fixture-matrix-sidebar-watch";
        destinationLink.href = `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`;
        destinationLink.textContent = "Open sidebar video";
        sidebar.appendChild(destinationLink);
        fixturePage.before(sidebar);

        const transition = {
          destinationTopRow: null,
          documentIdentity: `matrix-${Date.now()}-${Math.random()}`,
          phase: "origin",
          timeline: [],
        };
        const record = (phase) => {
          transition.phase = phase;
          transition.timeline.push(phase);
        };

        destinationLink.addEventListener("click", (event) => {
          event.preventDefault();
          if (transition.phase !== "origin") throw new Error(`Cannot navigate from matrix phase ${transition.phase}.`);

          const watchPage = fixturePage.querySelector('[data-fixture-page-kind="watch"]');
          const outgoingTopRow = watchPage?.querySelector("#top-row");
          const watchFlexy = watchPage?.querySelector("ytd-watch-flexy");
          if (!watchPage || !outgoingTopRow || !watchFlexy) {
            throw new Error("The origin watch fixture is incomplete.");
          }

          const destinationTopRow = outgoingTopRow.cloneNode(true);
          destinationTopRow.removeAttribute("style");
          destinationTopRow.querySelectorAll(".ryd-tooltip").forEach((element) => element.remove());
          const destinationControls = destinationTopRow.querySelector("[data-fixture-control-video-id]");
          destinationControls.setAttribute("data-fixture-control-video-id", matrixScenario.destination.videoId);
          for (const role of ["like", "dislike"]) {
            const control = destinationControls.querySelector(`[data-ryd-role="${role}"]`);
            control.classList.remove("style-default-active");
            control.classList.add("style-text");
            control.querySelector("button")?.setAttribute("aria-pressed", "false");
          }
          const destinationDislikeText = destinationControls.querySelector('[data-ryd-role="dislike"] #text');
          destinationDislikeText.textContent = "";
          transition.destinationTopRow = destinationTopRow;

          document.dispatchEvent(new Event("yt-navigate-start", { bubbles: true }));
          record("navigate-start");

          retainedTrees.appendChild(outgoingTopRow);
          history.pushState({}, "", `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`);
          watchPage.setAttribute("data-fixture-video-id", matrixScenario.destination.videoId);
          watchFlexy.setAttribute("video-id", matrixScenario.destination.videoId);
          record("route-and-shell");

          document.dispatchEvent(new Event("yt-navigate-finish", { bubbles: true }));
          record("navigate-finish");
        });

        globalThis.__navigationMatrixFixture = {
          detachOutgoing() {
            retainedTrees.replaceChildren();
            record("detach-outgoing");
          },
          hydrateDestination() {
            if (transition.phase !== "navigate-finish" || !transition.destinationTopRow) {
              throw new Error(`Cannot hydrate the destination from matrix phase ${transition.phase}.`);
            }
            const watchPage = fixturePage.querySelector('[data-fixture-page-kind="watch"]');
            const firstNavigationLink = watchPage?.querySelector("a[data-fixture-page-kind]");
            watchPage.insertBefore(transition.destinationTopRow, firstNavigationLink ?? null);
            transition.destinationTopRow = null;
            record("hydrate-destination-controls");
          },
          snapshot() {
            return {
              currentControls: fixturePage.querySelectorAll("[data-fixture-control-video-id]").length,
              documentIdentity: transition.documentIdentity,
              phase: transition.phase,
              retainedControls: retainedTrees.querySelectorAll("[data-fixture-control-video-id]").length,
              retainedTreesConnected: retainedTrees.isConnected,
              retainedTreesHidden: retainedTrees.hidden,
              sidebarConnected: sidebar.isConnected,
              timeline: [...transition.timeline],
            };
          },
        };
      },
      { once: true },
    );
  }, scenario);
}

async function installSameRootHiddenFirstFixture(context, scenario) {
  await context.addInitScript((matrixScenario) => {
    if (!location.hostname.endsWith("youtube.com")) return;

    addEventListener(
      "DOMContentLoaded",
      () => {
        if (new URL(location.href).searchParams.get("rydNavigationFixture") !== "1") return;

        const fixturePage = document.getElementById("fixture-page");
        const watchPage = fixturePage?.querySelector('[data-fixture-page-kind="watch"]');
        const watchFlexy = watchPage?.querySelector("ytd-watch-flexy");
        const originTopRow = watchPage?.querySelector("#top-row");
        if (!fixturePage || !watchPage || !watchFlexy || !originTopRow) {
          throw new Error("The same-root matrix requires a complete watch fixture.");
        }
        if (matrixScenario.transition?.controlMarkup === "legacy-segmented") {
          const modernSegmented = originTopRow.querySelector("segmented-like-dislike-button-view-model");
          if (!modernSegmented) {
            throw new Error("The legacy segmented matrix could not find its source controls.");
          }
          const legacySegmented = document.createElement("ytd-segmented-like-dislike-button-renderer");
          for (const attribute of modernSegmented.attributes) {
            legacySegmented.setAttribute(attribute.name, attribute.value);
          }
          legacySegmented.style.cssText = "display:flex;gap:8px;min-height:48px;width:320px";
          while (modernSegmented.firstChild) {
            legacySegmented.appendChild(modernSegmented.firstChild);
          }
          const legacyLike = legacySegmented.querySelector('[data-ryd-role="like"]');
          const legacyDislike = legacySegmented.querySelector('[data-ryd-role="dislike"]');
          legacyLike.id = "segmented-like-button";
          legacyDislike.id = "segmented-dislike-button";
          for (const button of legacySegmented.querySelectorAll("button")) {
            button.style.cssText = "min-height:36px;min-width:96px";
          }
          modernSegmented.replaceWith(legacySegmented);
        }
        watchFlexy.appendChild(originTopRow);

        const sidebar = document.createElement("aside");
        sidebar.id = "fixture-matrix-same-root-sidebar";
        sidebar.setAttribute("aria-label", "Fixture same-root sidebar");
        const destinationLink = document.createElement("a");
        destinationLink.id = "fixture-matrix-same-root-watch";
        destinationLink.href = `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`;
        destinationLink.textContent = "Open same-root sidebar video";
        sidebar.appendChild(destinationLink);
        fixturePage.before(sidebar);

        const documentIdentity = `matrix-${Date.now()}-${Math.random()}`;
        destinationLink.addEventListener("click", (event) => {
          event.preventDefault();
          const outgoingTopRow = watchFlexy.querySelector("#top-row");
          if (!outgoingTopRow || outgoingTopRow.hasAttribute("data-fixture-matrix-hidden-outgoing")) {
            throw new Error("The same-root matrix origin is unavailable.");
          }

          const destinationTopRow = outgoingTopRow.cloneNode(true);
          destinationTopRow.removeAttribute("style");
          destinationTopRow.querySelectorAll(".ryd-tooltip").forEach((element) => element.remove());
          const destinationControls = destinationTopRow.querySelector("[data-fixture-control-video-id]");
          destinationControls.setAttribute("data-fixture-control-video-id", matrixScenario.destination.videoId);
          for (const role of ["like", "dislike"]) {
            const control = destinationControls.querySelector(`[data-ryd-role="${role}"]`);
            control.classList.remove("style-default-active");
            control.classList.add("style-text");
            control.querySelector("button")?.setAttribute("aria-pressed", "false");
          }
          destinationControls.querySelector('[data-ryd-role="dislike"] #text').textContent = "";
          destinationTopRow.setAttribute("data-fixture-matrix-live-destination", "true");

          document.dispatchEvent(new Event("yt-navigate-start", { bubbles: true }));
          if (matrixScenario.transition?.outgoingPresentation === "offscreen") {
            outgoingTopRow.style.setProperty("left", "-10000px", "important");
            outgoingTopRow.style.setProperty("position", "fixed", "important");
            outgoingTopRow.style.setProperty("top", "0", "important");
          } else {
            outgoingTopRow.hidden = true;
          }
          outgoingTopRow.setAttribute("data-fixture-matrix-hidden-outgoing", "true");
          history.pushState({}, "", `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`);
          watchPage.setAttribute("data-fixture-video-id", matrixScenario.destination.videoId);
          watchFlexy.setAttribute("video-id", matrixScenario.destination.videoId);
          watchFlexy.appendChild(destinationTopRow);
          document.dispatchEvent(new Event("yt-navigate-finish", { bubbles: true }));
        });

        globalThis.__navigationMatrixSameRootFixture = {
          detachOutgoing() {
            watchFlexy.querySelector('[data-fixture-matrix-hidden-outgoing="true"]')?.remove();
          },
          snapshot() {
            const hiddenOutgoing = watchFlexy.querySelector('[data-fixture-matrix-hidden-outgoing="true"]');
            const liveDestination = watchFlexy.querySelector('[data-fixture-matrix-live-destination="true"]');
            const hiddenBox = hiddenOutgoing?.getBoundingClientRect();
            return {
              documentIdentity,
              hiddenFirst: Boolean(
                hiddenOutgoing &&
                  liveDestination &&
                  hiddenOutgoing.compareDocumentPosition(liveDestination) & Node.DOCUMENT_POSITION_FOLLOWING,
              ),
              hiddenOutgoingConnected: Boolean(hiddenOutgoing?.isConnected),
              hiddenOutgoingHeight: hiddenBox?.height ?? null,
              hiddenOutgoingWidth: hiddenBox?.width ?? null,
              outgoingIntersectsViewport: Boolean(
                hiddenBox &&
                  hiddenBox.width > 0 &&
                  hiddenBox.height > 0 &&
                  hiddenBox.bottom > 0 &&
                  hiddenBox.right > 0 &&
                  hiddenBox.top < innerHeight &&
                  hiddenBox.left < innerWidth,
              ),
              outgoingPresentation: matrixScenario.transition?.outgoingPresentation ?? "hidden",
              liveDestinationConnected: Boolean(liveDestination?.isConnected),
              rootVideoId: watchFlexy.getAttribute("video-id"),
              sameRoot: Boolean(
                hiddenOutgoing &&
                  liveDestination &&
                  hiddenOutgoing.closest("ytd-watch-flexy") === liveDestination.closest("ytd-watch-flexy"),
              ),
              sidebarConnected: sidebar.isConnected,
            };
          },
        };
      },
      { once: true },
    );
  }, scenario);
}

async function installSameNodeRouteCompletionFixture(context, scenario) {
  await context.addInitScript((matrixScenario) => {
    if (!location.hostname.endsWith("youtube.com")) return;

    addEventListener(
      "DOMContentLoaded",
      () => {
        if (new URL(location.href).searchParams.get("rydNavigationFixture") !== "1") return;

        const fixturePage = document.getElementById("fixture-page");
        const watchPage = fixturePage?.querySelector('[data-fixture-page-kind="watch"]');
        const watchFlexy = watchPage?.querySelector("ytd-watch-flexy");
        const topRow = watchPage?.querySelector("#top-row");
        const buttons = topRow?.querySelector("#top-level-buttons-computed");
        const controls = buttons?.querySelector("[data-fixture-control-video-id]");
        const like = controls?.querySelector('[data-ryd-role="like"]');
        const dislike = controls?.querySelector('[data-ryd-role="dislike"]');
        if (!fixturePage || !watchPage || !watchFlexy || !topRow || !buttons || !controls || !like || !dislike) {
          throw new Error("The same-node matrix requires a complete watch fixture.");
        }
        watchFlexy.appendChild(topRow);

        const sidebar = document.createElement("aside");
        sidebar.id = "fixture-matrix-same-node-sidebar";
        sidebar.setAttribute("aria-label", "Fixture same-node sidebar");
        const destinationLink = document.createElement("a");
        destinationLink.id = "fixture-matrix-same-node-watch";
        destinationLink.href = `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`;
        destinationLink.textContent = "Open same-node sidebar video";
        sidebar.appendChild(destinationLink);
        fixturePage.before(sidebar);

        const documentIdentity = `matrix-${Date.now()}-${Math.random()}`;
        const timeline = [];
        destinationLink.addEventListener("click", (event) => {
          event.preventDefault();
          document.dispatchEvent(new Event("yt-navigate-start", { bubbles: true }));
          timeline.push("navigate-start");

          history.pushState({}, "", `/watch?v=${matrixScenario.destination.videoId}&rydNavigationFixture=1`);
          watchPage.setAttribute("data-fixture-video-id", matrixScenario.destination.videoId);
          watchFlexy.setAttribute("video-id", matrixScenario.destination.videoId);
          // This fixture-only marker lets the test address B. It is deliberately
          // outside the userscript observer's attribute filter and provides no
          // runtime ownership evidence.
          controls.setAttribute("data-fixture-control-video-id", matrixScenario.destination.videoId);
          timeline.push("route-and-root-only");

          document.dispatchEvent(new Event("yt-navigate-finish", { bubbles: true }));
          timeline.push("navigate-finish");
        });

        globalThis.__navigationMatrixSameNodeFixture = {
          snapshot() {
            return {
              buttonsReused: buttons === watchFlexy.querySelector("#top-level-buttons-computed"),
              controlsReused: controls === watchFlexy.querySelector("[data-fixture-control-video-id]"),
              dislikeReused: dislike === watchFlexy.querySelector('[data-ryd-role="dislike"]'),
              documentIdentity,
              likeReused: like === watchFlexy.querySelector('[data-ryd-role="like"]'),
              rootVideoId: watchFlexy.getAttribute("video-id"),
              sidebarConnected: sidebar.isConnected,
              timeline: [...timeline],
            };
          },
        };
      },
      { once: true },
    );
  }, scenario);
}

async function installStandardNavigationMatrixFixture(context, scenario) {
  await context.addInitScript((matrixScenario) => {
    if (!location.hostname.endsWith("youtube.com")) return;

    addEventListener(
      "DOMContentLoaded",
      () => {
        if (new URL(location.href).searchParams.get("rydNavigationFixture") !== "1") return;

        const fixturePage = document.getElementById("fixture-page");
        if (!fixturePage || !globalThis.__navigationFixture) {
          throw new Error("The navigation matrix requires the navigation-page fixture.");
        }

        const probe = {
          documentIdentity: `matrix-${Date.now()}-${Math.random()}`,
          historyRenders: [],
          navigateFinishes: 0,
          navigateStarts: 0,
        };
        document.addEventListener("yt-navigate-start", () => {
          probe.navigateStarts += 1;
        });
        document.addEventListener("yt-navigate-finish", () => {
          probe.navigateFinishes += 1;
        });

        const delayedLinkId = {
          "short-direct-watch-delayed": "short-to-watch",
          "watch-direct-short-delayed": "watch-to-short",
        }[matrixScenario.id];
        if (delayedLinkId) {
          document.getElementById(delayedLinkId)?.setAttribute("data-fixture-control-delay", "600");
        }

        if (matrixScenario.id === "watch-history-back-forward-replace") {
          addEventListener("popstate", () => {
            const videoId = new URL(location.href).searchParams.get("v");
            const watchPage = fixturePage.querySelector('[data-fixture-page-kind="watch"]');
            const currentTopRow = watchPage?.querySelector("#top-row");
            const watchFlexy = watchPage?.querySelector("ytd-watch-flexy");
            if (!videoId || !watchPage || !currentTopRow || !watchFlexy) {
              throw new Error("The history matrix could not render the current watch entry.");
            }

            const replacementTopRow = currentTopRow.cloneNode(true);
            replacementTopRow.removeAttribute("style");
            replacementTopRow.querySelectorAll(".ryd-tooltip").forEach((element) => element.remove());
            const controls = replacementTopRow.querySelector("[data-fixture-control-video-id]");
            controls.setAttribute("data-fixture-control-video-id", videoId);
            for (const role of ["like", "dislike"]) {
              const control = controls.querySelector(`[data-ryd-role="${role}"]`);
              control.classList.remove("style-default-active");
              control.classList.add("style-text");
              control.querySelector("button")?.setAttribute("aria-pressed", "false");
            }
            controls.querySelector('[data-ryd-role="dislike"] #text').textContent = "";
            currentTopRow.replaceWith(replacementTopRow);
            watchPage.setAttribute("data-fixture-video-id", videoId);
            watchFlexy.setAttribute("video-id", videoId);
            probe.historyRenders.push(videoId);
            document.dispatchEvent(new Event("yt-navigate-finish", { bubbles: true }));
          });
        }

        globalThis.__navigationMatrixProbe = {
          snapshot() {
            return {
              currentKind:
                fixturePage.querySelector("[data-fixture-page-kind]")?.getAttribute("data-fixture-page-kind") ?? null,
              currentVideoId:
                fixturePage.querySelector("[data-fixture-video-id]")?.getAttribute("data-fixture-video-id") ?? null,
              documentIdentity: probe.documentIdentity,
              historyRenders: [...probe.historyRenders],
              navigateFinishes: probe.navigateFinishes,
              navigateStarts: probe.navigateStarts,
              transitionPending: fixturePage.dataset.fixtureTransitionPending ?? null,
            };
          },
        };
      },
      { once: true },
    );
  }, scenario);
}

async function installNavigationMatrixFixture(context, scenario) {
  if (!NAVIGATION_MATRIX.some((candidate) => candidate.id === scenario.id)) {
    throw new Error(`No navigation matrix fixture is registered for ${scenario.id}.`);
  }
  if (scenario.id === "watch-sidebar-watch-retain-prune") {
    await installSidebarRetainPruneFixture(context, scenario);
    return;
  }
  if (
    scenario.id === "watch-sidebar-watch-same-root-hidden-first" ||
    scenario.id === "watch-sidebar-watch-same-root-offscreen-first" ||
    scenario.id === "watch-sidebar-watch-legacy-segmented-duplicate-ids"
  ) {
    await installSameRootHiddenFirstFixture(context, scenario);
    return;
  }
  if (scenario.id === "watch-sidebar-watch-same-node-route-complete") {
    await installSameNodeRouteCompletionFixture(context, scenario);
    return;
  }
  await installStandardNavigationMatrixFixture(context, scenario);
}

function currentWatchLocators(page, runtime, videoId) {
  const controls = page.locator(`[data-fixture-control-video-id="${videoId}"]`);
  const reactionRegion = controls.locator("xpath=..");
  const wrapper = reactionRegion.locator(`:scope > ${runtime.selectors.wrapper}`);
  const container = wrapper.locator(runtime.selectors.container);
  return {
    bar: container.locator(runtime.selectors.bar),
    container,
    controls,
    reactionRegion,
    tooltip: wrapper.locator(runtime.selectors.tooltip),
    wrapper,
  };
}

async function expectOwnedWatchBar(page, runtime, videoId, counts) {
  const locators = currentWatchLocators(page, runtime, videoId);
  await expect(locators.controls).toHaveCount(1);
  await expect(locators.controls.locator('[data-ryd-role="dislike"] #text')).toHaveText(String(counts.dislikes));
  await expect(locators.wrapper).toHaveCount(1);
  await expect(locators.wrapper).toBeVisible();
  await expect(locators.container).toBeVisible();
  await expect(locators.bar).toBeVisible();
  await expect(locators.tooltip).toContainText(runtime.tooltipText(counts));
  await expect(page.locator(runtime.selectors.wrapper)).toHaveCount(1);
  await expect(page.locator(runtime.selectors.container)).toHaveCount(1);
  await expect(page.locator(runtime.selectors.bar)).toHaveCount(1);
  await expect(page.locator(runtime.selectors.tooltip)).toHaveCount(1);

  const geometry = await locators.reactionRegion.evaluate((reactionRegion, selectors) => {
    const box = (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        width: bounds.width,
      };
    };
    const like = reactionRegion.querySelector('[data-ryd-role="like"] button');
    const dislike = reactionRegion.querySelector('[data-ryd-role="dislike"] button');
    const wrapper = reactionRegion.querySelector(`:scope > ${selectors.wrapper}`);
    const container = wrapper.querySelector(selectors.container);
    const bar = container.querySelector(selectors.bar);
    return {
      bar: box(bar),
      container: box(container),
      dislike: box(dislike),
      like: box(like),
      wrapper: box(wrapper),
    };
  }, runtime.selectors);
  expect(geometry.wrapper.width).toBeCloseTo(geometry.like.width + geometry.dislike.width, 0);
  expect(geometry.container.top).toBeGreaterThanOrEqual(Math.max(geometry.like.bottom, geometry.dislike.bottom) - 1);
  expect(geometry.bar.left).toBeGreaterThanOrEqual(geometry.container.left - 1);
  expect(geometry.bar.right).toBeLessThanOrEqual(geometry.container.right + 1);
  expect(geometry.bar.width / geometry.container.width).toBeCloseTo(counts.likes / (counts.likes + counts.dislikes), 2);
  return locators;
}

async function expectOwnedShortControl(page, runtime, videoId, counts) {
  await expect(page).toHaveURL((url) => url.pathname === `/shorts/${videoId}`);
  const activeRenderer = page.locator(`ytd-reel-video-renderer[video-id="${videoId}"][is-active]`);
  const dislike = activeRenderer.locator(runtime.selectors.shortsDislike);
  await expect(activeRenderer).toHaveCount(1);
  await expect(activeRenderer).toBeVisible();
  await expect(dislike).toHaveCount(1);
  await expect(dislike).toBeVisible();
  await expect(dislike.locator("#text")).toHaveText(String(counts.dislikes));
  if (runtime.selectors.shortsVideoAttribute) {
    await expect(dislike).toHaveAttribute(runtime.selectors.shortsVideoAttribute, videoId);
  }
  await expect(page.locator(`${runtime.selectors.shortsDislike}:visible`)).toHaveCount(1);
  await expect(page.locator(runtime.selectors.wrapper)).toHaveCount(0);
  await expect(page.locator(runtime.selectors.container)).toHaveCount(0);
  await expect(page.locator(runtime.selectors.bar)).toHaveCount(0);
  return { activeRenderer, dislike };
}

async function readOwnedSurfaceInvariant(page, runtime, videoId, counts, kind) {
  return page.evaluate(
    ({ counts: expectedCounts, expectedTooltip, kind: expectedKind, selectors, videoId: expectedVideoId }) => {
      const visible = (element) => {
        if (!element?.isConnected || element.closest("[hidden], [aria-hidden='true']")) return false;
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && bounds.width > 0 && bounds.height > 0;
      };
      const currentUrl = new URL(location.href);
      const common = {
        bars: document.querySelectorAll(selectors.bar).length,
        containers: document.querySelectorAll(selectors.container).length,
        pathname: currentUrl.pathname,
        tooltips: document.querySelectorAll(selectors.tooltip).length,
        wrappers: document.querySelectorAll(selectors.wrapper).length,
      };

      if (expectedKind === "shorts") {
        const activeRenderers = Array.from(
          document.querySelectorAll(`ytd-reel-video-renderer[video-id="${expectedVideoId}"][is-active]`),
        );
        const currentControls = activeRenderers.flatMap((renderer) =>
          Array.from(renderer.querySelectorAll(selectors.shortsDislike)),
        );
        const currentActionButtons = activeRenderers.flatMap((renderer) =>
          Array.from(renderer.querySelectorAll("reel-action-bar-view-model button")).filter(visible),
        );
        const visibleControls = Array.from(document.querySelectorAll(selectors.shortsDislike)).filter(visible);
        return {
          ...common,
          activeRenderers: activeRenderers.length,
          count: currentControls[0]?.querySelector("#text")?.textContent?.trim() ?? null,
          currentActionButtons: currentActionButtons.length,
          currentControls: currentControls.length,
          currentVisible: currentControls.length === 1 && visible(currentControls[0]),
          expectedCount: String(expectedCounts.dislikes),
          expectedPathname: `/shorts/${expectedVideoId}`,
          kind: expectedKind,
          visibleControls: visibleControls.length,
        };
      }

      const controls = Array.from(document.querySelectorAll(`[data-fixture-control-video-id="${expectedVideoId}"]`));
      const currentControls = controls.filter(visible);
      const reactionRegion = currentControls[0]?.parentElement ?? null;
      const wrapper = reactionRegion?.querySelector(`:scope > ${selectors.wrapper}`) ?? null;
      const container = wrapper?.querySelector(selectors.container) ?? null;
      const bar = container?.querySelector(selectors.bar) ?? null;
      const containerBounds = container?.getBoundingClientRect();
      const barBounds = bar?.getBoundingClientRect();
      return {
        ...common,
        count: currentControls[0]?.querySelector('[data-ryd-role="dislike"] #text')?.textContent?.trim() ?? null,
        currentControls: currentControls.length,
        expectedCount: String(expectedCounts.dislikes),
        expectedPathname: "/watch",
        expectedRatio: expectedCounts.likes / (expectedCounts.likes + expectedCounts.dislikes),
        expectedTooltip,
        expectedVideoId,
        kind: expectedKind,
        ownerBarVisible: visible(bar),
        ownerContainerVisible: visible(container),
        ownerTooltip: wrapper?.querySelector(selectors.tooltip)?.textContent?.replace(/\s+/g, " ").trim() ?? null,
        ownerWrapperVisible: visible(wrapper),
        ratio: containerBounds?.width > 0 && barBounds ? barBounds.width / containerBounds.width : null,
        videoId: currentUrl.searchParams.get("v"),
      };
    },
    { counts, expectedTooltip: runtime.tooltipText(counts), kind, selectors: runtime.selectors, videoId },
  );
}

function ownedSurfaceInvariantIsValid(sample) {
  if (sample.pathname !== sample.expectedPathname || sample.count !== sample.expectedCount) return false;
  if (sample.kind === "shorts") {
    return (
      sample.activeRenderers === 1 &&
      sample.currentControls === 1 &&
      sample.currentActionButtons >= 4 &&
      sample.currentVisible &&
      sample.visibleControls === 1 &&
      sample.wrappers === 0 &&
      sample.containers === 0 &&
      sample.bars === 0
    );
  }
  return (
    sample.videoId === sample.expectedVideoId &&
    sample.currentControls === 1 &&
    sample.wrappers === 1 &&
    sample.containers === 1 &&
    sample.bars === 1 &&
    sample.tooltips === 1 &&
    sample.ownerWrapperVisible &&
    sample.ownerContainerVisible &&
    sample.ownerBarVisible &&
    sample.ownerTooltip?.includes(sample.expectedTooltip) &&
    Math.abs(sample.ratio - sample.expectedRatio) <= 0.015
  );
}

async function waitForOwnedSurfaceStability(page, runtime, surface, timing = {}) {
  return waitForStableInvariant({
    intervalMs: 25,
    isValid: ownedSurfaceInvariantIsValid,
    label: `${runtime.name} ${surface.kind} ${surface.videoId} ownership`,
    read: () => readOwnedSurfaceInvariant(page, runtime, surface.videoId, surface.counts, surface.kind),
    stableForMs: timing.stableForMs ?? 250,
    timeoutMs: timing.timeoutMs ?? 2_000,
  });
}

async function waitForOwnedSurfaceWithinBudget(page, runtime, surface, maxFirstValidMs = 1_000) {
  const readiness = await waitForOwnedSurfaceStability(page, runtime, surface, {
    stableForMs: 250,
    timeoutMs: maxFirstValidMs + 500,
  });
  expect(readiness.firstValidMs).toBeLessThanOrEqual(maxFirstValidMs);
  return readiness;
}

async function assertOwnedSurfaceContinuously(page, runtime, surface, durationMs = 600) {
  return assertInvariantContinuously({
    durationMs,
    intervalMs: 25,
    isValid: ownedSurfaceInvariantIsValid,
    label: `${runtime.name} settled ${surface.kind} ${surface.videoId}`,
    read: () => readOwnedSurfaceInvariant(page, runtime, surface.videoId, surface.counts, surface.kind),
  });
}

function expectCountRequestVideoIds(backend, expectedVideoIds) {
  expect(backend.requestsFor("GET", "/votes").map((request) => request.query.videoId)).toEqual(expectedVideoIds);
}

async function readStandardProbe(page) {
  return page.evaluate(() => globalThis.__navigationMatrixProbe.snapshot());
}

async function pruneCurrentWatchBar(page, runtime, locators, surface) {
  await locators.reactionRegion.evaluate((reactionRegion, wrapperSelector) => {
    const stats = { addedWrappers: 0, removedWrappers: 0 };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.matches(wrapperSelector)) stats.addedWrappers += 1;
        }
        for (const node of mutation.removedNodes) {
          if (node instanceof Element && node.matches(wrapperSelector)) stats.removedWrappers += 1;
        }
      }
    });
    observer.observe(reactionRegion, { childList: true });
    globalThis.__navigationMatrixBarObserver = observer;
    globalThis.__navigationMatrixBarStats = stats;

    const wrapper = reactionRegion.querySelector(`:scope > ${wrapperSelector}`);
    if (!wrapper) throw new Error("The current matrix reaction tree has no owned rate bar to prune.");
    wrapper.remove();
  }, runtime.selectors.wrapper);

  await waitForOwnedSurfaceWithinBudget(page, runtime, surface);
  await assertOwnedSurfaceContinuously(page, runtime, surface);
  return page.evaluate(() => {
    globalThis.__navigationMatrixBarObserver.disconnect();
    return globalThis.__navigationMatrixBarStats;
  });
}

async function runWatchSidebarRetainPruneScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialDocumentIdentity = await page.evaluate(
    () => globalThis.__navigationMatrixFixture.snapshot().documentIdentity,
  );
  await expect(page).toHaveURL((url) => url.pathname === "/watch" && url.searchParams.get("v") === origin.videoId);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expect(backend.requestsFor("GET", "/votes").map((request) => request.query.videoId)).toEqual([origin.videoId]);

  const destinationCountGate = backend.defer("GET", "/votes");
  await page.locator("#fixture-matrix-sidebar-watch").click();

  await expect(page).toHaveURL((url) => url.pathname === "/watch" && url.searchParams.get("v") === destination.videoId);
  expect(await page.evaluate(() => globalThis.__navigationMatrixFixture.snapshot())).toEqual({
    currentControls: 0,
    documentIdentity: initialDocumentIdentity,
    phase: "navigate-finish",
    retainedControls: 1,
    retainedTreesConnected: true,
    retainedTreesHidden: true,
    sidebarConnected: true,
    timeline: ["navigate-start", "route-and-shell", "navigate-finish"],
  });
  await expect(page.locator("#fixture-matrix-retained-trees").locator(runtime.selectors.wrapper)).toHaveCount(1);
  expect(backend.requestsFor("GET", "/votes").map((request) => request.query.videoId)).toEqual([origin.videoId]);

  await page.evaluate(() => globalThis.__navigationMatrixFixture.hydrateDestination());
  const destinationRequest = await destinationCountGate.seen;
  try {
    expect(destinationRequest.query.videoId).toBe(destination.videoId);
    expect(await page.evaluate(() => globalThis.__navigationMatrixFixture.snapshot())).toMatchObject({
      currentControls: 1,
      documentIdentity: initialDocumentIdentity,
      phase: "hydrate-destination-controls",
      retainedControls: 1,
      retainedTreesConnected: true,
      retainedTreesHidden: true,
      sidebarConnected: true,
      timeline: ["navigate-start", "route-and-shell", "navigate-finish", "hydrate-destination-controls"],
    });
    const gatedDestination = currentWatchLocators(page, runtime, destination.videoId);
    await expect(gatedDestination.controls).toHaveCount(1);
    await expect(gatedDestination.controls.locator('[data-ryd-role="dislike"] #text')).toHaveText("");
    await expect(gatedDestination.wrapper).toHaveCount(0);
    await expect(page.locator("#fixture-matrix-retained-trees").locator(runtime.selectors.wrapper)).toHaveCount(1);
  } finally {
    if (!destinationCountGate.released) {
      destinationCountGate.release({ body: { ...destination.counts, rating: 4.5 } });
    }
  }

  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  const destinationLocators = await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  await expect(page.locator("#fixture-matrix-retained-trees").locator(runtime.selectors.wrapper)).toHaveCount(0);
  expect(backend.requestsFor("GET", "/votes").map((request) => request.query.videoId)).toEqual([
    origin.videoId,
    destination.videoId,
  ]);

  const pruneStats = await pruneCurrentWatchBar(page, runtime, destinationLocators, destination);
  expect(pruneStats).toEqual({ addedWrappers: 1, removedWrappers: 1 });
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expect(backend.requestsFor("GET", "/votes").map((request) => request.query.videoId)).toEqual([
    origin.videoId,
    destination.videoId,
  ]);

  await page.evaluate(() => globalThis.__navigationMatrixFixture.detachOutgoing());
  await assertOwnedSurfaceContinuously(page, runtime, destination, 550);
  await expect(page.locator("#fixture-matrix-retained-trees").locator("[data-fixture-control-video-id]")).toHaveCount(
    0,
  );
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expect(await page.evaluate(() => globalThis.__navigationMatrixFixture.snapshot())).toMatchObject({
    currentControls: 1,
    documentIdentity: initialDocumentIdentity,
    phase: "detach-outgoing",
    retainedControls: 0,
    retainedTreesConnected: true,
    retainedTreesHidden: true,
    sidebarConnected: true,
    timeline: [
      "navigate-start",
      "route-and-shell",
      "navigate-finish",
      "hydrate-destination-controls",
      "detach-outgoing",
    ],
  });

  expect(backend.requestsFor("POST", "/interact/vote")).toHaveLength(0);
  expect(backend.requestsFor("POST", "/interact/confirmVote")).toHaveLength(0);
}

async function runWatchSameRootHiddenFirstScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialDocumentIdentity = await page.evaluate(
    () => globalThis.__navigationMatrixSameRootFixture.snapshot().documentIdentity,
  );
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await page.locator("#fixture-matrix-same-root-watch").click();

  await expect(page).toHaveURL((url) => url.pathname === "/watch" && url.searchParams.get("v") === destination.videoId);
  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  const outgoingIsOffscreen = scenario.transition.outgoingPresentation === "offscreen";
  const settledTopology = await page.evaluate(() => globalThis.__navigationMatrixSameRootFixture.snapshot());
  expect(settledTopology).toEqual({
    documentIdentity: initialDocumentIdentity,
    hiddenFirst: true,
    hiddenOutgoingConnected: true,
    hiddenOutgoingHeight: outgoingIsOffscreen ? expect.any(Number) : 0,
    hiddenOutgoingWidth: outgoingIsOffscreen ? expect.any(Number) : 0,
    liveDestinationConnected: true,
    outgoingIntersectsViewport: false,
    outgoingPresentation: scenario.transition.outgoingPresentation,
    rootVideoId: destination.videoId,
    sameRoot: true,
    sidebarConnected: true,
  });
  if (outgoingIsOffscreen) {
    expect(settledTopology.hiddenOutgoingHeight).toBeGreaterThan(0);
    expect(settledTopology.hiddenOutgoingWidth).toBeGreaterThan(0);
  }
  const currentRoot = page.locator(`ytd-watch-flexy[video-id="${destination.videoId}"]`);
  await expect(currentRoot.locator("ytd-menu-renderer.ytd-watch-metadata > div")).toHaveCount(2);
  await expect(
    currentRoot.locator('[data-fixture-matrix-hidden-outgoing="true"]').locator(runtime.selectors.wrapper),
  ).toHaveCount(0);
  await expect(
    currentRoot.locator('[data-fixture-matrix-live-destination="true"]').locator(runtime.selectors.wrapper),
  ).toHaveCount(1);
  if (scenario.transition.controlMarkup === "legacy-segmented") {
    await expect(currentRoot.locator("#segmented-like-button")).toHaveCount(2);
    await expect(currentRoot.locator("#segmented-dislike-button")).toHaveCount(2);
    await expect(
      currentRoot.locator('[data-fixture-matrix-live-destination="true"]').locator("#segmented-dislike-button #text"),
    ).toHaveText(String(destination.counts.dislikes));
  }
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);

  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
  expect(await page.evaluate(() => globalThis.__navigationMatrixSameRootFixture.snapshot())).toMatchObject({
    documentIdentity: initialDocumentIdentity,
    hiddenFirst: true,
    hiddenOutgoingConnected: true,
    hiddenOutgoingHeight: outgoingIsOffscreen ? expect.any(Number) : 0,
    hiddenOutgoingWidth: outgoingIsOffscreen ? expect.any(Number) : 0,
    liveDestinationConnected: true,
    outgoingIntersectsViewport: false,
    outgoingPresentation: scenario.transition.outgoingPresentation,
    rootVideoId: destination.videoId,
    sameRoot: true,
    sidebarConnected: true,
  });

  await page.evaluate(() => globalThis.__navigationMatrixSameRootFixture.detachOutgoing());
  await assertOwnedSurfaceContinuously(page, runtime, destination, 550);
  await expect(currentRoot.locator("ytd-menu-renderer.ytd-watch-metadata > div")).toHaveCount(1);
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
}

async function runWatchHistoryScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialProbe = await readStandardProbe(page);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await page.locator("#watch-next").click();
  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: "watch",
    currentVideoId: destination.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [],
    navigateFinishes: 1,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);

  await page.goBack();
  await waitForOwnedSurfaceWithinBudget(page, runtime, origin);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: "watch",
    currentVideoId: origin.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [origin.videoId],
    navigateFinishes: 2,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId, origin.videoId]);

  await page.goForward();
  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: "watch",
    currentVideoId: destination.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [origin.videoId, destination.videoId],
    navigateFinishes: 3,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId, origin.videoId, destination.videoId]);

  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId, origin.videoId, destination.videoId]);
}

async function runWatchAutoplayScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialProbe = await readStandardProbe(page);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await page.evaluate(() => globalThis.__navigationFixture.dispatchEnded());

  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: "watch",
    currentVideoId: destination.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [],
    navigateFinishes: 0,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);

  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
}

async function runCrossSurfaceScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialProbe = await readStandardProbe(page);
  if (origin.kind === "watch") {
    await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  } else {
    await expectOwnedShortControl(page, runtime, origin.videoId, origin.counts);
  }
  expectCountRequestVideoIds(backend, [origin.videoId]);

  const linkId = origin.kind === "watch" ? "watch-to-short" : "short-to-watch";
  await page.locator(`#${linkId}`).click();

  if (destination.kind === "watch") {
    await expect(page).toHaveURL(
      (url) => url.pathname === "/watch" && url.searchParams.get("v") === destination.videoId,
    );
  } else {
    await expect(page).toHaveURL((url) => url.pathname === `/shorts/${destination.videoId}`);
  }
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: origin.kind,
    currentVideoId: origin.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [],
    navigateFinishes: 1,
    navigateStarts: 0,
    transitionPending: destination.kind,
  });
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  if (destination.kind === "watch") {
    await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  } else {
    await expectOwnedShortControl(page, runtime, destination.videoId, destination.counts);
  }
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: destination.kind,
    currentVideoId: destination.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [],
    navigateFinishes: 1,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);

  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
}

async function runWatchActionContainerReplacementScenario({ backend, page, runtime, scenario }) {
  const { origin } = scenario;
  const initialProbe = await readStandardProbe(page);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await page.evaluate((selectors) => {
    const currentActions = document.querySelector(
      '[data-fixture-page-kind="watch"] ytd-menu-renderer.ytd-watch-metadata > div',
    );
    if (!currentActions) throw new Error("The current watch fixture has no action container to replace.");
    const replacement = currentActions.cloneNode(true);
    replacement.setAttribute("data-fixture-matrix-action-replacement", "true");
    replacement.querySelectorAll(selectors.wrapper).forEach((element) => element.remove());
    const controls = replacement.querySelector("[data-fixture-control-video-id]");
    for (const role of ["like", "dislike"]) {
      const control = controls.querySelector(`[data-ryd-role="${role}"]`);
      control.classList.remove("style-default-active");
      control.classList.add("style-text");
      control.querySelector("button")?.setAttribute("aria-pressed", "false");
    }
    controls.querySelector('[data-ryd-role="dislike"] #text').textContent = "";

    const stats = { addedWrappers: 0 };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element && node.matches(selectors.wrapper)) stats.addedWrappers += 1;
        }
      }
    });
    observer.observe(replacement, { childList: true });
    globalThis.__navigationMatrixReplacementObserver = observer;
    globalThis.__navigationMatrixReplacementStats = stats;
    globalThis.__navigationMatrixReplacedActions = currentActions;
    currentActions.replaceWith(replacement);
  }, runtime.selectors);

  await waitForOwnedSurfaceWithinBudget(page, runtime, origin);
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  await expect(page.locator('[data-fixture-matrix-action-replacement="true"]')).toHaveCount(1);
  expect(
    await page.evaluate(() => ({
      oldContainerConnected: globalThis.__navigationMatrixReplacedActions.isConnected,
      probe: globalThis.__navigationMatrixProbe.snapshot(),
    })),
  ).toMatchObject({
    oldContainerConnected: false,
    probe: {
      currentKind: "watch",
      currentVideoId: origin.videoId,
      documentIdentity: initialProbe.documentIdentity,
      historyRenders: [],
      navigateFinishes: 0,
      navigateStarts: 0,
      transitionPending: null,
    },
  });
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await assertOwnedSurfaceContinuously(page, runtime, origin);
  const replacementStats = await page.evaluate(() => {
    globalThis.__navigationMatrixReplacementObserver.disconnect();
    return globalThis.__navigationMatrixReplacementStats;
  });
  expect(replacementStats).toEqual({ addedWrappers: 1 });
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);
}

async function runWatchSameNodeRouteCompletionScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialTopology = await page.evaluate(() => globalThis.__navigationMatrixSameNodeFixture.snapshot());
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  const destinationCountGate = backend.defer("GET", "/votes");
  await page.locator("#fixture-matrix-same-node-watch").click();
  await expect(page).toHaveURL((url) => url.pathname === "/watch" && url.searchParams.get("v") === destination.videoId);

  const destinationRequest = await destinationCountGate.seen;
  expect(destinationRequest.query.videoId).toBe(destination.videoId);
  const pendingDestination = currentWatchLocators(page, runtime, destination.videoId);
  await expect(pendingDestination.controls).toHaveCount(1);
  await expect(pendingDestination.controls.locator('[data-ryd-role="dislike"] #text')).toHaveText("");
  await expect(pendingDestination.wrapper).toHaveCount(0);
  await expect(page.locator(`${runtime.selectors.wrapper}[data-ryd-video-id="${origin.videoId}"]`)).toHaveCount(0);

  destinationCountGate.release({ body: { ...destination.counts, rating: 4.5 } });
  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  const destinationLocators = await expectOwnedWatchBar(page, runtime, destination.videoId, destination.counts);
  await expect(destinationLocators.wrapper).toHaveAttribute("data-ryd-video-id", destination.videoId);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
  expect(await page.evaluate(() => globalThis.__navigationMatrixSameNodeFixture.snapshot())).toEqual({
    buttonsReused: true,
    controlsReused: true,
    dislikeReused: true,
    documentIdentity: initialTopology.documentIdentity,
    likeReused: true,
    rootVideoId: destination.videoId,
    sidebarConnected: true,
    timeline: ["navigate-start", "route-and-root-only", "navigate-finish"],
  });

  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
}

async function runWatchRateBarCorruptionScenario({ backend, page, runtime, scenario }) {
  const { origin } = scenario;
  await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  for (const corruption of scenario.transition.corruptions) {
    const corrupted = await page.evaluate(
      ({ corruption: corruptionKind, selectors }) => {
        const wrapper = document.querySelector(selectors.wrapper);
        const container = wrapper?.querySelector(selectors.container);
        const fill = container?.querySelector(selectors.bar);
        if (!wrapper || !container || !fill) {
          throw new Error(`Cannot apply ${corruptionKind}; the current rate bar is incomplete.`);
        }
        globalThis.__navigationMatrixCorruptedRateBar = wrapper;
        if (corruptionKind === "hidden-wrapper") {
          wrapper.hidden = true;
        } else if (corruptionKind === "collapsed-wrapper") {
          wrapper.style.width = "0px";
          wrapper.style.overflow = "hidden";
        } else if (corruptionKind === "missing-fill") {
          fill.remove();
        } else if (corruptionKind === "stripped-wrapper-class") {
          wrapper.classList.remove("ryd-tooltip");
        } else {
          throw new Error(`Unknown rate-bar corruption ${corruptionKind}.`);
        }
        const bounds = wrapper.getBoundingClientRect();
        return {
          connected: wrapper.isConnected,
          height: bounds.height,
          hidden: wrapper.hidden,
          width: bounds.width,
        };
      },
      { corruption, selectors: runtime.selectors },
    );
    expect(corrupted.connected).toBe(true);
    if (corruption === "hidden-wrapper") {
      expect(corrupted.hidden).toBe(true);
    }
    if (corruption === "collapsed-wrapper") {
      expect(corrupted.width).toBe(0);
    }

    await waitForOwnedSurfaceWithinBudget(page, runtime, origin);
    await expectOwnedWatchBar(page, runtime, origin.videoId, origin.counts);
    expect(await page.evaluate(() => globalThis.__navigationMatrixCorruptedRateBar.isConnected)).toBe(false);
    expectCountRequestVideoIds(backend, [origin.videoId]);
    await assertOwnedSurfaceContinuously(page, runtime, origin, 300);
  }
}

async function runShortNextScenario({ backend, page, runtime, scenario }) {
  const { destination, origin } = scenario;
  const initialProbe = await readStandardProbe(page);
  await expectOwnedShortControl(page, runtime, origin.videoId, origin.counts);
  expectCountRequestVideoIds(backend, [origin.videoId]);

  await page.locator("#short-next").click();
  await waitForOwnedSurfaceWithinBudget(page, runtime, destination);
  await expectOwnedShortControl(page, runtime, destination.videoId, destination.counts);
  expect(await readStandardProbe(page)).toMatchObject({
    currentKind: "shorts",
    currentVideoId: destination.videoId,
    documentIdentity: initialProbe.documentIdentity,
    historyRenders: [],
    navigateFinishes: 1,
    navigateStarts: 0,
    transitionPending: null,
  });
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
  await assertOwnedSurfaceContinuously(page, runtime, destination);
  expectCountRequestVideoIds(backend, [origin.videoId, destination.videoId]);
}

const SCENARIO_RUNNERS = {
  "short-next-short-active-reel": runShortNextScenario,
  "short-direct-watch-delayed": runCrossSurfaceScenario,
  "watch-autoplay-watch-replace-no-finish": runWatchAutoplayScenario,
  "watch-current-action-container-replace": runWatchActionContainerReplacementScenario,
  "watch-current-rate-bar-connected-corruption": runWatchRateBarCorruptionScenario,
  "watch-direct-short-delayed": runCrossSurfaceScenario,
  "watch-history-back-forward-replace": runWatchHistoryScenario,
  "watch-sidebar-watch-retain-prune": runWatchSidebarRetainPruneScenario,
  "watch-sidebar-watch-legacy-segmented-duplicate-ids": runWatchSameRootHiddenFirstScenario,
  "watch-sidebar-watch-same-root-hidden-first": runWatchSameRootHiddenFirstScenario,
  "watch-sidebar-watch-same-root-offscreen-first": runWatchSameRootHiddenFirstScenario,
  "watch-sidebar-watch-same-node-route-complete": runWatchSameNodeRouteCompletionScenario,
};

async function runNavigationMatrixScenario(options) {
  const runner = SCENARIO_RUNNERS[options.scenario.id];
  if (!runner) throw new Error(`No navigation matrix runner is registered for ${options.scenario.id}.`);
  await runner(options);
}

module.exports = {
  NAVIGATION_MATRIX,
  USERSCRIPT_MATRIX_RUNTIME,
  WATCH_SIDEBAR_MATRIX,
  installNavigationMatrixFixture,
  runNavigationMatrixScenario,
};
