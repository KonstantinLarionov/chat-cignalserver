import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

// Хранение активных звонков
const activeCalls = new Map(); // callId -> callInfo
const userSockets = new Map(); // userId -> socketId

io.on("connection", socket => {
    console.log("User connected:", socket.id);
    console.log(`Total connected users:`, io.engine.clientsCount);

    // Регистрация пользователя
    socket.on("register", (userId) => {
        // Удаляем старую запись пользователя, если она есть
        if (userSockets.has(userId)) {
            const oldSocketId = userSockets.get(userId);
            console.log(`User ${userId} was previously connected with socket ${oldSocketId}, replacing with ${socket.id}`);
        }

        userSockets.set(userId, socket.id);
        socket.userId = userId;
        console.log(`User ${userId} registered with socket ${socket.id}`);
        console.log(`Current registered users:`, Array.from(userSockets.entries()));
    });

    socket.on("join", room => {
        socket.join(room);
        socket.to(room).emit("new-user", socket.id);

        socket.on("disconnect", () => {
            console.log(`User disconnected: ${socket.id}, userId: ${socket.userId}`);
            socket.to(room).emit("user-disconnected", socket.id);
            // Очищаем информацию о пользователе
            if (socket.userId) {
                userSockets.delete(socket.userId);
                console.log(`Removed user ${socket.userId} from registered users`);
                console.log(`Current registered users:`, Array.from(userSockets.entries()));
            }
            // Очищаем активные звонки этого пользователя
            cleanupUserCalls(socket.userId);
        });
    });

    // Обработка запроса звонка
    socket.on("call-request", (data) => {
        const { toUserId, callerName, callerAvatar } = data;
        const callerId = socket.userId;

        console.log(`[CALL-REQUEST] From: ${callerId}, To: ${toUserId}, CallerName: ${callerName}`);

        if (!callerId || !toUserId) {
            console.log(`[CALL-ERROR] Invalid caller (${callerId}) or target user (${toUserId})`);
            socket.emit("call-error", { message: "Invalid caller or target user" });
            return;
        }

        const callId = `call_${callerId}_${toUserId}_${Date.now()}`;
        const callInfo = {
            callId,
            callerId,
            calleeId: toUserId,
            callerName: callerName || "Unknown",
            callerAvatar: callerAvatar || null,
            status: "ringing",
            createdAt: new Date()
        };

        activeCalls.set(callId, callInfo);

        // Отправляем уведомление о звонке получателю
        const calleeSocketId = userSockets.get(toUserId);
        console.log(`[CALL-LOOKUP] Looking for user ${toUserId}, found socket: ${calleeSocketId}`);
        console.log(`[USER-SOCKETS] Current registered users:`, Array.from(userSockets.entries()));

        if (calleeSocketId) {
            console.log(`[CALL-SEND] Sending incoming-call to socket ${calleeSocketId} for user ${toUserId}`);
            io.to(calleeSocketId).emit("incoming-call", {
                callId,
                callerId,
                callerName: callInfo.callerName,
                callerAvatar: callInfo.callerAvatar
            });
        } else {
            // Пользователь не в сети
            console.log(`[CALL-ERROR] User ${toUserId} is offline`);
            socket.emit("call-error", { message: "User is offline" });
            activeCalls.delete(callId);
        }

        console.log(`[CALL-REQUEST] Call request processed: ${callId}`);
    });

    // Обработка принятия звонка
    socket.on("call-accept", (data) => {
        const { callId } = data;
        const callInfo = activeCalls.get(callId);

        if (!callInfo || callInfo.status !== "ringing") {
            socket.emit("call-error", { message: "Call not found or not ringing" });
            return;
        }

        if (callInfo.calleeId !== socket.userId) {
            socket.emit("call-error", { message: "Not authorized to accept this call" });
            return;
        }

        callInfo.status = "accepted";
        callInfo.acceptedAt = new Date();

        // Уведомляем звонящего о принятии
        const callerSocketId = userSockets.get(callInfo.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit("call-accepted", {
                callId,
                roomId: `call_${callInfo.callerId}_${callInfo.calleeId}_${Date.now()}`
            });
        }

        console.log(`Call ${callId} accepted by ${callInfo.calleeId}`);
    });

    // Обработка отклонения звонка
    socket.on("call-reject", (data) => {
        const { callId } = data;
        const callInfo = activeCalls.get(callId);

        if (!callInfo || callInfo.status !== "ringing") {
            return;
        }

        if (callInfo.calleeId !== socket.userId && callInfo.callerId !== socket.userId) {
            socket.emit("call-error", { message: "Not authorized to reject this call" });
            return;
        }

        callInfo.status = "rejected";
        callInfo.rejectedAt = new Date();

        // Уведомляем звонящего об отклонении
        const callerSocketId = userSockets.get(callInfo.callerId);
        if (callerSocketId) {
            io.to(callerSocketId).emit("call-rejected", { callId });
        }

        // Очищаем звонок через 5 секунд
        setTimeout(() => {
            activeCalls.delete(callId);
        }, 5000);

        console.log(`Call ${callId} rejected by ${socket.userId}`);
    });

    // Обработка отмены звонка звонящим
    socket.on("call-cancel", (data) => {
        const { callId } = data;
        const callInfo = activeCalls.get(callId);

        if (!callInfo || callInfo.callerId !== socket.userId) {
            socket.emit("call-error", { message: "Call not found or not authorized" });
            return;
        }

        callInfo.status = "cancelled";
        callInfo.cancelledAt = new Date();

        // Уведомляем получателя об отмене
        const calleeSocketId = userSockets.get(callInfo.calleeId);
        if (calleeSocketId) {
            io.to(calleeSocketId).emit("call-cancelled", { callId });
        }

        // Очищаем звонок
        activeCalls.delete(callId);

        console.log(`Call ${callId} cancelled by caller ${socket.userId}`);
    });

    // WebRTC события
    socket.on("offer", (data) => {
        io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
    });

    socket.on("answer", (data) => {
        io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
    });

    socket.on("candidate", (data) => {
        io.to(data.to).emit("candidate", { from: socket.id, candidate: data.candidate });
    });

    // Очистка при отключении
    socket.on("disconnect", () => {
        console.log("User disconnected:", socket.id, "userId:", socket.userId);
        console.log(`Total connected users:`, io.engine.clientsCount);
        if (socket.userId) {
            userSockets.delete(socket.userId);
            console.log(`Removed user ${socket.userId} from registered users`);
            console.log(`Current registered users:`, Array.from(userSockets.entries()));
            cleanupUserCalls(socket.userId);
        }
    });
});

// Функция очистки звонков пользователя
function cleanupUserCalls(userId) {
    for (const [callId, callInfo] of activeCalls.entries()) {
        if (callInfo.callerId === userId || callInfo.calleeId === userId) {
            if (callInfo.status === "ringing") {
                // Если звонок еще идет, завершаем его
                callInfo.status = "ended";
                callInfo.endedAt = new Date();
            }
            // Очищаем через 10 секунд
            setTimeout(() => {
                activeCalls.delete(callId);
            }, 10000);
        }
    }
}
const PORT = process.env.PORT || 3000; // 🔑 Render подставит свой порт
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Signaling server started on ${PORT}`);
});
