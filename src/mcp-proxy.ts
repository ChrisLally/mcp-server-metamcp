import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  ListToolsResultSchema,
  ListPromptsResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ListResourceTemplatesRequestSchema,
  ListResourceTemplatesResultSchema,
  ResourceTemplate,
  CompatibilityCallToolResultSchema,
  GetPromptResultSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getMcpServers } from "./fetch-mcp.js";
import { getSessionKey, sanitizeName } from "./utils.js";
import { cleanupAllSessions, getSession, initSessions } from "./sessions.js";
import { ConnectedClient } from "./client.js";
import { reportToolsToProxyMcp } from "./report-tools.js";
import { getInactiveTools, ToolParameters } from "./fetch-tools.js";
import {
  getProxyServerCapabilities, // Use new function name
  ProxyServerCapability, // Use new enum name
} from "./fetch-capabilities.js";
import { ToolLogManager } from "./tool-logs.js";

const toolToClient: Record<string, ConnectedClient> = {};
const toolToServerId: Record<string, string> = {}; // Renamed map
const promptToClient: Record<string, ConnectedClient> = {};
const resourceToClient: Record<string, ConnectedClient> = {};
const inactiveToolsMap: Record<string, boolean> = {};

export const createServer = async () => {
  const server = new Server(
    {
      name: "mcp.garden",
      version: "1.0.2",
    },
    {
      capabilities: {
        prompts: {},
        resources: {},
        tools: {},
      },
    }
  );

  // Initialize sessions in the background when server starts
  initSessions().catch();

  // List Tools Handler
  server.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const proxyServerCapabilities = await getProxyServerCapabilities(true); // Use new function name
    const serverParams = await getMcpServers(true);
    // console.log("Fetched serverParams:", serverParams); // REMOVED: Interferes with stdio

    // Fetch inactive tools only if tools management capability is present
    let inactiveTools: Record<string, ToolParameters> = {};
    if (proxyServerCapabilities.includes(ProxyServerCapability.TOOLS_MANAGEMENT)) { // Use new enum name
      inactiveTools = await getInactiveTools(true);
      // Clear existing inactive tools map before rebuilding
      Object.keys(inactiveToolsMap).forEach(
        (key) => delete inactiveToolsMap[key]
      );
    }

    const allTools: Tool[] = [];

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([id, params]) => { // Use id from object key
        // console.log(`Processing server ID: ${id}`); // Keep commented out
        // console.log("Server Parameters:", params); // Keep commented out

        // Log SSE info if applicable
        // if (params.type === "SSE") { // Keep commented out
        //   console.log(`SSE Server URL: ${params.url}`);
        // }

        const sessionKey = getSessionKey(id, params); // Pass id
        const session = await getSession(sessionKey, id, params); // Pass id
        if (!session) {
          // console.log(`No active session found for id: ${id}, skipping.`); // Keep commented out
          return;
        }

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.tools) {
          // console.log(`Server ${id} does not have tool capabilities, skipping.`); // Keep commented out
          return;
        }

        const serverName = session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "tools/list",
              params: { _meta: request.params?._meta },
            },
            ListToolsResultSchema
          );

          // console.log(`Raw tools received from ${serverName} (ID: ${id}):`, result.tools); // Keep commented out

          const toolsWithSource =
            result.tools
              ?.filter((tool) => {
                // Only filter inactive tools if tools management is enabled
                if (
                  proxyServerCapabilities.includes(
                    ProxyServerCapability.TOOLS_MANAGEMENT
                  )
                ) {
                  return !inactiveTools[`${id}:${tool.name}`]; // Use id
                }
                return true;
              })
              .map((tool) => {
                const toolName = `${sanitizeName(serverName)}__${tool.name}`;
                toolToClient[toolName] = session;
                toolToServerId[toolName] = id; // Use renamed map
                return {
                  ...tool,
                  name: toolName,
                  description: `[${serverName}] ${tool.description || ""}`,
                };
              }) || [];

          // Update our inactive tools map only if tools management is enabled
          if (
            proxyServerCapabilities.includes(ProxyServerCapability.TOOLS_MANAGEMENT) // Use new names
          ) {
            result.tools?.forEach((tool) => {
              const isInactive = inactiveTools[`${id}:${tool.name}`]; // Use id
              if (isInactive) {
                const formattedName = `${sanitizeName(serverName)}__${tool.name}`;
                inactiveToolsMap[formattedName] = true;
              }
            });

            // Report full tools for this server
            reportToolsToProxyMcp(
              result.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                toolSchema: tool.inputSchema,
                mcp_server_id: id, // Use id
              }))
            ).catch();
          }

          allTools.push(...toolsWithSource);
        } catch (error) {
          console.error(`Error fetching tools from: ${serverName}`, error);
        }
      })
    );

    return { tools: allTools };
  });

  // Call Tool Handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const originalToolName = name.split("__")[1];
    const clientForTool = toolToClient[name];
    const toolLogManager = ToolLogManager.getInstance();
    let logId: string | undefined;
    let startTime = Date.now();

    if (!clientForTool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Get MCP server ID for the tool
    const mcpServerId = toolToServerId[name] || ""; // Use renamed map

    if (!mcpServerId) {
      console.error(`Could not determine MCP server ID for tool: ${name}`);
    }

    // Get proxy server capabilities
    const proxyServerCapabilities = await getProxyServerCapabilities(); // Use new function name

    // Only check inactive tools if tools management capability is present
    if (
      proxyServerCapabilities.includes(ProxyServerCapability.TOOLS_MANAGEMENT) && // Use new names
      inactiveToolsMap[name]
    ) {
      throw new Error(`Tool is inactive: ${name}`);
    }

    // Check if TOOL_LOGS capability is enabled
    const hasToolsLogCapability = proxyServerCapabilities.includes(
      ProxyServerCapability.TOOL_LOGS // Use new enum name
    );

    try {
      // Create initial pending log only if TOOL_LOGS capability is present
      if (hasToolsLogCapability) {
        const log = await toolLogManager.createLog(
          originalToolName,
          mcpServerId, // Use renamed variable
          args || {}
        );
        logId = log.id;
      }

      // Reset the timer right before making the actual tool call
      startTime = Date.now();

      // Use the correct schema for tool calls
      const result = await clientForTool.client.request(
        {
          method: "tools/call",
          params: {
            name: originalToolName,
            arguments: args || {},
            _meta: {
              progressToken: request.params._meta?.progressToken,
            },
          },
        },
        CompatibilityCallToolResultSchema
      );

      const executionTime = Date.now() - startTime;

      // Update log with success result only if TOOL_LOGS capability is present
      if (hasToolsLogCapability && logId) {
        try {
          await toolLogManager.completeLog(logId, result, executionTime);
        } catch (logError) { }
      }

      return result;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      // Update log with error only if TOOL_LOGS capability is present
      if (hasToolsLogCapability && logId) {
        try {
          await toolLogManager.failLog(
            logId,
            error.message || "Unknown error",
            executionTime
          );
        } catch (logError) { }
      }

      console.error(
        `Error calling tool "${name}" through ${clientForTool.client.getServerVersion()?.name || "unknown"
        }:`,
        error
      );
      throw error;
    }
  });

  // Get Prompt Handler
  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name } = request.params;
    const clientForPrompt = promptToClient[name];

    if (!clientForPrompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }

    try {
      const promptName = name.split("__")[1];
      const response = await clientForPrompt.client.request(
        {
          method: "prompts/get",
          params: {
            name: promptName,
            arguments: request.params.arguments || {},
            _meta: request.params._meta,
          },
        },
        GetPromptResultSchema
      );

      return response;
    } catch (error) {
      console.error(
        `Error getting prompt through ${clientForPrompt.client.getServerVersion()?.name
        }:`,
        error
      );
      throw error;
    }
  });

  // List Prompts Handler
  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    const serverParams = await getMcpServers(true);
    const allPrompts: z.infer<typeof ListPromptsResultSchema>["prompts"] = [];

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([id, params]) => { // Use id
        const sessionKey = getSessionKey(id, params); // Use id
        const session = await getSession(sessionKey, id, params); // Use id
        if (!session) return;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.prompts) return;

        const serverName = session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "prompts/list",
              params: {
                cursor: request.params?.cursor,
                _meta: request.params?._meta,
              },
            },
            ListPromptsResultSchema
          );

          if (result.prompts) {
            const promptsWithSource = result.prompts.map((prompt) => {
              const promptName = `${sanitizeName(serverName)}__${prompt.name}`;
              promptToClient[promptName] = session;
              return {
                ...prompt,
                name: promptName,
                description: `[${serverName}] ${prompt.description || ""}`,
              };
            });
            allPrompts.push(...promptsWithSource);
          }
        } catch (error) {
          console.error(`Error fetching prompts from: ${serverName}`, error);
        }
      })
    );

    return {
      prompts: allPrompts,
      nextCursor: request.params?.cursor,
    };
  });

  // List Resources Handler
  server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
    const serverParams = await getMcpServers(true);
    const allResources: z.infer<typeof ListResourcesResultSchema>["resources"] =
      [];

    await Promise.allSettled(
      Object.entries(serverParams).map(async ([id, params]) => { // Use id
        const sessionKey = getSessionKey(id, params); // Use id
        const session = await getSession(sessionKey, id, params); // Use id
        if (!session) return;

        const capabilities = session.client.getServerCapabilities();
        if (!capabilities?.resources) return;

        const serverName = session.client.getServerVersion()?.name || "";
        try {
          const result = await session.client.request(
            {
              method: "resources/list",
              params: {
                cursor: request.params?.cursor,
                _meta: request.params?._meta,
              },
            },
            ListResourcesResultSchema
          );

          if (result.resources) {
            const resourcesWithSource = result.resources.map((resource) => {
              resourceToClient[resource.uri] = session;
              return {
                ...resource,
                name: `[${serverName}] ${resource.name || ""}`,
              };
            });
            allResources.push(...resourcesWithSource);
          }
        } catch (error) {
          console.error(`Error fetching resources from: ${serverName}`, error);
        }
      })
    );

    return {
      resources: allResources,
      nextCursor: request.params?.cursor,
    };
  });

  // Read Resource Handler
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const clientForResource = resourceToClient[uri];

    if (!clientForResource) {
      throw new Error(`Unknown resource: ${uri}`);
    }

    try {
      return await clientForResource.client.request(
        {
          method: "resources/read",
          params: {
            uri,
            _meta: request.params._meta,
          },
        },
        ReadResourceResultSchema
      );
    } catch (error) {
      console.error(
        `Error reading resource through ${clientForResource.client.getServerVersion()?.name
        }:`,
        error
      );
      throw error;
    }
  });

  // List Resource Templates Handler
  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (request) => {
      const serverParams = await getMcpServers(true);
      const allTemplates: ResourceTemplate[] = [];

      await Promise.allSettled(
        Object.entries(serverParams).map(async ([id, params]) => { // Use id
          const sessionKey = getSessionKey(id, params); // Use id
          const session = await getSession(sessionKey, id, params); // Use id
          if (!session) return;

          const capabilities = session.client.getServerCapabilities();
          if (!capabilities?.resources) return;

          const serverName = session.client.getServerVersion()?.name || "";
          try {
            const result = await session.client.request(
              {
                method: "resources/templates/list",
                params: {
                  cursor: request.params?.cursor,
                  _meta: request.params?._meta,
                },
              },
              ListResourceTemplatesResultSchema
            );

            if (result.resourceTemplates) {
              const templatesWithSource = result.resourceTemplates.map(
                (template) => ({
                  ...template,
                  name: `[${serverName}] ${template.name || ""}`,
                })
              );
              allTemplates.push(...templatesWithSource);
            }
          } catch (error) {
            return;
          }
        })
      );

      return {
        resourceTemplates: allTemplates,
        nextCursor: request.params?.cursor,
      };
    }
  );

  const cleanup = async () => {
    await cleanupAllSessions();
  };

  return { server, cleanup };
};
