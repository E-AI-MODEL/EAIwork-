<p align="center">
  <img src="docs/assets/eai-work-hero.svg" alt="EAI work: evidence-first work graph" width="100%">
</p>

# EAI work

**Split work into the smallest checkable questions. Keep evidence and its origin visible. Derive status instead of editing it.**

EAI work is an experimental evidence-first workbench. AI may propose an answer or flag a problem. It may not raise the status of its own output. Stronger status comes from person-attached evidence, independent origins or deterministic non-LLM checks.

> [!IMPORTANT]
> **Research status:** v0.1 is a working skeleton, not a validated method. The central claim that bottom-up assembly from verified atoms is more reliable or inspectable than top-down generation is still untested. Research claims and our own design claims are separated in `evidence/bibliography.yaml`.

## What it looks like

The browser workbench is built around the parts that matter during review:

- a **work graph** grouped by cluster;
- a visible **status distribution**, never one aggregate score;
- **dependency markers** on each atomic question;
- a separate **evidence inspector** with observer, source, lineage and validity;
- a **review queue** for rule flags, weak prerequisites and coverage prompts;
- an **append-only log integrity** indicator.

<p align="center">
  <img src="docs/assets/status-ladder.svg" alt="EAI work evidence status ladder" width="100%">
</p>

## The model

Every job is described as a pack of **atoms**. An atom is one question with one typed answer. `unknown` is always valid.

Status follows this ladder:

`unknown → assumption → claim → observed → checked → proven`

The transition is asymmetric. A model answer can create an assumption. A person report can create a claim. First-hand observation can create observed status. Independent origins can create checked status. A deterministic check can create proven status. Status is recalculated from the event log and current evidence each time.

## System shape

```text
pack.json
   │
   ├── atoms + dependencies + rules
   │
   ▼
append-only event log ──► replay ──► derived atom state
        ▲                              │
        │                              ├── distributions
person / model / check                 ├── review signals
                                       └── evidence inspector
```

The core package has no network access. The server owns actor identity, event ids and time. Attempts to bypass status rules are rejected and stay observable through the event flow.

## Quickstart

Requires Node `22.18+`. No runtime dependencies are required.

```bash
npm test
npm run lint:pack
npm run replay:demo
cp tokens.example.json tokens.json
EAI_TOKENS=tokens.json npm run serve
```

Open `http://localhost:8787` and use one of the development tokens from `tokens.example.json`.

Useful CLI commands:

```text
eai lint-pack <pack.json>
eai replay <pack.json> <events.jsonl>
eai explain <pack.json> <events.jsonl> <atom>
eai report <pack.json> <events.jsonl> [goal-atom,...]
eai agree <answersA.json> <answersB.json>
eai verify-log <data-dir>
```

## Repository map

| Path | Purpose |
|---|---|
| `packages/core` | Derivation, validation, replay, rules, analysis and agreement. No network. |
| `packages/server` | Token-derived identity, hash-chained event storage and HTTP API. |
| `packages/client` | Dependency-free evidence-first workbench. |
| `packages/gateway` | Typed model interface. Mock provider only in v0.1. |
| `packages/cli` | Pack linting, replay, explanation, reports, agreement and log verification. |
| `schema/v0.1` | Draft JSON Schema. Not yet enforced in code. |
| `conformance` | Behavioral vectors any compatible implementation should pass. |
| `packs` | Example packs. Current data is invented demo data. |
| `evidence` | Research bibliography with a source type for every claim. |
| `proposals` | Design proposals. |
| `docs` | Architecture and interface notes. |

## Guarantees in v0.1

- **Derived status:** no actor edits status directly.
- **Model asymmetry:** models may not raise status or impersonate a person.
- **Lineage-aware independence:** duplicate origins do not count as independent confirmation.
- **Deterministic proof:** `proven` requires a deterministic check path.
- **Replayable state:** state is rebuilt from an append-only hash-chained log.
- **Separate status counts:** reporting keeps atom statuses separate instead of collapsing them into one score.
- **Review wording:** no flags means “not detected”, not “safe”.

The normative behavior lives in `conformance/vectors/`. If this README, the specification and a conformance vector disagree, the mismatch should be fixed explicitly in a PR.

## Current limits

Not built yet: a real model provider, production authentication, a database, schema enforcement at runtime, pack authoring UI, user testing, a second domain pack and the planned top-down versus bottom-up comparison.

## Interface direction

The repository presentation and workbench borrow only **presentation patterns** from strong contemporary AI repositories: a concise first screen, a system diagram before deep documentation, progressive disclosure, visible operational status and short paths from concept to runnable example. EAI work uses its own copy, diagrams, colors and information model. See `docs/interface-notes.md` for the references and translation choices.
