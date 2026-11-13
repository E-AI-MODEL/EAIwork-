# Security

The highest-priority class of bug is **any way for a model, user or untrusted client to raise evidence status beyond what the trusted evidence path allows**.

Do not publish exploit details in a public issue. Use GitHub private vulnerability reporting for this repository when available. If it is not available, contact the repository owner through GitHub and ask for a private reporting channel.

Confirmed bypass sequences are added to `conformance/vectors/` as rejection cases.

## Trust boundaries

- Actor identity and authorization come from the server-side principal map, never from the request body.
- Read/write/check/worker/audit permissions are explicit and default-deny. Write scope must stay inside read scope.
- State and derived metadata are filtered before being returned, so hidden atoms do not leak through dependencies, rule output, checksums or audit counters. Global rejection counts are exposed only when the principal can read every atom.
- Deterministic checks declare their input atoms. The caller must be allowed to read all inputs and the check receives only that scoped state, preventing check results from becoming an oracle over hidden atoms.
- Public API tokens may not represent model actors. Model events are produced only by server-owned worker execution.
- Atom workers receive server-built `AtomCapsule` objects only: local question, fixed options, aliased values of declared dependencies and bounded snippets from declared source handles.
- Worker HTTP calls accept no prompt/context payload. The source broker receives only an opaque handle, never the pack or target atom.
- Every atom execution opens a fresh single-use model session. Direct worker-to-worker messaging, shared scratchpads and swarm blackboards are outside the worker API.
- Worker execution is a separate capability from read/write access. An execute-only scheduler can run atoms without seeing `/state` or writing `/events`; completed worker calls return bodyless 204 responses and do not reveal model output or internal acceptance/rejection.
- Global event sequence/hash receipts are returned only to principals with `audit: true` and read access to every atom. Scoped writers and scoped check runners receive no global sequence metadata.
- HTTP-issued event, evidence and flag identifiers are opaque random UUID-based IDs, not global event sequence counters. Internal log sequence numbers stay available for audit and integrity verification.
- If a principal can read a worker target, it must also be allowed to read every dependency value declared in that worker policy. Otherwise worker execution is denied, preventing a readable target from becoming an oracle over hidden inputs.
- Public `/events` requests cannot create `check.passed` events.
- Evidence origin is derived by the server: from a registered pack source the actor cites (`source_ref`), otherwise from actor identity with the origin marked unverified. Client-supplied lineage, origin flags, check basis and `deterministic` are ignored. An unverified origin can never count as corroboration.
- A source that feeds a worker is visible and citable only to principals who can read an atom it feeds. An unknown source and an unavailable source are refused with the same message.
- Two supporting items corroborate each other only when origin and observer both differ. One actor cannot reach `checked` alone, and several actors cannot reach it from one source.
- `proven` can only be reached through a deterministic check registered inside the server process, and only when that check is grounded: it declares a registered source, or every other atom it read is first-hand or stronger, or independent evidence stands beside it. A check that only re-reads its own target is not counted. Whoever registers a check and declares its sources vouches for that declaration; the server cannot verify what the check code consults.
- The server records the atom values a check read. The check stops supporting when one changes. `/explain` returns that basis and a worker proposal's inputs filtered to atoms and sources the reader may see.
- Accepted bounded disclosure: because status is the same for every reader, a reader of a check target learns *whether* the check's recorded inputs still hold and whether its premises are first-hand, never which atoms they are or their values. The `proposal-outdated` signal is shown only to readers who can see every compared input.
- The server refuses to start when its event log fails integrity verification.
- Event and rejection heads are signed with Ed25519 and appended to cryptographically chained witness journals outside the datastore. Rewriting both a log and its local head is not sufficient to hide rollback while the witness store itself is not rolled back.
- Normal request writes use cached verified heads plus file fingerprints. Full log and witness scans are reserved for startup/audit or triggered automatically after external file changes, preventing rejection traffic from making verification work grow quadratically.
- The server holds an exclusive writer lock for the lifetime of the process. `EAI_DIR` is restricted to `0700`, tracked files to `0600`, and the witness directory to `0700`. Run the service under a dedicated OS account; another process with direct write access as that same account is a host compromise and is outside the supported multi-writer model.
- The signing private key must not live in the datastore or witness directory. The witness store should be on separate, rollback-resistant storage. A host-level attacker with the signing key or control of both rollback domains remains outside this threat model.
- Direct server startup requires an explicit token file and binds to `127.0.0.1` unless `EAI_HOST` is set deliberately.

- Review signals (`needs-person`, `confidence-lowered`) and answer provenance are derived views. They are filtered to the atoms a principal may read and never feed back into status.
- No public HTTP path produces `confidence.lowered` or a model-raised flag today: model actors hold no tokens and the worker route writes answers only. Those event types exist in the core and in replayed logs.

Legacy events without an explicit registered `source_ref` do not corroborate, even if they have distinct actor IDs or lineages. The Docker codeplan proof is bound to a full SHA-256 manifest of explicitly planned source and test files and is checked again on every read. It does not grant runtime rights, publication rights or semantic `proven` status to unrelated atoms.

Other sensitive areas: token handling, evidence provenance, log integrity, request-size limits, source-handle scope, provider-side session reuse and injection through evidence text.
