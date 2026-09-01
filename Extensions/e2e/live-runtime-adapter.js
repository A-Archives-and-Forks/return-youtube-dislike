const assert = require("node:assert/strict");

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const LIVE_RUNTIME_PROFILES = deepFreeze({
  extension: {
    capabilities: {
      backgroundVoteTransport: true,
      credentialStore: "browser.storage",
      ownsShortsDislikeControl: false,
      shortsControlModel: "native-youtube",
      shortsVisualModel: "native-pair",
    },
    buildMarkerAttribute: "data-ryd-extension-build",
    markerAttribute: "data-ryd-extension-version",
    runtime: "extension",
    selectors: {
      rateBar: "#ryd-bar",
      rateBarContainer: "#ryd-bar-container",
      shortsDislikeControl: null,
      tooltipContent: "#ryd-dislike-tooltip",
      tooltipTrigger: ".ryd-tooltip",
    },
  },
  userscript: {
    capabilities: {
      backgroundVoteTransport: false,
      credentialStore: "gm-storage",
      ownsShortsDislikeControl: true,
      shortsControlModel: "synthetic-owned",
      shortsVisualModel: "strict-synthetic",
    },
    buildMarkerAttribute: "data-ryd-userscript-build",
    markerAttribute: "data-ryd-userscript-version",
    runtime: "userscript",
    selectors: {
      rateBar: "#return-youtube-dislike-bar",
      rateBarContainer: "#return-youtube-dislike-bar-container",
      shortsDislikeControl: "[data-ryd-synthetic-shorts-dislike]",
      tooltipContent: ".ryd-tooltip-label",
      tooltipTrigger: ".ryd-tooltip",
    },
  },
});

function requireDriverMethod(driver, method, scenarioId = null) {
  if (typeof driver?.[method] === "function") return;
  const scenario = scenarioId ? ` for shared scenario ${scenarioId}` : "";
  throw new TypeError(`The ${driver ? "live driver" : "missing driver"}${scenario} must implement ${method}().`);
}

function assertRuntimeArgument(value, expected, label) {
  if (value === undefined) return;
  assert.equal(value, expected, `${label} does not match the selected live runtime adapter.`);
}

function createRuntimeBoundDriver(driver, runtime, expectedVersion, expectedBuildId) {
  return new Proxy(driver, {
    get(target, property, receiver) {
      if (property === "assertRuntime") {
        return (requestedRuntime, requestedVersion, requestedBuildId) => {
          assertRuntimeArgument(requestedRuntime, runtime, "The asserted runtime");
          assertRuntimeArgument(requestedVersion, expectedVersion, "The asserted runtime version");
          assertRuntimeArgument(requestedBuildId, expectedBuildId, "The asserted live build ID");
          requireDriverMethod(target, "assertRuntime");
          return target.assertRuntime(runtime, expectedVersion, expectedBuildId);
        };
      }

      if (property === "assertCurrentShortsControl") {
        return (videoId, requestedRuntime) => {
          assertRuntimeArgument(requestedRuntime, runtime, "The Shorts-control runtime");
          requireDriverMethod(target, "assertCurrentShortsControl");
          return target.assertCurrentShortsControl(videoId, runtime);
        };
      }

      if (property === "captureWatchRatioVisual") {
        return (requestedRuntime, screenshotPath, options) => {
          assertRuntimeArgument(requestedRuntime, runtime, "The watch-visual runtime");
          requireDriverMethod(target, "captureWatchRatioVisual");
          return options === undefined
            ? target.captureWatchRatioVisual(runtime, screenshotPath)
            : target.captureWatchRatioVisual(runtime, screenshotPath, options);
        };
      }

      if (property === "captureReactionStateVisual") {
        return (request) => {
          assertRuntimeArgument(request?.runtime, runtime, "The reaction-visual runtime");
          requireDriverMethod(target, "captureReactionStateVisual");
          return target.captureReactionStateVisual({ ...request, runtime });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

class LiveRuntimeAdapter {
  constructor({ driver, expectedBuildId, expectedVersion, runtime }) {
    const profile = LIVE_RUNTIME_PROFILES[runtime];
    if (!profile) throw new TypeError(`Unsupported live runtime adapter: ${runtime}`);
    if (!driver || (typeof driver !== "object" && typeof driver !== "function")) {
      throw new TypeError("A live YouTube driver is required.");
    }
    if (typeof expectedVersion !== "string" || expectedVersion.trim() === "") {
      throw new TypeError("A non-empty expected runtime version is required.");
    }
    if (!/^[a-f0-9]{32}$/.test(expectedBuildId)) {
      throw new TypeError("The expected live build ID must be a 32-character lowercase hexadecimal value.");
    }

    this.capabilities = profile.capabilities;
    this.driver = createRuntimeBoundDriver(driver, runtime, expectedVersion, expectedBuildId);
    this.expectedBuildId = expectedBuildId;
    this.expectedVersion = expectedVersion;
    this.profile = profile;
    this.runtime = runtime;
    this.selectors = profile.selectors;
  }

  createScenarioOptions(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("Shared live scenario options must be an object.");
    }
    assertRuntimeArgument(options.runtime, this.runtime, "The configured scenario runtime");
    assertRuntimeArgument(options.expectedBuildId, this.expectedBuildId, "The configured live build ID");
    assertRuntimeArgument(options.expectedVersion, this.expectedVersion, "The configured scenario runtime version");
    return {
      ...options,
      expectedBuildId: this.expectedBuildId,
      expectedVersion: this.expectedVersion,
      runtime: this.runtime,
    };
  }

  assertDriverMethods(methods, scenarioId) {
    methods.forEach((method) => requireDriverMethod(this.driver, method, scenarioId));
  }
}

function createExtensionLiveRuntimeAdapter(options) {
  return new LiveRuntimeAdapter({ ...options, runtime: "extension" });
}

function createUserscriptLiveRuntimeAdapter(options) {
  return new LiveRuntimeAdapter({ ...options, runtime: "userscript" });
}

module.exports = {
  LIVE_RUNTIME_PROFILES,
  LiveRuntimeAdapter,
  createExtensionLiveRuntimeAdapter,
  createUserscriptLiveRuntimeAdapter,
};
