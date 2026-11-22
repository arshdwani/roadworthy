// Pieces shared by the Fleet compliance board and the request panel (Atlassian UI Kit components only).
import React from 'react';
import { invoke } from '@forge/bridge';
import { Box, Lozenge, Stack, Text, Heading } from '@forge/react';

// invoke() that always resolves: a failed or timed-out call becomes { error } with a message people can act on.
export const call = (name, payload) =>
  invoke(name, payload).catch((e) => {
    console.error(name, e);
    return { error: 'Roadworthy took too long to respond. Please try again.' };
  });

export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00Z` : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const fmtWhen = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

// A lozenge that keeps its full text in a narrow column.
export const Pill = ({ appearance, children, bold }) => (
  <Box xcss={{ minWidth: 'max-content' }}>
    <Lozenge appearance={appearance} isBold={bold}>{children}</Lozenge>
  </Box>
);

const LEVEL_LOOK = { 'park-it': 'removed', 'park-outside': 'removed', high: 'moved', medium: 'inprogress', low: 'default' };
export const LevelPill = ({ level, label }) => <Pill appearance={LEVEL_LOOK[level] || 'default'} bold={level === 'park-it' || level === 'park-outside'}>{label}</Pill>;

const STATUS_LOOK = { Available: 'success', 'In repair': 'inprogress', 'Park It – do not drive': 'removed', 'Do not rent': 'moved' };
export const StatusPill = ({ status }) => <Pill appearance={STATUS_LOOK[status] || 'default'} bold={status === 'Park It – do not drive'}>{status || 'Available'}</Pill>;

const VERDICT_LOOK = { likely: 'removed', possible: 'moved', unlikely: 'success' };
export const VerdictPill = ({ verdict, label }) => <Pill appearance={VERDICT_LOOK[verdict] || 'default'}>{label || verdict}</Pill>;

const STATE_LABEL = { open: 'Open', scheduled: 'Scheduled', remedied: 'Remedied', 'not-affected': 'Not affected' };
const STATE_LOOK = { open: 'default', scheduled: 'inprogress', remedied: 'success', 'not-affected': 'success' };
export const StatePill = ({ state }) => <Pill appearance={STATE_LOOK[state]}>{STATE_LABEL[state] || state}</Pill>;

// One number on the board.
export const Kpi = ({ label, value, tone }) => (
  <Box
    xcss={{
      padding: 'space.200',
      borderRadius: 'border.radius.200',
      backgroundColor: tone === 'danger' ? 'color.background.danger' : tone === 'warning' ? 'color.background.warning' : 'color.background.neutral',
      minWidth: '150px',
    }}
  >
    <Stack space="space.050">
      <Heading size="large">{String(value)}</Heading>
      <Text>{label}</Text>
    </Stack>
  </Box>
);
