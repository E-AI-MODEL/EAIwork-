/** Persistent local profile. Keeps witness keys outside the evidence directory. */
import {generateKeyPairSync} from "node:crypto";
import {chmodSync,existsSync,lstatSync,mkdirSync,openSync,writeFileSync,fsyncSync,closeSync,readFileSync} from "node:fs";
import {homedir} from "node:os";
import {join,resolve,sep} from "node:path";

export interface LocalProfile {
  root:string;
  evidenceDir:string;
  operationsDir:string;
  witnessDir:string;
  privateKeyPem:string;
  publicKeyPem:string;
}
export function defaultLocalProfileDir():string{
  return join(homedir(),".eaiwork","local");
}
function secureDirectory(path:string):void{
  if(existsSync(path)){
    const current=lstatSync(path);
    if(!current.isDirectory()||current.isSymbolicLink())
      throw new Error("Lokale opslag mag geen symbolische link zijn");
  }else mkdirSync(path,{recursive:true,mode:0o700});
  if(process.platform!=="win32")chmodSync(path,0o700);
}
function secureKey(path:string,content:string):void{
  const fd=openSync(path,"wx",0o600);
  try{writeFileSync(fd,content);fsyncSync(fd)}finally{closeSync(fd)}
}
function loadKey(path:string):string{
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||
     (process.platform!=="win32"&&(stat.mode&0o077)!==0))
    throw new Error("Lokale sleutel is onveilig opgeslagen; controleer bestandsrechten");
  return readFileSync(path,"utf8");
}
export function openLocalProfile(dir=defaultLocalProfileDir()):LocalProfile{
  if(typeof dir!=="string"||!dir.trim())throw new Error("Kies een geldige opslagmap");
  const root=resolve(dir);
  const repo=resolve(".");
  if(root===repo||root.startsWith(repo+sep))
    throw new Error("Bewaar lokale gegevens buiten de broncodemap");
  secureDirectory(root);
  const evidenceDir=join(root,"evidence"),operationsDir=join(root,"operations");
  const witnessDir=join(root,"witness");
  for(const path of [evidenceDir,operationsDir,witnessDir])secureDirectory(path);
  const privateFile=join(root,"witness-private.pem");
  const publicFile=join(root,"witness-public.pem");
  const privateExists=existsSync(privateFile),publicExists=existsSync(publicFile);
  if(privateExists!==publicExists)
    throw new Error("Onvolledige lokale sleutelset: herstel vanuit dezelfde back-up");
  if(!privateExists){
    const existingEvidence=["events.jsonl","rejections.jsonl","events.head","rejections.head"];
    if(existingEvidence.some(name=>existsSync(join(evidenceDir,name)))||
       ["worker-events.head","worker-events.jsonl"].some(name=>existsSync(join(operationsDir,name))))
      throw new Error("Bestaande gegevens zonder sleutels: maak geen nieuwe sleutelset aan");
    const pair=generateKeyPairSync("ed25519");
    secureKey(privateFile,pair.privateKey.export({format:"pem",type:"pkcs8"}).toString());
    secureKey(publicFile,pair.publicKey.export({format:"pem",type:"spki"}).toString());
  }
  return {root,evidenceDir,operationsDir,witnessDir,
    privateKeyPem:loadKey(privateFile),publicKeyPem:loadKey(publicFile)};
}
