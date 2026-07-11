import { defineNuxtModule, addVitePlugin } from '@nuxt/kit';
import kapiVitePlugin from './vite-plugin.js';
export default defineNuxtModule({
    meta: {
        name: 'kapi-ui',
        configKey: 'kapi',
    },
    setup(_options, nuxt) {
        var _a;
        if (!nuxt.options.dev)
            return;
        // Nuxt renders HTML through Nitro, not Vite's transformIndexHtml, so the
        // overlay script has to be injected via unhead instead of the vite plugin.
        addVitePlugin(kapiVitePlugin());
        // Nuxt mounts Vite's dev middleware under app.buildAssetsDir (e.g. /_nuxt/),
        // not at the site root, so the script has to be requested from under that
        // prefix or Nitro's page renderer intercepts it before Vite ever sees it.
        (_a = nuxt.options.app.head).script || (_a.script = []);
        nuxt.options.app.head.script.push({
            src: `${nuxt.options.app.buildAssetsDir}@kapi-ui/overlay`,
            type: 'module',
        });
    },
});
