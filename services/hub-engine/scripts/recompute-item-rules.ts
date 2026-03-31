import { db, schema } from '../src/db/index.js';
import { batchUpdatePriority } from '../src/processors/priority.js';

async function main() {
  const rows = await db
    .selectDistinct({ userId: schema.items.userId })
    .from(schema.items);

  let updated = 0;
  for (const row of rows) {
    updated += await batchUpdatePriority(row.userId, 5000);
  }

  console.log(JSON.stringify({
    users: rows.length,
    updated,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
