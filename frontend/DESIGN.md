# DESIGN.md — FuelPulse BI

## Design Read
Reading this as: calm operational fuel-pricing intelligence report for Indonesian fleet managers, motorists, and Big Data analysts, in a crisp ledger-style authority report language, dial `ENERGY 1 / RHYTHM 1 / MOTION 1`.

## Dials
- `ENERGY 1`: Calm, structured authority report without decorative glows, hero gradients, or marketing noise.
- `RHYTHM 1`: Consistent, disciplined 12-column ledger grid with 1px structural borders and predictable section cadence.
- `MOTION 1`: Subtle hover/focus state transitions only; zero continuous loops and full `prefers-reduced-motion` compliance.

## Color System (Verified WCAG AA via `contrast-check.py`)
- **Canvas Ground**: `#F5F5F4` (`stone-100`)
- **Surface Card / Panel**: `#FFFFFF` (flat, `1px solid #D6D3D1`, zero floating drop shadows)
- **Primary Ink**: `#1C1917` (`stone-900`, `17.49:1` on `#FFFFFF`)
- **Secondary Ink**: `#44403C` (`stone-700`, `10.27:1` on `#FFFFFF`)
- **Muted Metadata Ink**: `#57534E` (`stone-600`, `7.63:1` on `#FFFFFF`, `6.99:1` on `#F5F5F4`)
- **Interactive Control Border**: `#78716C` (`stone-500`, `4.80:1` on `#FFFFFF`, passes `>= 3.0:1` WCAG 1.4.11 non-text contrast)
- **Deliberate Accent (Core Petrol Blue)**: `#0E5A6F` (`7.75:1` white text contrast, `7.27:1` on `#F0F9FF`)
- **Data Semantics (chart & price direction only)**:
  - Official SPBU Step Line: `#1E293B` (`14.63:1` on `#FFFFFF`)
  - Upward Push / Price Increase (`NAIK`): `#BE123C` / `#9F1239` (`>= 6.29:1` on `#FFFFFF`, `7.30:1` on `#FFF1F2`)
  - Downward Relief / Price Decrease (`TURUN`): `#047857` / `#065F46` (`>= 5.48:1` on `#FFFFFF`, `7.29:1` on `#ECFDF5`)
  - ML Forecast Projection Line: `#B45309` (`5.02:1` on `#FFFFFF`, `6.84:1` on `#FFFBEB`)

## Typography
- **Sans**: `Plus Jakarta Sans` (clear Indonesian operational report readability)
- **Mono**: `IBM Plex Mono` (`tabular-nums` alignment for Rupiah prices, dates, MAE/RMSE, and R² metrics)
