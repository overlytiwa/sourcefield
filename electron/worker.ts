import { parentPort, workerData } from "node:worker_threads";
import { scanProject } from "./analyzer/scan";
import { userMessage } from "../shared/errors";
if (!parentPort) throw new Error("Analyzer must run as a worker.");
scanProject(
  workerData.root,
  (value) => parentPort!.postMessage({ type: "progress", value }),
  workerData.options,
  workerData.previous,
)
  .then((value) => parentPort!.postMessage({ type: "complete", value }))
  .catch((error) =>
    parentPort!.postMessage({
      type: "error",
      error: userMessage(
        error,
        "The project couldn’t be scanned. Try opening it again.",
      ),
    }),
  );
