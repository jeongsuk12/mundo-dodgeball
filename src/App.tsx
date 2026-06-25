import React, { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { GameRoom, ActiveRoomBrief, JERSEY_COLORS, Player } from "./types";
import { GameCanvas } from "./components/GameCanvas";
import { audioSynth } from "./utils/audioSynth";
import {
  Trophy,
  Users,
  PlusCircle,
  Lock,
  Unlock,
  Volume2,
  VolumeX,
  ArrowLeft,
  Play,
  CheckCircle,
  ShieldAlert,
  User,
  ExternalLink,
  Flame,
  FileText,
  Gamepad2
} from "lucide-react";

export default function App() {
  // Socket Connection
  const [socket, setSocket] = useState<Socket | null>(null);
  const [yourId, setYourId] = useState<string>("");

  // User details
  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem("mundo_nickname") || "무명의달인";
  });
  const [selectedColor, setSelectedColor] = useState<string>(() => {
    return localStorage.getItem("mundo_jersey_color") || JERSEY_COLORS[0];
  });

  // Game/Room State
  const [joinedRoomId, setJoinedRoomId] = useState<string>("");
  const [roomState, setRoomState] = useState<GameRoom | null>(null);
  const [activeRooms, setActiveRooms] = useState<ActiveRoomBrief[]>([]);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [showJoinModal, setShowJoinModal] = useState<boolean>(false);
  const [selectedRoomToJoin, setSelectedRoomToJoin] = useState<ActiveRoomBrief | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Form states
  const [createForm, setCreateForm] = useState({
    name: "",
    isPrivate: false,
    password: "",
    matchLimit: 3, // best of 3
  });
  const [joinPassword, setJoinPassword] = useState("");

  // Notification states
  const [hasNotificationPermission, setHasNotificationPermission] = useState<boolean>(false);

  // Track page visibility for notifications
  const isTabHiddenRef = useRef<boolean>(false);

  useEffect(() => {
    localStorage.setItem("mundo_nickname", userName);
  }, [userName]);

  useEffect(() => {
    localStorage.setItem("mundo_jersey_color", selectedColor);
  }, [selectedColor]);

  // Request notifications permission on start
  useEffect(() => {
    if ("Notification" in window) {
      if (Notification.permission === "granted") {
        setHasNotificationPermission(true);
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          setHasNotificationPermission(permission === "granted");
        });
      }
    }

    const handleVisibilityChange = () => {
      isTabHiddenRef.current = document.visibilityState === "hidden";
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  // Initialize Socket Connection
  useEffect(() => {
    // Connects directly to the origin since Express & Sockets run on same port 3000
    const newSocket = io(window.location.origin, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      setYourId(newSocket.id || "");
    });

    newSocket.on("room:list", (list: ActiveRoomBrief[]) => {
      setActiveRooms(list);
    });

    newSocket.on("room:joined", (data: { roomId: string; roomState: GameRoom; yourId: string }) => {
      setJoinedRoomId(data.roomId);
      setRoomState(data.roomState);
      setYourId(data.yourId);
      setErrorMessage("");
    });

    newSocket.on("room:state", (state: GameRoom) => {
      setRoomState(state);
    });

    newSocket.on("game:tick", (data: { players: Record<string, Player>; cleavers: any[] }) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          players: { ...prev.players, ...data.players },
          cleavers: data.cleavers,
        };
      });
    });

    newSocket.on("cleavers:update", (cleavers: any[]) => {
      setRoomState((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          cleavers,
        };
      });
    });

    newSocket.on("countdown:tick", (count: number) => {
      if (count > 0) {
        audioSynth.playCountdown(false);
      } else {
        audioSynth.playCountdown(true);
      }
    });

    newSocket.on("sound:trigger", (data: { type: "throw" | "hit" | "parry" | "countdown" }) => {
      if (data.type === "throw") audioSynth.playThrow();
      if (data.type === "hit") audioSynth.playHit();
      if (data.type === "parry") audioSynth.playParry();
      if (data.type === "countdown") audioSynth.playCountdown(false);
    });

    newSocket.on("error", (msg: string) => {
      setErrorMessage(msg);
      // Automatically clear error messages after 4 seconds
      setTimeout(() => setErrorMessage(""), 4000);
    });

    // Handle Opponent Entrances for Notifications
    newSocket.on("notification:challenger_entered", (data: { challengerName: string }) => {
      if (isTabHiddenRef.current && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification("Mundo Dodgeball - 대전 매칭 완료!", {
            body: `새로운 도전자 '${data.challengerName}'님이 입장했습니다! 지금 탭으로 돌아와 경기를 시작하세요.`,
            icon: "/favicon.ico",
          });
        } catch (err) {
          console.error("Web Notification failed to trigger:", err);
        }
      }
    });

    newSocket.on("opponent:disconnected", (opponentName: string) => {
      setErrorMessage(`상대방 (${opponentName})이 퇴장하였습니다. 대기 상태로 전환됩니다.`);
      setTimeout(() => setErrorMessage(""), 6000);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Lobby actions
  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket) return;
    audioSynth.ensureContextResumed();

    socket.emit("room:create", {
      name: createForm.name || `${userName}의 대결방`,
      isPrivate: createForm.isPrivate,
      password: createForm.isPrivate ? createForm.password : undefined,
      matchLimit: createForm.matchLimit,
      userName: userName || "호스트",
      userColor: selectedColor,
    });

    setShowCreateModal(false);
    // Reset create form
    setCreateForm({
      name: "",
      isPrivate: false,
      password: "",
      matchLimit: 3,
    });
  };

  const handleJoinRoom = (room: ActiveRoomBrief) => {
    if (!socket) return;
    audioSynth.ensureContextResumed();

    if (room.isPrivate) {
      setSelectedRoomToJoin(room);
      setShowJoinModal(true);
    } else {
      socket.emit("room:join", {
        roomId: room.id,
        userName: userName || "도전자",
        userColor: selectedColor,
      });
    }
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !selectedRoomToJoin) return;
    audioSynth.ensureContextResumed();

    socket.emit("room:join", {
      roomId: selectedRoomToJoin.id,
      password: joinPassword,
      userName: userName || "도전자",
      userColor: selectedColor,
    });

    setShowJoinModal(false);
    setJoinPassword("");
    setSelectedRoomToJoin(null);
  };

  const handleLeaveRoom = () => {
    if (!socket || !joinedRoomId) return;
    socket.emit("room:leave", { roomId: joinedRoomId });
    setJoinedRoomId("");
    setRoomState(null);
  };

  const toggleReady = () => {
    if (!socket || !joinedRoomId) return;
    socket.emit("player:toggle_ready", { roomId: joinedRoomId });
  };

  const selectColorInLobby = (color: string) => {
    setSelectedColor(color);
    if (socket && joinedRoomId && roomState) {
      socket.emit("player:change_color", { roomId: joinedRoomId, color });
    }
  };

  const toggleMute = () => {
    const nextMuted = audioSynth.toggleMute();
    setIsMuted(nextMuted);
  };

  // Get active self and opponent players from room state
  const me = roomState?.players?.[yourId];
  const opponentId = roomState ? Object.keys(roomState.players).find((id) => id !== yourId) : null;
  const opponent = opponentId ? roomState?.players?.[opponentId] : null;
  const playersList = (roomState ? Object.values(roomState.players) : []) as Player[];

  return (
    <div className="min-h-screen text-slate-100 flex flex-col justify-between font-sans bg-slate-950">

      {/* 1. Header Area with Brand logo */}
      <header className="h-16 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between px-6 sticky top-0 z-40 backdrop-blur-md">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-black tracking-tighter text-indigo-400 italic">
            MUNDO DODGEBALL <span className="text-slate-100 not-italic text-sm font-normal ml-2 hidden sm:inline">문도 피구</span>
          </h1>
          <div className="h-4 w-px bg-slate-700 hidden md:block"></div>
          <nav className="hidden md:flex gap-4 text-sm font-bold uppercase tracking-widest text-slate-400">
            <span className="text-indigo-400 cursor-pointer">로비</span>
            <span className="hover:text-slate-200 cursor-pointer">프로필</span>
            <span className="hover:text-slate-200 cursor-pointer">랭킹</span>
            <span className="hover:text-slate-200 cursor-pointer">상점</span>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded-full border border-slate-700">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-xs font-mono tracking-tight text-slate-300">연결됨: 12ms</span>
          </div>
          <button
            onClick={toggleMute}
            className="p-2 hover:bg-slate-800 rounded-lg text-xs font-semibold text-slate-300 flex items-center gap-1.5"
            id="header-mute-btn"
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-500" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            <span className="hidden sm:inline">{isMuted ? "소리 끔" : "소리 켬"}</span>
          </button>
          <div className="w-8 h-8 bg-indigo-500 rounded-full border-2 border-white flex items-center justify-center font-bold text-slate-950 shadow-md">
            {userName ? userName.slice(0, 1).toUpperCase() : "M"}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto px-4 py-6 w-full flex flex-col gap-6">

        {/* Floating Error/Status Banners */}
        {errorMessage && (
          <div className="bg-rose-950/85 border border-rose-500/50 text-rose-100 px-4 py-3 rounded-2xl text-sm flex items-center gap-3 animate-bounce shadow-lg">
            <ShieldAlert className="w-5 h-5 text-rose-500 flex-shrink-0" />
            <p className="font-medium">{errorMessage}</p>
          </div>
        )}

        {/* GAME SCREEN ACTIVE */}
        {joinedRoomId && roomState ? (
          <div className="flex flex-col gap-6">

            {/* Scoreboard and Match Metadata */}
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-3xl shadow-xl flex flex-col gap-4">

              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <button
                  onClick={handleLeaveRoom}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl transition-all border border-slate-700 flex items-center gap-2"
                  id="leave-room-btn"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  대기실로 나가기
                </button>

                <div className="text-center">
                  <span className="text-xs text-indigo-400 font-bold uppercase tracking-widest bg-indigo-950/50 px-2.5 py-1 rounded-full border border-indigo-500/30">
                    ROUND {roomState.roundNumber}
                  </span>
                  <p className="text-xs text-slate-400 mt-1">
                    {roomState.matchLimit}판 {Math.ceil(roomState.matchLimit / 2)}선승제
                  </p>
                </div>

                <div className="text-xs bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 font-mono text-slate-400">
                  ID: <span className="text-indigo-400 font-bold">{roomState.id}</span>
                </div>
              </div>

              {/* Match Score UI */}
              <div className="grid grid-cols-3 items-center gap-4 py-2">
                {/* Left Player Score (Host) */}
                <div className="text-right flex flex-col items-end pr-4 border-r border-slate-800">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-3.5 h-3.5 rounded-full inline-block"
                      style={{ backgroundColor: playersList[0]?.color || "#FF0000" }}
                    />
                    <span className="font-bold text-base md:text-lg text-white">
                      {playersList[0]?.name || "대기 중..."}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">LEFT SIDE (RED)</div>
                  <div className="text-2xl md:text-3xl font-display font-extrabold text-indigo-400 mt-2">
                    {playersList[0]?.score || 0}승
                  </div>
                </div>

                {/* Match Center Divider / VS */}
                <div className="text-center flex flex-col items-center justify-center">
                  <span className="bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-full text-xs font-black tracking-widest border border-indigo-500/20">
                    VS
                  </span>
                  <div className="text-[10px] text-slate-400 mt-2 capitalize bg-slate-950 px-2 py-1 rounded border border-slate-800">
                    상태: {roomState.gameState === "lobby" ? "대기실" : roomState.gameState === "countdown" ? "카운트다운" : "진행중"}
                  </div>
                </div>

                {/* Right Player Score (Challenger) */}
                <div className="text-left flex flex-col items-start pl-4 border-l border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-base md:text-lg text-white">
                      {playersList[1]?.name || "대기 중..."}
                    </span>
                    <span
                      className="w-3.5 h-3.5 rounded-full inline-block"
                      style={{ backgroundColor: playersList[1]?.color || "#00FFFF" }}
                    />
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">RIGHT SIDE (BLUE)</div>
                  <div className="text-2xl md:text-3xl font-display font-extrabold text-indigo-400 mt-2">
                    {playersList[1]?.score || 0}승
                  </div>
                </div>
              </div>

            </div>

            {/* LOBBY / LOCK-IN JERSEY STAGE */}
            {roomState.gameState === "lobby" && (
              <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl flex flex-col gap-6">

                <div className="text-center max-w-lg mx-auto">
                  <h3 className="text-lg font-bold text-slate-200">경기 대기실 & 유니폼 선택</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    상대 플레이어가 입장하면 유니폼 컬러를 선택하고 준비를 완료해 주세요. 양쪽 모두 준비 시 게임이 자동 시작됩니다.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Left Side: Jersey Selector */}
                  <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800/80">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                      <Gamepad2 className="w-4 h-4 text-indigo-400" />
                      유니폼 색상 피커 ({JERSEY_COLORS.length}개 색상)
                    </h4>

                    {/* 6x6 Color Matrix Grid */}
                    <div className="grid grid-cols-6 gap-2">
                      {JERSEY_COLORS.map((color) => {
                        const isTakenByOpponent = opponent && opponent.color === color;
                        const isSelectedByMe = me && me.color === color;

                        return (
                          <button
                            key={color}
                            onClick={() => !isTakenByOpponent && selectColorInLobby(color)}
                            disabled={!!isTakenByOpponent}
                            style={{ backgroundColor: color }}
                            className={`aspect-square rounded-lg relative cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-inner border-2 ${isSelectedByMe
                              ? "border-white ring-2 ring-indigo-500/50 scale-105 z-10"
                              : isTakenByOpponent
                                ? "border-slate-800 opacity-20 cursor-not-allowed"
                                : "border-slate-800 hover:border-slate-400"
                              }`}
                            title={isTakenByOpponent ? "상대방이 선택 중" : color}
                          >
                            {isSelectedByMe && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/25 rounded-lg">
                                <CheckCircle className="w-4 h-4 text-white" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Right Side: Players State and Ready Button */}
                  <div className="flex flex-col justify-between bg-slate-950 p-5 rounded-2xl border border-slate-800/80 gap-6">
                    <div className="flex flex-col gap-4">
                      <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-400" />
                        참가자 상태 확인
                      </h4>

                      <div className="flex flex-col gap-3">
                        {/* Me Status */}
                        {me && (
                          <div className="bg-slate-900 px-4 py-3 rounded-xl border border-slate-800 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="w-4 h-4 rounded-full border border-white" style={{ backgroundColor: me.color }} />
                              <span className="font-bold text-slate-200">{me.name} (나)</span>
                            </div>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${me.ready ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-400"}`}>
                              {me.ready ? "준비 완료" : "대기 중"}
                            </span>
                          </div>
                        )}

                        {/* Opponent Status */}
                        <div className="bg-slate-900 px-4 py-3 rounded-xl border border-slate-800 flex items-center justify-between">
                          {opponent ? (
                            <>
                              <div className="flex items-center gap-3">
                                <span className="w-4 h-4 rounded-full border border-white" style={{ backgroundColor: opponent.color }} />
                                <span className="font-bold text-slate-200">{opponent.name}</span>
                              </div>
                              <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${opponent.ready ? "bg-emerald-950 text-emerald-400 border border-emerald-500/30" : "bg-slate-800 text-slate-400"}`}>
                                {opponent.ready ? "준비 완료" : "대기 중"}
                              </span>
                            </>
                          ) : (
                            <div className="text-slate-500 text-xs py-1.5 italic text-center w-full">
                              도전자가 오기를 기다리고 있습니다... 방 번호를 알려주세요!
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Action Ready Trigger */}
                    {me && (
                      <button
                        onClick={toggleReady}
                        className={`w-full py-4 rounded-2xl font-bold uppercase tracking-wider text-sm transition-all border shadow-lg flex items-center justify-center gap-2 ${me.ready
                          ? "bg-indigo-950 hover:bg-indigo-900/90 text-indigo-100 border-indigo-500/40"
                          : "bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 font-extrabold"
                          }`}
                        id="ready-toggle-btn"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        {me.ready ? "준비 완료 취소" : "매치 시작 준비 완료!"}
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}

            {/* ACTIVE IN-GAME SCREEN - CANVAS RENDERING */}
            {(roomState.gameState === "ongoing" || roomState.gameState === "countdown" || roomState.gameState === "roundOver") && (
              <div className="flex flex-col items-center">
                <GameCanvas
                  socket={socket}
                  roomId={joinedRoomId}
                  roomState={roomState}
                  yourId={yourId}
                />
              </div>
            )}

            {/* GAME OVER MATCH REPORT */}
            {roomState.gameState === "gameOver" && (
              <div className="bg-slate-900 border-2 border-indigo-500/50 p-8 rounded-3xl shadow-2xl flex flex-col items-center text-center max-w-2xl mx-auto gap-6 my-4 animate-fade-in">
                <div className="w-16 h-16 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/30">
                  <Trophy className="w-8 h-8 text-indigo-400 animate-bounce" />
                </div>

                <div>
                  <h3 className="text-2xl font-black text-white">경기 결과 보고서</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    총 {roomState.roundNumber}라운드의 기나긴 사투 끝에 진정한 피구 전설이 탄생했습니다.
                  </p>
                </div>

                <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 w-full flex flex-col items-center gap-2">
                  <span className="text-xs text-indigo-400 uppercase tracking-widest font-bold bg-indigo-950/40 px-3 py-1 rounded-full border border-indigo-500/20">
                    최종 승리자 (WINNER)
                  </span>

                  <div className="flex items-center gap-3 mt-1">
                    <span
                      className="w-5 h-5 rounded-full border border-white"
                      style={{ backgroundColor: roomState.players[roomState.winnerId || ""]?.color || "#6366F1" }}
                    />
                    <h2 className="text-2xl font-extrabold text-white">
                      {roomState.players[roomState.winnerId || ""]?.name || "무명의 전설"}
                    </h2>
                  </div>

                  <p className="text-xs text-slate-400 mt-2">
                    스코어: {playersList[0]?.name} ({playersList[0]?.score}승) vs {playersList[1]?.name} ({playersList[1]?.score}승)
                  </p>
                </div>

                <button
                  onClick={handleLeaveRoom}
                  className="w-full sm:w-auto px-8 py-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm rounded-2xl transition-all border border-indigo-400 hover:shadow-indigo-500/20 hover:shadow-lg"
                  id="game-over-return-btn"
                >
                  대기실 로비로 돌아가기
                </button>
              </div>
            )}

          </div>
        ) : (
          /* LOBBY INTERFACE DEFAULT */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Left Section: Active Room List */}
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="flex justify-between items-end mb-2">
                <h2 className="text-xl font-bold border-l-4 border-indigo-500 pl-3 flex items-center gap-2 text-slate-100">
                  활성 게임 방
                </h2>
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-indigo-950/40 transition-all text-xs flex items-center gap-1.5"
                  id="create-room-open-btn"
                >
                  <PlusCircle className="w-4 h-4" />
                  방 만들기 (+)
                </button>
              </div>

              <div className="flex-1 bg-slate-900/80 border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-xl">
                <div className="grid grid-cols-12 text-[10px] uppercase font-bold text-slate-500 px-4 py-3 border-b border-slate-800 tracking-widest bg-slate-900">
                  <div className="col-span-6">방 제목</div>
                  <div className="col-span-2 text-center">경기 방식</div>
                  <div className="col-span-2 text-center">인원</div>
                  <div className="col-span-2 text-right">상태</div>
                </div>

                <div className="flex-1 overflow-y-auto max-h-[380px] divide-y divide-slate-800/40">
                  {activeRooms.length > 0 ? (
                    activeRooms.map((room) => (
                      <div
                        key={room.id}
                        className="grid grid-cols-12 items-center px-4 py-4 hover:bg-indigo-950/20 cursor-pointer transition-colors"
                        onClick={() => {
                          if (room.status !== "playing" && room.playerCount < 2) {
                            handleJoinRoom(room);
                          }
                        }}
                      >
                        <div className="col-span-6 font-bold text-slate-200 italic flex items-center gap-2">
                          <span className="truncate">{room.name}</span>
                          {room.isPrivate ? (
                            <span title="비밀방" className="inline-flex items-center">
                              <Lock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                            </span>
                          ) : (
                            <span title="공개방" className="inline-flex items-center">
                              <Unlock className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                            </span>
                          )}
                        </div>
                        <div className="col-span-2 text-center text-xs text-slate-400">
                          {room.matchLimit}판 {Math.ceil(room.matchLimit / 2)}선승
                        </div>
                        <div className={`col-span-2 text-center font-mono font-bold ${room.playerCount >= 2 ? "text-rose-400" : "text-emerald-400"}`}>
                          {room.playerCount}/2
                        </div>
                        <div className="col-span-2 text-right">
                          {room.status === "playing" ? (
                            <span className="bg-rose-500/10 text-rose-500 text-[10px] px-2 py-1 rounded-full border border-rose-500/20 font-bold uppercase tracking-tighter">
                              경기 진행 중
                            </span>
                          ) : room.playerCount >= 2 ? (
                            <span className="bg-slate-800 text-slate-400 text-[10px] px-2 py-1 rounded-full border border-slate-700 font-bold uppercase tracking-tighter">
                              가득 참
                            </span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJoinRoom(room);
                              }}
                              className="bg-indigo-600 hover:bg-indigo-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all shadow"
                              id={`join-btn-${room.id}`}
                            >
                              도전하기
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-12 flex flex-col items-center justify-center gap-3 bg-slate-950/40 rounded-2xl border-none">
                      <div className="w-12 h-12 rounded-full bg-slate-900 border border-slate-800 flex items-center justify-center">
                        <Users className="w-5 h-5 text-slate-600" />
                      </div>
                      <div>
                        <p className="font-bold text-slate-400 text-sm">대기 중인 피구 경기가 없습니다.</p>
                        <p className="text-xs text-slate-600 mt-1 max-w-xs mx-auto">
                          상단의 &apos;방 만들기 (+)&apos; 버튼을 통해 방을 개설하고 피구 결투사를 모집하세요!
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Match browser notification hint */}
                <div className="bg-slate-950/50 p-3 rounded-b-xl border-t border-slate-800 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                  <Flame className="w-4 h-4 text-indigo-400" />
                  {hasNotificationPermission ? (
                    <span>브라우저 알림 기능이 활성화되어 있어 매칭 완료 시 백그라운드 푸시가 발송됩니다.</span>
                  ) : (
                    <span>방을 개설해 둔 뒤, 다른 탭에 있어도 도전자가 입장하면 데스크톱 팝업 알림이 울립니다.</span>
                  )}
                </div>
              </div>
            </div>

            {/* Right Section: Customization & Profile */}
            <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col gap-5 shadow-xl">
              <h2 className="text-lg font-bold flex items-center justify-between border-b border-slate-800 pb-3">
                캐릭터 커스터마이징
                <span className="text-[10px] bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded font-mono">
                  UNI_ID: {yourId ? yourId.slice(0, 5).toUpperCase() : "9942"}
                </span>
              </h2>

              {/* Nickname input */}
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">나의 피구 닉네임</label>
                <input
                  type="text"
                  maxLength={10}
                  value={userName}
                  onChange={(e) => setUserName(e.target.value.substring(0, 10))}
                  placeholder="닉네임을 입력하세요 (최대 10자)"
                  className="bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 text-white rounded-xl px-4 py-2.5 text-sm transition-all focus:outline-none focus:ring-1 focus:ring-indigo-500 font-medium"
                  id="nickname-input"
                />
              </div>

              {/* Character preview */}
              <div className="aspect-square bg-slate-950 rounded-lg border border-slate-800 relative flex items-center justify-center overflow-hidden">
                <div className="w-20 h-28 bg-slate-900 border border-slate-800 rounded-xl relative flex flex-col items-center justify-center shadow-inner">
                  {/* Head */}
                  <div className="w-6 h-6 rounded-full bg-pink-200 border border-slate-950 relative">
                    <div className="w-4 h-1.5 bg-indigo-600 absolute top-0 left-1 rounded-t-full" /> {/* Headband */}
                    <div className="w-1 h-1 bg-black absolute top-2 right-1.5" /> {/* Eyes */}
                    <div className="w-1 h-1 bg-black absolute top-2 right-3" />
                  </div>
                  {/* Jersey */}
                  <div className="w-10 h-10 rounded-md border border-slate-950 mt-1" style={{ backgroundColor: selectedColor }} />
                  {/* Shorts */}
                  <div className="w-10 h-3 bg-slate-800 border-x border-b border-slate-950" />
                  {/* Feet */}
                  <div className="flex gap-2.5 mt-1">
                    <div className="w-2.5 h-3 bg-pink-200 border border-slate-950" />
                    <div className="w-2.5 h-3 bg-pink-200 border border-slate-950" />
                  </div>
                </div>
                <div className="absolute bottom-2 left-0 right-0 text-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">미리보기 (Preview)</div>
                </div>
              </div>

              {/* Jersey colors matrix selector */}
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">유니폼 색상 ({JERSEY_COLORS.length} Colors)</label>
                <div className="grid grid-cols-6 gap-2">
                  {JERSEY_COLORS.map((color) => (
                    <button
                      key={color}
                      onClick={() => selectColorInLobby(color)}
                      style={{ backgroundColor: color }}
                      className={`w-full aspect-square rounded cursor-pointer transition-all border ${selectedColor === color
                        ? "ring-2 ring-indigo-500 ring-offset-2 ring-offset-slate-900 border-white scale-105"
                        : "border-slate-800 hover:border-slate-600"
                        }`}
                      id={`jersey-btn-${color.replace("#", "")}`}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>

          </div>
        )}

      </main>

      {/* 2. Modals */}
      {/* Create Room Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl relative">
            <h3 className="text-base font-extrabold text-white mb-1 flex items-center gap-2">
              <PlusCircle className="w-5 h-5 text-rose-500" />
              1대1 문도 피구 매치 룸 개설
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              경기 세팅 옵션을 구성하여 완벽한 실시간 멀티플레이어 환경을 준비하십시오.
            </p>

            <form onSubmit={handleCreateRoom} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">경기 방 이름</label>
                <input
                  type="text"
                  required
                  maxLength={16}
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value.substring(0, 16) })}
                  placeholder={`${userName}의 대결 구역`}
                  className="bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400">경기 승수 설정</label>
                  <select
                    value={createForm.matchLimit}
                    onChange={(e) => setCreateForm({ ...createForm, matchLimit: Number(e.target.value) })}
                    className="bg-slate-950 border border-slate-800 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    <option value={3}>3판 2선승제</option>
                    <option value={5}>5판 3선승제</option>
                    <option value={7}>7판 4선승제</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400">방 공개 옵션</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, isPrivate: false })}
                      className={`py-2 text-xs font-bold rounded-xl border ${!createForm.isPrivate
                        ? "bg-indigo-600 text-white border-indigo-400"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                        }`}
                    >
                      공개 방
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreateForm({ ...createForm, isPrivate: true })}
                      className={`py-2 text-xs font-bold rounded-xl border ${createForm.isPrivate
                        ? "bg-indigo-600 text-white border-indigo-400"
                        : "bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700"
                        }`}
                    >
                      비공개 방
                    </button>
                  </div>
                </div>
              </div>

              {createForm.isPrivate && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-slate-400">방 비밀번호</label>
                  <input
                    type="password"
                    required
                    maxLength={10}
                    value={createForm.password}
                    onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                    placeholder="입장 비밀번호 기입"
                    className="bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}

              <div className="flex gap-3 justify-end mt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-750 rounded-xl transition-all"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-xl transition-all"
                >
                  방 개설하기
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Join Room with Password Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-base font-extrabold text-white mb-1 flex items-center gap-2">
              <Lock className="w-4.5 h-4.5 text-indigo-400" />
              비밀 방 비밀번호 입력
            </h3>
            <p className="text-xs text-slate-400 mb-4">
              해당 대결 방은 암호화 설정되어 있습니다. 패스워드를 올바르게 입력하십시오.
            </p>

            <form onSubmit={handleJoinSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-400">패스워드</label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={joinPassword}
                  onChange={(e) => setJoinPassword(e.target.value)}
                  placeholder="비밀번호를 입력하세요"
                  className="bg-slate-950 border border-slate-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-3 justify-end mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowJoinModal(false);
                    setJoinPassword("");
                    setSelectedRoomToJoin(null);
                  }}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-750 rounded-xl transition-all"
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs rounded-xl transition-all"
                >
                  확인 후 대전참가
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. SEO & Monetization Layout */}
      <footer className="bg-slate-950 border-t border-slate-900/90 py-10">
        <div className="max-w-7xl mx-auto px-4">

          {/* AdSense slot placeholder banner style */}
          <div className="w-full bg-slate-900/50 border border-slate-800/80 rounded-2xl p-6 text-center max-w-4xl mx-auto mb-10">
            <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded uppercase font-mono tracking-widest font-extrabold">AD SPONSORSHIP</span>
            <h4 className="text-sm font-bold text-slate-300 mt-2">문도 피구 리그 공식 후원 파트너 모집 중</h4>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              구글 애드센스 및 공식 브랜드 배너가 렌더링되는 공식 비즈니스 슬롯 영역입니다.
            </p>
          </div>

          {/* Localized Rich Content Density Grid for SEO Indexing */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-slate-400 text-xs">

            {/* Guide Tips */}
            <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-900 flex flex-col gap-3">
              <h4 className="font-bold text-slate-200 text-sm flex items-center gap-2 border-b border-slate-800 pb-2">
                <Gamepad2 className="w-4 h-4 text-indigo-400" />
                [문도 피구 조작 가이드]
              </h4>
              <p className="leading-relaxed">
                본 게임은 8방향 자유 키보드 조작을 근간으로 삼습니다. <strong>W, A, S, D 키</strong>를 사용하여 피구 코트 내부를 자유롭게 비행하듯 누벼 보십시오.
                중앙에 뻗어 있는 Glowing Neon <strong>중앙선 (Center Line)</strong>은 그 어떠한 피구 선수도 넘어갈 수 없습니다. 적군 영역에 침입하여 몸싸움을 펼치는 행위는 원천 불가합니다.
              </p>
              <p className="leading-relaxed">
                <strong>&apos;L&apos; 키</strong>를 누르고 있으면 화면 하단에 에너지가 차오르는 캐스팅 게이지를 육안으로 식별할 수 있습니다.
                1초 동안 충전 시 맥시멈 파워 샷이 발사되어 피할 수 없을 정도의 가공할 투사체 속도로 직진합니다.
                반면, 상대방의 위협적인 가열 찬 식칼 칼날을 무력화하기 위해선 <strong>&apos;K&apos; 반격 키</strong> 타이밍을 숙달해야 합니다.
                반격막은 오직 0.2초 동안만 필드 상에 형상화되며, 피격과 정확히 맞닿을 시 날아오던 식칼이 1.4배의 가속도를 부여받아 원소유주를 향해 급속도로 튕겨져 나갑니다.
              </p>
            </div>

            {/* Official Patch notes */}
            <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-900 flex flex-col gap-3">
              <h4 className="font-bold text-slate-200 text-sm flex items-center gap-2 border-b border-slate-800 pb-2">
                <FileText className="w-4 h-4 text-indigo-400" />
                [공식 패치 노트]
              </h4>
              <p className="leading-relaxed">
                <strong>Ver 1.1.0 대전 조작법 개편 패치:</strong><br />
                - <strong>이동 조작 변경</strong>: 기존 방향키 조작에서 직관적이고 표준적인 <strong>W, A, S, D 8방향 이동</strong>으로 대폭 변경되었습니다.<br />
                - <strong>대시 기능 및 쿨타임 전면 제거</strong>: 연속적이고 부드러운 순수 피지컬 무빙 승부를 유도하기 위해 더블 탭 대시 기동 메커니즘을 삭제하였습니다.<br />
                - <strong>핵심 키바인딩 교체</strong>: 던지기 조작이 <strong>A 키에서 L 키</strong>로 변경되었으며, 반격/패링 조작이 <strong>S 키에서 K 키</strong>로 이관되어 왼손 이동과 오른손 공격 편의를 높였습니다.
              </p>
            </div>

            {/* Moving tips */}
            <div className="bg-slate-900/30 p-5 rounded-2xl border border-slate-900 flex flex-col gap-3">
              <h4 className="font-bold text-slate-200 text-sm flex items-center gap-2 border-b border-slate-800 pb-2">
                <Flame className="w-4 h-4 text-indigo-400" />
                [초보자를 위한 무빙 꿀팁]
              </h4>
              <p className="leading-relaxed">
                1. <strong>벽 반사를 적극 활용하십시오</strong>: 식칼 투사체는 맵의 상단 및 하단 단단한 외곽벽에 부딪히면 튕겨 나오는 물리 운동 법칙을 지니고 있습니다. 직선 궤도 이외에 대각선 반사각을 계산해 등 뒤를 공격해 보십시오.
              </p>
              <p className="leading-relaxed">
                2. <strong>반격(K) 쿨타임을 인지하십시오</strong>: 반격 시전 후 약 1.2초의 현자타임 쿨다운이 동반되므로, 무작정 K 키를 연타하면 게이지를 꽉 채워 날린 파워 샷의 영양가 있는 먹잇감이 될 수 있습니다. 적의 손동작 및 게이지 타이밍을 주시하고 확실한 순간에만 장벽을 활성화하십시오.
              </p>
              <p className="leading-relaxed">
                3. <strong>지속적인 무빙이 생명입니다</strong>: 이제 대시 회피가 없기 때문에 W, A, S, D 조작을 통한 정교하고 쉼 없는 기본 주행이 피격 확률을 대폭 낮춰 줍니다.
              </p>
            </div>

          </div>

          <div className="border-t border-slate-900 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-600 text-xs">
            <p>© 2026 Mundo Dodgeball League. All rights reserved.</p>
            <div className="flex items-center gap-4">
              <a href="#" className="hover:text-slate-400 flex items-center gap-1">공식 웹사이트 <ExternalLink className="w-3 h-3" /></a>
              <a href="#" className="hover:text-slate-400 flex items-center gap-1">개인정보처리방침</a>
            </div>
          </div>

        </div>
      </footer>

    </div>
  );
}
