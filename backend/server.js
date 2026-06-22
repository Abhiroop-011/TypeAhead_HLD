const express = require('express');
const mysql = require('mysql2/promise');
const Redis = require('ioredis');
const path = require('path');
const cors = require('cors');
const ConsistentHashRing = require('./consistentHashRing');
const batchWriter = require('./batchWriter');
const decayEngine = require('./decayEngine');
const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); 
let mysqlPool = null;
let hashRing = null;
async function initializeConnections() {
    mysqlPool = mysql.createPool({
        host: process.env.MYSQL_HOST || 'localhost',
        port: parseInt(process.env.MYSQL_PORT) || 3306,
        user: process.env.MYSQL_USER || 'typeahead_user',
        password: process.env.MYSQL_PASSWORD || 'typeahead_pass',
        database: process.env.MYSQL_DATABASE || 'typeahead_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });
    try {
        await mysqlPool.execute('SELECT 1');
        console.log('[Server] ✅ MySQL connected');
    } catch (err) {
        console.error('[Server] ❌ MySQL connection failed:', err.message);
        process.exit(1);
    }
    const redis1 = new Redis({
        host: process.env.REDIS1_HOST || 'localhost',
        port: parseInt(process.env.REDIS1_PORT) || 6379,
        retryStrategy: (times) => Math.min(times * 100, 3000),
        lazyConnect: true
    });
    const redis2 = new Redis({
        host: process.env.REDIS2_HOST || 'localhost',
        port: parseInt(process.env.REDIS2_PORT) || 6380,
        retryStrategy: (times) => Math.min(times * 100, 3000),
        lazyConnect: true
    });
    const redis3 = new Redis({
        host: process.env.REDIS3_HOST || 'localhost',
        port: parseInt(process.env.REDIS3_PORT) || 6381,
        retryStrategy: (times) => Math.min(times * 100, 3000),
        lazyConnect: true
    });
    await Promise.all([redis1.connect(), redis2.connect(), redis3.connect()]);
    console.log('[Server] ✅ All 3 Redis shards connected');
    hashRing = new ConsistentHashRing([
        { name: 'redis1', client: redis1 },
        { name: 'redis2', client: redis2 },
        { name: 'redis3', client: redis3 }
    ], 150);
    batchWriter.init(mysqlPool);
    decayEngine.init(mysqlPool);
    setInterval(() => batchWriter.flushBuffer(), 5000);
    console.log('[Server] ✅ BatchWriter started (5s interval)');
    decayEngine.start();
    console.log('[Server] ✅ DecayEngine started (60s interval)');
}
app.get('/api/suggest', async (req, res) => {
    const prefix = (req.query.q || '').toLowerCase().trim();
    if (!prefix) {
        return res.json({ suggestions: [], source: 'empty' });
    }
    try {
        const node = hashRing.getNode(prefix);
        const redisClient = node.client;
        const cacheKey = `suggest:${prefix}`;
        const cached = await redisClient.get(cacheKey);
        if (cached) {
            console.log(`[Suggest] Cache HIT for "${prefix}" on ${node.name}`);
            return res.json({ suggestions: JSON.parse(cached), source: 'cache', shard: node.name });
        }
        console.log(`[Suggest] Cache MISS for "${prefix}" — querying MySQL`);
        const [rows] = await mysqlPool.execute(
            `SELECT query, (all_time_count + (recent_count * 5)) AS score
             FROM searches
             WHERE query LIKE ?
             ORDER BY score DESC
             LIMIT 10`,
            [`${prefix}%`]
        );
        const suggestions = rows.map(row => row.query);
        await redisClient.setex(cacheKey, 60, JSON.stringify(suggestions));
        console.log(`[Suggest] Cached ${suggestions.length} results on ${node.name} (TTL: 60s)`);
        return res.json({ suggestions, source: 'database', shard: node.name });
    } catch (error) {
        console.error('[Suggest] Error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch suggestions' });
    }
});
app.post('/api/search', (req, res) => {
    const { query } = req.body;
    if (!query || !query.trim()) {
        return res.status(400).json({ error: 'Query is required' });
    }
    const normalizedQuery = query.trim();
    const emergencyFlushed = batchWriter.incrementBuffer(normalizedQuery);
    console.log(`[Search] Buffered: "${normalizedQuery}" ${emergencyFlushed ? '(emergency flush triggered)' : ''}`);
    return res.json({
        message: 'Searched',
        query: normalizedQuery,
        timestamp: Date.now()
    });
});
app.get('/api/trending', async (req, res) => {
    try {
        const [rows] = await mysqlPool.execute(
            `SELECT query, all_time_count, recent_count,
                    (all_time_count + (recent_count * 5)) AS score
             FROM searches
             ORDER BY score DESC
             LIMIT 10`
        );
        return res.json({ trending: rows });
    } catch (error) {
        console.error('[Trending] Error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch trending searches' });
    }
});
app.get(['/api/cache/debug', '/cache/debug'], async (req, res) => {
    const prefix = req.query.prefix;
    if (prefix) {
        try {
            const normalizedPrefix = prefix.toLowerCase().trim();
            const node = hashRing.getNode(normalizedPrefix);
            const cacheKey = `suggest:${normalizedPrefix}`;
            const cached = await node.client.get(cacheKey);
            const isHit = !!cached;
            return res.json({
                prefix: normalizedPrefix,
                responsible_node: node.name,
                status: isHit ? 'HIT' : 'MISS'
            });
        } catch (error) {
            console.error('[CacheDebug] Prefix check error:', error.message);
            return res.status(500).json({ error: 'Failed to check prefix in cache' });
        }
    }
    try {
        const nodes = [
            { name: 'redis1', client: hashRing.nodeMap.get('redis1').client },
            { name: 'redis2', client: hashRing.nodeMap.get('redis2').client },
            { name: 'redis3', client: hashRing.nodeMap.get('redis3').client }
        ];
        const shardStats = {};
        for (const node of nodes) {
            const dbsize = await node.client.dbsize();
            shardStats[node.name] = { keys: dbsize };
        }
        return res.json({
            shards: shardStats,
            ringDistribution: hashRing.getDistribution(),
            batchWriter: batchWriter.getStatus(),
            decayEngine: decayEngine.getStatus()
        });
    } catch (error) {
        console.error('[CacheDebug] Error:', error.message);
        return res.status(500).json({ error: 'Failed to fetch cache debug info' });
    }
});
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
async function startServer() {
    try {
        await initializeConnections();
        app.listen(PORT, () => {
            console.log(`\n🚀 Typeahead Server running on http://localhost:${PORT}`);
            console.log(`   📡 API: /api/suggest, /api/search, /api/trending, /api/cache/debug\n`);
        });
    } catch (error) {
        console.error('[Server] Fatal startup error:', error.message);
        process.exit(1);
    }
}
startServer();
