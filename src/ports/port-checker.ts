import * as dgram from 'dgram';
import * as net from 'net';
import { ValidationError } from '../errors';

export type PortStatus = 'free' | 'in-use' | 'unknown';

export interface IPortChecker {
  check(port: number, protocol: 'tcp' | 'udp'): Promise<PortStatus>;
  suggest(preferred: number, used: Set<number>): Promise<number>;
}

/**
 * EACCES is expected for ports below 1024 when EasyHost does not run as
 * root: the port may well be free, so it is "unknown", not "in-use", and the
 * install goes ahead; Docker reports a real conflict itself.
 */
export function classifyBindError(err: NodeJS.ErrnoException): PortStatus {
  return err.code === 'EADDRINUSE' ? 'in-use' : 'unknown';
}

export class PortChecker implements IPortChecker {
  constructor(private readonly host = '0.0.0.0') {}

  check(port: number, protocol: 'tcp' | 'udp'): Promise<PortStatus> {
    return protocol === 'tcp' ? this.checkTcp(port) : this.checkUdp(port);
  }

  async suggest(preferred: number, used: Set<number>): Promise<number> {
    for (let port = preferred; port <= 65535; port++) {
      if (used.has(port)) continue;
      if ((await this.check(port, 'tcp')) !== 'in-use') return port;
    }
    throw new ValidationError(`No free port found from ${preferred} upward`);
  }

  private checkTcp(port: number): Promise<PortStatus> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => resolve(classifyBindError(err)));
      server.listen({ port, host: this.host, exclusive: true }, () => server.close(() => resolve('free')));
    });
  }

  private checkUdp(port: number): Promise<PortStatus> {
    return new Promise((resolve) => {
      const socket = dgram.createSocket('udp4');
      socket.once('error', (err: NodeJS.ErrnoException) => {
        socket.close();
        resolve(classifyBindError(err));
      });
      socket.bind({ port, address: this.host, exclusive: true }, () => socket.close(() => resolve('free')));
    });
  }
}
