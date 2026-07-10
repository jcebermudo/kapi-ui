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
        (_a = nuxt.options.app.head).script || (_a.script = []);
        nuxt.options.app.head.script.push({
            src: '/@kapi-ui/overlay',
            type: 'module',
        });
    },
});
