import { query, queryAll } from '../db/database';
import { config } from '../config';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SystemSetting {
  key: string;
  value: string;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  updated_at: string | null;
  updated_by_name: string | null;
}

// ─── In-memory cache (60-second TTL) ─────────────────────────────────────────
// Prevents a DB round-trip on every processOutcome call while still
// picking up manager changes within a minute.

let _cache: Record<string, string> | null = null;
let _cacheExpiry = 0;

export function invalidateSettingsCache(): void {
  _cache = null;
}

export async function getSettings(): Promise<Record<string, string>> {
  if (_cache && Date.now() < _cacheExpiry) return _cache;
  const rows = await queryAll<{ key: string; value: string }>(
    `SELECT key, value FROM system_settings`
  );
  _cache = Object.fromEntries(rows.map(r => [r.key, r.value]));
  _cacheExpiry = Date.now() + 60_000;
  return _cache;
}

export async function getNumericSetting(key: string, fallback: number): Promise<number> {
  const settings = await getSettings();
  const n = parseFloat(settings[key] ?? '');
  return isNaN(n) || n <= 0 ? fallback : n;
}

// ─── updateSetting ────────────────────────────────────────────────────────────

export async function updateSetting(
  key: string,
  value: string,
  updatedBy: number
): Promise<void> {
  await query(
    `UPDATE system_settings
     SET value = $1, updated_by = $2, updated_at = NOW()
     WHERE key = $3`,
    [value, updatedBy, key]
  );
  invalidateSettingsCache();
}

// ─── getSettingsWithMeta ──────────────────────────────────────────────────────
// Returns all settings with labels and last-updated info for the manager UI.

export async function getSettingsWithMeta(): Promise<SystemSetting[]> {
  return queryAll<SystemSetting>(`
    SELECT
      s.key, s.value, s.label, s.description, s.unit,
      s.min_value AS min, s.max_value AS max,
      s.updated_at, u.name AS updated_by_name
    FROM system_settings s
    LEFT JOIN users u ON u.id = s.updated_by
    ORDER BY s.display_order ASC
  `);
}
