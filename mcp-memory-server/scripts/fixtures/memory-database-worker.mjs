import { parentPort, workerData } from 'node:worker_threads';
if (!parentPort) throw new Error('fixture requires a worker');
if (workerData.mode === 'bad-ready') parentPort.postMessage({ ready: true, unexpected: true });
else if (workerData.mode === 'stall') parentPort.on('message', () => {});
else {
  parentPort.postMessage({ ready: true });
  parentPort.on('message', message => parentPort.postMessage({ id: message.id, unexpected: 'invalid-response' }));
}
