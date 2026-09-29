import * as dgram from 'dgram';
import * as net from 'net';
import { PortChecker, classifyBindError } from './port-checker';

function listenTcp(): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen({ port: 0, host: '0.0.0.0' }, () => resolve(server));
  });
}

function bindUdp(): Promise<dgram.Socket> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.bind({ port: 0, address: '0.0.0.0' }, () => resolve(socket));
  });
}

describe('classifyBindError', () => {
  it.each([
    ['EADDRINUSE', 'in-use'],
    ['EACCES', 'unknown'],
    ['EADDRNOTAVAIL', 'unknown'],
  ])('%s → %s', (code, expected) => {
    expect(classifyBindError(Object.assign(new Error(code), { code }))).toBe(expected);
  });
});

describe('PortChecker', () => {
  const checker = new PortChecker();

  it('reports a bound TCP port as in-use and free once released', async () => {
    const server = await listenTcp();
    const port = (server.address() as net.AddressInfo).port;
    await expect(checker.check(port, 'tcp')).resolves.toBe('in-use');
    await new Promise((r) => server.close(r));
    await expect(checker.check(port, 'tcp')).resolves.toBe('free');
  });

  it('reports a bound UDP port as in-use', async () => {
    const socket = await bindUdp();
    const port = socket.address().port;
    await expect(checker.check(port, 'udp')).resolves.toBe('in-use');
    socket.close();
  });

  // Linux-specific: other systems may allow a wildcard bind next to a specific one.
  (process.platform === 'linux' ? it : it.skip)('reports a UDP port held only on a loopback address as in-use (Ubuntu\'s DNS helper on 127.0.0.53)', async () => {
    const socket = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => socket.bind({ port: 0, address: '127.0.0.53' }, resolve));
    const port = socket.address().port;
    await expect(checker.check(port, 'udp')).resolves.toBe('in-use');
    socket.close();
  });

  it('suggests the next port that is neither used by an app nor bound on the host', async () => {
    const server = await listenTcp();
    const bound = (server.address() as net.AddressInfo).port;
    const suggested = await checker.suggest(bound, new Set([bound + 1]));
    expect(suggested).toBeGreaterThanOrEqual(bound + 2);
    await new Promise((r) => server.close(r));
  });

  it('returns the preferred port when it is free', async () => {
    const server = await listenTcp();
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((r) => server.close(r));
    await expect(checker.suggest(port, new Set())).resolves.toBe(port);
  });
});
