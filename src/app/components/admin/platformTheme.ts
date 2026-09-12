export type Platform = 'cargo' | 'avia' | 'shared';

export const PLATFORM_THEME: Record<Platform, { label: string; accent: string; gradient: string; bg: string }> = {
  cargo:  { label: 'CARGO', accent: '#1565d8', gradient: 'linear-gradient(135deg,#1565d8,#2385f4)', bg: '#eff6ff' },
  avia:   { label: 'AVIA',  accent: '#0ea5e9', gradient: 'linear-gradient(135deg,#0ea5e9,#38bdf8)', bg: '#f0f9ff' },
  shared: { label: 'Общее', accent: '#64748b', gradient: 'linear-gradient(135deg,#64748b,#94a3b8)', bg: '#f8fafc' },
};

export const GROUP_PLATFORM: Record<string, Platform> = {
  CARGO: 'cargo',
  AVIA: 'avia',
  // «Аудит» собирает журналы обеих площадок — красим как общий раздел.
  'Аудит': 'shared',
  'Общее': 'shared',
};
