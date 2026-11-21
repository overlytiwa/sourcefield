import type { Worker } from "node:worker_threads";
import type { ActionResult, CodeMap, ScanProgress } from "../shared/types";
import { userMessage } from "../shared/errors";
/** A worker can exit immediately after posting complete. Finalizing project
 * state is asynchronous, so exit must not cancel an acknowledged result. */
export function collectScan(
  worker: Pick<Worker, "on" | "terminate">,
  isCurrent: () => boolean,
  activate: (map: CodeMap) => Promise<void>,
  progress: (p: ScanProgress) => void,
): Promise<ActionResult<CodeMap>> {
  return new Promise((resolve) => {
    let settled = false,
      completing = false;
    const cancel = (): ActionResult<CodeMap> => ({
      ok: false,
      cancelled: true,
      error: "Cancelled",
    });
    function finish(result: ActionResult<CodeMap>) {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve(result);
    }
    worker.on("message", async (message) => {
      if (settled) return;
      if (message.type === "progress" && isCurrent()) progress(message.value);
      if (message.type === "error")
        finish({ ok: false, error: userMessage(message.error) });
      if (message.type === "complete" && !completing) {
        completing = true;
        if (!isCurrent()) {
          finish(cancel());
          return;
        }
        try {
          await activate(message.value);
          finish(isCurrent() ? { ok: true, value: message.value } : cancel());
        } catch (error) {
          finish(
            isCurrent() ? { ok: false, error: userMessage(error) } : cancel(),
          );
        }
      }
    });
    worker.on("error", (error) =>
      finish({ ok: false, error: userMessage(error) }),
    );
    worker.on("exit", (code) => {
      if (!settled && !completing)
        finish(
          !isCurrent() || code === 0
            ? cancel()
            : { ok: false, error: "The scan stopped. Try a smaller project." },
        );
    });
  });
}
