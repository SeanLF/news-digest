import { MailDestinationError, resendBaseUrl } from "../resend/destination.js";

export interface SiteConfig {
  digestName: string;
  digestDomain: string | undefined;
  homepageUrl: string | undefined;
  sourceUrl: string | undefined;
  resendApiKey: string | undefined;
  resendAudienceId: string | undefined;
  resendBaseUrl: string | undefined;
  fromEmail: string | undefined;
  contactEmail: string | undefined;
  subscribeTokenSecret: string | undefined;
  doubleOptIn: boolean;
  sourcesFile: string;
  designDir: string;
  embedAncestors: string[];
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

const set = (v: string | undefined): string | undefined => (v === undefined || v.trim() === "" ? undefined : v.trim());

export function siteConfig(env: NodeJS.ProcessEnv): SiteConfig {
  const fromEmail = set(env["RESEND_FROM"]);
  const cfg: SiteConfig = {
    digestName: set(env["DIGEST_NAME"]) ?? "News Digest",
    digestDomain: set(env["DIGEST_DOMAIN"]),
    homepageUrl: set(env["HOMEPAGE_URL"]),
    sourceUrl: set(env["SOURCE_URL"]),
    resendApiKey: set(env["RESEND_API_KEY"]),
    resendAudienceId: set(env["RESEND_AUDIENCE_ID"]),
    resendBaseUrl: undefined,
    fromEmail,
    contactEmail: set(env["CONTACT_EMAIL"]) ?? fromEmail,
    subscribeTokenSecret: set(env["SUBSCRIBE_TOKEN_SECRET"]),
    doubleOptIn: !["false", "0", "no"].includes((env["SUBSCRIBE_DOUBLE_OPT_IN"] ?? "").trim().toLowerCase()),
    sourcesFile: set(env["SOURCES_FILE"]) ?? "/app/sources.json",
    designDir: set(env["DESIGN_DIR"]) ?? "/app/design",
    embedAncestors: embedAncestors(set(env["EMBED_ANCESTORS"]), set(env["HOMEPAGE_URL"])),
  };
  if (subscriptionsEnabled(cfg)) {
    try {
      cfg.resendBaseUrl = resendBaseUrl(env);
    } catch (e) {
      if (e instanceof MailDestinationError) throw new ConfigError(`subscriptions are on, but ${e.message}`);
      throw e;
    }
  }
  if (subscriptionsEnabled(cfg) && cfg.doubleOptIn) {
    const missing = [
      ...(cfg.subscribeTokenSecret ? [] : ["SUBSCRIBE_TOKEN_SECRET (signs the confirmation link)"]),
      ...(cfg.digestDomain ? [] : ["DIGEST_DOMAIN (the confirmation link must be absolute)"]),
      ...(cfg.fromEmail ? [] : ["RESEND_FROM (the confirmation email's sender)"]),
    ];
    if (missing.length) {
      throw new ConfigError(
        `subscriptions are on with double opt-in, but ${missing.join(", ")} is unset; set it, or set SUBSCRIBE_DOUBLE_OPT_IN=false to add contacts without confirmation on purpose`,
      );
    }
  }
  return cfg;
}

const ORIGIN = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;
function embedAncestors(explicit: string | undefined, homepage: string | undefined): string[] {
  if (explicit) {
    const origins = explicit.split(/\s+/);
    const bad = origins.find((o) => !ORIGIN.test(o));
    if (bad)
      throw new ConfigError(`EMBED_ANCESTORS: ${JSON.stringify(bad)} is not an origin (scheme://host[:port], no path)`);
    return origins;
  }
  if (!homepage) return [];
  try {
    return [new URL(homepage).origin];
  } catch {
    throw new ConfigError(`HOMEPAGE_URL: ${JSON.stringify(homepage)} is not a URL`);
  }
}

export const subscriptionsEnabled = (c: SiteConfig): boolean =>
  c.resendApiKey !== undefined && c.resendAudienceId !== undefined;

export const baseUrl = (c: SiteConfig): string => (c.digestDomain ? `https://${c.digestDomain}` : "");

export const privacyUrl = (c: SiteConfig): string =>
  c.homepageUrl ? `${c.homepageUrl.replace(/\/+$/, "")}/privacy` : "/privacy";

export const ogImageUrl = (c: SiteConfig): string => (c.digestDomain ? `https://${c.digestDomain}/og-image.png` : "");

export const link = (c: SiteConfig, path: string): string => `${baseUrl(c)}${path}`;
