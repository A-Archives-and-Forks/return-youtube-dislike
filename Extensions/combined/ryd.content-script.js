import { getButtons, getDislikeButton, getLikeButton, hasRenderedBox, markButtonsForVideo } from "./src/buttons";
import {
  hasLoadedStateForVideo,
  initExtConfig,
  isLikesDisabled,
  isShorts,
  restoreCurrentState,
  setInitialState,
} from "./src/state";
import { getBrowser, getVideoId, isVideoLoaded } from "./src/utils";
import { addLikeDislikeEventListener, createSmartimationObserver, storageChangeHandler } from "./src/events";
import { createInitializationCycleRunner } from "./src/initialization-cycle";
import { initPatreonFeatures } from "./src/patreon";

if (__RYD_LIVE_TEST_BUILD__) {
  document.documentElement.setAttribute("data-ryd-extension-version", getBrowser().runtime.getManifest().version);
  document.documentElement.setAttribute("data-ryd-extension-build", __RYD_LIVE_BUILD_ID__);
}

await initExtConfig();
initPatreonFeatures();

let jsInitChecktimer = null;
let isSetInitialStateDone = false;
let isStorageListenerRegistered = false;
let shortsNavigationObserver = null;
let shortsNavigationObserverTarget = null;
let initializedVideoId = null;
let initializedButtons = null;
let initializedLikeButton = null;
let initializedDislikeButton = null;
let initializationCheckRunning = false;

function ensureShortsNavigationObserver() {
  if (!isShorts()) {
    return;
  }

  const shortsRoot = document.querySelector("ytd-shorts");
  if (!shortsRoot) {
    return;
  }

  if (!shortsNavigationObserver) {
    shortsNavigationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "is-active" &&
          mutation.target.tagName === "YTD-REEL-VIDEO-RENDERER" &&
          mutation.target.hasAttribute("is-active")
        ) {
          triggerInitializationCycle();
          break;
        }
      }
    });
  }

  if (shortsNavigationObserverTarget !== shortsRoot) {
    shortsNavigationObserver.disconnect();
    shortsNavigationObserver.observe(shortsRoot, {
      attributes: true,
      subtree: true,
      attributeFilter: ["is-active"],
    });
    shortsNavigationObserverTarget = shortsRoot;
  }
}

async function checkForInitialization() {
  if (initializationCheckRunning) return;
  initializationCheckRunning = true;
  try {
    if (isShorts()) {
      ensureShortsNavigationObserver();
    }

    const buttons = getButtons();
    const videoId = getVideoId(window.location.href);
    if ((isShorts() && isVideoLoaded()) || (hasRenderedBox(buttons) && isVideoLoaded())) {
      if (!buttons) return;
      const likeButton = getLikeButton();
      const dislikeButton = getDislikeButton();
      if (!likeButton || !dislikeButton) return;
      if (jsInitChecktimer !== null) {
        clearInterval(jsInitChecktimer);
        jsInitChecktimer = null;
      }
      markButtonsForVideo(buttons, videoId);
      createSmartimationObserver();
      addLikeDislikeEventListener();
      if (hasLoadedStateForVideo(videoId)) {
        restoreCurrentState();
      } else {
        await setInitialState();
      }
      if (
        videoId !== getVideoId(window.location.href) ||
        buttons !== getButtons() ||
        likeButton !== getLikeButton() ||
        dislikeButton !== getDislikeButton()
      ) {
        return;
      }
      initializedVideoId = videoId;
      initializedButtons = buttons;
      initializedLikeButton = likeButton;
      initializedDislikeButton = dislikeButton;
      isSetInitialStateDone = true;
      if (!isStorageListenerRegistered) {
        getBrowser().storage.onChanged.addListener(storageChangeHandler);
        isStorageListenerRegistered = true;
      }
    }
  } catch (exception) {
    console.warn("Initialization failed; retrying when the current controls are ready.", exception);
  } finally {
    initializationCheckRunning = false;
  }
}

const initializationCycle = createInitializationCycleRunner(async () => {
  isSetInitialStateDone = false;

  if (jsInitChecktimer !== null) {
    clearInterval(jsInitChecktimer);
    jsInitChecktimer = null;
  }

  await checkForInitialization();

  if (!isSetInitialStateDone) {
    jsInitChecktimer = setInterval(() => {
      checkForInitialization();
    }, 111);

    setTimeout(() => {
      if (!isSetInitialStateDone) {
        checkForInitialization();
      }
    }, 2000);
  }
});

function triggerInitializationCycle() {
  return initializationCycle.request();
}

async function setEventListeners() {
  await triggerInitializationCycle();
}

await setEventListeners();

document.addEventListener("yt-navigate-finish", async function (event) {
  await setEventListeners();
});

function watchControlsNeedInitialization() {
  const videoId = getVideoId(window.location.href);
  if (!videoId || initializationCycle.isRunning() || jsInitChecktimer !== null) return false;
  const buttons = getButtons();
  if (!buttons) return true;
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  return (
    initializedVideoId !== videoId ||
    initializedButtons !== buttons ||
    initializedLikeButton !== likeButton ||
    initializedDislikeButton !== dislikeButton ||
    !buttons?.isConnected ||
    !likeButton?.isConnected ||
    !dislikeButton?.isConnected ||
    !buttons?.contains(likeButton) ||
    !buttons?.contains(dislikeButton) ||
    (!isShorts() &&
      hasLoadedStateForVideo(videoId) &&
      !isLikesDisabled() &&
      !buttons.querySelector("#ryd-bar-container"))
  );
}

setInterval(() => {
  if (watchControlsNeedInitialization()) void triggerInitializationCycle();
}, 500);

const s = document.createElement("script");
s.src = chrome.runtime.getURL("menu-fixer.js");
s.onload = function () {
  this.remove();
};

(document.head || document.documentElement).appendChild(s);
