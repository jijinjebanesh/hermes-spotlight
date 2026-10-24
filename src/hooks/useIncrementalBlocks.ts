// Hook that turns a growing raw markdown string into an array of ContentBlock objects
// using the StreamingMarkdownParser defined in src/parser/StreamingMarkdownParser.ts

import { useEffect, useRef, useState, useCallback } from 'react';
import { StreamingMarkdownParser } from '../parser/StreamingMarkdownParser';
import type { ContentBlock } from '../models/Message';

/**
 * Returns:
 *   - blocks: the array of parsed ContentBlock objects (in order)
 *   - flush: call when the stream is finished to emit any remaining partial block
 */
export function useIncrementalBlocks(rawMessage: string) {
  const parserRef = useRef<StreamingMarkdownParser | null>(null);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const prevRawRef = useRef<string>('');

  if (!parserRef.current) {
    parserRef.current = new StreamingMarkdownParser();
  }

  // Feed only the newly appended part of the rawMessage each render
  useEffect(() => {
    const prev = prevRawRef.current;
    if (rawMessage.length > prev.length) {
      const delta = rawMessage.slice(prev.length);
      const newBlocks = parserRef.current!.feed(delta);
      if (newBlocks.length) {
        setBlocks((prevBlocks) => [...prevBlocks, ...newBlocks]);
      }
    }
    prevRawRef.current = rawMessage;
  }, [rawMessage]);

  const flush = useCallback(() => {
    const remaining = parserRef.current!.flushRemaining();
    if (remaining.length) {
      setBlocks((prevBlocks) => [...prevBlocks, ...remaining]);
    }
  }, []);

  return { blocks, flush };
}
