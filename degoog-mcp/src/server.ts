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

  // Public base URL the MCP is reachable at (through the tunnel). Used to
  // emit spec-compliant RFC 9728 Protected Resource Metadata so MCP clients
  // can discover the OAuth authorization server. Cloudflare Access only
  // serves its metadata at a proprietary well-known path; we serve the
  // standard one here.
  const publicBaseUrl = process.env.MCP_PUBLIC_BASE_URL;
  const oauthAuthServer = process.env.MCP_OAUTH_AUTHORIZATION_SERVER;

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // MCP OAuth clients (incl. Claude) treat the resource host as the
    // authorization server and ignore PRM's authorization_servers pointing
    // elsewhere. So we advertise self as the AS and proxy/redirect the
    // real OAuth endpoints to Cloudflare Access's team domain.
    if (
      req.url === "/.well-known/oauth-protected-resource" &&
      req.method === "GET"
    ) {
      if (!publicBaseUrl || !oauthAuthServer) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "oauth discovery not configured" }));
        return;
      }
      const base = publicBaseUrl.replace(/\/$/, "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          resource: `${base}/mcp`,
          authorization_servers: [base],
          bearer_methods_supported: ["header"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }

    if (
      req.url === "/.well-known/oauth-authorization-server" &&
      req.method === "GET"
    ) {
      if (!publicBaseUrl || !oauthAuthServer) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "oauth discovery not configured" }));
        return;
      }
      const base = publicBaseUrl.replace(/\/$/, "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ["code"],
          response_modes_supported: ["query"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: [
            "client_secret_basic",
            "client_secret_post",
            "none",
          ],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
        }),
      );
      return;
    }

    if (req.url?.startsWith("/authorize") && req.method === "GET") {
      if (!oauthAuthServer) {
        res.writeHead(500).end("oauth upstream not configured");
        return;
      }
      const upstream = new URL(
        "/cdn-cgi/access/oauth/authorization",
        oauthAuthServer,
      );
      const query = req.url.split("?")[1] ?? "";
      if (query) upstream.search = query;
      res.writeHead(302, { location: upstream.toString() });
      res.end();
      return;
    }

    if (
      (req.url === "/token" || req.url === "/register") &&
      req.method === "POST"
    ) {
      if (!oauthAuthServer) {
        res.writeHead(500).end("oauth upstream not configured");
        return;
      }
      const upstreamPath =
        req.url === "/token"
          ? "/cdn-cgi/access/oauth/token"
          : "/cdn-cgi/access/oauth/registration";
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const body = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        if (typeof req.headers["content-type"] === "string") {
          headers["content-type"] = req.headers["content-type"];
        }
        if (typeof req.headers["authorization"] === "string") {
          headers["authorization"] = req.headers["authorization"];
        }
        const upstreamRes = await fetch(new URL(upstreamPath, oauthAuthServer), {
          method: "POST",
          headers,
          body,
        });
        const resBody = Buffer.from(await upstreamRes.arrayBuffer());
        res.writeHead(upstreamRes.status, {
          "content-type":
            upstreamRes.headers.get("content-type") ?? "application/json",
        });
        res.end(resBody);
      } catch (err) {
        console.error("[degoog-mcp] oauth proxy error:", err);
        if (!res.headersSent) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "bad gateway" }));
        }
      }
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
  if (publicBaseUrl && oauthAuthServer) {
    console.error(
      `[degoog-mcp] exposing /.well-known/oauth-protected-resource → ${oauthAuthServer}`,
    );
  }
}
