const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const mysql = require('mysql2/promise');
const CHUNK_SIZE = 5000;  
const CSV_PATH = process.argv[2] || path.join(__dirname, '..', 'queries.csv');
const DB_CONFIG = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'typeahead_user',
    password: process.env.MYSQL_PASSWORD || 'typeahead_pass',
    database: process.env.MYSQL_DATABASE || 'typeahead_db'
};
function readCSV(filePath) {
    return new Promise((resolve, reject) => {
        const rows = [];
        fs.createReadStream(filePath)
            .on('error', (err) => reject(new Error(`Cannot read CSV: ${err.message}`)))
            .pipe(csv())
            .on('data', (row) => {
                const query = (row.query || '').trim().toLowerCase();
                const count = parseInt(row.count) || 1;
                if (query) rows.push({ query, count });
            })
            .on('end', () => resolve(rows))
            .on('error', reject);
    });
}
async function insertChunk(pool, chunk) {
    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
    const values = [];
    const now = Date.now();
    for (const row of chunk) {
        values.push(row.query, row.count, row.count, now);
    }
    const sql = `
        INSERT INTO searches (query, all_time_count, recent_count, last_searched_at)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
            all_time_count = all_time_count + VALUES(all_time_count),
            recent_count = recent_count + VALUES(recent_count),
            last_searched_at = VALUES(last_searched_at)
    `;
    await pool.execute(sql, values);
}
async function seed() {
    console.log('='.repeat(60));
    console.log('  SEED DATA — Search Typeahead Database Loader');
    console.log('='.repeat(60));
    console.log(`\n📁 CSV Path: ${CSV_PATH}`);
    console.log(`🗄️  Database: ${DB_CONFIG.host}:${DB_CONFIG.port}/${DB_CONFIG.database}`);
    console.log(`📦 Chunk Size: ${CHUNK_SIZE} rows\n`);
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`❌ CSV file not found: ${CSV_PATH}`);
        process.exit(1);
    }
    console.log('📖 Reading CSV file...');
    const rows = await readCSV(CSV_PATH);
    console.log(`✅ Read ${rows.length.toLocaleString()} rows from CSV\n`);
    if (rows.length === 0) {
        console.error('❌ No valid rows found in CSV');
        process.exit(1);
    }
    console.log('🔌 Connecting to MySQL...');
    const pool = mysql.createPool(DB_CONFIG);
    await pool.execute('SELECT 1');
    console.log('✅ MySQL connected\n');
    const totalChunks = Math.ceil(rows.length / CHUNK_SIZE);
    let inserted = 0;
    const startTime = Date.now();
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        const chunk = rows.slice(i, i + CHUNK_SIZE);
        const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
        await insertChunk(pool, chunk);
        inserted += chunk.length;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const progress = ((inserted / rows.length) * 100).toFixed(1);
        console.log(`  [${chunkNum}/${totalChunks}] Inserted ${inserted.toLocaleString()} rows (${progress}%) — ${elapsed}s elapsed`);
    }
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM searches');
    const dbTotal = countResult[0].total;
    console.log('\n' + '='.repeat(60));
    console.log(`  ✅ SEED COMPLETE`);
    console.log(`  📊 Rows inserted: ${inserted.toLocaleString()}`);
    console.log(`  🗄️  Total in DB:   ${dbTotal.toLocaleString()}`);
    console.log(`  ⏱️  Time:          ${totalTime}s`);
    console.log(`  📈 Rate:          ${(inserted / parseFloat(totalTime)).toFixed(0)} rows/sec`);
    console.log('='.repeat(60));
    await pool.end();
    process.exit(0);
}
seed().catch((err) => {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
});
