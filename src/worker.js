// The worker the island's heavy work runs in (see worldjob.js).
import { createJob } from './worldjob.js';

const handle = createJob((m, transfer) => postMessage(m, transfer));
onmessage = (e) => handle(e.data);
