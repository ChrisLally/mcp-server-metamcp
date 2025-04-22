import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  StdioServerParameters,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ServerParameters } from "./fetch-mcp.js";

const sleep = (time: number) =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), time));
export interface ConnectedClient {
  client: Client;
  cleanup: () => Promise<void>;
}

export const createMetaMcpClient = (
  serverParams: ServerParameters
): { client: Client | undefined; transport: Transport | undefined } => {
  let transport: Transport | undefined;

  // Create the appropriate transport based on server type
  // Default to "STDIO" if type is undefined
  if (!serverParams.type || serverParams.type === "STDIO") {
    const stdioParams: StdioServerParameters = {
      command: serverParams.command || "",
      args: serverParams.args || undefined,
      env: serverParams.env || undefined,
      stderr: "inherit", // Changed from "ignore" to show logs/errors
    };

    // --- Argument Processing ---
    let processedArgs = stdioParams.args;
    // Check if args is an array with one element that contains spaces, likely needing splitting
    if (Array.isArray(processedArgs) && processedArgs.length === 1 && typeof processedArgs[0] === 'string' && processedArgs[0].includes(' ')) {
      console.error(`Splitting single args element into multiple arguments: "${processedArgs[0]}"`);
      processedArgs = processedArgs[0].split(' ');
      stdioParams.args = processedArgs; // Update stdioParams with split args
    }
    // --- End Argument Processing ---

    console.error(`Creating STDIO transport for server ${serverParams.id} with params:`, stdioParams); // Log potentially modified params
    transport = new StdioClientTransport(stdioParams);
  } else if (serverParams.type === "SSE" && serverParams.url) {
    console.error(`Creating SSE transport for server ${serverParams.id} with URL: ${serverParams.url}`);
    transport = new SSEClientTransport(new URL(serverParams.url));
  } else {
    console.error(`Unsupported or invalid server configuration for ${serverParams.id}:`, serverParams); // Use id
    return { client: undefined, transport: undefined };
  }

  const client = new Client(
    {
      name: "mcp.garden",
      version: "1.0.2",
    },
    {
      capabilities: {
        prompts: {},
        resources: { subscribe: true },
        tools: {},
      },
    }
  );
  return { client, transport };
};

export const connectMetaMcpClient = async (
  client: Client,
  transport: Transport
): Promise<ConnectedClient | undefined> => {
  const waitFor = 2500;
  const retries = 3;
  let count = 0;
  let retry = true;

  while (retry) {
    try {
      console.error(`Attempting to connect client (Attempt ${count + 1}/${retries})...`); // RE-ADDED with console.error
      await client.connect(transport);
      console.error(`Client connected successfully (Attempt ${count + 1}/${retries}).`); // RE-ADDED with console.error

      return {
        client,
        cleanup: async () => {
          await transport.close();
          await client.close();
        },
      };
    } catch (error) {
      count++;
      retry = count < retries;
      console.error(`Connection attempt ${count}/${retries} failed:`, error); // RE-ADDED with console.error
      if (retry) {
        console.error(`Retrying connection in ${waitFor}ms...`); // RE-ADDED with console.error
        try {
          await client.close();
        } catch { }
        await sleep(waitFor);
      } else {
        console.error(`Connection failed after ${retries} attempts.`); // RE-ADDED with console.error
        // Re-throw the error after final attempt fails to notify the caller
        throw new Error(`Connection failed after ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  // This part should ideally not be reached if the loop throws on final failure
  return undefined;
};
