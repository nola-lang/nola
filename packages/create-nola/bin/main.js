#!/usr/bin/env node
// `npm create nola` ≡ `npm create nola-lang`. This package is a name alias:
// the scaffolder (templates, prompt flow, `nola init` sharing) lives in
// create-nola-lang; importing its bin module runs it with the same argv/cwd.
import "create-nola-lang/main";
