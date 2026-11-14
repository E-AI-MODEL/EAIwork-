# Documentatie EAIwork

Begin bij de [README](../README.md). Dit overzicht koppelt de onderdelen aan de documentatie die op de huidige ontwikkeltak beschikbaar is.

- **Bewijsregels:** [atomaire beweringen](atomic-claim-contract.md), [ontwerp voor herkomst en bevestiging](../proposals/0001-independence-and-proven.md), [controle van de bewijskern](alignment/bouwronde-2026-11-13.md), [veiligheidsgrenzen](../SECURITY.md).
- **Uitvoering en lokale codeproef:** [bouwplan](first-product-roadmap-2026-11-11.md), [Docker-projecttests](local-project-suite-smoke.md), [opdrachten en uitvoerders](mission-execution-v0.1.md), [model- en workerversies](worker-versions-and-evidence-links.md).
- **Controle van uitgifte:** [release-dossier](release-dossier-v0.1.md), [GitHub-run controleren](github-ci-verification-v0.1.md), [controle van artifactbytes](github-actions-artifact-v0.1.md).
- **Onderzoek en metingen:** [modelvergelijking](atom-vs-whole-comparison.md), [bevroren validatie](frozen-cross-domain-validation.md), [onderzoeksgrenzen](validation-3b-7b-after-action.md).
- **Versies:** [wijzigingen](../CHANGELOG.md), [v0.1.0](releases/v0.1.0.md).

Zie ook de [beveiligingscontrole van 13 november](security-review-2026-11-13.md), met concrete reparaties, uitgevoerde proeven en overgebleven grenzen.

## Wat een geslaagde codeproef wel en niet zegt

De codeplan-API toont een `proof` met `status: current` wanneer de laatste Docker-projecttest slaagde en de hash van alle geplande bron- en testbestanden nog gelijk is. Die status verandert in `stale` zodra een van die bestanden wijzigt of de controle niet meer aantoonbaar geldig is. Alleen de bestanden in het testmanifest vallen hieronder. Een nieuwe, niet in het plan opgenomen map of bestand wordt niet automatisch gecontroleerd. Deze status bewijst niet dat een AI-model de code zelfstandig maakte, dat een release is gepubliceerd of dat iedere inhoudelijke bewering waar is.

## Alle documenten

Documenten met een datum in de naam zijn momentopnamen en worden niet bijgewerkt.

| Onderwerp | Documenten |
|---|---|
| Starten | [eerste lokale run met Ollama](local-ollama-first-run.md), [voorbeeldpakket](local-demo-softwarepakket.md), [live Ollama-test](live-ollama-smoke.md) |
| Bewijskern | [workerisolatie](worker-isolation.md), [modelvoorstellen zonder autoriteit](model-capability-neutral.md), [citatie-observer](umdt-inspired-evidence-gate.md), [interface](interface-notes.md) |
| Opdrachten | [plancontrole](plan-preflight-v0.1.md), [planversies](plan-extensions-v0.1.md), [herplannen](replan-proposals-v0.1.md), [duurzame uitvoering](durable-execution-v0.2.md), [wachtrij](durable-local-queue-v0.1.md), [parallelle teksttaken](parallel-pure-local-v0.1.md), [losse tekstuitvoerder](local-executor-channel-v0.1.md), [groei van het operationslog](operations-growth-v0.1.md) |
| Uitgifte | [controle van lokale artifactbytes](local-artifact-byte-check-v0.1.md), [dashboardcontract](dashboard-product-contract-v0.1.md), [productielijn uit Shadowseed](shadowseed-production-line-adoption-v0.1.md) |
| Modelonderzoek (verleent geen autoriteit) | [lessen uit Z.ai](zai-lessons-and-evaluation.md), [diagnostiek van modelvergelijking](model-comparison-diagnostics.md) |
| Momentopnamen | [bouwplan 10 november](buildplan-eaiwork-2026-11-10.md), [repositorycontrole 10 november](repository-review-2026-11-10.md), [echte GitHub-artifactproef](github-artifact-real-proof-2026-11-10.md), [alignmentrapport 10 november](alignment/alignment-rapport-2026-11-10.md) |
