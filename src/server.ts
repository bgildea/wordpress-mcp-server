import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { WordPressClient, WordPressError } from "./wordpress.js";

export interface ServerOptions {
  /** When true, tools that change the site are not registered. */
  readOnly?: boolean;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  const message =
    error instanceof WordPressError
      ? error.message
      : error instanceof Error
        ? `Unexpected error: ${error.message}`
        : "Unexpected error";
  return { content: [{ type: "text", text: message }], isError: true };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

export function createServer(client: WordPressClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({ name: "wordpress-mcp-server", version: "0.1.0" });

  server.registerTool(
    "get_site_info",
    {
      title: "Get site info",
      description: "Return the WordPress site's name, tagline, URL and available REST namespaces.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(() => client.getSiteInfo()),
  );

  server.registerTool(
    "list_posts",
    {
      title: "List posts or pages",
      description:
        "List posts or pages, newest first. Supports keyword search, status filter and paging. Non-published statuses need credentials.",
      inputSchema: {
        type: z.enum(["posts", "pages"]).default("posts"),
        search: z.string().max(200).optional().describe("Keyword search across title and content"),
        status: z.enum(["publish", "draft", "pending", "private", "future", "any"]).default("publish"),
        per_page: z.number().int().min(1).max(100).default(10),
        page: z.number().int().min(1).default(1),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ type, search, status, per_page, page }) =>
      run(() => client.listPosts({ type, search, status, perPage: per_page, page })),
  );

  server.registerTool(
    "get_post",
    {
      title: "Get a post or page",
      description: "Fetch one post or page by ID, with its content as plain text.",
      inputSchema: {
        id: z.number().int().positive(),
        type: z.enum(["posts", "pages"]).default("posts"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ id, type }) => run(() => client.getPost(id, type)),
  );

  server.registerTool(
    "list_plugins",
    {
      title: "List plugins",
      description: "List installed plugins with version and active status. Requires an administrator account.",
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    () => run(() => client.listPlugins()),
  );

  if (!options.readOnly) {
    server.registerTool(
      "create_draft_post",
      {
        title: "Create a draft post",
        description:
          "Create a new post as a DRAFT for a human to review. This tool cannot publish, edit or delete existing content.",
        inputSchema: {
          title: z.string().min(1).max(300),
          content: z.string().min(1).describe("Post body as HTML or plain text"),
          excerpt: z.string().max(1000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      },
      ({ title, content, excerpt }) => run(() => client.createDraft({ title, content, excerpt })),
    );
  }

  return server;
}
