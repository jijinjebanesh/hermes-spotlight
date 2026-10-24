import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Terminal } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

const keywords = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'catch', 'class',
  'const', 'continue', 'def', 'default', 'delete', 'elif', 'else', 'except',
  'export', 'false', 'finally', 'for', 'from', 'function', 'global', 'if',
  'import', 'in', 'instanceof', 'is', 'lambda', 'let', 'new', 'none', 'nonlocal',
  'not', 'null', 'of', 'or', 'pass', 'print', 'raise', 'return', 'switch',
  'this', 'throw', 'true', 'try', 'typeof', 'undefined', 'var', 'void', 'while',
  'with', 'yield',
]);
const hashCommentLanguages = new Set(['python', 'py', 'bash', 'shell', 'sh', 'yaml', 'yml', 'ruby']);
const slashCommentLanguages = new Set(['javascript', 'js', 'typescript', 'ts', 'jsx', 'tsx', 'java', 'c', 'cpp', 'c++', 'csharp', 'go', 'rust', 'swift', 'kotlin', 'css']);

const tokenizeLine = (line: string, language: string): React.ReactNode[] => {
  const normalizedLanguage = language.toLowerCase();
  const tokens: React.ReactNode[] = [];
  let index = 0;
  let tokenKey = 0;

  const pushToken = (value: string, kind?: string) => {
    if (!value) return;
    tokens.push(kind
      ? <span className={`token ${kind}`} key={tokenKey++}>{value}</span>
      : value);
  };

  while (index < line.length) {
    const rest = line.slice(index);
    const character = line[index];

    if ((character === '#' && hashCommentLanguages.has(normalizedLanguage))
      || (rest.startsWith('//') && slashCommentLanguages.has(normalizedLanguage))) {
      pushToken(rest, 'comment');
      break;
    }

    if (character === '"' || character === "'" || character === '`') {
      const delimiter = rest.startsWith(character.repeat(3)) ? character.repeat(3) : character;
      let end = index + delimiter.length;
      while (end < line.length) {
        if (line[end] === '\\') {
          end += 2;
          continue;
        }
        if (line.startsWith(delimiter, end)) {
          end += delimiter.length;
          break;
        }
        end += 1;
      }
      pushToken(line.slice(index, end), 'string');
      index = end;
      continue;
    }

    const number = rest.match(/^(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/);
    if (number) {
      pushToken(number[0], 'number');
      index += number[0].length;
      continue;
    }

    const identifier = rest.match(/^[A-Za-z_$][\w$]*/);
    if (identifier) {
      const value = identifier[0];
      const lowerValue = value.toLowerCase();
      const isKeyword = keywords.has(lowerValue);
      const isFunction = !isKeyword && /^\s*\(/.test(rest.slice(value.length));
      const kind = isKeyword ? 'keyword'
        : isFunction ? 'function'
          : /^[A-Z]/.test(value) ? 'class-name'
            : undefined;
      pushToken(value, kind);
      index += value.length;
      continue;
    }

    const operator = rest.match(/^[+\-*\/%=<>!&|^~]+/);
    if (operator) {
      pushToken(operator[0], 'operator');
      index += operator[0].length;
      continue;
    }

    const punctuation = rest.match(/^[()[\]{}.,;:]/);
    if (punctuation) {
      pushToken(punctuation[0], 'punctuation');
      index += punctuation[0].length;
      continue;
    }

    pushToken(character);
    index += 1;
  }

  return tokens;
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ code = '', language }) => {
  const [copied, setCopied] = useState(false);
  
  // Assistant bash/shell fences are often copyable commands. Keep those
  // visible; only the explicit terminal language denotes captured output.
  const isTerminal = language === 'terminal';
  const [expanded, setExpanded] = useState(!isTerminal);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const renderCode = () => code.split('\n').map((line, index) => (
    <span className="code-block-line" key={index}>
      <span className="code-block-line-number" aria-hidden="true">{index + 1}</span>
      <span className="code-block-line-content">{tokenizeLine(line, language || '')}</span>
    </span>
  ));

  if (isTerminal) {
    return (
      <div className="diff-block">
        <button
          className="diff-block-header"
          onClick={() => setExpanded(!expanded)}
          style={{ justifyContent: 'flex-start' }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Terminal size={12} />
          <span className="diff-block-title" style={{ marginLeft: 6 }}>
            {expanded ? '🔧 Terminal output' : '🔧 Ran terminal command — click to expand'}
          </span>
        </button>
        {expanded && (
          <div className="code-block" style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0, borderTop: 'none', margin: 0 }}>
            <div className="code-block-header">
              <div className="code-block-dots">
                <span className="code-block-dot code-block-dot--red" />
                <span className="code-block-dot code-block-dot--yellow" />
                <span className="code-block-dot code-block-dot--green" />
              </div>
              {language && <span className="code-block-lang">{language}</span>}
              <button
                className={`code-copy-btn${copied ? ' copied' : ''}`}
                onClick={handleCopy}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div className="code-block-content selectable">
              <pre><code>{renderCode()}</code></pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <div className="code-block-dots">
          <span className="code-block-dot code-block-dot--red" />
          <span className="code-block-dot code-block-dot--yellow" />
          <span className="code-block-dot code-block-dot--green" />
        </div>
        {language && <span className="code-block-lang">{language}</span>}
        <button
          className={`code-copy-btn${copied ? ' copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="code-block-content selectable">
        <pre><code>{renderCode()}</code></pre>
      </div>
    </div>
  );
};
