// client/api/socket.ts
import { io, Socket } from 'socket.io-client';
import {
  UploadCompletedEvent,
  UploadFailedEvent,
  UploadProgressEvent,
} from '@/types/dashboard.types';

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000';

/**
 * Server-to-Client & Client-to-Server Event Maps
 */
export interface ServerToClientEvents {
  'upload:progress': (payload: UploadProgressEvent) => void;
  'upload:completed': (payload: UploadCompletedEvent) => void;
  'upload:failed': (payload: UploadFailedEvent) => void;
}

export interface ClientToServerEvents {
  'join:batch': (batchId: string) => void;
  'leave:batch': (batchId: string) => void;
}

let socketInstance: Socket<ServerToClientEvents, ClientToServerEvents> | null =
  null;

/**
 * Returns a singleton Socket.io client instance (SSR-safe for Next.js App Router)
 */
export const getSocket = (): Socket<
  ServerToClientEvents,
  ClientToServerEvents
> | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!socketInstance) {
    socketInstance = io(SOCKET_URL, {
      autoConnect: false, // Connect explicitly when needed
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });

    socketInstance.on('connect_error', (err) => {
      console.warn('[Socket.io] Connection warning:', err.message);
    });
  }

  return socketInstance;
};

/**
 * Connects the singleton WebSocket instance if not already connected
 */
export const connectSocket = (): Socket<
  ServerToClientEvents,
  ClientToServerEvents
> | null => {
  const socket = getSocket();
  if (socket && !socket.connected) {
    socket.connect();
  }
  return socket;
};

/**
 * Disconnects the singleton WebSocket instance
 */
export const disconnectSocket = (): void => {
  if (socketInstance && socketInstance.connected) {
    socketInstance.disconnect();
  }
};

export interface BatchSubscriptionCallbacks {
  onProgress?: (data: UploadProgressEvent) => void;
  onCompleted?: (data: UploadCompletedEvent) => void;
  onFailed?: (data: UploadFailedEvent) => void;
}

/**
 * Subscribes to real-time BullMQ worker events (`upload:progress`, `upload:completed`)
 * scoped to a specific `batchId`. Returns a cleanup function for React `useEffect`.
 */
export const subscribeToBatchEvents = (
  batchId: string,
  callbacks: BatchSubscriptionCallbacks
): (() => void) => {
  const socket = connectSocket();
  if (!socket || !batchId) {
    return () => {};
  }

  // Notify backend room if room-based broadcasting is supported
  socket.emit('join:batch', batchId);

  const handleProgress = (payload: UploadProgressEvent) => {
    if (!payload.batchId || payload.batchId === batchId) {
      callbacks.onProgress?.(payload);
    }
  };

  const handleCompleted = (payload: UploadCompletedEvent) => {
    if (!payload.batchId || payload.batchId === batchId) {
      callbacks.onCompleted?.(payload);
    }
  };

  const handleFailed = (payload: UploadFailedEvent) => {
    if (!payload.batchId || payload.batchId === batchId) {
      callbacks.onFailed?.(payload);
    }
  };

  socket.on('upload:progress', handleProgress);
  socket.on('upload:completed', handleCompleted);
  socket.on('upload:failed', handleFailed);

  // Cleanup function to remove listeners on unmount or batch change
  return () => {
    socket.emit('leave:batch', batchId);
    socket.off('upload:progress', handleProgress);
    socket.off('upload:completed', handleCompleted);
    socket.off('upload:failed', handleFailed);
  };
};