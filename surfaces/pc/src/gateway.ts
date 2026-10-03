import { fetch } from "@tauri-apps/plugin-http";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GatewayModel {
  id: string;
}

export interface GatewayTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/** Internal message shape used during a tool-calling loop - a superset of ChatMessage that also
 *  needs to carry tool_calls (on assistant turns) and tool_call_id/name (on tool-result turns),
 *  per the OpenAI function-calling message format. */
export type ToolLoopMessage =
  | ChatMessage
  | { role: "assistant"; content: string | null; tool_calls: ToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

const DEFAULT_GATEWAY_URL = "http://192.168.1.40:4000/v1";
const STORAGE_KEY = "gatewayBaseUrl";

export function getGatewayUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_GATEWAY_URL;
  } catch {
    return DEFAULT_GATEWAY_URL;
  }
}

export function setGatewayUrl(url: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, url.replace(/\/+$/, ""));
  } catch {
    // ignore - per-session only if storage is unavailable
  }
}

export async function listModels(): Promise<GatewayModel[]> {
  const res = await fetch(`${getGatewayUrl()}/models`, { method: "GET" });
  if (!res.ok) {
    throw new Error(`Gateway returned ${res.status} listing models`);
  }
  const data = (await res.json()) as { data?: GatewayModel[] };
  return data.data ?? [];
}

/**
 * Streams a chat completion, invoking onToken for each incremental chunk of
 * assistant text as it arrives. Resolves once the stream ends.
 */
export async function streamChatCompletion(
  model: string,
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${getGatewayUrl()}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gateway returned ${res.status}: ${text || res.statusText}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each "data: ..." line carries one JSON chunk.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") return;

      try {
        const parsed = JSON.parse(payload);
        const delta: string | undefined = parsed?.choices?.[0]?.delta?.content;
        if (delta) onToken(delta);
      } catch {
        // skip malformed/partial frames rather than aborting the whole stream
      }
    }
  }
}

/**
 * Runs a full agentic tool-calling loop against the gateway: sends the conversation plus the
 * available MCP tools, and if the model requests a tool call, executes it (via the provided
 * callTool function) and feeds the result back, repeating until the model returns a plain text
 * answer with no further tool calls. Deliberately non-streaming - OpenAI-style streaming tool
 * calls arrive as fragments fused across multiple chunks, which is meaningfully more complex to
 * parse correctly, and this loop already makes several round-trips; only the final answer is
 * worth streaming; the model's own fallback (`streamChatCompletion`) is used for conversations
 * with no tools available at all, so plain chat keeps feeling responsive.
 *
 * onStatus is called with a human-readable description each time a tool is invoked, so the UI
 * can show "Calling <tool>..." rather than going silent for the duration of the loop.
 */
export async function runToolLoop(
  model: string,
  initialMessages: ChatMessage[],
  tools: GatewayTool[],
  callTool: (toolName: string, args: unknown) => Promise<unknown>,
  onStatus: (status: string) => void,
  signal?: AbortSignal,
  maxTurns = 8,
): Promise<string> {
  const messages: ToolLoopMessage[] = [...initialMessages];

  for (let turn = 0; turn < maxTurns; turn++) {
    const res = await fetch(`${getGatewayUrl()}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Gateway returned ${res.status}: ${text || res.statusText}`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0]?.message;
    if (!choice) throw new Error("Gateway response had no message");

    const toolCalls: ToolCall[] | undefined = choice.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return choice.content ?? "";
    }

    messages.push({ role: "assistant", content: choice.content ?? null, tool_calls: toolCalls });

    for (const call of toolCalls) {
      onStatus(`Calling ${call.function.name}...`);
      let argsObj: unknown = {};
      try {
        argsObj = JSON.parse(call.function.arguments || "{}");
      } catch {
        // pass through empty args rather than aborting on a malformed arguments string
      }
      let resultText: string;
      try {
        const result = await callTool(call.function.name, argsObj);
        resultText = typeof result === "string" ? result : JSON.stringify(result);
      } catch (err) {
        resultText = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.function.name,
        content: resultText,
      });
    }
  }

  return "Stopped after reaching the maximum number of tool-call turns without a final answer.";
}
