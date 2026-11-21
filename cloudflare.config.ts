import {defineConfig,exports} from "cf/config";
import * as entrypoint from "./packages/cloud/src/worker.ts" with {type:"cf-worker"};

/**
 * Independent Cloudflare Worker. Do not route the current eaimodel.nl host
 * or the existing eai-html-galerij Worker through this application.
 *
 * Fail-closed until Cloudflare Access is enabled for this Worker and the
 * EAI_ACCESS_AUD and EAI_ALLOWED_EMAIL environment secrets are configured.
 */
export default defineConfig({
  worker:{
    name:"eaiwork",
    workersDev:true,
    previewUrls:false,
    entrypoint,
    compatibilityDate:"2026-11-21",
    compatibilityFlags:["enable_ctx_exports"],
    exports:{CloudWorkspace:exports.durableObject({storage:"sqlite"})},
  },
});
