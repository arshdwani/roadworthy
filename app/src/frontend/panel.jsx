// Request panel (jira:issueContext + jira:issuePanel): the recall on this request, then Schedule -> Mark remedied.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DatePicker, ErrorMessage, Heading, Inline, Label, Link, SectionMessage, Spinner, Stack, Strong, Text,
  Textfield, TextArea, User,
} from '@forge/react';
import { call, fmtDate, fmtWhen, LevelPill, Pill, StatePill, StatusPill, VerdictPill } from './common.jsx';

const MARK = { match: '✓', mismatch: '✗', unknown: '?' };

const today = () => new Date().toISOString().slice(0, 10);

const Panel = () => {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState(null); // 'schedule' | 'remedy' | 'not-affected'
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await call('getPanel');
    if (r?.error) setError(r.error);
    else setP(r);
  };
  useEffect(() => { load(); }, []);

  if (!p) return error ? <ErrorMessage>{error}</ErrorMessage> : <Spinner label="Loading recall" />;
  if (p.none) return <Text>This request isn't a Roadworthy recall. Recall requests are opened from the Roadworthy page.</Text>;

  const { case: c, campaign, vehicle } = p;
  const open = c.state === 'open' || c.state === 'scheduled';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const submit = async (name, payload, done) => {
    setBusy(true);
    setError('');
    const r = await call(name, payload);
    setBusy(false);
    if (r?.error) return setError(r.error);
    setMode(null);
    setForm({});
    setNotice(done(r));
    await load();
  };

  return (
    <Stack space="space.200">
      {c.level === 'park-it' && open ? (
        <SectionMessage appearance="error" title="Park It – do not drive">
          <Text>The manufacturer and NHTSA advise not to drive this vehicle until the repair is done. Tow it to the dealer.</Text>
        </SectionMessage>
      ) : null}
      {c.level === 'park-outside' && open ? (
        <SectionMessage appearance="warning" title="Park outside – fire risk">
          <Text>Park this vehicle outside and away from buildings until the repair is done.</Text>
        </SectionMessage>
      ) : null}
      {notice ? <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}

      <Inline space="space.100" alignBlock="center" shouldWrap>
        <LevelPill level={c.level} label={c.levelLabel} />
        <VerdictPill verdict={c.verdict} label={c.verdictLabel} />
        <StatePill state={c.state} />
        {open ? (c.overdue ? <Pill appearance="removed">overdue since {fmtDate(c.due)}</Pill> : <Text>Due {fmtDate(c.due)}</Text>) : null}
        {open ? <Text>{c.daysOpen === 0 ? 'Opened today' : `${c.daysOpen} day${c.daysOpen === 1 ? '' : 's'} open`}</Text> : null}
      </Inline>
      <Text>{c.reason}</Text>

      {c.reasons?.length ? (
        <Stack space="space.050">
          <Strong>Does it apply to this vehicle?</Strong>
          {c.reasons.map((r) => <Text key={r.text}>{`${MARK[r.result] || ''} ${r.text}`}</Text>)}
          {c.verdict === 'possible' ? <Text>Confirm with the NHTSA VIN lookup below; if this VIN isn't listed, close the request as Not affected.</Text> : null}
        </Stack>
      ) : null}

      {vehicle ? (
        <Stack space="space.050">
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Strong>{vehicle.name}</Strong>
            <Text>{vehicle.label}</Text>
            <StatusPill status={vehicle.status} />
          </Inline>
          {vehicle.equipment ? <Text>Equipment: {vehicle.equipment}</Text> : null}
          <Text>VIN {vehicle.vin}{c.assetKey ? ` · ${c.assetKey}` : ''}{vehicle.plate ? ` · plate ${vehicle.plate}` : ''}{vehicle.depot ? ` · ${vehicle.depot} depot` : ''}{vehicle.driver ? ` · driver ${vehicle.driver}` : ''}</Text>
          <Inline space="space.200" shouldWrap>
            {p.assetUrl ? <Link href={p.assetUrl}>Open in Assets</Link> : null}
            <Link href={p.vinLookupUrl} openNewTab>Check this VIN on NHTSA</Link>
          </Inline>
        </Stack>
      ) : null}

      {campaign ? (
        <Stack space="space.050">
          <Inline space="space.100" shouldWrap>
            <Link href={c.campaignUrl} openNewTab>{`NHTSA ${campaign.id}`}</Link>
            <Text>{campaign.manufacturer}{campaign.reported ? ` · reported ${fmtDate(campaign.reported)}` : ''}{campaign.ota ? ' · over-the-air remedy' : ''}</Text>
          </Inline>
          <Text><Strong>Component:</Strong> {campaign.component.toLowerCase()}</Text>
          <Text><Strong>Remedy:</Strong> {campaign.remedy}</Text>
        </Stack>
      ) : null}

      {c.schedule && open ? <Text><Strong>Appointment:</Strong> {c.schedule.dealer} on {fmtDate(c.schedule.date)}</Text> : null}
      {c.remedy ? (
        <Text>
          <Strong>Remedied:</Strong> repair order {c.remedy.ro} on {fmtDate(c.remedy.date)}
          {c.remedy.odometer !== null && c.remedy.odometer !== undefined ? ` at ${Number(c.remedy.odometer).toLocaleString('en-US')} mi` : ''}
        </Text>
      ) : null}
      {c.state === 'not-affected' ? <Text><Strong>Not affected:</Strong> {c.note}</Text> : null}

      {open && !mode ? (
        <Inline space="space.100" shouldWrap>
          {c.state === 'open' ? <Button appearance="primary" onClick={() => setMode('schedule')}>Schedule repair</Button> : null}
          <Button appearance={c.state === 'scheduled' ? 'primary' : 'default'} onClick={() => { setForm({ date: today() }); setMode('remedy'); }}>Mark remedied</Button>
          <Button appearance="subtle" onClick={() => setMode('not-affected')}>Not affected</Button>
        </Inline>
      ) : null}

      {mode === 'schedule' ? (
        <Stack space="space.100">
          <Heading size="small">Schedule the dealer visit</Heading>
          <Stack space="space.050">
            <Label labelFor="rw-dealer">Dealer or repair shop</Label>
            <Textfield id="rw-dealer" placeholder="Metro Ford Service" onChange={set('dealer')} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="rw-appt">Appointment date</Label>
            <DatePicker id="rw-appt" onChange={set('date')} />
          </Stack>
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={busy} onClick={() => submit('scheduleRepair', form, () => `Scheduled at ${form.dealer} on ${fmtDate(form.date)}.`)}>Save appointment</Button>
            <Button appearance="subtle" onClick={() => setMode(null)}>Cancel</Button>
          </Inline>
        </Stack>
      ) : null}

      {mode === 'remedy' ? (
        <Stack space="space.100">
          <Heading size="small">Record the repair</Heading>
          <Stack space="space.050">
            <Label labelFor="rw-ro">Repair order number</Label>
            <Textfield id="rw-ro" placeholder="RO-184220" onChange={set('ro')} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="rw-date">Repair date</Label>
            <DatePicker id="rw-date" defaultValue={today()} onChange={set('date')} />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="rw-odo">Odometer (miles, optional)</Label>
            <Textfield id="rw-odo" placeholder="42150" onChange={set('odometer')} />
          </Stack>
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={busy} onClick={() => submit('markRemedied', form, (r) => `Remedied. Vehicle status: ${r.vehicleStatus}${r.issueStatus ? `; request moved to ${r.issueStatus}` : ''}.`)}>Mark remedied</Button>
            <Button appearance="subtle" onClick={() => setMode(null)}>Cancel</Button>
          </Inline>
        </Stack>
      ) : null}

      {mode === 'not-affected' ? (
        <Stack space="space.100">
          <Heading size="small">This VIN is not in the campaign</Heading>
          <Stack space="space.050">
            <Label labelFor="rw-note">How did you confirm it?</Label>
            <TextArea id="rw-note" placeholder="NHTSA VIN lookup shows no open recall for this VIN" onChange={set('note')} />
          </Stack>
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={busy} onClick={() => submit('markNotAffected', form, (r) => `Closed as not affected. Vehicle status: ${r.vehicleStatus}.`)}>Close as not affected</Button>
            <Button appearance="subtle" onClick={() => setMode(null)}>Cancel</Button>
          </Inline>
        </Stack>
      ) : null}

      {c.history?.length ? (
        <Stack space="space.050">
          <Heading size="small">Audit trail</Heading>
          {c.history.map((h) => (
            <Inline key={`${h.at}-${h.what}`} space="space.100" alignBlock="center" shouldWrap>
              <Text>{fmtWhen(h.at)}</Text>
              {h.by ? <User accountId={h.by} /> : <Text>Roadworthy</Text>}
              <Text>{h.detail}</Text>
            </Inline>
          ))}
        </Stack>
      ) : null}
      <Box />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Panel />
  </React.StrictMode>,
);
