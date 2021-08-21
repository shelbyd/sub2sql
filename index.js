#!/usr/bin/env node

const args = require("args-parser")(process.argv);
const { ApiPromise, WsProvider } = require("@polkadot/api");
const sqlite3 = require("sqlite3");
const cliProgress = require("cli-progress");

async function main() {
  const { chain, out } = args;
  if (!chain || !out) {
    console.log("Please provide --chain=wss://yourchain and --out=db.sqlite");
    process.exit(1);
  }

  const provider = new WsProvider(chain);
  const api = await ApiPromise.create({
    provider,
    types: args.types ? JSON.parse(args.types) : {},
  });

  const db = new AsyncDb(new sqlite3.Database(out));

  await createTables(db);

  const blocks = await blocksToDownload(api, db);

  const parallelRequests = args.parallel_requests || 100;
  await allThrottled(
    parallelRequests,
    new cliProgress.SingleBar({
      etaBuffer: parallelRequests * 10,
    }),
    blocks,
    async (number) => {
      await insertBlockNumber(api, db, number);
    }
  );

  await db.close();
}

main().then(() => process.exit(0));

class AsyncDb {
  constructor(db) {
    this.db = db;
  }

  async run(command, args) {
    return new Promise((resolve, reject) => {
      this.db.run(command, args, function (err, value) {
        if (err) return reject(err);
        resolve(value);
      });
    });
  }

  async all(command, args) {
    return new Promise((resolve, reject) => {
      this.db.all(command, args, function (err, value) {
        if (err) return reject(err);
        resolve(value);
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      this.db.close(function (err) {
        if (err) reject(err);
        resolve();
      });
    });
  }
}

async function createTables(db) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS blocks (
      hash TEXT PRIMARY KEY NOT NULL,
      parent TEXT,
      number INTEGER,
      finished BOOL
    )`
  );

  await db.run(
    `CREATE TABLE IF NOT EXISTS extrinsics (
      block TEXT NOT NULL,
      block_index INTEGER NOT NULL,
      signer TEXT,
      nonce INTEGER,
      section TEXT,
      method TEXT,
      args TEXT,
      success BOOLEAN,
      error TEXT,

      PRIMARY KEY (block, block_index)
    )`
  );
}

async function blocksToDownload(api, db) {
  let latestNumber = (
    await api.rpc.chain.getBlock()
  ).block.header.number.toNumber();
  if (args.up_to_block && latestNumber >= args.up_to_block) {
    latestNumber = args.up_to_block - 1;
  }

  const finishedBlocks = new Set();
  for (const row of await db.all(
    "SELECT number FROM blocks WHERE finished=true"
  )) {
    finishedBlocks.add(row.number);
  }

  const result = [...Array(latestNumber + 1).keys()]
    .filter((n) => !finishedBlocks.has(n))
    .slice(0, args.max_block_count);
  if (args.latest_first) {
    result.reverse();
  }
  return result;
}

async function insertBlockNumber(api, db, number) {
  const hash = await api.rpc.chain.getBlockHash(number);
  const block = (await api.rpc.chain.getBlock(hash)).block;

  await db.run(
    `INSERT OR REPLACE INTO blocks (
    hash, parent, number, finished
      ) VALUES (?, ?, ?, ?)`,
    [
      hash.toHex(),
      block.header.parentHash.toHex(),
      block.header.number.toNumber(),
      false,
    ]
  );

  const events = await api.query.system.events.at(hash);

  for (let [index, extr] of block.extrinsics.entries()) {
    const extrinsicEvent = events.find(
      (e) => e.phase.isApplyExtrinsic && e.phase.asApplyExtrinsic.eq(index)
    );
    const isFailure = api.events.system.ExtrinsicFailed.is(
      extrinsicEvent.event
    );

    let error;
    if (isFailure) {
      error = extrinsicEvent.toHuman().event.data[0].Module;
    }

    await db.run(
      `INSERT OR REPLACE INTO extrinsics (
        block,
        block_index,
        signer,
        nonce,
        section,
        method,
        args,
        success,
        error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hash.toHex(),
        index,
        extr.signer?.Id?.toHuman(),
        extr.nonce?.toNumber(),
        extr.method.section,
        extr.method.method,
        JSON.stringify(extr.method.args),
        !isFailure,
        error && JSON.stringify(error),
      ]
    );
  }

  await db.run("UPDATE blocks SET finished=true WHERE hash=?", [hash.toHex()]);
}

async function promiseProgress(progress, promises) {
  progress.start(promises.length, 0);
  return Promise.all(
    promises.map(async (p) => {
      const result = await p;
      progress.increment();
      return result;
    })
  );
}

async function allThrottled(maxInProgress, progress, items, callback) {
  let inProgress = 0;
  let nextIndex = 0;
  progress.start(items.length, 0);

  const results = [];

  return new Promise((resolve, reject) => {
    const startNext = async () => {
      if (inProgress >= maxInProgress) return;
      if (nextIndex >= items.length) {
        if (inProgress === 0) resolve(results);
        return;
      }

      inProgress += 1;
      const thisIndex = nextIndex++;
      if (inProgress < maxInProgress) startNext();

      results[thisIndex] = await callback(items[thisIndex]);

      progress.increment();
      inProgress -= 1;
      startNext();
    };

    startNext();
  });
}
