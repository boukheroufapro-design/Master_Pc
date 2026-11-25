import { createServer as createHttpServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInstructions, findShortestPath, HEADINGS } from './pathfinding.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_LINE_LENGTH = 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) {
    return;
  }

  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJson(request) {
  let body = '';

  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body is too large.');
    }
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function validNode(node) {
  return Number.isInteger(node) && node >= 1 && node <= 12;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(server.address());
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function createBackend(options = {}) {
  const httpHost = options.httpHost ?? process.env.API_HOST ?? '127.0.0.1';
  const httpPort = options.httpPort ?? Number(process.env.API_PORT ?? 3000);
  const robotHost = options.robotHost ?? process.env.ROBOT_TCP_HOST ?? '0.0.0.0';
  const robotPort = options.robotPort ?? Number(process.env.ROBOT_TCP_PORT ?? 5050);
  const ackTimeoutMs = options.ackTimeoutMs ?? Number(process.env.ROBOT_STEP_TIMEOUT_MS ?? 120000);
  const robotToken = options.robotToken ?? process.env.ROBOT_TOKEN ?? '';
  const initialHeading = options.initialHeading ?? process.env.ROBOT_INITIAL_HEADING ?? 'up';

  if (!HEADINGS.includes(initialHeading)) {
    throw new Error(`ROBOT_INITIAL_HEADING must be one of: ${HEADINGS.join(', ')}.`);
  }
  if (!Number.isInteger(ackTimeoutMs) || ackTimeoutMs < 1) {
    throw new Error('ROBOT_STEP_TIMEOUT_MS must be a positive integer.');
  }

  let robot = null;
  let pendingAck = null;
  let movementInProgress = false;
  let currentNode = null;
  let currentHeading = initialHeading;
  let nextSequence = 1;

  function rejectPending(error, socket) {
    if (!pendingAck || (socket && pendingAck.socket !== socket)) {
      return;
    }

    const pending = pendingAck;
    pendingAck = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  function resolvePending(line, socket) {
    if (!pendingAck || pendingAck.socket !== socket || pendingAck.expectedLine !== line) {
      return false;
    }

    const pending = pendingAck;
    pendingAck = null;
    clearTimeout(pending.timer);
    pending.resolve();
    return true;
  }

  function handleRobotLine(line, connection) {
    const readyMessage = robotToken ? `READY ${robotToken}` : 'READY';

    if (line === readyMessage) {
      connection.ready = true;
      clearTimeout(connection.handshakeTimer);
      connection.socket.write('WELCOME\n');
      console.log(`Robot connected from ${connection.socket.remoteAddress}.`);
      return;
    }

    if (line.startsWith('FAULT ')) {
      rejectPending(new Error(line.slice('FAULT '.length)), connection.socket);
      return;
    }

    resolvePending(line, connection.socket);
  }

  const robotServer = createTcpServer((socket) => {
    if (robot && !robot.socket.destroyed) {
      socket.end('BUSY\n');
      return;
    }

    socket.setEncoding('utf8');
    socket.setNoDelay(true);

    const connection = {
      socket,
      ready: false,
      buffer: '',
      handshakeTimer: setTimeout(() => {
        if (!connection.ready) {
          socket.destroy(new Error('Robot handshake timed out.'));
        }
      }, 10000),
    };
    robot = connection;

    socket.on('data', (chunk) => {
      connection.buffer += chunk;
      if (connection.buffer.length > MAX_LINE_LENGTH && !connection.buffer.includes('\n')) {
        socket.destroy(new Error('Robot message is too long.'));
        return;
      }

      let newlineIndex = connection.buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = connection.buffer.slice(0, newlineIndex).trim();
        connection.buffer = connection.buffer.slice(newlineIndex + 1);
        if (line) {
          handleRobotLine(line, connection);
        }
        newlineIndex = connection.buffer.indexOf('\n');
      }
    });

    socket.on('error', (error) => {
      console.error(`Robot connection error: ${error.message}`);
      rejectPending(error, socket);
    });

    socket.on('close', () => {
      clearTimeout(connection.handshakeTimer);
      if (robot === connection) {
        robot = null;
      }
      rejectPending(new Error('Robot disconnected before acknowledging the command.'), socket);
      console.log('Robot disconnected.');
    });
  });

  async function handleMove(request, response) {
    const body = await readJson(request);
    const { startNode, destinationNode } = body ?? {};

    if (!validNode(startNode) || !validNode(destinationNode) || startNode === destinationNode) {
      throw new HttpError(
        400,
        'startNode and destinationNode must be different integers from 1 to 12.',
      );
    }
    if (movementInProgress) {
      throw new HttpError(409, 'Another robot movement is already in progress.');
    }
    if (!robot?.ready || robot.socket.destroyed) {
      throw new HttpError(503, 'No ready Arduino is connected over TCP.');
    }
    if (currentHeading === null) {
      throw new HttpError(
        409,
        'Robot pose is unknown after a communication failure. Synchronize its node and heading first.',
      );
    }
    if (currentNode !== null && currentNode !== startNode) {
      throw new HttpError(
        409,
        `Robot position is node ${currentNode}, not node ${startNode}. Synchronize the robot position first.`,
      );
    }

    const path = findShortestPath(startNode, destinationNode);
    const instructions = createInstructions(path, currentHeading);
    const connection = robot;
    movementInProgress = true;
    if (currentNode === null) {
      currentNode = startNode;
    }

    try {
      for (const instruction of instructions) {
        const sequence = nextSequence++;
        await sendAndWait(
          connection,
          `STEP ${sequence} ${instruction.from} ${instruction.to} ${instruction.turn}`,
          `DONE ${sequence} ${instruction.to}`,
        );
        currentNode = instruction.to;
        currentHeading = instruction.heading;
      }

      const arrivalSequence = nextSequence++;
      await sendAndWait(
        connection,
        `ARRIVED ${arrivalSequence} ${destinationNode}`,
        `ARRIVED_ACK ${arrivalSequence}`,
      );

      sendJson(response, 200, {
        completed: true,
        startNode,
        destinationNode,
        path,
        instructions,
        heading: currentHeading,
      });
    } catch (error) {
      currentNode = null;
      currentHeading = null;
      console.error(`Robot movement failed: ${error.message}`);
      sendJson(response, 502, {
        error: 'Robot failed to acknowledge the complete route.',
        details: error.message,
        requiresSynchronization: true,
      });
    } finally {
      movementInProgress = false;
    }
  }

  async function handlePath(request, response) {
    const body = await readJson(request);
    const { startNode, destinationNode } = body ?? {};

    if (!validNode(startNode) || !validNode(destinationNode)) {
      throw new HttpError(400, 'startNode and destinationNode must be integers from 1 to 12.');
    }

    const path = findShortestPath(startNode, destinationNode);
    const instructions = createInstructions(path, initialHeading);
    const heading = instructions.at(-1)?.heading ?? initialHeading;

    sendJson(response, 200, { startNode, destinationNode, path, instructions, heading });
  }

  function sendAndWait(connection, command, expectedLine) {
    return new Promise((resolve, reject) => {
      if (!connection.ready || connection.socket.destroyed) {
        reject(new Error('Robot is not connected.'));
        return;
      }
      if (pendingAck) {
        reject(new Error('Another robot command is awaiting acknowledgement.'));
        return;
      }

      const pending = {
        socket: connection.socket,
        expectedLine,
        resolve,
        reject,
        timer: null,
      };
      pending.timer = setTimeout(() => {
        if (pendingAck === pending) {
          pendingAck = null;
          reject(new Error(`Timed out waiting for "${expectedLine}".`));
        }
      }, ackTimeoutMs);
      pendingAck = pending;

      connection.socket.write(`${command}\n`, (error) => {
        if (error) {
          rejectPending(error, connection.socket);
        }
      });
    });
  }

  async function handleSynchronize(request, response) {
    const body = await readJson(request);
    const { node, heading } = body ?? {};

    if (!validNode(node) || !HEADINGS.includes(heading)) {
      throw new HttpError(
        400,
        'node must be from 1 to 12 and heading must be up, right, down, or left.',
      );
    }
    if (movementInProgress) {
      throw new HttpError(409, 'Cannot synchronize while the robot is moving.');
    }

    currentNode = node;
    currentHeading = heading;
    sendJson(response, 200, { synchronized: true, node, heading });
  }

  const httpServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, { status: 'ok' });
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/robot/status') {
        sendJson(response, 200, {
          connected: Boolean(robot?.ready && !robot.socket.destroyed),
          movementInProgress,
          node: currentNode,
          heading: currentHeading,
          requiresSynchronization: currentHeading === null,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/robot/path') {
        await handlePath(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/robot/move') {
        await handleMove(request, response);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/robot/synchronize') {
        await handleSynchronize(request, response);
        return;
      }

      sendJson(response, 404, { error: 'Route not found.' });
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }

      console.error(`HTTP request failed: ${error.message}`);
      sendJson(response, 500, { error: 'Internal backend error.' });
    }
  });

  return {
    httpServer,
    robotServer,
    listen() {
      return Promise.all([
        listen(httpServer, httpPort, httpHost),
        listen(robotServer, robotPort, robotHost),
      ]);
    },
    close() {
      if (robot) {
        robot.socket.destroy();
      }
      rejectPending(new Error('Backend is shutting down.'));
      return Promise.all([closeServer(httpServer), closeServer(robotServer)]);
    },
  };
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const backend = createBackend();
  backend
    .listen()
    .then(() => {
      console.log(`HTTP API listening on http://127.0.0.1:${process.env.API_PORT ?? 3000}.`);
      console.log(
        `Arduino TCP server listening on ${process.env.ROBOT_TCP_HOST ?? '0.0.0.0'}:${process.env.ROBOT_TCP_PORT ?? 5050}.`,
      );
    })
    .catch((error) => {
      console.error(`Backend failed to start: ${error.message}`);
      process.exitCode = 1;
    });
}
