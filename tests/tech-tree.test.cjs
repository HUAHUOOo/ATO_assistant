const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tree = require('../technology/tech-tree.js');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'technology/index.html'), 'utf8').replace(/\r\n/g, '\n');

function context() {
  const scope = vm.createContext({
    currentCycle: 'cycle1', treeLanguage: 'zh', hideUnknownTech: true, selectedNodeId: null,
    unlocked: new Set(), conditionTicked: new Set(),
    TECH_KEY_ALIASES: { 'upstream navigation': 'up-stream navigation' },
  });
  const names = ['dictionaryToAppData', 'computeDisambiguatedTechNames', 'techKey', 'nodeKey', 'isAutoUnlockedNode',
    'isUnlockedNode', 'isRequirementUnlocked', 'nodeRecordByName', 'areRequirementsMet', 'isDiscoveredNode', 'isConditionDiscoveryPending',
    'isUnlockableNode', 'isConditionSatisfied', 'hasPrintedConditionBox', 'conditionCells', 'isConditionTicked',
    'isConditionCellTicked', 'conditionCellKey', 'cardsForNode', 'isCoreNode', 'displayTechName', 'esc',
    'renderTechRefList', 'renderRequirementUnlockColumns', 'renderRequirementAnyGroups', 'renderConditionNotes', 'renderConditionToggle',
    'treeTextUnits', 'treeTextRows', 'treeModuleSize', 'treeModuleHtml', 'treeNodeStatus', 'conditionCellCaption', 'conditionCellDisplayText'];
  const declarations = ['PAGE_METADATA', 'PRINTED_CONDITION_BOXES', 'PRINTED_CONDITION_TEXT', 'CONDITION_TEXT_ZH'];
  vm.runInContext(declarations.map(name => {
    const start = source.indexOf(`const ${name} =`);
    return source.slice(start, source.indexOf('\n];', start) > -1 && name === 'PAGE_METADATA'
      ? source.indexOf('\n];', start) + 3 : source.indexOf('\n};', start) + 3);
  }).join('\n') + '\n' + names.map(name => {
    const endIndent = ['dictionaryToAppData', 'computeDisambiguatedTechNames'].includes(name) ? '  ' : '';
    const match = source.match(new RegExp('^( *)(?:async )?function ' + name + '\\([^]*?^' + endIndent + '}', 'm'));
    assert.ok(match, `Missing ${name}`);
    return match[0];
  }).join('\n'), scope);
  scope.data = scope.dictionaryToAppData(JSON.parse(fs.readFileSync(path.join(root, 'technology/tech_card_dictionary.min.json'), 'utf8')));
  scope.PAGE_INDEX = new Map(scope.data.pages.map((page, index) => [page.key, index]));
  scope.DISAMBIGUATED_TECH_NAMES = scope.computeDisambiguatedTechNames(scope.data.pages);
  return scope;
}

test('unlocking a real technology discovers just the next reachable nodes and arrows', () => {
  const c = context(), page = c.data.pages[0];
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const visible = () => tree.visibleGraph(graph, node => c.isDiscoveredNode(page.key, node), true,
    node => c.isConditionDiscoveryPending(page.key, node));
  const before = visible();
  assert.equal(before.nodes.length, 13);
  const trade = page.nodes.find(node => node.name === 'Trading Solutions');
  const advanced = page.nodes.find(node => node.name === 'Advanced Trading Solutions');
  const superior = page.nodes.find(node => node.name === 'Superior Trading Solutions');
  assert.ok(!before.nodes.includes(advanced));
  c.unlocked.add(c.nodeKey(page.key, trade));
  const after = visible();
  assert.equal(after.nodes.length, 17);
  assert.ok(after.nodes.includes(advanced));
  assert.ok(!after.nodes.includes(superior));
  assert.ok(after.edges.some(edge => edge.source === trade.id && edge.target === advanced.id));
  assert.ok(after.edges.every(edge => after.nodes.some(node => node.id === edge.source) && after.nodes.some(node => node.id === edge.target)));
});

test('condition roots reveal only after all conditions while connected nodes keep their existing discovery rules', () => {
  const c = context(), page = c.data.pages[0];
  const node = page.nodes.find(node => node.name === 'Spark of the Dead Gods');
  assert.equal(c.isDiscoveredNode(page.key, node), false);
  assert.equal(c.isUnlockableNode(page.key, node), false);
  c.conditionTicked.add(c.conditionCellKey(page.key, node, 0));
  assert.equal(c.isDiscoveredNode(page.key, node), true);
  assert.equal(c.isUnlockableNode(page.key, node), true);
  const multi = page.nodes.find(node => (c.conditionCells(page.key, node)?.length || 0) > 1);
  for (const ref of multi.requires) c.unlocked.add(ref);
  for (const group of multi.requires_any_groups) c.unlocked.add(group[0]);
  c.conditionTicked.add(c.conditionCellKey(page.key, multi, 0));
  assert.equal(c.isUnlockableNode(page.key, multi), false);
  for (let i = 1; i < c.conditionCells(page.key, multi).length; i++) c.conditionTicked.add(c.conditionCellKey(page.key, multi, i));
  assert.equal(c.isUnlockableNode(page.key, multi), true);
  const connected = page.nodes.find(item => item.requires.length && c.hasPrintedConditionBox(page.key, item));
  for (const ref of connected.requires) c.unlocked.add(ref);
  for (const group of connected.requires_any_groups) c.unlocked.add(group[0]);
  assert.equal(c.isDiscoveredNode(page.key, connected), true);
  assert.equal(c.isUnlockableNode(page.key, connected), false);
  const multiRoot = c.data.pages.flatMap(otherPage => otherPage.nodes.map(item => ({ page: otherPage, node: item })))
    .find(({ page: otherPage, node: item }) => (c.conditionCells(otherPage.key, item)?.length || 0) > 1
      && !(item.requires.length || item.requires_any_groups.length) && !c.isUnlockedNode(otherPage.key, item));
  assert.ok(multiRoot);
  for (let index = 0; index < c.conditionCells(multiRoot.page.key, multiRoot.node).length; index++) {
    assert.equal(c.isDiscoveredNode(multiRoot.page.key, multiRoot.node), false);
    c.conditionTicked.add(c.conditionCellKey(multiRoot.page.key, multiRoot.node, index));
  }
  assert.equal(c.isDiscoveredNode(multiRoot.page.key, multiRoot.node), true);
});

test('knowledge roots keep editable condition placeholders without disclosing names in any language or view', () => {
  const c = context(), page = c.data.pages[0];
  const node = page.nodes.find(item => item.id === 'cycle1_48');
  const graph = tree.buildGraph(page.nodes, item => c.nodeKey(page.key, item));
  const layout = tree.layoutGraph(graph, page, item => c.treeModuleSize(page.key, item));
  for (const language of ['zh', 'en']) for (const hideUnknown of [true, false]) {
    c.treeLanguage = language; c.hideUnknownTech = hideUnknown;
    const visible = tree.visibleGraph(graph, item => c.isDiscoveredNode(page.key, item), hideUnknown,
      item => c.isConditionDiscoveryPending(page.key, item));
    assert.ok(visible.nodes.includes(node));
    assert.ok(!visible.edges.some(edge => edge.source === node.id || edge.target === node.id));
    const html = c.treeModuleHtml(page, node, layout.positions.get(node.id), false);
    assert.doesNotMatch(html, new RegExp(node.name + '|' + node.name_zh));
    assert.match(html, /data-name=""/);
    assert.match(html, / disabled/);
    assert.match(html, /type="checkbox"/);
    assert.doesNotMatch(c.renderTechRefList([node.name], ''), new RegExp(node.name + '|' + node.name_zh));
  }
  c.conditionTicked.add(c.conditionCellKey(page.key, node, 0));
  assert.equal(c.isConditionDiscoveryPending(page.key, node), false);
  assert.equal(c.isDiscoveredNode(page.key, node), true);
  assert.match(c.treeModuleHtml(page, node, layout.positions.get(node.id), true), new RegExp(node.name));
  c.conditionTicked.clear(); c.unlocked.add(c.nodeKey(page.key, node));
  assert.equal(c.isConditionDiscoveryPending(page.key, node), false);
});

test('AND prerequisites, OR groups and manual unlocks preserve discovery semantics', () => {
  const c = context();
  const and = { name: 'AND', requires: ['first', 'second'] };
  const or = { name: 'OR', requires_any_groups: [['first', 'second'], ['third', 'fourth']] };
  c.unlocked.add('first');
  assert.equal(c.isDiscoveredNode('cycle1', and), false);
  assert.equal(c.isDiscoveredNode('cycle1', or), false);
  c.unlocked.add('second');
  assert.equal(c.isDiscoveredNode('cycle1', and), true);
  c.unlocked.add('third');
  assert.equal(c.isDiscoveredNode('cycle1', or), true);
  c.unlocked.delete('first'); c.unlocked.delete('second');
  assert.equal(c.isDiscoveredNode('cycle1', and), false);
  c.unlocked.add('and');
  assert.equal(c.isDiscoveredNode('cycle1', and), true);
});

test('prerequisite references conceal undiscovered nodes while successor previews show their names', () => {
  const c = context();
  const html = c.renderTechRefList(['advanced trading solutions'], '无直接解锁');
  assert.match(html, /尚未发现/);
  assert.doesNotMatch(html, /高级贸易方案|data-node/);
  const preview = c.renderTechRefList(['advanced trading solutions'], '无直接解锁', null, true);
  assert.match(preview, /高级贸易方案/);
  assert.doesNotMatch(preview, /尚未发现|data-node/);
  c.hideUnknownTech = false;
  assert.match(c.renderTechRefList(['advanced trading solutions'], ''), /高级贸易方案/);
});

test('a node description shows its direct successors without revealing their own successors or changing tree discovery', () => {
  const c = context(), page = c.data.pages[0];
  const trade = page.nodes.find(node => node.name === 'Trading Solutions');
  const advanced = page.nodes.find(node => node.name === 'Advanced Trading Solutions');
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const before = tree.visibleGraph(graph, node => c.isDiscoveredNode(page.key, node), true);
  const html = c.renderRequirementUnlockColumns(page.key, trade);
  assert.match(html, /能解锁的科技/);
  for (const target of ['船员扩招', '外交关系', '高级贸易方案', '浅水航行']) assert.ok(html.includes(target));
  assert.doesNotMatch(html, /超级贸易方案/);
  assert.ok(!before.nodes.includes(advanced));
  assert.deepEqual(tree.visibleGraph(graph, node => c.isDiscoveredNode(page.key, node), true), before);
  assert.doesNotMatch(html, new RegExp(`data-node="${advanced.id}"`));
  c.unlocked.add(c.nodeKey(page.key, trade));
  assert.match(c.renderRequirementUnlockColumns(page.key, trade), new RegExp(`data-node="${advanced.id}"`));
  const unknownRoot = page.nodes.find(node => node.id === 'cycle1_48');
  assert.doesNotMatch(c.renderTechRefList([unknownRoot.name], '', null, true), new RegExp(unknownRoot.name_zh));
});

test('cycle-qualified references and OR edges remain distinct', () => {
  const nodes = [
    { id: 'a', name: 'Shared', key: 'shared@@cycle3' },
    { id: 'b', name: 'Other', key: 'other' },
    { id: 'c', name: 'Child', key: 'child', requires: ['shared@@cycle3'], requires_any_groups: [['shared@@cycle3', 'other', 'shared@@cycle2']] },
  ];
  const graph = tree.buildGraph(nodes, node => node.key);
  assert.deepEqual(graph.edges, [
    { source: 'a', target: 'c', optional: false },
    { source: 'b', target: 'c', optional: true },
  ]);
  assert.equal(tree.visibleGraph(graph, () => false, true).edges.length, 0);
  assert.equal(tree.visibleGraph(graph, () => false, false).nodes.length, 3);
});

test('shared trunks are drawn once while preserving their connections and arrowheads in both directions', () => {
  const first = { source: 'root', target: 'upper', optional: false };
  const second = { source: 'root', target: 'lower', optional: true };
  const reverse = { source: 'other', target: 'left', optional: true };
  const segments = tree.linkSegments([first, second, reverse], { routesReady: true, routes: new Map([
    ['root>upper', [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: -50 }]],
    ['root>lower', [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 50 }]],
    ['other>left', [{ x: 30, y: 0 }, { x: 10, y: 0 }]],
  ]) });
  const shared = segments.find(segment => segment.start.x === 10 && segment.end.x === 30 && segment.start.y === 0 && segment.end.y === 0);
  assert.deepEqual(shared.edges, [first, second, reverse]);
  assert.equal(shared.arrowStart, true);
  assert.ok(segments.some(segment => segment.start.x === 50 && segment.start.y === -50 && segment.arrowStart));
  assert.ok(segments.some(segment => segment.end.x === 80 && segment.end.y === 50 && segment.arrowEnd));
  for (const segment of segments) for (const other of segments) {
    if (segment === other) continue;
    const vertical = segment.start.x === segment.end.x;
    if (vertical && other.start.x === other.end.x && segment.start.x === other.start.x) {
      assert.ok(Math.min(segment.end.y, other.end.y) <= Math.max(segment.start.y, other.start.y));
    } else if (!vertical && other.start.y === other.end.y && segment.start.y === other.start.y) {
      assert.ok(Math.min(segment.end.x, other.end.x) <= Math.max(segment.start.x, other.start.x));
    }
  }
});

test('a returning branch departs from a different side than its entry, independently of route request order', () => {
  const graph = { nodes: [
    { id: 'a', tree_box: { x: 40, y: 160, w: 90, h: 40 } },
    { id: 'b', tree_box: { x: 240, y: 160, w: 90, h: 40 } },
    { id: 'c', tree_box: { x: 40, y: 40, w: 90, h: 40 } },
  ], edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }] };
  const layout = tree.layoutGraph(graph);
  const departure = tree.edgePath(graph.edges[1], layout);
  const incoming = layout.routes.get('a>b').at(-1), outgoing = layout.routes.get('b>c')[0];
  const b = layout.positions.get('b');
  assert.equal(incoming.x, b.x - 5);
  assert.ok(outgoing.x > b.x, 'departure must use the top, right or bottom side');
  const again = tree.layoutGraph(graph);
  tree.edgePath(graph.edges[0], again);
  assert.equal(tree.edgePath(graph.edges[1], again), departure);
});

test('all five cycles keep the printed arrangement and chosen adjustments with space for arrowheads', () => {
  const c = context();
  let count = 0;
  for (const language of ['en', 'zh']) {
    c.treeLanguage = language;
    for (const page of c.data.pages) {
      const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
      const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
      assert.equal(layout.positions.size, page.nodes.length);
      assert.equal(layout.width, page.width * layout.spacingX);
      assert.equal(layout.height, page.height * layout.spacingY);
      for (const node of page.nodes) {
        const position = layout.positions.get(node.id), box = node.tree_box;
        const row = page.nodes.find(item => item.id === page.node_align_y?.[node.id])?.tree_box || box;
        assert.ok(Math.abs(position.x + position.width / 2 - (box.x + box.w / 2) * layout.spacingX) < .001);
        assert.ok(Math.abs(position.y + position.height / 2 - (row.y + row.h / 2) * layout.spacingY) < .001);
        assert.ok(position.width <= 104 && position.height >= 34 && position.height <= Math.max(34, box.h));
      }
      const positions = [...layout.positions.values()];
      for (const position of positions) {
        assert.ok(position.x >= 0 && position.y >= 0);
        assert.ok(position.x + position.width <= layout.width);
        assert.ok(position.y + position.totalHeight <= layout.height);
        for (const other of positions) {
          if (other === position) continue;
          assert.ok(position.x + position.width <= other.x || other.x + other.width <= position.x || position.y + position.totalHeight <= other.y || other.y + other.totalHeight <= position.y);
        }
      }
      graph.edges.forEach(edge => {
        const path = tree.edgePath(edge, layout);
        assert.match(path, /^M /);
        assert.doesNotMatch(path, /NaN|Infinity/);
        const route = layout.routes.get(edge.source + '>' + edge.target);
        for (let index = 1; index < route.length; index++) {
          const a = route[index - 1], b = route[index];
          for (let obstacleIndex = 0; obstacleIndex < layout.obstacles.length; obstacleIndex++) {
            const original = layout.obstacles[obstacleIndex];
            const endpoint = original === layout.obstacles[[...layout.positions.keys()].indexOf(edge.source)]
              || original === layout.obstacles[[...layout.positions.keys()].indexOf(edge.target)];
            const rect = endpoint ? original : layout.routingObstacles[obstacleIndex];
            if (Math.abs(a.x - b.x) < .001) {
              assert.ok(!(a.x > rect.x + .01 && a.x < rect.x + rect.width - .01 && Math.max(a.y, b.y) > rect.y + .01 && Math.min(a.y, b.y) < rect.y + rect.height - .01), `${page.key}: ${edge.source} -> ${edge.target} crosses a module`);
            } else {
              assert.ok(!(a.y > rect.y + .01 && a.y < rect.y + rect.height - .01 && Math.max(a.x, b.x) > rect.x + .01 && Math.min(a.x, b.x) < rect.x + rect.width - .01), `${page.key}: ${edge.source} -> ${edge.target} crosses a module`);
            }
          }
        }
      });
      for (const node of page.nodes) {
        const rect = layout.positions.get(node.id);
        const entries = graph.edges.filter(edge => edge.target === node.id).map(edge => {
          const endpoint = layout.routes.get(edge.source + '>' + edge.target).at(-1);
          return { x: endpoint.x + (endpoint.x < rect.x ? 5 : endpoint.x > rect.x + rect.width ? -5 : 0),
            y: endpoint.y + (endpoint.y < rect.y ? 5 : endpoint.y > rect.y + rect.height ? -5 : 0) };
        });
        for (const edge of graph.edges.filter(edge => edge.source === node.id)) {
          const exit = layout.routes.get(edge.source + '>' + edge.target)[0];
          assert.ok(entries.every(entry => Math.hypot(entry.x - exit.x, entry.y - exit.y) > 1), `${page.key}: ${node.name} shares its entry and exit`);
        }
      }
      const segments = tree.linkSegments(graph.edges, layout);
      for (const segment of segments) {
        for (const other of segments) {
          if (segment === other) continue;
          const vertical = segment.start.x === segment.end.x;
          if (vertical && other.start.x === other.end.x && segment.start.x === other.start.x) {
            assert.ok(Math.min(segment.end.y, other.end.y) <= Math.max(segment.start.y, other.start.y));
          } else if (!vertical && other.start.y === other.end.y && segment.start.y === other.start.y) {
            assert.ok(Math.min(segment.end.x, other.end.x) <= Math.max(segment.start.x, other.start.x));
          }
        }
      }
      count += page.nodes.length;
    }
  }
  assert.equal(count, 646);
});

test('cycle II recruitment and security swap heights and recruitment enters the propylon from above', () => {
  const c = context(), page = c.data.pages[1];
  const recruit = page.nodes.find(node => node.name === 'War Recruitment');
  const security = page.nodes.find(node => node.name === 'Argo Security');
  const gate = page.nodes.find(node => node.name === 'War Propylon');
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const originalRecruit = { ...recruit.tree_box }, originalSecurity = { ...security.tree_box };
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
    const r = layout.positions.get(recruit.id), s = layout.positions.get(security.id), g = layout.positions.get(gate.id);
    assert.equal(r.y + r.height / 2, (originalSecurity.y + originalSecurity.h / 2) * layout.spacingY);
    assert.equal(s.y + s.height / 2, (originalRecruit.y + originalRecruit.h / 2) * layout.spacingY);
    const edge = graph.edges.find(item => item.source === recruit.id && item.target === gate.id);
    tree.edgePath(edge, layout);
    const route = layout.routes.get(edge.source + '>' + edge.target);
    assert.equal(route[0].x, r.x);
    assert.ok(route[1].x < route[0].x, 'arrow departs to the left');
    assert.equal(route.at(-1).x, g.x + g.width / 2);
    assert.equal(route.at(-1).y, g.y - 5);
    assert.ok(route.at(-2).y < route.at(-1).y, 'arrow enters the top of the gate');
  }
  assert.deepEqual({ ...recruit.tree_box }, originalRecruit);
  assert.deepEqual({ ...security.tree_box }, originalSecurity);
});

test('adjusted related nodes form straight horizontal branches in both languages', () => {
  const c = context();
  const branches = [
    [['cycle1_22', 'cycle1_30'], ['cycle1_30', 'cycle1_51'], ['cycle1_51', 'cycle1_29'], ['cycle1_29', 'cycle1_2']],
    [['cycle2_30', 'cycle2_29'], ['cycle2_43', 'cycle2_14'], ['cycle2_31', 'cycle2_11'], ['cycle2_54', 'cycle2_17']],
    [['cycle3_20', 'cycle3_57'], ['cycle3_57', 'cycle3_1'], ['cycle3_22', 'cycle3_58'], ['cycle3_58', 'cycle3_2']],
    [['cycle4_da2185', 'cycle4_da2193'], ['cycle4_da2205', 'cycle4_da2211'], ['cycle4_da2211', 'cycle4_da2216'],
      ['cycle4_da2203', 'cycle4_da2220'], ['cycle4_da2200', 'cycle4_da2204']],
    [['cycle5_ea2777', 'cycle5_ea2778'], ['cycle5_ea2778', 'cycle5_ea2779']],
  ];
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    for (const [index, pairs] of branches.entries()) {
      const page = c.data.pages[index];
      const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
      const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
      for (const [source, target] of pairs) {
        const edge = graph.edges.find(item => item.source === source && item.target === target);
        assert.ok(edge, `${source} -> ${target} is a real dependency`);
        const a = layout.positions.get(source), b = layout.positions.get(target);
        assert.ok(Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < .001);
        tree.edgePath(edge, layout);
        const route = layout.routes.get(source + '>' + target);
        assert.equal(route.length, 2, `${language}: ${source} -> ${target} is straight`);
        assert.ok(Math.abs(route[0].y - route[1].y) < .001);
      }
      for (const id of Object.keys(page.node_align_y)) {
        if (!pairs.flat().includes(id)) continue;
        const node = page.nodes.find(item => item.id === id), rect = layout.positions.get(id);
        const originalY = (node.tree_box.y + node.tree_box.h / 2) * layout.spacingY;
        if (index === 0) assert.ok(rect.y + rect.height / 2 > originalY, `${id} moves down`);
        if (index === 2) assert.ok(rect.y + rect.height / 2 < originalY, `${id} moves up`);
      }
    }
  }
});

test('the upward arrow into relief gear has clear space around its head', () => {
  const c = context(), page = c.data.pages[1];
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
    const edge = graph.edges.find(item => item.source === 'cycle2_25' && item.target === 'cycle2_51');
    tree.edgePath(edge, layout);
    const route = layout.routes.get('cycle2_25>cycle2_51'), head = route.at(-1);
    assert.ok(route.at(-2).y > head.y, 'arrow points up');
    const segments = tree.linkSegments(graph.edges, layout);
    for (const segment of segments) {
      if (segment.edges.includes(edge)) continue;
      const { start: a, end: b } = segment;
      const touchesHead = a.y === b.y
        ? a.y >= head.y - 1 && a.y <= head.y + 7 && b.x > head.x - 4 && a.x < head.x + 4
        : a.x >= head.x - 4 && a.x <= head.x + 4 && b.y > head.y - 1 && a.y < head.y + 7;
      assert.equal(touchesHead, false, `${language}: another line crosses the upward arrowhead`);
    }
  }
});

test('cycle IV cloud support fleet receives from above and departs to the right', () => {
  const c = context(), page = c.data.pages[3];
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const fleet = page.nodes.find(node => node.name === 'Cloud Support Fleet');
  const incoming = graph.edges.filter(edge => edge.target === fleet.id);
  const outgoing = graph.edges.filter(edge => edge.source === fleet.id);
  assert.equal(incoming.length, 2);
  assert.equal(outgoing.length, 2);
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
    const rect = layout.positions.get(fleet.id);
    for (const edge of incoming) {
      tree.edgePath(edge, layout);
      const route = layout.routes.get(edge.source + '>' + edge.target);
      assert.equal(route.at(-1).y, rect.y - 5);
      assert.equal(route.at(-1).x, rect.x + rect.width / 2);
      assert.ok(route.at(-2).y < route.at(-1).y, `${language}: arrow enters from above`);
    }
    for (const edge of outgoing) {
      const route = layout.routes.get(edge.source + '>' + edge.target);
      assert.equal(route[0].x, rect.x + rect.width);
      assert.ok(route[1].x > route[0].x, `${language}: arrow leaves to the right`);
    }
  }
});

test('cycle IV and V requested adjustments move nodes in the specified direction', () => {
  const c = context();
  const changes = [
    [3, 'Dahaka Sighting', 1], [3, 'Sandstorm Navigation', 1],
    [3, 'Sustainable Oasis', -1], [3, 'Curse Economy Basics', -1],
    [4, 'Tight-spaces Navigation', -1],
  ];
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    for (const [index, name, direction] of changes) {
      const page = c.data.pages[index], node = page.nodes.find(item => item.name === name);
      const graph = tree.buildGraph(page.nodes, item => c.nodeKey(page.key, item));
      const layout = tree.layoutGraph(graph, page, item => c.treeModuleSize(page.key, item));
      const rect = layout.positions.get(node.id), box = node.tree_box;
      const difference = rect.y + rect.height / 2 - (box.y + box.h / 2) * layout.spacingY;
      assert.ok(direction * difference > 1, `${language}: ${name} moves ${direction > 0 ? 'down' : 'up'}`);
    }
  }
});

test('cycle V abyss weapons and atlantean armor use separated horizontal lanes without moving nodes', () => {
  const c = context(), page = c.data.pages[4];
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const edge = graph.edges.find(item => item.source === 'cycle5_ea2729' && item.target === 'cycle5_ea2735');
  const trunks = graph.edges.filter(item => item.source === 'cycle5_ea2734');
  for (const language of ['zh', 'en']) {
    c.treeLanguage = language;
    const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
    const before = tree.layoutGraph(graph, { ...page, edge_channels: {} }, node => c.treeModuleSize(page.key, node));
    assert.deepEqual([...layout.positions], [...before.positions]);
    tree.edgePath(edge, layout);
    const horizontals = route => route.slice(1).map((end, index) => ({ start: route[index], end }))
      .filter(segment => segment.start.y === segment.end.y && Math.abs(segment.end.x - segment.start.x) > 50);
    const lane = horizontals(layout.routes.get(edge.source + '>' + edge.target));
    let compared = 0;
    for (const trunk of trunks) for (const a of lane) {
      for (const b of horizontals(layout.routes.get(trunk.source + '>' + trunk.target))) {
        const overlap = Math.min(Math.max(a.start.x, a.end.x), Math.max(b.start.x, b.end.x))
          - Math.max(Math.min(a.start.x, a.end.x), Math.min(b.start.x, b.end.x));
        if (overlap <= 50) continue;
        compared++;
        assert.ok(Math.abs(a.start.y - b.start.y) >= 18, `${language}: parallel lanes have visible separation`);
      }
    }
    assert.ok(compared > 0, 'the two branches overlap horizontally');
    const armor = layout.positions.get('cycle5_ea2734'), sighting = layout.positions.get('cycle5_ea2747');
    assert.ok(lane.some(segment => segment.start.y > armor.y + armor.totalHeight + 8
      && segment.start.y < sighting.y - 8), 'the moved lane stays in the clear gap between modules');
  }
});

test('empty and cyclic imported graphs have finite fixed layouts', () => {
  assert.equal(tree.layoutGraph({ nodes: [], edges: [] }).positions.size, 0);
  const graph = { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [
    { source: 'a', target: 'b' }, { source: 'b', target: 'a' }, { source: 'b', target: 'c' },
  ] };
  const layout = tree.layoutGraph(graph);
  assert.equal(layout.positions.size, 3);
  for (const edge of graph.edges) assert.match(tree.edgePath(edge, layout), /^M /);
  assert.ok(Number.isFinite(layout.width));
});

test('revealing a branch preserves the coordinates and paths of already discovered nodes', () => {
  const c = context(), page = c.data.pages[0];
  const graph = tree.buildGraph(page.nodes, node => c.nodeKey(page.key, node));
  const layout = tree.layoutGraph(graph, page, node => c.treeModuleSize(page.key, node));
  const before = tree.visibleGraph(graph, node => c.isDiscoveredNode(page.key, node), true);
  const snapshot = JSON.stringify([...layout.positions]);
  const paths = before.edges.map(edge => tree.edgePath(edge, layout));
  c.unlocked.add('trading solutions');
  const after = tree.visibleGraph(graph, node => c.isDiscoveredNode(page.key, node), true);
  assert.ok(after.nodes.length > before.nodes.length);
  assert.equal(JSON.stringify([...layout.positions]), snapshot);
  assert.deepEqual(before.edges.map(edge => tree.edgePath(edge, layout)), paths);
});
