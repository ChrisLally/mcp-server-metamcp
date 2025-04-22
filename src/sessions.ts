import { getMcpServers, ServerParameters } from "./fetch-mcp.js";
import {
  ConnectedClient,
  createProxyMcpClient,
  connectProxyMcpClient,
} from "./client.js";
import { getSessionKey } from "./utils.js";

const _sessions: Record<string, ConnectedClient> = {};

export const getSession = async (
  sessionKey: string,
  id: string,
  params: ServerParameters
): Promise<ConnectedClient | undefined> => {
  console.error(`getSession called for sessionKey: ${sessionKey}, id: ${id}`); // Use id
  if (sessionKey in _sessions) {
    console.error(`Returning cached session for sessionKey: ${sessionKey}`);
    return _sessions[sessionKey];
  } else {
    console.error(`No cached session found for sessionKey: ${sessionKey}. Attempting to create new session.`);
    // Close existing session for this ID if it exists with a different hash
    const old_session_keys = Object.keys(_sessions).filter((k) =>
      k.startsWith(`${id}_`) // Use id
    );

    await Promise.allSettled(
      old_session_keys.map(async (old_session_key) => {
        await _sessions[old_session_key].cleanup();
        delete _sessions[old_session_key];
      })
    );
    if (old_session_keys.length > 0) {
      console.error(`Found old session(s) for ID ${id} with different params: ${old_session_keys.join(', ')}. Cleaning up...`); // Use id
    }

    console.error(`Calling createProxyMcpClient for ID: ${id}`); // Use id
    const { client, transport } = createProxyMcpClient(params);
    if (!client || !transport) {
      console.error(`Failed to create client or transport for ID: ${id}`); // Use id
      return;
    }

    console.error(`Calling connectProxyMcpClient for ID: ${id}`); // Use id
    const newClient = await connectProxyMcpClient(client, transport);
    if (!newClient) {
      console.error(`Failed to connect client for ID: ${id}`); // Use id
      return;
    }

    console.error(`Successfully created and connected session for sessionKey: ${sessionKey}`); // RE-ADDED with console.error
    _sessions[sessionKey] = newClient;

    return newClient;
  }
};

export const initSessions = async (): Promise<void> => {
  const serverParams = await getMcpServers(true);

  await Promise.allSettled(
    Object.entries(serverParams).map(async ([id, params]) => { // Use id here as well
      const sessionKey = getSessionKey(id, params); // Use id
      try {
        await getSession(sessionKey, id, params); // Use id
      } catch (error) { }
    })
  );
};

export const cleanupAllSessions = async (): Promise<void> => {
  await Promise.allSettled(
    Object.entries(_sessions).map(async ([sessionKey, session]) => {
      await session.cleanup();
      delete _sessions[sessionKey];
    })
  );
};
