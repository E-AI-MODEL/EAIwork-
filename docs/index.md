# Documentatie EAIwork

Begin bij de [README](../README.md). Dit overzicht koppelt de onderdelen aan de documentatie die op de huidige ontwikkeltak beschikbaar is.

- **Bewijsregels:** [atomaire beweringen](atomic-claim-contract.md), [ontwerp voor herkomst en bevestiging](../proposals/0001-independence-and-proven.md), [controle van de bewijskern](alignment/bouwronde-2026-11-13.md), [veiligheidsgrenzen](../SECURITY.md).
- **Uitvoering en lokale codeproef:** [bouwplan](first-product-roadmap-2026-11-11.md), [Docker-projecttests](local-project-suite-smoke.md), [opdrachten en uitvoerders](mission-execution-v0.1.md), [model- en workerversies](worker-versions-and-evidence-links.md).
- **Controle van uitgifte:** [release-dossier](release-dossier-v0.1.md), [GitHub-run controleren](github-ci-verification-v0.1.md), [controle van artifactbytes](github-actions-artifact-v0.1.md).
- **Onderzoek en metingen:** [modelvergelijking](atom-vs-whole-comparison.md), [bevroren validatie](frozen-cross-domain-validation.md), [onderzoeksgrenzen](validation-3b-7b-after-action.md).
- **Versies:** [wijzigingen](../CHANGELOG.md), [v0.1.0](releases/v0.1.0.md).

## Wat een geslaagde codeproef wel en niet zegt

De codeplan-API toont een `proof` met `status: current` wanneer de laatste Docker-projecttest slaagde en de hash van alle geplande bron- en testbestanden nog gelijk is. Die status verandert in `stale` zodra een van die bestanden wijzigt of de controle niet meer aantoonbaar geldig is. Alleen de bestanden in het testmanifest vallen hieronder. Een nieuwe, niet in het plan opgenomen map of bestand wordt niet automatisch gecontroleerd. Deze status bewijst niet dat een AI-model de code zelfstandig maakte, dat een release is gepubliceerd of dat iedere inhoudelijke bewering waar is.
