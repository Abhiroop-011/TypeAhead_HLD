CREATE DATABASE IF NOT EXISTS typeahead_db;
USE typeahead_db;
CREATE TABLE IF NOT EXISTS searches (
    query           VARCHAR(760) PRIMARY KEY,
    all_time_count  INT          NOT NULL DEFAULT 0,
    recent_count    FLOAT        NOT NULL DEFAULT 0,
    last_searched_at BIGINT      NOT NULL DEFAULT 0,
    INDEX idx_scoring (all_time_count, recent_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
