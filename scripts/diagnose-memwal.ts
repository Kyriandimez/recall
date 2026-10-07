import { loadEnvFile } from "node:process";

loadEnvFile(".env.local");

import { MemWal } from "@mysten-incubation/memwal";
import { EncryptedObject } from "@mysten/seal";

const serverUrl = process.env.MEMWAL_SERVER_URL!;
const privateKey = process.env.MEMWAL_PRIVATE_KEY!;
const accountId = process.env.MEMWAL_ACCOUNT_ID!;

if (!serverUrl) throw new Error("MEMWAL_SERVER_URL is missing");
if (!privateKey) throw new Error("MEMWAL_PRIVATE_KEY is missing");
if (!accountId) throw new Error("MEMWAL_ACCOUNT_ID is missing");

const namespace = `diagnostic-${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
const fact =
  "Recall diagnostic test: Kyrian is testing Walrus Memory Mainnet.";
const query = "What is Kyrian testing?";

console.log("=== FRESH MEMWAL DECRYPTION PIPELINE DIAGNOSTIC ===");
console.log("namespace:", namespace);
console.log("server:", serverUrl);
console.log("fact:", fact);
console.log("query:", query);

const memwal = MemWal.create({
  key: privateKey,
  accountId,
  serverUrl,
  namespace,
});

// ============================================================
// 1. WRITE
// ============================================================

console.log("\n1. WRITE");

const write = await memwal.rememberAndWait(fact, namespace);

console.dir(write, { depth: null });

const blobId = write.blob_id;

if (!blobId) {
  throw new Error("Write succeeded but returned no blob_id");
}

console.log("blob_id:", blobId);

// ============================================================
// 2. EMBED
// ============================================================

console.log("\n2. EMBED");

const embedded = await memwal.embed(query);
const vector = embedded.vector;

console.log({
  dimension: vector.length,
  firstValues: vector.slice(0, 5),
});

// ============================================================
// 3. RAW VECTOR SEARCH
// ============================================================

console.log("\n3. VECTOR SEARCH");

const search = await memwal.recallManual({
  vector,
  limit: 10,
  namespace,
});

console.dir(search, { depth: null });

const hit = search.results.find(
  (result) => result.blob_id === blobId
);

if (!hit) {
  console.error(
    "\nTHE NEWLY WRITTEN BLOB WAS NOT RETURNED BY VECTOR SEARCH."
  );
  console.error("Expected blob:", blobId);
  process.exit(1);
}

console.log("\nFOUND WRITTEN BLOB IN VECTOR SEARCH");
console.log("distance:", hit.distance);

// ============================================================
// 4. DIRECT WALRUS DOWNLOAD
// ============================================================

console.log("\n4. DIRECT WALRUS DOWNLOAD");

const aggregator =
  process.env.MEMWAL_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-mainnet.walrus.space";

const url = `${aggregator}/v1/blobs/${blobId}`;

console.log("url:", url);

const response = await fetch(url);

console.log("HTTP:", response.status, response.statusText);
console.log(
  "content-type:",
  response.headers.get("content-type")
);

if (!response.ok) {
  console.error("WALRUS DOWNLOAD FAILED");
  console.error(await response.text());
  process.exit(1);
}

const bytes = new Uint8Array(await response.arrayBuffer());

console.log("downloaded bytes:", bytes.length);

// ============================================================
// 5. SEAL PARSE
// ============================================================

console.log("\n5. SEAL PARSE");

let parsed: ReturnType<typeof EncryptedObject.parse>;

try {
  parsed = EncryptedObject.parse(bytes);

  console.log("SEAL parse: SUCCESS");
  console.log("packageId:", parsed.packageId);
  console.log("id:", parsed.id);
  console.log("id length:", parsed.id.length);
} catch (err) {
  console.error("SEAL parse: FAILED");
  console.error(err);
  process.exit(1);
}

// ============================================================
// 6. PACKAGE ID CHECK
// ============================================================

console.log("\n6. PACKAGE ID CHECK");

try {
  const configResponse = await fetch(`${serverUrl}/config`);

  console.log(
    "config HTTP:",
    configResponse.status,
    configResponse.statusText
  );

  const config = await configResponse.json();

  console.log("relayer packageId:", config.packageId);
  console.log("ciphertext packageId:", parsed.packageId);

  const packageMatch =
    parsed.packageId.toLowerCase() ===
    config.packageId.toLowerCase();

  console.log("PACKAGE ID MATCH:", packageMatch ? "YES" : "NO");
} catch (err) {
  console.error("Could not fetch /config:");
  console.error(err);
}

// ============================================================
// 7. NORMAL RECALL
// ============================================================

console.log("\n7. NORMAL RECALL");

try {
  const recall = await memwal.recall(query, {
    namespace,
    limit: 10,
  });

  console.dir(recall, { depth: null });
} catch (err) {
  console.error("NORMAL RECALL FAILED:");
  console.error(err);
}

console.log("\n=== DIAGNOSTIC COMPLETE ===");