import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstructions, findShortestPath } from './pathfinding.mjs';

test('Dijkstra finds a shortest route through the 4-by-3 grid', () => {
  assert.deepEqual(findShortestPath(1, 12), [1, 2, 3, 4, 8, 12]);
});

test('route edges become relative turn instructions', () => {
  const instructions = createInstructions([1, 2, 3, 7], 'up');

  assert.deepEqual(
    instructions.map(({ from, to, turn }) => ({ from, to, turn })),
    [
      { from: 1, to: 2, turn: 'RIGHT' },
      { from: 2, to: 3, turn: 'STRAIGHT' },
      { from: 3, to: 7, turn: 'RIGHT' },
    ],
  );
});

test('route instructions identify a U-turn when the goal is behind the robot', () => {
  assert.equal(createInstructions([1, 5], 'up')[0].turn, 'UTURN');
});

test('invalid nodes and headings are rejected', () => {
  assert.throws(() => findShortestPath(0, 12), RangeError);
  assert.throws(() => createInstructions([1, 2], 'north'), RangeError);
});
