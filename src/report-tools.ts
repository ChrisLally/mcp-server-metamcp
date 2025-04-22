import axios from "axios";
import { getMetaMcpApiBaseUrl, getMetaMcpApiKey } from "./utils.js";
import { getMcpServers } from "./fetch-mcp.js";
import { initSessions, getSession } from "./sessions.js";
import { getSessionKey } from "./utils.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Define interface for tool data structure
export interface MetaMcpTool {
  name: string;
  description?: string;
  toolSchema: any;
  mcp_server_id: string;
}

// API route handler for submitting tools to mcp.garden
export async function reportToolsToMetaMcp(tools: MetaMcpTool[]) {
  try {
    const apiKey = getMetaMcpApiKey();
    const apiBaseUrl = getMetaMcpApiBaseUrl();

    if (!apiKey) {
      return { error: "API key not set" };
    }

    // Validate that tools is an array
    if (!Array.isArray(tools) || tools.length === 0) {
      return {
        error: "Request must include a non-empty array of tools",
        status: 400,
      };
    }

    // Validate required fields for all tools and prepare for submission
    const validTools = [];
    const errors = [];

    for (const tool of tools) {
      const { name, description, toolSchema, mcp_server_id } = tool;

      // Validate required fields for each tool
      if (!name || !toolSchema || !mcp_server_id) {
        errors.push({
          tool,
          error:
            "Missing required fields: name, toolSchema, or mcp_server_id",
        });
        continue;
      }

      validTools.push({
        name,
        description,
        toolSchema,
        mcp_server_id,
      });
    }

    // Submit valid tools to mcp.garden API
    let results: any[] = [];
    if (validTools.length > 0) {
      try {
        const response = await axios.post(
          `${apiBaseUrl}/api/tools`,
          { tools: validTools },
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
          }
        );

        results = response.data.results || [];
      } catch (error: any) {
        if (error.response) {
          // The request was made and the server responded with a status code outside of 2xx
          return {
            error: error.response.data.error || "Failed to submit tools",
            status: error.response.status,
            details: error.response.data,
          };
        } else if (error.request) {
          // The request was made but no response was received
          return {
            error: "No response received from server",
            details: error.request,
          };
        } else {
          // Something happened in setting up the request
          return {
            error: "Error setting up request",
            details: error.message,
          };
        }
      }
    }

    return {
      results,
      errors,
      success: results.length > 0,
      failureCount: errors.length,
      successCount: results.length,
    };
  } catch (error: any) {
    return {
      error: "Failed to process tools request",
      status: 500,
    };
  }
}

// Function to fetch all MCP servers, initialize clients, and report tools to mcp.garden API
export async function reportAllTools() {
  console.log("Fetching all MCPs and initializing clients...");

  // Get all MCP servers
  const serverParams = await getMcpServers();

  // Initialize all sessions
  await initSessions();

  console.log(`Found ${Object.keys(serverParams).length} MCP servers`);

  // For each server, get its tools and report them
  await Promise.allSettled(
    Object.entries(serverParams).map(async ([id, params]) => { // Use id
      const sessionKey = getSessionKey(id, params); // Use id
      const session = await getSession(sessionKey, id, params); // Use id

      if (!session) {
        console.log(`Could not establish session for ${params.name} (${id})`); // Use id in log
        return;
      }

      const capabilities = session.client.getServerCapabilities();
      if (!capabilities?.tools) {
        console.log(`Server ${params.name} (${id}) does not support tools`); // Use id in log
        return;
      }

      try {
        console.log(`Fetching tools from ${params.name} (${id})...`); // Use id in log

        const result = await session.client.request(
          { method: "tools/list", params: {} },
          ListToolsResultSchema
        );

        if (result.tools && result.tools.length > 0) {
          console.log(
            `Reporting ${result.tools.length} tools from ${params.name} to mcp.garden API...`
          );

          const reportResult = await reportToolsToMetaMcp(
            result.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              toolSchema: tool.inputSchema,
              mcp_server_id: id, // Use id
            }))
          );

          console.log(
            `Reported tools from ${params.name}: ${reportResult.successCount} succeeded, ${reportResult.failureCount} failed`
          );
        } else {
          console.log(`No tools found for ${params.name}`);
        }
      } catch (error) {
        console.error(`Error reporting tools for ${params.name}:`, error);
      }
    })
  );

  console.log("Finished reporting all tools to mcp.garden API");
  process.exit(0);
}
