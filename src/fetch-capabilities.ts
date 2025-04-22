import axios from "axios";
import {
  getMetaMcpApiBaseUrl,
  getMetaMcpApiKey,
  getMetaMcpProxyServerId,
} from "./utils.js";

export enum ProxyServerCapability { // Renamed enum
  TOOLS_MANAGEMENT = "TOOLS_MANAGEMENT",
  TOOL_LOGS = "TOOL_LOGS",
}

let _proxyServerCapabilitiesCache: ProxyServerCapability[] | null = null; // Renamed cache
let _proxyServerCapabilitiesCacheTimestamp: number = 0; // Renamed timestamp
const CACHE_TTL_MS = 1000; // 1 second cache TTL

export async function getProxyServerCapabilities( // Renamed function
  forceRefresh: boolean = false
): Promise<ProxyServerCapability[]> {
  const currentTime = Date.now();
  const cacheAge = currentTime - _proxyServerCapabilitiesCacheTimestamp; // Use renamed timestamp

  // Use cache if it exists, is not null, and either:
  // 1. forceRefresh is false, or
  // 2. forceRefresh is true but cache is less than 1 second old
  if (
    _proxyServerCapabilitiesCache !== null && // Use renamed cache
    (!forceRefresh || cacheAge < CACHE_TTL_MS)
  ) {
    return _proxyServerCapabilitiesCache; // Use renamed cache
  }

  try {
    const apiKey = getMetaMcpApiKey();
    const apiBaseUrl = getMetaMcpApiBaseUrl();
    const mcpProxyServerId = getMetaMcpProxyServerId(); // Get the proxy server ID

    if (!apiKey) {
      console.error(
        "MCPGARDEN_API_KEY is not set. Please set it via environment variable or command line argument."
      );
      return _proxyServerCapabilitiesCache || []; // Use renamed cache
    }

    if (!mcpProxyServerId) {
      console.error(
        "MCPGARDEN_PROXY_SERVER_ID is not set. Please set it via environment variable or command line argument."
      );
      return _proxyServerCapabilitiesCache || []; // Use renamed cache
    }

    const headers = { Authorization: `Bearer ${apiKey}` };
    const response = await axios.get(
      `${apiBaseUrl}/api/proxy-server-capabilities?mcpProxyServerId=${mcpProxyServerId}`, // Updated API endpoint
      {
        headers,
      }
    );
    const data = response.data;

    // Access the 'proxyServerCapabilities' array in the response
    if (data && data.proxyServerCapabilities) { // Updated data key
      const capabilities = data.proxyServerCapabilities // Updated data key
        .map((capability: string) => {
          // Map string to enum value if it exists, otherwise return undefined
          return ProxyServerCapability[ // Use renamed enum
            capability as keyof typeof ProxyServerCapability // Use renamed enum
          ];
        })
        .filter(
          (
            capability: ProxyServerCapability | undefined // Use renamed enum
          ): capability is ProxyServerCapability => capability !== undefined // Use renamed enum
        );

      _proxyServerCapabilitiesCache = capabilities; // Use renamed cache
      _proxyServerCapabilitiesCacheTimestamp = currentTime; // Use renamed timestamp
      return capabilities;
    }

    return _proxyServerCapabilitiesCache || []; // Use renamed cache
  } catch (error) {
    // Return empty array if API doesn't exist or has errors
    if (_proxyServerCapabilitiesCache !== null) { // Use renamed cache
      return _proxyServerCapabilitiesCache; // Use renamed cache
    }
    return [];
  }
}
