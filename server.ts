import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

interface Player {
  id: string;
  name: string;
  color: string;
  side: "left" | "right";
  hp: number;
  score: number;
  x: number;
  y: number;
  width: number;
  height: number;
  dashCooldown: number;
  parryActiveUntil: number;
  parryCooldown: number;
  ready: boolean;
  lastThrowTime: number;
  comboCount?: number;
  feverActiveUntil?: number;
}

interface Cleaver {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  speed: number;
  reflectedCount: number;
  damage: number;
  isFever?: boolean;
}

interface GameRoom {
  id: string;
  name: string;
  isPrivate: boolean;
  password?: string;
  matchLimit: number; // 3, 5, or 7
  status: "waiting" | "playing" | "ended";
  gameState: "lobby" | "countdown" | "ongoing" | "roundOver" | "gameOver";
  countdown: number;
  winnerId?: string;
  players: Record<string, Player>;
  cleavers: Cleaver[];
  roundNumber: number;
  physicsIntervalId?: NodeJS.Timeout;
}

const activeRooms: Record<string, GameRoom> = {};
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 600;
const PLAYER_WIDTH = 40;
const PLAYER_HEIGHT = 65;

const JERSEY_COLORS = [
  "#FF0000", "#FF4500", "#FF8C00", "#FFA500", "#FFD700", "#FFFF00",
  "#ADFF2F", "#7FFF00", "#00FF00", "#32CD32", "#00FA9A", "#00FFFF",
  "#00BFFF", "#1E90FF", "#0000FF", "#8A2BE2", "#9400D3", "#D81B60",
  "#FF1493", "#FF69B4", "#BA55D3", "#8B008B", "#4B0082", "#3F51B5",
  "#009688", "#4CAF50", "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107",
  "#FF9800", "#FF5722", "#795548", "#9E9E9E", "#607D8B", "#333333"
];

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // Serve API or simple health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "healthy", time: new Date().toISOString() });
  });

  // Socket.io Game Logic
  io.on("connection", (socket: Socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // Initial send of room list to newly connected player
    sendRoomList(socket);

    socket.on("room:list", () => {
      sendRoomList(socket);
    });

    socket.on("room:create", (data: {
      name: string;
      isPrivate: boolean;
      password?: string;
      matchLimit: number;
      userName: string;
      userColor: string;
    }) => {
      try {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Pick safe starting position on the left
        const initialPlayer: Player = {
          id: socket.id,
          name: data.userName.trim() || "호스트",
          color: JERSEY_COLORS.includes(data.userColor) ? data.userColor : JERSEY_COLORS[0],
          side: "left",
          hp: 5,
          score: 0,
          x: 150,
          y: CANVAS_HEIGHT / 2 - PLAYER_HEIGHT / 2,
          width: PLAYER_WIDTH,
          height: PLAYER_HEIGHT,
          dashCooldown: 0,
          parryActiveUntil: 0,
          parryCooldown: 0,
          ready: false,
          lastThrowTime: 0,
          comboCount: 0,
          feverActiveUntil: 0
        };

        const newRoom: GameRoom = {
          id: roomId,
          name: data.name.trim() || `${initialPlayer.name}의 매치`,
          isPrivate: data.isPrivate,
          password: data.password,
          matchLimit: Number(data.matchLimit) || 3,
          status: "waiting",
          gameState: "lobby",
          countdown: 0,
          players: {
            [socket.id]: initialPlayer
          },
          cleavers: [],
          roundNumber: 1
        };

        activeRooms[roomId] = newRoom;
        socket.join(roomId);

        socket.emit("room:joined", { roomId, roomState: getCleanRoomState(newRoom), yourId: socket.id });
        broadcastRoomListToAll();
      } catch (err) {
        console.error("Error creating room:", err);
        socket.emit("error", "방 생성 도중 오류가 발생했습니다.");
      }
    });

    socket.on("room:join", (data: {
      roomId: string;
      password?: string;
      userName: string;
      userColor: string;
    }) => {
      try {
        const room = activeRooms[data.roomId];
        if (!room) {
          socket.emit("error", "존재하지 않는 방입니다.");
          return;
        }

        if (Object.keys(room.players).length >= 2) {
          socket.emit("error", "방이 이미 가득 찼습니다. (최대 2명)");
          return;
        }

        if (room.isPrivate && room.password !== data.password) {
          socket.emit("error", "비밀번호가 일치하지 않습니다.");
          return;
        }

        // Color check to ensure opponent color is distinct
        let finalColor = data.userColor;
        const hostId = Object.keys(room.players)[0];
        const hostPlayer = room.players[hostId];
        if (hostPlayer && hostPlayer.color === finalColor) {
          // pick next different color
          const alternativeColors = JERSEY_COLORS.filter(c => c !== hostPlayer.color);
          finalColor = alternativeColors[0] || "#00FFFF";
        }

        const initialPlayer: Player = {
          id: socket.id,
          name: data.userName.trim() || "도전자",
          color: finalColor,
          side: "right",
          hp: 5,
          score: 0,
          x: 800,
          y: CANVAS_HEIGHT / 2 - PLAYER_HEIGHT / 2,
          width: PLAYER_WIDTH,
          height: PLAYER_HEIGHT,
          dashCooldown: 0,
          parryActiveUntil: 0,
          parryCooldown: 0,
          ready: false,
          lastThrowTime: 0,
          comboCount: 0,
          feverActiveUntil: 0
        };

        room.players[socket.id] = initialPlayer;
        socket.join(data.roomId);

        // Notify host that challenger entered (Web Notification on client side will handle focus check)
        socket.to(data.roomId).emit("notification:challenger_entered", {
          challengerName: initialPlayer.name
        });

        io.to(data.roomId).emit("room:state", getCleanRoomState(room));
        socket.emit("room:joined", { roomId: data.roomId, roomState: getCleanRoomState(room), yourId: socket.id });
        broadcastRoomListToAll();
      } catch (err) {
        console.error("Error joining room:", err);
        socket.emit("error", "방 입장 도중 오류가 발생했습니다.");
      }
    });

    socket.on("player:toggle_ready", (data: { roomId: string }) => {
      const room = activeRooms[data.roomId];
      if (!room) return;

      const player = room.players[socket.id];
      if (player) {
        player.ready = !player.ready;
        io.to(data.roomId).emit("room:state", getCleanRoomState(room));

        // Start game if both ready
        const playerIds = Object.keys(room.players);
        if (playerIds.length === 2) {
          const allReady = playerIds.every(id => room.players[id]?.ready);
          if (allReady) {
            startGame(room);
          }
        }
      }
    });

    socket.on("player:change_color", (data: { roomId: string; color: string }) => {
      const room = activeRooms[data.roomId];
      if (!room) return;

      const player = room.players[socket.id];
      if (!player) return;

      // Check if other player is using this color
      const otherId = Object.keys(room.players).find(id => id !== socket.id);
      if (otherId) {
        const otherPlayer = room.players[otherId];
        if (otherPlayer && otherPlayer.color === data.color) {
          socket.emit("error", "이미 상대방이 선택한 유니폼 색상입니다.");
          return;
        }
      }

      player.color = data.color;
      io.to(data.roomId).emit("room:state", getCleanRoomState(room));
    });

    socket.on("player:move", (data: { roomId: string; x: number; y: number }) => {
      const room = activeRooms[data.roomId];
      if (!room || room.gameState === "lobby" || room.gameState === "gameOver") return;

      const player = room.players[socket.id];
      if (!player) return;

      // Validate coordinates based on side to prevent cheating or line crossings
      let targetX = data.x;
      let targetY = data.y;

      // Limit bound checks
      if (player.side === "left") {
        if (targetX < 10) targetX = 10;
        if (targetX > CANVAS_WIDTH / 2 - PLAYER_WIDTH - 10) {
          targetX = CANVAS_WIDTH / 2 - PLAYER_WIDTH - 10; // strictly left of center line
        }
      } else {
        if (targetX < CANVAS_WIDTH / 2 + 10) targetX = CANVAS_WIDTH / 2 + 10; // strictly right of center line
        if (targetX > CANVAS_WIDTH - PLAYER_WIDTH - 10) targetX = CANVAS_WIDTH - PLAYER_WIDTH - 10;
      }

      if (targetY < 10) targetY = 10;
      if (targetY > CANVAS_HEIGHT - PLAYER_HEIGHT - 10) targetY = CANVAS_HEIGHT - PLAYER_HEIGHT - 10;

      player.x = targetX;
      player.y = targetY;

      // Fast sync movement to other player
      socket.to(data.roomId).emit("opponent:move", { id: socket.id, x: player.x, y: player.y });
    });



    socket.on("player:parry", (data: { roomId: string }) => {
      const room = activeRooms[data.roomId];
      if (!room || room.gameState !== "ongoing") return;

      const player = room.players[socket.id];
      if (!player) return;

      const now = Date.now();
      if (now < player.parryCooldown) return;

      // Shield active for 0.2 seconds (200ms)
      player.parryActiveUntil = now + 200;
      player.parryCooldown = now + 1200; // 1.2s cooldown

      io.to(data.roomId).emit("player:parried", {
        id: socket.id,
        parryActiveUntil: player.parryActiveUntil,
        parryCooldown: player.parryCooldown
      });
    });

    socket.on("player:throw", (data: { roomId: string; charge: number }) => {
      const room = activeRooms[data.roomId];
      if (!room || room.gameState !== "ongoing") return;

      const player = room.players[socket.id];
      if (!player) return;

      const now = Date.now();
      // Server-side attack cooldown check (0.3s)
      if (now - player.lastThrowTime < 300) {
        return;
      }
      player.lastThrowTime = now;

      // Limit charge between 0 and 1
      const charge = Math.max(0, Math.min(1, data.charge));

      // Calculate throwing speeds
      // Minimum velocity: 6px/frame, Maximum: 18px/frame
      const baseSpeed = 6 + charge * 12;
      const direction = player.side === "left" ? 1 : -1;

      // Check if Fever Mode is active
      const isFeverActive = now < (player.feverActiveUntil || 0);

      // Spawn cleaver projectile
      const cleaverId = Math.random().toString(36).substring(2, 9);
      const cleaverY = player.y + PLAYER_HEIGHT / 2;
      const cleaverX = player.side === "left" ? (player.x + PLAYER_WIDTH + 15) : (player.x - 15);

      const newCleaver: Cleaver = {
        id: cleaverId,
        ownerId: socket.id,
        x: cleaverX,
        y: cleaverY,
        vx: direction * baseSpeed * (isFeverActive ? 1.15 : 1), // 15% speed boost in fever mode!
        vy: 0,
        radius: 14,
        speed: baseSpeed * (isFeverActive ? 1.15 : 1),
        reflectedCount: 0,
        damage: 1,
        isFever: isFeverActive
      };

      room.cleavers.push(newCleaver);

      // Sound play trigger broadcast (whoosh sound trigger on clients)
      io.to(data.roomId).emit("sound:trigger", { type: "throw" });
      io.to(data.roomId).emit("cleavers:update", room.cleavers);
    });

    // Handle standard user exit or tab close
    socket.on("room:leave", (data: { roomId: string }) => {
      handleUserLeaving(socket, data.roomId);
    });

    socket.on("disconnect", () => {
      console.log(`Socket disconnected: ${socket.id}`);
      // Find and leave any room this socket was in
      for (const roomId in activeRooms) {
        if (activeRooms[roomId]?.players[socket.id]) {
          handleUserLeaving(socket, roomId);
        }
      }
    });
  });

  function sendRoomList(socket: Socket) {
    const list = Object.values(activeRooms).map(r => ({
      id: r.id,
      name: r.name,
      isPrivate: r.isPrivate,
      matchLimit: r.matchLimit,
      status: r.status,
      playerCount: Object.keys(r.players).length
    }));
    socket.emit("room:list", list);
  }

  function broadcastRoomListToAll() {
    const list = Object.values(activeRooms).map(r => ({
      id: r.id,
      name: r.name,
      isPrivate: r.isPrivate,
      matchLimit: r.matchLimit,
      status: r.status,
      playerCount: Object.keys(r.players).length
    }));
    io.emit("room:list", list);
  }

  function handleUserLeaving(socket: Socket, roomId: string) {
    const room = activeRooms[roomId];
    if (!room) return;

    // Clear loops
    if (room.physicsIntervalId) {
      clearInterval(room.physicsIntervalId);
      room.physicsIntervalId = undefined;
    }

    const leavingPlayer = room.players[socket.id];
    delete room.players[socket.id];
    socket.leave(roomId);

    const remainingPlayerIds = Object.keys(room.players);
    if (remainingPlayerIds.length === 0) {
      // Empty room -> delete
      delete activeRooms[roomId];
      console.log(`Room deleted: ${roomId}`);
    } else {
      // Other player left behind becomes winner or gets notification
      room.status = "waiting";
      room.gameState = "lobby";
      room.cleavers = [];

      // Reset scores and ready status
      remainingPlayerIds.forEach(id => {
        const p = room.players[id];
        if (p) {
          p.ready = false;
          p.score = 0;
          p.hp = 5;
          p.side = "left"; // first occupant takes left side
          p.x = 150;
          p.y = CANVAS_HEIGHT / 2 - PLAYER_HEIGHT / 2;
        }
      });

      io.to(roomId).emit("room:state", getCleanRoomState(room));
      io.to(roomId).emit("opponent:disconnected", leavingPlayer?.name || "상대방");
    }

    broadcastRoomListToAll();
  }

  function getCleanRoomState(room: GameRoom) {
    return {
      id: room.id,
      name: room.name,
      isPrivate: room.isPrivate,
      matchLimit: room.matchLimit,
      status: room.status,
      gameState: room.gameState,
      countdown: room.countdown,
      winnerId: room.winnerId,
      players: room.players,
      cleavers: room.cleavers,
      roundNumber: room.roundNumber
    };
  }

  function startGame(room: GameRoom) {
    room.status = "playing";
    room.gameState = "countdown";
    room.countdown = 3;
    room.cleavers = [];
    room.roundNumber = 1;

    // Reset scores & initial positions
    const playerIds = Object.keys(room.players);
    playerIds.forEach(id => {
      const p = room.players[id];
      if (p) {
        p.score = 0;
        p.hp = 5;
        resetPlayerRoundPosition(p);
      }
    });

    io.to(room.id).emit("room:state", getCleanRoomState(room));

    // Start tick physics loop if not already running
    if (room.physicsIntervalId) {
      clearInterval(room.physicsIntervalId);
    }

    // Tick countdown
    const countdownInterval = setInterval(() => {
      const activeRoom = activeRooms[room.id];
      if (!activeRoom || activeRoom.gameState !== "countdown") {
        clearInterval(countdownInterval);
        return;
      }

      activeRoom.countdown -= 1;
      io.to(room.id).emit("countdown:tick", activeRoom.countdown);
      io.to(room.id).emit("sound:trigger", { type: "countdown" });

      if (activeRoom.countdown <= 0) {
        clearInterval(countdownInterval);
        activeRoom.gameState = "ongoing";
        io.to(room.id).emit("room:state", getCleanRoomState(activeRoom));
      }
    }, 1000);

    room.physicsIntervalId = setInterval(() => {
      updatePhysics(room.id);
    }, 1000 / 60); // 60 FPS Server-side physics ticks

    broadcastRoomListToAll();
  }

  function resetPlayerRoundPosition(player: Player) {
    player.hp = 5;
    player.dashCooldown = 0;
    player.parryCooldown = 0;
    player.parryActiveUntil = 0;
    player.comboCount = 0;
    player.feverActiveUntil = 0;
    player.y = CANVAS_HEIGHT / 2 - PLAYER_HEIGHT / 2;
    if (player.side === "left") {
      player.x = 150;
    } else {
      player.x = 800;
    }
  }

  function startNextRound(room: GameRoom) {
    room.gameState = "countdown";
    room.countdown = 3;
    room.cleavers = [];
    room.roundNumber += 1;

    // Reset round positions
    const playerIds = Object.keys(room.players);
    playerIds.forEach(id => {
      const p = room.players[id];
      if (p) {
        resetPlayerRoundPosition(p);
      }
    });

    io.to(room.id).emit("room:state", getCleanRoomState(room));

    // Tick countdown
    const countdownInterval = setInterval(() => {
      const activeRoom = activeRooms[room.id];
      if (!activeRoom || activeRoom.gameState !== "countdown") {
        clearInterval(countdownInterval);
        return;
      }

      activeRoom.countdown -= 1;
      io.to(room.id).emit("countdown:tick", activeRoom.countdown);
      io.to(room.id).emit("sound:trigger", { type: "countdown" });

      if (activeRoom.countdown <= 0) {
        clearInterval(countdownInterval);
        activeRoom.gameState = "ongoing";
        io.to(room.id).emit("room:state", getCleanRoomState(activeRoom));
      }
    }, 1000);
  }

  function updatePhysics(roomId: string) {
    const room = activeRooms[roomId];
    if (!room || room.gameState !== "ongoing") return;

    const now = Date.now();

    // 1. Update Cleavers position and check border bounds/collisions
    const nextCleavers: Cleaver[] = [];

    for (let i = 0; i < room.cleavers.length; i++) {
      const cleaver = room.cleavers[i];
      if (!cleaver) continue;

      // Update position
      cleaver.x += cleaver.vx;
      cleaver.y += cleaver.vy;

      // Check top/bottom bounces
      if (cleaver.y - cleaver.radius <= 0) {
        cleaver.y = cleaver.radius;
        cleaver.vy = -cleaver.vy || 1.5; // add tiny vertical angle to bounce if pure horizontal
      } else if (cleaver.y + cleaver.radius >= CANVAS_HEIGHT) {
        cleaver.y = CANVAS_HEIGHT - cleaver.radius;
        cleaver.vy = -cleaver.vy || -1.5;
      }

      // Check out of outer boundaries (destroyed)
      if (cleaver.x < -50 || cleaver.x > CANVAS_WIDTH + 50) {
        continue; // drop cleaver
      }

      // Check hit collisions on both players
      let hitRegistered = false;
      const playerIds = Object.keys(room.players);

      for (let pIndex = 0; pIndex < playerIds.length; pIndex++) {
        const pId = playerIds[pIndex];
        if (!pId) continue;
        const player = room.players[pId];
        if (!player) continue;

        // You cannot hit yourself unless the ball/cleaver was reflected
        if (cleaver.ownerId === player.id) {
          continue;
        }

        // Broad bounding box collision check
        const cleaverLeft = cleaver.x - cleaver.radius;
        const cleaverRight = cleaver.x + cleaver.radius;
        const cleaverTop = cleaver.y - cleaver.radius;
        const cleaverBottom = cleaver.y + cleaver.radius;

        const pLeft = player.x;
        const pRight = player.x + player.width;
        const pTop = player.y;
        const pBottom = player.y + player.height;

        if (
          cleaverRight >= pLeft &&
          cleaverLeft <= pRight &&
          cleaverBottom >= pTop &&
          cleaverTop <= pBottom
        ) {
          // Check Parry/Reflect!
          const isParryActive = now < player.parryActiveUntil;

          if (isParryActive) {
            // Reflect the cleaver back towards the thrower
            cleaver.ownerId = player.id;
            cleaver.reflectedCount += 1;

            // Reverse direction and boost speed
            const reflectMultiplier = 1.4;
            cleaver.vx = -cleaver.vx * reflectMultiplier;

            // Add a slight vertical bounce variation depending on player position
            const playerCenterY = player.y + player.height / 2;
            const hitRelativeY = cleaver.y - playerCenterY;
            cleaver.vy = (hitRelativeY / (player.height / 2)) * 4; // slight vertical angle

            // Increment parrying player's combo
            player.comboCount = (player.comboCount || 0) + 1;
            if (player.comboCount >= 3) {
              player.feverActiveUntil = now + 3000;
            }

            io.to(roomId).emit("sound:trigger", { type: "parry" });
            io.to(roomId).emit("cleaver:parried_animation", { cleaverId: cleaver.id, x: cleaver.x, y: cleaver.y });
          } else {
            // Normal hit! Player takes damage
            player.hp = Math.max(0, player.hp - cleaver.damage);
            hitRegistered = true;

            // Reset hit player's combo
            player.comboCount = 0;
            player.feverActiveUntil = 0;

            // Increment successful thrower's combo
            const thrower = room.players[cleaver.ownerId];
            if (thrower) {
              thrower.comboCount = (thrower.comboCount || 0) + 1;
              if (thrower.comboCount >= 3) {
                thrower.feverActiveUntil = now + 3000;
              }
            }

            io.to(roomId).emit("sound:trigger", { type: "hit" });
            io.to(roomId).emit("player:hit_animation", { id: player.id, x: cleaver.x, y: cleaver.y });

            // Check if player is knocked out (0 HP)
            if (player.hp <= 0) {
              handleRoundVictory(room, player.id);
              return; // break physics loop as state transitioned
            }
          }
        }
      }

      if (!hitRegistered) {
        nextCleavers.push(cleaver);
      }
    }

    room.cleavers = nextCleavers;

    // Send fast tick updates of positions to both players
    io.to(roomId).emit("game:tick", {
      players: room.players,
      cleavers: room.cleavers
    });
  }

  function handleRoundVictory(room: GameRoom, defeatedPlayerId: string) {
    const playerIds = Object.keys(room.players);
    const winnerId = playerIds.find(id => id !== defeatedPlayerId);

    if (!winnerId) return;

    const winner = room.players[winnerId];
    if (winner) {
      winner.score += 1;
    }

    room.cleavers = [];

    // Check if Match Winner is decided based on match limit selection
    // "3판 2선승제" = 2 wins, "5판 3선승제" = 3 wins, "7판 4선승제" = 4 wins
    const winsNeeded = Math.ceil(room.matchLimit / 2);

    if (winner && winner.score >= winsNeeded) {
      // Game completely over
      room.status = "ended";
      room.gameState = "gameOver";
      room.winnerId = winnerId;
      io.to(room.id).emit("room:state", getCleanRoomState(room));

      if (room.physicsIntervalId) {
        clearInterval(room.physicsIntervalId);
        room.physicsIntervalId = undefined;
      }
      broadcastRoomListToAll();
    } else {
      // Round is over, prepare next round
      room.gameState = "roundOver";
      io.to(room.id).emit("room:state", getCleanRoomState(room));

      setTimeout(() => {
        const r = activeRooms[room.id];
        if (r && r.gameState === "roundOver") {
          startNextRound(r);
        }
      }, 3000);
    }
  }

  // Handle Vite Asset Serving & SPA Fallback
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Critical server startup crash:", err);
});
