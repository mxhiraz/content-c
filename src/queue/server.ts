import express from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/dist/queueAdapters/bullMQ.js";
import { ExpressAdapter } from "@bull-board/express";
import { carouselQueue } from "./queue.js";
import { startWorker } from "./worker.js";
import { registerSchedules } from "./scheduler.js";
import { log } from "../log.js";

const PORT = Number.parseInt(process.env.QUEUE_PORT ?? "3000", 10);

async function main() {
  startWorker();
  await registerSchedules();

  const app = express();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/queue");
  createBullBoard({
    queues: [new BullMQAdapter(carouselQueue)],
    serverAdapter,
  });
  app.use("/queue", serverAdapter.getRouter());

  // Webhook ingestion endpoint (replaces inngest event API)
  app.use(express.json({ limit: "1mb" }));
  app.post("/webhook", async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!body.url || typeof body.url !== "string") {
        return res.status(400).json({ error: "url required" });
      }
      const job = await carouselQueue.add("render", body as unknown as Parameters<typeof carouselQueue.add>[1]);
      return res.status(202).json({ queued: true, jobId: job.id });
    } catch (e) {
      return res.status(500).json({ error: (e as Error).message });
    }
  });
  app.get("/health", async (_req, res) => {
    const counts = await carouselQueue.getJobCounts();
    res.json({ ok: true, counts });
  });

  app.listen(PORT, () => {
    log.ok("queue", `bullmq server on http://0.0.0.0:${PORT}`);
    log.info("queue", `dashboard: http://localhost:${PORT}/queue`);
    log.info("queue", `webhook: POST http://localhost:${PORT}/webhook`);
  });
}

process.on("uncaughtException", (e) => log.err("queue", `uncaught: ${e.message}`));
process.on("unhandledRejection", (e) => log.err("queue", `unhandled: ${(e as Error)?.message ?? String(e)}`));

main().catch((e) => {
  log.err("queue", `startup failed: ${(e as Error).message}`);
  process.exit(1);
});
