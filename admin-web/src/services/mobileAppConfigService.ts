import { initializeApp, getApps } from "firebase/app"
import { doc, getDoc, getFirestore, setDoc } from "firebase/firestore"
import { activeBackendMode, appSettings } from "../config/settings"
import { stripUndefinedForFirestore } from "./dataService"
import { defaultMobileAppConfig, type MobileAppConfig } from "../types/mobileAppConfig"

const MOCK_KEY = "yhgc-mobile-app-config-v1"

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

function normalize(raw: Partial<MobileAppConfig> | null | undefined): MobileAppConfig {
  const base = defaultMobileAppConfig()
  if (!raw) return base
  return {
    allowMobileSignup: raw.allowMobileSignup ?? base.allowMobileSignup,
    privacyPolicyPath: raw.privacyPolicyPath?.trim() || base.privacyPolicyPath,
    privacyPolicyUrl: raw.privacyPolicyUrl?.trim() || "",
    privacyPolicyTitle: raw.privacyPolicyTitle?.trim() || base.privacyPolicyTitle,
    privacyPolicyContent: raw.privacyPolicyContent?.trim() || base.privacyPolicyContent,
    termsOfServicePath: raw.termsOfServicePath?.trim() || base.termsOfServicePath,
    termsOfServiceUrl: raw.termsOfServiceUrl?.trim() || "",
    termsOfServiceTitle: raw.termsOfServiceTitle?.trim() || base.termsOfServiceTitle,
    termsOfServiceContent: raw.termsOfServiceContent?.trim() || base.termsOfServiceContent,
    updatedAt: raw.updatedAt ?? base.updatedAt,
  }
}

export async function loadMobileAppConfig(): Promise<MobileAppConfig> {
  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey || !appSettings.firebase.projectId) {
    const raw = localStorage.getItem(MOCK_KEY)
    if (!raw) return defaultMobileAppConfig()
    try {
      return normalize(JSON.parse(raw) as Partial<MobileAppConfig>)
    } catch {
      return defaultMobileAppConfig()
    }
  }
  const db = initDb()
  const snap = await getDoc(doc(db, "appConfig", "mobile"))
  if (!snap.exists()) return defaultMobileAppConfig()
  return normalize(snap.data() as Partial<MobileAppConfig>)
}

export async function saveMobileAppConfig(config: MobileAppConfig): Promise<void> {
  const next = normalize({
    ...config,
    updatedAt: new Date().toISOString(),
  })
  if (activeBackendMode !== "firebase" || !appSettings.firebase.apiKey || !appSettings.firebase.projectId) {
    localStorage.setItem(MOCK_KEY, JSON.stringify(next))
    return
  }
  const db = initDb()
  await setDoc(doc(db, "appConfig", "mobile"), stripUndefinedForFirestore(next), { merge: true })
}
