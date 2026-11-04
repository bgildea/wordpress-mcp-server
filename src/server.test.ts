import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { readConfig } from "./config.js";
import { createServer } from "./server.js";
import { WordPressClient, type FetchLike } from "./wordpress.js";

async function connect(client: WordPressClient, readOnly = false) {
  const server = createServer(client, { readOnly });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

function fakeWordPress(handler: (url: URL, init?: RequestInit) => unknown) {
  return vi.fn<FetchLike>(async (input, init) => {
    const body = handler(new URL(input), init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return first.text;
}

describe("MCP server", () => {
  it("exposes read tools and the draft tool by default", async () => {
    const mcp = await connect(new WordPressClient({ baseUrl: "https://example.com", fetchImpl: fakeWordPress(() => ({})) }));
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "create_draft_post",
      "get_post",
      "get_site_info",
      "list_plugins",
      "list_posts",
    ]);
    const readTools = tools.filter((t) => t.name !== "create_draft_post");
    expect(readTools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("hides write tools in read-only mode", async () => {
    const mcp = await connect(
      new WordPressClient({ baseUrl: "https://example.com", fetchImpl: fakeWordPress(() => ({})) }),
      true,
    );
    const { tools } = await mcp.listTools();
    expect(tools.find((t) => t.name === "create_draft_post")).toBeUndefined();
  });

  it("returns posts from list_posts as JSON text", async () => {
    const fetchImpl = fakeWordPress(() => [
      { id: 1, title: { rendered: "One" }, status: "publish", date: "2026-01-01", link: "https://example.com/1" },
    ]);
    const mcp = await connect(new WordPressClient({ baseUrl: "https://example.com", fetchImpl }));

    const result = await mcp.callTool({ name: "list_posts", arguments: { search: "one", per_page: 3 } });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual([
      { id: 1, title: "One", status: "publish", date: "2026-01-01", link: "https://example.com/1", excerpt: "" },
    ]);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("per_page")).toBe("3");
  });

  it("reports WordPress errors as tool errors instead of crashing", async () => {
    const mcp = await connect(new WordPressClient({ baseUrl: "https://example.com", fetchImpl: fakeWordPress(() => ({})) }));
    const result = await mcp.callTool({ name: "create_draft_post", arguments: { title: "Hi", content: "Body" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Credentials are required/);
  });

  it("rejects invalid arguments", async () => {
    const mcp = await connect(new WordPressClient({ baseUrl: "https://example.com", fetchImpl: fakeWordPress(() => ({})) }));
    const result = await mcp.callTool({ name: "get_post", arguments: { id: -5 } });
    expect(result.isError).toBe(true);
  });
});

describe("readConfig", () => {
  it("requires WP_URL", () => {
    expect(() => readConfig({})).toThrow(/WP_URL/);
  });

  it("reads credentials and the read-only flag", () => {
    expect(
      readConfig({ WP_URL: "https://example.com", WP_USERNAME: "u", WP_APP_PASSWORD: "p", WP_READ_ONLY: "true" }),
    ).toEqual({ baseUrl: "https://example.com", username: "u", applicationPassword: "p", readOnly: true });
  });
});
