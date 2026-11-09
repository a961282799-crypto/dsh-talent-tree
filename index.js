/**
 * Host half of the learning talent tree.
 *
 * - Three model tools: techtree_plan, techtree_record, techtree_view.
 * - A personal knowledge map shared by every session, kept as one JSON file.
 * - Every tool result carries the session's complete tree snapshot in its
 *   presentation meta; the `techtree` session projection folds those results,
 *   so the sidebar view replays, resumes and forks with the session log.
 * - A static system-prompt section with the tutoring rules.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  GLOSSARY_MAX, HOOK_MAX, NODE_TYPES, buildLibrary, buildSnapshot, describeSnapshot, emptyStore, mergePlan, recordMastery, rememberGoal, validatePlan,
} from './graph.js'

export const name = 'dsh-talent-tree'
export const inject = ['tools', 'systemPrompt', 'sessionProjections']

const META_KIND = 'techtree/snapshot'
/** Authenticated read of the whole knowledge map for the left-Sidebar panel. */
export const LIBRARY_PATH = '/api/techtree/library'
const PROJECTION_KEY = 'techtree'

const TUTOR_PROMPT = `# Learning talent tree (techtree tools)

The learner keeps a personal "talent tree": a prerequisite graph of knowledge points shown in a sidebar, where mastered points light up like a game.

When the learner says they want to learn or understand something (e.g. "我想学会拉格朗日中值定理"):
1. Ask at most two quick diagnostic questions only if the right depth is unclear; otherwise plan right away.
2. Call techtree_plan with the goal and the knowledge points needed to truly understand it, each with its direct prerequisites. Include concepts, theorems, methods and the key proof ideas or tricks (for example "constructing an auxiliary function"). Go 2-4 layers deep, stopping at material a student at the learner's level surely knows. Reuse ids returned by earlier techtree calls for the same knowledge. A prerequisite must be strictly more basic than the node that needs it.
3. Tell the learner which nodes are learnable now and suggest where to start. Do not restate the whole tree; the sidebar shows it.

Every node gets a "hook": the single most intriguing formula, idea or question about it — the thing that makes a learner want to open it (e.g. "e^(iπ) + 1 = 0：五个最重要的数为什么能凑成一个等式？", "为什么点积大就说明两个向量'像'？"). One line, concrete, surprising.

Math notation: in node names, summaries and hooks, write every formula as LaTeX between single dollar signs, e.g. "缩放因子 $\\frac{1}{\\sqrt{d_k}}$", "$e^{i\\pi}+1=0$", "$\\mathrm{softmax}(x)_i=\\frac{e^{x_i}}{\\sum_j e^{x_j}}$"; the sidebar typesets it. Never write bare x_k or 1/√d outside dollars. If existing names, summaries or hooks show formulas without dollar signs (like 1/√d_k), rewrite those nodes through techtree_plan with the same ids. When techtree_view lists nodes marked no-hook, add hooks by calling techtree_plan again with those same nodes (same ids and prerequisites, plus hook).

Skip-ahead challenge: when the learner asks to skip ahead to a locked node, give one or two integrated questions that can only be solved by also knowing its key prerequisites. If they succeed, light the node and every prerequisite the answers clearly demonstrated (techtree_record per node, citing the answer as evidence); if not, say which prerequisite is missing and start there.

Writing for the learner: the summary is one or two plain sentences that someone who has learned only this node's prerequisites can follow. Say what the idea is in everyday words or with a tiny concrete example; when you say why the goal needs it, describe that later use in plain words, without symbols that later nodes introduce (not "理解缩放因子 1/√d_k 需要……" but "后面要回答'很多个随机数加起来，结果会大到什么程度'，这里学的方差就是答案"). Every symbol that appears in the node's name, summary or hook gets a glossary entry: the symbol as LaTeX in $…$ and its meaning in plain words with a typical value when one helps (e.g. term "$d_k$", meaning "每个查询/键向量里有多少个数（维度），常见是 64"). When techtree_view marks nodes plain-math or no-glossary, or a summary would confuse a learner at that point, rewrite those nodes through techtree_plan with the same ids.

Teaching a node: open with its hook, then intuition, then the precise statement, an example, common pitfalls, and one practice question. Prefer Socratic questions over lecturing.

Lighting a node: call techtree_record with level >= 1 ONLY after the learner has demonstrated understanding in this conversation — explaining it in their own words (Feynman check) or answering a check question correctly. Never light a node because the learner merely says they know it; quiz them first. Levels: 1 bronze = can state and explain it; 2 silver = explains why it holds or how it connects to its prerequisites; 3 gold = applies it correctly to a new problem. When an answer reveals a gap, call techtree_record on the prerequisite at fault with weak=true (keep its level) and repair that gap first.

Use techtree_view to read current progress, including review needs, before choosing what to teach next. Reply in the learner's language.`

/** Optional row config: { dataFile?: string } */
export function apply(ctx, config = {}) {
  const dataFile = typeof config?.dataFile === 'string' && config.dataFile !== ''
    ? config.dataFile
    : join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'techtree', 'knowledge.json')
  const store = createStore(dataFile)
  let projection
  const ready = ctx.sessionProjections.register({
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema: { parse: parseSnapshotOrNull },
    init: () => null,
    apply(state, event) {
      if (event.type !== 'tool/result') return state
      const meta = event.data?.meta
      if (meta === null || typeof meta !== 'object' || meta.kind !== META_KIND) return state
      return meta.snapshot ?? state
    },
    wire: {
      viewSchema: { parse: parseSnapshotOrNull },
      view: state => state,
      summary: false,
    },
  })
  ready.then(handle => { projection = handle }, error => ctx.logger?.warn?.('techtree projection unavailable', error))

  /** Goals this session's tree already shows, from its own log. */
  const sessionGoals = exec => {
    const session = exec?.agent?.session
    if (projection === undefined || session === undefined) return []
    try {
      return projection.stateOf(session)?.goals ?? []
    } catch {
      return []
    }
  }

  // Optional: the web/desktop connection serves an authenticated GET under /api.
  // Absent in headless runs, so it is injected on demand rather than required.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], scope => {
      scope.effect(() => scope.connection.fetch.register({
        path: LIBRARY_PATH,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: async () => new Response(JSON.stringify(buildLibrary(await store.read(), Date.now())), {
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
        }),
      }), `techtree: ${LIBRARY_PATH}`)
    })
  }

  ctx.effect(() => ctx.systemPrompt.section({ name: 'plugin:techtree', order: 9000, interpolate: false, text: TUTOR_PROMPT }))

  const register = definition => ctx.effect(() => ctx.tools.register(withSnapshotOutput(definition)))

  register({
    name: 'techtree_plan',
    description: 'Create or extend the learner\'s knowledge talent tree for a learning goal. Give the goal node and every knowledge point needed to understand it, each with its direct prerequisites (ids). Nodes merge into the learner\'s personal map: matching ids or names reuse existing nodes and keep their mastery.',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Id of the goal node; it must also appear in nodes.' },
        nodes: {
          type: 'array',
          description: 'Knowledge points, goal included. Prerequisites must be more basic than the node.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Stable lower_snake_case ASCII id, e.g. "rolle_theorem".' },
              name: { type: 'string', description: 'Display name in the learner\'s language, e.g. "罗尔定理"; formulas as LaTeX in $…$.' },
              type: { type: 'string', enum: NODE_TYPES, description: 'concept, theorem, method (technique), proof_idea, or skill.' },
              summary: { type: 'string', description: 'One or two plain sentences a learner who knows only the prerequisites can follow: what it is (everyday words or a tiny example) and, in plain words, why the goal needs it. No symbols from later nodes.' },
              glossary: {
                type: 'array',
                maxItems: GLOSSARY_MAX,
                description: 'Every symbol used in name, summary or hook, explained in plain words. Empty when there are no symbols.',
                items: {
                  type: 'object',
                  properties: {
                    term: { type: 'string', description: 'The symbol as LaTeX in $…$, e.g. "$d_k$".' },
                    meaning: { type: 'string', description: 'Plain-words meaning, with a typical value when it helps, e.g. "每个向量里有多少个数（维度），常见是 64".' },
                  },
                  required: ['term', 'meaning'],
                },
              },
              hook: { type: 'string', maxLength: HOOK_MAX, description: 'The most intriguing formula, idea or question about this point, to spark curiosity. One line; formulas as LaTeX in $…$.' },
              prerequisites: { type: 'array', items: { type: 'string' }, description: 'Ids of direct prerequisites only.' },
              est_minutes: { type: 'integer', description: 'Rough study time for a first pass.' },
            },
            required: ['id', 'name', 'type', 'summary', 'hook', 'prerequisites'],
          },
        },
      },
      required: ['goal_id', 'nodes'],
    },
    async execute(args, exec) {
      const plan = validatePlan(args)
      let outcome
      const next = await store.update(current => {
        outcome = mergePlan(current, plan)
        return rememberGoal(outcome.store, outcome.goal, Date.now())
      })
      const goals = upsertGoal(sessionGoals(exec), outcome.goal)
      const snapshot = buildSnapshot(next, goals, Date.now())
      const notes = []
      const remaps = Object.entries(outcome.remapped)
      if (remaps.length) notes.push(`Merged into existing nodes (use these ids from now on): ${remaps.map(([a, b]) => `${a} -> ${b}`).join(', ')}`)
      const known = snapshot.nodes.filter(n => n.mastery >= 1).map(n => n.name)
      if (known.length) notes.push(`Already lit from earlier study: ${known.join(', ')}`)
      return { text: [`Planned "${outcome.goal.name}": ${outcome.added.length} new, ${outcome.merged.length} reused.`, ...notes, describeSnapshot(snapshot, Date.now())].join('\n'), snapshot }
    },
  })

  register({
    name: 'techtree_record',
    description: 'Record the learner\'s verified mastery of one knowledge point. Level 1-3 lights it (bronze: explains it; silver: explains why/connections; gold: applies it to new problems); 0 un-lights it. Only after the learner demonstrated it in this conversation. Set weak=true when an answer exposed a gap in this node.',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'Id of the knowledge point.' },
        level: { type: 'integer', enum: [0, 1, 2, 3], description: '0 none, 1 bronze, 2 silver, 3 gold.' },
        weak: { type: 'boolean', description: 'True when the learner showed a gap here that needs reinforcement.' },
        evidence: { type: 'string', description: 'What the learner said or did that justifies this judgement.' },
      },
      required: ['node_id', 'level', 'evidence'],
    },
    async execute(args, exec) {
      const now = Date.now()
      const next = await store.update(current => recordMastery(current, args, now))
      const node = next.nodes[args.node_id]
      let goals = sessionGoals(exec)
      if (goals.length === 0) goals = [{ id: node.id, name: node.name }]
      const snapshot = buildSnapshot(next, goals, now)
      const verb = args.level >= 1 ? `Lit "${node.name}" at level ${args.level}` : `Set "${node.name}" to unlit`
      return { text: `${verb}${args.weak ? ' (marked weak)' : ''}.\n${describeSnapshot(snapshot, now)}`, snapshot }
    },
  })

  register({
    name: 'techtree_view',
    description: 'Show the current talent tree for this conversation: every node with its state (lit level, learnable, locked, weak, fading/needs review). Pass goal_id to bring an existing goal from the learner\'s map into this conversation.',
    parameters: {
      type: 'object',
      properties: {
        goal_id: { type: 'string', description: 'Optional id of an existing node to show as a goal.' },
      },
    },
    async execute(args, exec) {
      const current = await store.read()
      let goals = sessionGoals(exec)
      if (typeof args?.goal_id === 'string') {
        const node = current.nodes[args.goal_id]
        if (node === undefined) throw new Error(`unknown node "${args.goal_id}"`)
        goals = upsertGoal(goals, { id: node.id, name: node.name })
      }
      if (goals.length === 0) {
        const all = Object.values(current.nodes)
        const text = all.length === 0
          ? 'This conversation has no talent tree yet and the learner\'s map is empty. Use techtree_plan.'
          : `This conversation has no talent tree yet. The learner's map has ${all.length} nodes (${all.filter(n => n.mastery >= 1).length} lit). Pass goal_id to show one, or use techtree_plan.`
        return { text, snapshot: null }
      }
      const now = Date.now()
      const snapshot = buildSnapshot(current, goals, now)
      return { text: describeSnapshot(snapshot, now), snapshot }
    },
  })
}

function upsertGoal(goals, goal) {
  return goals.some(g => g.id === goal.id) ? goals : [...goals, goal]
}

/** Add the shared canonical output: model sees `text`, the session log keeps `snapshot` as meta. */
function withSnapshotOutput(definition) {
  return {
    ...definition,
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          snapshot: { description: 'Complete talent-tree snapshot for this session, or null.' },
        },
        required: ['text', 'snapshot'],
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
      presentationMeta: (_args, value) => (value.snapshot === null ? null : { kind: META_KIND, snapshot: value.snapshot }),
    },
  }
}

/** Loose structural check: projection state is plain JSON written by this plugin. */
function parseSnapshotOrNull(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || !Array.isArray(value.goals) || !Array.isArray(value.nodes)) {
    throw new Error('invalid techtree snapshot')
  }
  return value
}

/** The personal knowledge map: one JSON file, writes serialized and atomic. */
function createStore(file) {
  let cache
  let chain = Promise.resolve()
  const load = async () => {
    if (cache !== undefined) return cache
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      cache = parsed && typeof parsed.nodes === 'object' ? parsed : emptyStore()
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`cannot read talent tree data at ${file}: ${error.message}`)
      cache = emptyStore()
    }
    return cache
  }
  return {
    read: () => chain.then(load),
    update(change) {
      const run = chain.then(async () => {
        const next = change(await load())
        await mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.${process.pid}.tmp`
        await writeFile(tmp, JSON.stringify(next, null, 1), 'utf8')
        await rename(tmp, file)
        cache = next
        return next
      })
      chain = run.catch(() => {})
      return run
    },
  }
}
