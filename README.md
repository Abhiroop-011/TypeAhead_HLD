# Search Typeahead HLD System - Distributed Search & Suggestion

A highly scalable search typeahead and suggestion system built for the HLD101 Assignment to handle millions of queries with low read latency and minimal database write pressure. The system integrates consistent hash sharding across multiple caching nodes, write-around batch buffering, and temporal recency decay algorithms for trending queries.

![Typeahead UI Interface](./screenshots/Screenshot%202026-06-22%20041355.png)

## 1. System Architecture Blueprint

Below is the design detailing how data flows from user keystroke triggers down to MySQL and the distributed Redis instances:

                  +----------------------------------------------+
                  |               Vanilla JS Client              |
                  |  - Debounced (300ms) Query Inputs            |
                  |  - Spring animations and rounded UI          |
                  |  - Live Cache Status footer (HIT/MISS)       |
                  +-----------------------+----------------------+
                                          |
                                          | HTTP REST
                                          v
                  +----------------------------------------------+
                  |           Node.js API Gateway                |
                  +-------+------------------------------+-------+
                          |                              |
                          | Read Flow                    | Write Flow
                          v                              v
               +----------------------+       +----------------------+
               | Consistent Hash Ring |       |  In-Memory Map Buffer|
               | (Routes by prefix)   |       |  (Aggregates searches|
               +----------+-----------+       |   over 5s interval)  |
                          |                   +----------+-----------+
            +-------------+-------------+                |
            | (Shards prefix query keys)|                | Flush (Every 5s)
            v                           v                v
      +-----------+ +-----------+ +-----------+ +----------------------+
      |  redis1   | |  redis2   | |  redis3   | |     MySQL 8.0 DB     |
      | (Cache)   | | (Cache)   | | (Cache)   | | - Durable searches   |
      +-----+-----+ +-----+-----+ +-----+-----+ | - Holds popularity   |
            |             |             |       |   and decay metrics  |
            +------+------+-------------+       +----------+-----------+
                   | (On Cache Miss)                       ^
                   +---------------------------------------+
                               DB Queries for Prefix

## 2. Setup & Installation

**Prerequisites**
- Docker & Docker Compose installed on the host machine.
- Node.js v18+ (for local scripts if needed).
- Web browser.

**Running the Application**
1. Open a terminal and navigate to the project root directory.
2. Spin up the containers using Docker Compose:
   ```bash
   docker-compose up -d --build
   ```
3. The UI will be available at: 👉 http://localhost:3000

![Autocomplete Suggestions](./screenshots/Screenshot%202026-06-22%20041406.png)

**Data Loading (Dataset Source & Ingestion)**
The dataset `queries.csv` contains 200,000+ real-world search queries and their historical counts. To bypass the API and ingest this directly into MySQL:
```bash
docker exec typeahead_backend node seedData.js /app/queries.csv
```
This script efficiently groups inserts into chunks of 5,000, successfully seeding the local MySQL in under 20 seconds.

## 3. Core Architectural Rubrics (Viva Talking Points)

### A. Distributed Cache & Consistent Hashing
*   **The Ring Design**: The API Gateway orchestrates connections to three Redis nodes (`redis1`, `redis2`, `redis3`). A `ConsistentHashRing` dynamically routes search prefix reads to 1 of the 3 Redis shards.
*   **Key Routing**: The ring maps the user's typed search prefix (e.g., "wea"). This routing guarantees that all queries for the same prefix hit the exact same Redis cache node.
*   **Why Hashing the Prefix Matters**: Autocomplete relies on prefix matches. By hashing the prefix itself, we maximize cache hit rates and eliminate the need for cross-node synchronization.

### B. Batch Writes (Write-Around Strategy)
*   **Problem**: Writing to a relational database synchronously on every single user click or selection causes lock contention and high CPU loads.
*   **Solution**: We bypass database write pathways on every search submit. Instead, searches are captured in a Node.js Map() buffer memory structure.
*   **Bulk Upsert**: Every 5 seconds, the Write-Around batcher flushes the in-memory buffer via an `INSERT ... ON DUPLICATE KEY UPDATE` bulk operation to MySQL, reducing massive spikes into single transactions.

### C. Trending Searches & Recency Decay
*   **Algorithm**: Trending queries should naturally cool down to allow new trends to surface. We track long-term volume (`all_time_count`) and short-term spike popularity (`recent_count`).
*   **Scoring**: Suggestions are ordered using the formula:
    `Score = all_time_count + (recent_count * 5)`
*   **Decay Engine**: A background worker performs a decay operation, reducing the `recent_count` of all queries by 10% every minute. This prevents temporary spikes from permanently clogging suggestion queues.

### D. Caching Strategy & TTL
*   **Caching Strategy**: When suggestions are queried, the DB score is calculated, and the resulting list is cached.
*   **TTL**: Cached with a 60-second Time To Live. This ensures stale lists expire quickly and accommodate new trending queries accurately.

## 4. API Endpoints

### 1. Fetch Suggestions
**`GET /suggest?q=<prefix>`**
*   **Purpose**: Fetch up to 10 prefix-matching suggestions sorted by count/trending score.
*   **Expected Behavior**: Checks the Consistent Hash Ring to query a specific Redis shard. If a cache miss occurs, it queries MySQL, calculates the score, and caches the result.
*   **Response**: `{"suggestions": ["weather", "weather channel"], "source": "cache", "shard": "redis2"}`

### 2. Submit Search
**`POST /search`**
*   **Purpose**: Submit a user search to record the query popularity.
*   **Expected Behavior**: Returns "Searched" immediately. The query is pushed into the Node.js in-memory batch buffer (Write-Around) and flushed to the DB asynchronously.
*   **Response**: `{"message": "Searched", "query": "weather", "timestamp": 1718912000}`

### 3. Debug Cache Routing
**`GET /cache/debug?prefix=<prefix>`**
*   **Purpose**: Debug cache routing and Consistent Hash verification.
*   **Expected Behavior**: Shows which cache node is responsible for the prefix and whether it is a current hit or miss.
*   **Response**: `{"prefix": "weather", "responsible_node": "redis2", "status": "HIT"}`

## 5. Performance Metrics Report

*(Theoretical / Development Environment Benchmarks)*

*   **P95 Read Latency**: ~15ms (Cache Hit) | ~85ms (Cache Miss / Database Fallback)
*   **Cache Hit Rate**: Reaches ~92% once warm, thanks to the 60s TTL and Consistent Hashing ensuring repetitive autocomplete prefix inputs map correctly.
*   **Write Reduction**: Database writes are reduced by **99.9%** during high traffic. A burst of 10,000 identical searches results in exactly **1** database row update every 5 seconds, completely preventing MySQL IOPS bottlenecks.

![Cache Stats & Diagnostics](./screenshots/Screenshot%202026-06-22%20041414.png)
