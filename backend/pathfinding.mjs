export const GRID_WIDTH = 4;
export const GRID_HEIGHT = 3;
export const HEADINGS = ['up', 'right', 'down', 'left'];

const NODE_COUNT = GRID_WIDTH * GRID_HEIGHT;
const NEIGHBOR_STEPS = [
  { heading: 'up', row: -1, column: 0 },
  { heading: 'right', row: 0, column: 1 },
  { heading: 'down', row: 1, column: 0 },
  { heading: 'left', row: 0, column: -1 },
];

function assertNode(node) {
  if (!Number.isInteger(node) || node < 1 || node > NODE_COUNT) {
    throw new RangeError(`Node must be an integer between 1 and ${NODE_COUNT}.`);
  }
}

function coordinates(node) {
  assertNode(node);
  const index = node - 1;
  return {
    row: Math.floor(index / GRID_WIDTH),
    column: index % GRID_WIDTH,
  };
}

function adjacentNodes(node) {
  const { row, column } = coordinates(node);

  return NEIGHBOR_STEPS.flatMap((step) => {
    const nextRow = row + step.row;
    const nextColumn = column + step.column;

    if (nextRow < 0 || nextRow >= GRID_HEIGHT || nextColumn < 0 || nextColumn >= GRID_WIDTH) {
      return [];
    }

    return [{ node: nextRow * GRID_WIDTH + nextColumn + 1, heading: step.heading }];
  });
}

export function findShortestPath(startNode, destinationNode) {
  assertNode(startNode);
  assertNode(destinationNode);

  const distances = new Map(
    Array.from({ length: NODE_COUNT }, (_, index) => [index + 1, Infinity]),
  );
  const previous = new Map();
  const unvisited = new Set(distances.keys());
  distances.set(startNode, 0);

  while (unvisited.size > 0) {
    let currentNode = null;
    let currentDistance = Infinity;

    for (const candidate of unvisited) {
      const distance = distances.get(candidate);
      if (distance < currentDistance) {
        currentNode = candidate;
        currentDistance = distance;
      }
    }

    if (currentNode === null || currentNode === destinationNode) {
      break;
    }

    unvisited.delete(currentNode);

    for (const neighbor of adjacentNodes(currentNode)) {
      if (!unvisited.has(neighbor.node)) {
        continue;
      }

      const candidateDistance = currentDistance + 1;
      if (candidateDistance < distances.get(neighbor.node)) {
        distances.set(neighbor.node, candidateDistance);
        previous.set(neighbor.node, currentNode);
      }
    }
  }

  if (startNode !== destinationNode && !previous.has(destinationNode)) {
    throw new Error(`No path found from node ${startNode} to node ${destinationNode}.`);
  }

  const path = [destinationNode];
  while (path[0] !== startNode) {
    path.unshift(previous.get(path[0]));
  }

  return path;
}

function directionBetween(fromNode, toNode) {
  const from = coordinates(fromNode);
  const to = coordinates(toNode);
  const step = NEIGHBOR_STEPS.find(
    (candidate) =>
      from.row + candidate.row === to.row && from.column + candidate.column === to.column,
  );

  if (!step) {
    throw new RangeError(`Nodes ${fromNode} and ${toNode} are not adjacent.`);
  }

  return step.heading;
}

export function createInstructions(path, initialHeading) {
  if (!HEADINGS.includes(initialHeading)) {
    throw new RangeError(`Heading must be one of: ${HEADINGS.join(', ')}.`);
  }

  let heading = initialHeading;

  return path.slice(1).map((to, index) => {
    const from = path[index];
    const nextHeading = directionBetween(from, to);
    const turn =
      (HEADINGS.indexOf(nextHeading) - HEADINGS.indexOf(heading) + HEADINGS.length) %
      HEADINGS.length;

    const instruction =
      turn === 0 ? 'STRAIGHT' : turn === 1 ? 'RIGHT' : turn === 2 ? 'UTURN' : 'LEFT';

    heading = nextHeading;
    return { from, to, turn: instruction, heading };
  });
}
