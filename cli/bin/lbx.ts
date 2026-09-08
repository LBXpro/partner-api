#!/usr/bin/env bun
import { run } from "../src/cli.ts";

const outcome = await run(process.argv.slice(2), {
  env: process.env,
  stderr: (line) => process.stderr.write(`${line}\n`),
});

if (outcome.stdoutBytes) process.stdout.write(outcome.stdoutBytes);
else if (outcome.stdout) console.log(outcome.stdout);
if (outcome.stderr) console.error(outcome.stderr);
process.exit(outcome.exitCode);
