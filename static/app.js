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

    const unmonitorLogSonarrBtn = document.getElementById('unmonitor-log-sonarr');
    const unmonitorLogRadarrBtn = document.getElementById('unmonitor-log-radarr');
    const unmonitorLogRefreshBtn = document.getElementById('unmonitor-log-refresh');
    const unmonitorLogEntries = document.getElementById('unmonitor-log-entries');
    let unmonitorLogService = 'sonarr';

    const autoSearchSonarrEnabled = document.getElementById('auto-search-sonarr-enabled');
    const autoSearchSonarrInterval = document.getElementById('auto-search-sonarr-interval');
    const autoSearchSonarrNext = document.getElementById('auto-search-sonarr-next');
    const autoSearchRadarrEnabled = document.getElementById('auto-search-radarr-enabled');
    const autoSearchRadarrInterval = document.getElementById('auto-search-radarr-interval');
    const autoSearchRadarrNext = document.getElementById('auto-search-radarr-next');
    const saveAutoSearchBtn = document.getElementById('save-auto-search');
    const autoSearchFeedback = document.getElementById('auto-search-feedback');

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
    populateIntervalSelect(autoSearchSonarrInterval);
    populateIntervalSelect(autoSearchRadarrInterval);

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

    async function fetchAutoSearch() {
        try {
            const resp = await fetch('/api/auto-search');
            const data = await resp.json();
            autoSearchSonarrEnabled.checked = data.sonarr.enabled;
            autoSearchSonarrInterval.value = data.sonarr.interval_minutes;
            autoSearchSonarrNext.textContent = formatNextRun(
                data.sonarr.last_run, data.sonarr.interval_minutes, data.sonarr.enabled);
            autoSearchRadarrEnabled.checked = data.radarr.enabled;
            autoSearchRadarrInterval.value = data.radarr.interval_minutes;
            autoSearchRadarrNext.textContent = formatNextRun(
                data.radarr.last_run, data.radarr.interval_minutes, data.radarr.enabled);
        } catch (e) {
            console.error('Failed to load auto-search:', e);
        }
    }

    async function saveAutoSearch() {
        saveAutoSearchBtn.disabled = true;
        saveAutoSearchBtn.textContent = 'Saving...';
        try {
            const resp = await fetch('/api/auto-search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sonarr: {
                        enabled: autoSearchSonarrEnabled.checked,
                        interval_minutes: parseInt(autoSearchSonarrInterval.value, 10),
                    },
                    radarr: {
                        enabled: autoSearchRadarrEnabled.checked,
                        interval_minutes: parseInt(autoSearchRadarrInterval.value, 10),
                    },
                }),
            });
            const data = await resp.json();
            if (data.success) {
                showFeedback(autoSearchFeedback, 'Schedule saved', 'success');
                fetchAutoSearch();
            } else {
                showFeedback(autoSearchFeedback, data.error || 'Failed to save', 'error');
            }
        } catch (e) {
            showFeedback(autoSearchFeedback, `Failed to save: ${e.message}`, 'error');
        } finally {
            saveAutoSearchBtn.disabled = false;
            saveAutoSearchBtn.textContent = 'Save Schedule';
        }
    }

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
        btn.textContent = 'Working...';
        showFeedback(unmonitorFeedback, `Scanning ${service} for downloaded items...`, 'info');

        try {
            const resp = await fetch(`/api/${service}/unmonitor-downloaded`, { method: 'POST' });
            const data = await resp.json();

            if (data.success) {
                const noun = service === 'sonarr' ? 'episodes' : 'movies';
                if (data.count === 0 && (!data.series_count)) {
                    showFeedback(unmonitorFeedback, data.message || `No monitored downloaded ${noun} found`, 'info');
                } else {
                    let msg = `Unmonitored ${data.count} ${noun}`;
                    if (data.series_count) {
                        msg += ` and ${data.series_count} series`;
                    }
                    showFeedback(unmonitorFeedback, msg, 'success');

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
        }
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

        // Series-level changes
        if (entry.series) {
            entry.series.forEach(s => {
                items.push(`${s.title || 'Series #' + s.id} (entire series)`);
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
    saveAutoSearchBtn.addEventListener('click', saveAutoSearch);
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
    fetchAutoSearch();
    fetchStatus();
    fetchQueue();
    fetchLogs();
    fetchQueueItems();
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
        fetchAutoSearch();
    }, 30000);
})();
