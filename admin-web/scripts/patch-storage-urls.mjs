#!/usr/bin/env node
/**
 * Rewrite Firestore download URLs: yhgc-testing → yhgc-77841 storage bucket.
 * Run after migrate-storage.mjs.
 */

import { initializeApp } from "firebase/app"
import { collection, doc, getDoc, getDocs, getFirestore, setDoc, writeBatch } from "firebase/firestore"

const DEST = {
  apiKey: "AIzaSyB1RLXAwCWDU1LCbBuBiRjZb3bzYqXf4B8",
  projectId: "yhgc-77841",
  storageBucket: "yhgc-77841.firebasestorage.app",
  appId: "1:520482432285:web:d1b1cd15aa70ecbc5fadf4",
}

const FROM = "yhgc-testing.firebasestorage.app"
const TO = "yhgc-77841.firebasestorage.app"

function patchUrl(value) {
  if (typeof value !== "string" || !value.includes(FROM)) return value
  return value.replaceAll(FROM, TO)
}

function patchDeep(value) {
  if (typeof value === "string") return patchUrl(value)
  if (Array.isArray(value)) return value.map(patchDeep)
  if (value && typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = patchDeep(v)
    return out
  }
  return value
}

const app = initializeApp(DEST, "dest")
const db = getFirestore(app)

let updated = 0

const assetsSnap = await getDocs(collection(db, "assets"))
let batch = writeBatch(db)
let n = 0
for (const d of assetsSnap.docs) {
  const data = d.data()
  const nextUrl = patchUrl(data.urlOrPath ?? "")
  if (nextUrl !== data.urlOrPath) {
    batch.update(doc(db, "assets", d.id), { urlOrPath: nextUrl })
    updated++
    n++
    if (n >= 400) {
      await batch.commit()
      batch = writeBatch(db)
      n = 0
    }
  }
}
if (n > 0) await batch.commit()

const legacyRef = doc(db, "appSnapshots", "adminPrototype")
const legacy = await getDoc(legacyRef)
if (legacy.exists()) {
  const patched = patchDeep(legacy.data())
  const before = JSON.stringify(legacy.data())
  const after = JSON.stringify(patched)
  if (before !== after) {
    await setDoc(legacyRef, patched)
    console.log("  appSnapshots/adminPrototype: URLs patched in legacy doc")
    updated++
  }
}

console.log(`Patched ${updated} asset URL(s) in Firestore (${TO}).`)
