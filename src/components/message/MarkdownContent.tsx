import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface MarkdownContentProps {
  content: string;
}

/**
 * Shared renderer for historical and live assistant text.
 * GFM keeps tables, task lists, strikethrough, links, and fenced code consistent
 * regardless of whether a message arrived through the stream or session history.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => (
  <div className="markdown-content">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
    components={{
      pre: ({ children }) => <>{children}</>,
      code: ({ className, children, node: _node, ...props }) => {
        const language = /language-([\w+-]+)/.exec(className || '')?.[1];
        // Markdown can briefly produce a code node before its streamed text
        // child arrives. String(undefined) would leak the word "undefined".
        const code = String(children ?? '').replace(/\n$/, '');

        if (language) {
          return <CodeBlock code={code} language={language} />;
        }

        return <code className={className} {...props}>{children}</code>;
      },
      table: ({ children }) => (
        <div className="markdown-table-scroll">
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ),
      li: ({ className, children, ...props }) => {
        const isTaskListItem = className && className.includes('task-list-item');
        const childrenArray = React.Children.toArray(children);
        
        // Detect custom [/] for in-progress tasks
        let isCustomInProgress = false;
        if (!isTaskListItem && childrenArray.length > 0) {
          const first = childrenArray[0];
          if (typeof first === 'string' && first.startsWith('[/] ')) {
            isCustomInProgress = true;
            childrenArray[0] = first.substring(4);
          }
        }

        if (isTaskListItem || isCustomInProgress) {
          // If it's a standard task list item, remark-gfm adds an <input type="checkbox">
          // We can replace it or just style the li.
          const isCompleted = childrenArray.some((child: any) => 
            child?.props?.type === 'checkbox' && child?.props?.checked
          );
          const isPending = !isCompleted && !isCustomInProgress;

          // Remove the default input checkbox to use our custom icons
          const filteredChildren = childrenArray.filter((child: any) => child?.props?.type !== 'checkbox');

          return (
            <li className={`task-list-item styled-task ${isCompleted ? 'task-done' : isCustomInProgress ? 'task-progress' : 'task-pending'}`} {...props}>
              <span className="task-icon">
                {isCompleted && <span className="task-icon-done">✓</span>}
                {isCustomInProgress && <span className="task-icon-progress" />}
                {isPending && <span className="task-icon-pending" />}
              </span>
              <span className="task-content">{filteredChildren}</span>
            </li>
          );
        }

        return <li className={className} {...props}>{children}</li>;
      }
    }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
