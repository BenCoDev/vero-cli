#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const commander_1 = require("commander");
const import_1 = require("./commands/import");
const program = new commander_1.Command();
program
    .command('importFromAirtable')
    .description('Import data from Airtable')
    .action(options => {
    (0, import_1.importFromAirtable)();
});
program.parse(process.argv);
