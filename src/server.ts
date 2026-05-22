import "dotenv/config";
import cors from "cors";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerTextRewriteTools } from "./register.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 8793);
const version = process.env.npm_package_version || "1.0.0";

function createServer(): McpServer {
  const server = new McpServer(
    { name: "TextRewrite", version },
    { capabilities: { tools: {} } }
  );
  registerTextRewriteTools(server);
  return server;
}

const app = createMcpExpressApp({ host });

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Mcp-Session-Id",
      "mcp-session-id",
      "Mcp-Protocol-Version",
      "mcp-protocol-version",
      "Last-Event-ID",
      "last-event-id"
    ],
    exposedHeaders: ["Mcp-Session-Id", "mcp-session-id", "Mcp-Protocol-Version", "mcp-protocol-version"]
  })
);

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    name: "TextRewrite",
    version,
    endpoint: "/mcp",
    capabilities_configured: {
      instruction_pack: true,
      guard: true,
      compare: true,
      hidden_llm_call: false
    }
  });
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error("MCP request failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
});

app.listen(port, host, () => {
  console.log(`TextRewrite MCP listening on http://${host}:${port}/mcp`);
});
