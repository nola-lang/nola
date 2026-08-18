// The CJS bundle entry tsserver `require`s (see scripts/bundle.mjs). tsserver
// plugins must export the factory as module.exports.
import { createNolaTsPlugin } from "./plugin.js";

module.exports = createNolaTsPlugin();
