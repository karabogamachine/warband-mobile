import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';

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
  ws?: WebSocket;
}

interface Territory {
  id: string;
  name: string;
  position: Position;
  owner: string | null;
  type: 'village' | 'castle' | 'city';
  income: number;
}

interface Battle {
  id: string;
  attackerId: string;
  defenderId: string | null;
  territory?: string;
  phase: 'preparing' | 'fighting' | 'ended';
  startTime: number;
}

interface GameState {
  players: Map<string, Player>;
  territories: Territory[];
  battles: Map<string, Battle>;
  tick: number;
}

// ============================================
// GAME CONSTANTS
// ============================================

const MAP_SIZE = 100;
const FACTIONS = ['Swadia', 'Vaegirs', 'Khergit', 'Nord', 'Rhodok', 'Sarranid'];
const FACTION_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899'];

const UNIT_STATS = {
  infantry: { attack: 10, defense: 15, speed: 1, cost: 50 },
  archer: { attack: 15, defense: 5, speed: 1, cost: 75 },
  cavalry: { attack: 20, defense: 10, speed: 2, cost: 150 },
};

// ============================================
// GAME STATE
// ============================================

const state: GameState = {
  players: new Map(),
  territories: generateTerritories(),
  battles: new Map(),
  tick: 0,
};

function generateTerritories(): Territory[] {
  const territories: Territory[] = [];
  const names = [
    'Praven', 'Suno', 'Dhirim', 'Rivacheg', 'Khudan', 'Curaw',
    'Tulga', 'Narra', 'Bariyye', 'Shariz', 'Durquba', 'Ahmerrad',
    'Veluca', 'Jelkala', 'Yalen', 'Sargoth', 'Tihr', 'Wercheg'
  ];
  
  for (let i = 0; i < names.length; i++) {
    territories.push({
      id: `territory_${i}`,
      name: names[i],
      position: {
        x: 10 + Math.random() * 80,
        y: 10 + Math.random() * 80,
      },
      owner: i < 6 ? FACTIONS[i] : null,
      type: i < 6 ? 'city' : i < 12 ? 'castle' : 'village',
      income: i < 6 ? 500 : i < 12 ? 200 : 100,
    });
  }
  
  return territories;
}

// ============================================
// WEBSOCKET SERVER
// ============================================

const wss = new WebSocketServer({ port: 3001 });
console.log('⚔️  Warband server running on ws://localhost:3001');

wss.on('connection', (ws) => {
  const playerId = uuid();
  console.log(`Player connected: ${playerId}`);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      handleMessage(playerId, message, ws);
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    const player = state.players.get(playerId);
    if (player) {
      console.log(`Player disconnected: ${player.name}`);
      state.players.delete(playerId);
      broadcast({ type: 'player_left', playerId });
    }
  });
});

// ============================================
// MESSAGE HANDLERS
// ============================================

function handleMessage(playerId: string, message: any, ws: WebSocket) {
  switch (message.type) {
    case 'join':
      handleJoin(playerId, message, ws);
      break;
    case 'move':
      handleMove(playerId, message);
      break;
    case 'recruit':
      handleRecruit(playerId, message);
      break;
    case 'attack':
      handleAttack(playerId, message);
      break;
    case 'chat':
      handleChat(playerId, message);
      break;
  }
}

function handleJoin(playerId: string, message: { name: string }, ws: WebSocket) {
  const factionIndex = state.players.size % FACTIONS.length;
  
  const player: Player = {
    id: playerId,
    name: message.name || `Warrior_${playerId.slice(0, 4)}`,
    faction: FACTIONS[factionIndex],
    position: { x: 20 + Math.random() * 60, y: 20 + Math.random() * 60 },
    gold: 1000,
    army: [
      { type: 'infantry', count: 20, level: 1 },
      { type: 'archer', count: 10, level: 1 },
    ],
    color: FACTION_COLORS[factionIndex],
    ws,
  };
  
  state.players.set(playerId, player);
  
  // Send initial state to player
  send(ws, {
    type: 'init',
    playerId,
    player: sanitizePlayer(player),
    players: Array.from(state.players.values()).map(sanitizePlayer),
    territories: state.territories,
  });
  
  // Broadcast new player to others
  broadcast({ type: 'player_joined', player: sanitizePlayer(player) }, playerId);
  
  console.log(`${player.name} joined as ${player.faction}`);
}

function handleMove(playerId: string, message: { x: number; y: number }) {
  const player = state.players.get(playerId);
  if (!player) return;
  
  // Validate movement
  const dx = message.x - player.position.x;
  const dy = message.y - player.position.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  const maxSpeed = getArmySpeed(player.army);
  if (distance > maxSpeed * 5) {
    // Too fast, limit movement
    const ratio = (maxSpeed * 5) / distance;
    message.x = player.position.x + dx * ratio;
    message.y = player.position.y + dy * ratio;
  }
  
  // Clamp to map
  player.position.x = Math.max(0, Math.min(MAP_SIZE, message.x));
  player.position.y = Math.max(0, Math.min(MAP_SIZE, message.y));
  
  broadcast({
    type: 'player_moved',
    playerId,
    position: player.position,
  });
}

function handleRecruit(playerId: string, message: { unitType: string; count: number }) {
  const player = state.players.get(playerId);
  if (!player) return;
  
  const unitType = message.unitType as keyof typeof UNIT_STATS;
  const stats = UNIT_STATS[unitType];
  if (!stats) return;
  
  const cost = stats.cost * message.count;
  if (player.gold < cost) {
    send(player.ws!, { type: 'error', message: 'Not enough gold' });
    return;
  }
  
  player.gold -= cost;
  
  const existing = player.army.find(u => u.type === unitType);
  if (existing) {
    existing.count += message.count;
  } else {
    player.army.push({ type: unitType, count: message.count, level: 1 });
  }
  
  send(player.ws!, {
    type: 'recruited',
    player: sanitizePlayer(player),
  });
}

function handleAttack(playerId: string, message: { targetId?: string; territoryId?: string }) {
  const attacker = state.players.get(playerId);
  if (!attacker) return;
  
  if (message.targetId) {
    // PvP battle
    const defender = state.players.get(message.targetId);
    if (!defender) return;
    
    // Check distance
    const dx = attacker.position.x - defender.position.x;
    const dy = attacker.position.y - defender.position.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) {
      send(attacker.ws!, { type: 'error', message: 'Too far to attack' });
      return;
    }
    
    const battle = resolveBattle(attacker, defender);
    
    send(attacker.ws!, { type: 'battle_result', ...battle, role: 'attacker' });
    send(defender.ws!, { type: 'battle_result', ...battle, role: 'defender' });
    
    broadcast({
      type: 'battle_occurred',
      attacker: attacker.name,
      defender: defender.name,
      winner: battle.winner,
    });
  }
}

function handleChat(playerId: string, message: { text: string }) {
  const player = state.players.get(playerId);
  if (!player) return;
  
  broadcast({
    type: 'chat',
    playerId,
    name: player.name,
    faction: player.faction,
    text: message.text.slice(0, 200),
  });
}

// ============================================
// GAME LOGIC
// ============================================

function getArmySpeed(army: Unit[]): number {
  if (army.length === 0) return 2;
  const hasCavalry = army.some(u => u.type === 'cavalry' && u.count > 0);
  return hasCavalry ? 2 : 1;
}

function getArmyPower(army: Unit[]): number {
  return army.reduce((total, unit) => {
    const stats = UNIT_STATS[unit.type];
    return total + (stats.attack + stats.defense) * unit.count * unit.level;
  }, 0);
}

function resolveBattle(attacker: Player, defender: Player) {
  const attackPower = getArmyPower(attacker.army) * (0.8 + Math.random() * 0.4);
  const defensePower = getArmyPower(defender.army) * (0.8 + Math.random() * 0.4);
  
  const attackerWins = attackPower > defensePower;
  const ratio = attackerWins ? defensePower / attackPower : attackPower / defensePower;
  
  // Calculate losses
  const winnerLossRatio = ratio * 0.3;
  const loserLossRatio = 0.5 + (1 - ratio) * 0.5;
  
  const winner = attackerWins ? attacker : defender;
  const loser = attackerWins ? defender : attacker;
  
  // Apply losses
  winner.army.forEach(unit => {
    unit.count = Math.floor(unit.count * (1 - winnerLossRatio));
  });
  
  loser.army.forEach(unit => {
    unit.count = Math.floor(unit.count * (1 - loserLossRatio));
  });
  
  // Remove empty units
  winner.army = winner.army.filter(u => u.count > 0);
  loser.army = loser.army.filter(u => u.count > 0);
  
  // Loot
  const loot = Math.floor(loser.gold * 0.3);
  winner.gold += loot;
  loser.gold -= loot;
  
  return {
    winner: winner.name,
    loser: loser.name,
    attackPower: Math.round(attackPower),
    defensePower: Math.round(defensePower),
    loot,
  };
}

// ============================================
// UTILITIES
// ============================================

function sanitizePlayer(player: Player) {
  const { ws, ...safe } = player;
  return safe;
}

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(data: any, excludeId?: string) {
  state.players.forEach((player, id) => {
    if (id !== excludeId && player.ws) {
      send(player.ws, data);
    }
  });
}

// ============================================
// GAME LOOP
// ============================================

setInterval(() => {
  state.tick++;
  
  // Income every 30 seconds (60 ticks)
  if (state.tick % 60 === 0) {
    state.players.forEach(player => {
      // Base income
      player.gold += 50;
      
      // Territory income
      state.territories.forEach(t => {
        if (t.owner === player.faction) {
          player.gold += t.income / 10;
        }
      });
      
      send(player.ws!, { type: 'gold_update', gold: player.gold });
    });
  }
  
  // Broadcast tick for client sync
  if (state.tick % 10 === 0) {
    broadcast({
      type: 'tick',
      players: Array.from(state.players.values()).map(sanitizePlayer),
    });
  }
}, 500);

console.log('Game loop started');
