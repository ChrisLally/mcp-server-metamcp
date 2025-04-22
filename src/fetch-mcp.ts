import axios from "axios";
import {
  getDefaultEnvironment,
  getMetaMcpApiBaseUrl,
  getMetaMcpApiKey,
  getMetaMcpProxyServerId, // Import the new function
} from "./utils.js";

// Define a new interface for server parameters that can be either STDIO or SSE
export interface ServerParameters {
  id: string;
  name: string;
  description: string;
  type?: "STDIO" | "SSE"; // Optional field, defaults to "STDIO" when undefined
  command?: string | null;
  args?: string[] | null;
  env?: Record<string, string> | null;
  url?: string | null;
  created_at: string;
  proxy_server_id: string; // Corrected field name
  status: string;
}

let _mcpServersCache: Record<string, ServerParameters> | null = null;
let _mcpServersCacheTimestamp: number = 0;
const CACHE_TTL_MS = 1000; // 1 second cache TTL

export async function getMcpServers(
  forceRefresh: boolean = false
): Promise<Record<string, ServerParameters>> {
  const currentTime = Date.now();
  const cacheAge = currentTime - _mcpServersCacheTimestamp;

  // Use cache if it exists, is not null, and either:
  // 1. forceRefresh is false, or
  // 2. forceRefresh is true but cache is less than 1 second old
  if (_mcpServersCache !== null && (!forceRefresh || cacheAge < CACHE_TTL_MS)) {
    return _mcpServersCache;
  }

  try {
    const apiKey = getMetaMcpApiKey();
    const apiBaseUrl = getMetaMcpApiBaseUrl();
    const mcpProxyServerId = getMetaMcpProxyServerId(); // Get the proxy server ID

    if (!apiKey) {
      console.error(
        "MCPGARDEN_API_KEY is not set. Please set it via environment variable or command line argument."
      );
      return _mcpServersCache || {};
    }

    if (!mcpProxyServerId) {
      console.error(
        "MCPGARDEN_PROXY_SERVER_ID is not set. Please set it via environment variable or command line argument."
      );
      return _mcpServersCache || {};
    }

    const headers = { Authorization: `Bearer ${apiKey}` };
    const response = await axios.get(
      `${apiBaseUrl}/api/mcp-servers?mcpProxyServerId=${mcpProxyServerId}`, // Use the retrieved ID
      {
        headers,
      }
    );
    const data = response.data;
    console.error("Raw data received from /api/mcp-servers:", data); // RE-ADDED with console.error

    const serverDict: Record<string, ServerParameters> = {};
    // Check if data is actually an array before iterating
    if (Array.isArray(data)) {
      for (const serverParams of data) {
        try { // Add try block for individual server processing
          console.error("Processing raw serverParam:", serverParams); // Log individual raw param
          const params: ServerParameters = {
            ...serverParams,
            type: serverParams.type || "STDIO",
          };

          // Process based on server type
          if (params.type === "STDIO") {
            if ("args" in params && !params.args) {
              params.args = undefined;
            }

            params.env = {
              ...getDefaultEnvironment(),
              ...(params.env || {}),
            };
          } else if (params.type === "SSE") {
            // For SSE servers, ensure url is present
            if (!params.url) {
              console.warn(
                `SSE server ${params.id} is missing url field, skipping` // Already using id here, which is now correct
              );
              continue;
            }
          }

          // Use the 'id' field from the params object as the key
          const id = params.id; // Use 'id' consistently
          if (id) {
            serverDict[id] = params; // Use id as the key
          } else {
            console.warn("Server data missing 'id' field, skipping:", params);
          }
        } catch (loopError) { // Add catch block for individual server processing
          console.error("Error processing individual serverParam:", serverParams, "Error:", loopError);
        }
      }
    } else {
      console.warn("Received non-array data from /api/mcp-servers, expected an array. Data:", data);
    }

    console.error("Processed serverDict:", serverDict); // RE-ADDED with console.error
    _mcpServersCache = serverDict;
    _mcpServersCacheTimestamp = currentTime;
    return serverDict;
  } catch (error) {
    console.error("Error fetching MCP servers:", error); // RE-ADDED with console.error
    if (_mcpServersCache !== null) {
      console.error("Returning cached MCP servers due to fetch error."); // RE-ADDED with console.error
      return _mcpServersCache;
    }
    console.error("Returning empty MCP server list due to fetch error and empty cache."); // RE-ADDED with console.error
    // Instead of returning empty, let's re-throw the error so the caller knows something went wrong
    // This might provide more useful feedback in the inspector UI if the request fails
    throw new Error(`Failed to fetch MCP servers: ${error instanceof Error ? error.message : String(error)}`);
  }
}
