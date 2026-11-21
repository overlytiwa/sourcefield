import { Worker } from "node:worker_threads";
import path from "node:path";
import { UserError } from "../shared/errors";
export function background<T>(data: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "task-worker.cjs"), {
      workerData: data,
    });
    let settled = false;
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Background operation timed out."));
    }, 180000);
    const finish = () => {
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
    };
    worker.once("message", (reply) => {
      finish();
      reply.ok
        ? resolve(reply.value)
        : reject(
            new UserError(reply.error, reply.errorCode ?? "BACKGROUND_FAILED"),
          );
    });
    worker.once("error", (error) => {
      finish();
      reject(error);
    });
    worker.once("exit", () => {
      if (!settled) {
        finish();
        reject(new Error("Background operation stopped."));
      }
    });
  });
}
