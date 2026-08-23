import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const worker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const cycleWorker = fs.readFileSync(new URL("../cycle-worker.js", import.meta.url), "utf8");
const build = Number(index.match(/const BUILD_VERSION = (\d+);/)?.[1]);
const cacheBuild = Number(worker.match(/polymarket-arena-build-(\d+)/)?.[1]);

assert.ok(Number.isInteger(build));
assert.equal(cacheBuild, build, "Service-worker cache must advance with the deployed build");
assert.match(worker, /keys\.filter\(key => key !== CACHE_NAME\)/);
assert.match(worker, /fetch\(event\.request\)\.then\(response =>/);
assert.match(worker, /\.catch\(\(\) => caches\.match\(event\.request\)\)/);
assert.doesNotMatch(worker, /caches\.match\(event\.request\)\.then\(cached => cached \|\| fetch/);
assert.match(worker, /"\/cycle-worker\.js"/);
assert.match(cycleWorker, /const INTERVAL_MS = 60000;/);
assert.match(index, /requires_live:true/);
assert.match(index, /runMode==="live"\|\|!next\.requires_live/);
assert.match(index, /adaptive_probation:s\.adaptive_probation/);
assert.match(index, /probation_exit_hours:s\.probation_exit_hours/);
assert.match(index, /awaiting-probation-executable-exit/);

console.log(`offline runtime verified for Build ${build}`);
