# EAI work specification (v0.1 draft)

Labels used everywhere: **[research]**, **[our design]**, **[untested]**.

1. **Atoms.** One question, one typed answer (yes/no, fixed choice, short score), answerable by one observer. "unknown" is always allowed.
2. **Status ladder.** unknown < assumption < claim < observed < checked < proven. Status is derived from current evidence, never edited.
3. **Evidence.** Each item has observer, mode (reported/observed), lineage, supports flag, optional validity.
4. **Asymmetry rule.** A model may propose and flag. It may not raise status. Raises come from person-attached evidence, independent origins, or deterministic non-LLM checks.
5. **Independence.** Two items are independent only if their lineages differ.
6. **Events.** All state is a replay of an append-only, hash-chained log. Identity and time are set by the server.
7. **Rules.** Data-driven conditions (all/any/not on atom status and value). No eval, no model calls.
8. **Reporting.** Distribution per cluster, never a single score. "Nothing flagged" means not detected.
9. **Packs.** Clusters, atoms, dependencies, validity, rules. Linted before use.

The normative behavior is defined by `conformance/vectors/`. If this text and the vectors disagree, fix one of them in a PR.
