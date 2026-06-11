/**
 * Mock vs live: production builds read `VITE_USE_MOCKED_BACKEND` from `.env.production` (see Vite docs).
 * Dev server: omit the var or use `.env.development` to point at Firestore.
 */
const useMockedFromVite = import.meta.env.VITE_USE_MOCKED_BACKEND === "true"

export const appSettings = {
  /** Mocked data in the browser (localStorage). When false, uses Firestore + Storage. */
  useMockedBackend: useMockedFromVite,
  firebase: {
    apiKey: "AIzaSyB1RLXAwCWDU1LCbBuBiRjZb3bzYqXf4B8",
    authDomain: "yhgc-77841.firebaseapp.com",
    projectId: "yhgc-77841",
    storageBucket: "yhgc-77841.firebasestorage.app",
    messagingSenderId: "520482432285",
    appId: "1:520482432285:web:d1b1cd15aa70ecbc5fadf4",
    measurementId: "G-5S10HQNVNK",
  },
}

export type BackendMode = "mock" | "firebase"

export const activeBackendMode: BackendMode = appSettings.useMockedBackend ? "mock" : "firebase"

/** Only login allowed for the admin portal. Edit here, then rebuild / redeploy to change credentials. */
export const adminPortalUser = {
  email: "admin@yourhomegroupconsultancy.co.uk",
  password: "YhgcAdmin2026!",
  fullName: "YOUR HOME GROUP Consultancy",
}
