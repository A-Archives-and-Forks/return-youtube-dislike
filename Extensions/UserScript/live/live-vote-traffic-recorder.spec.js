const { assertLogicalVoteHandshake } = require("../e2e/live/live-youtube-driver");

const VIDEO_ID = "abcdefghijk";
const USER_ID = "shared-user-id";

function vote({ status = 200, userId = USER_ID, value = 1, videoId = VIDEO_ID } = {}) {
  return {
    body: { userId, value, videoId },
    pathname: "/interact/vote",
    responseError: null,
    status,
  };
}

function confirmation({ confirmed = true, status = 200, userId = USER_ID, videoId = VIDEO_ID } = {}) {
  return {
    body: { solution: "proof", userId, videoId },
    pathname: "/interact/confirmVote",
    responseBody: confirmed,
    responseError: null,
    status,
  };
}

describe("live logical vote handshake validation", () => {
  test("accepts one vote puzzle followed by one true confirmation", () => {
    expect(assertLogicalVoteHandshake([vote(), confirmation()], VIDEO_ID, 1)).toBe(USER_ID);
  });

  test("accepts two matching vote puzzle requests followed by one true confirmation", () => {
    expect(assertLogicalVoteHandshake([vote(), vote(), confirmation()], VIDEO_ID, 1)).toBe(USER_ID);
  });

  test("accepts three matching vote puzzle requests followed by one true confirmation", () => {
    expect(assertLogicalVoteHandshake([vote(), vote(), vote(), confirmation()], VIDEO_ID, 1)).toBe(USER_ID);
  });

  test("rejects a fourth vote puzzle request", () => {
    expect(() => assertLogicalVoteHandshake([vote(), vote(), vote(), vote(), confirmation()], VIDEO_ID, 1)).toThrow(
      /one to three vote puzzle requests/,
    );
  });

  test.each([
    ["user", [vote(), vote({ userId: "another-user" }), confirmation()], /different user IDs/],
    ["video", [vote(), vote({ videoId: "lmnopqrstuv" }), confirmation()], /different video/],
    ["value", [vote(), vote({ value: 0 }), confirmation()], /changed the requested vote value/],
  ])("rejects a retry with a mismatched %s", (_field, records, message) => {
    expect(() => assertLogicalVoteHandshake(records, VIDEO_ID, 1)).toThrow(message);
  });

  test.each([
    ["extra confirmation", [vote(), confirmation(), confirmation()]],
    ["other interaction", [vote(), { ...vote(), pathname: "/interact/other" }, confirmation()]],
    ["traffic after confirmation", [vote(), confirmation(), vote()]],
  ])("rejects %s traffic", (_case, records) => {
    expect(() => assertLogicalVoteHandshake(records, VIDEO_ID, 1)).toThrow(
      /exactly one confirmation|logical vote may/i,
    );
  });

  test("rejects a false confirmation", () => {
    expect(() => assertLogicalVoteHandshake([vote(), confirmation({ confirmed: false })], VIDEO_ID, 1)).toThrow(
      /did not confirm the vote/,
    );
  });

  test("rejects a failed vote or confirmation response", () => {
    expect(() => assertLogicalVoteHandshake([vote({ status: 500 }), confirmation()], VIDEO_ID, 1)).toThrow(
      /Vote request failed with HTTP 500/,
    );
    expect(() => assertLogicalVoteHandshake([vote(), confirmation({ status: 500 })], VIDEO_ID, 1)).toThrow(
      /Vote confirmation failed with HTTP 500/,
    );
  });
});
