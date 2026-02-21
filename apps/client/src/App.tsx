import { useState, useEffect, useRef, useCallback } from 'react';

// ============================================
// TYPES
// ============================================

interface Position {
  x: number;
  y: number;
}

interface Unit {
  type: 'infantry' | 'archer' | 'cavalry';
  count: number;
  level: number;
}

interface Player {
  id: string;
  name: string;
  faction: string;
  position: Position;
  gold: number;
  army: Unit[];
  color: string;
}

interface Territory {
  id: string;
  name: string;
  position: Position;
  owner: string | null;
  type: 'village' | 'castle' | 'city';
  income: number;
}

interface GameState {
  connected: boolean;
  playerId: string | null;
  player: Player | null;
  players: Player[];
  territories: Territory[];
  messages: ChatMessage[];
}

interface ChatMessage {
  id: string;
  name: string;
  faction: string;
  text: string;
  time: number;
}

// ============================================
// APP
// ============================================

export default function App() {
  const [screen, setScreen] = useState<'menu' | 'game'>('menu');
  const [playerName, setPlayerName] = useState('');
  const [gameState, setGameState] = useState<GameState>({
    connected: false,
    playerId: null,
    player: null,
    players: [],
    territories: [],
    messages: [],
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [camera, setCamera] = useState({ x: 50, y: 50, zoom: 1 });
  const [showPanel, setShowPanel] = useState<'none' | 'army' | 'chat'>('none');

  // Connect to server
  const connect = useCallback(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to server');
      setGameState(s => ({ ...s, connected: true }));
      ws.send(JSON.stringify({ type: 'join', name: playerName || 'Warrior' }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      console.log('Disconnected');
      setGameState(s => ({ ...s, connected: false }));
    };
  }, [playerName]);

  // Handle server messages
  const handleServerMessage = (msg: any) => {
    switch (msg.type) {
      case 'init':
        setGameState(s => ({
          ...s,
          playerId: msg.playerId,
          player: msg.player,
          players: msg.players,
          territories: msg.territories,
        }));
        setCamera({ x: msg.player.position.x, y: msg.player.position.y, zoom: 1 });
        break;

      case 'player_joined':
        setGameState(s => ({
          ...s,
          players: [...s.players.filter(p => p.id !== msg.player.id), msg.player],
        }));
        break;

      case 'player_left':
        setGameState(s => ({
          ...s,
          players: s.players.filter(p => p.id !== msg.playerId),
        }));
        break;

      case 'player_moved':
        setGameState(s => ({
          ...s,
          players: s.players.map(p =>
            p.id === msg.playerId ? { ...p, position: msg.position } : p
          ),
          player: s.playerId === msg.playerId ? { ...s.player!, position: msg.position } : s.player,
        }));
        break;

      case 'tick':
        setGameState(s => ({ ...s, players: msg.players }));
        break;

      case 'recruited':
        setGameState(s => ({ ...s, player: msg.player }));
        break;

      case 'gold_update':
        setGameState(s => s.player ? { ...s, player: { ...s.player, gold: msg.gold } } : s);
        break;

      case 'chat':
        setGameState(s => ({
          ...s,
          messages: [...s.messages.slice(-50), {
            id: `${Date.now()}`,
            name: msg.name,
            faction: msg.faction,
            text: msg.text,
            time: Date.now(),
          }],
        }));
        break;

      case 'battle_result':
        alert(`Battle ${msg.role === 'attacker' ? 'attacked' : 'defended'}!\n` +
          `Winner: ${msg.winner}\n` +
          `Your power: ${msg.role === 'attacker' ? msg.attackPower : msg.defensePower}\n` +
          `Loot: ${msg.loot} gold`);
        break;
    }
  };

  // Send message to server
  const send = (data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  // Handle canvas touch/click for movement
  const handleCanvasInteraction = (clientX: number, clientY: number) => {
    if (!canvasRef.current || !gameState.player) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    // Convert to world coordinates
    const worldX = camera.x + (canvasX - rect.width / 2) / (5 * camera.zoom);
    const worldY = camera.y + (canvasY - rect.height / 2) / (5 * camera.zoom);

    send({ type: 'move', x: worldX, y: worldY });
  };

  // Draw game
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const draw = () => {
      const w = rect.width;
      const h = rect.height;
      const scale = 5 * camera.zoom;

      // Clear
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Draw grid
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      for (let x = 0; x <= 100; x += 10) {
        const screenX = (x - camera.x) * scale + w / 2;
        ctx.beginPath();
        ctx.moveTo(screenX, 0);
        ctx.lineTo(screenX, h);
        ctx.stroke();
      }
      for (let y = 0; y <= 100; y += 10) {
        const screenY = (y - camera.y) * scale + h / 2;
        ctx.beginPath();
        ctx.moveTo(0, screenY);
        ctx.lineTo(w, screenY);
        ctx.stroke();
      }

      // Draw territories
      gameState.territories.forEach(t => {
        const screenX = (t.position.x - camera.x) * scale + w / 2;
        const screenY = (t.position.y - camera.y) * scale + h / 2;

        const size = t.type === 'city' ? 20 : t.type === 'castle' ? 15 : 10;

        // Territory marker
        ctx.fillStyle = t.owner
          ? gameState.players.find(p => p.faction === t.owner)?.color || '#475569'
          : '#475569';
        
        if (t.type === 'city') {
          // Star shape for cities
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * 72 - 90) * Math.PI / 180;
            const r = i % 2 === 0 ? size : size / 2;
            const px = screenX + Math.cos(angle) * r;
            const py = screenY + Math.sin(angle) * r;
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        } else if (t.type === 'castle') {
          // Square for castles
          ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
        } else {
          // Circle for villages
          ctx.beginPath();
          ctx.arc(screenX, screenY, size / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Name
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(t.name, screenX, screenY + size + 12);
      });

      // Draw other players
      gameState.players.forEach(p => {
        if (p.id === gameState.playerId) return;

        const screenX = (p.position.x - camera.x) * scale + w / 2;
        const screenY = (p.position.y - camera.y) * scale + h / 2;

        // Player marker
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 12, 0, Math.PI * 2);
        ctx.fill();

        // Name
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(p.name, screenX, screenY - 18);
        
        // Army size
        const armySize = p.army.reduce((sum, u) => sum + u.count, 0);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px system-ui';
        ctx.fillText(`⚔️ ${armySize}`, screenX, screenY + 22);
      });

      // Draw current player
      if (gameState.player) {
        const p = gameState.player;
        const screenX = (p.position.x - camera.x) * scale + w / 2;
        const screenY = (p.position.y - camera.y) * scale + h / 2;

        // Glow
        const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, 25);
        gradient.addColorStop(0, p.color + '80');
        gradient.addColorStop(1, 'transparent');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 25, 0, Math.PI * 2);
        ctx.fill();

        // Player marker
        ctx.fillStyle = p.color;
        ctx.strokeStyle = '#f8fafc';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(screenX, screenY, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Name with YOU indicator
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 12px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(`${p.name} (YOU)`, screenX, screenY - 22);
      }
    };

    draw();
    const interval = setInterval(draw, 50);
    return () => clearInterval(interval);
  }, [gameState, camera]);

  // Follow player with camera
  useEffect(() => {
    if (gameState.player) {
      setCamera(c => ({
        ...c,
        x: gameState.player!.position.x,
        y: gameState.player!.position.y,
      }));
    }
  }, [gameState.player?.position]);

  // ============================================
  // MENU SCREEN
  // ============================================

  if (screen === 'menu') {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 to-slate-950">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-2 float">⚔️</h1>
          <h2 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">
            Warband Mobile
          </h2>
          <p className="text-slate-400 mt-2">Multiplayer Medieval Warfare</p>
        </div>

        <div className="w-full max-w-sm space-y-4">
          <input
            type="text"
            placeholder="Enter your name..."
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            className="w-full px-4 py-4 bg-slate-800 border border-slate-700 rounded-2xl text-white placeholder-slate-500 text-center text-lg focus:outline-none focus:border-indigo-500"
            maxLength={20}
          />

          <button
            onClick={() => {
              connect();
              setScreen('game');
            }}
            className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold text-lg rounded-2xl shadow-lg shadow-indigo-500/30 active:scale-95 transition-transform"
          >
            ⚔️ Enter Battle
          </button>
        </div>

        <div className="mt-12 text-center text-slate-500 text-sm">
          <p>Move by tapping the map</p>
          <p>Build your army • Conquer territories • Fight players</p>
        </div>
      </div>
    );
  }

  // ============================================
  // GAME SCREEN
  // ============================================

  const player = gameState.player;
  const armySize = player?.army.reduce((sum, u) => sum + u.count, 0) || 0;

  return (
    <div className="h-full flex flex-col">
      {/* Top HUD */}
      <div className="glass p-3 m-2 rounded-2xl flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold"
            style={{ backgroundColor: player?.color || '#6366f1' }}
          >
            {player?.name?.charAt(0) || '?'}
          </div>
          <div>
            <p className="font-bold text-white">{player?.name || 'Loading...'}</p>
            <p className="text-xs text-slate-400">{player?.faction}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-yellow-400 font-bold">💰 {player?.gold || 0}</p>
            <p className="text-xs text-slate-400">⚔️ {armySize} troops</p>
          </div>
        </div>
      </div>

      {/* Game Canvas */}
      <canvas
        ref={canvasRef}
        className="flex-1 game-canvas"
        onClick={(e) => handleCanvasInteraction(e.clientX, e.clientY)}
        onTouchStart={(e) => {
          const touch = e.touches[0];
          handleCanvasInteraction(touch.clientX, touch.clientY);
        }}
      />

      {/* Bottom Controls */}
      <div className="glass p-3 m-2 rounded-2xl">
        <div className="flex gap-2">
          <button
            onClick={() => setShowPanel(showPanel === 'army' ? 'none' : 'army')}
            className={`flex-1 py-3 rounded-xl font-medium transition-colors ${
              showPanel === 'army' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            🛡️ Army
          </button>
          <button
            onClick={() => setShowPanel(showPanel === 'chat' ? 'none' : 'chat')}
            className={`flex-1 py-3 rounded-xl font-medium transition-colors ${
              showPanel === 'chat' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300'
            }`}
          >
            💬 Chat
          </button>
          <button
            onClick={() => setCamera(c => ({ ...c, zoom: Math.min(c.zoom + 0.2, 2) }))}
            className="px-4 py-3 rounded-xl bg-slate-700 text-slate-300"
          >
            +
          </button>
          <button
            onClick={() => setCamera(c => ({ ...c, zoom: Math.max(c.zoom - 0.2, 0.5) }))}
            className="px-4 py-3 rounded-xl bg-slate-700 text-slate-300"
          >
            -
          </button>
        </div>

        {/* Army Panel */}
        {showPanel === 'army' && player && (
          <div className="mt-3 p-4 bg-slate-800 rounded-xl space-y-3">
            <h3 className="font-bold text-white">Your Army</h3>
            {player.army.map((unit) => (
              <div key={unit.type} className="flex items-center justify-between">
                <span className="text-slate-300 capitalize">
                  {unit.type === 'infantry' ? '🗡️' : unit.type === 'archer' ? '🏹' : '🐴'} {unit.type}
                </span>
                <span className="text-white font-bold">{unit.count}</span>
              </div>
            ))}
            <hr className="border-slate-700" />
            <div className="flex gap-2">
              <button
                onClick={() => send({ type: 'recruit', unitType: 'infantry', count: 10 })}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm text-slate-300"
              >
                +10 🗡️ (500g)
              </button>
              <button
                onClick={() => send({ type: 'recruit', unitType: 'archer', count: 5 })}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm text-slate-300"
              >
                +5 🏹 (375g)
              </button>
              <button
                onClick={() => send({ type: 'recruit', unitType: 'cavalry', count: 3 })}
                className="flex-1 py-2 bg-slate-700 rounded-lg text-sm text-slate-300"
              >
                +3 🐴 (450g)
              </button>
            </div>
          </div>
        )}

        {/* Chat Panel */}
        {showPanel === 'chat' && (
          <div className="mt-3 p-4 bg-slate-800 rounded-xl">
            <div className="h-32 overflow-y-auto space-y-2 mb-3">
              {gameState.messages.length === 0 ? (
                <p className="text-slate-500 text-sm">No messages yet...</p>
              ) : (
                gameState.messages.map((msg) => (
                  <div key={msg.id} className="text-sm">
                    <span className="text-indigo-400 font-medium">{msg.name}</span>
                    <span className="text-slate-500"> ({msg.faction}): </span>
                    <span className="text-slate-300">{msg.text}</span>
                  </div>
                ))
              )}
            </div>
            <input
              type="text"
              placeholder="Type message..."
              className="w-full px-3 py-2 bg-slate-700 rounded-lg text-white placeholder-slate-500 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value) {
                  send({ type: 'chat', text: e.currentTarget.value });
                  e.currentTarget.value = '';
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Online Players */}
      <div className="absolute top-20 right-2 glass p-2 rounded-xl">
        <p className="text-xs text-slate-400 mb-1">Online: {gameState.players.length}</p>
        {gameState.players.slice(0, 5).map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs py-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-slate-300">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
