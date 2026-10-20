(function() {
    const sonarrStatus = document.getElementById('sonarr-status');
    const radarrStatus = document.getElementById('radarr-status');
    const sonarrQueue = document.getElementById('sonarr-queue');
    const radarrQueue = document.getElementById('radarr-queue');
    const refreshStatusBtn = document.getElementById('refresh-status');
    const searchSonarrBtn = document.getElementById('search-sonarr');
    const searchRadarrBtn = document.getElementById('search-radarr');
    const restartSonarrBtn = document.getElementById('restart-sonarr');
    const restartRadarrBtn = document.getElementById('restart-radarr');
    const saveConfigBtn = document.getElementById('save-config');
    const searchFeedback = document.getElementById('search-feedback');
    const restartFeedback = document.getElementById('restart-feedback');
    const configFeedback = document.getElementById('config-feedback');
    const logServiceSelect = document.getElementById('log-service');
    const logLinesInput = document.getElementById('log-lines');
    const logFilterInput = document.getElementById('log-filter');
    const logRefreshBtn = document.getElementById('log-refresh');
    const logFollowBtn = document.getElementById('log-follow');
    const logOutput = document.getElementById('log-output');
    const logFeedback = document.getElementById('log-feedback');
    const sonarrQueueItems = document.getElementById('sonarr-queue-items');
    const radarrQueueItems = document.getElementById('radarr-queue-items');
    const statusClock = document.getElementById('status-clock');

    const unmonitorSonarrBtn = document.getElementById('unmonitor-sonarr');
    const unmonitorRadarrBtn = document.getElementById('unmonitor-radarr');
    const undoSonarrBtn = document.getElementById('undo-sonarr');
    const undoRadarrBtn = document.getElementById('undo-radarr');
    const unmonitorFeedback = document.getElementById('unmonitor-feedback');

    let lastUnmonitorSonarr = null;
    let lastUnmonitorRadarr = null;

    const exclusionSearchInput = document.getElementById('exclusion-search-input');
    const exclusionSearchResults = document.getElementById('exclusion-search-results');
    const exclusionList = document.getElementById('exclusion-list');
    const exclusionsStaleNotice = document.getElementById('exclusions-stale-notice');
    const auditDetails = document.getElementById('monitoring-audit');
    const auditScanBtn = document.getElementById('monitoring-audit-scan');
    const auditFilter = document.getElementById('monitoring-audit-filter');
    const auditList = document.getElementById('monitoring-audit-list');
    const auditSummary = document.getElementById('monitoring-audit-summary');
    const auditFeedback = document.getElementById('monitoring-audit-feedback');
    let auditShows = [];
    let auditLoaded = false;
    let auditScanned = false;
    let auditLoading = false;
    const auditSaving = new Map();
    const specialsDetails = document.getElementById('specials-exceptions');
    const specialsApplyBtn = document.getElementById('specials-apply');
    const specialsScanBtn = document.getElementById('specials-scan');
    const specialsFilter = document.getElementById('specials-filter');
    const specialsList = document.getElementById('specials-list');
    const specialsSummary = document.getElementById('specials-summary');
    const specialsFeedback = document.getElementById('specials-feedback');
    const specialsExceptionsFeedback = document.getElementById('specials-exceptions-feedback');
    let specialsShows = [];
    let specialsLoaded = false;
    let specialsLoading = false;
    let specialsScanned = false;
    let specialsApplying = false;
    const specialsSaving = new Map();
    let sonarrSeriesCache = null;

    const unmonitorLogSonarrBtn = document.getElementById('unmonitor-log-sonarr');
    const unmonitorLogRadarrBtn = document.getElementById('unmonitor-log-radarr');
    const unmonitorLogRefreshBtn = document.getElementById('unmonitor-log-refresh');
    const unmonitorLogEntries = document.getElementById('unmonitor-log-entries');
    let unmonitorLogService = 'sonarr';

    const INTERVAL_LABELS = {
        30: '30 minutes',
        60: '1 hour',
        180: '3 hours',
        360: '6 hours',
        720: '12 hours',
        1440: '24 hours',
        2880: '48 hours',
        10080: '1 week',
    };

    function populateIntervalSelect(select) {
        Object.entries(INTERVAL_LABELS).forEach(([value, label]) => {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = label;
            select.appendChild(opt);
        });
    }

    function formatNextRun(lastRunIso, intervalMinutes, enabled) {
        if (!enabled) return 'disabled';
        if (!lastRunIso) return 'runs within ~1 min';
        const next = new Date(lastRunIso).getTime() + intervalMinutes * 60000;
        const diffMs = next - Date.now();
        if (diffMs <= 0) return 'due now';
        const mins = Math.round(diffMs / 60000);
        if (mins < 60) return `next in ${mins}m`;
        const hours = Math.floor(mins / 60);
        const rem = mins % 60;
        return rem ? `next in ${hours}h ${rem}m` : `next in ${hours}h`;
    }

    // Drives one "run this on a schedule" panel (auto-search, auto-unmonitor, ...)
    function createScheduleController(name, endpoint) {
        const el = (suffix) => document.getElementById(`${name}-${suffix}`);
        const services = {
            sonarr: {
                enabled: el('sonarr-enabled'),
                interval: el('sonarr-interval'),
                next: el('sonarr-next'),
            },
            radarr: {
                enabled: el('radarr-enabled'),
                interval: el('radarr-interval'),
                next: el('radarr-next'),
            },
        };
        const saveBtn = document.getElementById(`save-${name}`);
        const feedback = el('feedback');

        // A cached/stale template can serve markup without this panel. Skip it rather
        // than throwing, which would abort the rest of the page's scripts.
        const missing = Object.values(services).some(
            (s) => !s.enabled || !s.interval || !s.next
        ) || !saveBtn || !feedback;
        if (missing) {
            console.warn(`Schedule panel "${name}" not found in DOM - skipping`);
            return { fetchState: () => {} };
        }

        Object.values(services).forEach((s) => populateIntervalSelect(s.interval));

        async function fetchState() {
            try {
                const resp = await fetch(endpoint);
                const data = await resp.json();
                Object.entries(services).forEach(([service, els]) => {
                    const state = data[service];
                    els.enabled.checked = state.enabled;
                    els.interval.value = state.interval_minutes;
                    els.next.textContent = formatNextRun(
                        state.last_run, state.interval_minutes, state.enabled);
                });
            } catch (e) {
                console.error(`Failed to load ${name}:`, e);
            }
        }

        async function save() {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Saving...';
            try {
                const payload = {};
                Object.entries(services).forEach(([service, els]) => {
                    payload[service] = {
                        enabled: els.enabled.checked,
                        interval_minutes: parseInt(els.interval.value, 10),
                    };
                });
                const resp = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                const data = await resp.json();
                if (data.success) {
                    showFeedback(feedback, 'Schedule saved', 'success');
                    fetchState();
                } else {
                    showFeedback(feedback, data.error || 'Failed to save', 'error');
                }
            } catch (e) {
                showFeedback(feedback, `Failed to save: ${e.message}`, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save Schedule';
            }
        }

        saveBtn.addEventListener('click', save);
        return { fetchState };
    }

    const autoSearchSchedule = createScheduleController('auto-search', '/api/auto-search');
    const autoUnmonitorSchedule = createScheduleController('auto-unmonitor', '/api/auto-unmonitor');

    const sonarrUrlInput = document.getElementById('sonarr-url');
    const sonarrKeyInput = document.getElementById('sonarr-key');
    const radarrUrlInput = document.getElementById('radarr-url');
    const radarrKeyInput = document.getElementById('radarr-key');
    const sonarrContainerInput = document.getElementById('sonarr-container');
    const radarrContainerInput = document.getElementById('radarr-container');

    function setStatus(element, healthy, error) {
        element.className = 'status ' + (healthy ? 'healthy' : 'unhealthy');
        if (healthy) {
            element.textContent = 'Healthy';
        } else {
            element.textContent = error || 'Unreachable';
        }
    }

    function showFeedback(element, message, type) {
        element.textContent = message;
        element.className = 'feedback ' + type;
        if (type === 'success') {
            setTimeout(() => {
                element.textContent = '';
                element.className = 'feedback';
            }, 3000);
        }
    }

    async function fetchStatus() {
        sonarrStatus.className = 'status checking';
        sonarrStatus.textContent = 'Checking...';
        radarrStatus.className = 'status checking';
        radarrStatus.textContent = 'Checking...';

        try {
            const resp = await fetch('/api/status');
            const data = await resp.json();

            setStatus(sonarrStatus, data.sonarr.healthy, data.sonarr.error);
            setStatus(radarrStatus, data.radarr.healthy, data.radarr.error);
        } catch (e) {
            setStatus(sonarrStatus, false, 'Error');
            setStatus(radarrStatus, false, 'Error');
        }
    }

    async function fetchQueue() {
        try {
            const resp = await fetch('/api/queue');
            const data = await resp.json();

            sonarrQueue.textContent = data.sonarr;
            radarrQueue.textContent = data.radarr;
        } catch (e) {
            sonarrQueue.textContent = '?';
            radarrQueue.textContent = '?';
        }
    }

    function renderQueueItems(items, container) {
        container.textContent = '';
        if (!items || items.length === 0) {
            const row = document.createElement('tr');
            const cell = document.createElement('td');
            cell.colSpan = 4;
            cell.textContent = 'No items in queue';
            cell.className = 'empty';
            row.appendChild(cell);
            container.appendChild(row);
            return;
        }

        items.forEach((item) => {
            const row = document.createElement('tr');

            const titleCell = document.createElement('td');
            titleCell.textContent = item.title || 'Unknown';

            const statusCell = document.createElement('td');
            statusCell.textContent = item.status || 'unknown';

            const qualityCell = document.createElement('td');
            qualityCell.textContent = item.quality || '-';

            const progressCell = document.createElement('td');
            progressCell.textContent = typeof item.progress === 'number' ? `${item.progress}%` : '-';

            row.appendChild(titleCell);
            row.appendChild(statusCell);
            row.appendChild(qualityCell);
            row.appendChild(progressCell);
            container.appendChild(row);
        });
    }

    async function fetchQueueItems() {
        try {
            const resp = await fetch('/api/queue/items?limit=10');
            const data = await resp.json();

            renderQueueItems(data.sonarr || [], sonarrQueueItems);
            renderQueueItems(data.radarr || [], radarrQueueItems);
        } catch (e) {
            renderQueueItems([], sonarrQueueItems);
            renderQueueItems([], radarrQueueItems);
        }
    }

    async function fetchConfig() {
        try {
            const resp = await fetch('/api/config');
            const data = await resp.json();

            sonarrUrlInput.value = data.sonarr_url || '';
            sonarrKeyInput.value = data.sonarr_api_key || '';
            radarrUrlInput.value = data.radarr_url || '';
            radarrKeyInput.value = data.radarr_api_key || '';
            sonarrContainerInput.value = data.sonarr_container || '';
            radarrContainerInput.value = data.radarr_container || '';
        } catch (e) {
            console.error('Failed to load config:', e);
        }
    }

    async function searchMissing(service) {
        const btn = service === 'sonarr' ? searchSonarrBtn : searchRadarrBtn;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Searching...';
        showFeedback(searchFeedback, `Starting ${service} search...`, 'info');

        try {
            const resp = await fetch(`/api/${service}/search`, { method: 'POST' });
            const data = await resp.json();

            if (data.success) {
                showFeedback(searchFeedback, `${service} search started successfully`, 'success');
                startFollowLogs(service, 30000);
            } else {
                showFeedback(searchFeedback, `${service} search failed: ${data.error}`, 'error');
            }
        } catch (e) {
            showFeedback(searchFeedback, `${service} search failed: ${e.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async function restartService(service) {
        const btn = service === 'sonarr' ? restartSonarrBtn : restartRadarrBtn;
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Restarting...';
        showFeedback(restartFeedback, `Restarting ${service}...`, 'info');

        try {
            const resp = await fetch(`/api/${service}/restart`, { method: 'POST' });
            const data = await resp.json();

            if (data.success) {
                showFeedback(restartFeedback, `${service} restarted successfully`, 'success');
                // Refresh status after restart
                setTimeout(fetchStatus, 5000);
            } else {
                showFeedback(restartFeedback, `${service} restart failed: ${data.error}`, 'error');
            }
        } catch (e) {
            showFeedback(restartFeedback, `${service} restart failed: ${e.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    function normalizeLogLines() {
        const value = parseInt(logLinesInput.value, 10);
        if (Number.isNaN(value)) {
            return 200;
        }
        return Math.min(Math.max(value, 10), 1000);
    }

    function filterLogs(text) {
        const filterValue = logFilterInput.value.trim();
        if (!filterValue) {
            return text;
        }
        try {
            const regex = new RegExp(filterValue, 'i');
            return text
                .split('\n')
                .filter((line) => regex.test(line))
                .join('\n');
        } catch (e) {
            showFeedback(logFeedback, `Invalid filter: ${e.message}`, 'error');
            return text;
        }
    }

    function orderLogsNewestFirst(text) {
        return text
            .split('\n')
            .filter((line) => line.trim() !== '')
            .reverse()
            .join('\n');
    }

    async function fetchLogs() {
        const service = logServiceSelect.value;
        const lines = normalizeLogLines();

        logFeedback.textContent = '';
        logFeedback.className = 'feedback';

        try {
            const resp = await fetch(`/api/logs/${service}?lines=${lines}`);
            const data = await resp.json();

            if (!data.success) {
                showFeedback(logFeedback, data.error || 'Failed to load logs', 'error');
                return;
            }

            const filtered = filterLogs(data.logs || '');
            const ordered = orderLogsNewestFirst(filtered);
            logOutput.textContent = ordered || '(no matching log lines)';
        } catch (e) {
            showFeedback(logFeedback, `Failed to load logs: ${e.message}`, 'error');
        }
    }

    let followTimer = null;
    let followStopTimer = null;

    function stopFollowLogs() {
        if (followTimer) {
            clearInterval(followTimer);
            followTimer = null;
        }
        if (followStopTimer) {
            clearTimeout(followStopTimer);
            followStopTimer = null;
        }
        logFollowBtn.textContent = 'Follow Logs';
    }

    function startFollowLogs(service, durationMs) {
        if (service) {
            logServiceSelect.value = service;
        }
        if (!logFilterInput.value.trim()) {
            logFilterInput.value = 'search|command|missing|release|grab|import';
        }
        stopFollowLogs();
        fetchLogs();
        followTimer = setInterval(fetchLogs, 2000);
        logFollowBtn.textContent = 'Stop Follow';
        if (durationMs) {
            followStopTimer = setTimeout(stopFollowLogs, durationMs);
        }
    }

    async function saveConfig() {
        saveConfigBtn.disabled = true;
        saveConfigBtn.textContent = 'Saving...';

        const config = {
            sonarr_url: sonarrUrlInput.value,
            sonarr_api_key: sonarrKeyInput.value,
            radarr_url: radarrUrlInput.value,
            radarr_api_key: radarrKeyInput.value,
            sonarr_container: sonarrContainerInput.value,
            radarr_container: radarrContainerInput.value,
        };

        try {
            const resp = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(config)
            });
            const contentType = resp.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                const bodyText = await resp.text();
                throw new Error(bodyText || `Unexpected response (${resp.status})`);
            }
            const data = await resp.json();

            if (data.success) {
                showFeedback(configFeedback, 'Settings saved', 'success');
                fetchStatus();
                fetchQueue();
                fetchQueueItems();
            } else {
                showFeedback(configFeedback, data.error || 'Failed to save settings', 'error');
            }
        } catch (e) {
            showFeedback(configFeedback, `Failed to save: ${e.message}`, 'error');
        } finally {
            saveConfigBtn.disabled = false;
            saveConfigBtn.textContent = 'Save Settings';
        }
    }

    async function unmonitorDownloaded(service) {
        const btn = service === 'sonarr' ? unmonitorSonarrBtn : unmonitorRadarrBtn;
        const originalText = btn.textContent;
        btn.disabled = true;
        renderSpecialsExceptions();
        btn.textContent = 'Working...';
        showFeedback(unmonitorFeedback, `Scanning ${service} for downloaded items...`, 'info');

        try {
            const resp = await fetch(`/api/${service}/unmonitor-downloaded`, { method: 'POST' });
            const data = await resp.json();

            if (data.success) {
                const noun = service === 'sonarr' ? 'episodes' : 'movies';
                const nothingHappened = data.count === 0 && !data.series_count && !data.season_count &&
                    !data.new_season_count && !data.new_season_series_count;
                if (nothingHappened) {
                    showFeedback(unmonitorFeedback, data.message || `No monitored downloaded ${noun} found`, 'info');
                } else {
                    const parts = [];
                    if (data.count || data.series_count) {
                        let unmonitorMsg = `Unmonitored ${data.count} ${noun}`;
                        if (data.series_count) {
                            unmonitorMsg += ` and ${data.series_count} series`;
                        }
                        parts.push(unmonitorMsg);
                    }
                    if (data.season_count) {
                        parts.push(`Retired ${data.season_count} completed season${data.season_count === 1 ? '' : 's'} on still-airing shows`);
                    }
                    if (data.new_season_count) {
                        let seasonMsg = `Re-monitored ${data.new_season_count} missing episode${data.new_season_count === 1 ? '' : 's'}`;
                        if (data.new_season_series_count) {
                            seasonMsg += ` across ${data.new_season_series_count} show${data.new_season_series_count === 1 ? '' : 's'}`;
                        }
                        parts.push(seasonMsg);
                    } else if (data.new_season_series_count) {
                        parts.push(`Restored monitoring for ${data.new_season_series_count} show${data.new_season_series_count === 1 ? '' : 's'}`);
                    }
                    showFeedback(unmonitorFeedback, parts.join('; '), 'success');

                    if (service === 'sonarr') {
                        lastUnmonitorSonarr = { episode_ids: data.episode_ids, series_ids: data.series_ids };
                        undoSonarrBtn.style.display = '';
                    } else {
                        lastUnmonitorRadarr = { ids: data.ids };
                        undoRadarrBtn.style.display = '';
                    }
                    if (document.getElementById('unmonitor-log-details').open) fetchUnmonitorLog();
                }
            } else {
                showFeedback(unmonitorFeedback, `Failed: ${data.error}`, 'error');
            }
        } catch (e) {
            showFeedback(unmonitorFeedback, `Failed: ${e.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = originalText;
            renderSpecialsExceptions();
        }
    }

    function renderSpecialsExceptions() {
        const busy = specialsLoading || specialsApplying;
        specialsScanBtn.disabled = busy || specialsSaving.size > 0;
        specialsApplyBtn.disabled = busy || specialsSaving.size > 0 || unmonitorSonarrBtn.disabled;
        specialsList.replaceChildren();
        const query = specialsFilter.value.trim().toLowerCase();
        const matches = specialsShows.filter(show => show.title.toLowerCase().includes(query));
        const selected = specialsShows.filter(show => show.exception).length;
        specialsSummary.textContent = `${selected} saved exception${selected === 1 ? '' : 's'}. ` +
            (specialsScanned ? `${specialsShows.length} shows in this scan.` : 'Load specials to select more shows.');
        if (!matches.length) {
            const empty = document.createElement('li');
            empty.className = 'audit-empty';
            empty.textContent = query ? 'No shows match your filter.' :
                (specialsScanned ? 'No shows with specials or saved exceptions found.' : 'No saved specials exceptions yet.');
            specialsList.appendChild(empty);
        }
        matches.forEach(show => {
            const row = document.createElement('li');
            const label = document.createElement('label');
            label.className = 'audit-show';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = specialsSaving.has(show.id) ? specialsSaving.get(show.id) : show.exception;
            checkbox.disabled = busy || specialsSaving.has(show.id) || (show.stale && !show.exception);
            checkbox.setAttribute('aria-label', `Monitor specials for ${show.title}`);
            checkbox.addEventListener('change', () => saveSpecialsException(show, checkbox.checked));
            const title = document.createElement('span');
            title.textContent = show.title;
            label.append(checkbox, title);
            const detail = document.createElement('div');
            detail.className = 'audit-seasons';
            detail.textContent = show.stale ? 'No longer in Sonarr. Uncheck to remove this exception.' :
                (show.special_count == null ? 'Saved exception. Load specials to review this show.' :
                    `${show.special_count} specials · ${show.missing_count} missing`);
            row.append(label, detail);
            specialsList.appendChild(row);
        });
    }

    async function fetchSpecials(scan = false) {
        if (specialsLoading || specialsApplying || specialsSaving.size) return;
        specialsLoading = true;
        specialsScanBtn.textContent = scan ? 'Loading specials...' : 'Loading...';
        renderSpecialsExceptions();
        showFeedback(specialsExceptionsFeedback, scan ? 'Reading Sonarr specials. Large libraries may take a while...' : 'Loading saved exceptions...', 'info');
        try {
            const response = await fetch('/api/sonarr/specials' + (scan ? '?scan=true' : ''));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not load specials');
            specialsShows = data.shows;
            specialsScanned = data.scanned;
            specialsLoaded = true;
            const failures = data.failed_series || [];
            showFeedback(specialsExceptionsFeedback, failures.length ?
                `Incomplete scan — could not read: ${failures.join(', ')}. Load Specials again to retry.` :
                (scan ? 'Select exceptions, then click Apply Specials Rules & Search.' : ''), failures.length ? 'error' : 'info');
        } catch (error) {
            showFeedback(specialsExceptionsFeedback, `Could not load specials: ${error.message}`, 'error');
        } finally {
            specialsLoading = false;
            specialsScanBtn.textContent = 'Load Specials';
            renderSpecialsExceptions();
        }
    }

    async function saveSpecialsException(show, enabled) {
        specialsSaving.set(show.id, enabled);
        renderSpecialsExceptions();
        try {
            const response = await fetch('/api/sonarr/specials', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: show.id, enabled }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not save exception');
            show.exception = enabled;
            if (!enabled && (show.stale || show.special_count == null)) {
                specialsShows = specialsShows.filter(row => row.id !== show.id);
            }
            showFeedback(specialsExceptionsFeedback,
                `${enabled ? 'Saved' : 'Removed'}: ${show.title}. Click Apply Specials Rules & Search to apply.`, 'success');
        } catch (error) {
            showFeedback(specialsExceptionsFeedback, `Exception was not saved: ${error.message}`, 'error');
        } finally {
            specialsSaving.delete(show.id);
            renderSpecialsExceptions();
        }
    }

    async function applySpecialsRules() {
        if (specialsApplying || specialsLoading || specialsSaving.size || unmonitorSonarrBtn.disabled) return;
        specialsApplying = true;
        unmonitorSonarrBtn.disabled = true;
        specialsApplyBtn.textContent = 'Working...';
        renderSpecialsExceptions();
        showFeedback(specialsFeedback, 'Applying specials rules and queuing searches for exception shows...', 'info');
        try {
            const response = await fetch('/api/sonarr/specials/apply', { method: 'POST' });
            const data = await response.json();
            if (!response.ok || data.error) throw new Error(data.error || 'Specials action failed');
            const summary = `Unmonitored ${data.unmonitored_count} specials; monitored ${data.monitored_count} specials; ` +
                `updated ${data.season_count} specials seasons; enabled ${data.series_count} shows; ` +
                `queued searches for ${data.search_count} missing specials.`;
            const errors = data.errors || [];
            showFeedback(specialsFeedback, summary + (errors.length ? ` Some steps failed: ${errors.join('; ')}` : ''),
                data.success ? 'success' : 'error');
            if (document.getElementById('unmonitor-log-details').open) fetchUnmonitorLog();
        } catch (error) {
            showFeedback(specialsFeedback, `Specials action failed: ${error.message}`, 'error');
        } finally {
            specialsApplying = false;
            unmonitorSonarrBtn.disabled = false;
            specialsApplyBtn.textContent = 'Apply Specials Rules & Search';
            renderSpecialsExceptions();
        }
    }

    function renderMonitoringAudit() {
        auditList.replaceChildren();
        const query = auditFilter.value.trim().toLowerCase();
        const matches = auditShows.filter(show => show.title.toLowerCase().includes(query));
        const selectedCount = auditShows.filter(show => show.ignore_year).length;
        auditSummary.textContent = `${selectedCount} saved show exception${selectedCount === 1 ? '' : 's'}. ` +
            (auditScanned ? `${auditShows.length} show${auditShows.length === 1 ? '' : 's'} in this audit.` :
                'Run an audit to find older missing seasons.');
        if (!matches.length) {
            const empty = document.createElement('li');
            empty.className = 'audit-empty';
            empty.textContent = query ? 'No shows match your filter.' :
                (auditScanned ? 'No older missing seasons or saved exceptions found.' : 'No saved exceptions yet.');
            auditList.appendChild(empty);
        }
        matches.forEach(show => {
            const row = document.createElement('li');
            const label = document.createElement('label');
            label.className = 'audit-show';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = auditSaving.has(show.id) ? auditSaving.get(show.id) : show.ignore_year;
            checkbox.disabled = auditLoading || auditSaving.has(show.id) ||
                ((!show.ignore_year) && (show.excluded || show.stale));
            checkbox.setAttribute('aria-label', `Ignore year cutoff for ${show.title}`);
            checkbox.addEventListener('change', () => saveMonitoringOverride(show, checkbox.checked));
            const title = document.createElement('span');
            title.textContent = show.title;
            label.append(checkbox, title);
            const detail = document.createElement('div');
            detail.className = 'audit-seasons';
            if (show.stale) {
                detail.textContent = 'No longer in Sonarr. Uncheck to remove this saved exception.';
            } else if (show.excluded) {
                detail.textContent = 'Excluded entirely: this exception has no effect while the show is excluded.';
            } else if (show.seasons.length) {
                detail.textContent = show.seasons.map(season =>
                    `Season ${season.season} (${season.year ?? 'undated'}): ${season.missing} missing`
                ).join(' · ');
            } else {
                detail.textContent = auditScanned ? 'Saved exception; no older missing seasons found in this scan.' :
                    'Saved exception. Run an audit to review missing seasons.';
            }
            row.append(label, detail);
            auditList.appendChild(row);
        });
        auditScanBtn.disabled = auditLoading || auditSaving.size > 0;
    }

    async function fetchMonitoringAudit(scan = false) {
        if (auditLoading || auditSaving.size) return;
        auditLoading = true;
        auditScanBtn.disabled = true;
        auditScanBtn.textContent = scan ? 'Scanning...' : 'Loading...';
        renderMonitoringAudit();
        showFeedback(auditFeedback, scan ? 'Reading Sonarr seasons. Large libraries may take a while...' : 'Loading saved selections...', 'info');
        try {
            const response = await fetch('/api/sonarr/monitoring-audit' + (scan ? '?scan=true' : ''));
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not load the audit');
            auditShows = data.shows;
            auditLoaded = true;
            auditScanned = data.scanned;
            const failures = data.failed_series || [];
            showFeedback(auditFeedback, failures.length ?
                `Incomplete audit — could not read: ${failures.join(', ')}. Run the audit again to retry.` :
                (scan ? 'Audit complete. Select shows to allow older missing episodes to be re-monitored.' : ''),
                failures.length ? 'error' : 'info');
        } catch (error) {
            showFeedback(auditFeedback, `Audit failed: ${error.message}. You can retry with Run Audit.`, 'error');
        } finally {
            auditLoading = false;
            auditScanBtn.textContent = 'Run Audit';
            renderMonitoringAudit();
        }
    }

    async function saveMonitoringOverride(show, enabled) {
        auditSaving.set(show.id, enabled);
        renderMonitoringAudit();
        try {
            const response = await fetch('/api/sonarr/monitoring-audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: show.id, enabled }),
            });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.error || 'Could not save selection');
            show.ignore_year = enabled;
            if (!enabled && !show.seasons.length) auditShows = auditShows.filter(row => row.id !== show.id);
            showFeedback(auditFeedback, enabled ?
                `Saved: ${show.title} will ignore the year cutoff on the next Sonarr unmonitor run.` :
                `Removed: ${show.title} will use the normal year cutoff on future runs.`, 'success');
        } catch (error) {
            showFeedback(auditFeedback, `Selection was not saved: ${error.message}`, 'error');
        } finally {
            auditSaving.delete(show.id);
            renderMonitoringAudit();
        }
    }

    async function fetchSonarrSeries() {
        if (sonarrSeriesCache) return sonarrSeriesCache;
        try {
            const resp = await fetch('/api/sonarr/series-list');
            const data = await resp.json();
            if (data.success) sonarrSeriesCache = data.series;
        } catch (e) {
            // Search box just stays empty on failure; not worth a dedicated feedback slot
        }
        return sonarrSeriesCache || [];
    }

    function renderExclusionList(exclusions) {
        exclusionList.innerHTML = '';
        if (!exclusions || exclusions.length === 0) {
            exclusionList.innerHTML = '<li class="empty">No excluded shows</li>';
            return;
        }
        exclusions.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach(e => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = e.title;

            const modeSelect = document.createElement('select');
            modeSelect.className = 'exclusion-mode-select';
            [
                { value: 'exclude', label: 'Exclude entirely' },
                { value: 'latest_only', label: 'Latest season only' },
            ].forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                modeSelect.appendChild(o);
            });
            modeSelect.value = e.mode || 'exclude';
            modeSelect.addEventListener('change', () => setExclusionMode(e.id, modeSelect.value));

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.addEventListener('click', () => removeExclusion(e.id));

            const controls = document.createElement('div');
            controls.className = 'exclusion-controls';
            controls.appendChild(modeSelect);
            controls.appendChild(removeBtn);

            li.appendChild(name);
            li.appendChild(controls);
            exclusionList.appendChild(li);
        });
    }

    function renderStaleNotice(stale) {
        if (!stale || stale.length === 0) {
            exclusionsStaleNotice.style.display = 'none';
            exclusionsStaleNotice.innerHTML = '';
            return;
        }
        exclusionsStaleNotice.style.display = '';
        exclusionsStaleNotice.innerHTML = '';
        stale.forEach(s => {
            const row = document.createElement('div');
            row.className = 'exclusions-stale-row';
            const label = document.createElement('span');
            if (s.candidate_id) {
                label.textContent = `"${s.title}" was removed and re-added in Sonarr`;
                const btn = document.createElement('button');
                btn.className = 'btn btn-sm btn-secondary';
                btn.textContent = 'Re-exclude';
                btn.addEventListener('click', () => swapExclusion(s.id, s.candidate_id, s.candidate_title));
                row.appendChild(label);
                row.appendChild(btn);
            } else {
                label.textContent = `"${s.title}" is no longer in Sonarr`;
                const btn = document.createElement('button');
                btn.className = 'btn btn-sm btn-secondary';
                btn.textContent = 'Remove';
                btn.addEventListener('click', () => removeExclusion(s.id));
                row.appendChild(label);
                row.appendChild(btn);
            }
            exclusionsStaleNotice.appendChild(row);
        });
    }

    async function fetchExclusions() {
        try {
            const resp = await fetch('/api/sonarr/exclusions');
            const data = await resp.json();
            if (data.success) {
                renderExclusionList(data.exclusions);
                renderStaleNotice(data.stale);
            }
        } catch (e) {
            // Leave whatever was last rendered in place
        }
    }

    async function addExclusion(id, title) {
        await fetch('/api/sonarr/exclusions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', id, title }),
        });
        fetchExclusions();
    }

    async function removeExclusion(id) {
        await fetch('/api/sonarr/exclusions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'remove', id }),
        });
        fetchExclusions();
    }

    async function setExclusionMode(id, mode) {
        await fetch('/api/sonarr/exclusions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'set_mode', id, mode }),
        });
        fetchExclusions();
    }

    async function swapExclusion(oldId, newId, newTitle) {
        await fetch('/api/sonarr/exclusions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'swap', old_id: oldId, new_id: newId, new_title: newTitle }),
        });
        fetchExclusions();
    }

    async function handleExclusionSearchInput() {
        const query = exclusionSearchInput.value.trim().toLowerCase();
        if (!query) {
            exclusionSearchResults.style.display = 'none';
            exclusionSearchResults.innerHTML = '';
            return;
        }
        const series = await fetchSonarrSeries();
        const matches = series.filter(s => s.title.toLowerCase().includes(query)).slice(0, 15);
        exclusionSearchResults.innerHTML = '';
        if (matches.length === 0) {
            exclusionSearchResults.style.display = 'none';
            return;
        }
        matches.forEach(s => {
            const row = document.createElement('div');
            row.className = 'exclusion-search-result';
            row.textContent = s.title;
            if (s.year) {
                const year = document.createElement('span');
                year.className = 'year';
                year.textContent = `(${s.year})`;
                row.appendChild(year);
            }
            row.addEventListener('click', () => {
                addExclusion(s.id, s.title);
                exclusionSearchInput.value = '';
                exclusionSearchResults.style.display = 'none';
                exclusionSearchResults.innerHTML = '';
            });
            exclusionSearchResults.appendChild(row);
        });
        exclusionSearchResults.style.display = '';
    }

    function formatLogTime(isoStr) {
        const d = new Date(isoStr);
        return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
               d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function buildItemList(entry) {
        const items = [];

        // Movies (radarr)
        if (entry.movies) {
            entry.movies.forEach(m => {
                items.push(m.title || `Movie #${m.id}`);
            });
        }

        // Series-level (or season-level) changes
        if (entry.series) {
            entry.series.forEach(s => {
                const scope = s.season !== undefined && s.season !== null ? `Season ${s.season}` : 'entire series';
                items.push(`${s.title || 'Series #' + s.id} (${scope})`);
            });
        }

        // Episodes - group by series
        if (entry.episodes && entry.episodes.length > 0) {
            const byShow = {};
            entry.episodes.forEach(ep => {
                const show = ep.series || 'Unknown';
                if (!byShow[show]) byShow[show] = [];
                const sNum = String(ep.season || 0).padStart(2, '0');
                const eNum = String(ep.episode || 0).padStart(2, '0');
                const label = `S${sNum}E${eNum}`;
                byShow[show].push(ep.title ? `${label} - ${ep.title}` : label);
            });
            for (const [show, eps] of Object.entries(byShow)) {
                items.push(`${show}: ${eps.join(', ')}`);
            }
        }

        return items;
    }

    async function fetchUnmonitorLog() {
        try {
            const resp = await fetch(`/api/unmonitor-log?service=${unmonitorLogService}`);
            const data = await resp.json();
            if (!data.success) return;

            unmonitorLogEntries.textContent = '';
            if (data.entries.length === 0) {
                const p = document.createElement('p');
                p.className = 'empty';
                p.textContent = 'No entries';
                unmonitorLogEntries.appendChild(p);
                return;
            }

            data.entries.forEach((entry) => {
                const row = document.createElement('div');
                row.className = 'unmonitor-log-entry';

                const info = document.createElement('div');
                info.className = 'unmonitor-log-entry-info';

                // Header line: badge + time + status change
                const header = document.createElement('div');
                header.className = 'unmonitor-log-entry-header';

                const badge = document.createElement('span');
                badge.className = `unmonitor-log-entry-action ${entry.action}`;
                badge.textContent = entry.action;
                header.appendChild(badge);

                if (entry.source === 'scheduled') {
                    const sourceSpan = document.createElement('span');
                    sourceSpan.className = 'unmonitor-log-entry-source';
                    sourceSpan.textContent = 'scheduled';
                    header.appendChild(sourceSpan);
                }

                const timeSpan = document.createElement('span');
                timeSpan.className = 'unmonitor-log-entry-time';
                timeSpan.textContent = formatLogTime(entry.timestamp);
                header.appendChild(timeSpan);

                if (entry.status_change) {
                    const statusSpan = document.createElement('span');
                    statusSpan.className = 'unmonitor-log-entry-status';
                    statusSpan.textContent = entry.status_change;
                    header.appendChild(statusSpan);
                }

                info.appendChild(header);

                // Item list
                const items = buildItemList(entry);
                if (items.length > 0) {
                    const listEl = document.createElement('div');
                    listEl.className = 'unmonitor-log-entry-items';

                    // Show first few items, expandable if many
                    const maxShow = 5;
                    const visibleItems = items.slice(0, maxShow);
                    const hiddenItems = items.slice(maxShow);

                    visibleItems.forEach(text => {
                        const itemEl = document.createElement('div');
                        itemEl.className = 'unmonitor-log-item';
                        itemEl.textContent = text;
                        listEl.appendChild(itemEl);
                    });

                    if (hiddenItems.length > 0) {
                        const moreContainer = document.createElement('div');
                        moreContainer.className = 'unmonitor-log-more-items';
                        moreContainer.style.display = 'none';
                        hiddenItems.forEach(text => {
                            const itemEl = document.createElement('div');
                            itemEl.className = 'unmonitor-log-item';
                            itemEl.textContent = text;
                            moreContainer.appendChild(itemEl);
                        });
                        listEl.appendChild(moreContainer);

                        const toggleBtn = document.createElement('button');
                        toggleBtn.className = 'btn-log-expand';
                        toggleBtn.textContent = `+ ${hiddenItems.length} more`;
                        toggleBtn.addEventListener('click', () => {
                            const hidden = moreContainer.style.display === 'none';
                            moreContainer.style.display = hidden ? '' : 'none';
                            toggleBtn.textContent = hidden ? '- show less' : `+ ${hiddenItems.length} more`;
                        });
                        listEl.appendChild(toggleBtn);
                    }

                    info.appendChild(listEl);
                }

                row.appendChild(info);

                if (entry.action === 'unmonitor') {
                    const undoBtn = document.createElement('button');
                    undoBtn.className = 'btn btn-undo-log';
                    undoBtn.textContent = 'Undo';
                    undoBtn.addEventListener('click', () => undoLogEntry(entry.id, undoBtn));
                    row.appendChild(undoBtn);
                }

                unmonitorLogEntries.appendChild(row);
            });
        } catch (e) {
            console.error('Failed to load unmonitor log:', e);
        }
    }

    async function undoLogEntry(entryId, btn) {
        btn.disabled = true;
        btn.textContent = 'Undoing...';

        try {
            const resp = await fetch(`/api/unmonitor-log/undo/${entryId}`, { method: 'POST' });
            const data = await resp.json();

            if (data.success) {
                const noun = unmonitorLogService === 'sonarr' ? 'episodes' : 'movies';
                let msg = `Re-monitored ${data.count} ${noun}`;
                if (data.series_count) msg += ` and ${data.series_count} series`;
                showFeedback(unmonitorFeedback, msg, 'success');
                fetchUnmonitorLog();
            } else {
                showFeedback(unmonitorFeedback, `Undo failed: ${data.error}`, 'error');
                btn.disabled = false;
                btn.textContent = 'Undo';
            }
        } catch (e) {
            showFeedback(unmonitorFeedback, `Undo failed: ${e.message}`, 'error');
            btn.disabled = false;
            btn.textContent = 'Undo';
        }
    }

    async function undoUnmonitor(service) {
        const btn = service === 'sonarr' ? undoSonarrBtn : undoRadarrBtn;
        const payload = service === 'sonarr' ? lastUnmonitorSonarr : lastUnmonitorRadarr;
        if (!payload) return;

        btn.disabled = true;
        btn.textContent = 'Undoing...';
        showFeedback(unmonitorFeedback, `Re-monitoring ${service} items...`, 'info');

        try {
            const resp = await fetch(`/api/${service}/remonitor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await resp.json();

            if (data.success) {
                const noun = service === 'sonarr' ? 'episodes' : 'movies';
                let msg = `Re-monitored ${data.count} ${noun}`;
                if (data.series_count) {
                    msg += ` and ${data.series_count} series`;
                }
                showFeedback(unmonitorFeedback, msg, 'success');
            } else {
                showFeedback(unmonitorFeedback, `Undo failed: ${data.error}`, 'error');
            }
        } catch (e) {
            showFeedback(unmonitorFeedback, `Undo failed: ${e.message}`, 'error');
        } finally {
            btn.style.display = 'none';
            btn.disabled = false;
            btn.textContent = service === 'sonarr' ? 'Undo Sonarr' : 'Undo Radarr';
            if (service === 'sonarr') lastUnmonitorSonarr = null;
            else lastUnmonitorRadarr = null;
        }
    }

    // Event listeners
    refreshStatusBtn.addEventListener('click', () => {
        fetchStatus();
        fetchQueue();
    });
    searchSonarrBtn.addEventListener('click', () => searchMissing('sonarr'));
    searchRadarrBtn.addEventListener('click', () => searchMissing('radarr'));
    restartSonarrBtn.addEventListener('click', () => restartService('sonarr'));
    restartRadarrBtn.addEventListener('click', () => restartService('radarr'));
    unmonitorSonarrBtn.addEventListener('click', () => unmonitorDownloaded('sonarr'));
    unmonitorRadarrBtn.addEventListener('click', () => unmonitorDownloaded('radarr'));
    undoSonarrBtn.addEventListener('click', () => undoUnmonitor('sonarr'));
    undoRadarrBtn.addEventListener('click', () => undoUnmonitor('radarr'));
    auditDetails.addEventListener('toggle', () => {
        if (auditDetails.open && !auditLoaded) fetchMonitoringAudit();
    });
    auditScanBtn.addEventListener('click', () => fetchMonitoringAudit(true));
    auditFilter.addEventListener('input', renderMonitoringAudit);
    specialsDetails.addEventListener('toggle', () => {
        if (specialsDetails.open && !specialsLoaded) fetchSpecials();
    });
    specialsScanBtn.addEventListener('click', () => fetchSpecials(true));
    specialsFilter.addEventListener('input', renderSpecialsExceptions);
    specialsApplyBtn.addEventListener('click', applySpecialsRules);
    exclusionSearchInput.addEventListener('input', handleExclusionSearchInput);
    exclusionSearchInput.addEventListener('focus', handleExclusionSearchInput);
    document.addEventListener('click', (e) => {
        if (!exclusionSearchInput.contains(e.target) && !exclusionSearchResults.contains(e.target)) {
            exclusionSearchResults.style.display = 'none';
        }
    });
    unmonitorLogSonarrBtn.addEventListener('click', () => {
        unmonitorLogService = 'sonarr';
        unmonitorLogSonarrBtn.classList.add('active');
        unmonitorLogRadarrBtn.classList.remove('active');
        fetchUnmonitorLog();
    });
    unmonitorLogRadarrBtn.addEventListener('click', () => {
        unmonitorLogService = 'radarr';
        unmonitorLogRadarrBtn.classList.add('active');
        unmonitorLogSonarrBtn.classList.remove('active');
        fetchUnmonitorLog();
    });
    unmonitorLogRefreshBtn.addEventListener('click', fetchUnmonitorLog);
    document.getElementById('unmonitor-log-details').addEventListener('toggle', (e) => {
        if (e.target.open) fetchUnmonitorLog();
    });
    saveConfigBtn.addEventListener('click', saveConfig);
    logRefreshBtn.addEventListener('click', fetchLogs);
    logFollowBtn.addEventListener('click', () => {
        if (followTimer) {
            stopFollowLogs();
        } else {
            startFollowLogs();
        }
    });

    // Initial load
    fetchConfig();
    autoSearchSchedule.fetchState();
    autoUnmonitorSchedule.fetchState();
    fetchStatus();
    fetchQueue();
    fetchLogs();
    fetchQueueItems();
    fetchExclusions();
    if (statusClock) {
        const updateClock = () => {
            statusClock.textContent = new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        };
        updateClock();
        setInterval(updateClock, 1000);
    }

    // Auto-refresh status every 30 seconds
    setInterval(() => {
        fetchStatus();
        fetchQueue();
        fetchQueueItems();
        autoSearchSchedule.fetchState();
        autoUnmonitorSchedule.fetchState();
    }, 30000);
})();
