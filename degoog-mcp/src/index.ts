#!/usr/bin/env node
import { parseArgs } from "node:util";

import { runHttp, runStdio } from "./server.js";

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      transport: { type: "string", default: "stdio" },
      host: { type: "string", default: "127.0.0.1" },
      port: { type: "string", default: "8765" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      [
        "Usage: degoog-mcp [--transport stdio|http] [--host HOST] [--port PORT]",
        "",
        "Environment:",
        "  DEGOOG_URL                degoog base URL (default http://degoog.local:4444)",
        "  DEGOOG_DEFAULT_LANGUAGE   ISO 639-1 code (default ro)",
        "  DEGOOG_TIMEOUT_MS         request timeout ms (default 15000)",
        "",
        "NOTE: http transport has no app-layer auth. Always run it behind an",
        "upstream gateway (Cloudflare Access, etc.) that authenticates callers.",
        "",
      ].join("\n"),
    );
    return 0;
  }

  if (values.transport === "stdio") {
    await runStdio();
    return 0;
  }

  if (values.transport !== "http") {
    console.error(`[degoog-mcp] unknown transport: ${values.transport}`);
    return 2;
  }

  const port = Number.parseInt(values.port!, 10);
  if (Number.isNaN(port)) {
    console.error(`[degoog-mcp] invalid port: ${values.port}`);
    return 2;
  }
  await runHttp(values.host!, port);
  return 0;
}

main().then(
  (code) => {
    if (code !== 0) process.exit(code);
  },
  (err) => {
    console.error("[degoog-mcp] fatal:", err);
    process.exit(1);
  },
);
