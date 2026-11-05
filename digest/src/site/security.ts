import { createHash } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { NO_FLASH_JS } from "./pages/chrome.js";
import { indexJs, proxyTranslateHideScript, railJs, threadsJs, toggleJs } from "./pages/blobs.js";

const SITE_SCRIPTS: ReadonlySet<string> = new Set([
  NO_FLASH_JS,
  toggleJs,
  proxyTranslateHideScript,
  indexJs,
  threadsJs,
  railJs,
]);

const INLINE = /<(script|style)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;
const sha256 = (body: string) =>
  `'sha256-${createHash("sha256").update(body.replaceAll(/\r\n?/g, "\n"), "utf8").digest("base64")}'`;

declare module "hono" {
  interface ContextVariableMap {
    frameAncestors: string[];
  }
}

export function contentSecurityPolicy(html: string, frameAncestors: string[] = []): string {
  const scripts = new Set<string>();
  const styles = new Set<string>();
  for (const [, tag, attrs, body] of html.matchAll(INLINE)) {
    if (tag!.toLowerCase() === "style") styles.add(sha256(body!));
    else if (!/\bsrc\s*=/i.test(attrs!) && SITE_SCRIPTS.has(body!)) scripts.add(sha256(body!));
  }
  return [
    "default-src 'self'",
    `script-src ${scripts.size ? [...scripts].join(" ") : "'none'"}`,
    ["style-src 'self'", ...styles].join(" "),
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(" ") : "'self'"}`,
  ].join("; ");
}

export const CORP = "cross-origin";

const csp = (): MiddlewareHandler => async (c, next) => {
  await next();
  const html =
    c.res.headers.get("content-type")?.startsWith("text/html") && c.res.body ? await c.res.clone().text() : "";
  const framed = c.get("frameAncestors");
  const ancestors = framed ?? [];
  c.res.headers.set("content-security-policy", contentSecurityPolicy(html, ancestors));
  if (ancestors.length) c.res.headers.delete("x-frame-options");
  if (framed) {
    c.res.headers.set("cross-origin-embedder-policy", "require-corp");
    c.res.headers.set("cross-origin-resource-policy", CORP);
  }
};

const headers = (): MiddlewareHandler =>
  secureHeaders({
    strictTransportSecurity: "max-age=31536000; includeSubDomains; preload",
    xFrameOptions: "SAMEORIGIN",
    referrerPolicy: "strict-origin-when-cross-origin",
    xContentTypeOptions: "nosniff",
    permissionsPolicy: {
      accelerometer: [],
      camera: [],
      geolocation: [],
      gyroscope: [],
      magnetometer: [],
      microphone: [],
      payment: [],
      usb: [],
    },
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: "same-origin",
  });

export const securityHeaders = (): MiddlewareHandler[] => [csp(), headers()];
