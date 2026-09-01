import { getButtons, getDislikeButton, getLikeButton } from "./buttons";
import { extConfig, isMobile, isLikesDisabled, isNewDesign, isRoundedDesign, isShorts } from "./state";
import { getColorFromTheme, isInViewport, querySelector } from "./utils";

function closestConfigured(element, selectors) {
  for (const selector of Array.isArray(selectors) ? selectors : [selectors]) {
    const match = selector ? element?.closest(selector) : null;
    if (match) return match;
  }
  return null;
}

function findInCurrentWatchTree(buttons, selectors, fallbackScope = null) {
  const closest = closestConfigured(buttons, selectors);
  if (closest) return closest;
  const watchRoot = buttons?.closest("ytd-watch-flexy, ytd-watch-grid");
  const scope = fallbackScope ?? watchRoot;
  return scope ? querySelector(selectors, scope) : undefined;
}

function createRateBar(likes, dislikes) {
  const buttons = getButtons();
  for (const wrapper of document.querySelectorAll(".ryd-tooltip")) {
    if (!buttons?.contains(wrapper)) wrapper.remove();
  }
  let rateBar = buttons?.querySelector("#ryd-bar-container");
  if (!isLikesDisabled()) {
    // sometimes rate bar is hidden
    if (rateBar && !isInViewport(rateBar)) {
      (rateBar.closest(".ryd-tooltip") ?? rateBar).remove();
      rateBar = null;
    }

    const widthPx =
      parseFloat(window.getComputedStyle(getLikeButton()).width) +
      parseFloat(window.getComputedStyle(getDislikeButton()).width) +
      (isRoundedDesign() ? 0 : 8);

    const widthPercent = likes + dislikes > 0 ? (likes / (likes + dislikes)) * 100 : 50;

    var likePercentage = parseFloat(widthPercent.toFixed(1));
    const dislikePercentage = (100 - likePercentage).toLocaleString();
    likePercentage = likePercentage.toLocaleString();

    if (extConfig.showTooltipPercentage) {
      var tooltipInnerHTML;
      switch (extConfig.tooltipPercentageMode) {
        case "dash_dislike":
          tooltipInnerHTML = `${likes.toLocaleString()}&nbsp;/&nbsp;${dislikes.toLocaleString()}&nbsp;&nbsp;-&nbsp;&nbsp;${dislikePercentage}%`;
          break;
        case "both":
          tooltipInnerHTML = `${likePercentage}%&nbsp;/&nbsp;${dislikePercentage}%`;
          break;
        case "only_like":
          tooltipInnerHTML = `${likePercentage}%`;
          break;
        case "only_dislike":
          tooltipInnerHTML = `${dislikePercentage}%`;
          break;
        default: // dash_like
          tooltipInnerHTML = `${likes.toLocaleString()}&nbsp;/&nbsp;${dislikes.toLocaleString()}&nbsp;&nbsp;-&nbsp;&nbsp;${likePercentage}%`;
      }
    } else {
      tooltipInnerHTML = `${likes.toLocaleString()}&nbsp;/&nbsp;${dislikes.toLocaleString()}`;
    }

    if (!isShorts()) {
      if (!rateBar && !isMobile()) {
        let colorLikeStyle = "";
        let colorDislikeStyle = "";
        if (extConfig.coloredBar) {
          colorLikeStyle = "; background-color: " + getColorFromTheme(true);
          colorDislikeStyle = "; background-color: " + getColorFromTheme(false);
        }
        const actions = buttons;
        (actions || querySelector(extConfig.selectors.rateBar.mobileActionBar)).insertAdjacentHTML(
          "beforeend",
          `
              <div class="ryd-tooltip ryd-tooltip-${isNewDesign() ? "new" : "old"}-design" style="width: ${widthPx}px">
              <div class="ryd-tooltip-bar-container">
                <div
                    id="ryd-bar-container"
                    style="width: 100%; height: 2px;${colorDislikeStyle}"
                    >
                    <div
                      id="ryd-bar"
                      style="width: ${widthPercent}%; height: 100%${colorLikeStyle}"
                      ></div>
                </div>
              </div>
              <tp-yt-paper-tooltip position="top" id="ryd-dislike-tooltip" class="style-scope ytd-sentiment-bar-renderer" role="tooltip" tabindex="-1">
                <!--css-build:shady-->${tooltipInnerHTML}
              </tp-yt-paper-tooltip>
              </div>
      		`,
        );

        if (isNewDesign()) {
          // Add border between info and comments
          const descriptionAndActionsElement = findInCurrentWatchTree(buttons, extConfig.selectors.rateBar.topRow);
          if (descriptionAndActionsElement) {
            descriptionAndActionsElement.style.borderBottom = "1px solid var(--yt-spec-10-percent-layer)";
            descriptionAndActionsElement.style.paddingBottom = "10px";
          }

          // Fix like/dislike ratio bar offset in new UI
          const actionsInner = findInCurrentWatchTree(
            buttons,
            extConfig.selectors.rateBar.actionsInner,
            descriptionAndActionsElement,
          );
          if (actionsInner) actionsInner.style.width = "revert";
          if (isRoundedDesign()) {
            const actions = findInCurrentWatchTree(
              buttons,
              extConfig.selectors.rateBar.actions,
              descriptionAndActionsElement,
            );
            if (actions) actions.style.flexDirection = "row-reverse";
          }
        }
      } else {
        buttons.querySelector(`.ryd-tooltip`).style.width = widthPx + "px";
        buttons.querySelector("#ryd-bar").style.width = widthPercent + "%";
        const tooltip = buttons.querySelector("#ryd-dislike-tooltip > #tooltip");
        if (tooltip) tooltip.innerHTML = tooltipInnerHTML;
        if (extConfig.coloredBar) {
          buttons.querySelector("#ryd-bar-container").style.backgroundColor = getColorFromTheme(false);
          buttons.querySelector("#ryd-bar").style.backgroundColor = getColorFromTheme(true);
        }
      }
    }
  } else {
    console.log("removing bar");
    if (rateBar) {
      (rateBar.closest(".ryd-tooltip") ?? rateBar).remove();
    }
  }
}

export { createRateBar };
