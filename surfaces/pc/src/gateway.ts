import { fetch } from "@tauri-apps/plugin-http";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GatewayModel {
  id: string;
}

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
