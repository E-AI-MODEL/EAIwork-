/**
 * One-shot child for two fixed deterministic text operations.
 * No arbitrary code, files, URLs, tools, models or shell arguments.
 * Parent enforces deadline, stdout bound and process slot limit.
 */
import {runPureTextAdapter} from "./execution.ts";

const kind=process.argv[2];
if(!["text-normalize","text-metrics"].includes(kind)){
  process.stderr.write("unsupported local adapter");
  process.exitCode=2;
}else{
  const chunks:Buffer[]=[];
  let length=0;
  try{
    for await(const chunk of process.stdin){
      const buffer=Buffer.from(chunk);
      length+=buffer.byteLength;
      if(length>13000)throw new Error("input too large");
      chunks.push(buffer);
    }
    const data=JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if(!data||typeof data!=="object"||Array.isArray(data)||
       Object.keys(data).some(key=>key!=="text")||
       typeof (data as {text?:unknown}).text!=="string")
      throw new Error("invalid payload");
    const output=runPureTextAdapter(kind,data as {text:string});
    process.stdout.write(JSON.stringify(output)+"\n");
  }catch{
    process.stderr.write("local worker failed");
    process.exitCode=2;
  }
}
