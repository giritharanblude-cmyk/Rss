import { describe, expect, it } from 'vitest';
import { SocketClient } from '@open-wa/wa-automate-socket-client';

describe('OpenWA socket client namespace', () => {
  it('targets /events using the default Socket.IO transport path', () => {
    const client = new SocketClient('http://127.0.0.1:1');
    try {
      expect(Reflect.get(client.socket, 'nsp')).toBe('/events');
      expect(client.socket.io.opts.path).toBe('/socket.io');
    } finally {
      client.socket.disconnect();
    }
  });
});
