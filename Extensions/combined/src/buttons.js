import { isMobile, isShorts, extConfig } from "./state";
import { getVideoId, isInViewport, querySelector, querySelectorAll } from "./utils";

const buttonsVideoOwnership = new WeakMap();

function hasRenderedBox(element) {
  if (!element?.isConnected || element.closest("[hidden], [aria-hidden='true'], [inert]")) {
    return false;
  }
  for (let current = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number.parseFloat(style.opacity) === 0
    ) {
      return false;
    }
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function intersectsViewport(element) {
  const rect = element.getBoundingClientRect();
  const height = innerHeight || document.documentElement.clientHeight;
  const width = innerWidth || document.documentElement.clientWidth;
  return (
    rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width
  );
}

function configuredMatches(selectors) {
  const matches = [];
  for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
    if (selector) matches.push(...document.querySelectorAll(selector));
  }
  return matches;
}

function getDesktopWatchButtonCandidates() {
  return Array.from(
    new Set([
      ...configuredMatches(extConfig.selectors.buttons.regular.desktopMenu),
      ...configuredMatches(extConfig.selectors.buttons.regular.desktopNoMenu),
    ]),
  ).filter((candidate) => {
    const segmented = querySelector(extConfig.selectors.buttons.segmentedContainer, candidate);
    const like = querySelector(extConfig.selectors.buttons.likeButton.notSegmented, candidate);
    return segmented !== undefined || like !== undefined;
  });
}

function markButtonsForVideo(buttons, videoId) {
  if (buttons && videoId) {
    buttonsVideoOwnership.set(buttons, videoId);
  }
}

function getButtonsVideoOwnership(candidate) {
  return (
    buttonsVideoOwnership.get(candidate) ??
    candidate.getAttribute("video-id") ??
    candidate.getAttribute("data-video-id")
  );
}

function selectCurrentWatchButtons(candidates) {
  const videoId = getVideoId(window.location.href);
  const ranked = candidates
    .map((candidate, index) => {
      const watchRoot = candidate.closest("ytd-watch-flexy, ytd-watch-grid");
      const rootVideoId = watchRoot?.getAttribute("video-id");
      const rootMatches = Boolean(videoId && rootVideoId === videoId);
      const rootConflicts = Boolean(videoId && rootVideoId && rootVideoId !== videoId);
      const controlsVideoId = getButtonsVideoOwnership(candidate);
      const controlsMatch = Boolean(videoId && controlsVideoId === videoId);
      const controlsConflict = Boolean(videoId && controlsVideoId && controlsVideoId !== videoId);
      const rendered = hasRenderedBox(candidate);
      const inViewport = rendered && intersectsViewport(candidate);
      const tier =
        controlsMatch && inViewport
          ? 8
          : rootMatches && inViewport
            ? 7
            : inViewport
              ? 6
              : controlsMatch && rendered
                ? 5
                : rootMatches && rendered
                  ? 4
                  : rendered
                    ? 3
                    : controlsMatch || rootMatches
                      ? 2
                      : 1;
      return { candidate, controlsConflict, index, rootConflicts, tier };
    })
    // Do not bind outgoing controls to the destination video while YouTube is
    // switching the current watch root during an SPA navigation.
    .filter(({ rootConflicts }) => !rootConflicts);
  const ownershipCompatible = ranked.filter(({ controlsConflict }) => !controlsConflict);
  const selectionPool = ownershipCompatible.length > 0 ? ownershipCompatible : ranked;
  return selectionPool.sort((left, right) => right.tier - left.tier || left.index - right.index)[0]?.candidate;
}

function getNativeButton(buttonContainer) {
  return querySelector(extConfig.selectors.buttons.nativeButton, buttonContainer);
}

function isSegmentedButtonLayout() {
  return querySelector(extConfig.selectors.buttons.segmentedContainer, getButtons()) !== undefined;
}

function getButtons() {
  //---   If Watching Youtube Shorts:   ---//
  if (isShorts()) {
    let elements = isMobile()
      ? querySelectorAll(extConfig.selectors.buttons.shorts.mobile)
      : querySelectorAll(extConfig.selectors.buttons.shorts.desktop);

    for (let element of elements) {
      //YouTube Shorts can have multiple like/dislike buttons when scrolling through videos
      //However, only one of them should be visible (no matter how you zoom)
      if (isInViewport(element)) {
        return element;
      }
    }

    if (elements.length > 0) {
      return elements[0];
    }
  }
  //---   If Watching On Mobile:   ---//
  if (isMobile()) {
    return document.querySelector(extConfig.selectors.buttons.regular.mobile);
  }
  return selectCurrentWatchButtons(getDesktopWatchButtonCandidates());
}

function getLikeButton() {
  const buttons = getButtons();
  return isSegmentedButtonLayout()
    ? querySelector(extConfig.selectors.buttons.likeButton.segmented, buttons) ??
        querySelector(extConfig.selectors.buttons.likeButton.segmentedGetButtons, buttons)
    : querySelector(extConfig.selectors.buttons.likeButton.notSegmented, buttons);
}

function getLikeTextContainer() {
  return querySelector(extConfig.selectors.likeTextContainer, getLikeButton());
}

function getDislikeButton() {
  const buttons = getButtons();
  if (isSegmentedButtonLayout()) {
    return (
      querySelector(extConfig.selectors.buttons.dislikeButton.segmented, buttons) ??
      querySelector(extConfig.selectors.buttons.dislikeButton.segmentedGetButtons, buttons)
    );
  }

  const notSegmentedMatch = querySelector(extConfig.selectors.buttons.dislikeButton.notSegmented, buttons);

  if (notSegmentedMatch != null) {
    return notSegmentedMatch;
  }

  if (isShorts()) {
    return querySelector(extConfig.selectors.buttons.dislikeButton.shortsFallback, buttons);
  }

  return null;
}

function getTextContainerTemplate() {
  const likeButton = getLikeButton();
  const parentTemplate =
    querySelector(extConfig.selectors.likeTextContainerTemplateParent, likeButton) ??
    querySelector(extConfig.selectors.likeTextContainerTemplateParent);

  return querySelector(extConfig.selectors.likeTextContainerTemplate, likeButton) ?? parentTemplate?.parentNode;
}

function updateDislikeButtonShape(dislikeButton) {
  for (const className of extConfig.selectors.buttonClasses.iconButton) {
    dislikeButton.classList.remove(className);
  }

  for (const className of extConfig.selectors.buttonClasses.iconLeading) {
    dislikeButton.classList.add(className);
  }
}

function createDislikeTextContainer() {
  const textNodeClone = getTextContainerTemplate().cloneNode(true);
  const dislikeButton = getNativeButton(getDislikeButton());
  const insertPreChild = dislikeButton;
  insertPreChild.insertBefore(textNodeClone, null);
  updateDislikeButtonShape(dislikeButton);
  if (querySelector(extConfig.selectors.textContainerInner, textNodeClone) === undefined) {
    const span = document.createElement("span");
    span.setAttribute("role", "text");
    while (textNodeClone.firstChild) {
      textNodeClone.removeChild(textNodeClone.firstChild);
    }
    textNodeClone.appendChild(span);
  }
  textNodeClone.innerText = "";
  return textNodeClone;
}

function getDislikeTextContainer() {
  let result;
  const nativeDislikeButton = getNativeButton(getDislikeButton());
  for (const selector of extConfig.selectors.dislikeTextContainer) {
    result = getDislikeButton().querySelector(selector);
    if (result !== null && result !== nativeDislikeButton) {
      break;
    }
    result = null;
  }
  if (result == null) {
    result = createDislikeTextContainer();
  }
  return result;
}

function checkForSignInButton() {
  if (querySelector(extConfig.selectors.signInButton)) {
    return true;
  } else {
    return false;
  }
}

export {
  getButtons,
  getLikeButton,
  getDislikeButton,
  getLikeTextContainer,
  getDislikeTextContainer,
  checkForSignInButton,
  hasRenderedBox,
  markButtonsForVideo,
};
