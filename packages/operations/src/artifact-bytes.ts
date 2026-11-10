/**
 * Inspect an explicitly supplied local artifact as bytes, never executable code.
 * Does not prove the bytes came from GitHub Actions or the recorded commit.
 */
import {createHash} from "node:crypto";
import type {IncomingMessage} from "node:http";

export interface MeasuredArtifact {
  sha256:string;
  sizeBytes:number;
}
export class ArtifactInputError extends Error {
  readonly code:"empty"|"too-large"|"stream-error";
  constructor(code:"empty"|"too-large"|"stream-error"){
    super(code);
    this.code=code;
  }
}
export async function measureArtifactBytes(
  request:AsyncIterable<Uint8Array>,
  maxBytes=16*1024*1024,
):Promise<MeasuredArtifact>{
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)
    throw new Error("invalid artifact byte limit");
  let sizeBytes=0;
  const hash=createHash("sha256");
  try{
    for await(const part of request){
      const bytes=Buffer.from(part);
      sizeBytes+=bytes.byteLength;
      if(sizeBytes>maxBytes)throw new ArtifactInputError("too-large");
      hash.update(bytes);
    }
  }catch(error){
    if(error instanceof ArtifactInputError)throw error;
    throw new ArtifactInputError("stream-error");
  }
  if(sizeBytes===0)throw new ArtifactInputError("empty");
  return {sha256:hash.digest("hex"),sizeBytes};
}
export function preflightArtifactUpload(
  req:IncomingMessage,maxBytes:number,expectedName:string,
):void{
  if(req.headers["content-type"]!=="application/octet-stream")
    throw new Error("file must use application/octet-stream");
  if(req.headers["content-encoding"]&&req.headers["content-encoding"]!=="identity")
    throw new Error("compressed request bodies are not accepted");
  if(req.headers["x-eai-artifact-name"]!==expectedName)
    throw new Error("selected filename does not match recorded candidate");
  const advertised=req.headers["content-length"];
  if(advertised!==undefined){
    if(!/^[0-9]+$/.test(advertised))throw new Error("invalid content length");
    const length=Number(advertised);
    if(!Number.isSafeInteger(length)||length<=0||length>maxBytes)
      throw new ArtifactInputError(length>maxBytes?"too-large":"empty");
  }
}
