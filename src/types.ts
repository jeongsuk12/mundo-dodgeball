export interface Player {
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
  comboCount?: number;
  feverActiveUntil?: number;
}

export interface Cleaver {
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

export interface GameRoom {
  id: string;
  name: string;
  isPrivate: boolean;
  password?: string;
  matchLimit: number;
  status: "waiting" | "playing" | "ended";
  gameState: "lobby" | "countdown" | "ongoing" | "roundOver" | "gameOver";
  countdown: number;
  winnerId?: string;
  players: Record<string, Player>;
  cleavers: Cleaver[];
  roundNumber: number;
}

export interface ActiveRoomBrief {
  id: string;
  name: string;
  isPrivate: boolean;
  matchLimit: number;
  status: "waiting" | "playing" | "ended";
  playerCount: number;
}

export const JERSEY_COLORS = [
  "#FF0000", "#FF4500", "#FF8C00", "#FFA500", "#FFD700", "#FFFF00",
  "#ADFF2F", "#7FFF00", "#00FF00", "#32CD32", "#00FA9A", "#00FFFF",
  "#00BFFF", "#1E90FF", "#0000FF", "#8A2BE2", "#9400D3", "#D81B60",
  "#FF1493", "#FF69B4", "#BA55D3", "#8B008B", "#4B0082", "#3F51B5",
  "#009688", "#4CAF50", "#8BC34A", "#CDDC39", "#FFEB3B", "#FFC107",
  "#FF9800", "#FF5722", "#795548", "#9E9E9E", "#607D8B", "#333333"
];

export const CANVAS_WIDTH = 1000;
export const CANVAS_HEIGHT = 600;
