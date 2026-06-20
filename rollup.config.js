import terser from '@rollup/plugin-terser';

export default {
    input: 'src/index.js',
    output: {
        file: 'index.js',
        format: 'iife',
        name: 'STCopilot',
        inlineDynamicImports: true,
        globals: {
            '/scripts/world-info.js': 'ST_WorldInfo',
            '/scripts/utils.js': 'ST_Utils'
        }
    },
    external: [
        '/scripts/world-info.js', 
        '/scripts/utils.js',
        '/scripts/extensions/image-captioning/index.js',
        '/scripts/extensions/regex/engine.js'
    ],
    plugins: [
        // terser()
    ]
};