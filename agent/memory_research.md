# Memory Architecture Research

A consolidated reference on long-term memory architectures for LLM agents, captured
while deciding how Krypto's memory layer should evolve.

**Status / decision:** Krypto stays on a single append-only `memory.md` for now. At
the current single-user scale a flat file is effective and cheap. This document
records the target design to evolve toward when memory volume makes append-only
contradictions and retrieval cost a real problem. No implementation is planned yet.

---

## 1. The three production patterns

A recent survey (arXiv:2603.07670) collapses agent memory into three recurring
patterns:

- **Pattern A — Monolithic in-context.** All memory lives in the prompt. Krypto's
  current append-only `memory.md` is a degenerate case. Breaks down as it grows.
- **Pattern B — Context window + external retrieval store.** Working memory in
  context, durable memory in an external store you query. Described as *"the
  workhorse pattern behind most production agents today."* mem0, Zep/Graphiti, and
  Cognee are all Pattern B.
- **Pattern C — Tiered memory with a learned controller.** The agent pages memory
  between tiers itself (MemGPT). More machinery than a single-user assistant needs.

---

## 2. The five approaches

The two axes that distinguish these systems most are **how memory is stored** and
**when memory is read/written** (the retrieval/ingestion trigger).

### Vocabulary

**Retrieval triggers** (when memory is *read*):
- *Bootup / always-on* — fixed block injected into the system prompt at session start
  (Krypto's current `.md` approach).
- *Automatic per-turn* — the framework retrieves before every LLM call, invisibly.
- *Agent-driven (tool)* — memory is a search tool; the agent decides when to call it.
- *Hybrid* — small always-on core + dynamic retrieval for the long tail.

**Ingestion triggers** (when memory is *written*): *passive* (store raw, no
processing) vs *active/LLM-mediated* (extract + reconcile), and *inline* / *async* /
*batch* in timing.

### Per-system breakdown

| System | Store type | What's stored | Conflict handling |
|---|---|---|---|
| Full-context | none (prompt) | raw transcript | none |
| RAG | vector DB | raw chunks | none (append-only) |
| mem0 | vector DB (+opt. graph) | **extracted facts** | LLM ADD/UPDATE/DELETE/NOOP |
| Graphiti/Zep | **graph DB** | entities + temporal edges | temporal invalidation |
| Cognee | graph + vector + relational | docs→chunks→entities | graph resolution |

| System | Ingestion | Retrieval trigger |
|---|---|---|
| Full-context | passive append | everything, every turn |
| RAG | passive (embed only) | automatic per-turn |
| mem0 | **active 2-phase LLM** | automatic per-turn |
| Graphiti/Zep | active incremental (background) | automatic per-turn (hybrid) |
| Cognee | active pipeline (batch/incr.) | automatic, query-driven |

**Full-context** — no memory system. The entire transcript is re-sent every turn.
Highest fidelity, simplest, but token cost grows linearly and it dies at the
context-window limit. The baseline every memory system tries to beat on cost.

**RAG** — raw conversation chunks embedded into a vector store; passive write (no LLM
in the write path, which is why it's cheapest); automatic top-k retrieval per turn.
Smart-ish retrieval over dumb, append-only storage. Never resolves contradictions.

**mem0** — stores *extracted facts* (not raw turns) with metadata, plus a change
history. Active two-phase write: (1) an LLM extracts salient facts each turn; (2) for
each fact it retrieves the top-s similar existing memories and an LLM picks
**ADD / UPDATE / DELETE / NOOP** — this reconcile step is what makes it
self-improving and non-append. Optional graph variant (Mem0g). Automatic per-turn
retrieval.

**Graphiti / Zep** — a temporal knowledge graph in a graph DB (Neo4j / FalkorDB).
Nodes = entities, edges = facts with **bi-temporal** metadata (valid time vs recorded
time). On contradiction it does not delete; it **closes the old edge's validity
window** (`valid_to`), preserving history. Hybrid retrieval (embeddings + BM25 +
graph traversal). Best for relational/temporal reasoning; pricier and overkill for
one user.

**Cognee** — an ETL-for-memory framework (Extract → Cognify → Load) producing a
knowledge graph + embeddings + relational records across backends. More
document/knowledge-base oriented than conversational. Most flexible, most setup.

---

## 3. Conflict resolution — the unsolved part

The single most decision-relevant finding: **every named self-improving system
substantially underperforms at freshness/supersession** — the exact capability that
motivates moving beyond append-only.

On MemoryAgentBench's FactConsolidation task (agents explicitly told newer facts
supersede older ones):

| System | Single-hop FactConsolidation |
|---|---|
| HippoRAG-v2 | 54% |
| BM25 | 48% |
| Cognee | 28% |
| **mem0** | **18%** |
| **Zep / Graphiti** | **7%** |

On multi-hop, all 22 tested systems score in single digits (≤7%). (arXiv:2606.01435,
built on MemoryAgentBench arXiv:2507.05257.)

**Implication for Krypto:** conflict handling is *not* a solved capability you can
adopt from a library — it is the frontier. The write-path techniques that do exist
(survey §7.3) are: **temporal versioning** (prefer newest), **source attribution**
(user statement > agent inference), **explicit contradiction detection**, and
**periodic consolidation**. A *purpose-built* simple rule for one user could
plausibly beat the general libraries here.

---

## 4. Benchmarks used to evaluate memory architectures

- **LoCoMo (Long Conversational Memory)** — the most common benchmark. Long
  multi-session conversations with QA across categories: single-hop, multi-hop,
  temporal, open-domain, and adversarial (Category 5). Scored by LLM-as-judge or F1.
  **Heavily contested:** scores are *not comparable across papers* (mem0 self-reports
  ~92.5%; an independent testbed measures 81.08%; Zep figures ranged 58–95%) due to
  differing judge prompts, configs, and a disputed Category-5 scoring rule (see the
  public Mem0-vs-Zep dispute, getzep/zep-papers issue #5). Never treat a single
  LoCoMo number as canonical.
- **MemoryAgentBench** (arXiv:2507.05257) — multi-system benchmark; its
  **FactConsolidation** task is the freshness/supersession test in §3 and is the best
  proxy for the conflict-resolution capability Krypto cares about.
- **MemoryArena** (arXiv:2602.16313) — *agentic, decision-relevant* memory tasks.
  Models that score near-perfectly on LoCoMo **drop to 40–60%** here, exposing the gap
  between passive recall and active memory use. The main reason not to over-index on
  LoCoMo leaderboards.

**Takeaway:** LoCoMo measures recall and overstates real capability; FactConsolidation
and MemoryArena are more faithful for an assistant. Best practice for Krypto would be
a small *custom* eval built around real usage (especially supersession cases, e.g.
"I moved to Dubai" after "I live in London").

---

## 5. Target design for Krypto (when we scale)

The design we converged on — faithfully mem0's, minus auto-extraction, plus an
always-on core an assistant wants. Two independent knobs:

- **Write trigger** — *who* decides to write. Krypto uses **agent-driven** (the
  existing `remember` tool), not mem0's auto-extract-every-turn. Cheaper and
  higher-precision for one user; risk is *silent misses*, mitigated later by a cheap
  periodic background sweep.
- **Write semantics** — *what* happens on write. This is mem0's real magic and the
  part that makes memory non-append. The `remember` write path becomes a reconcile:

```
remember(fact):
  1. embed(fact) -> top-k similar existing memories
  2. LLM sees (fact, those k memories) -> ADD | UPDATE | DELETE | NOOP
  3. apply, with a timestamp + source tag (user vs agent)
```

Converged shape:
- **Read:** automatic top-k semantic retrieval over *facts* on each message
  (mem0-flavored, not raw-chunk RAG) + an always-on core (identity / user profile /
  a few high-salience facts) kept in the system prompt.
- **Write:** agent-driven trigger + reconcile semantics (ADD/UPDATE/DELETE/NOOP) +
  temporal versioning + source attribution.

**Infra consequence:** `memory.md` becomes an embedded store (facts + embeddings —
SQLite + a vector extension, or pgvector, or an in-memory index at this scale).
`memory.md` can remain a human-readable mirror regenerated from the store, but the
queryable source of truth moves to embeddings.

**Cost note (single-user):** skip the graph variant — Mem0g costs ~2× tokens for ~2%
LoCoMo gain. Plain vector + an explicit conflict path is the right altitude.

---

## References

Independent / third-party benchmarks (most trustworthy, cited first):

- **Independent testbed of mem0, RAG, full-context, Graphiti, Cognee on LoCoMo** —
  Wolff & Bennati, arXiv:2601.07978. Neutral LLM-as-judge over 7,626 questions.
  Accuracy: mem0 81.08%, RAG 78.31%, full-context 77.16%, Graphiti 56.03%, Cognee
  55.27%. Total cost of ownership: RAG $0.65, Cognee $2.99, mem0 $5.43, Graphiti
  $6.95, full-context $10.22 (one GPT-4o-mini/AWS config — not universal).
- **MemoryAgentBench** (FactConsolidation freshness task) — arXiv:2507.05257.
- **Freshness/supersession cross-system evaluation** — arXiv:2606.01435.
- **MemoryArena** (agentic memory benchmark) — arXiv:2602.16313.
- **Survey / taxonomy** — arXiv:2603.07670.

Primary system papers (vendor-authored where noted):

- **mem0** — arXiv:2504.19413 (vendor-authored; accuracy/latency self-reported vs a
  deliberately naive full-context baseline).
- **Zep / Graphiti** — arXiv:2501.13956 (bi-temporal knowledge graph).
- **FadeMem** (forgetting-oriented; four-category conflict classifier) —
  arXiv:2601.18642 (non-peer-reviewed preprint).
- **Mem0-vs-Zep LoCoMo scoring dispute** — github.com/getzep/zep-papers/issues/5.

**Caveats.** This is a fast-moving field; several sources are recent, non-peer-reviewed
preprints. mem0's own numbers are self-reported. LoCoMo scores are non-comparable
across papers. The most important caveat: no existing system reliably solves
freshness-based conflict resolution, so Krypto must design and test for it explicitly
rather than assume a library handles it.
