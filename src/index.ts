#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./mcp-proxy.js";
import { Command } from "commander";
import { reportAllTools } from "./report-tools.js";
import { cleanupAllSessions } from "./sessions.js";
import { startSSEServer } from "./sse.js";

const program = new Command();

program
  .name("mcp-server-metamcp")
  .description("mcp.garden MCP Server - The One MCP to manage all your MCPs")
  .option(
    "--metamcp-api-key <key>",
    "API key for mcp.garden (can also be set via MCPGARDEN_API_KEY env var)"
  )
  .option(
    "--metamcp-api-base-url <url>",
    "Base URL for mcp.garden API (can also be set via MCPGARDEN_API_BASE_URL env var)"
  )
  .option(
    "--report",
    "Fetch all MCPs, initialize clients, and report tools to mcp.garden API"
  )
  .option("--transport <type>", "Transport type to use (stdio or sse)", "stdio")
  .option("--port <port>", "Port to use for SSE transport", "3001")
  .option("--require-api-auth", "Require API key in SSE URL path")
  .parse(process.argv);

const options = program.opts();

// Set environment variables from command line arguments
if (options.metamcpApiKey) {
  process.env.MCPGARDEN_API_KEY = options.metamcpApiKey;
}
if (options.metamcpApiBaseUrl) {
  process.env.MCPGARDEN_API_BASE_URL = options.metamcpApiBaseUrl;
}

async function main() {
  // If --report flag is set, run the reporting function instead of starting the server
  if (options.report) {
    await reportAllTools();
    await cleanupAllSessions();
    return;
  }

  const { server, cleanup } = await createServer();

  if (options.transport.toLowerCase() === "sse") {
    // Start SSE server
    const port = parseInt(options.port) || 12006;
    const sseCleanup = await startSSEServer(server, {
      port,
      requireApiAuth: options.requireApiAuth,
    });

    // Cleanup on exit
    const handleExit = async () => {
      await cleanup();
      await sseCleanup();
      await server.close();
      process.exit(0);
    };

    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);
  } else {
    // Default: Start stdio server
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const handleExit = async () => {
      await cleanup();
      await transport.close();
      await server.close();
      process.exit(0);
    };

    // Cleanup on exit
    process.on("SIGINT", handleExit);
    process.on("SIGTERM", handleExit);

    process.stdin.resume();
    process.stdin.on("end", handleExit);
    process.stdin.on("close", handleExit);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
});
