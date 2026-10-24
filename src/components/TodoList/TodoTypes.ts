export type TodoStatus =
  | "pending"
  | "in_progress"
  | "complete"
  | "error"
  | "skipped";

export interface TodoItem {
  id: string;
  order: number;
  text: string;
  status: TodoStatus;
  detail?: string;
  started_at?: string; // ISO timestamp
  completed_at?: string; // ISO timestamp
  error_message?: string;
  children?: TodoItem[];
  linked_tool_call_id?: string;
}

export interface TodoList {
  id: string;
  message_id: string;
  created_at: string; // ISO timestamp
  updated_at: string; // ISO timestamp
  items: TodoItem[];
}

export type TodoEvent =
  | { op: "create"; list_id: string; message_id: string; items: TodoItem[]; timestamp: string }
  | { op: "set_status"; item_id: string; status: TodoStatus; timestamp: string }
  | { op: "add_item"; list_id: string; after?: string; item: TodoItem; timestamp: string }
  | { op: "remove_item"; item_id: string; timestamp: string }
  | { op: "error"; item_id: string; message: string; timestamp: string }
  | { op: "complete_list"; list_id: string; timestamp: string };
