import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export function initMessage(options?: Options, tools?: string[]): SDKMessage {
  const base = Array.isArray(options?.tools) ? options.tools : [];
  const offered = tools ?? [...base, ...(options?.outputFormat ? ["StructuredOutput"] : [])];
  return { type: "system", subtype: "init", tools: offered, session_id: "s" } as unknown as SDKMessage;
}
