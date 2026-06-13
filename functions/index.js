const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const https = require("https");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

// ── 1. Anthropic API 프록시 (스코어카드 스캔) ──────────────────────
exports.scanScorecard = onRequest({ cors: true, timeoutSeconds: 60 }, (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const body = JSON.stringify(req.body);
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "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",
      "anthropic-version": "2023-06-01",
      "Content-Length": Buffer.byteLength(body)
    }
  };
  const apiReq = https.request(options, (apiRes) => {
    let data = "";
    apiRes.on("data", (chunk) => { data += chunk; });
    apiRes.on("end", () => { res.status(apiRes.statusCode).send(data); });
  });
  apiReq.on("error", (e) => { res.status(500).send(JSON.stringify({ error: e.message })); });
  apiReq.write(body);
  apiReq.end();
});

// ── 2. FCM 토큰 저장 ──────────────────────────────────────────────
exports.saveFcmToken = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const { memberName, token } = req.body;
  if (!memberName || !token) { res.status(400).send("memberName and token required"); return; }
  await db.collection("fcm_tokens").doc(memberName).set({ token, updatedAt: new Date().toISOString() });
  res.status(200).send("OK");
});

// ── 3. 새 이벤트 등록 시 전체 푸시 (회원당 1개만) ─────────────────
exports.onNewEvent = onDocumentCreated("events/{eventId}", async (event) => {
  const data = event.data.data();
  if (!data) return;

  const tokensSnap = await db.collection("fcm_tokens").get();
  
  // 중복 토큰 제거 - 회원당 최신 토큰 1개만 사용
  const tokenSet = new Set();
  const tokens = [];
  tokensSnap.forEach(doc => {
    if (doc.id !== data.organizer) {
      const token = doc.data().token;
      if (token && !tokenSet.has(token)) {
        tokenSet.add(token);
        tokens.push(token);
      }
    }
  });
  
  if (tokens.length === 0) return;

  const message = {
    notification: {
      title: "⛳ 새 라운딩 이벤트!",
      body: `${data.title} - ${data.date}`
    },
    data: { tag: "new_event", eventId: event.params.eventId },
    tokens: tokens
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`푸시 발송: 성공 ${response.successCount}, 실패 ${response.failureCount}`);
  } catch (e) {
    console.error("푸시 오류:", e);
  }
});

// ── 4. 마감 3일전 미응답 회원 리마인더 (매일 오전 9시 EST) ──────────
exports.sendDeadlineReminder = onSchedule("0 14 * * *", async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const eventsSnap = await db.collection("events").where("status", "==", "모집중").get();
  if (eventsSnap.empty) return;

  const membersSnap = await db.collection("members").get();
  const allMembers = [];
  membersSnap.forEach(doc => allMembers.push(doc.data().name));

  const tokensSnap = await db.collection("fcm_tokens").get();
  const tokenMap = {};
  tokensSnap.forEach(doc => { tokenMap[doc.id] = doc.data().token; });

  for (const evDoc of eventsSnap.docs) {
    const ev = evDoc.data();
    if (!ev.deadline) continue;

    const deadline = new Date(ev.deadline);
    deadline.setHours(0, 0, 0, 0);
    const diffDays = Math.round((deadline - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 1 || diffDays > 3) continue;

    const responded = [
      ...(ev.applicants || []),
      ...(ev.absentees || []),
      ...(ev.maybes || []),
      ...(ev.waitlist || [])
    ];

    const noResponse = allMembers.filter(name => !responded.includes(name));
    if (noResponse.length === 0) continue;

    const dayLabel = diffDays === 1 ? "내일" : diffDays === 2 ? "2일 후" : "3일 후";

    for (const name of noResponse) {
      const token = tokenMap[name];
      if (!token) continue;
      try {
        await admin.messaging().send({
          notification: {
            title: `⏰ ${ev.title} 마감 ${dayLabel}!`,
            body: "참가 여부를 아직 응답하지 않으셨어요. 확인해 주세요!"
          },
          data: { tag: "deadline_reminder", eventId: evDoc.id },
          token: token
        });
      } catch (e) {
        console.error(`${name} 리마인더 오류:`, e.message);
      }
    }
  }
});

// ── 4. 번개 모임 등록 시 푸시 알림 ──────────────────────────
exports.onNewFlash = onDocumentCreated("flash_events/{flashId}", async (event) => {
  const data = event.data.data();
  if (!data) return;

  const tokensSnap = await db.collection("fcm_tokens").get();

  const tokenSet = new Set();
  const tokens = [];
  tokensSnap.forEach(doc => {
    if (doc.id !== data.organizer) {
      const token = doc.data().token;
      if (token && !tokenSet.has(token)) {
        tokenSet.add(token);
        tokens.push(token);
      }
    }
  });

  if (tokens.length === 0) return;

  const teeInfo = data.teeTime ? ` · ⏰${data.teeTime}` : '';
  const deadlineInfo = data.deadline ? ` · 마감 ${data.deadline}` : '';

  const message = {
    notification: {
      title: "⚡ 번개 모임!",
      body: `${data.date} · ${data.course}${teeInfo}${deadlineInfo} (최대 4명)`
    },
    data: { tag: "new_flash", flashId: event.params.flashId },
    tokens: tokens
  };

  try {
    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`번개 푸시: 성공 ${response.successCount}, 실패 ${response.failureCount}`);
  } catch (e) {
    console.error("번개 푸시 오류:", e);
  }
});
