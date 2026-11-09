/**
 * Client smoke test without a browser: loads client.js through a fake module
 * loader, applies it against a fake ctx, and expands the registered components
 * with a minimal React stand-in (function components, useState/useMemo).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const Fragment = Symbol('Fragment')
const defaultState = init => [typeof init === 'function' ? init() : init, () => {}]
let stateImpl = defaultState
const fakeReact = {
  Fragment,
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: init => stateImpl(init),
  useMemo: fn => fn(),
  useCallback: fn => fn,
  useRef: init => ({ current: init }),
  useEffect: () => {},
}

/** Expand function components into host elements; returns a tree of {tag, props, children}. */
function render(element) {
  if (element === null || element === undefined || element === false) return null
  if (typeof element === 'function') return null
  if (typeof element !== 'object') return String(element)
  if (Array.isArray(element)) return element.map(render)
  if (typeof element.type === 'function') {
    return render(element.type({ ...element.props, children: element.children.length === 1 ? element.children[0] : element.children }))
  }
  return { tag: element.type === Fragment ? '#fragment' : element.type, props: element.props, children: element.children.map(render) }
}

function collect(tree, pred, out = []) {
  if (tree === null || typeof tree !== 'object') return out
  if (Array.isArray(tree)) { tree.forEach(t => collect(t, pred, out)); return out }
  if (pred(tree)) out.push(tree)
  tree.children.forEach(t => collect(t, pred, out))
  return out
}
const text = tree => (tree === null ? '' : typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree.children.map(text).join(''))

async function loadClient() {
  let module
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  const sandbox = { window: { __ModuleLoader__: { load: m => { module = m } } }, Date, Math, Object, Set, Array, String, Number, JSON, RegExp }
  vm.runInNewContext(source, sandbox)
  assert.equal(module.id, 'dsh-talent-tree')
  const plugin = module.factory(name => {
    if (name === '@deepseek-ai/dsh-client-ui-primitives') throw new Error('not in the test sandbox')
    assert.equal(name, 'react')
    return fakeReact
  })
  const registrations = { slots: [], tabs: [], dicts: {}, opened: [], started: [] }
  const ctx = {
    effect: fn => fn(),
    locale: {
      register: (ns, dicts) => { registrations.dicts[ns] = dicts; return () => {} },
      bind: ns => key => registrations.dicts[ns].zh[key] ?? key,
    },
    sidebarRightTabs: { register: def => { registrations.tabs.push(def); return () => {} } },
    sidebarRight: { openTab: kind => registrations.opened.push(kind) },
    get: name => (name === 'uiWorkspace' ? { startSession: (ws, options) => registrations.started.push(options) } : undefined),
    slots: {
      inject: (_owner, cb) => cb(),
      register: (options, component) => { registrations.slots.push({ options, component }); return () => {} },
    },
  }
  plugin.apply(ctx)
  return { plugin, registrations }
}

const snapshot = {
  version: 1,
  goals: [{ id: 'lagrange_mvt', name: '拉格朗日中值定理' }],
  nodes: [
    { id: 'limit', name: '极限', type: 'concept', summary: '', prerequisites: [], mastery: 3, reviewedAt: Date.now() },
    { id: 'continuity', name: '连续性', type: 'concept', summary: '', prerequisites: ['limit'], mastery: 1, reviewedAt: Date.now() - 10 * 86400000 },
    { id: 'derivative', name: '导数的定义', type: 'concept', summary: '', prerequisites: ['limit'], mastery: 0, weak: true },
    { id: 'extreme_value_theorem', name: '最值定理', type: 'theorem', summary: '', prerequisites: ['continuity'], mastery: 0 },
    { id: 'fermat_lemma', name: '费马引理', type: 'theorem', summary: '', prerequisites: ['derivative'], mastery: 0 },
    { id: 'rolle_theorem', name: '罗尔定理', type: 'theorem', summary: '', hook: '过山车起点终点一样高，中间必有一处是平的', prerequisites: ['fermat_lemma', 'extreme_value_theorem'], mastery: 0 },
    { id: 'auxiliary_function', name: '构造辅助函数', type: 'method', summary: '', prerequisites: [], mastery: 0 },
    { id: 'lagrange_mvt', name: '拉格朗日中值定理', type: 'theorem', summary: '核心目标', prerequisites: ['rolle_theorem', 'auxiliary_function'], mastery: 0, est_minutes: 40 },
  ],
  at: Date.now(),
}

const translate = ns => key => ns.zh[key] ?? key

test('client registers the tab type, body, title, composer chip and left panel', async () => {
  const { plugin, registrations } = await loadClient()
  assert.deepEqual([...plugin.inject], ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight'])
  assert.equal(registrations.tabs[0].kind, 'techtree')
  assert.equal(registrations.tabs[0].id, 'dsh-talent-tree')
  assert.equal(registrations.tabs[0].title(), '天赋树')
  assert.equal(registrations.tabs[0].guide[0].title(), '学习天赋树')
  const names = registrations.slots.map(s => s.options.name)
  assert.deepEqual(names, ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title', 'conversation.composer.dock', 'main', 'sidebar.panellist'])
  const nav = registrations.slots.find(s => s.options.name === 'sidebar.panellist')
  const main = registrations.slots.find(s => s.options.name === 'main')
  assert.equal(nav.options.id, main.options.key, 'the left entry opens the main panel with the same id')
  assert.equal(nav.options.label(), '天赋树')
  assert.equal(render(fakeReact.createElement(nav.component, { size: 18 })).tag, 'svg')
  // zh and en dictionaries have the same keys
  const { zh, en } = registrations.dicts.techtree
  assert.deepEqual([...Object.keys(zh)].sort(), [...Object.keys(en)].sort())
})

test('tree body renders empty state, then the graph with correct node states', async () => {
  const { registrations } = await loadClient()
  const body = registrations.slots.find(s => s.options.name === 'sidebar.right.pane.tab').component
  const t = translate(registrations.dicts.techtree)
  const sent = []
  const inputActions = { setDraft: d => sent.push(d), submit: () => sent.push('<submit>') }

  const empty = render(fakeReact.createElement(body, { t, inputActions, useProjection: () => null }))
  assert.match(text(empty), /还没有天赋树/)

  const tree = render(fakeReact.createElement(body, { t, inputActions, useProjection: key => (key === 'techtree' ? snapshot : undefined) }))
  const nodes = collect(tree, el => el.tag === 'button' && String(el.props.className).includes('tt-node'))
  assert.equal(nodes.length, 8)
  const name = n => text(collect(n, el => el.props.className === 'tt-node-name')[0])
  const cls = Object.fromEntries(nodes.map(n => [name(n), n.props.className]))
  assert.match(cls['极限'], /tt-lit-3/)
  assert.match(cls['连续性'], /tt-lit-1 tt-fading/) // bronze, 10 days old
  assert.match(cls['导数的定义'], /tt-available.*tt-weak/)
  assert.match(cls['罗尔定理'], /tt-locked/)
  assert.match(cls['拉格朗日中值定理'], /tt-goal-node/)
  assert.match(text(tree), /已点亮 2\/8/)
  assert.match(text(tree), /现在可以学：3 个/) // derivative, extreme_value_theorem, auxiliary_function

  // Layout: every edge goes downward (prerequisite above dependent), nodes do not overlap.
  const coords = nodes.map(n => n.props.style)
  for (let i = 0; i < coords.length; i++) {
    for (let j = i + 1; j < coords.length; j++) {
      const a = coords[i]; const b = coords[j]
      assert.ok(Math.abs(a.left - b.left) >= 168 || a.top !== b.top, 'nodes overlap')
    }
  }
  const edges = collect(tree, el => el.tag === 'path' && String(el.props.className).includes('tt-edge'))
  assert.equal(edges.length, 8)
  for (const e of edges) {
    const [, y1, , , , , , y2] = e.props.d.match(/-?[\d.]+/g).map(Number)
    assert.ok(y2 > y1, `edge ${e.props.d} should point down`)
  }

  // Edge styles: lit->lit solid, lit->unlit flowing, otherwise locked.
  const edgesOf = kind => edges.filter(e => e.props.className.includes(kind))
  assert.equal(edgesOf('tt-edge-lit').length, 1) // limit -> continuity
  assert.equal(edgesOf('tt-edge-flow').length, 2) // limit -> derivative, continuity -> extreme_value_theorem
  assert.equal(edgesOf('tt-edge-locked').length, 5)

  // Recommended next step: the first step toward the goal (weak + shallow first).
  const rec = nodes.filter(n => collect(n, el => el.props.className === 'tt-rec').length)
  assert.deepEqual(rec.map(name), ['导数的定义'])

  // Pan/zoom stage: viewport, transformed canvas, zoom controls.
  assert.equal(collect(tree, el => String(el.props.className).startsWith('tt-viewport')).length, 1)
  assert.match(collect(tree, el => el.props.className === 'tt-canvas')[0].props.style.transform, /translate\(.*\) scale\(/)
  assert.equal(collect(tree, el => el.props.className === 'tt-overlay tt-zoom').length, 1)

  // Goal form submits a planning prompt through the composer.
  const form = collect(tree, el => el.tag === 'form')[0]
  assert.ok(form)
  const input = collect(form, el => el.tag === 'input')[0]
  assert.ok(input)
})

test('node detail card and actions send prompts to the composer', async () => {
  const { registrations } = await loadClient()
  const body = registrations.slots.find(s => s.options.name === 'sidebar.right.pane.tab').component
  const t = translate(registrations.dicts.techtree)
  const sent = []
  const inputActions = { setDraft: d => sent.push(d), submit: () => sent.push('<submit>') }
  // Pre-select a node: the Stage's selection is the first null-initialised state.
  let nulls = 0
  stateImpl = init => (init === null && nulls++ === 0 ? ['rolle_theorem', () => {}] : defaultState(init))
  try {
    const tree = render(fakeReact.createElement(body, { t, inputActions, useProjection: () => snapshot }))
    const card = collect(tree, el => el.props.className === 'tt-card')[0]
    assert.ok(card, 'detail card renders for the selected node')
    assert.match(text(collect(card, el => el.props.className === 'tt-hook')[0]), /过山车起点终点一样高/)
    assert.match(text(card), /前置知识：费马引理最值定理|前置知识：最值定理费马引理/)
    assert.match(text(card), /解锁：拉格朗日中值定理/)
    // Learning route: unlit prerequisites first (weak ones ahead of equals), the target last.
    const steps = collect(card, el => el.props.className === 'tt-route-step').map(text)
    assert.deepEqual(steps, ['1导数的定义', '2最值定理', '3费马引理', '4罗尔定理'])
    const nodeSteps = collect(tree, el => el.props.className === 'tt-step')
    assert.equal(nodeSteps.length, 4, 'route numbers appear on the canvas')
    const route = collect(card, el => el.tag === 'button' && text(el) === '按路线学')[0]
    route.props.onClick()
    assert.match(sent[0], /1\. 导数的定义（derivative） → 2\. 最值定理（extreme_value_theorem） → 3\. 费马引理（fermat_lemma） → 4\. 罗尔定理（rolle_theorem）/)
    assert.equal(sent[1], '<submit>')
    const skip = collect(card, el => el.tag === 'button' && text(el) === '跳级挑战')[0]
    skip.props.onClick()
    assert.match(sent[2], /跳级挑战「罗尔定理」（rolle_theorem）/)
    assert.equal(collect(card, el => el.tag === 'button' && text(el) === '开始学习').length, 0, 'locked nodes offer the route, not a direct lesson')
  } finally {
    stateImpl = defaultState
  }
})

test('composer chip hides without a tree and opens the sidebar tab', async () => {
  const { registrations } = await loadClient()
  const chipReg = registrations.slots.find(s => s.options.name === 'conversation.composer.dock')
  const t = translate(registrations.dicts.techtree)
  const injected = chipReg.options.inject('session-1')
  assert.equal(render(fakeReact.createElement(chipReg.component, { t, ...injected, useProjection: () => null })), null)
  const chip = render(fakeReact.createElement(chipReg.component, { t, ...injected, useProjection: () => snapshot }))
  const button = collect(chip, el => el.tag === 'button')[0]
  assert.match(text(button), /拉格朗日中值定理 · 已点亮 2\/8/)
  button.props.onClick()
  assert.deepEqual(registrations.opened, ['techtree'])
})

test('left panel lists remembered goals and starts a new conversation', async () => {
  const { registrations } = await loadClient()
  const main = registrations.slots.find(s => s.options.name === 'main')
  const t = translate(registrations.dicts.techtree)
  const injected = main.options.inject()
  // Nothing remembered (no localStorage in the sandbox): empty state, form still works.
  const empty = render(fakeReact.createElement(main.component, { t, ...injected }))
  assert.match(text(empty), /学习天赋树/)
  assert.match(text(empty), /还没有天赋树/)
  const form = collect(empty, el => el.tag === 'form')[0]
  stateImpl = init => (init === '' ? ['拉格朗日中值定理', () => {}] : defaultState(init))
  try {
    const withDraft = render(fakeReact.createElement(main.component, { t, ...injected }))
    collect(withDraft, el => el.tag === 'form')[0].props.onSubmit({ preventDefault() {} })
  } finally {
    stateImpl = defaultState
  }
  assert.ok(form)
  assert.equal(registrations.started.length, 1)
  assert.match(registrations.started[0].prompt, /我想学会「拉格朗日中值定理」/)
})

test('formulas render: $…$ through the built-in TeX renderer, bare √x and x_k prettified', async () => {
  const { registrations } = await loadClient()
  const body = registrations.slots.find(s => s.options.name === 'sidebar.right.pane.tab').component
  const t = translate(registrations.dicts.techtree)
  const math = {
    ...snapshot,
    nodes: snapshot.nodes.map(n => (n.id === 'rolle_theorem'
      ? { ...n, name: '缩放因子 $\\frac{1}{\\sqrt{d_k}}$', summary: '理解缩放因子 1/√d_k 需要方差', hook: '$e^{i\\pi}+1=0$', glossary: [{ term: '$d_k$', meaning: '每个向量里有多少个数（维度），常见是 64' }] }
      : n)),
  }
  let nulls = 0
  stateImpl = init => (init === null && nulls++ === 0 ? ['rolle_theorem', () => {}] : defaultState(init))
  try {
    const tree = render(fakeReact.createElement(body, { t, inputActions: { setDraft() {}, submit() {} }, useProjection: () => math }))
    const card = collect(tree, el => el.props.className === 'tt-card')[0]
    const title = collect(card, el => el.props.className === 'tt-card-title')[0]
    const frac = collect(title, el => el.props.className === 'tt-frac')[0]
    assert.ok(frac, 'fraction is typeset')
    assert.equal(text(frac.children[0]), '1')
    assert.ok(collect(frac, el => el.props.className === 'tt-sqrt').length, 'root is typeset')
    assert.equal(text(collect(frac, el => el.tag === 'sub')[0]), 'k')
    const summary = collect(card, el => el.tag === 'p')[0]
    assert.ok(collect(summary, el => el.props.className === 'tt-sqrt').length, 'bare √d_k gets a vinculum')
    assert.equal(text(collect(summary, el => el.tag === 'sub')[0]), 'k')
    const glossary = collect(card, el => el.props.className === 'tt-glossary')[0]
    assert.ok(glossary, 'symbols are explained in the card')
    assert.match(text(glossary), /符号说明.*dk.*每个向量里有多少个数（维度），常见是 64/)
    const hook = collect(card, el => el.props.className === 'tt-hook')[0]
    assert.match(text(hook), /e.*iπ.*\+1=0/)
    // Prompts and labels carry readable Unicode, not TeX source.
    const node = collect(tree, el => el.props['data-node'] === 'rolle_theorem')[0]
    assert.equal(node.props['aria-label'], '缩放因子 1/√dₖ：e^(iπ)+1=0')
  } finally {
    stateImpl = defaultState
  }
})
