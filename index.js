import express from "express";
import cors from "cors";
import { AccessToken } from "livekit-server-sdk";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3000;

// 🔑 из env (Render / Railway / etc)
const LIVEKIT_API_KEY = "APILP7AfEJCMceT";
const LIVEKIT_API_SECRET = "YLnA5gu5pNSCUwANCEuQmJjGOYOvUXeRKSj2s7AIdVE";

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error("LIVEKIT_API_KEY / LIVEKIT_API_SECRET not set");
}

/**
 * GET /token?room=room123&user=user42
 */
app.get("/token", (req, res) => {
  const { room, user } = req.query;

  if (!room || !user) {
    return res.status(400).json({
      error: "room and user are required"
    });
  }

  // 👉 ТУТ МОЖНО ВСТАВИТЬ ПРОВЕРКИ:
  // if (!userHasAccess(user, room)) return 403;

  const token = new AccessToken(
    LIVEKIT_API_KEY,
    LIVEKIT_API_SECRET,
    {
      identity: String(user),
    }
  );

  token.addGrant({
    roomJoin: true,
    room: String(room),
  });

  res.json({
    token: token.toJwt(),
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`LiveKit token server started on ${PORT}`);
});
