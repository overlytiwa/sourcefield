import { parentPort, workerData } from "node:worker_threads";
import { readMap, writeMap } from "./format";
import { changeReport } from "./workbench/git";
(async () => {
  if (workerData.task === "read") return readMap(workerData.file);
  if (workerData.task === "write") {
    await writeMap(workerData.file, workerData.map);
    return true;
  }
  if (workerData.task === "changes")
    return changeReport(
      workerData.root,
      workerData.map,
      workerData.ref,
      workerData.rules,
    );
  throw new Error("Unknown background task.");
})().then(
  (value) => parentPort!.postMessage({ ok: true, value }),
  (error) => parentPort!.postMessage({ ok: false, error: error.message }),
);
