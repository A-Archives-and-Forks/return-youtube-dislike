const fs = require("node:fs");
const path = require("node:path");

const API_ORIGIN = "https://returnyoutubedislikeapi.com";
const UNHANDLED_REJECTION_PREFIX = "__RYD_LIVE_UNHANDLED_REJECTION__";
const MAX_BROWSER_SIGNALS = 50;
const MAX_API_REQUESTS = 50;

function serializeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error, name: "Error", stack: null };
  return {
    message: String(error.message ?? error),
    name: String(error.name ?? "Error"),
    stack: typeof error.stack === "string" ? error.stack : null,
  };
}

function installUnhandledRejectionListener(prefix) {
  if (globalThis.__rydLiveUnhandledRejectionListenerInstalled) return;
  globalThis.__rydLiveUnhandledRejectionListenerInstalled = true;
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    let message;
    try {
      if (reason instanceof Error)
        message = `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ""}`;
      else if (typeof reason === "string") message = reason;
      else message = JSON.stringify(reason);
    } catch {
      message = String(reason);
    }
    console.error(`${prefix}${message ?? "Unknown rejection"}`);
  });
}

function readLivePageState() {
  const readRect = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      width: rect.width,
    };
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < innerHeight &&
      rect.left < innerWidth &&
      style.display !== "none" &&
      style.visibility !== "hidden"
    );
  };
  const actionBarSelector = "reel-action-bar-view-model, .slim-video-action-bar-actions";
  const syntheticSelector = "[data-ryd-synthetic-shorts-dislike]";
  const renderers = [...document.querySelectorAll("ytd-reel-video-renderer, ytm-reel-video-renderer")];

  return {
    document: {
      readyState: document.readyState,
      title: document.title,
      url: location.href,
      viewport: { height: innerHeight, width: innerWidth },
    },
    runtimeMarkers: {
      extensionBuild: document.documentElement.getAttribute("data-ryd-extension-build"),
      extension: document.documentElement.getAttribute("data-ryd-extension-version"),
      userscriptBuild: document.documentElement.getAttribute("data-ryd-userscript-build"),
      userscript: document.documentElement.getAttribute("data-ryd-userscript-version"),
    },
    renderers: renderers.map((renderer, index) => ({
      actionBars: renderer.querySelectorAll(actionBarSelector).length,
      ariaHidden: renderer.getAttribute("aria-hidden"),
      index,
      isActive: renderer.getAttribute("is-active"),
      links: [...renderer.querySelectorAll('a[href*="/shorts/"]')].map((link) => ({
        href: link.getAttribute("href"),
        visible: isVisible(link),
      })),
      rect: readRect(renderer),
      syntheticControls: renderer.querySelectorAll(syntheticSelector).length,
      tagName: renderer.tagName.toLowerCase(),
      videoId: renderer.getAttribute("video-id"),
      visible: isVisible(renderer),
    })),
    actionBars: [...document.querySelectorAll(actionBarSelector)].map((actionBar, index) => ({
      index,
      nativeDislikes: actionBar.querySelectorAll("dislike-button-view-model, #dislike-button").length,
      nativeLikes: actionBar.querySelectorAll("like-button-view-model, #like-button").length,
      rect: readRect(actionBar),
      syntheticControls: actionBar.querySelectorAll(syntheticSelector).length,
      tagName: actionBar.tagName.toLowerCase(),
      videoId: actionBar.closest("ytd-reel-video-renderer, ytm-reel-video-renderer")?.getAttribute("video-id") ?? null,
      visible: isVisible(actionBar),
    })),
    syntheticControls: [...document.querySelectorAll(syntheticSelector)].map((control, index) => ({
      ariaPressed: control.querySelector("button")?.getAttribute("aria-pressed") ?? null,
      index,
      rect: readRect(control),
      text: (control.textContent ?? "").replace(/\s+/g, " ").trim(),
      videoId: control.getAttribute("data-ryd-video-id"),
      visible: isVisible(control),
    })),
    videos: [...document.querySelectorAll("video")].map((video, index) => ({
      currentTime: video.currentTime,
      ended: video.ended,
      index,
      paused: video.paused,
      readyState: video.readyState,
      rect: readRect(video),
      visible: isVisible(video),
    })),
  };
}

function diagnosticApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.origin !== API_ORIGIN) return null;

  const query = {};
  for (const [name, requestValue] of url.searchParams) {
    query[name] = /auth|key|puzzle|secret|solution|token|user/i.test(name) ? "<redacted>" : requestValue;
  }
  return { pathname: url.pathname, query };
}

function timestampForFilename(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

class LiveRunDiagnostics {
  constructor(
    page,
    context,
    {
      clock = () => new Date(),
      fileSystem = fs,
      log = console.log,
      outputDirectory = path.resolve(__dirname, "../../../../test-results/live-youtube/diagnostics"),
      runtime = null,
    } = {},
  ) {
    this.browserSignals = [];
    this.clock = clock;
    this.context = context;
    this.currentCheckpoint = null;
    this.currentStage = "startup";
    this.fileSystem = fileSystem;
    this.log = log;
    this.outputDirectory = outputDirectory;
    this.page = page;
    this.recentApiRequests = [];
    this.requestRecords = new WeakMap();
    this.runtime = runtime;
    this.started = false;

    this.onConsole = this.onConsole.bind(this);
    this.onPageError = this.onPageError.bind(this);
    this.onRequest = this.onRequest.bind(this);
    this.onRequestFailed = this.onRequestFailed.bind(this);
    this.onResponse = this.onResponse.bind(this);
  }

  now() {
    return this.clock().toISOString();
  }

  appendCapped(collection, value, maximum) {
    collection.push(value);
    if (collection.length > maximum) collection.splice(0, collection.length - maximum);
  }

  recordBrowserSignal(type, details) {
    const signal = {
      at: this.now(),
      checkpoint: this.currentCheckpoint,
      stage: this.currentStage,
      type,
      ...details,
    };
    this.appendCapped(this.browserSignals, signal, MAX_BROWSER_SIGNALS);
    this.log(`LIVE_BROWSER_SIGNAL ${type} ${JSON.stringify(details)}`);
  }

  onPageError(error) {
    this.recordBrowserSignal("pageerror", { error: serializeError(error) });
  }

  onConsole(message) {
    if (message.type() !== "error") return;
    const text = message.text();
    const location = message.location?.() ?? {};
    if (text.startsWith(UNHANDLED_REJECTION_PREFIX)) {
      this.recordBrowserSignal("unhandledrejection", {
        location,
        message: text.slice(UNHANDLED_REJECTION_PREFIX.length),
      });
      return;
    }
    this.recordBrowserSignal("console.error", { location, message: text });
  }

  onRequest(request) {
    const apiUrl = diagnosticApiUrl(request.url());
    if (!apiUrl) return;
    const record = {
      ...apiUrl,
      at: this.now(),
      failure: null,
      method: request.method(),
      resourceType: typeof request.resourceType === "function" ? request.resourceType() : null,
      checkpoint: this.currentCheckpoint,
      stage: this.currentStage,
      status: null,
    };
    this.appendCapped(this.recentApiRequests, record, MAX_API_REQUESTS);
    this.requestRecords.set(request, record);
  }

  onResponse(response) {
    const record = this.requestRecords.get(response.request());
    if (!record) return;
    record.status = response.status();
  }

  onRequestFailed(request) {
    const record = this.requestRecords.get(request);
    if (!record) return;
    record.failure = request.failure()?.errorText ?? "Unknown request failure";
  }

  async start() {
    if (this.started) return;
    this.started = true;
    this.page.on("console", this.onConsole);
    this.page.on("pageerror", this.onPageError);
    this.context.on("request", this.onRequest);
    this.context.on("requestfailed", this.onRequestFailed);
    this.context.on("response", this.onResponse);
    await this.page.addInitScript(installUnhandledRejectionListener, UNHANDLED_REJECTION_PREFIX);
    if (!this.page.isClosed()) {
      await this.page.evaluate(installUnhandledRejectionListener, UNHANDLED_REJECTION_PREFIX);
    }
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.page.off("console", this.onConsole);
    this.page.off("pageerror", this.onPageError);
    this.context.off("request", this.onRequest);
    this.context.off("requestfailed", this.onRequestFailed);
    this.context.off("response", this.onResponse);
  }

  checkpoint(name, details = {}) {
    this.currentCheckpoint = name;
    this.log(`LIVE_CHECKPOINT ${name} ${JSON.stringify(details)}`);
  }

  stageStarted(name) {
    this.currentCheckpoint = null;
    this.currentStage = name;
    this.log(`LIVE_STAGE_START ${name}`);
  }

  stageCompleted(name, startedAt) {
    this.currentCheckpoint = null;
    this.currentStage = name;
    this.log(`LIVE_STAGE_COMPLETE ${name} durationMs=${Date.now() - startedAt}`);
  }

  stageFailed(name, startedAt, error) {
    this.currentStage = name;
    this.log(
      `LIVE_STAGE_FAILED ${name} durationMs=${Date.now() - startedAt} error=${JSON.stringify(error?.message ?? String(error))}`,
    );
  }

  async snapshot(error) {
    let pageState = null;
    let pageStateError = null;
    let url = null;
    try {
      url = this.page.url();
    } catch {
      // A disconnected page still produces a useful harness/request snapshot.
    }
    if (!this.page.isClosed()) {
      try {
        pageState = await this.page.evaluate(readLivePageState);
      } catch (snapshotError) {
        pageStateError = serializeError(snapshotError);
      }
    }

    return {
      browserSignals: this.browserSignals,
      capturedAt: this.now(),
      currentCheckpoint: this.currentCheckpoint,
      currentStage: this.currentStage,
      error: serializeError(error),
      pageClosed: this.page.isClosed(),
      pageState,
      pageStateError,
      recentApiRequests: this.recentApiRequests,
      runtime: this.runtime,
      url,
    };
  }

  async persistFailureSnapshot(error) {
    const snapshot = await this.snapshot(error);
    this.fileSystem.mkdirSync(this.outputDirectory, { recursive: true });
    const fileName = `failure-${timestampForFilename(this.clock())}.json`;
    const snapshotPath = path.join(this.outputDirectory, fileName);
    this.fileSystem.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    return snapshotPath;
  }
}

async function runLoggedStage(diagnostics, name, action) {
  const startedAt = Date.now();
  diagnostics.stageStarted(name);
  try {
    const result = await action();
    diagnostics.stageCompleted(name, startedAt);
    return result;
  } catch (error) {
    diagnostics.stageFailed(name, startedAt, error);
    throw error;
  }
}

module.exports = {
  API_ORIGIN,
  LiveRunDiagnostics,
  UNHANDLED_REJECTION_PREFIX,
  diagnosticApiUrl,
  installUnhandledRejectionListener,
  readLivePageState,
  runLoggedStage,
  serializeError,
};
