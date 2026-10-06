# Security

The highest-priority class of bug is **any way for a model, user or untrusted client to raise evidence status beyond what the trusted evidence path allows**.

Do not publish exploit details in a public issue. Use GitHub private vulnerability reporting for this repository when available. If it is not available, contact the repository owner through GitHub and ask for a private reporting channel.

Confirmed bypass sequences are added to `conformance/vectors/` as rejection cases.

## Trust boundaries

- Actor identity and authorization come from the server-side principal map, never from the request body.
- Read/write/check/worker/audit permissions are explicit and default-deny. Write scope must stay inside read scope.
- State and derived metadata are filtered before being returned, so hidden atoms do not leak through dependencies, rule output, checksums or audit counters.
- Deterministic checks declare their input atoms. The caller must be allowed to read all inputs and the check receives only that scoped state, preventing check results from becoming an oracle over hidden atoms.
- Public API tokens may not represent model actors. Model events are produced only by server-owned worker execution.
- Atom workers receive server-built `AtomCapsule` objects only: local question, fixed options, aliased values of declared dependencies and bounded snippets from declared source handles.
- Worker HTTP calls accept no prompt/context payload. The source broker receives only an opaque handle, never the pack or target atom.
- Every atom execution opens a fresh single-use model session. Direct worker-to-worker messaging, shared scratchpads and swarm blackboards are outside the worker API.
- Worker execution is a separate capability from read/write access. An execute-only scheduler can run atoms without seeing `/state` or writing `/events`; completed worker calls return bodyless 204 responses and do not reveal model output or internal acceptance/rejection.
- If a principal can read a worker target, it must also be able to read every declared worker input before executing that worker. This prevents the readable target from becoming an oracle over hidden dependencies.
- If a principal can read a worker target, it must also be allowed to read every dependency value declared in that worker policy. Otherwise worker execution is denied, preventing a readable target from becoming an oracle over hidden inputs.
- Public `/events` requests cannot create `check.passed` events.
- Person/system evidence lineage is derived by the server from actor identity. Client-supplied lineage is ignored.
- `proven` can only be reached through a deterministic check registered inside the server process.
- The server refuses to start when its event log fails integrity verification.
- Event and rejection heads are signed with Ed25519 and appended to cryptographically chained witness journals outside the datastore. Rewriting both a log and its local head is not sufficient to hide rollback while the witness store itself is not rolled back.
- Normal request writes use cached verified heads plus file fingerprints. Full log and witness scans are reserved for startup/audit or triggered automatically after external file changes, preventing rejection traffic from making verification work grow quadratically.
- The server holds an exclusive writer lock for the lifetime of the process. `EAI_DIR` is restricted to `0700`, tracked files to `0600`, and the witness directory to `0700`. Run the service under a dedicated OS account; another process with direct write access as that same account is a host compromise and is outside the supported multi-writer model.
- The signing private key must not live in the datastore or witness directory. The witness store should be on separate, rollback-resistant storage. A host-level attacker with the signing key or control of both rollback domains remains outside this threat model.
- Direct server startup requires an explicit token file and binds to `127.0.0.1` unless `EAI_HOST` is set deliberately.

Other sensitive areas: token handling, evidence provenance, log integrity, request-size limits, source-handle scope, provider-side session reuse and injection through evidence text.
