#!/usr/bin/env node
import { spawn } from "node:child_process";

const probeArgs = process.argv.slice(2);
if (probeArgs.length === 0) {
  console.error("usage: probe-memory-server.mjs PATH_TO_SERVER | --command COMMAND [ARGS...]");
  process.exit(2);
}

const commandMode = probeArgs[0] === "--command";
const command = commandMode ? probeArgs[1] : process.execPath;
const commandArgs = commandMode ? probeArgs.slice(2) : [probeArgs[0]];
if (!command) {
  console.error("probe-memory-server.mjs: --command requires a command");
  process.exit(2);
}

const child = spawn(command, commandArgs, {
  env: process.env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk).slice(-2000);
});

const response = new Promise((resolve, reject) => {
  let buffered = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (
          message.id === 1 &&
          message.result?.serverInfo?.name === "cairn-memory" &&
          message.result?.capabilities?.tools
        ) {
          resolve();
          return;
        }
      } catch {
        // Ignore non-protocol output while waiting for the initialize response.
      }
    }
  });
  child.once("error", reject);
  child.once("exit", (code) => reject(new Error(`server exited with status ${code}`)));
});

const timeout = new Promise((_, reject) => {
  setTimeout(() => reject(new Error("MCP initialize timed out")), 5000).unref();
});

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cairn-doctor", version: "1.0" },
  },
};

try {
  child.stdin.end(`${JSON.stringify(initialize)}\n`);
  await Promise.race([response, timeout]);
} catch (error) {
  const detail = stderr.trim() || error.message;
  console.error(`memory server probe failed: ${detail}`);
  process.exitCode = 1;
} finally {
  child.kill();
}
