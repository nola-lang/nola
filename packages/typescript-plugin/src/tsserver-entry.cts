// The CJS bundle entry tsserver `require`s (see scripts/bundle.mjs). tsserver
// plugins must export the factory itself as module.exports, which is what
// `export =` means — and only a .cts file may say it (in an ESM-typed .ts the
// `module` global is a bundler warning and `export =` a type error).
import plugin = require("./plugin.js");

export = plugin.createNolaTsPlugin();
