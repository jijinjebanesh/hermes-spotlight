// Todo List reducer handling TodoEvents
// This function is pure and returns a new TodoList state based on events.

import { TodoList, TodoItem, TodoEvent, TodoStatus } from "./TodoTypes";

// Helper to find an item recursively and return its path of indices
function findItemPath(list: TodoList, itemId: string): number[] | null {
  const path: number[] = [];
  const stack: { items: TodoItem[]; parentPath: number[] }[] = [{ items: list.items, parentPath: [] }];
  while (stack.length) {
    const { items, parentPath } = stack.pop()!;
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === itemId) {
        return parentPath.concat(i);
      }
      if (items[i].children && items[i].children!.length) {
        stack.push({ items: items[i].children!, parentPath: parentPath.concat(i, "children" as any) });
      }
    }
  }
  return null;
}

function updateItemAtPath(list: TodoList, path: number[], updater: (item: TodoItem) => TodoItem): TodoList {
  if (path.length === 0) return list;
  const newList = { ...list, items: [...list.items] };
  let current: any = newList.items;
  for (let i = 0; i < path.length - 1; i++) {
    const idx = path[i];
    if (typeof idx === "string" && idx === "children") {
      current = current[current.length - 1].children = [...(current[current.length - 1].children || [])];
    } else {
      current[idx] = { ...current[idx] };
      if (i < path.length - 2) {
        current = current[idx].children = [...(current[idx].children || [])];
      }
    }
  }
  const lastIdx = path[path.length - 1];
  current[lastIdx] = updater(current[lastIdx]);
  return newList;
}

export function todoReducer(state: TodoList | null, event: TodoEvent): TodoList {
  const now = new Date().toISOString();
  switch (event.op) {
    case "create": {
      const newList: TodoList = {
        id: event.list_id,
        message_id: event.message_id,
        created_at: event.timestamp,
        updated_at: event.timestamp,
        items: event.items.map((it) => ({ ...it, status: "pending" })),
      };
      return newList;
    }
    case "set_status": {
      if (!state) return state!;
      const path = findItemPath(state, event.item_id);
      if (!path) return state;
      const updated = updateItemAtPath(state, path, (it) => {
        const upd: Partial<TodoItem> = { status: event.status } as Partial<TodoItem>;
        if (event.status === "in_progress") upd.started_at = event.timestamp;
        if (event.status === "complete" || event.status === "skipped") upd.completed_at = event.timestamp;
        return { ...it, ...upd } as TodoItem;
      });
      return { ...updated, updated_at: event.timestamp };
    }
    case "add_item": {
      if (!state) return state!;
      const newItem = { ...event.item, status: "pending" } as TodoItem;
      if (event.after) {
        // Insert after the item with id=after
        const afterPath = findItemPath(state, event.after);
        if (!afterPath) return state;
        // Find the array that contains the after item
        const parentPath = afterPath.slice(0, -1);
        const index = afterPath[afterPath.length - 1] as number;
        const updated = updateItemAtPath(state, parentPath, (parent) => {
          const arr = (parent as any).children ? (parent as any).children : (parent as any).items;
          const newArr = [...arr];
          newArr.splice(index + 1, 0, newItem);
          if ((parent as any).children) {
            (parent as any).children = newArr;
          } else {
            (parent as any).items = newArr;
          }
          return parent;
        });
        return { ...updated, updated_at: event.timestamp };
      } else {
        // Append to top level
        const newItems = [...state.items, newItem];
        return { ...state, items: newItems, updated_at: event.timestamp };
      }
    }
    case "remove_item": {
      if (!state) return state!;
      const path = findItemPath(state, event.item_id);
      if (!path) return state;
      const parentPath = path.slice(0, -1);
      const idx = path[path.length - 1] as number;
      const updated = updateItemAtPath(state, parentPath, (parent) => {
        const arr = (parent as any).children ? (parent as any).children : (parent as any).items;
        const newArr = [...arr];
        newArr.splice(idx, 1);
        if ((parent as any).children) {
          (parent as any).children = newArr;
        } else {
          (parent as any).items = newArr;
        }
        return parent;
      });
      return { ...updated, updated_at: event.timestamp };
    }
    case "error": {
      if (!state) return state!;
      const path = findItemPath(state, event.item_id);
      if (!path) return state;
      const updated = updateItemAtPath(state, path, (it) => ({
        ...it,
        status: "error" as TodoStatus,
        error_message: event.message,
      }));
      return { ...updated, updated_at: event.timestamp };
    }
    case "complete_list": {
      if (!state) return state!;
      const allCompleted = state.items.map((it) => ({ ...it, status: "complete" as TodoStatus, completed_at: event.timestamp }));
      return { ...state, items: allCompleted, updated_at: event.timestamp };
    }
    default:
      return state!;
  }
}
