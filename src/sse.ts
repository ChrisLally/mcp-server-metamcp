import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

export interface SSEServerOptions {
  port: number;
  requireApiAuth?: boolean;
}

// Starts an SSE server and returns a cleanup function
export async function startSSEServer(
  server: Server,
  options: SSEServerOptions
): Promise<() => Promise<void>> {
  const app = express();
  const port = options.port || 12006;
  const requireApiAuth = options.requireApiAuth || false;
  const apiKey = process.env.MCPGARDEN_API_KEY;

  // to support multiple simultaneous connections we have a lookup object from
  // sessionId to transport
  const transports: { [sessionId: string]: SSEServerTransport } = {};

  // Define the SSE endpoint based on authentication requirement
  const sseEndpoint = requireApiAuth ? `/:apiKey/sse` : `/sse`;

  app.get(sseEndpoint, async (req: express.Request, res: express.Response) => {
    // If API auth is required, validate the API key
    if (requireApiAuth) {
      const requestApiKey = req.params.apiKey;
      if (!apiKey || requestApiKey !== apiKey) {
        res.status(401).send("Unauthorized: Invalid API key");
        return;
      }
    }

    // Set the messages path based on authentication requirement
    const messagesPath = requireApiAuth ? `/${apiKey}/messages` : `/messages`;
    const transport = new SSEServerTransport(messagesPath, res);
    transports[transport.sessionId] = transport;
    res.on("close", () => {
      delete transports[transport.sessionId];
    });
    await server.connect(transport);
  });

  // Define the messages endpoint
  const messagesEndpoint = requireApiAuth ? `/:apiKey/messages` : `/messages`;

  app.post(
    messagesEndpoint,
    async (req: express.Request, res: express.Response) => {
      // If API auth is required, validate the API key
      if (requireApiAuth) {
        const requestApiKey = req.params.apiKey;
        if (!apiKey || requestApiKey !== apiKey) {
          res.status(401).send("Unauthorized: Invalid API key");
          return;
        }
      }

      const sessionId = req.query.sessionId as string;
      const transport = transports[sessionId];
      if (transport) {
        await transport.handlePostMessage(req, res);
      } else {
        res.status(400).send("No transport found for sessionId");
      }
    }
  );

  const serverInstance = app.listen(port, () => {
    const baseUrl = `http://localhost:${port}`;
    const sseUrl = requireApiAuth
      ? `${baseUrl}/${apiKey}/sse`
      : `${baseUrl}/sse`;
    console.log(`SSE server listening on port ${port}`);
    console.log(`SSE endpoint: ${sseUrl}`);
  });

  // Return cleanup function
  return async () => {
    // Close all active transports
    await Promise.all(
      Object.values(transports).map((transport) => transport.close())
    );
    serverInstance.close();
  };
}
