export interface AppConfig {
  baseUrl: string;
  username?: string;
  applicationPassword?: string;
  readOnly: boolean;
}

export function readConfig(env: NodeJS.ProcessEnv): AppConfig {
  const baseUrl = env.WP_URL;
  if (!baseUrl) {
    throw new Error("WP_URL is required, e.g. WP_URL=https://example.com");
  }
  return {
    baseUrl,
    username: env.WP_USERNAME || undefined,
    applicationPassword: env.WP_APP_PASSWORD || undefined,
    readOnly: env.WP_READ_ONLY === "true" || env.WP_READ_ONLY === "1",
  };
}
