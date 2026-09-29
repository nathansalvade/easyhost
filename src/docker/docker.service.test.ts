import { DockerService } from './docker.service';
import { ContainerMissingError, DockerOperationError, DockerUnavailableError } from '../errors';
import type { DaemonError, DockerodeClient, DockerodeContainer } from './docker.types';

function makeContainer(overrides: Partial<DockerodeContainer> = {}): DockerodeContainer {
  return {
    id: 'container-id',
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    logs: jest.fn().mockResolvedValue(Buffer.from('')),
    inspect: jest.fn().mockResolvedValue({ State: { Running: true } }),
    ...overrides,
  };
}

function makeDocker(overrides: Partial<DockerodeClient> = {}): DockerodeClient {
  return {
    modem: {
      followProgress: jest.fn((_stream, onFinished) => onFinished(null, [])),
    },
    pull: jest.fn((_image, callback) => callback(null, {})),
    createContainer: jest.fn().mockResolvedValue(makeContainer()),
    getContainer: jest.fn(),
    ping: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function daemonError(message: string, extra: Partial<DaemonError>): DaemonError {
  const err = new Error(message) as DaemonError;
  Object.assign(err, extra);
  return err;
}

/** Builds a Buffer framed the way Docker multiplexes stdout/stderr. */
function frame(streamType: 1 | 2, text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt8(streamType, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

describe('DockerService', () => {
  describe('pullImage', () => {
    it('resolves when the pull completes successfully', async () => {
      const docker = makeDocker();
      const service = new DockerService(docker);

      await expect(service.pullImage('nginx:latest')).resolves.toBeUndefined();
      expect(docker.pull).toHaveBeenCalledWith('nginx:latest', expect.any(Function));
    });

    it('rejects with DockerOperationError when the pull stream errors', async () => {
      const docker = makeDocker({
        modem: {
          followProgress: jest.fn((_stream, onFinished) =>
            onFinished(new Error('stream broke'), []),
          ),
        },
      });
      const service = new DockerService(docker);

      await expect(service.pullImage('nginx:latest')).rejects.toBeInstanceOf(
        DockerOperationError,
      );
    });

    it('rejects with DockerUnavailableError when the daemon socket is unreachable', async () => {
      const docker = makeDocker({
        pull: jest.fn((_image, callback) =>
          callback(daemonError('connect ENOENT', { code: 'ENOENT' })),
        ),
      });
      const service = new DockerService(docker);

      await expect(service.pullImage('nginx:latest')).rejects.toBeInstanceOf(
        DockerUnavailableError,
      );
    });

    it('rejects with DockerUnavailableError on ECONNREFUSED', async () => {
      const docker = makeDocker({
        pull: jest.fn((_image, callback) =>
          callback(daemonError('connect refused', { code: 'ECONNREFUSED' })),
        ),
      });
      const service = new DockerService(docker);

      await expect(service.pullImage('nginx:latest')).rejects.toBeInstanceOf(
        DockerUnavailableError,
      );
    });
  });

  describe('createAndStart', () => {
    it('creates the container with expected options, starts it and returns its id', async () => {
      const container = makeContainer({ id: 'abc123' });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker);

      const id = await service.createAndStart({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 80,
        env: { FOO: 'bar' },
      });

      expect(id).toBe('abc123');
      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'my-app',
          Image: 'nginx:latest',
          Env: ['FOO=bar'],
          ExposedPorts: { '80/tcp': {} },
          HostConfig: {
            PortBindings: { '80/tcp': [{ HostPort: '8080', HostIp: '0.0.0.0' }] },
            Mounts: [],
          },
        }),
      );
      expect(container.start).toHaveBeenCalled();
    });

    it('binds the published port to a custom bind address when configured', async () => {
      const container = makeContainer({ id: 'abc123' });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker, { bindAddress: '127.0.0.1' });

      await service.createAndStart({
        name: 'my-app',
        image: 'nginx:latest',
        hostPort: 8080,
        containerPort: 80,
      });

      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: {
            PortBindings: { '80/tcp': [{ HostPort: '8080', HostIp: '127.0.0.1' }] },
            Mounts: [],
          },
        }),
      );
    });

    it('best-effort removes the container and rethrows when start fails, without masking the original error', async () => {
      const removeMock = jest.fn().mockResolvedValue(undefined);
      const container = makeContainer({
        id: 'abc123',
        start: jest.fn().mockRejectedValue(daemonError('boom', { statusCode: 500 })),
        remove: removeMock,
      });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker);

      await expect(
        service.createAndStart({
          name: 'my-app',
          image: 'nginx:latest',
          hostPort: 8080,
          containerPort: 80,
        }),
      ).rejects.toBeInstanceOf(DockerOperationError);

      expect(removeMock).toHaveBeenCalledWith({ force: true });
    });

    it('does not attach a containerId to the error when the cleanup removal succeeds', async () => {
      const container = makeContainer({
        id: 'abc123',
        start: jest.fn().mockRejectedValue(daemonError('boom', { statusCode: 500 })),
        remove: jest.fn().mockResolvedValue(undefined),
      });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker);

      await expect(
        service.createAndStart({
          name: 'my-app',
          image: 'nginx:latest',
          hostPort: 8080,
          containerPort: 80,
        }),
      ).rejects.toMatchObject({ containerId: undefined });
    });

    it('still rethrows the original start error even when the cleanup removal also fails', async () => {
      const container = makeContainer({
        id: 'abc123',
        start: jest.fn().mockRejectedValue(daemonError('start boom', { statusCode: 500 })),
        remove: jest.fn().mockRejectedValue(daemonError('remove boom', { statusCode: 500 })),
      });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker);

      await expect(
        service.createAndStart({
          name: 'my-app',
          image: 'nginx:latest',
          hostPort: 8080,
          containerPort: 80,
        }),
      ).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'start boom' }) });
    });

    it('never puts Docker\'s own text in the error message a client sees', async () => {
      const container = makeContainer({
        start: jest.fn().mockRejectedValue(daemonError('OCI runtime create failed: /var/lib/docker/secret-path', { statusCode: 500 })),
      });
      const service = new DockerService(makeDocker({ createContainer: jest.fn().mockResolvedValue(container) }));
      const err = await service
        .createAndStart({ name: 'x', image: 'x:1', hostPort: 8080, containerPort: 80 })
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(DockerOperationError);
      expect((err as Error).message).not.toContain('secret-path');
    });

    it('carries the container id on the error when start and the cleanup removal both fail', async () => {
      const container = makeContainer({
        id: 'abc123',
        start: jest.fn().mockRejectedValue(daemonError('start boom', { statusCode: 500 })),
        remove: jest.fn().mockRejectedValue(daemonError('remove boom', { statusCode: 500 })),
      });
      const docker = makeDocker({
        createContainer: jest.fn().mockResolvedValue(container),
      });
      const service = new DockerService(docker);

      await expect(
        service.createAndStart({
          name: 'my-app',
          image: 'nginx:latest',
          hostPort: 8080,
          containerPort: 80,
        }),
      ).rejects.toMatchObject({ containerId: 'abc123' });
    });
  });

  describe('createAndStart with mounts and fixed ports', () => {
    it('passes bind mounts through the Mounts API, keeping spaces and accents intact', async () => {
      const container = makeContainer();
      const docker = makeDocker({ createContainer: jest.fn().mockResolvedValue(container) });
      const service = new DockerService(docker);
      await service.createAndStart({
        name: 'jf',
        image: 'jellyfin/jellyfin:12.1',
        hostPort: 8096,
        containerPort: 8096,
        mounts: [{ hostPath: 'C:\\Users\\Raoul Salvadé\\data\\apps\\abc\\config', containerPath: '/config' }],
      });
      expect(docker.createContainer).toHaveBeenCalledWith(
        expect.objectContaining({
          HostConfig: expect.objectContaining({
            Mounts: [{ Type: 'bind', Source: 'C:\\Users\\Raoul Salvadé\\data\\apps\\abc\\config', Target: '/config' }],
          }),
        }),
      );
      expect(container.start).toHaveBeenCalled();
    });

    it('publishes fixed TCP and UDP ports on the bind address', async () => {
      const docker = makeDocker();
      const service = new DockerService(docker, { bindAddress: '0.0.0.0' });
      await service.createAndStart({
        name: 'pihole',
        image: 'pihole/pihole:2026.09.0',
        hostPort: 8082,
        containerPort: 80,
        fixedPorts: [
          { containerPort: 53, hostPort: 53, protocol: 'tcp' },
          { containerPort: 53, hostPort: 53, protocol: 'udp' },
        ],
      });
      const options = (docker.createContainer as jest.Mock).mock.calls[0][0];
      expect(options.ExposedPorts).toEqual({ '80/tcp': {}, '53/tcp': {}, '53/udp': {} });
      expect(options.HostConfig.PortBindings).toEqual({
        '80/tcp': [{ HostPort: '8082', HostIp: '0.0.0.0' }],
        '53/tcp': [{ HostPort: '53', HostIp: '0.0.0.0' }],
        '53/udp': [{ HostPort: '53', HostIp: '0.0.0.0' }],
      });
    });

    it.each([
      ['driver failed programming external connectivity on endpoint x: Bind for 0.0.0.0:53 failed: port is already allocated', 53, 'tcp'],
      ['Error starting userland proxy: listen udp4 0.0.0.0:53: bind: address already in use', 53, 'udp'],
      ['Error starting userland proxy: listen tcp4 0.0.0.0:8096: bind: address already in use', 8096, 'tcp'],
      ['Error starting userland proxy: listen tcp6 [::]:8443: bind: address already in use', 8443, 'tcp'],
      // Docker Desktop on Windows / macOS
      [
        'Ports are not available: exposing port UDP 0.0.0.0:53 -> 0.0.0.0:0: listen udp 0.0.0.0:53: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.',
        53,
        'udp',
      ],
      ['Ports are not available: exposing port TCP 0.0.0.0:8080 -> 0.0.0.0:0: listen tcp 0.0.0.0:8080: bind: address already in use', 8080, 'tcp'],
    ])('maps "%s" to PortInUseError(%d, %s) and still cleans up', async (message, port, protocol) => {
      const container = makeContainer({ start: jest.fn().mockRejectedValue(daemonError(message, { statusCode: 500 })) });
      const docker = makeDocker({ createContainer: jest.fn().mockResolvedValue(container) });
      const service = new DockerService(docker);
      await expect(
        service.createAndStart({ name: 'x', image: 'x:1', hostPort: 8096, containerPort: 8096 }),
      ).rejects.toMatchObject({ code: 'PORT_IN_USE', details: { port, protocol } });
      expect(container.remove).toHaveBeenCalledWith({ force: true });
    });

    it('keeps the container id on a port conflict when cleanup also fails', async () => {
      const container = makeContainer({
        id: 'abc123',
        start: jest.fn().mockRejectedValue(daemonError('Bind for 0.0.0.0:53 failed: port is already allocated', {})),
        remove: jest.fn().mockRejectedValue(daemonError('remove boom', { statusCode: 500 })),
      });
      const docker = makeDocker({ createContainer: jest.fn().mockResolvedValue(container) });
      const service = new DockerService(docker);
      await expect(
        service.createAndStart({ name: 'x', image: 'x:1', hostPort: 8096, containerPort: 8096 }),
      ).rejects.toMatchObject({ code: 'PORT_IN_USE', containerId: 'abc123' });
    });
  });

  describe('start', () => {
    it('starts the container', async () => {
      const container = makeContainer();
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await service.start('abc123');

      expect(docker.getContainer).toHaveBeenCalledWith('abc123');
      expect(container.start).toHaveBeenCalled();
    });

    it('resolves without throwing when the container is already running (304)', async () => {
      const container = makeContainer({
        start: jest.fn().mockRejectedValue(daemonError('already started', { statusCode: 304 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.start('abc123')).resolves.toBeUndefined();
    });

    it('rejects with ContainerMissingError when the container no longer exists (404)', async () => {
      const container = makeContainer({
        start: jest.fn().mockRejectedValue(daemonError('no such container', { statusCode: 404 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.start('abc123')).rejects.toBeInstanceOf(ContainerMissingError);
    });
  });

  describe('stop', () => {
    it('stops the container', async () => {
      const container = makeContainer();
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await service.stop('abc123');

      expect(container.stop).toHaveBeenCalled();
    });

    it('resolves without throwing when the container is already stopped (304)', async () => {
      const container = makeContainer({
        stop: jest.fn().mockRejectedValue(daemonError('already stopped', { statusCode: 304 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.stop('abc123')).resolves.toBeUndefined();
    });

    it('rejects with ContainerMissingError when the container no longer exists (404)', async () => {
      const container = makeContainer({
        stop: jest.fn().mockRejectedValue(daemonError('no such container', { statusCode: 404 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.stop('abc123')).rejects.toBeInstanceOf(ContainerMissingError);
    });
  });

  describe('remove', () => {
    it('removes the container', async () => {
      const container = makeContainer();
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await service.remove('abc123', { force: true });

      expect(container.remove).toHaveBeenCalledWith({ force: true });
    });

    it('resolves without throwing when the container is already gone (404)', async () => {
      const container = makeContainer({
        remove: jest.fn().mockRejectedValue(daemonError('no such container', { statusCode: 404 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.remove('abc123', { force: true })).resolves.toBeUndefined();
    });
  });

  describe('logs', () => {
    it('demultiplexes framed stdout/stderr output', async () => {
      const buffer = Buffer.concat([frame(1, 'hello '), frame(2, 'world')]);
      const container = makeContainer({ logs: jest.fn().mockResolvedValue(buffer) });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      const logs = await service.logs('abc123', { tail: 100 });

      expect(logs).toBe('hello world');
    });

    it('falls back to raw text when the output is not frame-multiplexed (TTY)', async () => {
      const raw = Buffer.from('plain tty output\n', 'utf8');
      const container = makeContainer({ logs: jest.fn().mockResolvedValue(raw) });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      const logs = await service.logs('abc123', { tail: 100 });

      expect(logs).toBe('plain tty output\n');
    });

    it('clamps the requested tail to maxTail', async () => {
      const container = makeContainer();
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker, { maxTail: 500 });

      await service.logs('abc123', { tail: 10000 });

      expect(container.logs).toHaveBeenCalledWith(
        expect.objectContaining({ tail: 500, stdout: true, stderr: true, follow: false }),
      );
    });

    it('passes through a tail within the max unchanged', async () => {
      const container = makeContainer();
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker, { maxTail: 1000 });

      await service.logs('abc123', { tail: 50 });

      expect(container.logs).toHaveBeenCalledWith(expect.objectContaining({ tail: 50 }));
    });

    it('rejects with ContainerMissingError when the container no longer exists (404)', async () => {
      const container = makeContainer({
        logs: jest.fn().mockRejectedValue(daemonError('no such container', { statusCode: 404 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.logs('abc123', { tail: 100 })).rejects.toBeInstanceOf(
        ContainerMissingError,
      );
    });
  });

  describe('inspectState', () => {
    it('returns exists: true, running: true for a running container', async () => {
      const container = makeContainer({ inspect: jest.fn().mockResolvedValue({ State: { Running: true } }) });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.inspectState('abc123')).resolves.toEqual({ exists: true, running: true });
    });

    it('returns exists: true, running: false for a stopped container', async () => {
      const container = makeContainer({ inspect: jest.fn().mockResolvedValue({ State: { Running: false } }) });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.inspectState('abc123')).resolves.toEqual({ exists: true, running: false });
    });

    it('returns exists: false, running: false when the container no longer exists (404)', async () => {
      const container = makeContainer({
        inspect: jest.fn().mockRejectedValue(daemonError('no such container', { statusCode: 404 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.inspectState('abc123')).resolves.toEqual({ exists: false, running: false });
    });
  });

  describe('ping', () => {
    it('returns true when the daemon responds', async () => {
      const docker = makeDocker({ ping: jest.fn().mockResolvedValue(undefined) });
      const service = new DockerService(docker);

      await expect(service.ping()).resolves.toBe(true);
    });

    it('returns false and never throws when the daemon is unreachable', async () => {
      const docker = makeDocker({ ping: jest.fn().mockRejectedValue(new Error('boom')) });
      const service = new DockerService(docker);

      await expect(service.ping()).resolves.toBe(false);
    });
  });

  describe('daemon connection errors', () => {
    it('translates EACCES on start into DockerUnavailableError', async () => {
      const container = makeContainer({
        start: jest.fn().mockRejectedValue(daemonError('permission denied', { code: 'EACCES' })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.start('abc123')).rejects.toBeInstanceOf(DockerUnavailableError);
    });

    it('translates other daemon errors into DockerOperationError', async () => {
      const container = makeContainer({
        stop: jest.fn().mockRejectedValue(daemonError('internal error', { statusCode: 500 })),
      });
      const docker = makeDocker({ getContainer: jest.fn().mockReturnValue(container) });
      const service = new DockerService(docker);

      await expect(service.stop('abc123')).rejects.toBeInstanceOf(DockerOperationError);
    });
  });
});
