const searchBuffer = new Map();
const MAX_BUFFER_SIZE = 1000;
let dbPool = null;
let flushStats = { totalFlushes: 0, totalRowsFlushed: 0, lastFlushTime: null, emergencyFlushes: 0 };
function init(pool) {
    dbPool = pool;
    console.log('[BatchWriter] Initialized with MySQL pool');
}
function incrementBuffer(query) {
    const q = query.toLowerCase().trim();
    if (!q) return false;
    const existing = searchBuffer.get(q);
    if (existing) {
        existing.count += 1;
        existing.timestamp = Date.now();
    } else {
        searchBuffer.set(q, { count: 1, timestamp: Date.now() });
    }
    if (searchBuffer.size > MAX_BUFFER_SIZE) {
        console.warn(`[BatchWriter] ⚠️ EMERGENCY FLUSH — Buffer size ${searchBuffer.size} > ${MAX_BUFFER_SIZE}`);
        flushStats.emergencyFlushes++;
        flushBuffer();
        return true;
    }
    return false;
}
async function flushBuffer() {
    if (searchBuffer.size === 0) return;
    if (!dbPool) { console.error('[BatchWriter] No MySQL pool'); return; }
    const entries = Array.from(searchBuffer.entries());
    searchBuffer.clear();
    console.log(`[BatchWriter] Flushing ${entries.length} entries to MySQL...`);
    try {
        const placeholders = entries.map(() => '(?, ?, ?, ?)').join(', ');
        const values = [];
        for (const [query, data] of entries) {
            values.push(query, data.count, data.count, data.timestamp);
        }
        const sql = `
            INSERT INTO searches (query, all_time_count, recent_count, last_searched_at)
            VALUES ${placeholders}
            ON DUPLICATE KEY UPDATE
                all_time_count = all_time_count + VALUES(all_time_count),
                recent_count = recent_count + VALUES(recent_count),
                last_searched_at = GREATEST(last_searched_at, VALUES(last_searched_at))
        `;
        await dbPool.execute(sql, values);
        flushStats.totalFlushes++;
        flushStats.totalRowsFlushed += entries.length;
        flushStats.lastFlushTime = new Date().toISOString();
        console.log(`[BatchWriter] ✅ Flushed ${entries.length} entries`);
    } catch (error) {
        console.error(`[BatchWriter] ❌ Flush failed:`, error.message);
        for (const [query, data] of entries) {
            const existing = searchBuffer.get(query);
            if (existing) existing.count += data.count;
            else searchBuffer.set(query, data);
        }
    }
}
function getStatus() {
    return { bufferSize: searchBuffer.size, maxBufferSize: MAX_BUFFER_SIZE, ...flushStats };
}
module.exports = { init, incrementBuffer, flushBuffer, getStatus };
