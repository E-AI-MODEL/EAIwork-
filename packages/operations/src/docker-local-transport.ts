/**
 * Docker tests handle code we do not trust. Never allow Docker to send the
 * staged source to an HTTP, SSH or configured remote daemon.
 * Always force a verified local Unix socket in a minimal child environment.
 */
import {statSync} from "node:fs";
import {join} from "node:path";

const isSocket=(path:string)=>{
  try{return statSync(path).isSocket()}catch{return false}
};
export function localDockerEnvironment(env:NodeJS.ProcessEnv=process.env){
  const requested=env.DOCKER_HOST;
  const candidates=requested?[requested]:[
    "unix:///var/run/docker.sock",
    ...(env.HOME?["unix://"+join(env.HOME,".docker/run/docker.sock")]:[]),
    ...(env.XDG_RUNTIME_DIR?["unix://"+join(env.XDG_RUNTIME_DIR,"docker.sock")]:[])
  ];
  const local=candidates.find(value=>{
    if(!value.startsWith("unix:///")||/[\r\n\0]/.test(value))return false;
    const socket=value.slice("unix://".length);
    return socket.startsWith("/") && isSocket(socket);
  });
  if(!local)throw new Error("Docker-tests vereisen een lokale Unix-socket; externe Docker-daemons zijn niet toegestaan");
  // DOCKER_CONTEXT and DOCKER_CONFIG are intentionally not forwarded.
  // An explicit local DOCKER_HOST must override any stored current context.
  return {PATH:env.PATH||"",HOME:env.HOME||"",DOCKER_HOST:local};
}
