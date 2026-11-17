import assert from 'node:assert/strict';
const { page, pageCount } = await import(`${process.cwd()}/src/paginate.mjs`);
assert.equal(pageCount(21, 10), 3);
assert.equal(pageCount(0, 10), 0);
assert.deepEqual(page([1, 2, 3, 4, 5], 3, 2), [5]);
assert.deepEqual(page([1, 2, 3, 4, 5], 4, 2), []);
