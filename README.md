# sub2sql

`sub2sql` is a simple utility for downloading a Substrate Blockchain into a local SQLite database.

## Installation

```
npm install --global sub2sql
```

## Usage

Minimal usage is:

```
sub2sql --chain=wss://yourchain.com:9944 --out=some_file.sqlite
```

Additional options with defaults:

- `--parallel\_requests=100` - Maximum number of blocks to download in parallel.
- `--types='{}'` - JSON object with your custom types. Ex: `--types='{"MyCustom": "u64"}'`
- `--up_to_block=null` - Only download blocks <= the provided block number.
- `--max_block_count=null` - Only download this many blocks.
- `--latest_first=false` - Start downloading the latest blocks first.

### Table Structure

The tool creates the following tables:

```
CREATE TABLE IF NOT EXISTS blocks (
  hash TEXT PRIMARY KEY NOT NULL,
  parent TEXT,
  number INTEGER,
  finished BOOL
);

CREATE TABLE IF NOT EXISTS extrinsics (
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
);
```

Most of the fields should be straightforward.

- `blocks.finished` is an internal field for tracking if a block has been fully downloaded.
- `extrinsics.section` is the pallet the extrinsic came from.
- `extrinsics.method` is the pallet method.

## Contributing

If you're looking to contribute here are some suggestions:

- Improve throughput: Currently we download about 20-30 blocks/s.
- Store events: We don't capture and store events from the chain.
- Store storage: We don't capture and store storage values as they change.
  This would likely need to be a whitelist of specific storage fields to store.
