import { getBrowser, getVideoId, numberFormat, createObserver, querySelector } from "./utils";
import { checkForSignInButton, getButtons, getDislikeButton, getLikeButton } from "./buttons";
import { setDislikes, extConfig, storedData, setLikes, getLikeCountFromButton } from "./state";
import { createRateBar } from "./bar";
import {
  LIKE_ACTION,
  DISLIKE_ACTION,
  resolveVoteTransition,
  applyVoteTransitionCounts,
  shouldSubmitVote,
} from "../../common/vote-transition";

function sendVote(vote) {
  if (shouldSubmitVote({ disableVoteSubmission: extConfig.disableVoteSubmission })) {
    const result = getBrowser().runtime.sendMessage({
      message: "send_vote",
      vote: vote,
      videoId: getVideoId(window.location.href),
    });
    if (result && typeof result.catch === "function") {
      result.catch((error) => console.error("Vote submission failed", error));
    }
  }
}

function updateDOMDislikes() {
  setDislikes(numberFormat(storedData.dislikes));
  createRateBar(storedData.likes, storedData.dislikes);
}

function handleVoteAction(action) {
  if (checkForSignInButton() === false) {
    const transition = resolveVoteTransition(storedData.previousState, action);
    const counts = applyVoteTransitionCounts(storedData.likes, storedData.dislikes, transition);
    sendVote(transition.value);
    storedData.likes = counts.likes;
    storedData.dislikes = counts.dislikes;
    storedData.previousState = transition.nextState;
    updateDOMDislikes();

    if (extConfig.numberDisplayReformatLikes === true) {
      const nativeLikes = getLikeCountFromButton();
      if (nativeLikes !== false) {
        setLikes(numberFormat(nativeLikes));
      }
    }
  }
}

function likeClicked() {
  handleVoteAction(LIKE_ACTION);
}

function dislikeClicked() {
  handleVoteAction(DISLIKE_ACTION);
}

const boundLikeButtons = new WeakSet();
const boundDislikeButtons = new WeakSet();

function addLikeDislikeEventListener() {
  const likeButton = getLikeButton();
  const dislikeButton = getDislikeButton();
  if (likeButton && !boundLikeButtons.has(likeButton)) {
    likeButton.addEventListener("click", likeClicked);
    boundLikeButtons.add(likeButton);
  }
  if (dislikeButton && !boundDislikeButtons.has(dislikeButton)) {
    dislikeButton.addEventListener("click", dislikeClicked);
    dislikeButton.addEventListener("focusin", updateDOMDislikes);
    dislikeButton.addEventListener("focusout", updateDOMDislikes);
    boundDislikeButtons.add(dislikeButton);
  }
}

let smartimationObserver = null;

function createSmartimationObserver() {
  if (!smartimationObserver) {
    smartimationObserver = createObserver(
      {
        attributes: true,
        subtree: true,
        childList: true,
      },
      updateDOMDislikes,
    );
    smartimationObserver.container = null;
  }

  const smartimationContainer = querySelector(extConfig.selectors.buttons.smartimation, getButtons());
  if (smartimationContainer && smartimationObserver.container != smartimationContainer) {
    console.log("Initializing smartimation mutation observer");
    smartimationObserver.disconnect();
    smartimationObserver.observe(smartimationContainer);
    smartimationObserver.container = smartimationContainer;
  }
}

function storageChangeHandler(changes, area) {
  if (changes.disableVoteSubmission !== undefined) {
    handleDisableVoteSubmissionChangeEvent(changes.disableVoteSubmission.newValue);
  }
  if (changes.coloredThumbs !== undefined) {
    handleColoredThumbsChangeEvent(changes.coloredThumbs.newValue);
  }
  if (changes.coloredBar !== undefined) {
    handleColoredBarChangeEvent(changes.coloredBar.newValue);
  }
  if (changes.colorTheme !== undefined) {
    handleColorThemeChangeEvent(changes.colorTheme.newValue);
  }
  if (changes.numberDisplayFormat !== undefined) {
    handleNumberDisplayFormatChangeEvent(changes.numberDisplayFormat.newValue);
  }
  if (changes.numberDisplayReformatLikes !== undefined) {
    handleNumberDisplayReformatLikesChangeEvent(changes.numberDisplayReformatLikes.newValue);
  }
  if (changes.hidePremiumTeaser !== undefined) {
    handleHidePremiumTeaserChangeEvent(changes.hidePremiumTeaser.newValue);
  }
}

function handleDisableVoteSubmissionChangeEvent(value) {
  extConfig.disableVoteSubmission = value;
}

function handleColoredThumbsChangeEvent(value) {
  extConfig.coloredThumbs = value;
}

function handleColoredBarChangeEvent(value) {
  extConfig.coloredBar = value;
}

function handleColorThemeChangeEvent(value) {
  if (!value) value = "classic";
  extConfig.colorTheme = value;
}

function handleNumberDisplayFormatChangeEvent(value) {
  extConfig.numberDisplayFormat = value;
}

function handleNumberDisplayReformatLikesChangeEvent(value) {
  extConfig.numberDisplayReformatLikes = value;
}

function handleHidePremiumTeaserChangeEvent(value) {
  extConfig.hidePremiumTeaser = value === true;
}

export {
  sendVote,
  likeClicked,
  dislikeClicked,
  addLikeDislikeEventListener,
  createSmartimationObserver,
  storageChangeHandler,
};
