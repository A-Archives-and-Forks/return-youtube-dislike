import { createInitializationCycleRunner } from "./initialization-cycle";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test("queues a fresh initialization when navigation arrives during an in-flight cycle", async () => {
  const outgoing = deferred();
  const calls = [];
  const runner = createInitializationCycleRunner(async () => {
    calls.push(calls.length === 0 ? "A" : "B");
    if (calls.length === 1) await outgoing.promise;
  });

  const first = runner.request();
  const navigation = runner.request();

  expect(runner.isRunning()).toBe(true);
  expect(calls).toEqual(["A"]);

  outgoing.resolve();
  await Promise.all([first, navigation]);

  expect(calls).toEqual(["A", "B"]);
  expect(runner.isRunning()).toBe(false);
});

test("coalesces repeated navigation signals into one pending cycle", async () => {
  const outgoing = deferred();
  const runCycle = jest.fn(async () => {
    if (runCycle.mock.calls.length === 1) await outgoing.promise;
  });
  const runner = createInitializationCycleRunner(runCycle);

  const first = runner.request();
  const queued = [runner.request(), runner.request(), runner.request()];
  outgoing.resolve();
  await Promise.all([first, ...queued]);

  expect(runCycle).toHaveBeenCalledTimes(2);
});

test("continues accepting independent cycles after a queued rerun", async () => {
  const runner = createInitializationCycleRunner(jest.fn(async () => {}));

  await runner.request();
  await runner.request();

  expect(runner.isRunning()).toBe(false);
});

test("rejects invalid cycle callbacks", () => {
  expect(() => createInitializationCycleRunner()).toThrow(TypeError);
});
