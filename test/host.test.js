/**
 * Host smoke test with a fake Cordis ctx: registers the plugin, runs the
 * tools the way the tool pipeline does (execute -> render -> presentationMeta),
 * and folds the resulting tool/result events through the session projection.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject } from '../index.js'

function fakeHarness(dataFile) {
  const tools = new Map()
  const routes = []
  const sections = []
  let projectionDef
  const sessionState = new Map()
  const ctx = {
    effect: fn => fn(),
    logger: { warn() {} },
    tools: { register: def => { tools.set(def.name, def); return () => tools.delete(def.name) } },
    systemPrompt: { section: s => { sections.push(s); return () => {} } },
    inject: (names, fn) => {
      assert.deepEqual(names, ['connection'])
      fn({ effect: f => f(), connection: { fetch: { register: route => { routes.push(route); return () => {} } } } })
    },
    sessionProjections: {
      register(def) {
        projectionDef = def
        return Promise.resolve({ stateOf: session => sessionState.get(session) ?? def.init() })
      },
    },
  }
  apply(ctx, { dataFile })
  const session = { id: 's1' }
  /** Run one tool call and append its result event to the fake session log. */
  async function call(name, args) {
    const tool = tools.get(name)
    const value = await tool.execute(args, { agent: { session }, signal: new AbortController().signal })
    assert.ok(typeof value.text === 'string')
    const content = tool.output.render(args, value)
    const meta = tool.output.presentationMeta(args, value)
    JSON.stringify(meta) // must be JSON-serializable for Session.append
    const event = { type: 'tool/result', data: { message: { content }, meta } }
    const prev = sessionState.get(session) ?? projectionDef.init()
    const next = projectionDef.stateSchema.parse(projectionDef.apply(prev, event))
    sessionState.set(session, next)
    return { value, content, state: next }
  }
  return { tools, sections, call, projection: () => projectionDef, session, sessionState, routes }
}

const plan = {
  goal_id: 'lagrange_mvt',
  nodes: [
    { id: 'limit', name: '极限', type: 'concept', summary: 's', prerequisites: [] },
    { id: 'derivative', name: '导数的定义', type: 'concept', summary: 's', prerequisites: ['limit'] },
    { id: 'rolle_theorem', name: '罗尔定理', type: 'theorem', summary: 's', prerequisites: ['derivative'] },
    { id: 'lagrange_mvt', name: '拉格朗日中值定理', type: 'theorem', summary: 's', prerequisites: ['rolle_theorem'] },
  ],
}

test('plugin declares the services it uses and registers tools + prompt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  try {
    const h = fakeHarness(join(dir, 'k.json'))
    await new Promise(r => setImmediate(r))
    assert.deepEqual(inject, ['tools', 'systemPrompt', 'sessionProjections'])
    assert.deepEqual([...h.tools.keys()].sort(), ['techtree_merge', 'techtree_plan', 'techtree_record', 'techtree_view'])
    assert.equal(h.sections[0].name, 'plugin:techtree')
    assert.equal(h.projection().key, 'techtree')
    assert.equal(h.projection().wire.summary, false)
    for (const tool of h.tools.values()) {
      assert.equal(tool.parameters.type, 'object')
      assert.equal(typeof tool.output.render, 'function')
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('plan -> record -> view flows through meta into the projection and the knowledge file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  const file = join(dir, 'nested', 'k.json')
  try {
    const h = fakeHarness(file)
    await new Promise(r => setImmediate(r)) // projection handle resolves

    const planned = await h.call('techtree_plan', plan)
    assert.equal(planned.state.goals[0].id, 'lagrange_mvt')
    assert.equal(planned.state.nodes.length, 4)
    assert.match(planned.content[0].text, /4 new, 0 reused/)
    assert.match(planned.content[0].text, /Learnable now .*limit/)
    // canonical view returns the same reference when an unrelated event arrives
    const same = h.projection().apply(planned.state, { type: 'assistant/message', data: {} })
    assert.equal(same, planned.state)

    const lit = await h.call('techtree_record', { node_id: 'limit', level: 1, evidence: 'explained epsilon-delta in own words' })
    assert.equal(lit.state.nodes.find(n => n.id === 'limit').mastery, 1)
    assert.match(lit.content[0].text, /Learnable now .*derivative/)

    // A second goal in the same session keeps the first one.
    await h.call('techtree_plan', {
      goal_id: 'taylor',
      nodes: [{ id: 'taylor', name: '泰勒公式', type: 'theorem', summary: 's', prerequisites: ['lagrange_mvt'] }],
    })
    const view = await h.call('techtree_view', {})
    assert.deepEqual(view.state.goals.map(g => g.id), ['lagrange_mvt', 'taylor'])
    assert.equal(view.state.nodes.length, 5)

    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.nodes.limit.mastery, 1)
    assert.equal(saved.nodes.limit.history.length, 1)

    // A fresh session (new log) on the same knowledge file sees earlier mastery.
    const h2 = fakeHarness(file)
    await new Promise(r => setImmediate(r))
    const empty = await h2.call('techtree_view', {})
    assert.equal(empty.value.snapshot, null)
    assert.equal(empty.state, null)
    assert.match(empty.content[0].text, /1 lit/)
    const reopened = await h2.call('techtree_view', { goal_id: 'lagrange_mvt' })
    assert.equal(reopened.state.nodes.find(n => n.id === 'limit').mastery, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('invalid calls throw model-readable errors and leave the file untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  const file = join(dir, 'k.json')
  try {
    const h = fakeHarness(file)
    await new Promise(r => setImmediate(r))
    await assert.rejects(h.call('techtree_plan', { goal_id: 'x', nodes: [{ id: 'x', name: 'X', prerequisites: ['ghost'] }] }), /unknown prerequisite "ghost"/)
    await assert.rejects(readFile(file), /ENOENT/)
    await h.call('techtree_plan', plan)
    await assert.rejects(h.call('techtree_record', { node_id: 'limit', level: 1 }), /evidence is required/)
    // the store keeps working after a failed write attempt
    await h.call('techtree_record', { node_id: 'limit', level: 1, evidence: 'proved a limit' })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('projection schema rejects malformed state', () => {
  const h = fakeHarness('/nonexistent/k.json')
  assert.equal(h.projection().stateSchema.parse(null), null)
  assert.throws(() => h.projection().stateSchema.parse({ goals: 'x' }), /invalid/)
})

test('hooks persist, goals are remembered, and the library route serves every goal', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  try {
    const file = join(dir, 'k.json')
    const h = fakeHarness(file)
    await new Promise(r => setImmediate(r))
    const withHooks = { ...plan, nodes: plan.nodes.map(n => (n.id === 'rolle_theorem' ? { ...n, hook: '过山车起点终点一样高，中间必有一处是平的' } : n)) }
    const { state } = await h.call('techtree_plan', withHooks)
    assert.equal(state.nodes.find(n => n.id === 'rolle_theorem').hook, '过山车起点终点一样高，中间必有一处是平的')
    // Re-planning without a hook keeps it; with one, replaces it.
    const again = await h.call('techtree_plan', plan)
    assert.equal(again.state.nodes.find(n => n.id === 'rolle_theorem').hook, '过山车起点终点一样高，中间必有一处是平的')
    assert.match(again.value.text, /limit "极限" .*no-hook/)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.goals.lagrange_mvt.name, '拉格朗日中值定理')
    // The authenticated GET route returns each goal with its tree.
    assert.equal(h.routes.length, 1)
    assert.equal(h.routes[0].path, '/api/techtree/library')
    assert.deepEqual(h.routes[0].methods, ['GET'])
    const response = await h.routes[0].fetch(new Request('http://x/api/techtree/library'))
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    const body = await response.json()
    assert.deepEqual(body.goals.map(g => g.goal.id), ['lagrange_mvt'])
    assert.equal(body.goals[0].nodes.length, 4)
    // Tutor prompt asks for hooks and allows skip-ahead challenges.
    assert.match(h.sections[0].text, /hook/)
    assert.match(h.sections[0].text, /Skip-ahead challenge/)
    assert.match(h.sections[0].text, /Writing node text/)
    assert.match(h.sections[0].text, /REUSE EXISTING POINTS/)
    assert.match(h.sections[0].text, /glossary/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a second goal sees the map, gets a duplicate hint, and merging lights the shared point there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  try {
    const h = fakeHarness(join(dir, 'k.json'))
    await new Promise(r => setImmediate(r))
    await h.call('techtree_plan', plan)
    await h.call('techtree_record', { node_id: 'derivative', level: 1, evidence: 'explained it' })
    // A new conversation: its own session log, same knowledge map.
    h.sessionState.clear()
    const view = await h.call('techtree_view', { map: true })
    assert.match(view.value.text, /derivative · 导数的定义 · 1/)
    assert.equal(view.value.snapshot, null)
    const planned = await h.call('techtree_plan', {
      goal_id: 'taylor',
      nodes: [
        { id: 'derivative_definition', name: '导数定义', type: 'concept', summary: 's', prerequisites: [] },
        { id: 'taylor', name: '泰勒公式', type: 'theorem', summary: 's', prerequisites: ['derivative_definition'] },
      ],
    })
    assert.match(planned.value.text, /derivative_definition "导数定义" -> derivative "导数的定义"/)
    const merged = await h.call('techtree_merge', { from_id: 'derivative_definition', into_id: 'derivative', reason: 'same' })
    assert.match(merged.value.text, /mastery is now 1/)
    assert.deepEqual(merged.state.nodes.map(n => [n.id, n.mastery]), [['limit', 0], ['derivative', 1], ['taylor', 0]])
    // The left-Sidebar library shows the merged point lit in both goals.
    const lib = await (await h.routes[0].fetch(new Request('http://x/api/techtree/library'))).json()
    for (const goal of lib.goals) assert.equal(goal.nodes.find(n => n.id === 'derivative').mastery, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('goals saved in a conversation follow a merge of their goal point', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  try {
    const h = fakeHarness(join(dir, 'k.json'))
    await new Promise(r => setImmediate(r))
    await h.call('techtree_plan', { goal_id: 'a2', nodes: [{ id: 'a2', name: 'A two', type: 'concept', summary: 's', prerequisites: [] }] })
    await h.call('techtree_plan', { goal_id: 'b', nodes: [{ id: 'a', name: 'A', type: 'concept', summary: 's', prerequisites: [] }, { id: 'b', name: 'B', type: 'concept', summary: 's', prerequisites: ['a'] }] })
    await h.call('techtree_merge', { from_id: 'a2', into_id: 'a', reason: 'same' })
    const view = await h.call('techtree_view', {})
    assert.deepEqual(view.state.goals.map(g => g.id).sort(), ['a', 'b'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('lighting rules: one level per check, no second raise of the same point right away', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tt-'))
  try {
    const h = fakeHarness(join(dir, 'k.json'))
    await new Promise(r => setImmediate(r))
    await h.call('techtree_plan', plan)
    await assert.rejects(h.call('techtree_record', { node_id: 'limit', level: 3, evidence: 'x' }), /at most one level/)
    await h.call('techtree_record', { node_id: 'limit', level: 1, evidence: 'explained it' })
    await assert.rejects(h.call('techtree_record', { node_id: 'limit', level: 2, evidence: 'x' }), /just went up a level/)
    // Other points, and marking weak or unlit, are still fine.
    await h.call('techtree_record', { node_id: 'derivative', level: 1, evidence: 'explained it' })
    const weak = await h.call('techtree_record', { node_id: 'limit', level: 1, weak: true, evidence: 'gap shown' })
    assert.equal(weak.state.nodes.find(n => n.id === 'limit').weak, true)
    await assert.rejects(h.call('techtree_merge', { from_id: 'limit', into_id: 'derivative', reason: 'x' }), /prerequisite of the other/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
