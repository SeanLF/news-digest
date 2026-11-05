import { PostHog } from "posthog-node";

const token = process.env["POSTHOG_PROJECT_TOKEN"];
const host = process.env["POSTHOG_HOST"];
export const posthog: PostHog | undefined = token && host ? new PostHog(token, { host }) : undefined;
if (posthog) process.once("beforeExit", () => void posthog.shutdown());

export type Track = (event: string, properties: Record<string, unknown>) => void;
export const track: Track = (event, properties) => posthog?.capture({ distinctId: "news-digest", event, properties });
