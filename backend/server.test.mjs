import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { createBackend } from './server.mjs';

function createLineReader(socket) {
  let buffer = '';
  const lines = [];
  const waiters = [];

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
      newlineIndex = buffer.indexOf('\n');
    }
  });

  return () =>
    new Promise((resolve) => {
      const line = lines.shift();
      if (line !== undefined) resolve(line);
      else waiters.push(resolve);
    });
}

test('path endpoint returns the Dijkstra result without requiring a connected robot', async (t) => {
  const backend = createBackend({
    httpHost: '127.0.0.1',
    httpPort: 0,
    robotHost: '127.0.0.1',
    robotPort: 0,
    initialHeading: 'up',
  });
  await backend.listen();

  t.after(() => backend.close());

  const response = await fetch(
    `http://127.0.0.1:${backend.httpServer.address().port}/api/robot/path`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startNode: 1, destinationNode: 12 }),
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    startNode: 1,
    destinationNode: 12,
    path: [1, 2, 3, 4, 8, 12],
    instructions: [
      { from: 1, to: 2, turn: 'RIGHT', heading: 'right' },
      { from: 2, to: 3, turn: 'STRAIGHT', heading: 'right' },
      { from: 3, to: 4, turn: 'STRAIGHT', heading: 'right' },
      { from: 4, to: 8, turn: 'RIGHT', heading: 'down' },
      { from: 8, to: 12, turn: 'STRAIGHT', heading: 'down' },
    ],
    heading: 'down',
  });
});

test('backend waits for each Arduino acknowledgement before sending the next step', async (t) => {
  const backend = createBackend({
    httpHost: '127.0.0.1',
    httpPort: 0,
    robotHost: '127.0.0.1',
    robotPort: 0,
    ackTimeoutMs: 3000,
    initialHeading: 'up',
  });
  const [, robotAddress] = await backend.listen();
  const robot = net.createConnection(robotAddress.port, '127.0.0.1');
  const nextLine = createLineReader(robot);

  t.after(async () => {
    robot.destroy();
    await backend.close();
  });

  await new Promise((resolve, reject) => {
    robot.once('connect', resolve);
    robot.once('error', reject);
  });
  robot.write('READY\n');
  assert.equal(await nextLine(), 'WELCOME');

  const moveResponse = fetch(
    `http://127.0.0.1:${backend.httpServer.address().port}/api/robot/move`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ startNode: 1, destinationNode: 3 }),
    },
  );

  assert.equal(await nextLine(), 'STEP 1 1 2 RIGHT');
  robot.write('DONE 1 2\n');
  assert.equal(await nextLine(), 'STEP 2 2 3 STRAIGHT');
  robot.write('DONE 2 3\n');
  assert.equal(await nextLine(), 'ARRIVED 3 3');
  robot.write('ARRIVED_ACK 3\n');

  const response = await moveResponse;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    completed: true,
    startNode: 1,
    destinationNode: 3,
    path: [1, 2, 3],
    instructions: [
      { from: 1, to: 2, turn: 'RIGHT', heading: 'right' },
      { from: 2, to: 3, turn: 'STRAIGHT', heading: 'right' },
    ],
    heading: 'right',
  });
});
