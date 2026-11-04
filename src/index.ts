#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfig } from "./config.js";
import { createServer } from "./server.js";
import { WordPressClient } from "./wordpress.js";

async function main(): Promise<void> {
  const config = readConfig(process.env);
  const client = new WordPressClient(config);
  const server = createServer(client, { readOnly: config.readOnly });
  await server.connect(new StdioServerTransport());
  // stdout is the MCP channel, so status messages go to stderr.
  console.error(
    `wordpress-mcp-server connected to ${config.baseUrl}` +
      (client.isAuthenticated ? " (authenticated)" : " (public read-only)") +
      (config.readOnly ? ", write tools disabled" : ""),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
