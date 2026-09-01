/**
 * @jest-environment jsdom
 */

const path = require("node:path");
const {
  LiveRunDiagnostics,
  UNHANDLED_REJECTION_PREFIX,
  diagnosticApiUrl,
  readLivePageState,
  runLoggedStage,
} = require("../e2e/live/live-diagnostics");

class FakeEmitter {
  constructor() {
    this.listeners = new Map();
  }

  emit(event, value) {
    for (const listener of this.listeners.get(event) ?? []) listener(value);
  }

  off(event, listener) {
    this.listeners.get(event)?.delete(listener);
  }

  on(event, listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(listener);
  }
}

function visibleRect() {
  return { bottom: 100, height: 90, left: 10, right: 60, top: 10, width: 50 };
}

describe("live interactive diagnostics", () => {
  test("captures runtime and Shorts ownership state without dumping page HTML", () => {
    document.documentElement.setAttribute("data-ryd-userscript-version", "3.2.0");
    document.body.innerHTML = `
      <ytd-reel-video-renderer video-id="abcdefghijk" is-active>
        <a href="/shorts/abcdefghijk">Short</a>
        <reel-action-bar-view-model>
          <like-button-view-model></like-button-view-model>
          <button-view-model data-ryd-synthetic-shorts-dislike data-ryd-video-id="abcdefghijk">
            <button aria-pressed="false"></button><span>123</span>
          </button-view-model>
        </reel-action-bar-view-model>
      </ytd-reel-video-renderer>
    `;
    for (const element of document.querySelectorAll("*")) element.getBoundingClientRect = visibleRect;

    const state = readLivePageState();

    expect(state.runtimeMarkers).toEqual({
      extension: null,
      extensionBuild: null,
      userscript: "3.2.0",
      userscriptBuild: null,
    });
    expect(state.renderers).toEqual([
      expect.objectContaining({ actionBars: 1, syntheticControls: 1, videoId: "abcdefghijk", visible: true }),
    ]);
    expect(state.renderers[0].links).toEqual([{ href: "/shorts/abcdefghijk", visible: true }]);
    expect(state.actionBars).toEqual([
      expect.objectContaining({ nativeLikes: 1, syntheticControls: 1, videoId: "abcdefghijk", visible: true }),
    ]);
    expect(state.syntheticControls).toEqual([
      expect.objectContaining({ ariaPressed: "false", text: "123", videoId: "abcdefghijk", visible: true }),
    ]);
    expect(JSON.stringify(state)).not.toContain("outerHTML");
  });

  test("records browser failures and redacted recent API traffic in the persisted snapshot", async () => {
    const context = new FakeEmitter();
    const page = new FakeEmitter();
    page.addInitScript = jest.fn().mockResolvedValue(undefined);
    page.evaluate = jest.fn(async (callback) =>
      callback.name === "readLivePageState" ? { runtimeMarkers: { userscript: "3.2.0" } } : undefined,
    );
    page.isClosed = jest.fn(() => false);
    page.url = jest.fn(() => "https://www.youtube.com/shorts/abcdefghijk");
    const fileSystem = { mkdirSync: jest.fn(), writeFileSync: jest.fn() };
    const log = jest.fn();
    const diagnostics = new LiveRunDiagnostics(page, context, {
      clock: () => new Date("2026-08-18T12:34:56.000Z"),
      fileSystem,
      log,
      outputDirectory: "diagnostics",
      runtime: "userscript",
    });
    await diagnostics.start();
    diagnostics.stageStarted("read-only.channel-to-shorts-and-next");
    diagnostics.checkpoint("ryd-votes-response.waiting", { videoId: "abcdefghijk" });

    const request = {
      method: () => "GET",
      resourceType: () => "fetch",
      url: () => "https://returnyoutubedislikeapi.com/votes?videoId=abcdefghijk&userId=private-id",
    };
    context.emit("request", request);
    context.emit("response", { request: () => request, status: () => 200 });
    page.emit("pageerror", new Error("page exploded"));
    page.emit("console", {
      location: () => ({ lineNumber: 7, url: "https://www.youtube.com/shorts/abcdefghijk" }),
      text: () => `${UNHANDLED_REJECTION_PREFIX}promise exploded`,
      type: () => "error",
    });
    page.emit("console", {
      location: () => ({}),
      text: () => "console exploded",
      type: () => "error",
    });

    const snapshotPath = await diagnostics.persistFailureSnapshot(new Error("scenario timed out"));
    diagnostics.stop();

    expect(snapshotPath).toBe(path.join("diagnostics", "failure-2026-08-18T12-34-56-000Z.json"));
    expect(fileSystem.mkdirSync).toHaveBeenCalledWith("diagnostics", { recursive: true });
    const snapshot = JSON.parse(fileSystem.writeFileSync.mock.calls[0][1]);
    expect(snapshot.currentStage).toBe("read-only.channel-to-shorts-and-next");
    expect(snapshot.currentCheckpoint).toBe("ryd-votes-response.waiting");
    expect(snapshot.browserSignals.map(({ type }) => type)).toEqual([
      "pageerror",
      "unhandledrejection",
      "console.error",
    ]);
    expect(snapshot.recentApiRequests).toEqual([
      expect.objectContaining({
        method: "GET",
        pathname: "/votes",
        query: { userId: "<redacted>", videoId: "abcdefghijk" },
        status: 200,
      }),
    ]);
    expect(snapshot.pageState).toEqual({ runtimeMarkers: { userscript: "3.2.0" } });
    expect(snapshot.url).toBe("https://www.youtube.com/shorts/abcdefghijk");
    expect(context.listeners.get("request").size).toBe(0);
    expect(page.listeners.get("pageerror").size).toBe(0);
  });

  test("logs stage completion and failure boundaries", async () => {
    const diagnostics = {
      stageCompleted: jest.fn(),
      stageFailed: jest.fn(),
      stageStarted: jest.fn(),
    };

    await expect(runLoggedStage(diagnostics, "success", async () => 42)).resolves.toBe(42);
    const failure = new Error("failed");
    await expect(
      runLoggedStage(diagnostics, "failure", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(diagnostics.stageStarted.mock.calls.map(([name]) => name)).toEqual(["success", "failure"]);
    expect(diagnostics.stageCompleted).toHaveBeenCalledWith("success", expect.any(Number));
    expect(diagnostics.stageFailed).toHaveBeenCalledWith("failure", expect.any(Number), failure);
  });

  test("redacts identity and proof material while retaining diagnostic video IDs", () => {
    expect(
      diagnosticApiUrl(
        "https://returnyoutubedislikeapi.com/puzzle/registration?userId=private&videoId=abcdefghijk&solution=secret",
      ),
    ).toEqual({
      pathname: "/puzzle/registration",
      query: { solution: "<redacted>", userId: "<redacted>", videoId: "abcdefghijk" },
    });
  });
});
