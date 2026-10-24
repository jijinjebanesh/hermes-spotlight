// -----------------------------------------------------------------------------
// Incremental Markdown parser – replaces the monolithic parseRawMessage()
// -----------------------------------------------------------------------------
// Exported class: StreamingMarkdownParser
//   • feed(chunk)          – append new raw text and return any *new* blocks
//   • flushRemaining()    – force‑emit any leftover partial block (e.g. final paragraph)
// -----------------------------------------------------------------------------
// The parser works line‑by‑line, keeping a cursor so we never revisit text that
// has already been turned into a block. It understands the block types that the UI
// currently renders: paragraph, code fence, tool call, table, todo.
// Anything else falls back to a plain paragraph (ReactMarkdown will still format it).
// The implementation is deliberately simple – a state‑machine built on regular
// expressions – but it can be swapped for a micromark‑based tokenizer later without
// changing the public API.

import type { ContentBlock } from '../models/Message';

/** Detect which block a line starts. */
function getBlockStarter(line: string): 'code_fence' | 'tool_call' | 'table' | 'paragraph' | null {
  if (/^```/.test(line)) return 'code_fence';
  if (/^<tool\s+/.test(line)) return 'tool_call';
  // Table detection: a line containing at least two pipes and the next line is a separator
  if (line.includes('|')) return 'table';
  return 'paragraph';
}

/** Simple tool‑call regex – matches the <tool …/> pattern used by the backend. */
const TOOL_CALL_RE = /^<tool\s+name="([^\"]+)"\s+args="([^\"]*)"\s*\/>\s*$/;
/** Code‑fence detection – captures optional language. */
const CODE_FENCE_RE = /^```(\w*)\s*$/;
/** Table separator line – e.g. |---|---|. */
const TABLE_SEPARATOR_RE = /^\s*\|?(\s*:?-+:?\s*\|)+\s*$/;
/** Paragraph ends on a blank line (or double newline). */
const PARAGRAPH_END_RE = /^\s*$/;

/** Main class */
export class StreamingMarkdownParser {
  // All raw data seen so far (useful for debugging / flushing)
  private rawText: string = '';
  // Index (in characters) of the first *unprocessed* byte in rawText
  private cursor: number = 0;
  // -------------------------------------------------------------------------
  // Public: feed a new chunk of text. Returns an array of *new* ContentBlock
  // objects that were just completed.
  // -------------------------------------------------------------------------
  public feed(chunk: string): ContentBlock[] {
    this.rawText += chunk;
    const newBlocks: ContentBlock[] = [];

    // Work on the *unprocessed* tail only
    let tail = this.rawText.slice(this.cursor);
    const lines = tail.split(/\r?\n/);
    let lineIdx = 0;               // index inside `lines`
    let charOffset = this.cursor; // absolute char offset of `lines[lineIdx]`

    // Buffer for the block that is currently being built
    let pending: {
      type: 'code_fence' | 'paragraph' | 'table' | 'tool_call';
      startLine: number;        // absolute line number in the whole document
      contentLines: string[];
      fenceLang?: string;       // for code_fence only
    } | null = null;

    while (lineIdx < lines.length) {
      const line = lines[lineIdx];
      const absLineNum = this._lineNumberAt(charOffset);

      // --------------------------------------------------- start a new block?
      if (!pending) {
        const starter = getBlockStarter(line);
        if (starter === 'code_fence') {
          const match = CODE_FENCE_RE.exec(line);
          pending = {
            type: 'code_fence',
            startLine: absLineNum,
            contentLines: [],
            fenceLang: match ? match[1] : '',
          };
        } else if (starter === 'tool_call' && TOOL_CALL_RE.test(line)) {
          // Skip tool calls – UI handles them separately
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        } else if (starter === 'table') {
          // Look ahead for a separator line
          const nextLine = lines[lineIdx + 1] ?? '';
          if (TABLE_SEPARATOR_RE.test(nextLine)) {
            pending = {
              type: 'table',
              startLine: absLineNum,
              contentLines: [line, nextLine],
            };
            lineIdx += 2;
            charOffset += line.length + 1 + nextLine.length + 1;
            continue;
          } else {
            // Not a real table – treat as paragraph
            pending = {
              type: 'paragraph',
              startLine: absLineNum,
              contentLines: [line],
            };
          }
        } else {
          // Paragraph (or continuation)
          pending = {
            type: 'paragraph',
            startLine: absLineNum,
            contentLines: [line],
          };
        }
        // Advance past the starter line
        charOffset += line.length + 1;
        lineIdx++;
        continue;
      }

      // --------------------------------------------------- we are *inside* a block
      if (pending && pending.type === 'code_fence') {
        if (/^```/.test(line)) {
          // Closing fence – emit the code block
          const block = this._makeCodeBlock(pending.contentLines.join('\n'), pending.fenceLang ?? '');
          this._pushBlock(block, newBlocks);
          pending = null;
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        } else {
          pending.contentLines.push(line);
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        }
      }

      if (pending && pending.type === 'table') {
        // Table ends when we hit a blank line or a line without a pipe
        if (line.trim() === '' || !line.includes('|')) {
          const block = this._makeTableBlock(pending.contentLines.join('\n'));
          this._pushBlock(block, newBlocks);
          pending = null;
          // Do NOT consume the current line – it belongs to the next block
        } else {
          pending.contentLines.push(line);
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        }
      }

      if (pending && pending.type === 'paragraph') {
        // Paragraph ends on a blank line (double newline) – we treat any blank line as a delimiter
        if (PARAGRAPH_END_RE.test(line)) {
          const block = this._makeParagraphBlock(pending.contentLines.join('\n'));
          this._pushBlock(block, newBlocks);
          pending = null;
          // Consume the blank line (acts as delimiter)
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        } else {
          pending.contentLines.push(line);
          charOffset += line.length + 1;
          lineIdx++;
          continue;
        }
      }

      // Should never fall through – safety net
      lineIdx++;
    }

    // -------------------------------------------------------------------------
    // Update the global cursor: everything *up to* the start of the pending
    // block (if any) has been fully processed.
    // -------------------------------------------------------------------------
    const processedUpTo = pending
      ? charOffset - (pending.contentLines.join('\n').length + 1) // leave pending untouched
      : charOffset;
    this.cursor = processedUpTo;

    // Store any pending block for the next feed (it will be completed later)
    this._pending = pending; // internal field used only for flush()
    return newBlocks;
  }

  // -------------------------------------------------------------------------
  // Public: called when the message stream is finished – emit any leftover
  // paragraph or table that never got a terminating blank line.
  // -------------------------------------------------------------------------
  public flushRemaining(): ContentBlock[] {
    const leftovers: ContentBlock[] = [];

    if (this._pending) {
      const p = this._pending;
      if (p.type === 'code_fence') {
        // Unclosed fence – still emit as a code block (best‑effort)
        const block = this._makeCodeBlock(p.contentLines.join('\n'), p.fenceLang ?? '');
        this._pushBlock(block, leftovers);
      } else if (p.type === 'table') {
        const block = this._makeTableBlock(p.contentLines.join('\n'));
        this._pushBlock(block, leftovers);
      } else {
        // paragraph (or tool – tool would already be emitted)
        const block = this._makeParagraphBlock(p.contentLines.join('\n'));
        this._pushBlock(block, leftovers);
      }
      this._pending = null;
    }

    // Advance cursor to the end of the whole rawText
    this.cursor = this.rawText.length;
    return leftovers;
  }

  // -------------------------------------------------------------------------
  // INTERNAL helpers
  // -------------------------------------------------------------------------

  // Holds a block that is still incomplete between feeds
  private _pending: {
    type: 'code_fence' | 'paragraph' | 'table' | 'tool_call';
    startLine: number;
    contentLines: string[];
    fenceLang?: string;
  } | null = null;

  /** Convert a raw tool‑call line into a Block */
  private _makeToolBlock(line: string): ContentBlock {
    // Tool calls are handled separately in the UI; we ignore them here.
    return null as any;
  }

  /** Convert buffered code lines to a Block */
  private _makeCodeBlock(code: string, language: string): ContentBlock {
    return {
      type: 'code',
      content: code,
      language,
      source_span: { start: 0, end: code.length },
    } as any;
  }

  /** Convert buffered paragraph lines to a Block */
  private _makeParagraphBlock(text: string): ContentBlock {
    return {
      type: 'paragraph',
      content: text,
      source_span: { start: 0, end: text.length },
    } as any;
  }

  /** Convert buffered table lines to a Block */
  private _makeTableBlock(text: string): ContentBlock {
    return {
      type: 'table',
      content: text,
      source_span: { start: 0, end: text.length },
    } as any;
  }

  /** Push a newly created block onto the emitted list and the caller’s buffer */
  private _pushBlock(block: ContentBlock, target: ContentBlock[]) {
    // internal emittedBlocks storage removed – only push to target
    target.push(block);
  }

  /** Helper: given a raw char offset, compute the line number (1‑based). */
  private _lineNumberAt(charOffset: number): number {
    const slice = this.rawText.slice(0, charOffset);
    return (slice.match(/\n/g) || []).length + 1;
  }
}
