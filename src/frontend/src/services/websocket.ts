import type { WebSocketMessage } from '../types';

export type WebSocketEventHandler = (message: WebSocketMessage) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectInterval = 5000;
  private pingInterval: number | null = null;
  private eventHandlers: Map<string, WebSocketEventHandler[]> = new Map();
  private isConnecting = false;
  private shouldReconnect = true;

  constructor() {
    // WebSocket URL - will be set from environment or API discovery
    this.url = this.getWebSocketUrl();
  }

  private getWebSocketUrl(): string {
    const apiEndpoint = import.meta.env.VITE_API_ENDPOINT || '';
    if (apiEndpoint) {
      // Convert REST API endpoint to WebSocket endpoint
      // https://api-id.execute-api.region.amazonaws.com/prod -> wss://api-id.execute-api.region.amazonaws.com/prod
      return apiEndpoint.replace('https://', 'wss://').replace('/prod', '/prod');
    }
    return 'wss://your-websocket-endpoint';
  }

  connect(userId?: string, userRole?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      if (this.isConnecting) {
        reject(new Error('Connection already in progress'));
        return;
      }

      this.isConnecting = true;
      
      // Add user parameters to URL if provided
      let wsUrl = this.url;
      if (userId || userRole) {
        const params = new URLSearchParams();
        if (userId) params.append('userId', userId);
        if (userRole) params.append('userRole', userRole);
        wsUrl += `?${params.toString()}`;
      }

      try {
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.startPingInterval();
          this.emit('connection', {
            type: 'connection',
            status: 'connected',
            message: 'WebSocket connection established',
            timestamp: new Date().toISOString()
          });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WebSocketMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        this.ws.onclose = (event) => {
          console.log('WebSocket closed:', event.code, event.reason);
          this.isConnecting = false;
          this.stopPingInterval();
          
          this.emit('connection', {
            type: 'connection',
            status: 'disconnected',
            message: `WebSocket connection closed: ${event.reason}`,
            timestamp: new Date().toISOString()
          });

          if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          this.isConnecting = false;
          
          this.emit('error', {
            type: 'error',
            message: 'WebSocket connection error',
            timestamp: new Date().toISOString()
          });

          reject(error);
        };

      } catch (error) {
        this.isConnecting = false;
        reject(error);
      }
    });
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.stopPingInterval();
    
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
  }

  send(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket not connected, cannot send message');
    }
  }

  subscribe(topics: string[]): void {
    this.send({
      type: 'subscribe',
      topics
    });
  }

  unsubscribe(topics: string[]): void {
    this.send({
      type: 'unsubscribe',
      topics
    });
  }

  ping(): void {
    this.send({
      type: 'ping'
    });
  }

  // Event handling
  on(event: string, handler: WebSocketEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  off(event: string, handler: WebSocketEventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  private emit(event: string, message: WebSocketMessage): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(message));
    }
  }

  private handleMessage(message: WebSocketMessage): void {
    console.log('WebSocket message received:', message);

    // Emit specific event based on message type
    this.emit(message.type, message);
    
    // Also emit general 'message' event
    this.emit('message', message);

    // Handle pong responses
    if (message.type === 'pong') {
      console.log('Received pong from server');
    }
  }

  private startPingInterval(): void {
    this.pingInterval = window.setInterval(() => {
      this.ping();
    }, 30000); // Ping every 30 seconds
  }

  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
    
    setTimeout(() => {
      if (this.shouldReconnect) {
        this.connect().catch(error => {
          console.error('Reconnect failed:', error);
        });
      }
    }, this.reconnectInterval);
  }

  // Getters
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get connectionState(): string {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
        return 'closing';
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }
}

// Create singleton instance
const webSocketService = new WebSocketService();

export default webSocketService;
