/**
 * A Docker result is evidence for the exact JavaScript test manifest, not a proof
 * that the code meets every business requirement or that an AI answer is true.
 * Every read must compare the recorded manifest against current files.
 */
import type {ProjectTestResult} from "./docker-project-suite.ts";
export type ProjectProof={
  status:"not-tested"|"current"|"stale";
  scope:"planned-files-only";
  reason:string;
  manifestSha256:string|null;
  imageId:string|null;
  recordedAt:string|null;
};
export function validProjectPass(result:ProjectTestResult|undefined):boolean{
  return !!result && result.runner==="docker-project-node-v1" &&
    result.status==="passed" && result.testsExecuted===true &&
    result.exitCode===0 && result.timedOut===false &&
    typeof result.imageId==="string" && /^sha256:[a-f0-9]{64}$/.test(result.imageId);
}
export function evidenceForProject(
  result:ProjectTestResult|undefined,
  currentManifest:string|null,
  expectedFiles:number,
  expectedPaths:string[],
  complete:boolean
):ProjectProof{
  const base={
    scope:"planned-files-only" as const,
    manifestSha256:result?.manifestSha256??null,
    imageId:result?.imageId??null,
    recordedAt:result?.recordedAt??null
  };
  if(!result)return {...base,status:"not-tested",reason:"Nog geen volledige projecttest na toepassing"} as const;
  const matched=validProjectPass(result) &&
    currentManifest!==null && result.manifestSha256===currentManifest &&
    result.fileCount===expectedFiles &&
    JSON.stringify(result.testPaths)===JSON.stringify([...expectedPaths].sort());
  if(!complete||!matched)return {...base,status:"stale",
    reason:"Geen geldige test voor de huidige bestanden en testversies"} as const;
  return {...base,status:"current",
    reason:"Docker-test geslaagd voor exact deze geplande bron- en testbestanden"} as const;
}
