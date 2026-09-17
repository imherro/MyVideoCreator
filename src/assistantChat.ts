export type AssistantAction = { kind: "stage" | "panel" | "node" | "task"; label: string; stage?: string; panel?: string; nodeId?: string; taskId?: string; projectId?: string };
export type AssistantContext = { production?: string; episode?: number; page?: string; selectedNode?: {label?: string}; unsaved?: boolean; model?: {provider: string; model: string} };
export type AssistantMessage = { id: string; role: "user" | "assistant"; content: string; status: string; context: AssistantContext; actions: AssistantAction[]; created: number };

export function assistantRequestId() {
  // randomUUID requires HTTPS; the studio also supports plain HTTP on a LAN.
  return requestId('chat-');
}

// NDJSON may split anywhere, including inside Chinese UTF-8 sequences.
export async function readAssistantStream(response: Response, onEvent: (value: any) => void) {
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try { message = JSON.parse(raw).detail || raw; } catch { /* Plain-text server error. */ }
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  if (!response.body) throw new Error("浏览器未提供聊天响应流");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", ended = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const value = JSON.parse(line);
    if (value.type === "done" || value.type === "error") ended = true;
    onEvent(value);
  };
  try {
    while (true) {
      const {done, value} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      const lines = buffer.split("\n"); buffer = lines.pop() || "";
      lines.forEach(consume);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!ended) throw new Error("回答连接已断开，已收到的内容保留；可稍后手动重试。");
  } finally { reader.releaseLock(); }
}

export function assistantContextLabel(context: AssistantContext) {
  return [context.production || "工作室", context.episode ? `EP${String(context.episode).padStart(2,"0")}` : "", context.page, context.selectedNode?.label].filter(Boolean).join(" · ");
}
import {requestId} from "./requestId.ts";
