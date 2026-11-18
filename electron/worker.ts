import { parentPort, workerData } from 'node:worker_threads';
import { scanProject } from './analyzer/scan';
if (!parentPort) throw new Error('Analyzer must run as a worker.');
scanProject(workerData.root, value => parentPort!.postMessage({ type: 'progress', value }))
  .then(value => parentPort!.postMessage({ type: 'complete', value }))
  .catch(error => parentPort!.postMessage({ type: 'error', error: error instanceof Error ? error.message : 'Analysis failed.' }));
