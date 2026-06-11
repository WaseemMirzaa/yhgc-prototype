import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { setGlobalOptions } from "firebase-functions/v2";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { createHash, randomUUID } from "node:crypto";

initializeApp();
const db = getFirestore();
const messaging = getMessaging();

setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const FCM_CONFIG = "config/fcm";

function tokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32);
}

function stringifyData(data?: Record<string, unknown>): Record<string, string> {
  if (!data) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

async function assertCanSendPush(uid: string): Promise<void> {
  const user = await getAuth().getUser(uid);
  if (user.customClaims?.admin === true) return;
  const snap = await db.doc(FCM_CONFIG).get();
  const adminUserIds: string[] = snap.get("adminUserIds") ?? [];
  if (adminUserIds.includes(uid)) return;
  throw new HttpsError("permission-denied", "Not allowed to send push notifications");
}

async function collectTokensForUsers(userIds: string[]): Promise<string[]> {
  const tokens = new Set<string>();
  for (const userId of userIds) {
    const snap = await db.collection(`users/${userId}/fcmTokens`).get();
    for (const doc of snap.docs) {
      const t = doc.get("token") as string | undefined;
      if (t) tokens.add(t);
    }
  }
  return [...tokens];
}

/** Client (Flutter) calls after sign-in to store the device FCM token. */
export const registerFcmToken = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const token = request.data?.token as string | undefined;
  const platform = (request.data?.platform as string | undefined) ?? "unknown";
  if (!token || typeof token !== "string") {
    throw new HttpsError("invalid-argument", "token is required");
  }
  const uid = request.auth.uid;
  const id = tokenDocId(token);
  await db.doc(`users/${uid}/fcmTokens/${id}`).set(
    {
      token,
      platform,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return { ok: true };
});

/** Remove a token (e.g. on logout or token refresh invalidation). */
export const unregisterFcmToken = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const token = request.data?.token as string | undefined;
  if (!token || typeof token !== "string") {
    throw new HttpsError("invalid-argument", "token is required");
  }
  const uid = request.auth.uid;
  const id = tokenDocId(token);
  await db.doc(`users/${uid}/fcmTokens/${id}`).delete();
  return { ok: true };
});

type SendPayload = {
  userIds: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** Admin (custom claim `admin` or uid listed in `config/fcm.adminUserIds`) sends to registered devices. */
export const sendFcmToUsers = onCall(async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  await assertCanSendPush(request.auth.uid);

  const { userIds, title, body, data } = request.data as SendPayload;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new HttpsError("invalid-argument", "userIds must be a non-empty array");
  }
  if (!title || !body || typeof title !== "string" || typeof body !== "string") {
    throw new HttpsError("invalid-argument", "title and body are required");
  }

  const tokens = await collectTokensForUsers(userIds);
  if (tokens.length === 0) {
    return { sent: 0, failureCount: 0, message: "No FCM tokens for given users" };
  }

  const dataStrings = stringifyData(data);
  const messages = tokens.map((t) => ({
    token: t,
    notification: { title, body },
    data: dataStrings,
  }));

  const result = await messaging.sendEach(messages);
  return {
    sent: result.successCount,
    failureCount: result.failureCount,
    responses: result.responses.map((r, i) => ({
      tokenSuffix: tokens[i]!.slice(-8),
      success: r.success,
      error: r.error?.code,
    })),
  };
});

/** Same as send payload; write a doc to trigger async delivery (e.g. from admin tools / Firestore rules). */
export const onFcmOutboxCreated = onDocumentCreated("fcmOutbox/{id}", async (event) => {
  const snap = event.data;
  if (!snap) return;
  const userIds = snap.get("userIds") as string[] | undefined;
  const title = snap.get("title") as string | undefined;
  const body = snap.get("body") as string | undefined;
  const data = snap.get("data") as Record<string, unknown> | undefined;
  if (!Array.isArray(userIds) || !title || !body) {
    await snap.ref.update({
      processedAt: FieldValue.serverTimestamp(),
      error: "invalid payload: need userIds, title, body",
    });
    return;
  }
  const tokens = await collectTokensForUsers(userIds);
  if (tokens.length === 0) {
    await snap.ref.update({
      processedAt: FieldValue.serverTimestamp(),
      sent: 0,
      failureCount: 0,
    });
    return;
  }
  const dataStrings = stringifyData(data);
  const messages = tokens.map((t) => ({
    token: t,
    notification: { title, body },
    data: dataStrings,
  }));
  const result = await messaging.sendEach(messages);
  await snap.ref.update({
    processedAt: FieldValue.serverTimestamp(),
    sent: result.successCount,
    failureCount: result.failureCount,
  });
});

function ukCalendarDayFromIso(iso: string | undefined): string | null {
  if (!iso || typeof iso !== "string" || !iso.trim()) return null;
  const d = new Date(iso.trim());
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

async function enqueueInsuranceRenewalIfNew(opts: {
  insuranceDocId: string;
  clientId: string;
  kind: "insurance_14" | "insurance_60";
  title: string;
  body: string;
  todayUk: string;
}): Promise<void> {
  const dedupeId = `${opts.insuranceDocId}_${opts.kind}_${opts.todayUk}`;
  const dedupeRef = db.collection("insuranceAlertDedupe").doc(dedupeId);
  try {
    await dedupeRef.create({
      insuranceId: opts.insuranceDocId,
      kind: opts.kind,
      day: opts.todayUk,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e: unknown) {
    const code = (e as { code?: number }).code;
    if (code === 6) return;
    const msg = String((e as { message?: string }).message ?? "");
    if (msg.includes("ALREADY_EXISTS")) return;
    throw e;
  }

  const notifId = randomUUID();
  const createdAt = new Date().toISOString();
  await db.collection("notifications").doc(notifId).set({
    id: notifId,
    clientId: opts.clientId,
    type: opts.kind,
    title: opts.title,
    body: opts.body,
    createdAt,
  });

  await db.collection("fcmOutbox").add({
    userIds: [opts.clientId],
    title: opts.title,
    body: opts.body,
    data: {
      clientId: opts.clientId,
      source: "insurance_renewal_schedule",
      insuranceRecordId: opts.insuranceDocId,
      type: opts.kind,
    },
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Daily 08:00 UK: push + in-app notification when `renewal14DayAlertOn` / `renewal60DayAlertOn` matches today (UK calendar). */
export const insuranceRenewalAlertsDaily = onSchedule(
  {
    schedule: "0 8 * * *",
    timeZone: "Europe/London",
    region: "us-central1",
  },
  async () => {
    const todayUk = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    const [insSnap, propSnap] = await Promise.all([
      db.collection("insuranceRecords").get(),
      db.collection("properties").get(),
    ]);
    const propertyToClient = new Map<string, string>();
    for (const d of propSnap.docs) {
      const cid = d.get("clientId") as string | undefined;
      if (cid) propertyToClient.set(d.id, cid);
    }

    for (const doc of insSnap.docs) {
      const row = doc.data();
      const pid = row.propertyId as string | undefined;
      if (!pid) continue;
      const clientId = propertyToClient.get(pid);
      if (!clientId) continue;

      const insurer = String(row.insurerName ?? "").trim() || "Your insurance policy";

      const d14 = ukCalendarDayFromIso(row.renewal14DayAlertOn as string | undefined);
      if (d14 === todayUk) {
        await enqueueInsuranceRenewalIfNew({
          insuranceDocId: doc.id,
          clientId,
          kind: "insurance_14",
          title: "Insurance renewal in 14 days",
          body: `${insurer}: renewal is coming up in about two weeks. Open the app to review your cover dates.`,
          todayUk,
        });
      }

      const d60 = ukCalendarDayFromIso(row.renewal60DayAlertOn as string | undefined);
      if (d60 === todayUk) {
        await enqueueInsuranceRenewalIfNew({
          insuranceDocId: doc.id,
          clientId,
          kind: "insurance_60",
          title: "Insurance renewal in 60 days",
          body: `${insurer}: renewal is in about 60 days. Plan ahead in the app or with your adviser.`,
          todayUk,
        });
      }
    }
  },
);
