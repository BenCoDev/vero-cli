#!/usr/bin/env node
import {
	Command
} from 'commander';
import { importFromAirtable } from './commands/import';

const program = new Command();

program
  .command('importFromAirtable')
  .description('Import data from Airtable')
  .action(options => {
    importFromAirtable();
  });

  program.parse(process.argv);