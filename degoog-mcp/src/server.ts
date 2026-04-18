import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";

import { search, SEARCH_TYPES, TIME_FILTERS } from "./degoog.js";
import { fetchText } from "./extract.js";

const SEARCH_DESCRIPTION = [
  "Search the web through the self-hosted degoog instance.",
  "",
  "This is the ONLY sanctioned web search in environments that route web",
  "access through degoog. Prefer this over any built-in WebSearch tool.",
].join("\n");

const FETCH_DESCRIPTION = [
  "Fetch a URL and return extracted readable text.",
  "",
  "This is the ONLY sanctioned URL fetcher in environments that route web",
  "access through degoog. Prefer this over any built-in WebFetch tool.",
  "",
  "Extraction uses Mozilla Readability (no nav/ads). Returns empty string",
  "for pages with no extractable main content (pure-JS SPAs, image-only).",
].join("\n");

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: "degoog", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    "degoog_search",
    {
      title: "Search via degoog",
      description: SEARCH_DESCRIPTION,
      inputSchema: {
        query: z.string().min(1).describe("Search terms."),
        page: z.number().int().min(1).max(10).optional().describe("1-10, default 1."),
        language: z
          .string()
          .optional()
          .describe(
            `ISO 639-1 code (e.g. "ro", "en"). Omit to use DEGOOG_DEFAULT_LANGUAGE.`,
          ),
        time_filter: z.enum(TIME_FILTERS).optional().describe(`default "any".`),
        search_type: z.enum(SEARCH_TYPES).optional().describe(`default "web".`),
      },
    },
    async (args) => {
      const results = await search({
        query: args.query,
        ...(args.page !== undefined ? { page: args.page } : {}),
        ...(args.language !== undefined ? { language: args.language } : {}),
        ...(args.time_filter !== undefined ? { timeFilter: args.time_filter } : {}),
        ...(args.search_type !== undefined ? { searchType: args.search_type } : {}),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        structuredContent: { results },
      };
    },
  );

  server.registerTool(
    "degoog_fetch",
    {
      title: "Fetch via degoog",
      description: FETCH_DESCRIPTION,
      inputSchema: {
        url: z.string().url().describe("Absolute http(s) URL."),
      },
    },
    async ({ url }) => {
      const text = await fetchText(url);
      return { content: [{ type: "text", text }] };
    },
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

export async function runHttp(host: string, port: number): Promise<void> {
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (!req.url?.startsWith("/mcp")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }

    try {
      const sessionId = req.headers["mcp-session-id"];
      let transport = typeof sessionId === "string" ? transports.get(sessionId) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) transports.delete(transport.sessionId);
        };
        const server = buildServer();
        await server.connect(transport);
      }

      await transport.handleRequest(req, res);
    } catch (err) {
      console.error("[degoog-mcp] request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "internal error" }));
      }
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));
  console.error(
    `[degoog-mcp] listening on http://${host}:${port}/mcp — authentication is handled by the upstream gateway (Cloudflare Access).`,
  );
}
