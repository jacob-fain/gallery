-- Analytics Events Table
-- Tracks view/download events with timestamps for time-series analytics

CREATE TABLE analytics_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(20) NOT NULL, -- 'gallery_view', 'photo_view', 'photo_download'
    gallery_id UUID REFERENCES galleries(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient analytics queries
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at);
CREATE INDEX idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_gallery_id ON analytics_events(gallery_id);
CREATE INDEX idx_analytics_photo_id ON analytics_events(photo_id);

-- Composite index for time-range queries by type
CREATE INDEX idx_analytics_type_date ON analytics_events(event_type, created_at);
