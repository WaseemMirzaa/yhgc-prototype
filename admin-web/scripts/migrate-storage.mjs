#!/usr/bin/env node
/**
 * Copy Firebase Storage objects: yhgc-testing → yhgc-77841
 * Recursively copies `adminPrototype/` (and any other top-level prefixes found).
 *
 * Usage (from admin-web):
 *   node scripts/migrate-storage.mjs
 *   node scripts/migrate-storage.mjs --dry-run
 *   node scripts/migrate-storage.mjs --prefix adminPrototype
 */

import { initializeApp } from "firebase/app"
import { getBytes, getMetadata, getStorage, listAll, ref, uploadBytes } from "firebase/storage"

const SOURCE = {
  apiKey: "AIzaSyB40D-2gDlAXn0LkppxqyJ8dYt213g9Nn8",
  authDomain: "yhgc-testing.firebaseapp.com",
  projectId: "yhgc-testing",
  storageBucket: "yhgc-testing.firebasestorage.app",
  messagingSenderId: "944877885594",
  appId: "1:944877885594:web:8b053aa460491196c52723",
}

const DEST = {
  apiKey: "AIzaSyB1RLXAwCWDU1LCbBuBiRjZb3bzYqXf4B8",
  authDomain: "yhgc-77841.firebaseapp.com",
  projectId: "yhgc-77841",
  storageBucket: "yhgc-77841.firebasestorage.app",
  messagingSenderId: "520482432285",
  appId: "1:520482432285:web:d1b1cd15aa70ecbc5fadf4",
}

const dryRun = process.argv.includes("--dry-run")
const prefixArg = process.argv.find((a) => a.startsWith("--prefix="))
const ROOT_PREFIX = prefixArg ? prefixArg.split("=")[1] : "adminPrototype"

const srcApp = initializeApp(SOURCE, "source")
const dstApp = initializeApp(DEST, "dest")
const srcStorage = getStorage(srcApp)
const dstStorage = getStorage(dstApp)

/** @type {{ path: string; contentType?: string }[]} */
const files = []

async function walk(dirRef) {
  const listed = await listAll(dirRef)
  for (const item of listed.items) {
    files.push({ path: item.fullPath })
  }
  for (const sub of listed.prefixes) {
    await walk(sub)
  }
}

async function discoverRoots() {
  if (ROOT_PREFIX !== "*") {
    return [ROOT_PREFIX]
  }
  const root = ref(srcStorage, "")
  const listed = await listAll(root)
  const roots = listed.prefixes.map((p) => p.name)
  if (listed.items.length) roots.push("")
  return roots.length ? roots : ["adminPrototype"]
}

console.log(`Storage migrate ${SOURCE.storageBucket} → ${DEST.storageBucket}${dryRun ? " [DRY RUN]" : ""}`)

const roots = await discoverRoots()
for (const root of roots) {
  const base = root ? ref(srcStorage, root) : ref(srcStorage, "")
  await walk(base)
}

console.log(`Found ${files.length} object(s) under ${roots.join(", ")}`)

let copied = 0
let bytes = 0
for (const [i, f] of files.entries()) {
  const srcRef = ref(srcStorage, f.path)
  let meta
  try {
    meta = await getMetadata(srcRef)
  } catch {
    meta = { contentType: "application/octet-stream" }
  }
  const ct = meta.contentType || "application/octet-stream"
  if (dryRun) {
    console.log(`  [${i + 1}/${files.length}] ${f.path} (${ct})`)
    copied++
    continue
  }
  const data = await getBytes(srcRef)
  bytes += data.byteLength
  const dstRef = ref(dstStorage, f.path)
  await uploadBytes(dstRef, data, { contentType: ct })
  copied++
  console.log(`  [${i + 1}/${files.length}] ${f.path} (${(data.byteLength / 1024).toFixed(1)} KB)`)
}

console.log(`\nDone. ${copied} file(s)${dryRun ? " would be" : ""} migrated (${(bytes / 1024 / 1024).toFixed(2)} MB).`)
