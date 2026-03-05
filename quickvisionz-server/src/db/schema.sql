-- QuickVisionz Database Schema
-- Run: psql $DATABASE_URL -f src/db/schema.sql

CREATE TABLE IF NOT EXISTS vision_detections (
    id UUID PRIMARY KEY,
    pi_id VARCHAR(50) NOT NULL,
    track_id INTEGER NOT NULL,
    class_name VARCHAR(100),
    confidence REAL,
    bbox REAL[],
    barcode VARCHAR(100),
    ocr_raw_text TEXT,
    ocr_asin VARCHAR(20),
    ocr_upc VARCHAR(20),
    ocr_ean VARCHAR(20),
    ocr_fnsku VARCHAR(20),
    ocr_lpn VARCHAR(50),
    image_path VARCHAR(500),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vision_products (
    id UUID PRIMARY KEY,
    detection_id UUID REFERENCES vision_detections(id),
    title VARCHAR(500),
    brand VARCHAR(200),
    model VARCHAR(200),
    category VARCHAR(200),
    upc VARCHAR(20),
    asin VARCHAR(20),
    ean VARCHAR(20),
    fnsku VARCHAR(20),
    lpn VARCHAR(50),
    description TEXT,
    image_url VARCHAR(500),
    estimated_value DECIMAL(10,2),
    marketplace_comps JSONB DEFAULT '[]',
    resolution_path VARCHAR(100),
    resolution_confidence REAL,
    grade VARCHAR(5),
    route VARCHAR(50),
    qlid VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vision_unit_resolutions (
    id SERIAL PRIMARY KEY,
    detection_id UUID REFERENCES vision_detections(id),
    step VARCHAR(100) NOT NULL,
    input VARCHAR(500),
    result TEXT,
    confidence REAL,
    duration_ms INTEGER,
    success BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vision_manifests (
    id SERIAL PRIMARY KEY,
    lpn VARCHAR(100) UNIQUE NOT NULL,
    title VARCHAR(500),
    brand VARCHAR(200),
    model VARCHAR(200),
    upc VARCHAR(20),
    asin VARCHAR(20),
    ean VARCHAR(20),
    category VARCHAR(200),
    wholesale_cost DECIMAL(10,2),
    retail_price DECIMAL(10,2),
    source VARCHAR(200),
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vision_stats_hourly (
    id SERIAL PRIMARY KEY,
    hour TIMESTAMPTZ NOT NULL,
    pi_id VARCHAR(50),
    items_processed INTEGER DEFAULT 0,
    barcode_success INTEGER DEFAULT 0,
    ocr_success INTEGER DEFAULT 0,
    ai_vision_used INTEGER DEFAULT 0,
    avg_processing_ms INTEGER DEFAULT 0,
    grade_distribution JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vision_detections_created ON vision_detections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vision_detections_status ON vision_detections(status);
CREATE INDEX IF NOT EXISTS idx_vision_detections_pi ON vision_detections(pi_id);
CREATE INDEX IF NOT EXISTS idx_vision_products_detection ON vision_products(detection_id);
CREATE INDEX IF NOT EXISTS idx_vision_products_upc ON vision_products(upc);
CREATE INDEX IF NOT EXISTS idx_vision_products_asin ON vision_products(asin);
CREATE INDEX IF NOT EXISTS idx_vision_products_qlid ON vision_products(qlid);
CREATE INDEX IF NOT EXISTS idx_vision_manifests_lpn ON vision_manifests(lpn);
CREATE INDEX IF NOT EXISTS idx_vision_resolutions_detection ON vision_unit_resolutions(detection_id);
CREATE INDEX IF NOT EXISTS idx_vision_stats_hour ON vision_stats_hourly(hour);
