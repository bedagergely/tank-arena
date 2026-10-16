// patch-v8.ts - Must run before any Colyseus or PM2 imports
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cjsV8 = require("node:v8");

// Read heap_size_limit once at startup
const initialStats = cjsV8.getHeapStatistics();
const cachedLimit = initialStats.heap_size_limit;

const fastGetHeapStatistics = () => {
  const mem = process.memoryUsage();
  return {
    ...initialStats,
    total_heap_size: mem.heapTotal,
    total_physical_size: mem.heapTotal,
    total_available_size: Math.max(0, cachedLimit - mem.heapUsed),
    used_heap_size: mem.heapUsed,
    heap_size_limit: cachedLimit,
    malloced_memory: mem.external,
    external_memory: mem.external,
  };
};

// 1. Delete own property on the CJS export so v8.hasOwnProperty('getHeapStatistics') === false in @pm2/io
delete cjsV8.getHeapStatistics;

// 2. Define getHeapStatistics on the prototype so v8.getHeapStatistics() still works for @colyseus/tools
const proto = Object.getPrototypeOf(cjsV8) || {};
Object.defineProperty(proto, "getHeapStatistics", {
  value: fastGetHeapStatistics,
  writable: true,
  configurable: true,
  enumerable: false,
});
Object.setPrototypeOf(cjsV8, proto);
