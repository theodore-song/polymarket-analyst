const INTERVAL_MS = 60000;

postMessage({ type: "ready", at: Date.now() });

self.onmessage = event => {
  if(event.data && event.data.type === "ping") postMessage({ type: "ready", at: Date.now() });
};

setInterval(() => {
  postMessage({ type: "cycle", at: Date.now() });
}, INTERVAL_MS);
