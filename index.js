import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: "*" } });

io.on("connection", socket => {
    socket.on("join", room => {
        socket.join(room);
        socket.to(room).emit("new-user", socket.id);
    });

    socket.on("offer", (data) => {
        io.to(data.to).emit("offer", { from: socket.id, sdp: data.sdp });
    });

    socket.on("answer", (data) => {
        io.to(data.to).emit("answer", { from: socket.id, sdp: data.sdp });
    });

    socket.on("candidate", (data) => {
        io.to(data.to).emit("candidate", { from: socket.id, candidate: data.candidate });
    });
});

httpServer.listen(3000, () => console.log("Signaling server started"));
