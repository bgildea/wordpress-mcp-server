/**
 * Minimal, typed client for the WordPress REST API (wp-json/wp/v2).
 *
 * Authentication uses WordPress Application Passwords (Users > Profile >
 * Application Passwords), sent as HTTP Basic auth. Read-only calls on public
 * content work without credentials.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface WordPressConfig {
  /** Site root, e.g. https://example.com */
  baseUrl: string;
  username?: string;
  applicationPassword?: string;
  fetchImpl?: FetchLike;
  /** Request timeout in milliseconds. Defaults to 15 seconds. */
  timeoutMs?: number;
}

export interface PostSummary {
  id: number;
  title: string;
  status: string;
  date: string;
  link: string;
  excerpt: string;
}

export interface Post extends PostSummary {
  content: string;
  modified: string;
}

export interface SiteInfo {
  name: string;
  description: string;
  url: string;
  namespaces: string[];
}

export interface PluginInfo {
  plugin: string;
  name: string;
  version: string;
  status: string;
}

export interface ListPostsOptions {
  search?: string;
  status?: "publish" | "draft" | "pending" | "private" | "future" | "any";
  perPage?: number;
  page?: number;
  type?: "posts" | "pages";
}

export class WordPressError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "WordPressError";
  }
}

interface RawPost {
  id: number;
  title?: { rendered?: string };
  status: string;
  date: string;
  modified?: string;
  link: string;
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
}

/** Strip tags and decode the handful of entities WordPress commonly emits. */
export function toPlainText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8216;|&lsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&hellip;|&#8230;/g, "...")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function toSummary(raw: RawPost): PostSummary {
  return {
    id: raw.id,
    title: toPlainText(raw.title?.rendered),
    status: raw.status,
    date: raw.date,
    link: raw.link,
    excerpt: toPlainText(raw.excerpt?.rendered),
  };
}

export class WordPressClient {
  private readonly baseUrl: string;
  private readonly authHeader?: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(config: WordPressConfig) {
    if (!/^https?:\/\//.test(config.baseUrl)) {
      throw new Error("baseUrl must start with http:// or https://");
    }
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    if (config.username && config.applicationPassword) {
      const token = Buffer.from(
        `${config.username}:${config.applicationPassword.replace(/\s+/g, "")}`,
      ).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
    this.fetchImpl = config.fetchImpl ?? ((input, init) => fetch(input, init));
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }

  get isAuthenticated(): boolean {
    return this.authHeader !== undefined;
  }

  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/wp-json${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.authHeader) headers.Authorization = this.authHeader;
    if (init.body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new WordPressError(`Could not reach ${this.baseUrl}: ${reason}`, 0);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let message = `WordPress returned HTTP ${response.status}`;
      let code: string | undefined;
      try {
        const body = (await response.json()) as { message?: string; code?: string };
        if (body.message) message = `${message}: ${toPlainText(body.message)}`;
        code = body.code;
      } catch {
        // Non-JSON error body; keep the generic message.
      }
      throw new WordPressError(message, response.status, code);
    }

    return (await response.json()) as T;
  }

  async getSiteInfo(): Promise<SiteInfo> {
    const raw = await this.request<{ name?: string; description?: string; url?: string; namespaces?: string[] }>("/");
    return {
      name: raw.name ?? "",
      description: raw.description ?? "",
      url: raw.url ?? this.baseUrl,
      namespaces: raw.namespaces ?? [],
    };
  }

  async listPosts(options: ListPostsOptions = {}): Promise<PostSummary[]> {
    const type = options.type ?? "posts";
    const perPage = Math.min(Math.max(options.perPage ?? 10, 1), 100);
    const status = options.status ?? "publish";
    if (status !== "publish" && !this.isAuthenticated) {
      throw new WordPressError(`Listing "${status}" content requires credentials`, 401, "auth_required");
    }
    const raw = await this.request<RawPost[]>(`/wp/v2/${type}`, {
      query: {
        search: options.search,
        status,
        per_page: perPage,
        page: options.page,
        _fields: "id,title,status,date,link,excerpt",
      },
    });
    return raw.map(toSummary);
  }

  async getPost(id: number, type: "posts" | "pages" = "posts"): Promise<Post> {
    const raw = await this.request<RawPost>(`/wp/v2/${type}/${id}`);
    return {
      ...toSummary(raw),
      content: toPlainText(raw.content?.rendered),
      modified: raw.modified ?? raw.date,
    };
  }

  /** Creates a post as a draft. Never publishes. */
  async createDraft(input: { title: string; content: string; excerpt?: string }): Promise<PostSummary> {
    this.requireAuth("create a draft");
    const raw = await this.request<RawPost>("/wp/v2/posts", {
      method: "POST",
      body: { title: input.title, content: input.content, excerpt: input.excerpt, status: "draft" },
    });
    return toSummary(raw);
  }

  async listPlugins(): Promise<PluginInfo[]> {
    this.requireAuth("list plugins");
    const raw = await this.request<Array<{ plugin: string; name: string; version: string; status: string }>>(
      "/wp/v2/plugins",
      { query: { _fields: "plugin,name,version,status" } },
    );
    return raw.map(({ plugin, name, version, status }) => ({ plugin, name, version, status }));
  }

  private requireAuth(action: string): void {
    if (!this.isAuthenticated) {
      throw new WordPressError(
        `Credentials are required to ${action}. Set WP_USERNAME and WP_APP_PASSWORD.`,
        401,
        "auth_required",
      );
    }
  }
}
