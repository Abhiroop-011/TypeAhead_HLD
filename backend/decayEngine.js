let dbPool = null;
let decayStats = { totalDecays: 0, lastDecayTime: null, rowsAffected: 0 };
function init(pool) {
    dbPool = pool;
    console.log('[DecayEngine] Initialized with MySQL pool');
}
async function runDecay() {
    if (!dbPool) {
        console.error('[DecayEngine] Cannot decay — MySQL pool not initialized');
        return;
    }
    try {
        const [result] = await dbPool.execute(
            'UPDATE searches SET recent_count = recent_count * 0.9 WHERE recent_count > 0.01'
        );
        decayStats.totalDecays++;
        decayStats.lastDecayTime = new Date().toISOString();
        decayStats.rowsAffected = result.affectedRows;
        console.log(`[DecayEngine] 📉 Decay applied to ${result.affectedRows} rows (Cycle #${decayStats.totalDecays})`);
    } catch (error) {
        console.error('[DecayEngine] ❌ Decay failed:', error.message);
    }
}
function start() {
    console.log('[DecayEngine] Starting — decay cycle every 60 seconds');
    setTimeout(runDecay, 5000); 
    setInterval(runDecay, 60 * 1000); 
}
function getStatus() {
    return { ...decayStats };
}
module.exports = { init, start, runDecay, getStatus };
