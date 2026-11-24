-- Site settings table for configurable site metadata
CREATE TABLE IF NOT EXISTS site_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT INTO site_settings (key, value) VALUES
    ('site_title', 'Jacob Fain Photography'),
    ('meta_description', 'Professional photography portfolio')
ON CONFLICT (key) DO NOTHING;
