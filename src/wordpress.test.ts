import { describe, expect, it, vi } from "vitest";
import { toPlainText, WordPressClient, WordPressError, type FetchLike } from "./wordpress.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn<FetchLike>(async () => jsonResponse(body, status));
}

const rawPost = {
  id: 42,
  title: { rendered: "Hello &amp; welcome" },
  status: "publish",
  date: "2026-11-01T09:00:00",
  modified: "2026-11-02T10:00:00",
  link: "https://example.com/hello",
  excerpt: { rendered: "<p>Short intro&hellip;</p>" },
  content: { rendered: "<p>First para.</p><p>Second <strong>para</strong>.</p>" },
};

describe("toPlainText", () => {
  it("strips tags and decodes common entities", () => {
    expect(toPlainText("<p>Tom&#8217;s &amp; Jerry&#8217;s</p>")).toBe("Tom's & Jerry's");
  });

  it("drops script and style blocks entirely", () => {
    expect(toPlainText("<p>Hi</p><script>alert(1)</script><style>p{}</style>")).toBe("Hi");
  });

  it("returns an empty string for undefined", () => {
    expect(toPlainText(undefined)).toBe("");
  });
});

describe("WordPressClient", () => {
  it("rejects a base URL without a scheme", () => {
    expect(() => new WordPressClient({ baseUrl: "example.com" })).toThrow(/http/);
  });

  it("lists published posts with the right query and maps fields", async () => {
    const fetchImpl = mockFetch([rawPost]);
    const client = new WordPressClient({ baseUrl: "https://example.com/", fetchImpl });

    const posts = await client.listPosts({ search: "hello", perPage: 5 });

    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe("/wp-json/wp/v2/posts");
    expect(url.searchParams.get("search")).toBe("hello");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect(url.searchParams.get("status")).toBe("publish");
    expect(posts).toEqual([
      {
        id: 42,
        title: "Hello & welcome",
        status: "publish",
        date: "2026-11-01T09:00:00",
        link: "https://example.com/hello",
        excerpt: "Short intro...",
      },
    ]);
  });

  it("clamps per_page to the REST API maximum of 100", async () => {
    const fetchImpl = mockFetch([]);
    const client = new WordPressClient({ baseUrl: "https://example.com", fetchImpl });
    await client.listPosts({ perPage: 500 });
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("per_page")).toBe("100");
  });

  it("refuses to list drafts without credentials, without calling the API", async () => {
    const fetchImpl = mockFetch([]);
    const client = new WordPressClient({ baseUrl: "https://example.com", fetchImpl });
    await expect(client.listPosts({ status: "draft" })).rejects.toBeInstanceOf(WordPressError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends Basic auth built from an application password, ignoring its spaces", async () => {
    const fetchImpl = mockFetch([]);
    const client = new WordPressClient({
      baseUrl: "https://example.com",
      username: "editor",
      applicationPassword: "abcd efgh ijkl",
      fetchImpl,
    });
    await client.listPosts();
    const headers = fetchImpl.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("editor:abcdefghijkl").toString("base64")}`);
  });

  it("returns a post with plain-text content", async () => {
    const client = new WordPressClient({ baseUrl: "https://example.com", fetchImpl: mockFetch(rawPost) });
    const post = await client.getPost(42);
    expect(post.content).toBe("First para.\n\nSecond para.");
    expect(post.modified).toBe("2026-11-02T10:00:00");
  });

  it("creates posts as drafts only", async () => {
    const fetchImpl = mockFetch({ ...rawPost, status: "draft" });
    const client = new WordPressClient({
      baseUrl: "https://example.com",
      username: "editor",
      applicationPassword: "secret",
      fetchImpl,
    });

    const created = await client.createDraft({ title: "New", content: "Body" });

    const init = fetchImpl.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ title: "New", content: "Body", status: "draft" });
    expect(created.status).toBe("draft");
  });

  it("requires credentials to create a draft", async () => {
    const client = new WordPressClient({ baseUrl: "https://example.com", fetchImpl: mockFetch({}) });
    await expect(client.createDraft({ title: "x", content: "y" })).rejects.toThrow(/WP_APP_PASSWORD/);
  });

  it("surfaces the WordPress error message and status", async () => {
    const client = new WordPressClient({
      baseUrl: "https://example.com",
      fetchImpl: mockFetch({ code: "rest_post_invalid_id", message: "Invalid post ID." }, 404),
    });
    const error = await client.getPost(999).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WordPressError);
    expect(error).toMatchObject({ status: 404, code: "rest_post_invalid_id" });
    expect((error as Error).message).toContain("Invalid post ID.");
  });

  it("wraps network failures in a WordPressError", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const client = new WordPressClient({ baseUrl: "https://example.com", fetchImpl });
    await expect(client.getSiteInfo()).rejects.toMatchObject({ status: 0 });
  });
});
