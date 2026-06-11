#!/usr/bin/env node
/**
 * Copy Firestore data: yhgc-testing → yhgc-77841
 * Uses Firebase Web SDK (same access as admin portal).
 *
 * Usage (from admin-web):
 *   node scripts/migrate-firestore.mjs
 *   node scripts/migrate-firestore.mjs --dry-run
 */

import { initializeApp } from "firebase/app"
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  setDoc,
  writeBatch,
} from "firebase/firestore"

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

const COLLECTIONS = [
  "clients",
  "companies",
  "properties",
  "constructionProjects",
  "constructionStages",
  "financeRecords",
  "incomeRows",
  "invoices",
  "insuranceRecords",
  "assets",
  "notifications",
  "accountantLinks",
  "fcmOutbox",
  "insuranceAlertDedupe",
]

const dryRun = process.argv.includes("--dry-run")

const srcApp = initializeApp(SOURCE, "source")
const dstApp = initializeApp(DEST, "dest")
const srcDb = getFirestore(srcApp)
const dstDb = getFirestore(dstApp)

async function copyCollection(name) {
  const snap = await getDocs(collection(srcDb, name))
  if (snap.empty) {
    console.log(`  ${name}: (empty)`)
    return 0
  }
  if (dryRun) {
    console.log(`  ${name}: ${snap.size} docs (dry-run)`)
    return snap.size
  }
  let written = 0
  let batch = writeBatch(dstDb)
  let inBatch = 0
  for (const d of snap.docs) {
    batch.set(doc(dstDb, name, d.id), d.data())
    inBatch++
    written++
    if (inBatch >= 400) {
      await batch.commit()
      batch = writeBatch(dstDb)
      inBatch = 0
    }
  }
  if (inBatch > 0) await batch.commit()
  console.log(`  ${name}: ${written} docs copied`)
  return written
}

async function copyLegacySnapshot() {
  const ref = doc(srcDb, "appSnapshots", "adminPrototype")
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    console.log("  appSnapshots/adminPrototype: (missing)")
    return 0
  }
  if (dryRun) {
    console.log("  appSnapshots/adminPrototype: 1 doc (dry-run)")
    return 1
  }
  await setDoc(doc(dstDb, "appSnapshots", "adminPrototype"), snap.data())
  console.log("  appSnapshots/adminPrototype: 1 doc copied")
  return 1
}

async function copyConfigFcm() {
  const ref = doc(srcDb, "config", "fcm")
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    console.log("  config/fcm: (missing)")
    return 0
  }
  if (dryRun) {
    console.log("  config/fcm: 1 doc (dry-run)")
    return 1
  }
  await setDoc(doc(dstDb, "config", "fcm"), snap.data())
  console.log("  config/fcm: 1 doc copied")
  return 1
}

async function copyUserFcmTokens() {
  const usersSnap = await getDocs(collection(srcDb, "users"))
  let total = 0
  for (const userDoc of usersSnap.docs) {
    const tokensSnap = await getDocs(collection(srcDb, "users", userDoc.id, "fcmTokens"))
    if (tokensSnap.empty) continue
    if (dryRun) {
      total += tokensSnap.size
      continue
    }
    let batch = writeBatch(dstDb)
    let n = 0
    for (const t of tokensSnap.docs) {
      batch.set(doc(dstDb, "users", userDoc.id, "fcmTokens", t.id), t.data())
      n++
      total++
      if (n >= 400) {
        await batch.commit()
        batch = writeBatch(dstDb)
        n = 0
      }
    }
    if (n > 0) await batch.commit()
  }
  console.log(`  users/*/fcmTokens: ${total} docs ${dryRun ? "(dry-run)" : "copied"}`)
  return total
}

console.log(`Migrate yhgc-testing → yhgc-77841${dryRun ? " [DRY RUN]" : ""}`)
let total = 0
total += await copyLegacySnapshot()
total += await copyConfigFcm()
for (const name of COLLECTIONS) {
  total += await copyCollection(name)
}
total += await copyUserFcmTokens()
console.log(`\nDone. ${total} documents ${dryRun ? "would be" : ""} migrated.`)
