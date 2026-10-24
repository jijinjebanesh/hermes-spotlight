// Conversation message data model for Hermes Overlay

export type Role = "user" | "assistant" | "system" | "tool";

export interface SubQuestion {
  id: string;
  text: string;
  answered: boolean;
  answering_message_id: string | null;
}

export interface Citation {
  id: string;
  source: string; // e.g. URL, reference id
  start: number; // char offset in raw_text
  end: number;   // exclusive
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, any>;
  result?: any;
}

export interface ContentBlock {
  type: "paragraph" | "code" | "list" | "table" | "math" | "citation" | "tool_call" | "image" | "quote" | "footnote";
  content: string;
  language?: string; // for code blocks
  children?: ContentBlock[]; // for nested structures like lists
  source_span: { start: number; end: number };
}

export interface Message {
  id: string;
  conversation_id: string;
  parent_id?: string; // for branching / edits
  role: Role;
  turn_index: number;
  raw_text: string;
  blocks: ContentBlock[];
  answers_to: string[]; // ids of user messages/sub‑questions this replies to
  contains_questions: SubQuestion[]; // if assistant asks something back
  tool_calls: ToolCall[];
  citations: Citation[];
  created_at: string; // ISO timestamp
  edited_from?: string | null;
  regenerated_from?: string | null;
  status: "streaming" | "complete" | "error" | "stopped";
}
