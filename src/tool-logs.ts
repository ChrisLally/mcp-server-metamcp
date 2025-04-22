import axios from "axios";
import {
  getMetaMcpApiBaseUrl,
  getMetaMcpApiKey,
  getMetaMcpProxyServerId, // Import the function
} from "./utils.js";
import {
  ProxyServerCapability, // Use new enum name
  getProxyServerCapabilities, // Use new function name
} from "./fetch-capabilities.js";

// Define status enum for tool execution
export enum ToolExecutionStatus {
  SUCCESS = "SUCCESS",
  ERROR = "ERROR",
  PENDING = "PENDING",
}

// Define interface for tool execution log data
export interface ToolExecutionLog {
  id?: string;
  tool_name: string;
  payload: any;
  status: ToolExecutionStatus;
  result?: any;
  mcp_server_id: string;
  error_message?: string | null;
  execution_time_ms: number;
  created_at?: string;
  updated_at?: string;
}

// Response interfaces
export interface ToolLogResponse {
  id?: string;
  success: boolean;
  data?: any;
  error?: string;
  status?: number;
  details?: any;
}

// Class to manage tool execution logs
export class ToolLogManager {
  private static instance: ToolLogManager;
  private logStore: Map<string, ToolExecutionLog> = new Map();

  private constructor() { }

  public static getInstance(): ToolLogManager {
    if (!ToolLogManager.instance) {
      ToolLogManager.instance = new ToolLogManager();
    }
    return ToolLogManager.instance;
  }

  /**
   * Creates a new tool execution log
   * @param toolName Name of the tool
   * @param serverId ID of the MCP server
   * @param payload The input parameters for the tool
   * @returns Log object with tracking ID
   */
  public async createLog(
    toolName: string,
    serverId: string, // Renamed parameter
    payload: any
  ): Promise<ToolExecutionLog> {
    // Check for TOOL_LOGS capability first
    const proxyServerCapabilities = await getProxyServerCapabilities();
    const hasToolsLogCapability = proxyServerCapabilities.includes(
      ProxyServerCapability.TOOL_LOGS // Use new enum name
    );

    // Generate a temporary ID for tracking
    const tempId = `${Date.now()}-${Math.random()
      .toString(36)
      .substring(2, 9)}`;

    const log: ToolExecutionLog = {
      id: tempId, // Will be replaced with the real ID from the API
      tool_name: toolName,
      mcp_server_id: serverId, // Use renamed parameter
      payload,
      status: ToolExecutionStatus.PENDING,
      execution_time_ms: 0,
      created_at: new Date().toISOString(),
    };

    // Store in memory
    this.logStore.set(tempId, log);

    // Submit to API only if TOOL_LOGS capability is present
    if (hasToolsLogCapability) {
      const response = await reportToolExecutionLog(log);

      // Update with real ID if available
      if (response.success && response.data?.id) {
        const newId = response.data.id;
        log.id = newId;
        this.logStore.delete(tempId);
        this.logStore.set(newId, log);
      }
    }

    return log;
  }

  /**
   * Updates the status of a tool execution log
   * @param logId ID of the log to update
   * @param status New status
   * @param result Optional result data
   * @param errorMessage Optional error message
   * @param executionTimeMs Optional execution time in milliseconds
   * @returns Updated log
   */
  public async updateLogStatus(
    logId: string,
    status: ToolExecutionStatus,
    result?: any,
    errorMessage?: string | null,
    executionTimeMs?: number
  ): Promise<ToolExecutionLog | null> {
    const log = this.logStore.get(logId);

    if (!log) {
      console.error(`Cannot update log: Log with ID ${logId} not found`);
      return null;
    }

    // Update log properties
    log.status = status;
    if (result !== undefined) log.result = result;
    if (errorMessage !== undefined) log.error_message = errorMessage;
    if (executionTimeMs !== undefined) log.execution_time_ms = executionTimeMs;
    log.updated_at = new Date().toISOString();

    // Update in memory
    this.logStore.set(logId, log);

    // Check for TOOL_LOGS capability before sending update to API
    const proxyServerCapabilities = await getProxyServerCapabilities(); // Use new function name
    const hasToolsLogCapability = proxyServerCapabilities.includes(
      ProxyServerCapability.TOOL_LOGS // Use new enum name
    );

    // Send update to API only if TOOL_LOGS capability is present
    if (hasToolsLogCapability) {
      await updateToolExecutionLog(logId, {
        status,
        result,
        error_message: errorMessage,
        execution_time_ms: executionTimeMs,
      });
    }

    return log;
  }

  /**
   * Get a log by ID
   * @param logId ID of the log
   * @returns Log or null if not found
   */
  public getLog(logId: string): ToolExecutionLog | null {
    return this.logStore.get(logId) || null;
  }

  /**
   * Complete the tool execution log with success status
   * @param logId ID of the log to complete
   * @param result Result data
   * @param executionTimeMs Execution time in milliseconds
   * @returns Updated log
   */
  public async completeLog(
    logId: string,
    result: any,
    executionTimeMs: number
  ): Promise<ToolExecutionLog | null> {
    return this.updateLogStatus(
      logId,
      ToolExecutionStatus.SUCCESS,
      result,
      null,
      executionTimeMs
    );
  }

  /**
   * Mark the tool execution log as failed
   * @param logId ID of the log to fail
   * @param errorMessage Error message
   * @param executionTimeMs Execution time in milliseconds
   * @returns Updated log
   */
  public async failLog(
    logId: string,
    errorMessage: string,
    executionTimeMs: number
  ): Promise<ToolExecutionLog | null> {
    return this.updateLogStatus(
      logId,
      ToolExecutionStatus.ERROR,
      null,
      errorMessage,
      executionTimeMs
    );
  }
}

/**
 * Reports a tool execution log to the mcp.garden API
 * @param logData The tool execution log data
 * @returns Result of the API call
 */
export async function reportToolExecutionLog(
  logData: ToolExecutionLog
): Promise<ToolLogResponse> {
  try {
    // Check for TOOL_LOGS capability first
    const proxyServerCapabilities = await getProxyServerCapabilities(); // Use new function name
    const hasToolsLogCapability = proxyServerCapabilities.includes(
      ProxyServerCapability.TOOL_LOGS // Use new enum name
    );

    if (!hasToolsLogCapability) {
      return { success: false, error: "TOOL_LOGS capability not enabled" };
    }

    const apiKey = getMetaMcpApiKey();
    const apiBaseUrl = getMetaMcpApiBaseUrl();
    const mcpProxyServerId = getMetaMcpProxyServerId(); // Get the proxy server ID

    if (!apiKey) {
      return { success: false, error: "API key not set" };
    }

    if (!mcpProxyServerId) {
      return { success: false, error: "Proxy Server ID not set" };
    }

    // Validate required fields
    if (!logData.tool_name || !logData.mcp_server_id) {
      return {
        success: false,
        error: "Missing required fields: tool_name or mcp_server_id",
        status: 400,
      };
    }

    // Submit log to mcp.garden API
    try {
      const response = await axios.post(
        `${apiBaseUrl}/api/tool-execution-logs?mcpProxyServerId=${mcpProxyServerId}`, // Add proxy ID
        logData,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      if (error.response) {
        // The request was made and the server responded with a status code outside of 2xx
        return {
          success: false,
          error:
            error.response.data.error || "Failed to submit tool execution log",
          status: error.response.status,
          details: error.response.data,
        };
      } else if (error.request) {
        // The request was made but no response was received
        return {
          success: false,
          error: "No response received from server",
          details: error.request,
        };
      } else {
        // Something happened in setting up the request
        return {
          success: false,
          error: "Error setting up request",
          details: error.message,
        };
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: "Failed to process tool execution log request",
      status: 500,
      details: error.message,
    };
  }
}

/**
 * Updates an existing tool execution log
 * @param logId The ID of the log to update
 * @param updateData The updated log data
 * @returns Result of the API call
 */
export async function updateToolExecutionLog(
  logId: string,
  updateData: Partial<ToolExecutionLog>
): Promise<ToolLogResponse> {
  try {
    // Check for TOOL_LOGS capability first
    const proxyServerCapabilities = await getProxyServerCapabilities(); // Use new function name
    const hasToolsLogCapability = proxyServerCapabilities.includes(
      ProxyServerCapability.TOOL_LOGS // Use new enum name
    );

    if (!hasToolsLogCapability) {
      return { success: false, error: "TOOL_LOGS capability not enabled" };
    }

    const apiKey = getMetaMcpApiKey();
    const apiBaseUrl = getMetaMcpApiBaseUrl();
    const mcpProxyServerId = getMetaMcpProxyServerId(); // Get the proxy server ID

    if (!apiKey) {
      return { success: false, error: "API key not set" };
    }

    if (!mcpProxyServerId) {
      return { success: false, error: "Proxy Server ID not set" };
    }

    if (!logId) {
      return {
        success: false,
        error: "Log ID is required for updates",
      };
    }

    // Submit update to mcp.garden API
    try {
      const response = await axios.put(
        `${apiBaseUrl}/api/tool-execution-logs/${logId}?mcpProxyServerId=${mcpProxyServerId}`, // Add proxy ID
        updateData,
        {
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
        }
      );

      return {
        success: true,
        data: response.data,
      };
    } catch (error: any) {
      if (error.response) {
        return {
          success: false,
          error:
            error.response.data.error || "Failed to update tool execution log",
          status: error.response.status,
          details: error.response.data,
        };
      } else if (error.request) {
        return {
          success: false,
          error: "No response received from server",
          details: error.request,
        };
      } else {
        return {
          success: false,
          error: "Error setting up request",
          details: error.message,
        };
      }
    }
  } catch (error: any) {
    return {
      success: false,
      error: "Failed to process update request",
      status: 500,
      details: error.message,
    };
  }
}

/**
 * Simple function to log a tool execution
 * @param toolName Name of the tool
 * @param serverId ID of the MCP server
 * @param payload The input parameters for the tool
 * @param result The result of the tool execution
 * @param status Status of the execution
 * @param errorMessage Optional error message if execution failed
 * @param executionTimeMs Time taken to execute the tool in milliseconds
 * @returns Result of the API call
 */
export async function logToolExecution(
  toolName: string,
  serverId: string, // Renamed parameter
  payload: any,
  result: any = null,
  status: ToolExecutionStatus = ToolExecutionStatus.SUCCESS,
  errorMessage: string | null = null,
  executionTimeMs: number = 0
): Promise<ToolLogResponse> {
  // Check for TOOL_LOGS capability first
  const proxyServerCapabilities = await getProxyServerCapabilities(); // Use new function name
  const hasToolsLogCapability = proxyServerCapabilities.includes(
    ProxyServerCapability.TOOL_LOGS // Use new enum name
  );

  if (!hasToolsLogCapability) {
    return { success: false, error: "TOOL_LOGS capability not enabled" };
  }

  const logData: ToolExecutionLog = {
    tool_name: toolName,
    mcp_server_id: serverId, // Use renamed parameter
    payload,
    status,
    result,
    error_message: errorMessage,
    execution_time_ms: executionTimeMs,
  };

  return await reportToolExecutionLog(logData);
}
