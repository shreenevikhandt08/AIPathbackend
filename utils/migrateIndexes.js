/**
 * One-off, idempotent index clean-up run after the DB connects.
 *
 * Problem statements used to have a global UNIQUE index on `fingerprint`, which turned "someone
 * already has this statement" into a hard error. It is now a reminder, so the unique index must go.
 */
const LEGACY = [{ model: "ProblemStatement", name: "uniq_statement_fingerprint" }];

async function dropLegacyIndexes() {
  const ProblemStatement = require("../models/Problemstatement");
  const models = { ProblemStatement };
  for (const { model, name } of LEGACY) {
    const coll = models[model].collection;
    let indexes = [];
    try {
      indexes = await coll.indexes();
    } catch (e) {
      if (/ns does not exist/i.test(e.message)) continue; // collection not created yet
      throw e;
    }
    if (indexes.some((i) => i.name === name)) {
      await coll.dropIndex(name);
      console.log(`🧹 Dropped legacy index ${model}.${name}`);
    }
  }
}

module.exports = { dropLegacyIndexes };
