# Interface notes

Reviewed 2026-10-05. This note records presentation references, not product or technical dependencies.

## What was studied

The following public repositories were reviewed for README and interface structure:

- `openai/openai-agents-python`: immediate product statement, a large orchestration visual, core concepts and then runnable setup.
- `microsoft/agent-framework`: banner first, “is this right for you?”, feature grouping, progressive tutorial structure and a clear split between framework concepts and samples.
- `langchain-ai/langgraph`: restrained hero, one-sentence positioning, a compact “why” section and links that separate conceptual docs from API reference.
- `browser-use/browser-use`: visual-first product map, explicit paths for different users and architecture/benchmark visuals placed close to the claim they support.
- `crewAIInc/crewAI`: strong visual identity, product concept grouping and progressive onboarding.

No text, logos, illustrations or product claims from these repositories are copied into EAI work.

## Translation to EAI work

### 1. One sentence before detail

EAI work now leads with the actual operating rule: work is split into checkable questions and status follows evidence. The research caveat remains visible directly underneath rather than being buried in roadmap text.

### 2. System visual before implementation detail

The README opens with an original work-graph illustration. It explains atoms, dependencies and evidence lineage before the directory map or CLI commands.

### 3. The UI mirrors the information model

The browser client no longer looks like a generic card list. Its major regions correspond directly to the model:

- status distribution;
- clusters and atoms;
- dependencies;
- evidence trace;
- review signals;
- event-log integrity.

### 4. Statuses stay separate

There is no gauge, percentage-complete score or aggregate progress headline. EAI work keeps all six statuses separate. Counts are allowed; one aggregate score is not.

### 5. Evidence gets a dedicated reading surface

Selecting an atom opens a persistent inspector. Reasons, evidence source, observer, lineage, support/contradiction, validity and dependencies are shown separately. This prevents provenance from becoming tooltip-only metadata.

### 6. Progressive disclosure

The landing state explains the method in a small amount of text. The authenticated workbench starts with the overall distribution, then exposes cluster details, then atom evidence. Deep technical material stays in docs and the CLI.

## Visual rules

- Neutral surfaces and thin borders. Status colors do the semantic work.
- Status colors are consistent in bars, pills and nodes.
- Typography carries hierarchy; decoration stays secondary.
- Responsive layout collapses the inspector under the work graph on narrow screens.
- No external JavaScript, CSS framework or image dependency is required by the client.
