import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys.js';

export interface SseEventData {
  item_id: string;
  team_id: string;
  version: number;
  type: string;
  event_id?: number | string;
}

export type SseListener = (event: SseEventData) => void;

export class SseClient {
  private queryClient: QueryClient;
  private abortController: AbortController | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private listeners = new Set<SseListener>();
  private reconnectDelay = 1000;
  private isConnected = false;

  constructor(queryClient: QueryClient) {
    this.queryClient = queryClient;
  }

  public subscribe(listener: SseListener): () => void {
    this.listeners.add(listener);
    if (!this.isConnected && !this.abortController) {
      this.connect();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.disconnect();
      }
    };
  }

  public connect(): void {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('opsflow_token') : null;
    if (!token) return;

    this.disconnect();
    this.abortController = new AbortController();

    const connectUrl = '/api/v1/stream';

    fetch(connectUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: this.abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok || !response.body) {
          throw new Error(`SSE HTTP error ${response.status}`);
        }

        this.isConnected = true;
        this.reconnectDelay = 1000;

        // Invalidate active queries on initial connection / reconnect
        this.queryClient.invalidateQueries();

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            this.handleBlock(block);
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        this.handleDisconnect();
      });
  }

  public disconnect(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isConnected = false;
  }

  private handleBlock(block: string): void {
    const lines = block.split('\n');
    let eventType = 'message';
    let dataStr = '';

    for (const line of lines) {
      if (line.startsWith(':')) {
        // Comment / heartbeat
        continue;
      }
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr = line.slice(5).trim();
      }
    }

    if (eventType === 'item_changed' && dataStr) {
      try {
        const payload: SseEventData = JSON.parse(dataStr);
        for (const listener of this.listeners) {
          listener(payload);
        }
      } catch {
        // invalid payload
      }
    }
  }

  private handleDisconnect(): void {
    this.isConnected = false;
    this.abortController = null;

    if (this.listeners.size > 0) {
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.connect();
      }, this.reconnectDelay);
    }
  }
}
