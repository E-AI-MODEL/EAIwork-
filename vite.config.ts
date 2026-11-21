import {defineConfig} from "vite";
import {cloudflare} from "@cloudflare/vite-plugin";

/** Only the separately declared Cloudflare Worker is built; no public SPA
 * assets, no existing Theory7 site routes, and no Cloudflare Pages project. */
export default defineConfig({plugins:[cloudflare()]});
