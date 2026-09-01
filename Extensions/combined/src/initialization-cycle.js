function createInitializationCycleRunner(runCycle) {
  if (typeof runCycle !== "function") {
    throw new TypeError("An initialization cycle function is required.");
  }

  let activePromise = null;
  let rerunRequested = false;

  async function request() {
    if (activePromise) {
      rerunRequested = true;
      return activePromise;
    }

    activePromise = (async () => {
      do {
        rerunRequested = false;
        await runCycle();
      } while (rerunRequested);
    })();

    try {
      return await activePromise;
    } finally {
      activePromise = null;
    }
  }

  return {
    isRunning: () => activePromise !== null,
    request,
  };
}

export { createInitializationCycleRunner };
