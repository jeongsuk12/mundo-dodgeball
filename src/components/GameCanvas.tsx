import React, { useEffect, useRef, useState } from "react";
import { GameRoom, Player, Cleaver, CANVAS_WIDTH, CANVAS_HEIGHT } from "../types";
import { audioSynth } from "../utils/audioSynth";

interface GameCanvasProps {
  socket: any;
  roomId: string;
  roomState: GameRoom | null;
  yourId: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  life: number; // 0 to 1
  decay: number;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  socket,
  roomId,
  roomState,
  yourId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Client-side local player state for instant movement response (zero-lag prediction)
  const localPlayerPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const keysPressed = useRef<Record<string, boolean>>({});

  // Dash trackers removed

  // Action state
  const [chargeValue, setChargeValue] = useState<number>(0);
  const chargeStartTime = useRef<number | null>(null);
  const isCharging = useRef<boolean>(false);
  const [canThrow, setCanThrow] = useState<boolean>(true);
  const canThrowRef = useRef<boolean>(true);
  const lastThrowTimeRef = useRef<number>(0);

  // Particle systems
  const particles = useRef<Particle[]>([]);
  const shakeAmount = useRef<number>(0);
  const playerFlashFrames = useRef<Record<string, number>>({});

  // Spin angle of cleavers
  const spinAngle = useRef<number>(0);

  // Mobile portrait orientation check
  const [isPortrait, setIsPortrait] = useState<boolean>(false);

  useEffect(() => {
    const checkOrientation = () => {
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window);
      setIsPortrait(isMobile && window.innerHeight > window.innerWidth);
    };
    checkOrientation();
    window.addEventListener("resize", checkOrientation);
    return () => window.removeEventListener("resize", checkOrientation);
  }, []);

  // Get self and opponent states safely
  const me: Player | undefined = roomState?.players?.[yourId];
  const opponentId = Object.keys(roomState?.players || {}).find((id) => id !== yourId);
  const opponent: Player | undefined = opponentId ? roomState?.players?.[opponentId] : undefined;

  // Initialize local coordinates once when joined/ready
  useEffect(() => {
    if (me) {
      localPlayerPosRef.current = { x: me.x, y: me.y };
    }
  }, [me?.id, roomState?.gameState]);

  // Socket animation listeners (hits, parries, dashes) to trigger local particles
  useEffect(() => {
    if (!socket) return;

    const handleHitAnimation = (data: { id: string; x: number; y: number }) => {
      // Blood-orange spark burst
      spawnSparks(data.x, data.y, "#F43F5E", 25);
      // Trigger camera shake
      shakeAmount.current = 15;
      // Trigger player hit flash for 4 frames
      playerFlashFrames.current[data.id] = 4;
    };

    const handleParryAnimation = (data: { cleaverId: string; x: number; y: number }) => {
      // Electric cyan flash burst
      spawnSparks(data.x, data.y, "#06B6D4", 25);
      // Trigger fast camera shake
      shakeAmount.current = 8;
    };

    const handleDashed = (data: { id: string; x: number; y: number }) => {
      // White smoke dust at previous location
      const p = roomState?.players?.[data.id];
      if (p) {
        spawnDust(p.x + p.width / 2, p.y + p.height / 2, p.color, 15);
      }
    };

    socket.on("player:hit_animation", handleHitAnimation);
    socket.on("cleaver:parried_animation", handleParryAnimation);
    socket.on("player:dashed", handleDashed);

    return () => {
      socket.off("player:hit_animation", handleHitAnimation);
      socket.off("cleaver:parried_animation", handleParryAnimation);
      socket.off("player:dashed", handleDashed);
    };
  }, [socket, roomState]);

  // Particle Spawners
  const spawnSparks = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.5 + Math.random() * 5.5;
      particles.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 3 + Math.random() * 4,
        life: 1.0,
        decay: 0.02 + Math.random() * 0.03,
      });
    }
  };

  const spawnDust = (x: number, y: number, color: string, count: number) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.5;
      particles.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        color,
        size: 6 + Math.random() * 8,
        life: 0.8,
        decay: 0.03 + Math.random() * 0.02,
      });
    }
  };

  const performThrow = (charge: number) => {
    if (!canThrowRef.current) return;
    socket.emit("player:throw", { roomId, charge });

    lastThrowTimeRef.current = Date.now();
    canThrowRef.current = false;
    setCanThrow(false);
    setTimeout(() => {
      canThrowRef.current = true;
      setCanThrow(true);
    }, 250);
  };

  // Keyboard Event Handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!me || roomState?.gameState !== "ongoing") return;

      const key = e.key.toLowerCase();
      const now = Date.now();

      // Handle Keydown states
      keysPressed.current[key] = true;

      // "l" Key Hold (Charge Throw) - Changed from "a" to "l"
      if (key === "l" && !isCharging.current) {
        if (!canThrowRef.current) return;
        audioSynth.ensureContextResumed();
        isCharging.current = true;
        chargeStartTime.current = now;
        setChargeValue(0);
      }

      // "k" Key Parry (Reflect) - Changed from "s" to "k"
      if (key === "k") {
        audioSynth.ensureContextResumed();
        socket.emit("player:parry", { roomId });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      keysPressed.current[key] = false;

      // "l" Key Release -> Emit Cleaver Throw
      if (key === "l" && isCharging.current) {
        const now = Date.now();
        const start = chargeStartTime.current || now;
        const duration = now - start;
        const finalCharge = Math.min(1.0, duration / 1000); // 1s is max charge

        performThrow(finalCharge);

        isCharging.current = false;
        chargeStartTime.current = null;
        setChargeValue(0);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [me?.id, roomState?.gameState, roomId, socket]);

  // Game/Animation rendering tick loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderLoop = () => {
      // 1. Local Player Movement Prediction
      if (me && roomState?.gameState === "ongoing" && !isCharging.current) {
        let dx = 0;
        let dy = 0;

        if (keysPressed.current["w"]) dy -= 1;
        if (keysPressed.current["s"]) dy += 1;
        if (keysPressed.current["a"]) dx -= 1;
        if (keysPressed.current["d"]) dx += 1;

        if (dx !== 0 || dy !== 0) {
          // Normalize for diagonal movement
          const length = Math.sqrt(dx * dx + dy * dy);
          const isFever = me.feverActiveUntil && Date.now() < me.feverActiveUntil;
          const speed = isFever ? 5.2 * 1.15 : 5.2; // Match responsive control speed + 15% Fever boost!
          const vx = (dx / length) * speed;
          const vy = (dy / length) * speed;

          let targetX = localPlayerPosRef.current.x + vx;
          let targetY = localPlayerPosRef.current.y + vy;

          // Enforce strict side center line checks instantly on the client
          const padding = 12;
          const playerWidth = me.width || 40;
          const playerHeight = me.height || 65;

          if (me.side === "left") {
            if (targetX < padding) targetX = padding;
            if (targetX > CANVAS_WIDTH / 2 - playerWidth - padding) {
              targetX = CANVAS_WIDTH / 2 - playerWidth - padding;
            }
          } else {
            if (targetX < CANVAS_WIDTH / 2 + padding) targetX = CANVAS_WIDTH / 2 + padding;
            if (targetX > CANVAS_WIDTH - playerWidth - padding) {
              targetX = CANVAS_WIDTH - playerWidth - padding;
            }
          }

          if (targetY < padding) targetY = padding;
          if (targetY > CANVAS_HEIGHT - playerHeight - padding) {
            targetY = CANVAS_HEIGHT - playerHeight - padding;
          }

          // Apply local coordinates instantly for lag-free controls
          localPlayerPosRef.current = { x: targetX, y: targetY };

          // Sync coordinates to server
          socket.emit("player:move", {
            roomId,
            x: targetX,
            y: targetY,
          });
        }
      }

      // Update Charging Value State
      if (isCharging.current && chargeStartTime.current) {
        const elapsed = Date.now() - chargeStartTime.current;
        setChargeValue(Math.min(1.0, elapsed / 1000));
      }

      // Draw everything
      draw(ctx);

      // Recursive call
      animationFrameRef.current = requestAnimationFrame(renderLoop);
    };

    animationFrameRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [roomState, yourId, socket, roomId]);

  // Render routine
  const draw = (ctx: CanvasRenderingContext2D) => {
    // Clear Canvas
    ctx.fillStyle = "#020617"; // Slate 950 deep theme
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.save();
    if (shakeAmount.current > 0.1) {
      const dx = (Math.random() - 0.5) * shakeAmount.current;
      const dy = (Math.random() - 0.5) * shakeAmount.current;
      ctx.translate(dx, dy);
      shakeAmount.current *= 0.88; // decay
    }

    // 1. Draw Sport Court Grid lines
    ctx.strokeStyle = "rgba(51, 65, 85, 0.3)";
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x < CANVAS_WIDTH; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let y = 0; y < CANVAS_HEIGHT; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Outer pitch borders
    ctx.strokeStyle = "rgba(244, 63, 94, 0.25)";
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, CANVAS_WIDTH - 20, CANVAS_HEIGHT - 20);

    // Inner outline zones
    ctx.strokeStyle = "rgba(244, 63, 94, 0.1)";
    ctx.lineWidth = 3;
    ctx.strokeRect(20, 20, CANVAS_WIDTH - 40, CANVAS_HEIGHT - 40);

    // 2. Draw vertical Glowing "Center Line" (중앙선)
    ctx.shadowBlur = 15;
    ctx.shadowColor = "#F43F5E";
    ctx.strokeStyle = "#F43F5E";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(CANVAS_WIDTH / 2, 10);
    ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT - 10);
    ctx.stroke();

    // Side warning lanes near center
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(244, 63, 94, 0.03)";
    ctx.fillRect(CANVAS_WIDTH / 2 - 40, 10, 40, CANVAS_HEIGHT - 20);
    ctx.fillStyle = "rgba(244, 63, 94, 0.03)";
    ctx.fillRect(CANVAS_WIDTH / 2, 10, 40, CANVAS_HEIGHT - 20);

    // Center circular logo pattern
    ctx.strokeStyle = "rgba(244, 63, 94, 0.25)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, 80, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Draw Particle effects
    const nextParticles: Particle[] = [];
    particles.current.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96; // drag
      p.vy *= 0.96;
      p.life -= p.decay;

      if (p.life > 0) {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.life;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
        nextParticles.push(p);
      }
    });
    ctx.globalAlpha = 1.0;
    particles.current = nextParticles;

    // 4. Draw spinning Projectiles (Cleavers / 오마주 식칼)
    spinAngle.current += 0.16;
    const cleaversList = roomState?.cleavers || [];
    cleaversList.forEach((cleaver) => {
      // Ensure we have numeric coordinates to prevent NaN drawing errors
      const cx = typeof cleaver.x === "number" ? cleaver.x : 0;
      const cy = typeof cleaver.y === "number" ? cleaver.y : 0;
      const radius = typeof cleaver.radius === "number" ? cleaver.radius : 14;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spinAngle.current * (cleaver.vx > 0 ? 1 : -1));

      // Speed trailing vector shadows
      const isFever = !!cleaver.isFever;
      const primaryColor = isFever ? "#C084FC" : (cleaver.reflectedCount > 0 ? "#22D3EE" : "#E2E8F0");
      const shadowColor = isFever ? "#A855F7" : (cleaver.reflectedCount > 0 ? "#06B6D4" : "#F43F5E");
      const edgeColor = isFever ? "#9333EA" : (cleaver.reflectedCount > 0 ? "#0891B2" : "#94A3B8");

      ctx.shadowBlur = isFever ? 20 : (cleaver.reflectedCount > 0 ? 15 : 6);
      ctx.shadowColor = shadowColor;

      // [CRITICAL BUG FIX]: Failsafe Rendering Example to ensure visibility
      ctx.fillStyle = isFever ? "#C084FC" : (cleaver.reflectedCount > 0 ? "#22D3EE" : "#C0C0C0"); // Silver/Grey Cleaver Color or Reflected Cyan
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();

      // Draw metallic pixel axe/cleaver style
      // Cleaver handle
      ctx.fillStyle = isFever ? "#4A044E" : "#78350F"; // wood brown handle
      ctx.fillRect(-15, -4, 14, 8);

      // Cleaver blade
      ctx.fillStyle = primaryColor; // reflected glows cyan!
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-1, -12);
      ctx.lineTo(15, -12);
      ctx.lineTo(15, 12);
      ctx.lineTo(-1, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Sharp blade accent highlight
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(11, -10, 3, 20);

      ctx.restore();

      // Spawn a trail spark behind the fever projectile
      if (isFever && Math.random() < 0.35) {
        particles.current.push({
          x: cx,
          y: cy + (Math.random() - 0.5) * 8,
          vx: -cleaver.vx * 0.15 + (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5,
          color: "#D8B4FE",
          size: 2.5 + Math.random() * 3,
          life: 0.8,
          decay: 0.05
        });
      }

      // Wind trail vectors
      ctx.strokeStyle = isFever ? "rgba(168, 85, 247, 0.5)" : (cleaver.reflectedCount > 0 ? "rgba(34, 211, 238, 0.4)" : "rgba(244, 63, 94, 0.3)");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - (cleaver.vx || 0) * 2, cy);
      ctx.lineTo(cx - (cleaver.vx || 0) * 5, cy);
      ctx.stroke();
    });

    // 5. Render Players
    const playersList = (roomState ? Object.values(roomState.players) : []) as Player[];
    const now = Date.now();

    playersList.forEach((player) => {
      // Use client-predicted X/Y coordinate for local player to ensure 0-latency motion feel, and server coordinate for opponents
      const isMe = player.id === yourId;
      const x = isMe ? localPlayerPosRef.current.x : player.x;
      const y = isMe ? localPlayerPosRef.current.y : player.y;

      const halfW = player.width / 2;

      // Draw Parry Shield aura if parry active
      const isParryActive = now < player.parryActiveUntil;
      if (isParryActive) {
        ctx.save();
        ctx.shadowBlur = 20;
        ctx.shadowColor = "#06B6D4"; // light blue parry shield
        ctx.strokeStyle = "#22D3EE";
        ctx.lineWidth = 4;
        ctx.fillStyle = "rgba(34, 211, 238, 0.15)";
        ctx.beginPath();
        // Shield aura dome
        ctx.arc(x + player.width / 2, y + player.height / 2, player.height * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Track hit flashing frames (e.g. 4 frames of solid white override)
      const flashFrames = playerFlashFrames.current[player.id] || 0;
      const isFlashing = flashFrames > 0;
      if (isFlashing) {
        playerFlashFrames.current[player.id] = flashFrames - 1;
      }

      const bodyColor = isFlashing ? "#FFFFFF" : player.color;
      const shortsColor = isFlashing ? "#FFFFFF" : "#1E293B";
      const skinColor = isFlashing ? "#FFFFFF" : "#FBCFE8";
      const hairColor = isFlashing ? "#FFFFFF" : "#0F172A";

      // Draw Player Figure
      ctx.save();
      
      // Shadow under character
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.beginPath();
      ctx.ellipse(x + halfW, y + player.height - 2, halfW * 1.2, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Draw custom uniform color jerseys
      ctx.fillStyle = bodyColor;
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;

      // Uniform jersey torso
      ctx.beginPath();
      ctx.roundRect(x + 4, y + 20, player.width - 8, 28, 6);
      ctx.fill();
      ctx.stroke();

      // Shorts
      ctx.fillStyle = shortsColor; // dark slate athletic shorts
      ctx.fillRect(x + 5, y + 46, player.width - 10, 8);

      // Character skin (Sporty face/hands)
      ctx.fillStyle = skinColor; // light skin tone or placeholder
      ctx.beginPath();
      ctx.arc(x + halfW, y + 10, 10, 0, Math.PI * 2); // Head
      ctx.fill();
      ctx.stroke();

      // Team markings (Left vs Right side icons)
      ctx.fillStyle = player.side === "left" ? "#EF4444" : "#3B82F6"; // Red vs Blue arm bands
      ctx.fillRect(player.side === "left" ? (x + 2) : (x + player.width - 7), y + 22, 5, 8);

      // Hair or headband
      ctx.fillStyle = hairColor; // black hair/headband
      ctx.fillRect(x + halfW - 8, y + 2, 16, 5);

      // Eyes based on facing direction
      ctx.fillStyle = "#000000";
      const isFacingRight = player.side === "left";
      if (isFacingRight) {
        ctx.fillRect(x + halfW + 2, y + 8, 2, 3);
        ctx.fillRect(x + halfW + 6, y + 8, 2, 3);
      } else {
        ctx.fillRect(x + halfW - 4, y + 8, 2, 3);
        ctx.fillRect(x + halfW - 8, y + 8, 2, 3);
      }

      // Leg motions based on moving states
      ctx.fillStyle = skinColor;
      ctx.fillRect(x + 8, y + 54, 6, 10); // left leg
      ctx.fillRect(x + player.width - 14, y + 54, 6, 10); // right leg

      ctx.restore();

      // 6. Player HUD details above head
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 11px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      
      const label = isMe ? `${player.name} (나)` : player.name;
      ctx.fillText(label, x + halfW, y - 26);

      // Draw Fever / Combo indicators if present
      const isFever = player.feverActiveUntil && now < player.feverActiveUntil;
      if (isFever) {
        ctx.save();
        const bounceY = Math.sin(now / 150) * 4 - 42;
        ctx.font = "black 12px 'Space Grotesk', sans-serif";
        ctx.fillStyle = "#F59E0B"; // bright gold
        ctx.shadowBlur = 10;
        ctx.shadowColor = "#F59E0B";
        ctx.textAlign = "center";
        ctx.fillText(`🔥 FEVER!! x${player.comboCount || 3} 🔥`, x + halfW, y + bounceY);
        ctx.restore();
      } else if (player.comboCount && player.comboCount > 0) {
        ctx.save();
        const bounceY = Math.sin(now / 200) * 2 - 40;
        ctx.font = "bold 10px 'Noto Sans KR', sans-serif";
        ctx.fillStyle = "#10B981"; // emerald green
        ctx.textAlign = "center";
        ctx.fillText(`⚡ 콤보 x${player.comboCount} ⚡`, x + halfW, y + bounceY);
        ctx.restore();
      }

      // Heart/HP indicators above head
      const hpCount = player.hp;
      const heartIcon = "❤️";
      const emptyHeart = "🖤";
      let hpString = "";
      for (let h = 0; h < 5; h++) {
        hpString += h < hpCount ? heartIcon : emptyHeart;
      }
      ctx.font = "10px sans-serif";
      ctx.fillText(hpString, x + halfW, y - 12);

      // 7. Draw Throw Charging bar directly beneath character's feet
      if (isMe) {
        const barWidth = 50;
        const barHeight = 6;
        const barX = x + halfW - barWidth / 2;
        const barY = y + player.height + 8;

        if (isCharging.current) {
          // Background
          ctx.fillStyle = "#1E293B";
          ctx.fillRect(barX, barY, barWidth, barHeight);

          // Charging gradient
          const grad = ctx.createLinearGradient(barX, barY, barX + barWidth, barY);
          grad.addColorStop(0, "#E11D48"); // Rose primary red
          grad.addColorStop(1, "#F43F5E");
          ctx.fillStyle = grad;
          ctx.fillRect(barX, barY, barWidth * chargeValue, barHeight);

          // Charge border
          ctx.strokeStyle = "#FFFFFF";
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barWidth, barHeight);
        } else if (!canThrow) {
          // Progressive reload progress bar! (250ms)
          const elapsed = Date.now() - lastThrowTimeRef.current;
          const pct = Math.min(1.0, elapsed / 250);

          // Background
          ctx.fillStyle = "#1E293B";
          ctx.fillRect(barX, barY, barWidth, barHeight);

          // Soft red reload progress
          ctx.fillStyle = "rgba(244, 63, 94, 0.4)";
          ctx.fillRect(barX, barY, barWidth * pct, barHeight);

          // Reload border
          ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
          ctx.lineWidth = 1;
          ctx.strokeRect(barX, barY, barWidth, barHeight);

          // Draw "RELOAD" text
          ctx.font = "8px sans-serif";
          ctx.fillStyle = "#FDA4AF";
          ctx.fillText("재장전...", x + halfW, barY + 14);
        }
      }

      // 8. Draw cooldown alerts for parry under player feet (Dash removed)
      if (isMe) {
        const hasThrowBar = isCharging.current || !canThrow;
        const cdY = y + player.height + (hasThrowBar ? 26 : 8);
        const parryCdLeft = Math.max(0, player.parryCooldown - now);

        if (parryCdLeft > 0) {
          ctx.font = "9px sans-serif";
          ctx.fillStyle = "#94A3B8";
          let cdText = `반격 CD: ${(parryCdLeft / 1000).toFixed(1)}s`;
          ctx.fillText(cdText, x + halfW, cdY);
        }
      }
    });

    // 9. Overlay Countdown Messages on Canvas
    if (roomState?.gameState === "countdown" && roomState.countdown > 0) {
      ctx.save();
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#F43F5E";
      ctx.shadowBlur = 20;
      ctx.shadowColor = "#F43F5E";
      ctx.font = "black 72px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(roomState.countdown), CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
      
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 18px 'Noto Sans KR', sans-serif";
      ctx.shadowBlur = 0;
      ctx.fillText("경기가 곧 시작됩니다! 준비하세요!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 70);
      ctx.restore();
    }

    // 10. Round over overlays
    if (roomState?.gameState === "roundOver") {
      ctx.save();
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      ctx.fillStyle = "#F43F5E";
      ctx.font = "black 54px 'Noto Sans KR', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("라운드 종료!", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 40);

      // Display who won the round
      const playerIds = Object.keys(roomState.players);
      const hostId = playerIds[0];
      const challengerId = playerIds[1];
      const host = hostId ? roomState.players[hostId] : null;
      const challenger = challengerId ? roomState.players[challengerId] : null;

      let roundWinText = "라운드 우승자가 결정되었습니다.";
      if (host && challenger) {
        // Find player with non-zero HP
        const roundWinner = host.hp > 0 ? host : challenger;
        roundWinText = `🎉 ${roundWinner.name} 라운드 승리! 🎉`;
      }

      ctx.fillStyle = "#38BDF8";
      ctx.font = "bold 24px 'Noto Sans KR', sans-serif";
      ctx.fillText(roundWinText, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30);

      ctx.fillStyle = "#94A3B8";
      ctx.font = "14px 'Noto Sans KR', sans-serif";
      ctx.fillText("3초 후 다음 라운드가 준비됩니다...", CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 90);
      ctx.restore();
    }

    ctx.restore(); // Restore screen shake camera save
  };

  return (
    <div className="flex flex-col items-center w-full max-w-[1000px]">
      {/* Mobile portrait rotation overlay */}
      {isPortrait && (
        <div className="fixed inset-0 z-[9999] bg-slate-950 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <div className="w-16 h-16 bg-indigo-600/15 rounded-full flex items-center justify-center mb-6 border border-indigo-500/30 animate-pulse">
            <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89" />
            </svg>
          </div>
          <h3 className="text-lg font-black text-white mb-2">가로 화면(Landscape) 플레이 필수</h3>
          <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
            모바일 환경에서는 원활하고 몰입감 넘치는 피구 매치를 즐기기 위해 화면을 <strong>가로 모드로 회전</strong>해 주시기 바랍니다! 🔄
          </p>
        </div>
      )}

      {/* Main Game Frame Container */}
      <div className="relative border-4 border-slate-800 rounded-3xl overflow-hidden glowing-canvas bg-slate-900 shadow-2xl w-full">
        <canvas
          ref={canvasRef}
          id="mundo-dodgeball-canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="block w-full h-auto aspect-[1000/600] object-contain"
        />

        {/* 1. Mobile Touch D-PAD (Bottom Left) */}
        <div className="absolute bottom-3 left-3 z-10 md:hidden flex flex-col items-center select-none opacity-70 active:opacity-100 focus-within:opacity-100 transition-opacity">
          <div className="grid grid-cols-3 gap-1.5 w-32 h-32">
            {/* Top (W) */}
            <div />
            <button
              onTouchStart={(e) => { e.preventDefault(); keysPressed.current["w"] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); keysPressed.current["w"] = false; }}
              onTouchCancel={(e) => { e.preventDefault(); keysPressed.current["w"] = false; }}
              onMouseDown={(e) => { e.preventDefault(); keysPressed.current["w"] = true; }}
              onMouseUp={(e) => { e.preventDefault(); keysPressed.current["w"] = false; }}
              onMouseLeave={(e) => { e.preventDefault(); keysPressed.current["w"] = false; }}
              className="w-10 h-10 bg-slate-950/60 backdrop-blur-md border border-slate-700/50 rounded-xl flex items-center justify-center text-white active:bg-indigo-600/80 font-black text-sm shadow-lg select-none"
              style={{ touchAction: "none" }}
            >
              W
            </button>
            <div />

            {/* Left (A) */}
            <button
              onTouchStart={(e) => { e.preventDefault(); keysPressed.current["a"] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); keysPressed.current["a"] = false; }}
              onTouchCancel={(e) => { e.preventDefault(); keysPressed.current["a"] = false; }}
              onMouseDown={(e) => { e.preventDefault(); keysPressed.current["a"] = true; }}
              onMouseUp={(e) => { e.preventDefault(); keysPressed.current["a"] = false; }}
              onMouseLeave={(e) => { e.preventDefault(); keysPressed.current["a"] = false; }}
              className="w-10 h-10 bg-slate-950/60 backdrop-blur-md border border-slate-700/50 rounded-xl flex items-center justify-center text-white active:bg-indigo-600/80 font-black text-sm shadow-lg select-none"
              style={{ touchAction: "none" }}
            >
              A
            </button>
            {/* Center */}
            <div className="w-10 h-10 bg-slate-950/30 rounded-xl border border-slate-900/40 flex items-center justify-center text-[10px] text-slate-500 font-extrabold select-none">
              이동
            </div>
            {/* Right (D) */}
            <button
              onTouchStart={(e) => { e.preventDefault(); keysPressed.current["d"] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); keysPressed.current["d"] = false; }}
              onTouchCancel={(e) => { e.preventDefault(); keysPressed.current["d"] = false; }}
              onMouseDown={(e) => { e.preventDefault(); keysPressed.current["d"] = true; }}
              onMouseUp={(e) => { e.preventDefault(); keysPressed.current["d"] = false; }}
              onMouseLeave={(e) => { e.preventDefault(); keysPressed.current["d"] = false; }}
              className="w-10 h-10 bg-slate-950/60 backdrop-blur-md border border-slate-700/50 rounded-xl flex items-center justify-center text-white active:bg-indigo-600/80 font-black text-sm shadow-lg select-none"
              style={{ touchAction: "none" }}
            >
              D
            </button>

            {/* Bottom (S) */}
            <div />
            <button
              onTouchStart={(e) => { e.preventDefault(); keysPressed.current["s"] = true; }}
              onTouchEnd={(e) => { e.preventDefault(); keysPressed.current["s"] = false; }}
              onTouchCancel={(e) => { e.preventDefault(); keysPressed.current["s"] = false; }}
              onMouseDown={(e) => { e.preventDefault(); keysPressed.current["s"] = true; }}
              onMouseUp={(e) => { e.preventDefault(); keysPressed.current["s"] = false; }}
              onMouseLeave={(e) => { e.preventDefault(); keysPressed.current["s"] = false; }}
              className="w-10 h-10 bg-slate-950/60 backdrop-blur-md border border-slate-700/50 rounded-xl flex items-center justify-center text-white active:bg-indigo-600/80 font-black text-sm shadow-lg select-none"
              style={{ touchAction: "none" }}
            >
              S
            </button>
            <div />
          </div>
        </div>

        {/* 2. Mobile Action Buttons (Bottom Right) */}
        <div className="absolute bottom-3 right-3 z-10 md:hidden flex gap-3.5 select-none opacity-70 active:opacity-100 focus-within:opacity-100 transition-opacity">
          {/* K Parry Shield Button */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              if (!me || roomState?.gameState !== "ongoing") return;
              audioSynth.ensureContextResumed();
              socket.emit("player:parry", { roomId });
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!me || roomState?.gameState !== "ongoing") return;
              audioSynth.ensureContextResumed();
              socket.emit("player:parry", { roomId });
            }}
            className="w-14 h-14 bg-amber-500/25 backdrop-blur-md border border-amber-500/40 rounded-full flex flex-col items-center justify-center text-white active:bg-amber-500/80 font-black shadow-xl select-none"
            style={{ touchAction: "none" }}
          >
            <span className="text-sm font-black">K</span>
            <span className="text-[8px] font-extrabold text-amber-200">반격</span>
          </button>

          {/* L Throw Button with charging event handlers */}
          <button
            onTouchStart={(e) => {
              e.preventDefault();
              if (!me || roomState?.gameState !== "ongoing") return;
              if (!canThrowRef.current) return;
              if (!isCharging.current) {
                audioSynth.ensureContextResumed();
                isCharging.current = true;
                chargeStartTime.current = Date.now();
                setChargeValue(0);
              }
            }}
            onTouchEnd={(e) => {
              e.preventDefault();
              if (isCharging.current) {
                const now = Date.now();
                const start = chargeStartTime.current || now;
                const duration = now - start;
                const finalCharge = Math.min(1.0, duration / 1000);

                performThrow(finalCharge);

                isCharging.current = false;
                chargeStartTime.current = null;
                setChargeValue(0);
              }
            }}
            onTouchCancel={(e) => {
              e.preventDefault();
              if (isCharging.current) {
                isCharging.current = false;
                chargeStartTime.current = null;
                setChargeValue(0);
              }
            }}
            onMouseDown={(e) => {
              e.preventDefault();
              if (!me || roomState?.gameState !== "ongoing") return;
              if (!canThrowRef.current) return;
              if (!isCharging.current) {
                audioSynth.ensureContextResumed();
                isCharging.current = true;
                chargeStartTime.current = Date.now();
                setChargeValue(0);
              }
            }}
            onMouseUp={(e) => {
              e.preventDefault();
              if (isCharging.current) {
                const now = Date.now();
                const start = chargeStartTime.current || now;
                const duration = now - start;
                const finalCharge = Math.min(1.0, duration / 1000);

                performThrow(finalCharge);

                isCharging.current = false;
                chargeStartTime.current = null;
                setChargeValue(0);
              }
            }}
            onMouseLeave={(e) => {
              e.preventDefault();
              if (isCharging.current) {
                isCharging.current = false;
                chargeStartTime.current = null;
                setChargeValue(0);
              }
            }}
            className={`w-16 h-16 rounded-full flex flex-col items-center justify-center text-white active:bg-rose-500/80 font-black shadow-xl select-none transition-colors duration-150 ${
              canThrow 
                ? "bg-rose-500/25 border border-rose-500/40" 
                : "bg-slate-700/40 border border-slate-600/30 opacity-40 cursor-not-allowed"
            }`}
            style={{ touchAction: "none" }}
          >
            <span className="text-base font-black">L</span>
            <span className="text-[9px] font-extrabold text-rose-200">
              {canThrow ? "던지기" : "대기"}
            </span>
          </button>
        </div>
      </div>

      {/* Dedicated Controls Guide Section (Directly Underneath) */}
      <div className="mt-4 bg-slate-900 border border-slate-800/80 p-4 rounded-2xl text-xs text-slate-400 w-full flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-md">
        <div className="flex items-center gap-2">
          <span className="text-sm">🎮</span>
          <h4 className="font-bold text-slate-200">실시간 매치 조작 가이드</h4>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-bold font-mono text-indigo-400">W, A, S, D</span>
            <span>이동 (8방향)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-bold font-mono text-indigo-400">L 키</span>
            <span>던지기 (꾹 눌러서 파워 샷 충전)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-slate-950 border border-slate-800 px-2 py-0.5 rounded font-bold font-mono text-indigo-400">K 키</span>
            <span>반격/패링 (0.2초 식칼 반사 배리어)</span>
          </div>
        </div>
      </div>
    </div>
  );
};
