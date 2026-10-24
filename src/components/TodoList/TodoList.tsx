import React, { useReducer } from "react";
import { Check, Loader2, Clock, AlertCircle, Minus } from "lucide-react";
import { TodoList, TodoItem, TodoEvent, TodoStatus } from "./TodoTypes";
import { todoReducer } from "./todoReducer";

function StatusBadge({ status }: { status: TodoStatus }) {
  switch (status) {
    case "complete":
      return <span className="task-icon-done"><Check size={11} strokeWidth={3} /></span>;
    case "in_progress":
      return <span className="task-icon-progress"><Loader2 size={11} className="spin" /></span>;
    case "pending":
      return <span className="task-icon-pending"><Clock size={11} /></span>;
    case "error":
      return <span className="task-icon-error"><AlertCircle size={11} /></span>;
    case "skipped":
      return <span className="task-icon-skipped"><Minus size={11} /></span>;
    default:
      return null;
  }
}

function renderItem(item: TodoItem, depth: number = 0): JSX.Element {
  const isDone = item.status === "complete";
  const isProgress = item.status === "in_progress";

  return (
    <li
      key={item.id}
      className={`styled-task ${isDone ? 'task-done' : isProgress ? 'task-progress' : 'task-pending'}`}
      style={{ marginLeft: depth * 16 }}
    >
      <span className="task-icon">
        <StatusBadge status={item.status as TodoStatus} />
      </span>
      <div className="task-body">
        <span className="task-content">{item.text}</span>
        {item.detail && <div className="task-detail">{item.detail}</div>}
      </div>
      {item.children && item.children.length > 0 && (
        <ul className="todo-list-children">{item.children.map((c) => renderItem(c, depth + 1))}</ul>
      )}
    </li>
  );
}

interface Props {
  initialList: TodoList;
  events: TodoEvent[];
}

export const TodoListComponent: React.FC<Props> = ({ initialList, events }) => {
  const [state, dispatch] = useReducer(todoReducer, initialList);

  React.useEffect(() => {
    events.forEach((e) => dispatch(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return null;

  return (
    <div className="semantic-todo">
      <ul className="todo-list-root">{state.items.map((it) => renderItem(it))}</ul>
    </div>
  );
};
