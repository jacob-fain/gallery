-- Daily rollups of analytics_events, so raw events can be deleted after a
-- retention period without changing what the dashboard reports.
--
-- One row per America/New_York day, event type, gallery and photo. The
-- foreign keys cascade exactly like analytics_events, so deleting a gallery
-- or photo removes the same counts from both tables.

CREATE TABLE analytics_daily (
    day DATE NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    gallery_id UUID REFERENCES galleries(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    count INTEGER NOT NULL CHECK (count > 0)
);

CREATE UNIQUE INDEX idx_analytics_daily_key
    ON analytics_daily (day, event_type, gallery_id, photo_id) NULLS NOT DISTINCT;
CREATE INDEX idx_analytics_daily_gallery_id ON analytics_daily (gallery_id);
CREATE INDEX idx_analytics_daily_photo_id ON analytics_daily (photo_id);

-- A single row. Every day before rolled_through has been rolled up into
-- analytics_daily; days from rolled_through on are read from analytics_events.
-- NULL means nothing has been rolled up yet.
CREATE TABLE analytics_rollup_state (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    rolled_through DATE
);

INSERT INTO analytics_rollup_state (id, rolled_through) VALUES (TRUE, NULL);
