import { Inngest } from "inngest";
import { processTick, failTick, type Tick } from "./worker";
export const inngest = new Inngest({
  id: "file-image-toolkit",
  checkpointing: { maxRuntime: "180s" },
});
export function eventFor(tick: Tick) {
  return {
    id: `${tick.jobId}-${tick.generation}-${tick.sequence}`,
    name: "toolkit/job.tick",
    data: tick,
  };
}
export const jobWorker = inngest.createFunction(
  {
    id: "drive-job-worker",
    triggers: { event: "toolkit/job.tick" },
    retries: 5,
    concurrency: { limit: 1 },
    onFailure: async ({ event }) => {
      await failTick(event.data.event.data as Tick, event.data.error.message);
    },
  },
  async ({ event, step }) => {
    const tick = event.data as Tick;
    const result = await step.run("process-page-or-batch", () =>
      processTick(tick),
    );
    if (result.more)
      await step.sendEvent(
        "continue-job",
        eventFor({
          jobId: tick.jobId,
          generation: result.generation,
          sequence: result.sequence,
        }),
      );
    return result;
  },
);
