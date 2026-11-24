// Prints a vitest json-summary report as a Markdown table for the job
// summary. Usage: node coverage-summary.mjs <title> <coverage-summary.json>
import { existsSync, readFileSync } from 'node:fs';

const [title, file] = process.argv.slice(2);
if (!existsSync(file)) {
  // The tests failed before writing a report; their own step already failed.
  console.log(`### ${title} coverage\n\nNo coverage report was written.`);
  process.exit(0);
}

const { total } = JSON.parse(readFileSync(file, 'utf8'));
const row = (name, key) =>
  `| ${name} | ${total[key].pct}% | ${total[key].covered} / ${total[key].total} |`;
console.log(
  [
    `### ${title} coverage`,
    '',
    '| Metric | Covered | Count |',
    '| --- | ---: | ---: |',
    row('Lines', 'lines'),
    row('Branches', 'branches'),
    row('Functions', 'functions'),
    row('Statements', 'statements'),
  ].join('\n')
);
