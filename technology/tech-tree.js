(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ATO_TECH_TREE = api;
})(typeof window === 'object' ? window : this, function () {
  'use strict';

  const normalize = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Resolve within this cycle first: repeated names can refer to different cards.
  function buildGraph(nodes, keyForNode) {
    const byKey = new Map(nodes.map(node => [keyForNode(node), node]));
    const byName = new Map();
    for (const node of nodes) {
      const name = normalize(node.name);
      if (!byName.has(name)) byName.set(name, node);
    }
    const resolve = ref => {
      const key = normalize(ref);
      return byKey.get(key) || (!key.includes('@@') ? byName.get(key) : null);
    };
    const edges = new Map();
    function add(source, target, optional) {
      if (!source || !target || source.id === target.id) return;
      const key = source.id + '>' + target.id;
      const existing = edges.get(key);
      edges.set(key, { source: source.id, target: target.id, optional: existing ? existing.optional && optional : optional });
    }
    for (const node of nodes) {
      for (const ref of node.requires || []) add(resolve(ref), node, false);
      for (const group of node.requires_any_groups || []) {
        for (const ref of group) add(resolve(ref), node, true);
      }
    }
    // Requirements are authoritative. Use outgoing references for older entries
    // that contain no incoming requirement data, without inventing AND rules.
    for (const node of nodes) {
      for (const ref of node.xlsm_leads_to || []) {
        const target = resolve(ref);
        if (target && !(target.requires?.length || target.requires_any_groups?.length)) add(node, target, false);
      }
    }
    return { nodes, edges: [...edges.values()] };
  }

  function visibleGraph(graph, isDiscovered, hideUnknown, showPlaceholder = () => false) {
    const nodes = graph.nodes.filter(node => !hideUnknown || isDiscovered(node) || showPlaceholder(node));
    const ids = new Set(nodes.map(node => node.id));
    const namedIds = new Set(nodes.filter(node => !showPlaceholder(node)).map(node => node.id));
    return { nodes, edges: graph.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && namedIds.has(edge.source) && namedIds.has(edge.target)) };
  }

  // Keep printed coordinates unless a cycle specifies a reorganized battle grid.
  // Use the full graph so discovery never moves nodes or routes.
  function layoutGraph(graph, page = {}, sizeForNode = () => ({ width: 90, height: 34 })) {
    const spacingX = 1.25, spacingY = 1.2;
    let width = (Number(page.width) || 1190.5511474609375) * spacingX;
    const height = (Number(page.height) || 841.8897705078125) * spacingY;
    const splitY = (Number(page.split_y) || 411.0247802734375) * spacingY;
    const boxes = new Map(graph.nodes.map((node, index) => {
      const raw = node.tree_box || node;
      const box = Array.isArray(raw) ? { x: raw[0], y: raw[1], w: raw[2], h: raw[3] } : raw;
      const x = Number.isFinite(Number(box.x)) ? Number(box.x) : 28 + index % 8 * 140;
      const y = Number.isFinite(Number(box.y)) ? Number(box.y) : 28 + Math.floor(index / 8) * 70;
      return [node.id, { x, y, w: Number(box.w) || 113.386, h: Number(box.h) || 49.606 }];
    }));
    const groupShifts = new Map();
    for (const group of page.node_shift_groups || []) {
      const from = boxes.get(group.from), to = boxes.get(group.to);
      if (!from || !to) continue;
      const shift = to.y + to.h / 2 - from.y - from.h / 2;
      for (const id of group.nodes) groupShifts.set(id, shift);
    }
    const positions = new Map();
    graph.nodes.forEach(node => {
      const box = boxes.get(node.id);
      const column = boxes.get(page.node_align_x?.[node.id]) || box;
      const row = boxes.get(page.node_align_y?.[node.id]) || box;
      const size = sizeForNode(node);
      const nodeWidth = Math.min(box.w, size.width, page.node_widths?.[node.id] || Infinity), nodeHeight = size.height;
      const grid = page.battle_grid, slot = grid?.slots[node.id];
      positions.set(node.id, {
        x: (slot ? grid.x + slot[0] * grid.column_gap : (column.x + column.w / 2) * spacingX) - nodeWidth / 2,
        y: (slot ? grid.y + slot[1] * grid.row_gap : (row.y + row.h / 2 + (groupShifts.get(node.id) || 0)) * spacingY) - nodeHeight / 2,
        width: nodeWidth, height: nodeHeight, totalHeight: size.totalHeight || nodeHeight,
        conditionHeights: size.conditionHeights || [],
      });
    });
    // A reorganized branch can extend beyond the printed sheet's columns.
    // Reserve the same outer margin for every node in the full graph.
    if (page.battle_grid) width = Math.max(width, ...[...positions.values()].map(pos => pos.x + pos.width + 16));
    const obstacles = [...positions.values()].map(pos => ({ ...pos, height: pos.totalHeight }));
    const clearance = 8;
    const routingObstacles = obstacles.map(rect => ({
      x: rect.x - clearance, y: rect.y - clearance,
      width: rect.width + clearance * 2, height: rect.height + clearance * 2,
    }));
    const edgeChannels = {}, edgeChannelXs = {};
    for (const [key, channel] of Object.entries(page.edge_channels || {})) {
      const above = positions.get(channel.above), below = positions.get(channel.below);
      if (above && below) edgeChannels[key] = (above.y + above.totalHeight + below.y) / 2;
      const left = positions.get(channel.left), right = positions.get(channel.right);
      if (left && right) edgeChannelXs[key] = left.x + left.width
        + (right.x - left.x - left.width) * (channel.fraction ?? .5);
    }
    return {
      positions, width, height, splitY, spacingX, spacingY, obstacles, routingObstacles,
      edges: graph.edges, edgePorts: page.edge_ports || {}, edgeChannels, edgeChannelXs, routes: new Map(), routesReady: false,
      lanes: [{ category: 'structure', y: splitY - 22 }, { category: 'battle', y: splitY + 6 }],
    };
  }

  function portsFor(rect, target = false, offset = 0, reach = 18) {
    return [
      { side: 'right', x: rect.x + rect.width, y: rect.y + rect.height * (.5 + offset), dx: 1, dy: 0 },
      { side: 'left', x: rect.x, y: rect.y + rect.height * (.5 + offset), dx: -1, dy: 0 },
      { side: 'top', x: rect.x + rect.width * (.5 + offset), y: rect.y, dx: 0, dy: -1 },
      { side: 'bottom', x: rect.x + rect.width * (.5 + offset), y: rect.y + rect.height, dx: 0, dy: 1 },
    ].map(port => ({
      side: port.side,
      edge: { x: port.x + (target ? port.dx * 5 : 0), y: port.y + (target ? port.dy * 5 : 0) },
      outer: { x: port.x + port.dx * reach, y: port.y + port.dy * reach },
    }));
  }

  function compactPath(points) {
    const result = [];
    for (const point of points) {
      const last = result[result.length - 1];
      if (last && Math.abs(last.x - point.x) < .001 && Math.abs(last.y - point.y) < .001) continue;
      const previous = result[result.length - 2];
      if (previous && ((previous.x === last.x && last.x === point.x && (last.y - previous.y) * (point.y - last.y) >= 0)
        || (previous.y === last.y && last.y === point.y && (last.x - previous.x) * (point.x - last.x) >= 0))) result.pop();
      result.push(point);
    }
    return result;
  }

  function isPathClear(points, layout, obstacles = layout.obstacles) {
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      if ([a, b].some(point => point.x < 0 || point.x > layout.width || point.y < 0 || point.y > layout.height)) return false;
      for (const rect of obstacles) {
        const right = rect.x + rect.width, bottom = rect.y + rect.height;
        if (Math.abs(a.x - b.x) < .001) {
          if (a.x > rect.x + .01 && a.x < right - .01 && Math.max(a.y, b.y) > rect.y + .01 && Math.min(a.y, b.y) < bottom - .01) return false;
        } else if (Math.abs(a.y - b.y) < .001) {
          if (a.y > rect.y + .01 && a.y < bottom - .01 && Math.max(a.x, b.x) > rect.x + .01 && Math.min(a.x, b.x) < right - .01) return false;
        } else return false;
      }
    }
    return true;
  }

  function pathCost(points) {
    return points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0) + (points.length - 2) * 12;
  }

  // Most printed branches need at most two elbows. Try nearby gutters first;
  // imported or crowded branches use the same obstacle-aware grid as a fallback.
  function routeEdge(edge, layout, options = {}) {
    const source = layout.positions.get(edge.source), target = layout.positions.get(edge.target);
    if (!source || !target) return [];
    const ports = layout.edgePorts[edge.source + '>' + edge.target] || {};
    const sources = portsFor(source, false, options.exitOffset || 0, options.reach || 18)
      .filter(port => (!ports.source || port.side === ports.source) && (!options.sourceSides || options.sourceSides.has(port.side)));
    const targets = portsFor(target, true, 0, options.reach || 18)
      .filter(port => (!ports.target || port.side === ports.target) && (!options.targetSide || port.side === options.targetSide));
    if (!sources.length || !targets.length) return [];
    const candidates = [], preferred = [];
    const channelY = layout.edgeChannels[edge.source + '>' + edge.target];
    const channelX = layout.edgeChannelXs[edge.source + '>' + edge.target];
    const middleX = (source.x + target.x) / 2, middleY = (source.y + target.y) / 2;
    const nearby = (axis, middle, extent) => [...new Set(layout.routingObstacles.flatMap(rect => [rect[axis] - 4, rect[axis] + rect[axis === 'x' ? 'width' : 'height'] + 4]))]
      .filter(value => value >= 12 && value <= extent - 12).sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, 10).concat([12, extent - 12]);
    const xs = nearby('x', middleX, layout.width), ys = nearby('y', middleY, layout.height);
    for (const from of sources) for (const to of targets) {
      const a = from.outer, b = to.outer;
      // Use the specified gap between modules before automatic nearby lanes.
      // Its height follows the actual captions and remains subject to clearance.
      if (Number.isFinite(channelY)) preferred.push([from.edge, a,
        { x: a.x, y: channelY }, { x: b.x, y: channelY }, b, to.edge]);
      if (Number.isFinite(channelX)) preferred.push([from.edge, a,
        { x: channelX, y: a.y }, { x: channelX, y: b.y }, b, to.edge]);
      const add = middle => candidates.push([from.edge, a, ...middle, b, to.edge]);
      add([{ x: b.x, y: a.y }]); add([{ x: a.x, y: b.y }]);
      for (const x of xs) add([{ x, y: a.y }, { x, y: b.y }]);
      for (const y of ys) add([{ x: a.x, y }, { x: b.x, y }]);
    }
    const byCost = (a, b) => pathCost(compactPath(a)) - pathCost(compactPath(b));
    preferred.sort(byCost); candidates.sort(byCost);
    const route = preferred.concat(candidates).find(points => isPathClear(points, layout)
      && isPathClear(points.slice(1, -1), layout, layout.routingObstacles));
    if (route) return compactPath(route);
    const grid = gridRoute(sources, targets, layout);
    // Long condition captions can leave a small gutter at a fixed entry port.
    // Keep the same ports and obstacle clearance with shorter endpoint stubs.
    return grid.length || options.reach === 8 ? grid : routeEdge(edge, layout, { ...options, reach: 8 });
  }

  function gridRoute(sources, targets, layout) {
    const validSources = sources.filter(port => isPathClear([port.edge, port.outer], layout));
    const validTargets = targets.filter(port => isPathClear([port.outer, port.edge], layout));
    if (!validSources.length || !validTargets.length) return [];
    const coordinates = (axis, extent) => [...new Set([12, extent - 12,
      ...layout.routingObstacles.flatMap(rect => [rect[axis] - 4, rect[axis] + rect[axis === 'x' ? 'width' : 'height'] + 4]),
      ...validSources.map(port => port.outer[axis]), ...validTargets.map(port => port.outer[axis]),
    ])].filter(value => value >= 0 && value <= extent).sort((a, b) => a - b);
    const xs = coordinates('x', layout.width), ys = coordinates('y', layout.height), columns = xs.length;
    const id = point => ys.indexOf(point.y) * columns + xs.indexOf(point.x);
    const pointFor = index => ({ x: xs[index % columns], y: ys[Math.floor(index / columns)] });
    const goals = new Map(validTargets.map(port => [id(port.outer), port]));
    const seeds = new Map(validSources.map(port => [id(port.outer), port]));
    const costs = new Float64Array(xs.length * ys.length).fill(Infinity);
    const previous = new Int32Array(costs.length).fill(-2), heap = [], segments = new Map();
    const estimate = point => Math.min(...validTargets.map(port => Math.abs(point.x - port.outer.x) + Math.abs(point.y - port.outer.y)));
    function push(item) {
      heap.push(item); let index = heap.length - 1;
      while (index > 0) { const parent = (index - 1) >> 1; if (heap[parent].score <= item.score) break; heap[index] = heap[parent]; index = parent; }
      heap[index] = item;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) {
        let index = 0;
        while (index * 2 + 1 < heap.length) {
          let child = index * 2 + 1;
          if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) child++;
          if (heap[child].score >= last.score) break;
          heap[index] = heap[child]; index = child;
        }
        heap[index] = last;
      }
      return first;
    }
    for (const [index, port] of seeds) { costs[index] = 0; previous[index] = -1; push({ index, cost: 0, score: estimate(port.outer) }); }
    while (heap.length) {
      const item = pop();
      if (item.cost !== costs[item.index]) continue;
      if (goals.has(item.index)) {
        const result = [];
        let current = item.index;
        while (previous[current] !== -1) { result.push(pointFor(current)); current = previous[current]; }
        result.push(pointFor(current)); result.reverse();
        return compactPath([seeds.get(current).edge, ...result, goals.get(item.index).edge]);
      }
      const x = item.index % columns, y = Math.floor(item.index / columns), from = pointFor(item.index);
      const neighbors = [];
      if (x > 0) neighbors.push(item.index - 1);
      if (x + 1 < columns) neighbors.push(item.index + 1);
      if (y > 0) neighbors.push(item.index - columns);
      if (y + 1 < ys.length) neighbors.push(item.index + columns);
      for (const next of neighbors) {
        const to = pointFor(next), cost = item.cost + Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
        if (cost >= costs[next]) continue;
        const key = Math.min(item.index, next) + ':' + Math.max(item.index, next);
        if (!segments.has(key)) segments.set(key, isPathClear([from, to], layout, layout.routingObstacles));
        if (!segments.get(key)) continue;
        costs[next] = cost; previous[next] = item.index;
        push({ index: next, cost, score: cost + estimate(to) });
      }
    }
    return [];
  }

  function routeSide(point, rect, target = false) {
    return portsFor(rect, target).find(port => Math.abs(port.edge.x - point.x) < .001 && Math.abs(port.edge.y - point.y) < .001)?.side;
  }

  function prepareRoutes(layout) {
    if (layout.routesReady) return;
    layout.routesReady = true;
    const incoming = new Map(), entrySides = new Map();
    for (const edge of layout.edges) {
      const key = edge.source + '>' + edge.target;
      const route = routeEdge(edge, layout);
      layout.routes.set(key, route);
      if (!route.length) continue;
      const side = routeSide(route[route.length - 1], layout.positions.get(edge.target), true);
      if (!incoming.has(edge.target)) incoming.set(edge.target, new Set());
      incoming.get(edge.target).add(side);
      entrySides.set(key, side);
    }
    // Keep natural entry ports fixed, then choose another side for departures.
    // At crowded nodes, a separate anchor on the same side is the fallback.
    for (const edge of layout.edges) {
      const key = edge.source + '>' + edge.target, route = layout.routes.get(key);
      if (!route.length) continue;
      const entrySet = incoming.get(edge.source);
      const exitSide = routeSide(route[0], layout.positions.get(edge.source));
      if (!entrySet?.has(exitSide)) continue;
      const sourceSides = new Set(['right', 'left', 'top', 'bottom'].filter(side => !entrySet.has(side)));
      const targetSide = entrySides.get(key);
      const distinctSide = routeEdge(edge, layout, { sourceSides, targetSide });
      const separateAnchor = distinctSide.length ? distinctSide
        : routeEdge(edge, layout, { targetSide, exitOffset: -.25 });
      if (separateAnchor.length) layout.routes.set(key, separateAnchor);
    }
  }

  function edgePath(edge, layout) {
    prepareRoutes(layout);
    const key = edge.source + '>' + edge.target;
    if (!layout.routes.has(key)) layout.routes.set(key, routeEdge(edge, layout));
    return layout.routes.get(key).map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(3)} ${point.y.toFixed(3)}`).join(' ');
  }

  // Split shared runs at junctions and draw each physical segment once. Keep
  // its owning edges so selection, progress colors and search still work.
  function linkSegments(edges, layout) {
    prepareRoutes(layout);
    const lanes = new Map(), round = value => Number(value.toFixed(3));
    for (const edge of edges) {
      const key = edge.source + '>' + edge.target;
      const route = layout.routes.get(key) || [];
      for (let index = 1; index < route.length; index++) {
        const a = route[index - 1], b = route[index], vertical = Math.abs(a.x - b.x) < .001;
        const fixed = round(vertical ? a.x : a.y), start = round(vertical ? a.y : a.x), end = round(vertical ? b.y : b.x);
        if (start === end) continue;
        const laneKey = (vertical ? 'V:' : 'H:') + fixed;
        if (!lanes.has(laneKey)) lanes.set(laneKey, { vertical, fixed, runs: [] });
        lanes.get(laneKey).runs.push({ low: Math.min(start, end), high: Math.max(start, end),
          arrow: index === route.length - 1 ? end : null, edge });
      }
    }
    const segments = [];
    for (const { vertical, fixed, runs } of lanes.values()) {
      const cuts = [...new Set(runs.flatMap(run => [run.low, run.high]))].sort((a, b) => a - b);
      for (let index = 1; index < cuts.length; index++) {
        const low = cuts[index - 1], high = cuts[index], middle = (low + high) / 2;
        const owners = runs.filter(run => run.low < middle && run.high > middle);
        if (!owners.length) continue;
        const connections = [...new Map(owners.map(run => [run.edge.source + '>' + run.edge.target, run.edge])).values()];
        const start = vertical ? { x: fixed, y: low } : { x: low, y: fixed };
        const end = vertical ? { x: fixed, y: high } : { x: high, y: fixed };
        segments.push({ start, end, edges: connections,
          arrowStart: owners.some(run => run.arrow === low), arrowEnd: owners.some(run => run.arrow === high),
          path: `M ${start.x} ${start.y} L ${end.x} ${end.y}` });
      }
    }
    return segments;
  }

  return { buildGraph, visibleGraph, layoutGraph, edgePath, linkSegments };
});
