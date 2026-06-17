# The Keystone Algorithm

How `rank_keystones` decides which ticket has the most leverage. Implemented in
[`src/graph/keystone.ts`](../src/graph/keystone.ts).

## What "keystone" means

> The keystone is the ticket that, once done, unblocks the most downstream work —
> the one that **every** downstream path must pass through.

The precise question is *gatekeeping*, not *count of things downstream*. A
ticket that 20 other tickets can reach by various paths is less of a
single-point-of-leverage than a ticket that 5 tickets can reach **only** through
it. The first is a hub; the second is a keystone. Formalizing "every path must
pass through it" is exactly **graph dominance**.

## Dominators vs. reachability

In a directed graph with a single entry, node **D dominates** node **N** if every
path from the entry to N goes through D. The set of nodes a ticket dominates is
the work that *cannot proceed* until that ticket is done.

Contrast with **reachability** — the count of nodes you can reach following
edges. Reachability counts everything downstream, including work reachable by
other routes too; dominance counts only the work you genuinely gate.

### Worked counter-example (why this distinction is the whole point)

```
a ─▶ x        x ─▶ c
b ─▶ x        x ─▶ d
              x ─▶ e
```

`a` and `b` are independent starting points; both feed into `x`; `x` feeds
`c`, `d`, `e`.

- **Reachability of `a`** = {x, c, d, e} = 4. `a` *reaches* a lot.
- **Dominance of `a`** = ∅. Removing `a` from "must be done first" doesn't gate
  c/d/e — they can still be reached via `b → x`. So `a` dominates nothing.
- **Dominance of `x`** = {c, d, e} = 3. Every path to c/d/e runs through `x`.

So `x` is the keystone with leverage 3, while `a` — despite higher reachability —
has leverage 0. A reachability-based ranking would wrongly crown `a`. This exact
graph is a test case in `keystone.test.ts`.

## The algorithm, step by step

### 1. Build the flow graph with a virtual entry

A dominator tree needs a single entry node. The "ready to start" tickets are the
**sources** — issues with in-degree 0 in the blocking graph (nothing blocks
them). We add a synthetic `__ENTRY__` node with an edge to every source:

```
__ENTRY__ ─▶ (every ticket with no blockers)
```

This unifies disconnected dependency chains under one root so dominance is
well-defined for the whole project. (A guard throws if a real Linear issue id
ever equals `__ENTRY__`, preventing silent corruption.)

### 2. Compute the dominator tree (Cooper–Harvey–Kennedy)

We use the iterative algorithm from Cooper, Harvey & Kennedy, *"A Simple, Fast
Dominance Algorithm"* — chosen for being compact (~60 lines), dependency-free,
and tolerant of arbitrary flow graphs (including back-edges from cycles).

Sketch (`computeIdom`):

1. DFS from `__ENTRY__` to assign each node a **postorder** number (entry gets
   the highest).
2. Initialize `idom[entry] = entry`; all others undefined.
3. Iterate nodes in **reverse postorder** until a fixed point: for each node,
   set its immediate dominator to the running `intersect` of all already-processed
   predecessors.
4. `intersect(a, b)` walks the two "fingers" up the partial dominator tree —
   repeatedly replacing the lower-postorder finger with its `idom` — until they
   meet. That meeting point is the nearest common dominator.

The result is `idom`: each node's immediate dominator. The dominator **tree** is
the parent relation `n → idom[n]`.

### 3. Leverage = dominated-subtree size

A node's full dominated set is all of its descendants in the dominator tree.
`computeDominated` walks the tree iteratively (explicit stack — no recursion, so
deep chains can't overflow) and records, for each node, the list of tickets it
dominates. **Leverage is the size of that list** (excluding the node itself).

### 4. Rank, with a reachability tiebreak

`ranked` is sorted by `leverage` descending, breaking ties by `reachable`
(transitive descendant count) descending. Leverage answers "how much do you
gate"; reachability is a reasonable secondary "how much is downstream at all."

Each `KeystoneEntry` carries `dominates` (the human identifiers of the gated
tickets), so the tool can render:

> `ENG-1 "Auth refactor" — leverage 3: every path to ENG-2, ENG-3, ENG-4 passes
> through it.`

The explanation is generated directly from the dominator-tree structure — it is
not a separate heuristic bolted onto a score.

## Edge cases

### Cycles
Blocking relations shouldn't cycle, but they can. Before the dominator pass,
`detectCycle` runs Kahn's topological sort; any nodes left with non-zero
in-degree are reported in a **warning** listing the cycle members. The dominator
algorithm still runs (CHK tolerates back-edges). Nodes trapped in a pure cycle
with no source-reachable path get no `idom` and therefore **leverage 0** — the
warning is the signal that the graph has a structural problem.

### Isolated tickets
Tickets with no blocking relations at all (in- and out-degree 0) are collected
in `isolated`, reported as "Ungrounded (no dependency signal)," and excluded from
the ranked lines (they'd just be leverage-0 noise).

### Empty / no-relation projects
If there are no edges, the algorithm short-circuits with a "No dependency
structure found" warning rather than returning a meaningless all-zero ranking.

## Complexity

For a project with **V** tickets and **E** blocking relations:

- Graph build: **O(V + E)**.
- Dominator tree (iterative CHK): near-linear in practice,
  **O(V·E)** worst case — irrelevant at Linear-project scale (tens of tickets).
- Dominated-subtree sizes: **O(V)** over the dominator tree.
- Reachability per node for the tiebreak: **O(V·(V + E))** worst case.

At the target scale (10–40 tickets) the whole analysis is effectively instant;
the dominant cost of a tool call is the Linear API round-trip.

## Worked verification (bypass graph)

A second test (and an independent review) checks a graph where dominance and
reachability diverge through a bypass:

```
a ─▶ b ─▶ d ─▶ e
a ─▶ c ─▶ d
f ─▶ e            (f is a second source)
```

- `idom(d) = a` → `a` dominates {b, c, d} → **leverage(a) = 3**.
- `e` is reachable via `a → … → d → e` **and** `f → e`, so `idom(e) = __ENTRY__`
  → **no real ticket dominates `e`**, and `leverage(e) = 0`.
- `a.reachable = 4` ({b, c, d, e}) but its leverage is 3 — `e` is reachable from
  `a` yet not gated by it, because `f` bypasses `a` entirely.

This is the property that makes the metric meaningful: leverage tracks genuine
gatekeeping, which a bypass correctly erases.

## Relationship to "critical path"

Keystone (dominance) answers *"max leverage unlock."* It is **not** the same as
the critical path (weighted CPM over estimates), which answers *"what sets total
duration."* A ticket can be the keystone without being on the critical path and
vice-versa. `critical_path` is a separate planned output, not a variant of this
algorithm — they are surfaced side by side, not merged.
