/**
 * Port of hermes-agent's markdown_tables.py and cli.py markdown processing.
 */

const DIVIDER_CELL_RE = /^\s*:?-{3,}:?\s*$/;
const MIN_COL_WIDTH = 3;

/**
 * Approximate wcswidth for JS.
 * Returns 2 for CJK and emoji-like wide chars, 1 for normal chars, 0 for empty.
 */
function dispWidth(s: string): number {
  if (!s) return 0;
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Very basic wide character detection for CJK ranges
    if (
      (code >= 0x3000 && code <= 0x9fff) ||
      (code >= 0xac00 && code <= 0xd7af) ||
      (code >= 0xff01 && code <= 0xff60)
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

function padToWidth(s: string, target: number): string {
  const w = dispWidth(s);
  if (w >= target) return s;
  return s + ' '.repeat(target - w);
}

export function splitTableRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.substring(1);
  if (s.endsWith('|')) s = s.substring(0, s.length - 1);
  return s.split('|').map((c) => c.trim());
}

export function isTableDivider(row: string): boolean {
  const cells = splitTableRow(row);
  if (cells.length <= 1) return false;
  return cells.every((c) => DIVIDER_CELL_RE.test(c));
}

export function looksLikeTableRow(row: string): boolean {
  if (!row.includes('|')) return false;
  const stripped = row.trim();
  if (!stripped) return false;
  if (stripped.startsWith('|')) return true;
  return (stripped.match(/\|/g) || []).length >= 2;
}

function wrapToWidth(text: string, width: number): string[] {
  if (width <= 0 || !text) return [text];
  const words = text.split(/\s+/);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  let currentW = 0;

  const hardBreak = (word: string, w: number): string[] => {
    const out: string[] = [];
    let buf = '';
    let bw = 0;
    for (const ch of word) {
      const cw = dispWidth(ch) || 1;
      if (bw + cw > w && buf) {
        out.push(buf);
        buf = ch;
        bw = cw;
      } else {
        buf += ch;
        bw += cw;
      }
    }
    if (buf) out.push(buf);
    return out;
  };

  for (const word of words) {
    const ww = dispWidth(word);
    if (!current) {
      if (ww <= width) {
        current = word;
        currentW = ww;
      } else {
        const pieces = hardBreak(word, width);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] || '';
        currentW = dispWidth(current);
      }
      continue;
    }
    if (currentW + 1 + ww <= width) {
      current += ' ' + word;
      currentW += 1 + ww;
    } else {
      lines.push(current);
      if (ww <= width) {
        current = word;
        currentW = ww;
      } else {
        const pieces = hardBreak(word, width);
        lines.push(...pieces.slice(0, -1));
        current = pieces[pieces.length - 1] || '';
        currentW = dispWidth(current);
      }
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function renderVertical(rows: string[][], ncols: number, availableWidth: number): string[] {
  if (rows.length === 0) return [];

  const headers = rows[0];
  const body = rows.slice(1);
  const labels = Array.from({ length: ncols }, (_, i) => headers[i] || `Column ${i + 1}`);

  const sepWidth = availableWidth ? Math.max(20, Math.min(40, availableWidth - 2)) : 30;
  const separator = '─'.repeat(sepWidth);
  const indent = '  ';
  const indentW = dispWidth(indent);

  const out: string[] = [];
  for (let ri = 0; ri < body.length; ri++) {
    const row = body[ri];
    if (ri > 0) out.push(separator);
    
    for (let ci = 0; ci < ncols; ci++) {
      const label = labels[ci];
      const value = row[ci] || '';
      const labelW = dispWidth(label);
      const firstBudget = Math.max(10, availableWidth - labelW - 2);
      const contBudget = Math.max(10, availableWidth - indentW);

      if (!value) {
        out.push(`${label}:`);
        continue;
      }

      const wrapped = wrapToWidth(value, firstBudget);
      out.push(`${label}: ${wrapped[0]}`);
      
      if (wrapped.length > 1) {
        const contText = wrapped.slice(1).join(' ');
        for (const cl of wrapToWidth(contText, contBudget)) {
          if (cl.trim()) {
            out.push(`${indent}${cl}`);
          }
        }
      }
    }
  }
  return out;
}

function renderBlock(rows: string[][], availableWidth?: number): string[] {
  const ncols = Math.max(...rows.map((r) => r.length));
  // Pad rows to ncols
  rows = rows.map((r) => {
    const newRow = [...r];
    while (newRow.length < ncols) newRow.push('');
    return newRow;
  });

  const widths: number[] = [];
  for (let c = 0; c < ncols; c++) {
    widths.push(Math.max(MIN_COL_WIDTH, ...rows.map((r) => dispWidth(r[c]))));
  }

  const horizontalWidth = widths.reduce((a, b) => a + b, 0) + 3 * ncols + 1;

  if (availableWidth !== undefined && horizontalWidth > Math.max(availableWidth, 20)) {
    return renderVertical(rows, ncols, availableWidth);
  }

  const formatRow = (cells: string[]) => {
    return '| ' + cells.map((c, k) => padToWidth(c, widths[k])).join(' | ') + ' |';
  };

  const out = [formatRow(rows[0])];
  out.push('|' + widths.map((w) => '-'.repeat(w + 2)).join('|') + '|');
  for (let i = 1; i < rows.length; i++) {
    out.push(formatRow(rows[i]));
  }
  return out;
}

export function realignMarkdownTables(text: string, availableWidth?: number): string {
  if (!text.includes('|')) return text;

  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];
    if (line.includes('|') && i + 1 < n && isTableDivider(lines[i + 1])) {
      const header = splitTableRow(line);
      const body: string[][] = [];
      let j = i + 2;
      while (j < n && lines[j].includes('|') && lines[j].trim()) {
        if (isTableDivider(lines[j])) {
          j++;
          continue;
        }
        body.push(splitTableRow(lines[j]));
        j++;
      }

      if (header.some(c => c) || body.length > 0) {
        out.push(...renderBlock([header, ...body], availableWidth));
        i = j;
        continue;
      }
    }
    out.push(line);
    i++;
  }

  return out.join('\n');
}

/**
 * Port of `_strip_markdown_syntax` from hermes-agent cli.py
 */
export function stripMarkdownSyntax(text: string): string {
  let plain = text || '';

  // plain = re.sub(r"^\s{0,3}(?:[-_]\s*){3,}$", "", plain, flags=re.MULTILINE)
  plain = plain.replace(/^\s{0,3}(?:[-_]\s*){3,}$/gm, '');
  // plain = re.sub(r"^\s{0,3}(?:\*\s*){3}\s*$", "", plain, flags=re.MULTILINE)
  plain = plain.replace(/^\s{0,3}(?:\*\s*){3}\s*$/gm, '');
  // plain = re.sub(r"^\s{0,3}#{1,6}\s+", "", plain, flags=re.MULTILINE)
  plain = plain.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // plain = re.sub(r"(```+|~~~+)", "", plain)
  plain = plain.replace(/(```+|~~~+)/g, '');
  // plain = re.sub(r"`([^`]*)`", r"\1", plain)
  plain = plain.replace(/`([^`]*)`/g, '$1');
  // plain = re.sub(r"!\[([^\]]*)\]\([^\)]*\)", r"\1", plain)
  plain = plain.replace(/!\[([^\]]*)\]\([^\)]*\)/g, '$1');
  // plain = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", plain)
  plain = plain.replace(/\[([^\]]+)\]\([^\)]*\)/g, '$1');
  // plain = re.sub(r"\*\*\*([^*]+)\*\*\*", r"\1", plain)
  plain = plain.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  // plain = re.sub(r"(?<!\w)___([^_]+)___(?!\w)", r"\1", plain)
  // Note: JS doesn't support lookbehinds universally in all older environments, 
  // but ES2018+ supports it. Since this is an Electron app running node 20+, we can use it.
  plain = plain.replace(/(?<!\w)___([^_]+)___(?!\w)/g, '$1');
  // plain = re.sub(r"\*\*([^*]+)\*\*", r"\1", plain)
  plain = plain.replace(/\*\*([^*]+)\*\*/g, '$1');
  // plain = re.sub(r"(?<!\w)__([^_]+)__(?!\w)", r"\1", plain)
  plain = plain.replace(/(?<!\w)__([^_]+)__(?!\w)/g, '$1');
  // plain = re.sub(r"\*([^\s*][^*]*?[^\s*])\*", r"\1", plain)
  plain = plain.replace(/\*([^\s*][^*]*?[^\s*])\*/g, '$1');
  // plain = re.sub(r"(?<!\w)_([^_]+)_(?!\w)", r"\1", plain)
  plain = plain.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');
  // plain = re.sub(r"~~([^~]+)~~", r"\1", plain)
  plain = plain.replace(/~~([^~]+)~~/g, '$1');
  // plain = re.sub(r"\n{3,}", "\n\n", plain)
  plain = plain.replace(/\n{3,}/g, '\n\n');

  return plain.replace(/\n$/, '').trimEnd();
}
