import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { createWorld } from '../shared/combat';
import type { CharacterId, Input, RoomState, ServerMessage, Snapshot } from '../src/game/types';
import type { Client, Room, ServerOptions } from './types';

const CHARACTER_IDS = new Set<string>(['gale', 'iron', 'shadow', 'pyro', 'bastion']);
function isCharacter(value: unknown): value is CharacterId { return typeof value === 'string' && CHARACTER_IDS.has(value); }
const ACTION_KEYS = ['up', 'punch', 'special', 'skill1', 'skill2', 'ult'] as const;
const INPUT_KEYS: (keyof Input)[] = ['left', 'right', ...ACTION_KEYS];
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.webmanifest': 'application/manifest+json',
};

export function sanitizeInput(input: unknown): Input {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const clean = { down: false } as Input;
  for (const key of INPUT_KEYS) clean[key] = raw[key] === true;
  return clean;
}

function positiveInteger(value: number | undefined, fallback: number, minimum = 1) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

export function createGameServer(options: ServerOptions = {}) {
  const root = path.resolve(options.staticRoot || 'dist/client');
  const config = {
    host: options.host ?? process.env.HOST ?? '0.0.0.0',
    port: options.port ?? Number(process.env.PORT || 3000),
    tickRate: positiveInteger(options.tickRate, 60),
    snapshotRate: positiveInteger(options.snapshotRate, 20),
    duration: positiveInteger(options.duration, 90),
    introFrames: positiveInteger(options.introFrames, 150, 0),
    maxRooms: positiveInteger(options.maxRooms, 100),
    maxConnections: positiveInteger(options.maxConnections, 200),
    maxConnectionsPerIp: positiveInteger(options.maxConnectionsPerIp, positiveInteger(options.maxConnections, 200)),
    maxMessagesPerSecond: positiveInteger(options.maxMessagesPerSecond, 180),
    maxPayload: positiveInteger(options.maxPayload, 4096),
    maxBufferedAmount: positiveInteger(options.maxBufferedAmount, 256 * 1024),
    inputTimeoutMs: positiveInteger(options.inputTimeoutMs, 900),
    heartbeatIntervalMs: positiveInteger(options.heartbeatIntervalMs, 10000),
  };
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new RangeError('PORT must be an integer between 0 and 65535');
  }
  const rooms = new Map<string, Room>();
  const clients = new Set<Client>();
  const ipCounts = new Map<string, number>();
  let closing = false;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

  function send(client: Client | null, message: ServerMessage, optional = false) {
    if (!client || client.ws.readyState !== WebSocket.OPEN) return false;
    // Snapshots are replaceable. Let the next tick supply current state instead
    // of adding more old frames to an already buffered WebSocket connection.
    if (optional && client.ws.bufferedAmount > 0) return false;
    if (client.ws.bufferedAmount > config.maxBufferedAmount) {
      if (optional) return false;
      client.ws.close(1013, 'Connection is too slow');
      return false;
    }
    client.ws.send(JSON.stringify(message));
    return true;
  }

  function fail(client: Client, message: string) {
    send(client, { type: 'error', message });
  }

  function roomState(room: Room, client: Client): RoomState {
    if (client.seat === null) throw new Error('Room client is missing a seat');
    return {
      type: 'room',
      code: room.code,
      seat: client.seat,
      players: room.players.map(player => player ? {
        character: player.character!,
        ready: player.ready,
        connected: player.ws.readyState === WebSocket.OPEN,
      } : null) as RoomState['players'],
      phase: room.phase,
    };
  }

  function broadcastRoom(room: Room) {
    for (const client of room.players) if (client) send(client, roomState(room, client));
  }

  function broadcastSnapshot(room: Room, snapshot: Snapshot = room.world!.snapshot(), optional = true) {
    for (const client of room.players) send(client, { type: 'snapshot', snapshot }, optional);
    return snapshot;
  }

  function clearInput(client: Client) {
    client.input = sanitizeInput(null);
    client.actions = sanitizeInput(null);
    client.lastInputAt = 0;
  }

  function endRoom(client: Client, message: string) {
    const room = client.room;
    if (!room) return;
    rooms.delete(room.code);
    for (const member of room.players) {
      if (!member) continue;
      member.room = null;
      member.seat = null;
      member.ready = false;
      member.rematch = false;
      clearInput(member);
      if (member !== client) send(member, { type: 'left', message });
    }
  }

  function startBattle(room: Room) {
    if (!room.players[0]?.character || !room.players[1]?.character) return;
    room.world = createWorld({
      left: room.players[0].character,
      right: room.players[1].character,
      mode: 'pvp',
      duration: config.duration,
      introFrames: config.introFrames,
      seed: crypto.randomBytes(4).readUInt32LE(0),
    });
    room.phase = 'battle';
    room.snapshotCounter = 0;
    for (const client of room.players) {
      if (client) { client.rematch = false; clearInput(client); }
    }
    broadcastRoom(room);
    broadcastSnapshot(room);
  }

  function allocateCode() {
    for (let attempt = 0; attempt < 100; attempt++) {
      const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  function handleMessage(client: Client, data: RawData, isBinary: boolean) {
    const now = Date.now();
    if (now - client.rateWindow >= 1000) {
      client.rateWindow = now;
      client.rateCount = 0;
    }
    client.rateCount++;
    if (client.rateCount > config.maxMessagesPerSecond) {
      if (client.rateCount === config.maxMessagesPerSecond + 1) {
        fail(client, '发送过于频繁，请稍后重试。');
        client.ws.close(1008, 'Message rate limit');
      }
      return;
    }
    let message: Record<string, unknown>;
    try {
      if (isBinary) throw new Error('Binary message');
      message = JSON.parse(data.toString());
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid object');
    } catch {
      fail(client, '消息格式无效。');
      return;
    }
    switch (message.type) {
      case 'ping':
        send(client, { type: 'pong', at: typeof message.at === 'number' && Number.isFinite(message.at) ? message.at : null });
        return;
      case 'create': {
        if (client.room) return fail(client, '请先离开当前房间。');
        if (!isCharacter(message.character)) return fail(client, '请选择有效角色。');
        if (rooms.size >= config.maxRooms) return fail(client, '房间已满，请稍后重试。');
        const code = allocateCode();
        if (!code) return fail(client, '暂时无法创建房间，请重试。');
        const room: Room = { code, players: [client, null], phase: 'lobby', world: null, snapshotCounter: 0 };
        client.character = message.character;
        client.ready = false;
        client.room = room;
        client.seat = 0;
        client.lastSeq = -1;
        rooms.set(code, room);
        broadcastRoom(room);
        return;
      }
      case 'join': {
        if (client.room) return fail(client, '请先离开当前房间。');
        if (!isCharacter(message.character)) return fail(client, '请选择有效角色。');
        if (typeof message.code !== 'string' || !/^\d{6}$/.test(message.code)) return fail(client, '请输入六位房间码。');
        const room = rooms.get(message.code);
        if (!room) return fail(client, '房间不存在或已结束。');
        if (room.players[1] || room.phase !== 'lobby') return fail(client, '房间已满或已经开战。');
        client.character = message.character;
        client.ready = false;
        client.room = room;
        client.seat = 1;
        client.lastSeq = -1;
        room.players[1] = client;
        broadcastRoom(room);
        return;
      }
      case 'select': {
        const room = client.room;
        if (!room || room.phase !== 'lobby') return fail(client, '只能在房间准备阶段选择角色。');
        if (!isCharacter(message.character)) return fail(client, '请选择有效角色。');
        client.character = message.character;
        client.ready = false;
        broadcastRoom(room);
        return;
      }
      case 'ready': {
        const room = client.room;
        if (!room || room.phase !== 'lobby') return fail(client, '当前无法准备。');
        if (typeof message.ready !== 'boolean') return fail(client, '准备状态无效。');
        client.ready = message.ready;
        if (room.players.every(player => player && player.ready)) startBattle(room);
        else broadcastRoom(room);
        return;
      }
      case 'input': {
        if (!client.room || client.room.phase !== 'battle') return;
        if (typeof message.seq !== 'number' || !Number.isSafeInteger(message.seq) || message.seq < 0) return fail(client, '输入序号无效。');
        if (message.seq <= client.lastSeq) return;
        if (!message.input || typeof message.input !== 'object' || Array.isArray(message.input)) return fail(client, '输入格式无效。');
        client.lastSeq = message.seq;
        const input = sanitizeInput(message.input);
        client.input.left = input.left;
        client.input.right = input.right;
        for (const key of ACTION_KEYS) client.actions[key] ||= input[key];
        client.lastInputAt = now;
        return;
      }
      case 'rematch': {
        const room = client.room;
        if (!room || room.phase !== 'result') return fail(client, '请等本局结束后再重赛。');
        client.rematch = true;
        client.ready = true;
        if (room.players.every(player => player && player.rematch)) startBattle(room);
        else broadcastRoom(room);
        return;
      }
      case 'leave':
        endRoom(client, '对方已离开房间。');
        send(client, { type: 'left', message: '已离开房间。' });
        return;
      default:
        fail(client, '未知操作。');
    }
  }

  async function serveStatic(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.writeHead(405).end('Method not allowed');
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    } catch {
      res.writeHead(400).end('Bad request');
      return;
    }
    if (pathname === '/health') {
      // Deployment checks match this PID to systemd's MainPID so an old process
      // occupying the port cannot impersonate a successfully started release.
      const body = JSON.stringify({ ok: true, pid: process.pid });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', Buffer.byteLength(body));
      res.writeHead(200).end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (pathname === '/' || pathname === '/Ave Mujica乱斗.html') pathname = '/index.html';
    const relative = pathname.replace(/^\//, '');
    const segments = relative.split('/');
    const invalid = pathname.includes('\\') || pathname.includes('\0') || segments.some(segment => !segment || segment.startsWith('.'));
    const exact = ['index.html', 'CREDITS.md', 'favicon.ico', 'sw.js', 'manifest.webmanifest'].includes(relative);
    const publicDirectory = ['assets', 'static'].includes(segments[0]) && segments.length > 1;
    const extension = path.extname(relative).toLowerCase();
    if (invalid || (!exact && !publicDirectory) || !MIME_TYPES[extension]) {
      res.writeHead(404).end('Not found');
      return;
    }
    const servingRoot = options.assetRoot && (['CREDITS.md', 'sw.js', 'manifest.webmanifest'].includes(relative) || relative.startsWith('assets/')) ? path.resolve(options.assetRoot) : root;
    const filename = path.resolve(servingRoot, relative);
    const allowedRoot = publicDirectory ? path.resolve(servingRoot, segments[0]) + path.sep : filename;
    try {
      const real = await fs.promises.realpath(filename);
      if (publicDirectory ? !real.startsWith(allowedRoot) : real !== filename) {
        res.writeHead(404).end('Not found');
        return;
      }
      const stats = await fs.promises.stat(real);
      if (!stats.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.setHeader('Content-Type', MIME_TYPES[extension]);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', ['.html', '.js', '.css', '.json', '.webmanifest'].includes(extension) ? 'no-store' : 'public, max-age=3600');
      res.writeHead(200);
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(real).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(404).end('Not found');
      else res.destroy();
    }
  }

  const server = http.createServer((req, res) => { void serveStatic(req, res); });
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayload, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch { pathname = null; }
    const ip = req.socket.remoteAddress || 'unknown';
    if (closing || pathname === null || !['/ws', '/'].includes(pathname)) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    if (clients.size >= config.maxConnections || (ipCounts.get(ip) || 0) >= config.maxConnectionsPerIp) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress || 'unknown';
    const client: Client = {
      ws, ip, room: null, seat: null, character: null, ready: false, rematch: false,
      lastSeq: -1, lastInputAt: 0, input: sanitizeInput(null), actions: sanitizeInput(null),
      rateWindow: Date.now(), rateCount: 0, alive: true,
    };
    clients.add(client);
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    ws.on('pong', () => { client.alive = true; });
    ws.on('message', (data, isBinary) => handleMessage(client, data, isBinary));
    ws.on('error', () => { /* close event removes the room and connection */ });
    ws.on('close', () => {
      endRoom(client, '对方连接已中断，房间已结束。');
      clients.delete(client);
      const remaining = (ipCounts.get(ip) || 1) - 1;
      if (remaining) ipCounts.set(ip, remaining);
      else ipCounts.delete(ip);
    });
  });

  let previousTick = performance.now();
  let accumulator = 0;
  const frameMs = 1000 / config.tickRate;
  function tick() {
    const clock = performance.now();
    accumulator += Math.min(frameMs * 5, clock - previousTick);
    previousTick = clock;
    while (accumulator >= frameMs) {
      accumulator -= frameMs;
      const now = Date.now();
      for (const room of rooms.values()) {
        if (room.phase !== 'battle' || !room.world || !room.players[0] || !room.players[1]) continue;
        const inputs = room.players.map(client => {
          if (!client) return sanitizeInput(null);
          if (now - client.lastInputAt > config.inputTimeoutMs) clearInput(client);
          const input = { ...client.input };
          for (const key of ACTION_KEYS) {
            input[key] = client.actions[key];
            client.actions[key] = false;
          }
          return input;
        });
        room.world.step(inputs);
        room.snapshotCounter += config.snapshotRate;
        if (room.world.getResult()) {
          room.phase = 'result';
          for (const client of room.players) if (client) { client.ready = false; clearInput(client); }
          broadcastRoom(room);
          // Results are sent once. They must not be discarded like old motion frames.
          broadcastSnapshot(room, room.world.snapshot(), false);
        } else if (room.snapshotCounter >= config.tickRate) {
          room.snapshotCounter %= config.tickRate;
          broadcastSnapshot(room);
        }
      }
    }
  }

  function startTimers() {
    previousTick = performance.now();
    tickTimer = setInterval(tick, Math.max(1, Math.floor(frameMs)));
    heartbeatTimer = setInterval(() => {
      for (const client of clients) {
        if (!client.alive) { client.ws.terminate(); continue; }
        client.alive = false;
        if (client.ws.readyState === WebSocket.OPEN) client.ws.ping();
      }
    }, config.heartbeatIntervalMs);
    tickTimer.unref();
    heartbeatTimer.unref();
  }

  return {
    server, wss, rooms, config,
    address: () => server.address(),
    listen() {
      return new Promise<AddressInfo>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => {
          server.off('error', onError);
          startTimers();
          resolve(server.address() as AddressInfo);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(config.port, config.host);
      });
    },
    close() {
      closing = true;
      clearInterval(tickTimer);
      clearInterval(heartbeatTimer);
      for (const client of clients) client.ws.terminate();
      rooms.clear();
      return new Promise<void>((resolve, reject) => {
        wss.close(() => {
          if (!server.listening) { resolve(); return; }
          server.close(error => error ? reject(error) : resolve());
          server.closeIdleConnections();
        });
      });
    },
  };
}
