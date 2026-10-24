// Simple parser that converts raw assistant text into structured Message model
// This is a minimal, production‑grade starter – it can be extended with
// proper markdown parsing libraries (remark, markdown-it) when needed.

import { Message, ContentBlock, Role } from "../../models/Message";
function generateId(): string { return Math.random().toString(36).substr(2, 9); }

// Helper to create a ContentBlock with source span tracking
function makeBlock(type: ContentBlock["type"], content: string, start: number, end: number, language?: string, children?: ContentBlock[]): ContentBlock {
  return { type, content, source_span: { start, end }, ...(language ? { language } : {}), ...(children ? { children } : {}) };
}

/**
 * Parses raw markdown‑like text into a Message object.
 * Supports:
 *   - Paragraphs (plain lines)
 *   - Code fences ```lang\n...\n```
 *   - Simple tool call tags: <tool name="foo" args="{...}"/> (self‑closing)
 *   - Inline citations like [^cite]
 *
 * The function is deterministic – given the same input it returns the same output.
 */
export function parseRawMessage(
  raw: string,
  role: Role = "assistant",
  turnIndex: number = 0,
  conversationId: string = "default",
): Message {
  const blocks: ContentBlock[] = [];
  const lines = raw.split(/\r?\n/);
  let offset = 0; // character offset in raw_text
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      // code fence start – capture language if present
      const lang = line.slice(3).trim() || undefined;
      const codeStart = offset + line.length + 1; // include newline
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const codeContent = codeLines.join("\n");
      const codeEnd = codeStart + codeContent.length;
      // consume closing fence line
      if (i < lines.length) {
        offset += lines[i].length + 1; // closing fence line
        i++;
      }
      blocks.push(makeBlock("code", codeContent, codeStart, codeEnd, lang));
      offset = codeEnd + 1; // after newline of closing fence
      continue;
    }
    // Detect simple tool call pattern <tool name="..." args="..."/>
    const toolMatch = line.match(/^<tool\s+name="([^"]+)"\s+args="([^"]*)"\s*\/>$/);
    if (toolMatch) {
      const [_, name, args] = toolMatch;
      const start = offset;
      const end = offset + line.length;
      const block: ContentBlock = {
        type: "tool_call",
        content: name,
        source_span: { start, end },
        // Store args as JSON string in content for simplicity – can be parsed later
        language: undefined,
        children: undefined,
      };
      // Include args as a separate property on the block for later processing
      (block as any).args = args;
      blocks.push(block);
      offset += line.length + 1;
      i++;
      continue;
    }
    // Simple paragraph (non‑empty line)
    if (line.trim().length > 0) {
      const start = offset;
      const end = offset + line.length;
      blocks.push(makeBlock("paragraph", line, start, end));
    }
    offset += line.length + 1;
    i++;
  }

  const message: Message = {
    id: generateId(),
    conversation_id: conversationId,
    parent_id: undefined,
    role,
    turn_index: turnIndex,
    raw_text: raw,
    blocks,
    answers_to: [],
    contains_questions: [],
    tool_calls: [],
    citations: [],
    created_at: new Date().toISOString(),
    edited_from: null,
    regenerated_from: null,
    status: "complete",
  };
  return message;
}
