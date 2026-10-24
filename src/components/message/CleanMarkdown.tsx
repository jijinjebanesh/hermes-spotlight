import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';

interface CleanMarkdownProps {
  content: string;
  className?: string;
}

export const CleanMarkdown: React.FC<CleanMarkdownProps> = ({ content, className }) => (
  <div className={className || 'clean-markdown'}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children, node: _node, ...props }) => {
          const language = /language-([\w+-]+)/.exec(className || '')?.[1];
          const code = String(children ?? '').replace(/\n$/, '');

          if (language) {
            return <CodeBlock code={code} language={language} />;
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        table: ({ children }) => (
          <div className="clean-markdown__table-scroll">
            <table className="clean-markdown__table">{children}</table>
          </div>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="clean-markdown__link">
            {children}
          </a>
        ),
        li: ({ className, children, ...props }) => {
          const childrenArray = React.Children.toArray(children);
          let isCustomInProgress = false;

          if (className && className.includes('task-list-item')) {
            const isCompleted = childrenArray.some((child: any) =>
              child?.props?.type === 'checkbox' && child?.props?.checked,
            );

            const filteredChildren = childrenArray.filter(
              (child: any) => child?.props?.type !== 'checkbox',
            );

            return (
              <li
                className={`clean-markdown__task ${isCompleted ? 'clean-markdown__task--done' : 'clean-markdown__task--pending'}`}
                {...props}
              >
                <span className="clean-markdown__task-icon">
                  {isCompleted ? '✓' : '○'}
                </span>
                <span className="clean-markdown__task-content">{filteredChildren}</span>
              </li>
            );
          }

          return (
            <li className={className || 'clean-markdown__list-item'} {...props}>
              {children}
            </li>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);
