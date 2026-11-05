import { readFileSync } from "node:fs";

const ASSET_DIR = new URL("../../assets/site/", import.meta.url);

export interface Assets {
  tokensCss: string;
  font: Buffer;
  fontUrl: string;
  ogImage: Buffer;
  appleTouchIcon: Buffer;
}

export function fontHash(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  for (const b of bytes) h = ((h ^ BigInt(b)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return ((h ^ (h >> 32n)) & 0xffffffffn).toString(16).padStart(8, "0");
}
export const fontUrl = (hash: string): string => `/assets/fonts/source-serif-4.${hash}.woff2`;

export function loadAssets(designDir: string): Assets {
  const font = readFileSync(new URL("source-serif-4-latin.woff2", ASSET_DIR));
  return {
    tokensCss: readFileSync(`${designDir}/tokens.css`, "utf8"),
    font,
    fontUrl: fontUrl(fontHash(font)),
    ogImage: readFileSync(new URL("og-image.png", ASSET_DIR)),
    appleTouchIcon: readFileSync(new URL("apple-touch-icon.png", ASSET_DIR)),
  };
}

export const fontFace = (url: string): string =>
  `@font-face{font-family:"Source Serif 4";font-style:normal;font-weight:380 640;font-display:swap;src:url("${url}") format("woff2");}`;

export const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='6' fill='#c45a3b'/><line x1='8' y1='10' x2='24' y2='10' stroke='white' stroke-width='2.5' stroke-linecap='round'/><line x1='8' y1='16' x2='20' y2='16' stroke='white' stroke-width='2.5' stroke-linecap='round' opacity='.7'/><line x1='8' y1='22' x2='16' y2='22' stroke='white' stroke-width='2.5' stroke-linecap='round' opacity='.4'/></svg>";
