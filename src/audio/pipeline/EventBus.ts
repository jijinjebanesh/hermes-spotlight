/**
 * EventBus — Typed event emitter for the voice pipeline.
 *
 * All pipeline modules communicate exclusively through events.
 * No module directly calls methods on another module.
 *
 * Features:
 * - Strongly typed event names and payloads (via EventMap)
 * - Ordered delivery (listeners called in registration order)
 * - Error isolation (one listener throwing doesn't break others)
 * - Debug logging when enabled
 * - Wildcard listener (receives all events — for logging/health monitor)
 * - removeAllListeners() for clean shutdown
 */

import { EventMap, EventTopic, PipelineEvent } from './types';

type Listener<E extends PipelineEvent> = (event: E) => void;
type WildcardListener = (event: PipelineEvent) => void;

const DEBUG = false; // Set to true for pipeline event tracing

export class EventBus {
  private listeners = new Map<EventTopic, Set<Function>>();
  private wildcardListeners = new Set<WildcardListener>();
  private eventCount = 0;
  private destroyed = false;

  /**
   * Subscribe to a specific event type.
   * Returns an unsubscribe function.
   */
  on<T extends EventTopic>(
    topic: T,
    handler: (event: EventMap[T]) => void
  ): () => void {
    if (this.destroyed) {
      console.warn('[EventBus] on() called after destroy');
      return () => {};
    }
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set());
    }
    this.listeners.get(topic)!.add(handler);
    return () => this.off(topic, handler);
  }

  /**
   * Subscribe to all events (for logging, health monitoring, etc.)
   */
  onAny(handler: WildcardListener): () => void {
    if (this.destroyed) return () => {};
    this.wildcardListeners.add(handler);
    return () => this.wildcardListeners.delete(handler);
  }

  /**
   * Unsubscribe from a specific event type.
   */
  off<T extends EventTopic>(
    topic: T,
    handler: (event: EventMap[T]) => void
  ): void {
    this.listeners.get(topic)?.delete(handler);
  }

  /**
   * Emit an event to all subscribers.
   * Errors in individual listeners are caught and logged —
   * one bad listener doesn't break the pipeline.
   */
  emit(event: PipelineEvent): void {
    if (this.destroyed) return;

    this.eventCount++;

    if (DEBUG) {
      console.log(`[EventBus] #${this.eventCount} ${event.type}`, event);
    }

    // Notify wildcard listeners first (logging, health)
    this.wildcardListeners.forEach((wl) => {
      try {
        wl(event);
      } catch (e) {
        console.error('[EventBus] Wildcard listener error:', e);
      }
    });

    // Notify specific listeners
    const set = this.listeners.get(event.type);
    if (set) {
      set.forEach((handler) => {
        try {
          (handler as Function)(event);
        } catch (e) {
          console.error(`[EventBus] Listener error for ${event.type}:`, e);
        }
      });
    }
  }

  /**
   * Remove all listeners. Called during pipeline shutdown.
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
    this.destroyed = true;
  }

  /**
   * Total events emitted since creation. For diagnostics.
   */
  getEventCount(): number {
    return this.eventCount;
  }
}
