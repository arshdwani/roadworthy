// Fleet compliance board (jira:globalPage): numbers, Park It banner, open recalls, depots, vehicles, settings.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box, Button, DynamicTable, EmptyState, ErrorMessage, Heading, Inline, Label, Link, SectionMessage, Select, Spinner,
  Stack, Strong, Tab, TabList, TabPanel, Tabs, Text, TextArea, Toggle, BarChart, ProgressBar,
  Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition, DatePicker,
} from '@forge/react';
import { call, fmtDate, fmtWhen, Kpi, LevelPill, Pill, StatePill, StatusPill, VerdictPill } from './common.jsx';

const PHASE_LABEL = {
  load: 'Reading the vehicle register',
  decode: 'Decoding VINs with NHTSA vPIC',
  recalls: 'Checking live NHTSA recalls',
  open: 'Opening remediation requests',
  status: 'Updating vehicle status',
  done: 'Done',
};

const Board = () => {
  const [board, setBoard] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [phase, setPhase] = useState(null);
  const [progressCounts, setProgressCounts] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => {
    const r = await call('getBoard');
    if (r?.error) setError(r.error);
    else {
      setError('');
      setBoard(r);
    }
    return r;
  };
  useEffect(() => { load(); }, []);

  // Scan in steps (each must answer within 25 s). A failed or timed-out step is retried and resumes where it
  // stopped; "Scan now" resumes an unfinished scan instead of starting over.
  const scan = async (restart = true) => {
    setBusy('scan');
    setNotice('');
    setError('');
    let r;
    let misses = 0;
    for (let i = 0; i < 60; i++) {
      r = await call('scanStep', { restart: restart && i === 0 });
      if (r?.error) {
        if (++misses > 3) break;
        await new Promise((ok) => setTimeout(ok, 3000));
        continue;
      }
      misses = 0;
      setPhase(r.phase);
      setProgressCounts(r.counts);
      if (r.phase === 'done') break;
    }
    setBusy('');
    setPhase(null);
    if (r?.error) setError(`${r.error} The scan is saved and resumes where it stopped when you press Scan now again.`);
    else if (r?.phase !== 'done') setError('The scan is taking longer than expected. It is saved; press Scan now to continue.');
    else {
      const c = r.counts;
      const summary = `Scan finished: ${c.vehicles} vehicles, ${c.models} models checked against NHTSA. ${c.opened} new request${c.opened === 1 ? '' : 's'}${c.opened ? ` (${c.likely} likely affected, ${c.possible} to confirm${c.escalated ? `, ${c.escalated} escalated as Park It / Park Outside` : ''})` : ''}; ${c.ruledOut} ruled out for the specific vehicle; ${c.checkOnce} older recall${c.checkOnce === 1 ? '' : 's'} to check once.`;
      if (r.problems) {
        const parts = [c.failed ? `${c.failed} request${c.failed === 1 ? '' : 's'} could not be opened (they will be retried)` : '', c.recallsFailed ? `${c.recallsFailed} model${c.recallsFailed === 1 ? '' : 's'} could not be read from NHTSA` : '', c.decodeUnavailable ? `${c.decodeUnavailable} VINs were not decoded (vPIC unavailable)` : ''].filter(Boolean);
        setError(`${summary} Not everything went through: ${parts.join('; ')}. See the scan notes.`);
      } else setNotice(summary);
    }
    await load();
  };

  const loadSample = async () => {
    setBusy('sample');
    setNotice('');
    setError('');
    let added = 0;
    let r;
    for (let i = 0; i < 10; i++) {
      r = await call('loadSample');
      if (r?.error) break;
      added += r.added;
      setNotice(`Adding sample vehicles${r.inAssets ? ' to Assets' : ''}: ${added} so far…`);
      if (!r.remaining) break;
    }
    setBusy('');
    if (r?.error) {
      setError(r.error);
      await load();
      return;
    }
    setNotice(`Added ${added} sample vehicles${r.inAssets ? ' to the Fleet schema in Assets' : ' to the Roadworthy register'}. Scanning them against NHTSA now…`);
    await load();
    await scan(true);
  };

  const removeSample = async () => {
    setConfirmRemove(false);
    setBusy('remove');
    setNotice('');
    setError('');
    let r;
    let req = 0;
    let veh = 0;
    for (let i = 0; i < 10; i++) {
      r = await call('removeSample');
      if (r?.error) break;
      req += r.removedRequests;
      veh += r.removedVehicles;
      if (!r.remaining) break;
    }
    setBusy('');
    if (r?.error) setError(r.error);
    else setNotice(`Removed the sample fleet: ${veh} vehicles and ${req} requests.`);
    await load();
  };

  const openFromReview = async (key) => {
    setBusy(key);
    setError('');
    const r = await call('openFromReview', { key });
    setBusy('');
    if (r?.error) setError(r.error);
    else setNotice(`Opened ${r.issueKey}.`);
    await load();
  };

  if (!board) return error ? <ErrorMessage>{error}</ErrorMessage> : <Spinner label="Loading the fleet" />;

  const { stats, open, grounded, vehicles, job, setup, progress, reviews, checks, headline, isAdmin, flushed } = board;
  const hasSample = vehicles.some((v) => v.sample);
  const scanning = busy === 'scan';
  const allDone = progress.project && progress.vehicles && progress.scanned && progress.remediated;

  const openRows = open.map((c) => ({
    key: c.key,
    cells: [
      { key: c.levelLabel, content: <LevelPill level={c.level} label={c.levelLabel} /> },
      { key: c.issueKey, content: <Link href={`/browse/${c.issueKey}`}>{c.issueKey}</Link> },
      { key: c.vehicle, content: <Text>{c.vehicle}</Text> },
      { key: c.verdict, content: <VerdictPill verdict={c.verdict} label={c.verdictLabel} /> },
      { key: c.depot, content: <Text>{c.depot}</Text> },
      { key: c.campaign, content: <Link href={c.campaignUrl} openNewTab>{c.campaign}</Link> },
      { key: c.component, content: <Text>{String(c.component || '').split(':').slice(0, 2).join(': ').toLowerCase()}</Text> },
      { key: c.due, content: c.overdue ? <Pill appearance="removed">overdue {fmtDate(c.due)}</Pill> : <Text>{fmtDate(c.due)}</Text> },
      { key: c.state, content: <StatePill state={c.state} /> },
    ],
  }));
  const openHead = { cells: ['Severity', 'Request', 'Vehicle', 'Applies', 'Depot', 'Campaign', 'Component', 'Due', 'State'].map((t) => ({ key: t, content: t, isSortable: true })) };

  const reviewRows = reviews.map((r) => ({
    key: r.key,
    cells: [
      { key: r.levelLabel, content: <LevelPill level={r.level} label={r.levelLabel} /> },
      { key: r.vehicle, content: <Text>{r.vehicle}</Text> },
      { key: r.campaign, content: <Link href={r.campaignUrl} openNewTab>{r.campaign}</Link> },
      { key: r.why, content: <Text>{r.why}</Text> },
      {
        key: 'act',
        content: (
          <Inline space="space.100" alignBlock="center">
            <Link href={r.vinLookupUrl} openNewTab>VIN lookup</Link>
            <Button spacing="compact" isDisabled={!!busy} onClick={() => openFromReview(r.key)}>{busy === r.key ? 'Opening…' : 'Open request'}</Button>
          </Inline>
        ),
      },
    ],
  }));
  const reviewHead = { cells: ['Severity', 'Vehicle', 'Campaign', 'Why it doesn’t apply', ''].map((t) => ({ key: t || 'a', content: t })) };

  const dismissCheck = async (key) => {
    setBusy(key);
    const r = await call('dismissCheck', { key });
    setBusy('');
    if (r?.error) setError(r.error);
    await load();
  };
  const checkRows = checks.map((r) => ({
    key: r.key,
    cells: [
      { key: r.vehicle, content: <Text>{r.vehicle}</Text> },
      { key: r.campaign, content: <Link href={r.campaignUrl} openNewTab>{r.campaign}</Link> },
      { key: r.reported || '', content: <Text>{fmtDate(r.reported)}</Text> },
      { key: r.component, content: <Text>{String(r.component || '').split(':').slice(0, 2).join(': ').toLowerCase()}</Text> },
      {
        key: 'act',
        content: (
          <Inline space="space.100" alignBlock="center">
            <Link href={r.vinLookupUrl} openNewTab>VIN lookup</Link>
            <Button spacing="compact" isDisabled={!!busy} onClick={() => dismissCheck(r.key)}>Checked</Button>
            <Button spacing="compact" isDisabled={!!busy} onClick={() => openFromReview(r.key)}>Still open</Button>
          </Inline>
        ),
      },
    ],
  }));
  const checkHead = { cells: ['Vehicle', 'Campaign', 'Reported', 'Component', ''].map((t) => ({ key: t || 'a', content: t })) };

  const depotRows = stats.byDepot.map((d) => ({
    key: d.depot,
    cells: [
      { key: d.depot, content: <Strong>{d.depot}</Strong> },
      { key: d.vehicles, content: <Text>{String(d.vehicles)}</Text> },
      { key: d.available, content: <Text>{String(d.available)}</Text> },
      { key: d.affected, content: <Text>{String(d.affected)}</Text> },
      { key: d.open, content: <Text>{String(d.open)}</Text> },
      { key: d.overdue, content: d.overdue ? <Pill appearance="removed">{String(d.overdue)}</Pill> : <Text>0</Text> },
      { key: d.doNotDrive, content: d.doNotDrive ? <Pill appearance="removed" bold>{String(d.doNotDrive)}</Pill> : <Text>0</Text> },
      { key: d.pctRemedied, content: <Text>{`${d.pctRemedied}%`}</Text> },
    ],
  }));
  const depotHead = { cells: ['Depot', 'Vehicles', 'Dispatchable', 'Affected', 'Open recalls', 'Overdue', 'Do not drive', 'Remedied'].map((t) => ({ key: t, content: t, isSortable: true })) };

  const vehicleRows = vehicles.map((v) => ({
    key: v.vin,
    cells: [
      { key: v.name, content: v.assetUrl ? <Link href={v.assetUrl}>{v.name || v.vin}</Link> : <Text>{v.name || v.vin}</Text> },
      { key: v.label, content: <Text>{v.label || (v.decodeError ? `Not decoded: ${v.decodeError}` : 'Not decoded yet')}</Text> },
      { key: v.vin, content: <Text>{v.vin}</Text> },
      { key: v.depot, content: <Text>{v.depot}</Text> },
      { key: v.status, content: <StatusPill status={v.status} /> },
      { key: v.openRecalls, content: <Text>{String(v.openRecalls)}</Text> },
      { key: v.lastCheck || '', content: <Text>{v.lastCheck ? fmtWhen(new Date(v.lastCheck).getTime()) : 'Never'}</Text> },
    ],
  }));
  const vehicleHead = { cells: ['Unit', 'Vehicle', 'VIN', 'Depot', 'Status', 'Open recalls', 'Last recall check'].map((t) => ({ key: t, content: t, isSortable: true })) };

  return (
    <Stack space="space.300">
      <Text>
        Safety recalls for your whole fleet, in Jira Service Management. Vehicles are decoded with NHTSA vPIC and checked
        against live NHTSA recalls every day; each campaign on each vehicle becomes one remediation request, and Park It
        recalls ground the vehicle at once.
      </Text>

      {headline.matched ? (
        <Box xcss={{ padding: 'space.200', borderRadius: 'border.radius.200', backgroundColor: 'color.background.neutral' }}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            <Heading size="medium">{`NHTSA matched ${headline.matched} → ${headline.needAction} need action${headline.fixed ? ` · ${headline.fixed} fixed` : ''} → ${headline.ruledOut} ruled out, with reasons`}</Heading>
            {headline.checkOnce ? <Text>{`· ${headline.checkOnce} older recalls to check once`}</Text> : null}
          </Inline>
        </Box>
      ) : null}

      {!allDone ? (
        <SectionMessage appearance="discovery" title="Getting started">
          <Stack space="space.075">
            {[
              [progress.project, 'Choose the service project for recall requests (Settings tab).'],
              [progress.vehicles, 'Add vehicles: connect Assets in Settings and add them to the Fleet schema, or load the sample fleet.'],
              [progress.scanned, 'Scan now: Roadworthy checks every vehicle against NHTSA and opens a request per open recall.'],
              [progress.remediated, 'Open a request, schedule the dealer visit, then mark it remedied with the repair order.'],
            ].map(([done, text], i) => (
              <Inline key={text} space="space.100" alignBlock="center">
                <Pill appearance={done ? 'success' : 'default'}>{done ? 'done' : `step ${i + 1}`}</Pill>
                <Text>{text}</Text>
              </Inline>
            ))}
          </Stack>
        </SectionMessage>
      ) : null}

      {grounded.length ? (
        <SectionMessage appearance="error" title={`${grounded.length} vehicle${grounded.length === 1 ? '' : 's'} must not be driven`}>
          <Stack space="space.050">
            {grounded.map((g) => (
              <Text key={g.vin}>
                <Strong>{g.name}</Strong> · {g.label} · {g.depot} depot · {g.campaigns.join(', ') || 'open Park It recall'}
              </Text>
            ))}
          </Stack>
        </SectionMessage>
      ) : null}

      {notice ? <SectionMessage appearance="success"><Text>{notice}</Text></SectionMessage> : null}
      {flushed ? <SectionMessage appearance="information"><Text>{`Pending updates applied: the daily scan changed ${flushed} vehicle${flushed === 1 ? '' : 's'} while no one was signed in, and Assets now shows ${flushed === 1 ? 'that change' : 'those changes'}.`}</Text></SectionMessage> : null}
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {isAdmin && job?.warnings?.length && !busy ? (
        <SectionMessage appearance="warning" title="Notes from the last scan">
          <Stack space="space.050">{job.warnings.slice(0, 6).map((w) => <Text key={w}>{w}</Text>)}</Stack>
        </SectionMessage>
      ) : null}

      <ModalTransition>
        {confirmRemove ? (
          <Modal onClose={() => setConfirmRemove(false)}>
            <ModalHeader><ModalTitle>Remove the sample fleet?</ModalTitle></ModalHeader>
            <ModalBody>
              <Text>This deletes the 25 sample vehicles from Assets, permanently deletes the recall requests Roadworthy opened for them, and clears their records. Your own vehicles and requests are not touched. The Fleet schema stays.</Text>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button appearance="danger" onClick={removeSample}>Yes, remove it</Button>
            </ModalFooter>
          </Modal>
        ) : null}
      </ModalTransition>

      <Inline space="space.200" shouldWrap>
        <Kpi label="Open campaigns" value={stats.openCampaigns} />
        <Kpi label="Vehicles affected" value={stats.vehiclesAffected} tone={stats.vehiclesAffected ? 'warning' : undefined} />
        <Kpi label="Remedied" value={stats.totalCases ? `${stats.pctRemedied}%` : '–'} />
        <Kpi label="Overdue" value={stats.overdue} tone={stats.overdue ? 'danger' : undefined} />
        <Kpi label="Do not drive" value={stats.doNotDrive} tone={stats.doNotDrive ? 'danger' : undefined} />
        <Kpi label={`Dispatchable of ${stats.vehicles}`} value={stats.available} />
        <Kpi label="Ruled out per vehicle" value={stats.ruledOut} />
      </Inline>

      <Inline space="space.100" alignBlock="center" shouldWrap>
        <Button appearance="primary" isDisabled={!!busy || !vehicles.length} onClick={() => scan(true)}>{scanning ? 'Scanning…' : 'Scan now'}</Button>
        {!hasSample && isAdmin ? <Button isDisabled={!!busy} onClick={loadSample}>{busy === 'sample' ? 'Loading…' : 'Load sample fleet'}</Button> : null}
        {hasSample && isAdmin ? <Button appearance="subtle" isDisabled={!!busy} onClick={() => setConfirmRemove(true)}>{busy === 'remove' ? 'Removing…' : 'Remove sample fleet'}</Button> : null}
        <Text>
          {scanning && phase ? `${PHASE_LABEL[phase]}… ${progressCounts ? `${progressCounts.vehicles} vehicles, ${progressCounts.decoded} decoded, ${progressCounts.opened} requests opened so far` : ''}` : job?.finishedAt ? `Last scan ${fmtWhen(job.finishedAt)} (${job.trigger === 'schedule' ? 'daily' : 'manual'})${job.problems ? `, with ${job.problems} problem${job.problems === 1 ? '' : 's'}` : ''}.` : job && job.phase !== 'done' ? 'A scan is in progress or was interrupted; Scan now resumes it.' : 'Not scanned yet.'}
        </Text>
      </Inline>
      {scanning && phase ? <ProgressBar value={(['load', 'decode', 'recalls', 'open', 'status', 'done'].indexOf(phase) + 1) / 6} /> : null}

      <Tabs id="roadworthy-tabs">
        <TabList>
          <Tab>Open recalls ({open.length})</Tab>
          <Tab>Ruled out ({reviews.length})</Tab>
          <Tab>Check once ({checks.length})</Tab>
          <Tab>Depots ({stats.byDepot.length})</Tab>
          <Tab>Vehicles ({vehicles.length})</Tab>
          <Tab>Settings</Tab>
        </TabList>
        <TabPanel>
          <Box paddingBlockStart="space.200">
            {open.length ? (
              <DynamicTable head={openHead} rows={openRows} rowsPerPage={20} />
            ) : (
              <EmptyState
                header={vehicles.length ? 'No open recalls' : 'No vehicles yet'}
                description={vehicles.length ? 'Every vehicle is clear of open NHTSA campaigns. Roadworthy checks again every day.' : isAdmin ? 'Add vehicles to the Fleet schema in Assets, or load the sample fleet to see Roadworthy work end to end.' : 'A Jira administrator can connect Assets or load the sample fleet in Roadworthy.'}
                primaryAction={vehicles.length || !isAdmin ? undefined : <Button appearance="primary" isDisabled={!!busy} onClick={loadSample}>Load sample fleet</Button>}
              />
            )}
          </Box>
        </TabPanel>
        <TabPanel>
          <Stack space="space.200">
            <Box paddingBlockStart="space.200" />
            <Text>
              NHTSA lists recalls by make, model and year. Roadworthy reads each recall's scope (engine, fuel, drive, equipment,
              converter, earlier repairs) and compares it with the VIN decode and the vehicle's Equipment notes. These matches
              don't apply to the specific vehicle, so no request was opened. Open one anyway if you know better.
            </Text>
            {reviews.length ? <DynamicTable head={reviewHead} rows={reviewRows} rowsPerPage={20} /> : <EmptyState header="Nothing ruled out" description="Every NHTSA match applied to its vehicle, or there are no matches yet." />}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.200">
            <Box paddingBlockStart="space.200" />
            <Text>
              Recalls older than a vehicle's recall history (no "Recalls verified to" date, so campaigns more than 12 months
              before it joined Roadworthy) don't open requests or restrict the vehicle. Check each once with the NHTSA VIN
              lookup: "Checked" if it was done or doesn't apply, "Still open" to open a request.
            </Text>
            {checks.length ? <DynamicTable head={checkHead} rows={checkRows} rowsPerPage={20} /> : <EmptyState header="Nothing to check" description="Every vehicle's recall history is covered." />}
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.200">
            <Box paddingBlockStart="space.200" />
            {stats.byDepot.some((d) => d.open) ? (
              <BarChart data={stats.byDepot} xAccessor="depot" yAccessor="open" title="Open recalls by depot" />
            ) : null}
            <DynamicTable head={depotHead} rows={depotRows} />
          </Stack>
        </TabPanel>
        <TabPanel>
          <Stack space="space.200">
            <Box paddingBlockStart="space.200" />
            <Text>
              {setup.assets ? `Vehicles live in the "${setup.assets}" schema in Assets.` : setup.registerOnly ? `Vehicles live in Roadworthy's own register. ${setup.note || ''}` : 'No register yet.'}
              {' '}Only the VIN, make, model and model year are sent to NHTSA.
            </Text>
            {isAdmin ? <AddVehicles onAdded={() => { load(); }} /> : null}
            <DynamicTable head={vehicleHead} rows={vehicleRows} rowsPerPage={25} />
          </Stack>
        </TabPanel>
        <TabPanel>
          <Settings onSaved={load} />
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

// Paste-in import: works with Assets (objects are created in the Fleet schema) and without (in-app register).
const AddVehicles = ({ onAdded }) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const [checkFrom, setCheckFrom] = useState(yearAgo);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  if (!open) return <Inline><Button onClick={() => setOpen(true)}>Add vehicles</Button></Inline>;
  const run = async () => {
    setBusy(true);
    let added = 0;
    let r;
    for (let i = 0; i < 20; i++) {
      r = await call('importVehicles', { text, checkFrom });
      if (r?.error) break;
      added += r.added;
      if (!r.remaining) break;
    }
    setBusy(false);
    setResult(r?.error ? { error: r.error } : { ...r, added });
    if (!r?.error) onAdded();
  };
  return (
    <Stack space="space.100">
      <Label labelFor="rw-csv">Paste vehicles: one per line as unit, VIN, plate, depot, driver, recalls verified to (YYYY-MM-DD), or a CSV with a header row. A bare VIN per line works too.</Label>
      <TextArea id="rw-csv" placeholder={'VAN-210, 1FTBR1C8XLKA20562, 8NRT210, North, Dana Ortiz, 2025-06-01'} onChange={(e) => setText(e.target.value)} />
      <Stack space="space.050">
        <Label labelFor="rw-checkfrom">Recalls verified to (for rows without a date)</Label>
        <DatePicker id="rw-checkfrom" defaultValue={yearAgo} onChange={(v) => setCheckFrom(v)} />
        <Text>Recalls reported before this date go to "Check once" instead of opening requests. Default: 12 months ago.</Text>
      </Stack>
      <Inline space="space.100">
        <Button appearance="primary" isDisabled={busy || !text.trim()} onClick={run}>{busy ? 'Adding…' : 'Add vehicles'}</Button>
        <Button appearance="subtle" onClick={() => { setOpen(false); setResult(null); }}>Close</Button>
      </Inline>
      {result?.error ? <ErrorMessage>{result.error}</ErrorMessage> : null}
      {result && !result.error ? (
        <SectionMessage appearance={result.errors.length || result.skipped.length ? 'warning' : 'success'}>
          <Stack space="space.050">
            <Text>{`Added ${result.added} vehicle${result.added === 1 ? '' : 's'}${result.inAssets ? ' to Assets' : ''}. Run Scan now to check them against NHTSA.`}</Text>
            {result.errors.map((e) => <Text key={`e${e.line}`}>{`Line ${e.line}: ${e.error}`}</Text>)}
            {result.skipped.map((s) => <Text key={`s${s.vin}`}>{`${s.vin}: ${s.reason}`}</Text>)}
          </Stack>
        </SectionMessage>
      ) : null}
    </Stack>
  );
};

const Settings = ({ onSaved }) => {
  const [s, setS] = useState(null);
  const [desk, setDesk] = useState(null);
  const [types, setTypes] = useState([]);
  const [type, setType] = useState(null);
  const [parkOutside, setParkOutside] = useState(true);
  const [openUnlikely, setOpenUnlikely] = useState(false);
  const [registerOnly, setRegisterOnly] = useState(false);
  const [assetField, setAssetField] = useState(null);
  const [target, setTarget] = useState('jsm');
  const [project, setProject] = useState(null);
  const [issueTypes, setIssueTypes] = useState([]);
  const [issueType, setIssueType] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await call('getSettings');
    if (r?.error) return setErr(r.error);
    setS(r);
    setDesk(r.serviceDeskId);
    setTypes(r.requestTypes);
    setType(r.requestTypeId);
    setParkOutside(r.parkOutsideGrounds);
    setOpenUnlikely(r.openUnlikely);
    setRegisterOnly(r.registerOnly);
    setAssetField(r.assetFieldId);
    setTarget(r.target);
    setProject(r.jiraProject?.projectId || null);
    setIssueTypes(r.issueTypes || []);
    setIssueType(r.jiraProject?.issueTypeId || null);
  };
  useEffect(() => { load(); }, []);

  if (!s) return err ? <ErrorMessage>{err}</ErrorMessage> : <Spinner label="Loading settings" />;
  const deskOptions = s.desks.map((d) => ({ label: `${d.projectName} (${d.projectKey})`, value: d.id }));
  const typeOptions = types.map((t) => ({ label: t.name, value: t.id }));
  const fieldOptions = [{ label: 'None (link in the description)', value: '' }, ...s.assetFields.map((f) => ({ label: f.name, value: f.id }))];

  const pickDesk = async (opt) => {
    setDesk(opt?.value);
    setType(null);
    const r = await call('listRequestTypes', { serviceDeskId: opt?.value });
    setTypes(r?.error ? [] : r);
  };
  const save = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    const where = target === 'jira' ? { target: 'jira', projectId: project, issueTypeId: issueType } : { serviceDeskId: desk, requestTypeId: type };
    const r = await call('saveSettings', { ...where, parkOutsideGrounds: parkOutside, openUnlikely, registerOnly, assetFieldId: assetField || '' });
    setBusy(false);
    if (r?.error) setErr(r.error);
    else {
      setMsg('Settings saved.');
      await load();
      onSaved();
    }
  };
  const createType = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    const r = await call('createRecallRequestType');
    setBusy(false);
    if (r?.error) setErr(r.error);
    else setMsg(r.existed ? `Using the existing "${r.name}" request type.` : `Created the "${r.name}" request type and selected it.`);
    await load();
    onSaved();
  };
  const pickProject = async (opt) => {
    setProject(opt?.value);
    setIssueType(null);
    const r = await call('listIssueTypes', { projectId: opt?.value });
    setIssueTypes(r?.error ? [] : r);
  };
  const connect = async () => {
    setBusy(true);
    setMsg('');
    setErr('');
    const r = await call('connectAssets');
    setBusy(false);
    if (r?.error) setErr(r.error);
    else setMsg(r.ok ? `Connected to the "${r.assets.schemaName}" schema in Assets (Vehicle type ready).` : r.reason);
    await load();
    onSaved();
  };

  return (
    <Stack space="space.250">
      <Box paddingBlockStart="space.200" />
      {!s.isAdmin ? <SectionMessage appearance="information"><Text>Only Jira administrators can change these settings.</Text></SectionMessage> : null}
      {msg ? <SectionMessage appearance="success"><Text>{msg}</Text></SectionMessage> : null}
      {err ? <ErrorMessage>{err}</ErrorMessage> : null}

      <Heading size="small">Where recall requests go</Heading>
      {s.desks.length ? (
        <Inline space="space.100" alignBlock="center">
          <Toggle id="rw-target" isChecked={target === 'jira'} onChange={() => setTarget(target === 'jira' ? 'jsm' : 'jira')} isDisabled={!s.isAdmin} />
          <Label labelFor="rw-target">Use a regular Jira project instead of a service project</Label>
        </Inline>
      ) : (
        <SectionMessage appearance="information"><Text>This site has no Jira Service Management project, so Roadworthy creates recall work items in the Jira project you choose.</Text></SectionMessage>
      )}
      {target === 'jira' ? (
        <Stack space="space.100">
          <Stack space="space.050">
            <Label labelFor="rw-project">Jira project</Label>
            <Select inputId="rw-project" options={s.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.id }))} value={s.projects.map((p) => ({ label: `${p.name} (${p.key})`, value: p.id })).find((o) => String(o.value) === String(project)) || null} onChange={pickProject} isDisabled={!s.isAdmin} placeholder="Choose a project" />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="rw-itype">Work type</Label>
            <Select inputId="rw-itype" options={issueTypes.map((t) => ({ label: t.name, value: t.id }))} value={issueTypes.map((t) => ({ label: t.name, value: t.id })).find((o) => String(o.value) === String(issueType)) || null} onChange={(o) => setIssueType(o?.value)} isDisabled={!s.isAdmin || !project} placeholder="Choose a work type" />
          </Stack>
        </Stack>
      ) : null}
      {target !== 'jira' ? (
      <Stack space="space.150">
      <Stack space="space.050">
        <Label labelFor="rw-desk">Service project</Label>
        <Select inputId="rw-desk" options={deskOptions} value={deskOptions.find((o) => String(o.value) === String(desk)) || null} onChange={pickDesk} isDisabled={!s.isAdmin} placeholder="Choose a service project" />
      </Stack>
      <Stack space="space.050">
        <Label labelFor="rw-type">Request type</Label>
        <Select inputId="rw-type" options={typeOptions} value={typeOptions.find((o) => String(o.value) === String(type)) || null} onChange={(o) => setType(o?.value)} isDisabled={!s.isAdmin || !desk} placeholder="Choose a request type" />
        {s.blockingFields.length ? (
          <SectionMessage appearance="warning" title="This request type needs fields Roadworthy can't fill">
            <Text>{`Required: ${s.blockingFields.join(', ')}. Scans won't open requests until you pick another type, make these optional, or create the "Vehicle safety recall" type.`}</Text>
          </SectionMessage>
        ) : null}
        {!s.hasRecallType && desk ? (
          <Inline space="space.100" alignBlock="center">
            <Button isDisabled={!s.isAdmin || busy} onClick={createType}>Create a "Vehicle safety recall" request type</Button>
            <Text>Needs service project admin rights. Agents see it; it isn't shown on the portal.</Text>
          </Inline>
        ) : null}
      </Stack>
      </Stack>
      ) : null}

      <Stack space="space.050">
        <Label labelFor="rw-field">Assets field that links each request to its vehicle (optional)</Label>
        <Select inputId="rw-field" options={fieldOptions} value={fieldOptions.find((o) => o.value === (assetField || '')) || fieldOptions[0]} onChange={(o) => setAssetField(o?.value || null)} isDisabled={!s.isAdmin} />
        <Text>Pick an Assets object field on the request's screen that allows the Fleet schema's Vehicle objects. Without one, each request carries a smart link to the vehicle and its Assets key.</Text>
      </Stack>

      <Heading size="small">Fleet policy</Heading>
      <Inline space="space.100" alignBlock="center">
        <Toggle id="rw-parkout" isChecked={parkOutside} onChange={() => setParkOutside(!parkOutside)} isDisabled={!s.isAdmin} />
        <Label labelFor="rw-parkout">Ground "Park Outside" vehicles too (fire-risk recalls). Park It recalls always ground the vehicle.</Label>
      </Inline>
      <Inline space="space.100" alignBlock="center">
        <Toggle id="rw-unlikely" isChecked={openUnlikely} onChange={() => setOpenUnlikely(!openUnlikely)} isDisabled={!s.isAdmin} />
        <Label labelFor="rw-unlikely">Also open requests for matches ruled unlikely for the vehicle (they are listed under "Ruled out" otherwise).</Label>
      </Inline>
      <Text>Due dates: Park It and Park Outside the same day; high severity (steering, brakes, air bags, fire risk) 14 days; medium 30 days; low 60 days.</Text>
      <Inline>
        <Button appearance="primary" isDisabled={!s.isAdmin || busy || (target === 'jira' ? !project || !issueType : !desk)} onClick={save}>Save settings</Button>
      </Inline>

      <Heading size="small">Vehicle register</Heading>
      <Text>
        {s.assets
          ? `Connected to Assets: schema "${s.assets.schemaName}", object type Vehicle.`
          : s.assetsAvailable
            ? 'Assets is available on this site. Connect it to keep vehicles in a "Fleet" schema (Roadworthy creates the schema and the Vehicle type with VIN, make, model, year, plate, depot, status, driver and recall fields).'
            : "Assets isn't available on this site. Roadworthy keeps vehicles in its own register."}
      </Text>
      {s.assetsAvailable ? (
        <Inline space="space.100" alignBlock="center">
          <Toggle id="rw-register" isChecked={registerOnly} onChange={() => setRegisterOnly(!registerOnly)} isDisabled={!s.isAdmin} />
          <Label labelFor="rw-register">Keep vehicles in Roadworthy's own register instead of Assets (save to apply).</Label>
        </Inline>
      ) : null}
      {s.assetsAvailable && !registerOnly ? (
        <Inline>
          <Button isDisabled={!s.isAdmin || busy} onClick={connect}>{s.assets ? 'Check the Fleet schema' : 'Connect Assets'}</Button>
        </Inline>
      ) : null}
      <Text>Privacy: Roadworthy sends only VINs to NHTSA vPIC and only make, model and model year to the NHTSA recalls API. Plates, drivers, depots and Jira data never leave your site.</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <Board />
  </React.StrictMode>,
);
