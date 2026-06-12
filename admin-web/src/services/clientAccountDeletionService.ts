import { initializeApp, getApps } from "firebase/app"
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore"
import { activeBackendMode, appSettings } from "../config/settings"
import { hasClientPasswordSet, verifyClientPasswordData } from "./clientPassword"

export type DeleteClientAccountResult =
  | { ok: true; clientId: string }
  | { ok: false; message: string }

function initDb() {
  const app = getApps().length
    ? getApps()[0]
    : initializeApp({
        apiKey: appSettings.firebase.apiKey,
        authDomain: appSettings.firebase.authDomain,
        projectId: appSettings.firebase.projectId,
        storageBucket: appSettings.firebase.storageBucket,
        messagingSenderId: appSettings.firebase.messagingSenderId,
        appId: appSettings.firebase.appId,
      })
  return getFirestore(app)
}

export async function deleteClientAccountWithCredentials(params: {
  loginCode: string
  password: string
}): Promise<DeleteClientAccountResult> {
  const loginCode = params.loginCode.trim()
  const password = params.password

  if (!loginCode) return { ok: false, message: "Enter your login code." }
  if (!password) return { ok: false, message: "Enter your password." }

  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey) {
    return { ok: false, message: "Account deletion is not available in demo mode." }
  }

  try {
    const db = initDb()
    const clientsSnap = await getDocs(
      query(collection(db, "clients"), where("loginCode", "==", loginCode)),
    )

    if (clientsSnap.empty) {
      return { ok: false, message: "No account found for this login code." }
    }

    const clientDoc = clientsSnap.docs[0]!
    const data = clientDoc.data() as Record<string, unknown>
    const status = (data.status ?? "active").toString()

    if (status === "suspended") {
      return { ok: false, message: "This account is suspended. Contact your adviser." }
    }
    if (status === "revoked") {
      return { ok: false, message: "This account has already been removed." }
    }
    if (!hasClientPasswordSet(data)) {
      return {
        ok: false,
        message: "No password is set for this account. Use the mobile app to set a password first.",
      }
    }

    const passwordOk = await verifyClientPasswordData(data, password)
    if (!passwordOk) {
      return { ok: false, message: "Incorrect password. Account was not deleted." }
    }

    const clientId = clientDoc.id
    const signupSource = (data.signupSource ?? "").toString()

    if (signupSource === "mobile_app") {
      await deleteDoc(doc(db, "clients", clientId))
    } else {
      await updateDoc(doc(db, "clients", clientId), {
        status: "revoked",
        appPassword: deleteField(),
        appPasswordHash: deleteField(),
        appPasswordSalt: deleteField(),
        appPasswordIter: deleteField(),
        appPasswordAlgo: deleteField(),
        accountDeletedAt: serverTimestamp(),
        accountDeletedFrom: "web_portal",
      })
    }

    const tokenSnap = await getDocs(collection(db, "users", clientId, "fcmTokens"))
    await Promise.all(tokenSnap.docs.map((d) => deleteDoc(d.ref)))

    return { ok: true, clientId }
  } catch {
    return { ok: false, message: "Could not delete your account. Check your connection and try again." }
  }
}
