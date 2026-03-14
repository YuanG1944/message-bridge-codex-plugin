#!/usr/bin/env node
import { startBridge } from '../index.js';

startBridge().catch(error => {
  process.stderr.write(`${String(error.stack || error)}\n`);
  process.exitCode = 1;
});
