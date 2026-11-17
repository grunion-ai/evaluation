import assert from 'node:assert/strict';
const { slugify } = await import(`${process.cwd()}/src/slugify.mjs`);
assert.equal(slugify('  Hello, World!  '), 'hello-world');
assert.equal(slugify('A--B__c'), 'a-b-c');
assert.equal(slugify('2026 Plan'), '2026-plan');
