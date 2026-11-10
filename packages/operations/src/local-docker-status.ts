/** Read-only local Docker availability check. Does not execute a test container. */
import {spawnSync} from "node:child_process";

export type DockerConnectionStatus={
  status:"ready"|"daemon-unavailable"|"image-missing";
  detail:string;
};
const dockerEnv=()=>({
  PATH:process.env.PATH||"",HOME:process.env.HOME||"",
  ...(process.env.DOCKER_HOST?{DOCKER_HOST:process.env.DOCKER_HOST}:{}),
  ...(process.env.DOCKER_CONFIG?{DOCKER_CONFIG:process.env.DOCKER_CONFIG}:{}),
  ...(process.env.XDG_RUNTIME_DIR?{XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR}:{})
});
export function probeDockerConnection():DockerConnectionStatus{
  if(process.platform==="win32")return {
    status:"daemon-unavailable",detail:"De huidige Docker-testomgeving ondersteunt alleen macOS en Linux."
  };
  const daemon=spawnSync("docker",["info","--format","{{.ServerVersion}}"],{
    encoding:"utf8",timeout:3500,maxBuffer:2000,windowsHide:true,env:dockerEnv()
  });
  if(daemon.error||daemon.status!==0||!daemon.stdout.trim())return {
    status:"daemon-unavailable",detail:"Docker is niet bereikbaar. Start Docker Desktop en controleer met docker info."
  };
  const image=spawnSync("docker",["image","inspect","--format","{{.Id}}","node:22-alpine"],{
    encoding:"utf8",timeout:3500,maxBuffer:2000,windowsHide:true,env:dockerEnv()
  });
  if(image.error||image.status!==0||!/^sha256:[0-9a-f]{64}$/.test(image.stdout.trim()))
    return {status:"image-missing",detail:"Docker reageert. Download nog de testafbeelding met docker pull node:22-alpine."};
  return {status:"ready",detail:"Docker reageert en de testafbeelding node:22-alpine is aanwezig. Er is nog geen test uitgevoerd."};
}
