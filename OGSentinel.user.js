// ==UserScript==
// @name         OGSentinel
// @namespace    benjamin.bourger
// @version      10.4
// @updateURL    https://raw.githubusercontent.com/BenjaminB-BlueTeam/Og-sentinel/main/OGSentinel.user.js
// @downloadURL  https://raw.githubusercontent.com/BenjaminB-BlueTeam/Og-sentinel/main/OGSentinel.user.js
// @description  OGame : interception Porte de saut (+recyclage post-saut) + envoi auto expéditions + sniper enchère + auto-refresh + notification ntfy sur attaque + raid timé
// @match        *://*.ogame.gameforge.com/game/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(function () {
    'use strict';
    // ============================================================
    // CONFIG NOTIFICATION
    // ============================================================
    const NTFY_TOPIC = 'ogs-2pes0q7ebvyqq5';
    const ALERT_SELECTOR = '#attack_alert.soon';
    const NOTIF_COOLDOWN_KEY = 'ogs_notif_cooldown_min';
    const DEFAULT_NOTIF_COOLDOWN_MIN = 10; // minutes par défaut
    const NOTIF_KEY = 'pds_last_notif';
    const NOTIF_MSGS_KEY = 'ogs_notif_msgs';           // messages pré-enregistrés (JSON array)
    const DEFAULT_NOTIF_MSGS = ['Retour de Ghost', 'Retour de full'];
    const RECUR_INT_KEY = 'ogs_recur_int_min';         // série récurrente : intervalle (min)
    const RECUR_DUR_KEY = 'ogs_recur_dur_h';           // série récurrente : durée (h)
    const DEFAULT_RECUR_INT = 20;
    const DEFAULT_RECUR_DUR = 3;
    const RECUR_MAX = 40;                               // garde-fou anti-spam ntfy
    const RAID_MARGIN_KEY = 'ogs_raid_margin_ms';      // raid timé : cushion (ms) dans la seconde de départ
    const DEFAULT_RAID_MARGIN_MS = 300;
    const RAID_MODE_KEY = 'ogs_raid_mode';             // 'manual' | 'auto'
    const DECA_SPY_KEY = 'ogs_deca_spy_pending';       // espionnage auto après décalage sonde (JSON)
    const RAID_AUTO_KEY = 'ogs_raid_auto_cfg';         // config auto (JSON)
    // ============================================================
    // VAISSEAUX (tech ID -> nom)
    // ============================================================
    const SHIPS = [
        { id: 204, name: 'Chasseur léger' },
        { id: 205, name: 'Chasseur lourd' },
        { id: 206, name: 'Croiseur' },
        { id: 207, name: 'Vaisseau de bataille' },
        { id: 215, name: 'Traqueur' },
        { id: 211, name: 'Bombardier' },
        { id: 213, name: 'Destructeur' },
        { id: 214, name: 'Étoile de la mort' },
        { id: 218, name: 'Faucheur' },
        { id: 219, name: 'Éclaireur' },
        { id: 202, name: 'Petit transporteur' },
        { id: 203, name: 'Grand transporteur' },
        { id: 208, name: 'Vaisseau de colonisation' },
        { id: 209, name: 'Recycleur' },
        { id: 210, name: 'Sonde d\'espionnage' },
    ];
    const STORAGE_KEY = 'pds_selected_ships';
    const REFRESH_KEY = 'pds_autorefresh';
    const REFRESH_MIN_KEY = 'pds_refresh_min';
    const REFRESH_MAX_KEY = 'pds_refresh_max';
    const EXPE_STATE_KEY = 'ogs_expedition_state';
    const EXPE_HOLD_KEY = 'ogs_expe_hold_hours';     // temps de maintien (heures) des expéditions
    const DEFAULT_EXPE_HOLD_HOURS = 1;
    const EXPE_COUNT_KEY = 'ogs_expe_count';         // nb de slots à envoyer par run (0 = Toutes)
    const EXPE_TOTAL_KEY = 'ogs_expe_total';         // dernier total de slots d'expédition connu
    const GHOST_AUTO_KEY = 'ogs_ghost_auto';
    const GHOST_PENDING_KEY = 'ogs_ghost_pending';
    const SNIPE_ARMED_KEY = 'ogs_snipe_armed';
    const SNIPE_MARGIN_KEY = 'ogs_snipe_margin_ms';  // marge en ms avant endTime
    const SNIPE_MAXMETAL_KEY = 'ogs_snipe_maxmetal'; // plafond de sécurité
    const SNIPE_BUMP_KEY = 'ogs_snipe_bump';         // surplus au-dessus du minimum
    const SNIPE_RESOURCE_KEY = 'ogs_snipe_resource'; // ressource de mise : 'metal' | 'crystal'
    const SNIPE_RAFALE_KEY = 'ogs_snipe_rafale';         // mode rafale on/off
    const SNIPE_RAFALE_BUMP_KEY = 'ogs_snipe_rafale_bump'; // métal ajouté au-dessus du prix courant, à chaque tir
    const DEFAULT_SNIPE_RAFALE_BUMP = 50000;
    const SNIPE_RAFALE_INTERVAL_KEY = 'ogs_snipe_rafale_interval'; // ms entre 2 tirs de rafale
    const DEFAULT_SNIPE_RAFALE_INTERVAL = 1000;
    const SNIPE_RAFALE_WINDOW_KEY = 'ogs_snipe_rafale_window';   // secondes avant la fin où démarre la rafale (1..10)
    const DEFAULT_SNIPE_RAFALE_WINDOW_S = 10;
    const SNIPE_ENDTIME_KEY = 'ogs_snipe_endtime';   // cache du endTime (survit socket HS / reload)
    const SNIPE_OFFSET_KEY = 'ogs_snipe_offset';     // cache de l'offset horloge (partagé entre pages/onglets)
    const SNIPE_NOTIF_KEY = 'ogs_snipe_notif_for';   // endTime déjà notifié (anti-doublon)
    const SNIPE_NOTIF_LEAD_MS = 2 * 60 * 1000;       // notif délivrée 2 min avant la fin
    const SNIPE_NOTIF_MIN_REMAIN_MS = 3 * 60 * 1000; // sous ce seuil, pas de notif (tu es déjà devant)
    const DEFAULT_SNIPE_MARGIN_MS = 300;
    const DEFAULT_SNIPE_MAXMETAL = 1000000;
    // ============================================================
    // TIMING
    // ============================================================
    const TOTAL_BUDGET_MS = 4000;
    const DEFAULT_REFRESH_MIN = 2;
    const DEFAULT_REFRESH_MAX = 5;
    const EXPE_MAX_CYCLES = 20;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    function jitter(base, variance = 0.35) {
        const delta = base * variance;
        return Math.max(10, Math.round(base - delta + Math.random() * 2 * delta));
    }
    // ============================================================
    // HUMANIZER
    // ============================================================
    function humanMs(min, max) {
        const r = Math.pow(Math.random(), 1.5);
        return Math.round(min + r * (max - min));
    }
    async function maybeHesitate(probability = 0.18) {
        if (Math.random() < probability) {
            await sleep(humanMs(1200, 3500));
        }
    }
    // ============================================================
    // NOTIFICATION (ntfy.sh via fetch)
    // ============================================================
    function sendNotification(title, message, priority = 'high') {
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
            method: 'POST',
            headers: {
                'Title': title,
                'Priority': priority,
                'Tags': 'rotating_light',
            },
            body: message,
        })
        .then(() => console.log('[OGS] Notification envoyée'))
        .catch((e) => console.error('[OGS] Échec notification', e));
    }
    // Liste des notifications ntfy PROGRAMMÉES (pas encore délivrées).
    // ntfy les expose via l'endpoint JSON avec sched=1.
    async function fetchScheduledNotifs() {
        const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}/json?poll=1&since=all&sched=1`, { cache: 'no-store' });
        const text = await res.text();
        const now = Math.floor(Date.now() / 1000);
        return text.split('\n').filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(m => m && m.event === 'message' && m.time > now); // futur = programmé
    }
    async function updateScheduledList() {
        const el = document.getElementById('ogs-sched-list');
        if (!el) return;
        try {
            const list = await fetchScheduledNotifs();
            if (!list.length) { el.textContent = 'aucune'; el.style.color = '#5a7290'; return; }
            el.style.color = '#8fb0cc';
            el.innerHTML = list
                .sort((a, b) => a.time - b.time)
                .map(m => `<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">` +
                    `<span>⏰ ${new Date(m.time * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} — ${escapeHtml(m.message || m.title || '')}</span>` +
                    `<span class="ogs-sched-del" data-mid="${escapeHtml(m.id)}" title="Annuler cette notification" style="cursor:pointer;color:#e87e7e;padding:0 4px;">✕</span>` +
                    `</div>`)
                .join('');
        } catch (e) {
            el.textContent = 'erreur ntfy';
            el.style.color = '#e87e7e';
        }
    }
    // Annulation d'un message programmé (ntfy >= 2.16 : DELETE /{topic}/{messageId})
    async function deleteScheduledNotif(id) {
        try {
            const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}/${id}`, { method: 'DELETE' });
            if (res.ok) {
                setStatus('Notification annulée', 'ok');
            } else {
                setStatus(`Annulation refusée (${res.status})`, 'error');
            }
        } catch (e) {
            console.error('[OGS] Échec annulation notif', e);
            setStatus('Échec annulation notif', 'error');
        }
        updateScheduledList();
    }
    // ---- Notification ntfy PROGRAMMÉE à une heure précise (retour de ghost, etc.) ----
    // La requête part MAINTENANT avec l'en-tête 'At' : ntfy la délivre à l'heure
    // voulue même si le navigateur est fermé 5 min après.
    function escapeHtml(s) {
        return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function getSavedNotifMsgs() {
        try { const a = JSON.parse(localStorage.getItem(NOTIF_MSGS_KEY)); if (Array.isArray(a) && a.length) return a; } catch (e) {}
        return DEFAULT_NOTIF_MSGS.slice();
    }
    function saveNotifMsgs(arr) { localStorage.setItem(NOTIF_MSGS_KEY, JSON.stringify(arr)); }
    function notifMsgOptionsHtml() {
        return getSavedNotifMsgs().map(m => '<option>' + escapeHtml(m) + '</option>').join('');
    }
    // Programme une notif ntfy pour une date + heure. Si la date est vide, vise
    // la prochaine occurrence de l'heure (aujourd'hui ou demain).
    function scheduleCustomNotif(message, dateStr, hhmm) {
        message = (message || '').trim();
        if (!message) { setStatus('Notif : message vide', 'error'); return; }
        const tm = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
        if (!tm) { setStatus('Notif : heure invalide', 'error'); return; }
        const h = parseInt(tm[1], 10), min = parseInt(tm[2], 10);
        if (h > 23 || min > 59) { setStatus('Notif : heure invalide', 'error'); return; }
        let target;
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (dm) {
            target = new Date(parseInt(dm[1], 10), parseInt(dm[2], 10) - 1, parseInt(dm[3], 10), h, min, 0, 0);
        } else {
            const now = new Date();
            target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min, 0, 0);
            if (target.getTime() <= now.getTime() + 30000) target.setDate(target.getDate() + 1);
        }
        if (target.getTime() <= Date.now() + 5000) { setStatus('Notif : date/heure déjà passée', 'error'); return; }
        // ntfy.sh limite la livraison programmée à ~3 jours.
        if (target.getTime() - Date.now() > 3 * 24 * 3600 * 1000) {
            setStatus('Notif : max 3 jours à l\'avance (ntfy)', 'error'); return;
        }
        const atSec = Math.floor(target.getTime() / 1000);
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
            method: 'POST',
            headers: { 'Title': 'OGSentinel', 'Priority': 'high', 'Tags': 'alarm_clock', 'At': String(atSec) },
            body: message,
        })
        .then(() => {
            const when = target.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
            setStatus('Notif programmée : ' + when, 'ok');
            console.log('[OGS] Notif custom programmée', target.toISOString(), '-', message);
            // Rafraîchit la liste "Programmées" automatiquement. ntfy indexe le
            // message programmé avec un délai variable (parfois > 1 s) : on rafraîchit
            // plusieurs fois sur ~7 s pour que la nouvelle entrée apparaisse à coup sûr.
            [300, 1200, 2500, 4500, 7000].forEach(d => setTimeout(updateScheduledList, d));
        })
        .catch(e => { console.error('[OGS] Échec notif custom', e); setStatus('Notif : échec envoi', 'error'); });
    }
    // ---- Série récurrente : une notif toutes les X min pendant Y h ----
    function getRecurInterval() { let v = parseInt(localStorage.getItem(RECUR_INT_KEY), 10); if (isNaN(v) || v < 1) v = DEFAULT_RECUR_INT; return v; }
    function getRecurDuration() { let v = parseInt(localStorage.getItem(RECUR_DUR_KEY), 10); if (isNaN(v) || v < 1) v = DEFAULT_RECUR_DUR; return v; }
    // Programme d'un coup toutes les notifs de la série (chacune via l'en-tête 'At').
    // Envoi séquentiel espacé pour ménager la limite de débit de ntfy.
    async function scheduleRecurringNotif(message, intervalMin, durationH) {
        message = (message || '').trim();
        if (!message) { setStatus('Série : message vide', 'error'); return; }
        intervalMin = parseInt(intervalMin, 10);
        durationH = parseFloat(durationH);
        if (isNaN(intervalMin) || intervalMin < 1) { setStatus('Série : intervalle invalide', 'error'); return; }
        if (isNaN(durationH) || durationH <= 0) { setStatus('Série : durée invalide', 'error'); return; }
        const now = Date.now();
        const endMs = now + durationH * 3600 * 1000;
        const horizonMs = now + 3 * 24 * 3600 * 1000; // ntfy plafonne à ~3 jours
        const times = [];
        let truncated = false;
        for (let t = now + intervalMin * 60000; t <= endMs && t <= horizonMs; t += intervalMin * 60000) {
            if (times.length >= RECUR_MAX) { truncated = true; break; }
            times.push(Math.floor(t / 1000));
        }
        if (!times.length) { setStatus('Série : rien à programmer', 'error'); return; }
        setStatus('Série : programmation… (0/' + times.length + ')', 'busy');
        let ok = 0;
        for (const atSec of times) {
            try {
                const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
                    method: 'POST',
                    headers: { 'Title': 'OGSentinel', 'Priority': 'high', 'Tags': 'repeat', 'At': String(atSec) },
                    body: message,
                });
                if (r.ok) ok++;
            } catch (e) { console.warn('[OGS] série: échec 1 notif', e); }
            await new Promise(res => setTimeout(res, 150)); // stagger anti rate-limit
        }
        setStatus('Série programmée : ' + ok + '/' + times.length + (truncated ? ' (max ' + RECUR_MAX + ')' : ''), 'ok');
        console.log('[OGS] Série récurrente:', ok + '/' + times.length, 'x', message, '| toutes les', intervalMin, 'min pendant', durationH, 'h');
        [400, 1500, 3000, 5000, 8000].forEach(d => setTimeout(updateScheduledList, d));
    }
    function parseHostileRows(root) {
        const rows = root.querySelectorAll('tr.eventFleet');
        const attacks = [];
        for (const row of rows) {
            if (!row.querySelector('.hostile')) continue;
            if (row.getAttribute('data-return-flight') === 'true') continue;
            const attack = {};
            const ts = parseInt(row.getAttribute('data-arrival-time'), 10);
            if (!isNaN(ts)) attack.arrivalTs = ts;
            if (!isNaN(ts)) {
                const d = new Date(ts * 1000);
                attack.arrivalTime = d.toLocaleTimeString('fr-FR');
                const remainMs = ts * 1000 - Date.now();
                if (remainMs > 0) {
                    const m = Math.floor(remainMs / 60000);
                    const s = Math.floor((remainMs % 60000) / 1000);
                    attack.countdown = m > 0 ? `${m}m ${s}s` : `${s}s`;
                }
            }
            const missionImg = row.querySelector('.missionFleet img, .missionFleet [data-tooltip-title]');
            if (missionImg) {
                const t = missionImg.getAttribute('data-tooltip-title') || '';
                attack.mission = t.split('|').pop().trim() || null;
            }
            const originName = row.querySelector('.originFleet');
            attack.originName = originName ? originName.textContent.trim() : '?';
            const originCoords = row.querySelector('.coordsOrigin a');
            attack.originCoords = originCoords ? originCoords.textContent.trim() : '';
            const destName = row.querySelector('.destFleet');
            attack.destName = destName ? destName.textContent.trim() : '';
            const destCoords = row.querySelector('.destCoords a');
            attack.destCoords = destCoords ? destCoords.textContent.trim() : '';
            attack.destIsMoon = !!row.querySelector('.destFleet figure.moon') || /lune/i.test(attack.destName || '');
            const tooltipSpan = row.querySelector('.icon_movement [data-tooltip-title], .icon_movement_reserve [data-tooltip-title]');
            attack.fleet = [];
            if (tooltipSpan) {
                const html = tooltipSpan.getAttribute('data-tooltip-title') || '';
                const doc = new DOMParser().parseFromString(html, 'text/html');
                doc.querySelectorAll('tr').forEach(tr => {
                    const tds = tr.querySelectorAll('td');
                    if (tds.length >= 2) {
                        const shipName = tds[0].textContent.replace(':', '').trim();
                        const count = tds[tds.length - 1].textContent.trim();
                        if (shipName && count) attack.fleet.push(`${shipName}: ${count}`);
                    }
                });
            }
            attacks.push(attack);
        }
        return attacks;
    }
    async function getHostileAttacks() {
        let attacks = parseHostileRows(document);
        if (attacks.length > 0) return attacks;
        try {
            const link = document.querySelector('#attack_alert a');
            const url = (typeof window.eventlistLink === 'string' && window.eventlistLink) ||
                (link ? link.href : `${location.origin}${location.pathname}?page=componentOnly&component=eventList&ajax=1`);
            const res = await fetch(url, { credentials: 'same-origin' });
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            attacks = parseHostileRows(doc);
        } catch (e) {
            console.warn('[OGS] Impossible de récupérer l\'eventlist', e);
        }
        return attacks;
    }
    function buildAttackMessage(attacks) {
        if (attacks.length === 0) {
            return '⚠️ Flotte hostile détectée ! Connecte-toi vite.';
        }
        const lines = [];
        for (const a of attacks) {
            let line = `⚔️ ${a.mission || 'Attaque'} de ${a.originName} ${a.originCoords} → ${a.destName} ${a.destCoords}`.replace(/\s+/g, ' ').trim();
            lines.push(line);
            if (a.arrivalTime) {
                lines.push(`Arrivée : ${a.arrivalTime}${a.countdown ? ` (dans ${a.countdown})` : ''}`);
            }
            // Ce qu'il y a à défendre sur la cible (BDD locale)
            const here = dbFindByCoords(a.destCoords, a.destIsMoon);
            if (here) {
                const f = bodyFleetValue(here.counts);
                const res = (here.res.metal || 0) + (here.res.crystal || 0) + (here.res.deut || 0);
                lines.push(`Sur place : flotte ${fmtMillions(f.val)} · ress ${fmtMillions(res)}`);
            }
            if (a.fleet.length > 0) {
                lines.push(`Flotte : ${a.fleet.join(', ')}`);
            }
            lines.push('');
        }
        return lines.join('\n').trim();
    }
    // ============================================================
    // NOTIFS DE RETOUR DE FLOTTE (ntfy à retour −1 min)
    // - expéditions : 1 seule notif par grappe de retours espacés de ≤ 5 min
    // - retards/avances d'expé : l'eventlist expose l'heure de retour COURANTE,
    //   on re-synchronise toutes les 3 min et on re-programme (annule + recrée)
    //   la notif dès que l'heure a bougé de plus de 45 s.
    // ============================================================
    const RET_NOTIF_KEY = 'ogs_ret_notifs_on';
    const RET_STATE_KEY = 'ogs_ret_state';          // { unitKey: { ts, id } }
    const RET_LEAD_MS = 60 * 1000;                  // notif à retour −1 min
    const RET_CLUSTER_S = 300;                      // grappe expés : ≤ 5 min entre retours
    const RET_MISSION_NAMES = { 1: 'd\'attaque', 2: 'ACS', 3: 'de transport', 4: 'de stationnement', 5: 'de stationnement allié', 6: 'd\'espionnage', 7: 'de colonisation', 8: 'de recyclage', 9: 'de destruction', 15: 'd\'expédition' };
    function fmtHMS(ms) {
        const d = new Date(ms), p = n => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }
    async function fetchEventListDoc() {
        // Les lignes eventFleet sont rendues dans le DOM de toutes les pages ingame.
        if (document.querySelector('tr.eventFleet')) return document;
        // Fallback : l'URL ajax officielle exposée par le jeu (window.eventlistLink).
        const url = (typeof window.eventlistLink === 'string' && window.eventlistLink) ||
            `${location.origin}${location.pathname}?page=componentOnly&component=eventList&ajax=1`;
        const res = await fetch(url, { credentials: 'same-origin' });
        return new DOMParser().parseFromString(await res.text(), 'text/html');
    }
    function parseOwnReturns(root) {
        const list = [];
        root.querySelectorAll('tr.eventFleet').forEach(row => {
            if (row.querySelector('.hostile')) return;
            if (row.getAttribute('data-return-flight') !== 'true') return;
            const ts = parseInt(row.getAttribute('data-arrival-time'), 10);
            if (isNaN(ts)) return;
            const mission = parseInt(row.getAttribute('data-mission-type'), 10) || 0;
            const dest = row.querySelector('.destCoords a');
            list.push({
                ts, mission,
                dest: dest ? dest.textContent.trim() : '',
                key: row.id || (mission + '@' + ts),
            });
        });
        return list;
    }
    async function postScheduledNtfy(message, atMs) {
        try {
            const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
                method: 'POST',
                headers: { 'Title': 'OGSentinel', 'Priority': 'high', 'Tags': 'rocket', 'At': String(Math.floor(atMs / 1000)) },
                body: message,
            });
            const j = await res.json();
            return (j && j.id) || null;
        } catch (e) { return null; }
    }
    function deleteScheduledNotifSilent(id) {
        if (!id) return;
        fetch(`https://ntfy.sh/${NTFY_TOPIC}/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    function loadRetState() {
        try { return JSON.parse(localStorage.getItem(RET_STATE_KEY) || '{}'); } catch (e) { return {}; }
    }
    let retSyncRunning = false;
    async function syncReturnNotifs() {
        if (localStorage.getItem(RET_NOTIF_KEY) !== '1') return;
        if (retSyncRunning) return;
        retSyncRunning = true;
        try {
            const doc = await fetchEventListDoc();
            const flights = parseOwnReturns(doc);
            const state = loadRetState();
            const now = Date.now();
            // unités de notification : grappes d'expés + vols individuels
            const units = [];
            const expes = flights.filter(f => f.mission === 15).sort((a, b) => a.ts - b.ts);
            let grp = [];
            const flush = () => {
                if (!grp.length) return;
                const first = grp[0], last = grp[grp.length - 1];
                units.push({
                    key: 'expe:' + grp.map(g => g.key).join(','),
                    ts: first.ts,
                    label: grp.length > 1
                        ? `🚀 ${grp.length} expés de retour entre ${fmtHMS(first.ts * 1000)} et ${fmtHMS(last.ts * 1000)}`
                        : `🚀 Retour d'expédition à ${fmtHMS(first.ts * 1000)}`,
                });
                grp = [];
            };
            expes.forEach(f => {
                if (!grp.length || f.ts - grp[grp.length - 1].ts <= RET_CLUSTER_S) grp.push(f);
                else { flush(); grp.push(f); }
            });
            flush();
            flights.filter(f => f.mission !== 15).forEach(f => {
                units.push({
                    key: 'ret:' + f.key,
                    ts: f.ts,
                    label: `↩ Retour ${RET_MISSION_NAMES[f.mission] || 'de flotte'} à ${fmtHMS(f.ts * 1000)}${f.dest ? ' ' + f.dest : ''}`,
                });
            });
            // réconciliation : programme / re-programme / annule
            const newState = {};
            for (const u of units) {
                const notifAt = u.ts * 1000 - RET_LEAD_MS;
                if (notifAt < now + 15000) {          // trop tard pour (re)programmer
                    if (state[u.key]) newState[u.key] = state[u.key];
                    continue;
                }
                const prev = state[u.key];
                if (prev && Math.abs(prev.ts - u.ts) <= 45) { newState[u.key] = prev; continue; }
                if (prev) deleteScheduledNotifSilent(prev.id);   // retour décalé -> re-programme
                const id = await postScheduledNtfy(u.label, notifAt);
                newState[u.key] = { ts: u.ts, id };
            }
            // vols disparus (rappel, trou noir, grappe recomposée) : annule si encore futur
            Object.keys(state).forEach(k => {
                if (newState[k]) return;
                const s = state[k];
                if (s && s.ts * 1000 - RET_LEAD_MS > now + 5000) deleteScheduledNotifSilent(s.id);
            });
            localStorage.setItem(RET_STATE_KEY, JSON.stringify(newState));
        } catch (e) {
            console.warn('[OGS] sync retours échouée', e);
        } finally {
            retSyncRunning = false;
        }
    }
    setInterval(syncReturnNotifs, 180000);
    setTimeout(syncReturnNotifs, 4000);
    function getNotifCooldownMin() {
        let v = parseFloat(localStorage.getItem(NOTIF_COOLDOWN_KEY));
        if (isNaN(v) || v < 0) v = DEFAULT_NOTIF_COOLDOWN_MIN;
        return v;
    }
    function saveNotifCooldownMin(v) {
        localStorage.setItem(NOTIF_COOLDOWN_KEY, String(v));
    }
    function getCooldownRemainingMs() {
        const last = parseInt(localStorage.getItem(NOTIF_KEY) || '0', 10);
        const cooldownMs = getNotifCooldownMin() * 60 * 1000;
        return Math.max(0, cooldownMs - (Date.now() - last));
    }
    function resetCooldown() {
        localStorage.removeItem(NOTIF_KEY);
        updateCooldownDisplay();
        setStatus('Cooldown notif reset', 'ok');
    }
    function updateCooldownDisplay() {
        const el = document.getElementById('ogs-cooldown');
        if (!el) return;
        const remain = getCooldownRemainingMs();
        if (remain <= 0) {
            el.textContent = 'Prêt';
            el.style.color = '#7fd98a';
        } else {
            const m = Math.floor(remain / 60000);
            const s = Math.floor((remain % 60000) / 1000);
            el.textContent = `${m}:${String(s).padStart(2, '0')}`;
            el.style.color = '#e0a94a';
        }
    }
    async function checkAlert() {
        const alertEl = document.querySelector(ALERT_SELECTOR);
        setAlertIndicator(!!alertEl);
        if (!alertEl) return;
        if (getCooldownRemainingMs() > 0) return;
        localStorage.setItem(NOTIF_KEY, String(Date.now()));
        updateCooldownDisplay();
        const attacks = await getHostileAttacks();
        const message = buildAttackMessage(attacks);
        sendNotification('OGame - Alerte attaque', message, 'urgent');
        setStatus('Alerte detectee, notif envoyee', 'alert');
    }
    // ============================================================
    // ÉTAT (persisté)
    // ============================================================
    function loadSelection() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
        catch { return []; }
    }
    function saveSelection(ids) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    }
    function getSelectedIds() {
        return [...document.querySelectorAll('.ogs-ship-cb:checked')].map(cb => parseInt(cb.dataset.shipId, 10));
    }
    function getRefreshBounds() {
        let min = parseFloat(localStorage.getItem(REFRESH_MIN_KEY));
        let max = parseFloat(localStorage.getItem(REFRESH_MAX_KEY));
        if (isNaN(min) || min <= 0) min = DEFAULT_REFRESH_MIN;
        if (isNaN(max) || max <= 0) max = DEFAULT_REFRESH_MAX;
        if (min > max) [min, max] = [max, min];
        min = Math.max(0.25, min);
        max = Math.max(min, max);
        return { min, max };
    }
    function saveRefreshBounds(min, max) {
        localStorage.setItem(REFRESH_MIN_KEY, String(min));
        localStorage.setItem(REFRESH_MAX_KEY, String(max));
    }
    function isGhostAuto() {
        return localStorage.getItem(GHOST_AUTO_KEY) === '1';
    }
    // ============================================================
    // UTILS COMMUNS
    // ============================================================
    async function waitFor(selector, timeout = 8000, interval = 100) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(interval);
        }
        return null;
    }
    function fillInput(input, value) {
        input.focus();
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
    }
    function isFleetPage() {
        return !!document.querySelector('#fleet1, #fleetdispatchcomponent');
    }
    // ============================================================
    // INTERCEPTION (Porte de saut)
    // ============================================================
    let running = false;
    function getInterDest() {
        try { return JSON.parse(localStorage.getItem(INTER_DEST_KEY) || 'null'); } catch (e) { return null; }
    }
    function populateInterDestSelect(dests) {
        const sel = document.getElementById('ogs-inter-dest');
        if (!sel) return;
        const saved = getInterDest();
        let opts = '<option value="">— défaut de la porte —</option>';
        if (dests && dests.length) {
            opts += dests.map(d => `<option value="${d.id}"${saved && d.id === saved.id ? ' selected' : ''}>${d.label}${destOptionSuffix(d.id)}</option>`).join('');
        } else if (saved && saved.id) {
            opts += `<option value="${saved.id}" selected>${saved.label || saved.id}${destOptionSuffix(saved.id)}</option>`;
        }
        sel.innerHTML = opts;
    }
    async function runInterception() {
        if (running) return;
        const selected = getSelectedIds();
        if (selected.length === 0) {
            setStatus('Aucun vaisseau coche', 'error');
            return;
        }
        running = true;
        const btn = document.getElementById('ogs-interception');
        btn.disabled = true;
        btn.classList.add('ogs-busy');
        try {
            setStatus('Ouverture...', 'busy');
            const gateLink = document.querySelector('a[href="javascript:openJumpgate();"]');
            if (!gateLink) {
                setStatus('Lien Porte de saut introuvable', 'error');
                return;
            }
            gateLink.click();
            const form = await waitFor('#jumpgateForm');
            if (!form) {
                setStatus('Formulaire jumpgate non charge', 'error');
                return;
            }
            // Destination choisie dans l'interface (sinon défaut de la porte).
            const wantDest = getInterDest();
            if (wantDest && wantDest.id) {
                const destSel = form.querySelector('select[name="targetSpaceObjectId"]');
                if (!destSel || !Array.from(destSel.options).some(o => o.value === wantDest.id)) {
                    setStatus('Destination choisie absente de cette porte', 'error');
                    return;
                }
                destSel.value = wantDest.id;
                destSel.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(jitter(150));
            }
            const startPause = jitter(355);
            const fillBudget = 2992;
            const endPause   = 212;
            await sleep(startPause);
            const perShip = Math.max(40, Math.floor(fillBudget / Math.max(1, selected.length)));
            let filled = 0;
            for (const id of selected) {
                // On ne remplit plus l'input à la main (le 'rel' peut être périmé).
                // On clique l'élément qui déclenche toggleMaxShips(...) : OGame
                // sélectionne alors lui-même la quantité max réellement disponible.
                const input = document.querySelector(`#ship_${id}`);
                if (input && input.disabled) continue; // vaisseau indisponible
                // Cibles cliquables portant le onclick toggleMaxShips :
                //  - le lien image  a.dark_highlight_tablet
                //  - le compteur    span.quantity
                let clickTarget =
                    document.querySelector(`img.tech${id}`)?.closest('a.dark_highlight_tablet') ||
                    document.querySelector(`#jumpgateForm [onclick*="toggleMaxShips('#jumpgateForm', ${id},"]`) ||
                    document.querySelector(`#jumpgateForm [onclick*="toggleMaxShips(\\"#jumpgateForm\\", ${id},"]`);
                if (!clickTarget) continue; // vaisseau absent de la liste
                clickTarget.click();
                filled++;
                await sleep(jitter(perShip));
            }
            if (filled === 0) {
                setStatus('Aucun vaisseau disponible', 'error');
                return;
            }
            setStatus(`${filled} type(s), saut...`, 'busy');
            await sleep(endPause);
            const jumpBtn = document.querySelector('.js_executeJumpButton');
            if (!jumpBtn) {
                setStatus('Bouton Sauter introuvable', 'error');
                return;
            }
            jumpBtn.click();
            setStatus('Saut lance', 'ok');
            markJumpCooldown(wantDest && wantDest.id);
            setTimeout(() => dbEmpireScan('post-interception'), 4000);
            // Si "Ghost auto après saut" est coché, on arme le flag one-shot.
            if (isGhostAuto()) {
                localStorage.setItem(GHOST_PENDING_KEY, '1');
            }
        } finally {
            running = false;
            btn.disabled = false;
            btn.classList.remove('ogs-busy');
        }
    }
    // ============================================================
    // BDD LOCALE EMPIRE — planètes, lunes, portes de saut, flottes.
    // Alimentée passivement à chaque page + à chaque analyse de porte,
    // consommée par les onglets qui en ont besoin (Trap, Inter, auto).
    // ============================================================
    const DB_KEY = 'ogs_db';
    function dbLoad() {
        try { return JSON.parse(localStorage.getItem(DB_KEY) || 'null') || {}; } catch (e) { return {}; }
    }
    function dbSave(patch) {
        const db = dbLoad();
        Object.assign(db, patch, { updatedAt: Date.now() });
        localStorage.setItem(DB_KEY, JSON.stringify(db));
        return db;
    }
    function getCurMeta(name) {
        const m = document.querySelector(`meta[name="ogame-${name}"]`);
        return m ? m.getAttribute('content') : null;
    }
    function getCurPlanetId() { return getCurMeta('planet-id'); }
    function getCurCoords() {
        const c = getCurMeta('planet-coordinates');
        return c ? '[' + c + ']' : null;
    }
    function getCurIsMoon() { return getCurMeta('planet-type') === 'moon'; }
    function dbGates() { return dbLoad().gates || []; }
    function dbMarkGate(id, coords, label) {
        if (!id) return;
        const db = dbLoad();
        const gates = db.gates || [];
        let g = gates.find(x => x.id === String(id));
        if (!g) { g = { id: String(id) }; gates.push(g); }
        if (coords) g.coords = coords;
        g.label = label || g.label || ('Lune ' + (coords || id));
        dbSave({ gates });
    }
    // Une analyse de porte sur UNE lune révèle TOUTES les lunes à porte
    // (les destinations) + la lune courante (sa porte vient de s'ouvrir).
    function dbSetGatesFromScan(dests) {
        (dests || []).forEach(d => {
            const cm = ((d.label || '').match(/\[\d+:\d+:\d+\]/) || [])[0] || '';
            dbMarkGate(d.id, cm, d.label);
        });
        dbMarkGate(getCurPlanetId(), getCurCoords());
    }
    function dbSetCounts(counts) {
        const id = getCurPlanetId();
        if (!id) return;
        const db = dbLoad();
        const all = db.counts || {};
        all[id] = { counts, at: Date.now() };
        dbSave({ counts: all });
    }
    function dbGetCounts() {
        const id = getCurPlanetId();
        const db = dbLoad();
        return (db.counts && db.counts[id]) || null;
    }
    // Destinations de saut connues depuis la lune courante (toutes les portes sauf elle).
    function dbGateDestsForHere() {
        const cur = String(getCurPlanetId() || '');
        return dbGates().filter(g => g.id !== cur).map(g => ({ id: g.id, label: g.label }));
    }
    function dbRefreshEmpire() {
        const planets = Array.from(document.querySelectorAll('#planetList > div')).map(div => {
            const k = div.querySelector('.planet-koords');
            const n = div.querySelector('.planet-name');
            const pl = div.querySelector('a.planetlink');
            const pm = pl ? (pl.getAttribute('href') || '').match(/cp=(\d+)/) : null;
            const a = div.querySelector('.moonlink');
            const mm = a ? (a.getAttribute('href') || '').match(/cp=(\d+)/) : null;
            return {
                cp: pm ? pm[1] : null,
                name: n ? n.textContent.trim() : '',
                coords: k ? k.textContent.trim() : '',
                moonCp: mm ? mm[1] : null,
            };
        }).filter(x => x.coords);
        if (planets.length) dbSave({ planets });
        // Porte détectable sans rien ouvrir : lien "openJumpgate" présent sur la lune courante.
        if (getCurIsMoon() && document.querySelector('a[href="javascript:openJumpgate();"]')) {
            dbMarkGate(getCurPlanetId(), getCurCoords());
        }
    }
    // ---- Scan silencieux complet via la vue Empire (2 requêtes) ----
    // Récupère TOUTES les planètes et lunes : noms, coordonnées, ressources,
    // composition de flotte, et niveau de Porte de saut (bâtiment 41).
    async function dbFetchEmpireType(planetType) {
        const url = `${location.origin}${location.pathname}?page=standalone&component=empire&planetType=${planetType}`;
        const res = await fetch(url, { credentials: 'same-origin' });
        const html = await res.text();
        const idx = html.indexOf('createImperiumHtml');
        if (idx < 0) return null;
        const start = html.indexOf('{', idx);
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let i = start; i < html.length; i++) {
            const c = html[i];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') inStr = true;
            else if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
        }
        if (end < 0) return null;
        try { return JSON.parse(html.slice(start, end + 1)).planets || null; } catch (e) { return null; }
    }
    function empireBodyRecord(p) {
        const counts = {};
        SHIPS.forEach(s => { counts[s.id] = parseInt(p[s.id], 10) || 0; });
        return {
            id: String(p.id),
            name: p.name || '',
            coords: p.coordinates || '',
            counts,
            res: {
                metal: Math.round(p.metal || 0),
                crystal: Math.round(p.crystal || 0),
                deut: Math.round(p.deuterium || 0),
            },
            gate: parseInt(p['41'], 10) || 0,
        };
    }
    let dbScanRunning = false;
    async function dbEmpireScan(reason) {
        if (dbScanRunning) return;
        dbScanRunning = true;
        try {
            const results = await Promise.all([dbFetchEmpireType(0), dbFetchEmpireType(1)]);
            const planets = results[0], moons = results[1];
            if (!planets && !moons) { updateDbStatus('Scan empire impossible'); return; }
            const db = dbLoad();
            const counts = db.counts || {};
            const resAll = db.res || {};
            const gates = db.gates || [];
            const empire = { planets: [], moons: [] };
            const absorb = (p, isMoon) => {
                const r = empireBodyRecord(p);
                (isMoon ? empire.moons : empire.planets).push(r);
                counts[r.id] = { counts: r.counts, at: Date.now() };
                resAll[r.id] = Object.assign({}, r.res, { at: Date.now() });
                if (isMoon && r.gate > 0) {
                    let g = gates.find(x => x.id === r.id);
                    if (!g) { g = { id: r.id }; gates.push(g); }
                    g.coords = r.coords;
                    g.label = 'Lune ' + r.coords;
                    g.level = r.gate;
                }
            };
            (planets || []).forEach(p => absorb(p, false));
            (moons || []).forEach(p => absorb(p, true));
            dbSave({ empire, counts, res: resAll, gates, empireAt: Date.now() });
            updateDbStatus();
            dbUiRefresh();
            console.log(`[OGS] BDD: scan empire (${reason || '?'}) — ${empire.planets.length} planètes, ${empire.moons.length} lunes`);
        } catch (e) {
            console.warn('[OGS] BDD: scan empire échoué', e);
        } finally {
            dbScanRunning = false;
        }
    }
    // Détection de changement structurel : colonie/lune apparue ou disparue
    // par rapport à la BDD (comparaison avec la barre latérale, gratuite).
    function dbEmpireChanged() {
        const db = dbLoad();
        if (!db.empire) return true;
        const curP = new Set(), curM = new Set();
        document.querySelectorAll('#planetList > div').forEach(div => {
            const k = div.querySelector('.planet-koords');
            if (!k) return;
            const c = k.textContent.trim();
            curP.add(c);
            if (div.querySelector('.moonlink')) curM.add(c);
        });
        if (!curP.size) return false;
        const dbP = new Set(db.empire.planets.map(p => p.coords));
        const dbM = new Set(db.empire.moons.map(m => m.coords));
        if (curP.size !== dbP.size || curM.size !== dbM.size) return true;
        for (const c of curP) if (!dbP.has(c)) return true;
        for (const c of curM) if (!dbM.has(c)) return true;
        return false;
    }
    function dbMaybeEmpireScan() {
        if (localStorage.getItem('ogs_db_scan_asap') === '1') {
            localStorage.removeItem('ogs_db_scan_asap');
            dbEmpireScan('post-action');
            return;
        }
        const db = dbLoad();
        const age = Date.now() - (db.empireAt || 0);
        if (age > 30 * 60 * 1000) { dbEmpireScan('connexion'); return; }
        if (dbEmpireChanged()) dbEmpireScan('changement détecté');
        else updateDbStatus();
    }
    function updateDbStatus(errTxt) {
        const el = document.getElementById('ogs-db-status');
        if (!el) return;
        if (errTxt) { el.innerHTML = `<span style="color:#e87e7e;">${errTxt}</span>`; return; }
        const db = dbLoad();
        if (!db.empire) { el.textContent = 'BDD vide — scan au prochain chargement'; return; }
        const mins = Math.round((Date.now() - (db.empireAt || 0)) / 60000);
        const nGates = (db.gates || []).length;
        el.innerHTML = `${db.empire.planets.length} planètes · ${db.empire.moons.length} lunes · ${nGates} portes ⛩<br>` +
            `<span style="color:#647c96;">MAJ il y a ${mins < 1 ? '<1' : mins} min</span>`;
        renderDbView();
    }
    // ---- Cooldown des portes de saut ----
    // La vue Empire ne l'expose pas : on l'apprend en ouvrant une porte
    // (compte à rebours affiché) et on l'estime après chaque saut
    // (les DEUX portes, départ et arrivée, passent en refroidissement).
    function dbSetGateCd(id, untilMs) {
        if (!id) return;
        const db = dbLoad();
        const cd = db.gateCd || {};
        cd[String(id)] = untilMs || 0;
        dbSave({ gateCd: cd });
    }
    function dbGetGateCd(id) {
        const v = (dbLoad().gateCd || {})[String(id)];
        return (v && v > Date.now()) ? v : 0;
    }
    // Lit l'état de la porte dans le formulaire ouvert : 0 = prête,
    // sinon timestamp de fin (compte à rebours HH:MM:SS trouvé, ou
    // estimation prudente 30 min si la porte est bloquée sans timer lisible).
    function readGateFormCooldown(form) {
        if (!form) return 0;
        const btn = form.querySelector('.js_executeJumpButton');
        if (btn && !btn.disabled) return 0;
        const m = (form.textContent || '').match(/(\d{1,2}):(\d{2}):(\d{2})/);
        if (m) return Date.now() + ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000;
        return Date.now() + 30 * 60 * 1000;
    }
    // Après un saut : estimation 20 min pour les deux portes (corrigée par la
    // vraie valeur à la prochaine ouverture d'une des deux portes).
    const GATE_CD_ESTIMATE_MS = 20 * 60 * 1000;
    function markJumpCooldown(destId) {
        dbSetGateCd(getCurPlanetId(), Date.now() + GATE_CD_ESTIMATE_MS);
        if (destId) dbSetGateCd(destId, Date.now() + GATE_CD_ESTIMATE_MS);
    }
    function fmtHM(ms) {
        const d = new Date(ms);
        const p = n => String(n).padStart(2, '0');
        return p(d.getHours()) + ':' + p(d.getMinutes());
    }
    // Vue détaillée de la BDD (onglet BDD) : totaux + une ligne par position.
    function bodyFleetValue(counts) {
        let val = 0, nb = 0;
        Object.keys(counts || {}).forEach(id => {
            const n = counts[id] || 0;
            val += n * shipUnitValue(parseInt(id, 10));
            nb += n;
        });
        return { val, nb };
    }
    function renderDbView() {
        const box = document.getElementById('ogs-db-view');
        if (!box) return;
        const db = dbLoad();
        if (!db.empire) { box.innerHTML = ''; return; }
        let totVal = 0, totNb = 0, totRes = 0;
        const row = (r, isMoon) => {
            const f = bodyFleetValue(r.counts);
            totVal += f.val; totNb += f.nb;
            const res = (r.res.metal || 0) + (r.res.crystal || 0) + (r.res.deut || 0);
            totRes += res;
            const cdUntil = isMoon ? dbGetGateCd(r.id) : 0;
            const gate = isMoon
                ? (r.gate > 0
                    ? (cdUntil
                        ? ` <span style="color:#e0a94a;" title="Porte en refroidissement (estimation)">⛩${r.gate} CD→${fmtHM(cdUntil)}</span>`
                        : ` <span style="color:#74b23e;">⛩${r.gate}</span>`)
                    : ' <span style="color:#c8503f;">⛩✕</span>')
                : '';
            return `<div style="display:flex;align-items:center;gap:6px;font-size:10px;">
                <span style="width:14px;">${isMoon ? '🌙' : '🪐'}</span>
                <span style="width:64px;color:#a6cbee;">${r.coords}</span>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#647c96;">${r.name}${gate}</span>
                <span style="width:64px;text-align:right;color:#5cc6ff;" title="${f.nb.toLocaleString('fr-FR')} vaisseaux">${f.val ? fmtMillions(f.val) : '—'}</span>
                <span style="width:58px;text-align:right;color:#f0b24a;" title="Métal+Cristal+Deut">${res ? fmtMillions(res) : '—'}</span>
            </div>`;
        };
        const planetRows = db.empire.planets.map(p => row(p, false)).join('');
        const moonRows = db.empire.moons.map(m => row(m, true)).join('');
        box.innerHTML =
            `<div style="display:flex;font-size:9px;color:#647c96;gap:6px;"><span style="width:14px;"></span><span style="width:64px;">Position</span><span style="flex:1;">Nom</span><span style="width:64px;text-align:right;">Flotte</span><span style="width:58px;text-align:right;">Ress.</span></div>` +
            planetRows +
            `<div style="height:1px;background:#243449;margin:3px 0;"></div>` +
            moonRows +
            `<div style="border-top:1px solid #243449;margin-top:3px;padding-top:5px;font-size:10px;color:#bcd4ea;">` +
            `Flotte totale : <b style="color:#5cc6ff">${fmtMillions(totVal)}</b> (${totNb.toLocaleString('fr-FR')} vx) · ` +
            `Ressources : <b style="color:#f0b24a">${fmtMillions(totRes)}</b></div>`;
    }
    // ---- Helpers BDD transverses (tous onglets) ----
    let ogsTrapRefreshHook = null;   // posé par le câblage du Trap (portée interne)
    let ogsActivatePaneHook = null;  // posé par le câblage (activatePane)
    // Verrou global "opération longue en cours" : bloque l'auto-refresh
    // pendant les analyses/préparations qui manipulent la page Flotte.
    let ogsBusyOps = 0;
    function trackBusy(fn) {
        return async function (...args) {
            ogsBusyOps++;
            try { return await fn.apply(this, args); }
            finally { ogsBusyOps--; }
        };
    }
    // Une date par défaut figée au chargement devient hier après minuit.
    function fixDateToday(id) {
        const inp = document.getElementById(id);
        if (!inp) return;
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        const today = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        if (!inp.value || inp.value < today) inp.value = today;
    }
    function dbFindByCoords(coords, isMoon) {
        const emp = dbLoad().empire;
        if (!emp || !coords) return null;
        const list = isMoon ? emp.moons : emp.planets;
        return list.find(b => b.coords === coords) || null;
    }
    function empireResTotals() {
        const emp = dbLoad().empire;
        if (!emp) return null;
        const tot = { metal: 0, crystal: 0, deut: 0, fleetVal: 0, fleetNb: 0 };
        [].concat(emp.planets, emp.moons).forEach(b => {
            tot.metal += b.res.metal || 0;
            tot.crystal += b.res.crystal || 0;
            tot.deut += b.res.deut || 0;
            const f = bodyFleetValue(b.counts);
            tot.fleetVal += f.val;
            tot.fleetNb += f.nb;
        });
        return tot;
    }
    function destOptionSuffix(id) {
        const cd = dbGetGateCd(id);
        return cd ? ` — CD→${fmtHM(cd)}` : '';
    }
    // Ligne "Empire" de l'onglet Enchère : de quoi savoir jusqu'où miser.
    function updateSnipeEmpireLine() {
        const el = document.getElementById('ogs-snipe-empire');
        if (!el) return;
        const t = empireResTotals();
        if (!t) { el.textContent = ''; return; }
        el.innerHTML = `Empire (BDD) : M <b style="color:#a6cbee">${fmtMillions(t.metal)}</b> · ` +
            `C <b style="color:#a6cbee">${fmtMillions(t.crystal)}</b> · ` +
            `D <b style="color:#a6cbee">${fmtMillions(t.deut)}</b>`;
    }
    // Rafraîchit les morceaux d'interface qui dépendent de la BDD.
    function dbUiRefresh() {
        try {
            updateSnipeEmpireLine();
            populateInterDestSelect(dbGateDestsForHere());
            updateGhostFleetVal();
            if (ogsTrapRefreshHook) ogsTrapRefreshHook();
        } catch (e) {}
    }
    // Collecte passive : composition de flotte de la position courante,
    // lue gratuitement sur toute page Flotte (fleetDispatcher).
    function dbCollectFleetPage() {
        const fd = window.fleetDispatcher;
        if (!fd || !isFleetPage() || !Array.isArray(fd.shipsOnPlanet)) return;
        const counts = {};
        SHIPS.forEach(s => { counts[s.id] = 0; });
        fd.shipsOnPlanet.forEach(sh => { if (sh && sh.id) counts[sh.id] = sh.number || 0; });
        dbSetCounts(counts);
    }
    // Collecte passive : ressources de la position courante (barre du haut).
    function dbCollectResources() {
        const ids = { metal: 'resources_metal', crystal: 'resources_crystal', deut: 'resources_deuterium' };
        const res = {};
        let any = false;
        Object.keys(ids).forEach(k => {
            const el = document.getElementById(ids[k]);
            if (!el) return;
            const raw = el.getAttribute('data-raw') || el.textContent || '';
            const v = parseInt(String(raw).replace(/\D/g, ''), 10);
            if (!isNaN(v)) { res[k] = v; any = true; }
        });
        const id = getCurPlanetId();
        if (!any || !id) return;
        const db = dbLoad();
        const all = db.res || {};
        all[id] = Object.assign(res, { at: Date.now() });
        dbSave({ res: all });
    }
    // Valeur de la flotte de la position courante (live si page Flotte, sinon cache BDD).
    function updateGhostFleetVal() {
        const el = document.getElementById('ogs-ghost-fleetval');
        if (!el) return;
        let counts = null, live = false;
        const fd = window.fleetDispatcher;
        if (fd && isFleetPage() && Array.isArray(fd.shipsOnPlanet) && fd.shipsOnPlanet.length) {
            counts = {};
            fd.shipsOnPlanet.forEach(sh => { if (sh && sh.id) counts[sh.id] = sh.number || 0; });
            live = true;
        } else {
            const c = dbGetCounts();
            if (c) counts = c.counts;
        }
        if (!counts) { el.textContent = ''; return; }
        let val = 0, nb = 0;
        Object.keys(counts).forEach(id => {
            const n = counts[id] || 0;
            val += n * shipUnitValue(parseInt(id, 10));
            nb += n;
        });
        el.innerHTML = `Flotte ici : <b style="color:#5cc6ff">${fmtMillions(val)}</b> (${nb.toLocaleString('fr-FR')} vx)` +
            (live ? '' : ' <span style="color:#647c96">(cache BDD)</span>');
    }
    // ============================================================
    // INTERCEPTION AUTO
    // Armée : surveille les attaques hostiles sur tes lunes. À
    // impact −N s : navigue sur la lune d'intervention, ouvre la
    // Porte de saut, sélectionne la lune attaquée, envoie les
    // vaisseaux cochés (max) et clique Sauter.
    // ============================================================
    const INTERAUTO_KEY = 'ogs_interauto';                 // { armed, moonCp, moonCoords, leadS }
    const INTERAUTO_HANDLED_KEY = 'ogs_interauto_handled'; // { impactTs: 1 } anti double-saut
    const INTERAUTO_PENDING_KEY = 'ogs_interauto_pending'; // saut à exécuter dès l'arrivée sur la lune d'intervention
    let interAutoHot = false;        // attaque imminente : bloque l'auto-refresh
    let interAutoScheduledFor = 0;
    let interAutoRunning = false;
    let interAutoTicking = false;
    let interAutoFastTimer = null;
    // Identité d'une attaque indépendante de l'heure d'impact : l'attaquant
    // peut décaler à la sonde (l'arrival-time change, pas origine/destination).
    function attackKey(a) {
        return (a.originCoords || '?') + '>' + (a.destCoords || '?');
    }
    function getInterAuto() {
        try { return JSON.parse(localStorage.getItem(INTERAUTO_KEY) || 'null') || {}; } catch (e) { return {}; }
    }
    function setInterAutoCfg(o) { localStorage.setItem(INTERAUTO_KEY, JSON.stringify(o)); }
    function interAutoHandled() {
        try { return JSON.parse(localStorage.getItem(INTERAUTO_HANDLED_KEY) || '{}'); } catch (e) { return {}; }
    }
    function markInterAutoHandled(ts) {
        const h = interAutoHandled();
        h[ts] = 1;
        // purge : entrées passées depuis plus d'1 h
        const limit = Math.floor(Date.now() / 1000) - 3600;
        Object.keys(h).forEach(k => { if (parseInt(k, 10) < limit) delete h[k]; });
        localStorage.setItem(INTERAUTO_HANDLED_KEY, JSON.stringify(h));
    }
    function listOwnMoons() {
        return Array.from(document.querySelectorAll('#planetList > div')).map(div => {
            const k = div.querySelector('.planet-koords');
            const a = div.querySelector('.moonlink');
            const m = a ? (a.getAttribute('href') || '').match(/cp=(\d+)/) : null;
            return (k && m) ? { cp: m[1], coords: k.textContent.trim() } : null;
        }).filter(Boolean);
    }
    function renderInterAutoStatus(target, lead) {
        const el = document.getElementById('ogs-ia-status');
        if (!el) return;
        const cfg = getInterAuto();
        if (!cfg.armed) { el.innerHTML = ''; return; }
        if (!target) {
            el.innerHTML = `<span style="color:#74b23e;">🛡 Armé</span> — aucune attaque sur lune détectée`;
            return;
        }
        const remainS = Math.max(0, Math.round((target.arrivalTs * 1000 - Date.now()) / 1000));
        const cd = cfg.moonCp ? dbGetGateCd(cfg.moonCp) : 0;
        el.innerHTML = `<span style="color:#74b23e;">🛡 Armé</span> — cible détectée<br>` +
            `Attaque sur <b style="color:#e0a94a;">${target.destCoords}</b> — impact ${target.arrivalTime || '?'} (${remainS}s)<br>` +
            `Séquence à impact −${lead}s depuis ${cfg.moonCoords || 'ta lune'} : saut ≈ −${Math.max(1, lead - 2)}s, recyclage ≈ −${Math.max(1, lead - 8)}s` +
            (cd ? `<br><span style="color:#e0a94a;">⚠ Porte d'intervention en refroidissement jusqu'à ~${fmtHM(cd)}</span>` : '');
    }
    async function interAutoJump(target) {
        if (interAutoRunning) return;
        const cfg = getInterAuto();
        if (!cfg.armed || interAutoHandled()[target.arrivalTs]) return;
        interAutoRunning = true;
        try {
            markInterAutoHandled(target.arrivalTs); // one-shot, avant l'action
            const selected = getSelectedIds();
            if (!selected.length) {
                setStatus('Inter auto : aucun vaisseau coché', 'error');
                sendNotification('OGame - Interception', '❌ Inter auto : aucun vaisseau coché', 'urgent');
                return;
            }
            const form = await trapOpenGate();
            if (!form) {
                setStatus('Inter auto : porte introuvable', 'error');
                sendNotification('OGame - Interception', '❌ Inter auto : Porte de saut introuvable', 'urgent');
                return;
            }
            await sleep(jitter(80));
            const destSel = form.querySelector('select[name="targetSpaceObjectId"]');
            const opt = destSel && Array.from(destSel.options).find(o => o.textContent.includes(target.destCoords));
            if (!opt) {
                setStatus('Inter auto : lune attaquée absente de la porte', 'error');
                sendNotification('OGame - Interception', `❌ Inter auto : ${target.destCoords} absente de la porte`, 'urgent');
                return;
            }
            destSel.value = opt.value;
            destSel.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(jitter(80));
            const perShip = Math.max(25, Math.floor(700 / selected.length));
            let filled = 0;
            for (const id of selected) {
                const input = document.querySelector(`#ship_${id}`);
                if (input && input.disabled) continue;
                const clickTarget =
                    document.querySelector(`img.tech${id}`)?.closest('a.dark_highlight_tablet') ||
                    document.querySelector(`#jumpgateForm [onclick*="toggleMaxShips('#jumpgateForm', ${id},"]`) ||
                    document.querySelector(`#jumpgateForm [onclick*="toggleMaxShips(\\"#jumpgateForm\\", ${id},"]`);
                if (!clickTarget) continue;
                clickTarget.click();
                filled++;
                await sleep(jitter(perShip));
            }
            if (!filled) {
                setStatus('Inter auto : aucun vaisseau disponible', 'error');
                sendNotification('OGame - Interception', '❌ Inter auto : aucun vaisseau disponible pour le saut', 'urgent');
                return;
            }
            const jumpBtn = document.querySelector('.js_executeJumpButton');
            if (!jumpBtn) {
                setStatus('Inter auto : bouton Sauter introuvable', 'error');
                sendNotification('OGame - Interception', '❌ Inter auto : bouton Sauter introuvable', 'urgent');
                return;
            }
            jumpBtn.click();
            setStatus(`Inter auto : saut vers ${target.destCoords}`, 'ok');
            markJumpCooldown(opt.value);
            sendNotification('OGame - Interception', `🛡 Saut effectué vers ${target.destCoords} (impact ${target.arrivalTime || '?'})`, 'urgent');
            // Recyclage post-saut : fonce sur la page Flotte de la lune attaquée,
            // le flag one-shot déclenche runGhost() (fleetsave → Continuer → Envoyer)
            // dès le chargement — le tout doit tenir avant l'impact.
            if (isGhostAuto()) {
                localStorage.setItem(GHOST_PENDING_KEY, '1');
                localStorage.setItem('ogs_db_scan_asap', '1'); // scan empire au prochain chargement
                const atk = listOwnMoons().find(m => m.coords === target.destCoords);
                if (atk) {
                    await sleep(jitter(250));
                    location.href = location.origin + location.pathname + '?page=ingame&component=fleetdispatch&cp=' + atk.cp;
                }
            } else {
                setTimeout(() => dbEmpireScan('post-interception-auto'), 4000);
            }
        } finally {
            interAutoRunning = false;
        }
    }
    // Exécute le saut immédiatement : depuis la bonne page, saute ; sinon
    // mémorise l'ordre et navigue — le saut part au chargement de la page.
    function interAutoOnHomePage() {
        const cfg = getInterAuto();
        return /component=facilities/.test(location.search) &&
               new RegExp('cp=' + cfg.moonCp + '(&|$)').test(location.search);
    }
    async function interAutoFire(target) {
        const cfg = getInterAuto();
        if (!cfg.armed || interAutoHandled()[target.arrivalTs]) return;
        // Re-lecture FRAÎCHE de l'eventlist au moment du tir : l'attaquant a pu
        // décaler son attaque à la sonde depuis la programmation du timer.
        let fresh = null;
        try {
            const attacks = await getHostileAttacks();
            fresh = attacks.find(a => a.arrivalTs && attackKey(a) === attackKey(target));
        } catch (e) {}
        if (!fresh) {
            setStatus('Inter auto : attaque disparue (rappel ?)', 'error');
            sendNotification('OGame - Interception', `⚠️ Attaque sur ${target.destCoords} disparue avant le saut`, 'urgent');
            interAutoScheduledFor = 0;
            return;
        }
        if (fresh.arrivalTs > target.arrivalTs + 1) {
            // Décalée : on NE saute PAS, on reprogramme sur le nouvel impact.
            setStatus(`Inter auto : impact décalé → ${fresh.arrivalTime || '?'}, re-programmé`, 'busy');
            sendNotification('OGame - Interception', `↻ Impact décalé sur ${target.destCoords} → ${fresh.arrivalTime || '?'} (saut re-programmé)`, 'high');
            interAutoScheduledFor = 0;
            interAutoTick();
            return;
        }
        if (interAutoOnHomePage()) { interAutoJump(fresh); return; }
        localStorage.setItem(INTERAUTO_PENDING_KEY, JSON.stringify({
            ts: fresh.arrivalTs, destCoords: fresh.destCoords, arrivalTime: fresh.arrivalTime || '',
            origin: fresh.originCoords || '',
        }));
        location.href = location.origin + location.pathname + '?page=ingame&component=facilities&cp=' + cfg.moonCp;
    }
    async function consumeInterAutoPendingIfNeeded() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(INTERAUTO_PENDING_KEY) || 'null'); } catch (e) {}
        if (!p) return;
        localStorage.removeItem(INTERAUTO_PENDING_KEY); // one-shot
        const cfg = getInterAuto();
        if (!cfg.armed || !interAutoOnHomePage()) return;
        // Dernière vérification : décalage pendant la navigation ?
        let fresh = null;
        try {
            const attacks = await getHostileAttacks();
            fresh = attacks.find(a => a.arrivalTs && a.destCoords === p.destCoords &&
                                      (!p.origin || a.originCoords === p.origin));
        } catch (e) {}
        if (fresh && fresh.arrivalTs > p.ts + 1) {
            setStatus(`Inter auto : impact décalé → ${fresh.arrivalTime || '?'}, re-programmé`, 'busy');
            sendNotification('OGame - Interception', `↻ Impact décalé sur ${p.destCoords} → ${fresh.arrivalTime || '?'} (saut re-programmé)`, 'high');
            interAutoScheduledFor = 0;
            interAutoTick();
            return;
        }
        const ts = fresh ? fresh.arrivalTs : p.ts;
        if (ts * 1000 - Date.now() < 1500) { setStatus('Inter auto : trop tard, saut annulé', 'error'); return; }
        interAutoJump({ arrivalTs: ts, destCoords: p.destCoords, arrivalTime: (fresh && fresh.arrivalTime) || p.arrivalTime });
    }
    setTimeout(consumeInterAutoPendingIfNeeded, 350);
    // Test à blanc : vérifie toute la chaîne SANS sauter. Si on n'est pas sur
    // la lune d'intervention, il y navigue LUI-MÊME (comme la vraie séquence)
    // et reprend le test au chargement, en mesurant la navigation réelle.
    const IA_TEST_KEY = 'ogs_ia_test_pending';
    async function interAutoDryRun(navMs) {
        const out = document.getElementById('ogs-ia-test-out');
        if (!out) return;
        const cfg = getInterAuto();
        const lines = [];
        const check = (ok, txt, warn) => {
            const c = ok ? '#74b23e' : (warn ? '#e0a94a' : '#e87e7e');
            lines.push(`<span style="color:${c};">${ok ? '✓' : (warn ? '⚠' : '✗')} ${txt}</span>`);
            return ok;
        };
        let fatal = false;
        fatal = !check(!!cfg.moonCp, cfg.moonCp ? `Lune d'intervention : ${cfg.moonCoords || cfg.moonCp}` : 'Aucune lune d\'intervention choisie') || fatal;
        const sel = getSelectedIds();
        fatal = !check(sel.length > 0, sel.length ? `${sel.length} type(s) de vaisseau coché(s)` : 'Aucun vaisseau coché (liste Flotte d\'interception)') || fatal;
        const off = parseInt(localStorage.getItem(SNIPE_OFFSET_KEY), 10);
        check(!isNaN(off), isNaN(off) ? 'Offset horloge non mesuré (précision ±qq s) — ouvre l\'Enchère ou re-mesure' : `Offset horloge : ${off} ms`, true);
        if (cfg.moonCp) {
            const gate = dbGates().find(g => g.id === String(cfg.moonCp));
            fatal = !check(!!gate, gate ? `Porte de saut connue (niv. ${gate.level || '?'})` : 'Porte inconnue de la BDD — scanne l\'empire') || fatal;
            const cd = dbGetGateCd(cfg.moonCp);
            check(!cd, cd ? `Porte en refroidissement jusqu'à ~${fmtHM(cd)}` : 'Porte non marquée en refroidissement', true);
            const cached = (dbLoad().counts || {})[String(cfg.moonCp)];
            if (cached) {
                let n = 0;
                sel.forEach(id => { n += cached.counts[id] || 0; });
                check(n > 0, n > 0 ? `${n.toLocaleString('fr-FR')} vaisseau(x) coché(s) présents sur la lune (BDD)` : 'Aucun des vaisseaux cochés présent sur la lune (BDD)', n === 0);
            } else {
                check(false, 'Composition de la lune inconnue (BDD) — scanne l\'empire', true);
            }
            check(dbGates().length >= 2, `${dbGates().length} lune(s) à porte connues (il en faut ≥ 2)`);
        }
        // pas sur la bonne page : on y va NOUS-MÊMES (comme la vraie séquence),
        // le test reprend au chargement — sauf si la config est déjà KO.
        if (cfg.moonCp && !interAutoOnHomePage()) {
            if (fatal) {
                out.innerHTML = lines.join('<br>') +
                    `<br><b style="color:#e87e7e;">✗ Corrige la config avant le test complet</b>`;
                return;
            }
            out.innerHTML = lines.join('<br>') +
                `<br><span style="color:#e0a94a;">→ Navigation vers la lune d'intervention (mesurée)…</span>`;
            localStorage.setItem(IA_TEST_KEY, JSON.stringify({ t0: Date.now() }));
            location.href = location.origin + location.pathname + '?page=ingame&component=facilities&cp=' + cfg.moonCp;
            return;
        }
        let navReal = null;
        if (typeof navMs === 'number' && navMs > 0) {
            navReal = navMs / 1000;
            check(navReal <= 4, `Navigation réelle : ${navReal.toFixed(1)} s`, navReal > 4);
        }
        // test réel de la porte (on est sur la bonne page)
        if (cfg.moonCp) {
            const form = await trapOpenGate();
            if (form) {
                await sleep(jitter(300));
                const data = trapReadGate();
                const cdNow = readGateFormCooldown(form);
                trapCloseGate();
                check(!!(data && data.dests.length), data ? `Porte ouverte en live : ${data.dests.length} destination(s)` : 'Porte ouverte mais illisible');
                check(!cdNow, cdNow ? `Porte en refroidissement (live) jusqu'à ~${fmtHM(cdNow)}` : 'Porte prête (live)');
            } else {
                check(false, 'Porte introuvable sur cette page');
            }
        }
        const lead = Math.max(5, parseInt(cfg.leadS, 10) || 10);
        const est = (navReal != null ? navReal : 1.5) + 2 + (isGhostAuto() ? 4.2 : 0);
        check(est + 1.5 <= lead, `Durée estimée de la séquence : ~${est.toFixed(1)} s pour ${lead} s de fenêtre${isGhostAuto() ? ' (recyclage inclus)' : ''}${navReal != null ? ' — navigation réelle incluse' : ''}`, est + 1.5 > lead);
        out.innerHTML = lines.join('<br>') + `<br><b style="color:${fatal ? '#e87e7e' : '#74b23e'};">${fatal ? '✗ Séquence NON opérationnelle' : '✓ Séquence prête'}</b>`;
    }
    // Reprise du test après la navigation auto.
    function consumeIaTestIfNeeded() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(IA_TEST_KEY) || 'null'); } catch (e) {}
        if (!p) return;
        localStorage.removeItem(IA_TEST_KEY);
        if (!interAutoOnHomePage()) return;
        if (Date.now() - p.t0 > 60000) return;   // trop vieux : abandon
        if (typeof ogsActivatePaneHook === 'function') ogsActivatePaneHook('inter');
        interAutoDryRun(Date.now() - p.t0);
    }
    async function interAutoTick() {
        const cfg = getInterAuto();
        if (!cfg.armed || !cfg.moonCp) { interAutoHot = false; renderInterAutoStatus(null, 0); return; }
        if (interAutoRunning || interAutoTicking) return;
        interAutoTicking = true;
        try {
            await interAutoTickInner(cfg);
        } finally {
            interAutoTicking = false;
        }
        // Surveillance rapprochée : relit l'eventlist toutes les 2 s quand
        // l'impact approche, pour suivre un éventuel décalage à la sonde.
        if (interAutoHot) {
            clearTimeout(interAutoFastTimer);
            interAutoFastTimer = setTimeout(interAutoTick, 2000);
        }
    }
    async function interAutoTickInner(cfg) {
        const lead = Math.max(5, parseInt(cfg.leadS, 10) || 10);
        const offset = parseInt(localStorage.getItem(SNIPE_OFFSET_KEY), 10) || 0;
        const now = Date.now();
        let attacks = [];
        try { attacks = await getHostileAttacks(); } catch (e) {}
        const handled = interAutoHandled();
        const cands = attacks
            .filter(a => a.arrivalTs && a.destIsMoon && !handled[a.arrivalTs])
            .filter(a => !cfg.moonCoords || a.destCoords !== cfg.moonCoords)         // pas de saut vers soi-même
            .filter(a => a.arrivalTs * 1000 - offset - now > lead * 1000 - 2000)     // encore jouable
            .sort((x, y) => x.arrivalTs - y.arrivalTs);
        const target = cands[0];
        renderInterAutoStatus(target, lead);
        if (!target) { interAutoHot = false; return; }
        const fireClient = target.arrivalTs * 1000 - offset - lead * 1000;
        const remain = fireClient - now;
        interAutoHot = remain < 120000;
        // Rien ne bouge avant impact −N s : toute la séquence (navigation,
        // saut, recyclage post-saut) démarre à fireClient, pas avant.
        if (remain <= 30000 && interAutoScheduledFor !== target.arrivalTs) {
            interAutoScheduledFor = target.arrivalTs;
            setTimeout(() => interAutoFire(target), Math.max(0, fireClient - Date.now()));
        }
    }
    setInterval(interAutoTick, 7000);
    setTimeout(interAutoTick, 2500);
    // ============================================================
    // TRAP (leurre via Porte de saut)
    // Dépose un % de la flotte civile + un % de la flotte militaire
    // de la lune courante vers une autre lune (appât visible à la sonde),
    // pour attirer une attaque interceptable depuis une autre lune.
    // ============================================================
    const TRAP_PCT_KEY = 'ogs_trap_pcts';   // JSON { techId: % } persisté par vaisseau
    const TRAP_SEL_KEY = 'ogs_trap_sel';    // JSON { techId: 0|1 } vaisseaux inclus dans le leurre
    const TRAP_PRESETS_KEY = 'ogs_trap_presets'; // JSON { nom: { pcts, sel } }
    const TRAP_DEST_KEY = 'ogs_trap_dest';
    const INTER_DEST_KEY = 'ogs_inter_dest';     // JSON { id, label } destination du saut d'interception
    // Coûts de construction unitaires [métal, cristal, deutérium]
    const SHIP_COSTS = {
        202: [2000, 2000, 0],       203: [6000, 6000, 0],
        204: [3000, 1000, 0],       205: [6000, 4000, 0],
        206: [20000, 7000, 2000],   207: [45000, 15000, 0],
        208: [10000, 20000, 10000], 209: [10000, 6000, 2000],
        210: [0, 1000, 0],          211: [50000, 25000, 15000],
        213: [60000, 50000, 15000], 214: [5000000, 4000000, 1000000],
        215: [30000, 40000, 15000], 218: [85000, 55000, 20000],
        219: [8000, 15000, 8000],
    };
    const CIVIL_IDS = [202, 203, 208, 209, 210];
    const MILITARY_IDS = [204, 205, 206, 207, 215, 211, 213, 214, 218, 219];
    function shipUnitValue(id) {
        const c = SHIP_COSTS[id];
        return c ? (c[0] + c[1] + c[2]) : 0;
    }
    function fmtMillions(v) {
        const m = v / 1e6;
        if (m >= 100) return Math.round(m).toLocaleString('fr-FR') + ' M';
        return m.toFixed(1).replace('.', ',') + ' M';
    }
    let trapGate = null;   // { dests:[{id,label}], counts:{techId:n} }
    let trapBusy = false;
    function setTrapStatus(txt, kind) {
        const s = document.getElementById('ogs-trap-status');
        if (!s) return;
        s.textContent = txt;
        const colors = { ok: '#7fd98a', error: '#e87e7e', busy: '#e0a94a' };
        s.style.color = colors[kind] || '#647c96';
    }
    async function trapOpenGate() {
        if (document.querySelector('#jumpgateForm')) return document.querySelector('#jumpgateForm');
        const gateLink = document.querySelector('a[href="javascript:openJumpgate();"]');
        if (!gateLink) return null;
        gateLink.click();
        return await waitFor('#jumpgateForm');
    }
    function trapCloseGate() {
        const dlg = document.querySelector('#jumpgateForm') && document.querySelector('#jumpgateForm').closest('.ui-dialog');
        const btn = dlg ? dlg.querySelector('.ui-dialog-titlebar-close') : document.querySelector('.ui-dialog-titlebar-close');
        if (btn) btn.click();
    }
    // Lit destinations + quantités disponibles dans le formulaire ouvert.
    function trapReadGate() {
        const form = document.querySelector('#jumpgateForm');
        if (!form) return null;
        const sel = form.querySelector('select[name="targetSpaceObjectId"]');
        const dests = sel ? Array.from(sel.options).map(o => ({ id: o.value, label: o.textContent.trim() })) : [];
        const counts = {};
        SHIPS.forEach(s => {
            const img = form.querySelector('img.tech' + s.id);
            const td = img && img.closest('td');
            const q = td && td.querySelector('.quantity');
            const n = q ? parseInt((q.textContent || '').replace(/\D/g, '') || '0', 10) : 0;
            counts[s.id] = isNaN(n) ? 0 : n;
        });
        // au passage : état de refroidissement de la porte courante
        dbSetGateCd(getCurPlanetId(), readGateFormCooldown(form));
        return { dests, counts };
    }
    // % par vaisseau, persistés. Défauts : civils 100%, militaires 10%.
    function loadTrapPcts() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(TRAP_PCT_KEY) || '{}'); } catch (e) {}
        const pcts = {};
        SHIPS.forEach(s => {
            const def = CIVIL_IDS.includes(s.id) ? 100 : 10;
            const v = parseInt(saved[s.id], 10);
            pcts[s.id] = (isNaN(v) || v < 0) ? def : Math.min(100, v);
        });
        return pcts;
    }
    function saveTrapPct(id, pct) {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(TRAP_PCT_KEY) || '{}'); } catch (e) {}
        saved[id] = pct;
        localStorage.setItem(TRAP_PCT_KEY, JSON.stringify(saved));
    }
    // Sélection par vaisseau (coché = inclus dans le leurre). Défaut : coché.
    function loadTrapSel() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(TRAP_SEL_KEY) || '{}'); } catch (e) {}
        const sel = {};
        SHIPS.forEach(s => { sel[s.id] = saved[s.id] === 0 ? 0 : 1; });
        return sel;
    }
    function saveTrapSel(id, on) {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem(TRAP_SEL_KEY) || '{}'); } catch (e) {}
        saved[id] = on ? 1 : 0;
        localStorage.setItem(TRAP_SEL_KEY, JSON.stringify(saved));
    }
    // Sélection courante : lue depuis les checkboxes si présentes, sinon depuis le stockage.
    function trapCurrentSel() {
        const sel = loadTrapSel();
        document.querySelectorAll('.ogs-trap-cb').forEach(cb => {
            sel[parseInt(cb.dataset.id, 10)] = cb.checked ? 1 : 0;
        });
        return sel;
    }
    // % courants : lus depuis les inputs de la liste si présents, sinon depuis le stockage.
    function trapCurrentPcts() {
        const pcts = loadTrapPcts();
        document.querySelectorAll('.ogs-trap-pct').forEach(inp => {
            const id = parseInt(inp.dataset.id, 10);
            let v = parseInt(inp.value, 10);
            if (isNaN(v) || v < 0) v = 0;
            if (v > 100) v = 100;
            pcts[id] = v;
        });
        return pcts;
    }
    // Quantités d'appât : plancher(count × %) par type, 0 si le vaisseau est décoché.
    function trapBaitCounts(counts, pcts, sel) {
        const bait = {};
        SHIPS.forEach(s => {
            const n = counts[s.id] || 0;
            bait[s.id] = (sel && !sel[s.id]) ? 0 : Math.floor(n * (pcts[s.id] || 0) / 100);
        });
        return bait;
    }
    // ---- Presets de composition (pcts + sélection) ----
    function loadTrapPresets() {
        try { return JSON.parse(localStorage.getItem(TRAP_PRESETS_KEY) || '{}'); } catch (e) { return {}; }
    }
    function saveTrapPresets(p) {
        localStorage.setItem(TRAP_PRESETS_KEY, JSON.stringify(p));
    }
    function refreshTrapPresetSelect(selectName) {
        const sel = document.getElementById('ogs-trap-preset');
        if (!sel) return;
        const names = Object.keys(loadTrapPresets()).sort((a, b) => a.localeCompare(b, 'fr'));
        sel.innerHTML = '<option value="">— preset —</option>' +
            names.map(n => `<option value="${n.replace(/"/g, '&quot;')}"${n === selectName ? ' selected' : ''}>${n}</option>`).join('');
    }
    function trapPresetSave() {
        const nameIn = document.getElementById('ogs-trap-preset-name');
        const selEl = document.getElementById('ogs-trap-preset');
        const name = (nameIn.value || '').trim() || selEl.value;
        if (!name) { setTrapStatus('Donne un nom au preset', 'error'); return; }
        const presets = loadTrapPresets();
        presets[name] = { pcts: trapCurrentPcts(), sel: trapCurrentSel() };
        saveTrapPresets(presets);
        nameIn.value = '';
        refreshTrapPresetSelect(name);
        setTrapStatus(`Preset « ${name} » enregistré`, 'ok');
    }
    function trapPresetLoad() {
        const name = document.getElementById('ogs-trap-preset').value;
        if (!name) { setTrapStatus('Choisis un preset', 'error'); return; }
        const p = loadTrapPresets()[name];
        if (!p) { setTrapStatus('Preset introuvable', 'error'); return; }
        localStorage.setItem(TRAP_PCT_KEY, JSON.stringify(p.pcts || {}));
        localStorage.setItem(TRAP_SEL_KEY, JSON.stringify(p.sel || {}));
        if (trapGate) { renderTrapShipList(); updateTrapPreview(); }
        setTrapStatus(`Preset « ${name} » chargé`, 'ok');
    }
    function trapPresetDelete() {
        const name = document.getElementById('ogs-trap-preset').value;
        if (!name) { setTrapStatus('Choisis un preset', 'error'); return; }
        const presets = loadTrapPresets();
        delete presets[name];
        saveTrapPresets(presets);
        refreshTrapPresetSelect();
        setTrapStatus(`Preset « ${name} » supprimé`, 'ok');
    }
    // Liste par vaisseau : dispo, % éditable, nb résultant en temps réel.
    function renderTrapShipList() {
        const box = document.getElementById('ogs-trap-ships');
        if (!box || !trapGate) return;
        const pcts = loadTrapPcts();
        const sel = loadTrapSel();
        const rows = SHIPS.filter(s => (trapGate.counts[s.id] || 0) > 0).map(s => {
            const n = trapGate.counts[s.id];
            const isCiv = CIVIL_IDS.includes(s.id);
            const on = !!sel[s.id];
            return `<div class="ogs-trap-row" data-id="${s.id}" style="display:flex;align-items:center;gap:6px;font-size:10px;${on ? '' : 'opacity:.45;'}">
                <input type="checkbox" class="ogs-trap-cb" data-id="${s.id}"${on ? ' checked' : ''}>
                <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${isCiv ? '#a6cbee' : '#e0a94a'};" title="${s.name}">${s.name}</span>
                <span style="width:52px;text-align:right;color:#647c96;">${n.toLocaleString('fr-FR')}</span>
                <input type="number" class="ogs-num ogs-trap-pct" data-id="${s.id}" value="${pcts[s.id]}" min="0" max="100" step="1" style="width:52px;">
                <span style="width:14px;color:#647c96;">%</span>
                <span class="ogs-trap-res" data-id="${s.id}" style="width:58px;text-align:right;color:#5cc6ff;">→ ${(on ? Math.floor(n * pcts[s.id] / 100) : 0).toLocaleString('fr-FR')}</span>
            </div>`;
        }).join('');
        box.innerHTML = rows || '<div style="font-size:10px;color:#647c96;">Aucun vaisseau sur cette lune</div>';
    }
    function trapGroupStats(counts, ids) {
        let value = 0, nb = 0;
        ids.forEach(id => { const n = counts[id] || 0; nb += n; value += n * shipUnitValue(id); });
        return { value, nb };
    }
    function updateTrapPreview() {
        const stats = document.getElementById('ogs-trap-stats');
        const prev = document.getElementById('ogs-trap-preview');
        if (!stats || !prev || !trapGate) return;
        const civ = trapGroupStats(trapGate.counts, CIVIL_IDS);
        const mil = trapGroupStats(trapGate.counts, MILITARY_IDS);
        stats.innerHTML = `<div style="font-size:10px;line-height:1.6;color:#bcd4ea;">Sur cette lune :<br>` +
            `Civils : <b style="color:#a6cbee">${fmtMillions(civ.value)}</b> (${civ.nb.toLocaleString('fr-FR')} vx)<br>` +
            `Militaires : <b style="color:#a6cbee">${fmtMillions(mil.value)}</b> (${mil.nb.toLocaleString('fr-FR')} vx)</div>`;
        const pcts = trapCurrentPcts();
        const bait = trapBaitCounts(trapGate.counts, pcts, trapCurrentSel());
        // Rafraîchit le "→ N" de chaque ligne
        document.querySelectorAll('.ogs-trap-res').forEach(sp => {
            const id = parseInt(sp.dataset.id, 10);
            sp.textContent = '→ ' + (bait[id] || 0).toLocaleString('fr-FR');
        });
        const bCiv = trapGroupStats(bait, CIVIL_IDS);
        const bMil = trapGroupStats(bait, MILITARY_IDS);
        const total = bCiv.value + bMil.value;
        const nb = bCiv.nb + bMil.nb;
        prev.innerHTML = `<div style="font-size:10px;line-height:1.6;color:#bcd4ea;border-top:1px solid #243449;padding-top:6px;">Appât à poser :<br>` +
            `Civils : <b style="color:#5cc6ff">${fmtMillions(bCiv.value)}</b> (${bCiv.nb.toLocaleString('fr-FR')} vx)<br>` +
            `Militaires : <b style="color:#5cc6ff">${fmtMillions(bMil.value)}</b> (${bMil.nb.toLocaleString('fr-FR')} vx)<br>` +
            `Total : <b style="color:#f0b24a">${fmtMillions(total)}</b> (${nb.toLocaleString('fr-FR')} vx)</div>`;
    }
    async function trapDeploy() {
        if (trapBusy) return;
        if (!trapGate) { setTrapStatus('Analyse la porte d\'abord', 'error'); return; }
        const destId = document.getElementById('ogs-trap-dest').value;
        if (!destId) { setTrapStatus('Choisis une destination', 'error'); return; }
        trapBusy = true;
        const btn = document.getElementById('ogs-trap-go');
        btn.disabled = true;
        btn.classList.add('ogs-busy');
        try {
            setTrapStatus('Ouverture de la porte...', 'busy');
            const form = await trapOpenGate();
            if (!form) { setTrapStatus('Porte de saut introuvable', 'error'); return; }
            await sleep(jitter(200));
            // Relecture fraîche : les quantités ont pu bouger depuis l'analyse.
            const data = trapReadGate();
            if (!data) { setTrapStatus('Lecture du formulaire impossible', 'error'); return; }
            trapGate = data;
            dbSetGatesFromScan(data.dests);
            dbSetCounts(data.counts);
            renderTrapShipList();
            updateTrapPreview();
            const sel = form.querySelector('select[name="targetSpaceObjectId"]');
            if (!sel || !Array.from(sel.options).some(o => o.value === destId)) {
                setTrapStatus('Destination absente de la porte', 'error');
                return;
            }
            sel.value = destId;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            await sleep(jitter(180));
            const bait = trapBaitCounts(data.counts, trapCurrentPcts(), trapCurrentSel());
            // Budget total ~3 s après le clic : le remplissage se partage ~2 s.
            const toFill = SHIPS.filter(s => (bait[s.id] || 0) > 0);
            const perShip = Math.max(35, Math.floor(2000 / Math.max(1, toFill.length)));
            let filled = 0;
            for (const s of toFill) {
                // Lune avec vaisseaux : inputs "ship_204" ; lune vide : inputs "204" (désactivés).
                const input = form.querySelector(`input[name="ship_${s.id}"]`) ||
                              form.querySelector(`input[name="${s.id}"]`);
                if (!input || input.disabled) continue;
                fillInput(input, bait[s.id]);
                filled++;
                await sleep(jitter(perShip));
            }
            if (filled === 0) {
                setTrapStatus('Aucun vaisseau à poser (0 partout)', 'error');
                return;
            }
            setTrapStatus(`${filled} type(s), saut...`, 'busy');
            await sleep(jitter(150));
            const jumpBtn = form.querySelector('.js_executeJumpButton') || document.querySelector('.js_executeJumpButton');
            if (!jumpBtn) { setTrapStatus('Bouton Sauter introuvable', 'error'); return; }
            jumpBtn.click();
            const destLabel = (trapGate.dests.find(d => d.id === destId) || {}).label || '';
            setTrapStatus(`Trap posé → ${destLabel}`, 'ok');
            markJumpCooldown(destId);
            setTimeout(() => dbEmpireScan('post-trap'), 4000);
        } finally {
            trapBusy = false;
            btn.disabled = false;
            btn.classList.remove('ogs-busy');
        }
    }
    // ============================================================
    // RECYCLAGE POST-SAUT (one-shot) — déclenché par la checkbox
    // "Recycler après saut" de la section Interception.
    // Raccourci OGLight "fleetsave" : préremplit flotte civile + mission
    // recyclage + position. Il reste : Continuer -> Envoyer.
    // Délai fixe court entre les actions (justifié par les raccourcis clavier).
    // ============================================================
    // Délai aléatoire court entre les actions (justifié par les raccourcis clavier).
    const GHOST_STEP_MIN = 200;
    const GHOST_STEP_MAX = 300;
    const ghostStep = () => sleep(GHOST_STEP_MIN + Math.round(Math.random() * (GHOST_STEP_MAX - GHOST_STEP_MIN)));
    let ghostRunning = false;
    async function runGhost() {
        if (ghostRunning) return;
        ghostRunning = true;
        try {
            if (!isFleetPage()) return;
            await ghostStep();
            // 1. Raccourci Ghost (fleetsave)
            const ghostBtn = document.querySelector('[data-key-id="fleetsave"]');
            if (!ghostBtn) {
                setStatus('Raccourci Ghost introuvable', 'error');
                return;
            }
            ghostBtn.click();
            // Laisser la présélection Ghost s'enregistrer avant Continuer.
            // Un peu plus que ghostStep() seul pour éviter "page=fleet2 introuvable".
            await sleep(700 + Math.round(Math.random() * 400)); // 700-1100 ms
            // 2. Continuer (fleet1 -> fleet2)
            const continueBtn = document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]');
            if (!continueBtn) {
                setStatus('Bouton Continuer introuvable', 'error');
                return;
            }
            continueBtn.click();
            // 3. Attendre fleet3 (bouton Envoyer) — AJAX serveur, hors budget
            const sendBtn = await waitFor('#sendFleet', 8000);
            if (!sendBtn) {
                setStatus('Bouton Envoyer non charge (pas de DF ?)', 'error');
                return;
            }
            await ghostStep();
            // 4. Envoyer
            sendBtn.click();
            setStatus('Recyclage envoye', 'ok');
        } finally {
            ghostRunning = false;
        }
    }
    function consumeGhostPendingIfNeeded() {
        if (localStorage.getItem(GHOST_PENDING_KEY) !== '1') return;
        if (!isFleetPage()) return;
        localStorage.removeItem(GHOST_PENDING_KEY); // one-shot : retiré AVANT le lancement
        setStatus('Recyclage post-saut...', 'busy');
        runGhost();
    }
    // ============================================================
    // ENVOI AUTO D'EXPÉDITIONS (machine à états persistée, humanisée)
    // ============================================================
    function loadExpeState() {
        try { return JSON.parse(localStorage.getItem(EXPE_STATE_KEY)) || null; }
        catch { return null; }
    }
    function saveExpeState(st) {
        if (st) localStorage.setItem(EXPE_STATE_KEY, JSON.stringify(st));
        else localStorage.removeItem(EXPE_STATE_KEY);
    }
    function isExpeRunning() {
        const st = loadExpeState();
        return !!(st && st.running);
    }
    // Lit "Expéditions: used/total" dans les tooltips de la page. Mémorise le
    // total connu pour alimenter le dropdown du nombre de slots.
    function getExpeSlotsInfo() {
        const candidates = document.querySelectorAll('.tooltip');
        for (const c of candidates) {
            const txt = c.textContent || '';
            const m = txt.match(/Exp[ée]ditions?\s*:?\s*(\d+)\s*\/\s*(\d+)/i);
            if (m) {
                const used = parseInt(m[1], 10);
                const total = parseInt(m[2], 10);
                if (!isNaN(used) && !isNaN(total)) {
                    localStorage.setItem(EXPE_TOTAL_KEY, String(total));
                    return { used, total, free: Math.max(0, total - used) };
                }
            }
        }
        return null;
    }
    function getFreeExpeSlots() {
        const info = getExpeSlotsInfo();
        return info ? info.free : null;
    }
    function getKnownExpeTotal() {           // total de slots connu (live ou mémorisé)
        const info = getExpeSlotsInfo();
        if (info) return info.total;
        let t = parseInt(localStorage.getItem(EXPE_TOTAL_KEY), 10);
        return (!isNaN(t) && t > 0) ? t : 0;
    }
    function getExpeCount() {                 // 0 = Toutes
        let v = parseInt(localStorage.getItem(EXPE_COUNT_KEY), 10);
        if (isNaN(v) || v < 0) v = 0;
        return v;
    }
    function expeCountOptionsHtml() {
        const total = getKnownExpeTotal();
        const max = total > 0 ? total : 9;   // fallback si total pas encore connu
        const cur = getExpeCount();
        let html = '<option value="0"' + (cur === 0 ? ' selected' : '') + '>Toutes</option>';
        for (let i = 1; i <= max; i++) {
            html += '<option value="' + i + '"' + (cur === i ? ' selected' : '') + '>' + i + '</option>';
        }
        return html;
    }
    function getExpeHoldHours() {
        let v = parseInt(localStorage.getItem(EXPE_HOLD_KEY), 10);
        if (isNaN(v) || v < 1) v = DEFAULT_EXPE_HOLD_HOURS;
        if (v > 20) v = 20;
        return v;
    }
    // Règle le "Temps d'expédition" (maintien, en heures) sur la page fleet3,
    // avant l'envoi. Voie directe validée : fleetDispatcher.expeditionTime +
    // updateExpeditionTime() + refresh(). Clampe au max autorisé par le compte.
    function applyExpeditionHoldTime() {
        try {
            const fd = window.fleetDispatcher;
            if (!fd) return false;
            const want = getExpeHoldHours();
            const sel = document.getElementById('expeditiontime');
            let max = 1;
            if (sel && sel.options && sel.options.length) {
                max = Math.max.apply(null, Array.from(sel.options).map(o => parseInt(o.value, 10) || 1));
            }
            const h = Math.min(want, max);
            if (sel) sel.value = String(h);
            fd.expeditionTime = h;
            try { fd.updateExpeditionTime && fd.updateExpeditionTime(); } catch (e) {}
            // Synchro du label visible du dropdown custom OGame (cosmétique)
            const span = document.querySelector('#expeditiontimeline span.dropdown');
            if (span) {
                const a = span.querySelector('a');
                if (a) { a.setAttribute('data-value', String(h)); a.textContent = String(h); }
            }
            try { fd.refresh && fd.refresh(); } catch (e) {}
            return true;
        } catch (e) {
            console.error('[OGS] applyExpeditionHoldTime', e);
            return false;
        }
    }
    function startExpeditions() {
        if (isExpeRunning()) return;
        saveExpeState({ running: true, cycles: 0, busy: false, target: getExpeCount() });
        updateExpeButtons();
        if (isFleetPage()) {
            runExpeditionStep();
        } else {
            setStatus('Redirection vers Flotte...', 'busy');
            const fleetLink = document.querySelector('a.menubutton[href*="component=fleetdispatch"]');
            if (fleetLink) {
                fleetLink.click();
            } else {
                location.href = `${location.origin}${location.pathname}?page=ingame&component=fleetdispatch`;
            }
        }
    }
    function stopExpeditions(reason) {
        saveExpeState(null);
        updateExpeButtons();
        if (reason) setStatus(reason, 'ok');
    }
    // Sécurité anti-oubli : une fois tous les slots lancés, le Maintien
    // revient à 1 h (pour ne pas relancer à 8 h le lendemain matin).
    function resetExpeHold() {
        localStorage.setItem(EXPE_HOLD_KEY, '1');
        const inp = document.getElementById('ogs-expe-hold');
        if (inp) inp.value = 1;
    }
    let expeStepInFlight = false; // verrou mémoire synchrone (anti-course observer)
    async function runExpeditionStep() {
        if (expeStepInFlight) return;
        const st = loadExpeState();
        if (!st || !st.running) return;
        if (st.busy) return;
        if (st.cycles >= EXPE_MAX_CYCLES) {
            stopExpeditions('Expéditions: limite cycles atteinte');
            return;
        }
        // Cible de slots demandée pour ce run (0 = Toutes)
        const target = (st.target && st.target > 0) ? st.target : 0;
        if (target && st.cycles >= target) {
            stopExpeditions('Expéditions : ' + target + ' envoyée(s)');
            resetExpeHold();
            return;
        }
        if (!isFleetPage()) return;
        expeStepInFlight = true;
        st.busy = true;
        saveExpeState(st);
        try {
            await sleep(humanMs(250, 550));
            const free = getFreeExpeSlots();
            if (free !== null && free <= 0) {
                stopExpeditions('Expéditions: tous les slots pleins');
                resetExpeHold();
                return;
            }
            setStatus(`Expédition (${free !== null ? free + ' libre(s)' : '?'})...`, 'busy');
            const preselect = document.querySelector('[data-key-id="expeditionLC"]');
            if (!preselect) { stopExpeditions('Raccourci expédition introuvable'); return; }
            preselect.click();
            // Laisser la présélection s'enregistrer avant Continuer
            await sleep(humanMs(300, 550));
            const continueBtn = document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]');
            if (!continueBtn) { stopExpeditions('Bouton Continuer introuvable'); return; }
            continueBtn.click();
            const sendBtn = await waitFor('#sendFleet', 8000);
            if (!sendBtn) { stopExpeditions('Bouton Envoyer non chargé'); return; }
            // Régler le maintien (heures) choisi dans le panneau avant l'envoi
            applyExpeditionHoldTime();
            await sleep(humanMs(300, 550)); // laisse le maintien + recalcul se poser
            // IMPORTANT : le clic Envoyer recharge la page. On persiste donc
            // l'état AVANT le clic (cycle +1, busy=false), sinon le finally ne
            // s'exécute pas et la reprise reste bloquée sur busy=true.
            st.cycles = (st.cycles || 0) + 1;
            st.busy = false;
            saveExpeState(st);
            expeStepInFlight = false;
            setStatus(`Expédition ${st.cycles} envoyée...`, 'ok');
            sendBtn.click();
            // Après ce clic, la page recharge et le cycle suivant repart via
            // resumeExpeditionsIfNeeded() au chargement.
        } catch (e) {
            console.error('[OGS] Erreur expédition', e);
            const cur = loadExpeState();
            if (cur) { cur.busy = false; saveExpeState(cur); }
            expeStepInFlight = false;
        }
    }
    function resumeExpeditionsIfNeeded() {
        if (!isExpeRunning()) return;
        if (isFleetPage()) {
            runExpeditionStep();
        }
    }
    function updateExpeButtons() {
        const on = isExpeRunning();
        const pb = document.getElementById('ogs-expe');
        if (pb) {
            pb.textContent = on ? '⏹ Stop expéditions' : '🚀 Envoyer les expéditions';
            pb.classList.toggle('ogs-btn-stop', on);
        }
        const ib = document.getElementById('ogs-expe-inline');
        if (ib) {
            ib.innerHTML = on
                ? '<span class="ogs-inline-ico">⏹</span><span>Stop expéditions</span>'
                : '<span class="ogs-inline-ico">🚀</span><span>Envoyer les expéditions</span>';
            ib.classList.toggle('ogs-inline-stop', on);
        }
    }
    function toggleExpeditions() {
        if (isExpeRunning()) stopExpeditions('Expéditions arrêtées');
        else startExpeditions();
    }
    function injectInlineButtons() {
        if (!isFleetPage()) return;
        if (document.getElementById('ogs-expe-inline')) return;
        // Ancrage sous la grille de vaisseaux. On insère APRÈS #technologies
        // (la grille), sinon fallback sur la fin du formulaire / du bloc.
        const grid = document.querySelector('#technologies');
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:100%; display:flex; justify-content:center; margin:12px 0 6px; clear:both;';
        wrap.innerHTML = `
            <button id="ogs-expe-inline" class="ogs-inline-btn">
                <span class="ogs-inline-ico">🚀</span>
                <span>Envoyer les expéditions</span>
            </button>
        `;
        if (grid) {
            grid.insertAdjacentElement('afterend', wrap);
        } else {
            const anchor = document.querySelector('#shipsChosen') || document.querySelector('#buttonz .content') || document.querySelector('#fleet1');
            if (!anchor) return;
            anchor.appendChild(wrap);
        }
        // Pas de listener attaché ici : le clic est géré par délégation globale
        // (voir plus bas), ce qui survit aux reconstructions du DOM par OGame.
        updateExpeButtons();
    }
    // ============================================================
    // SNIPER D'ENCHÈRE (commissaire-priseur)
    // - endTime (socket 'timeLeft') = fin EXACTE en horloge SERVEUR.
    // - L'horloge du PC dérive : on mesure OFFSET = serveur - client en
    //   repérant le "tic" de la seconde serveur via des HEAD successifs.
    // - Tir calculé pour que le POST ARRIVE à endTime - marge :
    //     instant_client = endTime - offset - latence_aller - marge
    // - Fenêtre finale gérée par un Web Worker (résiste au throttling des
    //   onglets en arrière-plan).
    // - Montant = minimum requis pour repasser devant (calculé au tir),
    //   plafonné par maxMetal.
    // ============================================================
    const snipe = {
        endTime: null,      // ms, horloge SERVEUR
        offset: null,       // ms, serveur - client
        offsetSpread: null,
        oneWay: 100,        // ms, latence aller (~RTT/2)
        armed: false,
        fired: false,
        attempts: 0,        // nb de tirs de précision sur la vente en cours (pour le re-tir)
        rafaleCount: 0,     // nb de mises rafale envoyées sur la vente
        everLed: false,     // a-t-on pris la tête à un moment de la vente ?
        winner: null,
        bids: null,
        hooked: false,
        socketDown: false,
    };
    let snipeCoarseTimer = null;
    let snipeWorker = null;
    let snipeRafaleStartTimer = null;   // setTimeout jusqu'au début de la rafale
    let snipeRafaleInterval = null;     // setInterval des tirs de rafale (1/s)
    const SNIPE_TIGHT_WINDOW_MS = 2500;
    const SNIPE_MAX_ATTEMPTS = 2;   // 1 tir + 1 re-tir si pas en tête et marge suffisante
    function isSnipeArmed()  { return localStorage.getItem(SNIPE_ARMED_KEY) === '1'; }
    function getSnipeMargin() {   // ms
        let v = parseInt(localStorage.getItem(SNIPE_MARGIN_KEY), 10);
        if (isNaN(v) || v < 0) v = DEFAULT_SNIPE_MARGIN_MS;
        return v;
    }
    function getSnipeMaxMetal() {
        let v = parseInt(localStorage.getItem(SNIPE_MAXMETAL_KEY), 10);
        if (isNaN(v) || v < 0) v = DEFAULT_SNIPE_MAXMETAL;
        return v;
    }
    function getSnipeBump() {
        let v = parseInt(localStorage.getItem(SNIPE_BUMP_KEY), 10);
        if (isNaN(v) || v < 0) v = 0;
        return v;
    }
    function isRafaleOn() { return localStorage.getItem(SNIPE_RAFALE_KEY) === '1'; }
    function getRafaleBump() {
        let v = parseInt(localStorage.getItem(SNIPE_RAFALE_BUMP_KEY), 10);
        if (isNaN(v) || v < 0) v = DEFAULT_SNIPE_RAFALE_BUMP;
        return v;
    }
    function getRafaleInterval() {   // ms entre 2 tirs, plancher 100 ms
        let v = parseInt(localStorage.getItem(SNIPE_RAFALE_INTERVAL_KEY), 10);
        if (isNaN(v) || v < 100) v = DEFAULT_SNIPE_RAFALE_INTERVAL;
        return v;
    }
    function getRafaleWindowMs() {    // fenêtre = N secondes avant la fin (1..10)
        let s = parseInt(localStorage.getItem(SNIPE_RAFALE_WINDOW_KEY), 10);
        if (isNaN(s) || s < 1) s = DEFAULT_SNIPE_RAFALE_WINDOW_S;
        if (s > 10) s = 10;
        return s * 1000;
    }
    function isAuctioneerPage() {
        return /component=trader/i.test(location.search) || !!document.querySelector('#div_auctioneer');
    }
    // Une vente est-elle réellement EN COURS ? (sinon on est dans le cooldown entre deux ventes,
    // où l'événement 'timeLeft' renvoie le DÉBUT de la prochaine vente, pas une fin d'enchère).
    function isAuctionRunning() {
        const o = document.querySelector('.noAuctionOverlay');
        const overlayVisible = o ? o.offsetParent !== null : false;
        return !overlayVisible;
    }
    // ---- Mesure du décalage d'horloge (indépendante de la machine) ----
    async function snipeHead() {
        const t0 = Date.now();
        const r = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
        const t1 = Date.now();
        return { srvSec: new Date(r.headers.get('date')).getTime(), recv: t1, rtt: t1 - t0 };
    }
    async function measureSnipeOffset(maxMs = 9000, wantTicks = 4) {
        const ticks = [], rtts = [];
        let prev = null;
        const start = Date.now();
        try {
            while (Date.now() - start < maxMs && ticks.length < wantTicks) {
                const h = await snipeHead();
                rtts.push(h.rtt);
                if (prev !== null && h.srvSec !== prev) {
                    // la seconde serveur vient de changer : tic ≈ recv - rtt/2 côté client
                    ticks.push(h.srvSec - (h.recv - h.rtt / 2));
                }
                prev = h.srvSec;
                await sleep(110); // < 1 s pour ne pas rater de tic
            }
        } catch (e) { console.warn('[OGS] measureOffset err', e); }
        if (ticks.length) {
            ticks.sort((a, b) => a - b);
            snipe.offset = Math.round(ticks[Math.floor(ticks.length / 2)]); // médiane
            snipe.offsetSpread = Math.round(ticks[ticks.length - 1] - ticks[0]);
        } else {
            const h = await snipeHead().catch(() => null);
            if (h) snipe.offset = Math.round(h.srvSec - (h.recv - h.rtt / 2));
            snipe.offsetSpread = 1000;
        }
        rtts.sort((a, b) => a - b);
        snipe.oneWay = Math.round((rtts[0] || 200) / 2);
        try { localStorage.setItem(SNIPE_OFFSET_KEY, String(snipe.offset)); } catch (e) {} // partagé pour l'affichage cross-page
        console.log('[OGS] offset serveur-client =', snipe.offset, 'ms | ±', snipe.offsetSpread, 'ms | aller ≈', snipe.oneWay, 'ms');
        updateSnipeDisplay();
        return snipe.offset;
    }
    // ---- Hook de la socket auctioneer ----
    // Récupère la VRAIE socket /auctioneer. window.auctioneer.socket peut être
    // vide (bug observé après navigation) alors que la nsp existe bien dans
    // io.managers -> on va la chercher là et on resynchronise la référence.
    function getAuctioneerSocket() {
        const a = window.auctioneer;
        if (a && a.socket) return a.socket;
        try {
            let found = null;
            Object.values(io.managers).forEach(m => Object.values(m.nsps || {}).forEach(s => {
                if (s && s.nsp === '/auctioneer') found = s;
            }));
            if (found && a) a.socket = found; // resynchronise pour le reste du script
            return found;
        } catch (e) { return null; }
    }
    function hookAuctioneerSocket() {
        const s = getAuctioneerSocket();
        if (!s) return false;
        if (s.__ogsSniperHooked) { snipe.hooked = true; return true; }
        s.__ogsSniperHooked = true;
        s.on('timeLeft', p => {
            const et = p && p.data && p.data.endTime;
            if (!et) return;
            // Entre deux ventes, 'timeLeft' renvoie le DÉBUT de la prochaine vente (texte
            // "Prochaine vente aux enchères dans : …"). Ce n'est PAS une fin d'enchère : on
            // ne s'arme surtout pas dessus (sinon tir au lancement de la vente).
            const running = !/prochaine vente/i.test((p && p.text) || '') && isAuctionRunning();
            if (!running) {
                if (snipe.endTime !== null) {
                    snipe.endTime = null; snipe.armed = false; snipe.fired = false; snipe.attempts = 0;
                    clearTimeout(snipeCoarseTimer);
                    if (snipeWorker) { snipeWorker.terminate(); snipeWorker = null; }
                    stopRafale();
                }
                try { localStorage.removeItem(SNIPE_ENDTIME_KEY); } catch (e) {}
                updateSnipeDisplay();
                return;
            }
            const ms = et * 1000;
            if (snipe.endTime !== ms) {
                snipe.endTime = ms;
                snipe.armed = false;   // nouvelle échéance -> replanifier
                snipe.fired = false; snipe.attempts = 0; snipe.rafaleCount = 0; snipe.everLed = false;
                try { localStorage.setItem(SNIPE_ENDTIME_KEY, String(ms)); } catch (e) {} // cache
                console.log('[OGS] endTime =', new Date(ms).toISOString(), '(serveur)');
                scheduleSnipeFire();
            }
        });
        s.on('new bid', p => {
            snipe.winner = p && p.player && p.player.name;
            snipe.bids = p && p.bids;
            const me = detectMyName();
            if (me && snipe.winner === me) snipe.everLed = true;   // on a pris la tête à un moment
            console.log('[OGS] NEW BID -> gagnant:', snipe.winner, '| enchères:', snipe.bids, (me && snipe.winner === me) ? '(TOI)' : '');
            updateSnipeDisplay();
        });
        s.on('auction finished', p => {
            snipe.winner = p && p.player && p.player.name;
            const me = detectMyName();
            const won = me && snipe.winner === me;
            // ---- BILAN DÉTAILLÉ (pour diagnostiquer une défaite) ----
            const myFinal = parseFR(document.querySelector('.js_alreadyBidden')?.textContent);
            const winSum  = (p && p.sum != null) ? Number(p.sum) : null;
            const totShots = (snipe.attempts || 0) + (snipe.rafaleCount || 0);
            let diag;
            if (won) {
                diag = 'GAGNÉ ✅';
            } else if (totShots === 0) {
                diag = '❌ AUCUN tir envoyé -> pas armé à temps, socket HS, ou hors page enchères';
            } else if (!snipe.everLed) {
                diag = '❌ jamais pris la tête malgré ' + totShots + ' mise(s) -> mises REFUSÉES/INSUFFISANTES (source sans métal ? montant < min ? prix qui monte plus vite ?)';
            } else {
                diag = '❌ pris la tête puis DOUBLÉ en fin -> augmente la marge/le bump, ou active la rafale';
            }
            console.log(
                '[OGS] === BILAN VENTE ===\n' +
                '  résultat      : ' + (won ? 'GAGNÉ' : 'PERDU') + '\n' +
                '  gagnant       : ' + (snipe.winner || '?') + '\n' +
                '  montant gagnant: ' + (winSum != null ? winSum.toLocaleString('fr') : '?') + '\n' +
                '  ta mise finale: ' + myFinal.toLocaleString('fr') + '\n' +
                '  tirs précision: ' + (snipe.attempts || 0) + ' | mises rafale: ' + (snipe.rafaleCount || 0) + '\n' +
                '  as-tu mené ?  : ' + (snipe.everLed ? 'oui à un moment' : 'non, jamais') + '\n' +
                '  diagnostic    : ' + diag
            );
            console.log('[OGS] VENTE TERMINÉE — gagnant:', snipe.winner, '| prochaine @', p && p.nextActionTime ? new Date(p.nextActionTime * 1000) : '?');
            setStatus(won ? 'Enchère GAGNÉE' : `Perdue (${snipe.winner || '?'})`, won ? 'ok' : 'error');
            snipe.endTime = null; snipe.fired = false; snipe.attempts = 0; snipe.rafaleCount = 0; snipe.everLed = false; snipe.armed = false;
            try { localStorage.removeItem(SNIPE_ENDTIME_KEY); } catch (e) {} // cache périmé
            try { localStorage.removeItem(SNIPE_NOTIF_KEY); } catch (e) {}
            clearTimeout(snipeCoarseTimer);
            if (snipeWorker) { snipeWorker.terminate(); snipeWorker = null; }
            stopRafale();
            // Désarmement automatique en fin de vente : il faut ré-armer
            // volontairement pour la suivante. Évite les notifs programmées et
            // les tirs sur un objet qui ne t'intéresse pas.
            localStorage.setItem(SNIPE_ARMED_KEY, '0');
            const cbEnd = document.getElementById('ogs-snipe-cb');
            if (cbEnd) cbEnd.checked = false;
            if (snipeWatchdogTimer) { clearInterval(snipeWatchdogTimer); snipeWatchdogTimer = null; }
            updateSnipeDisplay();
        });
        snipe.hooked = true;
        console.log('[OGS] socket auctioneer hookée');
        return true;
    }
    // Watchdog permanent : la socket peut être DÉCONNECTÉE au chargement ou
    // tomber en cours. Comme 'timeLeft' n'arrive que ~toutes les 60 s, hooker
    // une socket morte = ne jamais recevoir endTime et ne jamais s'armer.
    // On relance la connexion et on re-hooke l'instance courante en continu.
    function snipeConnectionWatchdog() {
        try {
            const a = window.auctioneer;
            if (!a) return;
            if (!a.connected && typeof a.initConnection === 'function') {
                a.initConnection();      // relance si tombée
                snipe.socketDown = true;
            } else {
                snipe.socketDown = false;
            }
            hookAuctioneerSocket();      // idempotent par socket : re-hooke la nouvelle instance
        } catch (e) { /* silencieux */ }
    }
    // Reprise depuis le cache : permet de s'armer SANS attendre la socket
    // (survit à une socket morte au chargement et à un reload de page).
    // Un endTime encore dans le futur identifie de façon unique la vente en
    // cours (deux ventes ne se chevauchent jamais) -> pas besoin d'auctionId.
    function loadCachedEndTime() {
        if (!isAuctionRunning()) { try { localStorage.removeItem(SNIPE_ENDTIME_KEY); } catch (e) {} return; } // cooldown : pas d'armement
        try {
            const ms = parseInt(localStorage.getItem(SNIPE_ENDTIME_KEY), 10);
            if (!ms || isNaN(ms)) return;
            if (ms - (snipe.offset || 0) - Date.now() > 0) {
                snipe.endTime = ms;
                console.log('[OGS] endTime repris du cache =', new Date(ms).toISOString());
                scheduleSnipeFire();          // s'arme immédiatement, socket ou pas
            } else {
                localStorage.removeItem(SNIPE_ENDTIME_KEY); // périmé
            }
        } catch (e) { /* silencieux */ }
    }
    // ---- Montant dynamique ----
    const parseFR = t => parseInt(String(t == null ? '' : t).replace(/[^\d]/g, ''), 10) || 0;
    let _myName = '';
    function detectMyName() {
        if (_myName) return _myName;   // mémorisé une fois trouvé
        let n = '';
        try { if (window.ogame && ogame.playerName) n = ogame.playerName; } catch (e) {}
        if (!n) { const m = document.querySelector('meta[name="ogame-player-name"]'); if (m) n = (m.getAttribute('content') || '').trim(); }
        if (!n) { const el = document.querySelector('#playerName, .playerName'); if (el) n = (el.textContent || '').trim(); }
        if (n) _myName = n;
        return n;
    }
    // Ressource de mise sélectionnée ('metal' par défaut)
    function getSnipeResource() {
        return localStorage.getItem(SNIPE_RESOURCE_KEY) === 'crystal' ? 'crystal' : 'metal';
    }
    // Sélecteur du slider pour une ressource donnée
    const RES_SLIDER = { metal: '.js_sliderMetalInput', crystal: '.js_sliderCrystalInput' };
    // Multiplicateur de valeur d'enchère (métal ×1, cristal ×1.5, deut ×3).
    // Lu dans le DOM ("x 1.5") pour rester exact ; fallback sur les constantes OGame.
    function getResMultiplier(res) {
        const fallback = res === 'crystal' ? 1.5 : 1;
        const inp = document.querySelector(RES_SLIDER[res] || RES_SLIDER.metal);
        let n = inp;
        for (let i = 0; i < 4 && n; i++) {
            const m = (n.textContent || '').match(/x\s*([\d.,]+)/i);
            if (m) { const v = parseFloat(m[1].replace(',', '.')); if (v > 0) return v; }
            n = n.parentElement;
        }
        return fallback;
    }
    // Unités de la ressource choisie à engager pour que le total atteigne le
    // minimum requis. Les champs prix/mise sont en VALEUR d'enchère : on convertit
    // la valeur manquante en unités de ressource via le multiplicateur (÷1.5 cristal).
    function computeBidMetal() {
        const res    = getSnipeResource();
        const mult   = getResMultiplier(res);
        const minReq = parseFR(document.querySelector('.js_price')?.textContent);
        const mine   = parseFR(document.querySelector('.js_alreadyBidden')?.textContent);
        const valueNeeded = Math.max(0, minReq - mine) + getSnipeBump(); // en valeur d'enchère
        let metal = valueNeeded > 0 ? Math.ceil(valueNeeded / mult) : 0;  // en unités de ressource
        if (metal > getSnipeMaxMetal()) metal = -1; // dépasse le plafond (unités)
        return { metal, minReq, mine, res, mult };
    }
    // Engage `amount` unités de la ressource choisie, remet les autres à 0.
    function commitMetal(amount, res) {
        res = res || getSnipeResource();
        const targetSel = RES_SLIDER[res] || RES_SLIDER.metal;
        const el = document.querySelector(targetSel);
        if (!el) return false;
        ['.js_sliderMetalInput', '.js_sliderCrystalInput', '.js_sliderDeuteriumInput', '.js_sliderHonorInput'].forEach(s => {
            if (s === targetSel) return;
            const x = document.querySelector(s);
            if (x) { x.value = 0; x.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        el.value = amount;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('keyup',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        try {
            if (window.traderObj) {
                if (typeof traderObj.updateValuesInputCanged === 'function') traderObj.updateValuesInputCanged();
                else if (typeof traderObj.updateValues === 'function') traderObj.updateValues();
            }
        } catch (e) { console.warn('[OGS] commit slider err', e); }
        return true;
    }
    function sendSnipeBid() {
        // Sécurité : jamais plus de SNIPE_MAX_ATTEMPTS tirs sur une même vente.
        if ((snipe.attempts || 0) >= SNIPE_MAX_ATTEMPTS) return;
        // Ne pas se surenchérir soi-même (= déjà gagné après un tir précédent)
        const me = detectMyName();
        if (me && snipe.winner && snipe.winner === me) {
            console.log('[OGS] en tête (' + me + ') -> pas de (sur)enchère');
            setStatus('Snipe: en tête', 'ok');
            return;
        }
        const { metal, minReq, mine, res, mult } = computeBidMetal();
        const resLabel = res === 'crystal' ? 'cristal' : 'métal';
        if (metal === -1) {
            console.log('[OGS] minimum requis > plafond -> abandon');
            setStatus('Snipe: plafond dépassé', 'error');
            return;
        }
        if (metal <= 0) {
            console.log('[OGS] rien à ajouter');
            setStatus('Snipe: rien à ajouter', 'ok');
            return;
        }
        snipe.attempts = (snipe.attempts || 0) + 1;
        snipe.fired = true;
        commitMetal(metal, res);
        console.log(`[OGS] >>> TIR #${snipe.attempts} | ${resLabel}: ${metal} (x${mult}) | min requis: ${minReq} | ma mise: ${mine} | now serveur ≈ ${new Date(Date.now() + (snipe.offset || 0)).toISOString()}`);
        try {
            // Appel direct : bypass d'un éventuel wrapper de confirmation, le jeu gère le token
            traderObj.submitAuction();
            setStatus(`Mise ${resLabel} #${snipe.attempts}: ${metal}`, 'ok');
        } catch (e) {
            console.warn('[OGS] submitAuction err', e);
            document.querySelector('a.pay')?.click(); // fallback clic natif
            setStatus('Mise envoyée (fallback)', 'ok');
        }
        // ---- RE-TIR une fois ----
        // Après ~1 aller-retour, si on n'est pas en tête (mise refusée, ou doublé dans le
        // même instant) ET qu'il reste assez de marge avant endTime pour qu'une 2e mise
        // arrive à temps, on retente au minimum ACTUALISÉ. Utile sur les objets disputés.
        if (snipe.attempts < SNIPE_MAX_ATTEMPTS) {
            const checkDelay = Math.max(180, (snipe.oneWay || 100) * 2 + 120); // ~RTT + marge pour recevoir le 'new bid'
            setTimeout(() => {
                try {
                    const meNow = detectMyName();
                    const leading = meNow && snipe.winner === meNow;
                    const timeLeftMs = (snipe.endTime || 0) - (snipe.offset || 0) - Date.now();
                    const enough = timeLeftMs > ((snipe.oneWay || 100) + getSnipeMargin() + 60);
                    if (!leading && enough) {
                        console.log('[OGS] pas en tête après tir -> RE-TIR (reste ~' + Math.round(timeLeftMs) + ' ms)');
                        sendSnipeBid();
                    } else if (!leading) {
                        console.log('[OGS] pas en tête mais plus assez de marge pour re-tirer');
                        setStatus('Snipe: doublé (trop tard pour re-tir)', 'error');
                    }
                } catch (e) { console.warn('[OGS] retry err', e); }
            }, checkDelay);
        }
    }
    // ---- Notification ntfy PROGRAMMÉE côté serveur ----
    // Le message part MAINTENANT avec un en-tête 'At' : ntfy ne le délivre qu'à
    // endTime - 2 min. Le navigateur peut donc être fermé entre-temps.
    // Note : ntfy ne permet pas d'annuler un message programmé -> formulation
    // neutre (si tu désarmes ou gagnes avant la fin, la notif partira quand même).
    function scheduleSnipeNotification() {
        if (!isSnipeArmed() || !snipe.endTime) return;
        if (localStorage.getItem(SNIPE_NOTIF_KEY) === String(snipe.endTime)) return; // déjà programmée
        const nowServerMs = Date.now() + (snipe.offset || 0);
        const remainMs = snipe.endTime - nowServerMs;
        // Vente déjà courte : tu es forcément devant l'écran, la notif est inutile.
        if (remainMs < SNIPE_NOTIF_MIN_REMAIN_MS) {
            console.log('[OGS] Notif ignorée : moins de 3 min restantes (' + Math.round(remainMs / 1000) + 's)');
            localStorage.setItem(SNIPE_NOTIF_KEY, String(snipe.endTime)); // ne pas retenter sur cette vente
            return;
        }
        const deliverAtMs = snipe.endTime - SNIPE_NOTIF_LEAD_MS;
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
            method: 'POST',
            headers: {
                'Title': 'OGame - Enchere bientot terminee',
                'Priority': 'high',
                'Tags': 'hourglass',
                'At': String(Math.floor(deliverAtMs / 1000)), // livraison programmée (unix s)
            },
            body: "L'enchère en cours se termine dans ~2 min.",
        })
        .then(() => {
            localStorage.setItem(SNIPE_NOTIF_KEY, String(snipe.endTime));
            console.log('[OGS] Notif programmée pour', new Date(deliverAtMs).toISOString());
        })
        .catch(e => console.error('[OGS] Échec programmation notif', e));
    }
    // ---- Scheduler : gros setTimeout puis Worker haute fréquence ----
    // ---- Mode RAFALE : sur les N dernières secondes, remonter le prix de +bump/s ----
    // But : forcer les concurrents à recliquer au-dessus chaque seconde (harcèlement).
    // Mise même si on est déjà en tête (on monte son propre prix). Respecte maxMetal.
    // Le tir de précision de fin garde le relais (cf. scheduleSnipeFire).
    function stopRafale() {
        if (snipeRafaleStartTimer) { clearTimeout(snipeRafaleStartTimer); snipeRafaleStartTimer = null; }
        if (snipeRafaleInterval) { clearInterval(snipeRafaleInterval); snipeRafaleInterval = null; }
    }
    function sendRafaleBid() {
        try {
            const res    = getSnipeResource();
            const mult   = getResMultiplier(res);
            const minReq = parseFR(document.querySelector('.js_price')?.textContent);
            const mine   = parseFR(document.querySelector('.js_alreadyBidden')?.textContent);
            const valueNeeded = Math.max(0, minReq - mine) + getRafaleBump(); // en valeur d'enchère
            if (valueNeeded <= 0) return;
            let metal = Math.ceil(valueNeeded / mult); // en unités de ressource
            // Plafond : valeur cumulée projetée (mine + valeur engagée) ne dépasse pas le plafond
            if (mine + metal * mult > getSnipeMaxMetal()) { console.log('[OGS] rafale stop (plafond atteint)'); stopRafale(); return; }
            commitMetal(metal, res);
            traderObj.submitAuction();
            snipe.rafaleCount = (snipe.rafaleCount || 0) + 1;
            const resLabel = res === 'crystal' ? 'cristal' : 'métal';
            console.log('[OGS] rafale #' + snipe.rafaleCount + ' +' + metal.toLocaleString('fr') + ' ' + resLabel + ' (x' + mult + ')');
        } catch (e) { console.warn('[OGS] rafale err', e); }
    }
    function scheduleRafale() {
        stopRafale();
        if (!isRafaleOn()) return;
        if (snipe.endTime == null || snipe.offset == null) return;
        const startClient = snipe.endTime - snipe.offset - getRafaleWindowMs();
        // On arrête la rafale juste avant le tir de précision (250 ms de buffer) pour ne pas
        // envoyer deux mises en même temps. Marche aussi pour une petite fenêtre (1-2 s).
        const stopClient  = snipe.endTime - snipe.offset - snipe.oneWay - getSnipeMargin() - 250;
        const interval = getRafaleInterval();
        snipeRafaleStartTimer = setTimeout(() => {
            console.log('[OGS] RAFALE démarrée (+' + getRafaleBump().toLocaleString('fr') + ' métal toutes les ' + interval + ' ms)');
            sendRafaleBid();
            snipeRafaleInterval = setInterval(() => {
                if (Date.now() >= stopClient) { stopRafale(); console.log('[OGS] rafale terminée -> tir de précision'); return; }
                sendRafaleBid();
            }, interval);
        }, Math.max(0, startClient - Date.now()));
    }
    function scheduleSnipeFire() {
        if (!isSnipeArmed()) return;
        if (snipe.endTime == null || snipe.offset == null) return;
        if (snipe.armed) return;
        const fireClient = snipe.endTime - snipe.offset - snipe.oneWay - getSnipeMargin();
        const dt = fireClient - Date.now();
        if (dt < -2000) { console.log('[OGS] trop tard pour cette vente'); return; }
        snipe.armed = true;
        scheduleSnipeNotification();   // programme la notif ntfy (T-2min) si vente > 3 min
        scheduleRafale();              // programme la rafale (10 dernières s) si activée
        updateSnipeDisplay();
        console.log('[OGS] armé — tir dans', Math.round(dt / 1000), 's (client)');
        clearTimeout(snipeCoarseTimer);
        const coarseWait = Math.max(0, dt - SNIPE_TIGHT_WINDOW_MS);
        snipeCoarseTimer = setTimeout(() => startSnipeTightLoop(fireClient), coarseWait);
    }
    function startSnipeTightLoop(fireClient) {
        if (snipeWorker) { snipeWorker.terminate(); snipeWorker = null; }
        const plannedEnd = snipe.endTime;   // échéance visée au démarrage de la boucle
        // Si endTime a bougé entre-temps (prolongation anti-snipe), on ne tire pas :
        // on abandonne cette boucle et on replanifie sur la nouvelle échéance.
        const endChanged = () => snipe.endTime !== plannedEnd;
        try {
            const blob = new Blob([
                "let on=false;onmessage=e=>{if(e.data==='go'){on=true;(function l(){if(!on)return;postMessage(1);setTimeout(l,4);})();}else if(e.data==='stop'){on=false;}}"
            ], { type: 'application/javascript' });
            snipeWorker = new Worker(URL.createObjectURL(blob));
            snipeWorker.onmessage = () => {
                if (endChanged()) {
                    snipeWorker.postMessage('stop');
                    snipeWorker.terminate(); snipeWorker = null;
                    console.log('[OGS] échéance modifiée -> replanification (pas de tir)');
                    scheduleSnipeFire();
                    return;
                }
                if (Date.now() >= fireClient) {
                    snipeWorker.postMessage('stop');
                    snipeWorker.terminate(); snipeWorker = null;
                    sendSnipeBid();
                }
            };
            snipeWorker.postMessage('go');
            console.log('[OGS] fenêtre finale : boucle haute fréquence active');
        } catch (e) {
            // Fallback si les Workers/blob sont bloqués (CSP)
            console.warn('[OGS] Worker indisponible, fallback setTimeout', e);
            const tick = () => {
                if (endChanged()) { console.log('[OGS] échéance modifiée -> replanification (pas de tir)'); scheduleSnipeFire(); return; }
                if (Date.now() >= fireClient) sendSnipeBid();
                else setTimeout(tick, 4);
            };
            tick();
        }
    }
    // ---- Init / UI ----
    let snipeWatchdogTimer = null;
    function initSnipeIfNeeded() {
        if (!isSnipeArmed()) return;
        if (!isAuctioneerPage()) return;
        if (snipe.offset == null) measureSnipeOffset().then(loadCachedEndTime);
        else loadCachedEndTime();
        hookAuctioneerSocket();
        // Watchdog permanent (et non un retry limité) : garde la socket vivante
        // et re-hooke l'instance courante quoi qu'il arrive.
        if (!snipeWatchdogTimer) {
            snipeWatchdogTimer = setInterval(snipeConnectionWatchdog, 2500);
        }
    }
    function fmtCountdown(sec) {
        if (sec < 0) sec = 0;
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
    }
    function updateSnipeDisplay() {
        const st = document.getElementById('ogs-snipe-status');
        const info = document.getElementById('ogs-snipe-info');
        if (!st) return;
        // Le lecteur (hero) n'apparaît que lorsqu'il y a une donnée à afficher :
        // masqué si sniper non armé, ou hors page sans compte à rebours en cache.
        const hero = document.getElementById('ogs-hero');
        const setHero = (on) => { if (hero) hero.style.display = on ? '' : 'none'; };
        if (!isSnipeArmed()) { setHero(false); st.textContent = '--'; st.style.color = '#5a7290'; if (info) info.textContent = ''; return; }
        // Hors de la page enchères : on ne peut pas tirer, mais on affiche quand même
        // le compte à rebours depuis le cache (endTime + offset partagés) pour info.
        if (!isAuctioneerPage()) {
            const et = parseInt(localStorage.getItem(SNIPE_ENDTIME_KEY), 10);
            const off = parseInt(localStorage.getItem(SNIPE_OFFSET_KEY), 10) || 0;
            const leftMs = et ? et - off - Date.now() : NaN;
            if (et && leftMs > 0) {
                setHero(true);
                const s = Math.round(leftMs / 1000);
                st.textContent = fmtCountdown(s) + ' ⌛';   // ⌛ = suivi seul (le tir n'est possible que sur la page enchères)
                st.style.color = s <= 15 ? '#ff5c5c' : '#8fb0c8';
                if (info) info.innerHTML = '<span style="color:#8a9">enchère en cours — ouvre la page Commissaire-priseur pour tirer</span>';
            } else {
                setHero(false);   // "hors page" sans donnée : lecteur masqué
                st.textContent = 'hors page'; st.style.color = '#e0a94a'; if (info) info.textContent = '';
            }
            return;
        }
        setHero(true);
        // État socket : c'est LE point critique. Une socket HS = jamais d'endTime
        // = sniper qui ne s'arme jamais (cause de vente ratée).
        const connected = !!(window.auctioneer && window.auctioneer.connected);
        if (!connected) {
            st.textContent = '⚠ socket HS';
            st.style.color = '#ff5c5c';
            if (info) info.innerHTML = '<span style="color:#ff5c5c">reconnexion en cours…</span>';
            return;
        }
        if (snipe.endTime && snipe.offset != null) {
            const leftMs = snipe.endTime - snipe.offset - Date.now();
            const s = Math.max(0, Math.round(leftMs / 1000));
            st.textContent = fmtCountdown(s) + (snipe.armed ? ' 💥' : '');
            st.style.color = s <= 15 ? '#ff5c5c' : '#7fd98a';
        } else {
            st.textContent = 'attente endTime';
            st.style.color = '#e0a94a';
        }
        if (info) {
            const minReq = parseFR(document.querySelector('.js_price')?.textContent);
            const mine   = parseFR(document.querySelector('.js_alreadyBidden')?.textContent);
            const m = Math.max(0, minReq - mine) + getSnipeBump();
            const over = m > getSnipeMaxMetal();
            const off = snipe.offset != null ? `${snipe.offset >= 0 ? '+' : ''}${snipe.offset}ms` : '?';
            info.innerHTML =
                `offset ${off} · mise <b style="color:${over ? '#ff5c5c' : '#7fd98a'}">${m.toLocaleString('fr')}</b>` +
                (snipe.winner ? `<br>en tête : ${snipe.winner}` : '');
        }
    }
    // Grise/désactive tous les réglages du sniper quand il n'est pas armé.
    function updateSnipeArmedUI() {
        const body = document.getElementById('ogs-snipe-body');
        if (body) body.classList.toggle('ogs-disabled', !isSnipeArmed());
    }
    function toggleSnipe() {
        const cb = document.getElementById('ogs-snipe-cb');
        if (cb.checked) {
            localStorage.setItem(SNIPE_ARMED_KEY, '1');
            snipe.fired = false; snipe.attempts = 0; snipe.armed = false;
            initSnipeIfNeeded();
            setStatus('Sniper armé', 'ok');
        } else {
            localStorage.setItem(SNIPE_ARMED_KEY, '0');
            clearTimeout(snipeCoarseTimer);
            if (snipeWorker) { snipeWorker.terminate(); snipeWorker = null; }
            stopRafale();
            if (snipeWatchdogTimer) { clearInterval(snipeWatchdogTimer); snipeWatchdogTimer = null; }
            snipe.armed = false;
            setStatus('Sniper désarmé', 'ok');
        }
        updateSnipeArmedUI();
        updateSnipeDisplay();
    }
    // ============================================================
    // RAID TIMÉ — envoi de flotte pour IMPACT à une heure précise
    // départ = impact − durée_vol ; clic #sendFleet calé à la seconde près
    // via l'offset horloge (même mécanique que le sniper).
    // À armer depuis la page Flotte étape 3 (bouton "Envoyer la flotte").
    // NB : l'heure d'impact est interprétée dans le fuseau du navigateur
    // (identique au serveur pour un compte FR sur s282-fr).
    // ============================================================
    const raid = { armed: false, fireAt: null, impactMs: null, durationSec: null, coarse: null, worker: null };
    const RAID_MISSIONS = { 1: 'Attaque', 2: 'Attaque (ACS)', 3: 'Transport', 4: 'Stationner', 5: 'Défendre', 6: 'Espionnage', 7: 'Coloniser', 8: 'Recyclage', 9: 'Détruire', 15: 'Expédition' };
    function getRaidMargin() {
        let v = parseInt(localStorage.getItem(RAID_MARGIN_KEY), 10);
        if (isNaN(v) || v < 0) v = DEFAULT_RAID_MARGIN_MS;
        return v;
    }
    function fmtDur(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    // Lit la flotte prête à partir (étape 3). null si pas prêt.
    function readRaidFleet() {
        const fd = window.fleetDispatcher;
        const sendBtn = document.querySelector('#sendFleet');
        // offsetParent : le bouton doit être VISIBLE (étape 3), sinon on peut
        // armer depuis l'étape 1 avec une durée fausse.
        if (!fd || !sendBtn || sendBtn.offsetParent === null) return null;
        let dur = 0;
        try { dur = fd.getDuration(); } catch (e) {}
        if (!dur || dur <= 0) return null;
        const tp = fd.targetPlanet || {};
        const coords = (tp.galaxy != null) ? (tp.galaxy + ':' + tp.system + ':' + tp.position) : '?';
        const typeLabel = tp.type === 3 ? 'lune' : (tp.type === 2 ? 'CDR' : 'planète');
        return { durationSec: Math.round(dur), coords, type: typeLabel, mission: fd.mission, missionName: RAID_MISSIONS[fd.mission] || ('#' + fd.mission) };
    }
    function raidNextOccurrence(hh, mm, ss, dateStr) {
        const now = new Date();
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr || '');
        if (dm) return new Date(+dm[1], +dm[2] - 1, +dm[3], hh, mm, ss, 0);
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, ss, 0);
        if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
        return d;
    }
    function updateRaidDisplay() {
        const info = document.getElementById('ogs-raid-info');
        const active = document.getElementById('ogs-raid-active');
        if (!info) return;
        // ---- Bloc "en cours" sous le bouton Armer ----
        if (active) {
            if (raid.armed) {
                const nowC = Date.now();
                const toFire = raid.fireAt - nowC;
                const toImpact = raid.impactMs - (snipe.offset || 0) - nowC;
                const impactStr = new Date(raid.impactMs).toLocaleTimeString('fr-FR');
                active.style.display = 'block';
                active.innerHTML =
                    '<div style="color:#8ad6ff;font-weight:600">' + (raid.isGhost ? '👻 GHOST ARMÉ' : '🎯 RAID ARMÉ') + '</div>' +
                    (raid.coords ? '<div>Cible : <b style="color:#a6cbee">' + raid.coords + '</b>' + (raid.typeLabel ? ' (' + raid.typeLabel + ')' : '') + ' · <b style="color:#a6cbee">' + (raid.missionName || '') + '</b></div>' : '') +
                    '<div>' + (raid.isGhost ? 'Retour' : 'Impact') + ' : <b style="color:#f0b24a">' + impactStr + '</b> (dans ' + fmtDur(toImpact / 1000) + ')</div>' +
                    '<div>Envoi dans <b style="color:#7fd98a">' + fmtDur(toFire / 1000) + '</b> · vol ' + fmtDur(raid.durationSec) + '</div>' +
                    (raid.consumption ? '<div>Conso : <b style="color:#e0a94a">' + Number(raid.consumption).toLocaleString('fr') + '</b> deutérium</div>' : '');
            } else {
                active.style.display = 'none';
                active.innerHTML = '';
            }
        }
        if (raid.armed) { info.innerHTML = ''; return; }
        const f = readRaidFleet();
        if (!f) {
            info.innerHTML = getRaidMode() === 'auto'
                ? '<span style="color:#9fb2c8">Mode auto : configure cible + vaisseaux ci-dessous, depuis la page Flotte (étape 1).</span>'
                : '<span style="color:#e0a94a">Prépare la flotte sur Flotte → étape 3 (bouton « Envoyer la flotte ») pour armer.</span>';
            return;
        }
        info.innerHTML =
            '<div>Cible : <b style="color:#a6cbee">' + f.coords + '</b> (' + f.type + ')</div>' +
            '<div>Mission : <b style="color:#a6cbee">' + f.missionName + '</b> · aller ' + fmtDur(f.durationSec) + '</div>';
    }
    // Notif "Checker le raid" 3 min avant impact — programmée côté ntfy ('At'),
    // donc délivrée même navigateur fermé. Annulée si on désarme.
    function scheduleRaidNotification(msg) {
        msg = msg || 'Checker le raid';
        const leadMs = 3 * 60 * 1000;
        const deliverAtMs = raid.impactMs - leadMs;
        if (deliverAtMs - Date.now() < 15000) { console.log('[OGS] notif raid ignorée (impact < ~3 min)'); return; }
        fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
            method: 'POST',
            headers: { 'Title': 'OGSentinel', 'Priority': 'high', 'Tags': 'crossed_swords', 'At': String(Math.floor(deliverAtMs / 1000)) },
            body: msg,
        })
        .then(r => r.json()).then(j => {
            raid.notifId = j && j.id;
            console.log('[OGS] notif raid programmée (T-3min)', new Date(deliverAtMs).toISOString());
            [400, 1500, 3000].forEach(d => setTimeout(updateScheduledList, d));
        })
        .catch(e => console.warn('[OGS] échec notif raid', e));
    }
    function cancelRaidNotification() {
        if (!raid.notifId) return;
        const id = raid.notifId; raid.notifId = null;
        fetch(`https://ntfy.sh/${NTFY_TOPIC}/${id}`, { method: 'DELETE' })
            .then(() => { console.log('[OGS] notif raid annulée'); updateScheduledList(); })
            .catch(() => {});
    }
    function disarmRaid(reason) {
        raid.armed = false; raid.fireAt = null; raid.impactMs = null; raid.durationSec = null; raid.isGhost = false; raid.consumption = null;
        cancelRaidNotification();
        if (raid.coarse) { clearTimeout(raid.coarse); raid.coarse = null; }
        if (raid.worker) { try { raid.worker.terminate(); } catch (e) {} raid.worker = null; }
        const btn = document.getElementById('ogs-raid-go');
        if (btn) { btn.textContent = '🎯 Armer le raid'; btn.classList.remove('ogs-btn-stop'); }
        if (reason) setStatus(reason, 'ok');
        updateRaidDisplay();
    }
    function fireRaid() {
        const sendBtn = document.querySelector('#sendFleet');
        raid.armed = false; raid.worker = null; raid.coarse = null;
        const btn = document.getElementById('ogs-raid-go');
        if (btn) { btn.textContent = '🎯 Armer le raid'; btn.classList.remove('ogs-btn-stop'); }
        if (!sendBtn) { setStatus('Raid : bouton Envoyer introuvable', 'error'); updateRaidDisplay(); return; }
        console.log('[OGS] >>> RAID ENVOI | impact visé', new Date(raid.impactMs).toISOString(), '| now serveur ≈', new Date(Date.now() + (snipe.offset || 0)).toISOString());
        try { sendBtn.click(); setStatus('Raid : flotte envoyée', 'ok'); }
        catch (e) { console.warn('[OGS] raid send err', e); setStatus('Raid : échec envoi', 'error'); }
        updateRaidDisplay();
    }
    function raidTightLoop() {
        if (raid.worker) { try { raid.worker.terminate(); } catch (e) {} raid.worker = null; }
        const fireAt = raid.fireAt;
        try {
            const blob = new Blob(["let on=false;onmessage=e=>{if(e.data==='go'){on=true;(function l(){if(!on)return;postMessage(1);setTimeout(l,4);})();}else if(e.data==='stop'){on=false;}}"], { type: 'application/javascript' });
            raid.worker = new Worker(URL.createObjectURL(blob));
            raid.worker.onmessage = () => {
                if (!raid.armed) { try { raid.worker.postMessage('stop'); raid.worker.terminate(); } catch (e) {} raid.worker = null; return; }
                if (Date.now() >= fireAt) { try { raid.worker.postMessage('stop'); raid.worker.terminate(); } catch (e) {} raid.worker = null; fireRaid(); }
            };
            raid.worker.postMessage('go');
            console.log('[OGS] raid : boucle haute fréquence active');
        } catch (e) {
            const tick = () => { if (!raid.armed) return; if (Date.now() >= fireAt) fireRaid(); else setTimeout(tick, 4); };
            tick();
        }
    }
    // ---- Mode & config du raid auto ----
    function getRaidMode() { return localStorage.getItem(RAID_MODE_KEY) === 'auto' ? 'auto' : 'manual'; }
    function getRaidAutoCfg() {
        try { return JSON.parse(localStorage.getItem(RAID_AUTO_KEY)) || {}; } catch (e) { return {}; }
    }
    function saveRaidAutoCfg(cfg) { localStorage.setItem(RAID_AUTO_KEY, JSON.stringify(cfg)); }
    function readRaidAutoCfgFromUI() {
        const num = id => { const el = document.getElementById(id); return el ? parseInt(el.value, 10) : NaN; };
        const cfg = {
            g: num('ogs-raid-g'), s: num('ogs-raid-s'), p: num('ogs-raid-p'),
            type: num('ogs-raid-type'), mission: num('ogs-raid-mission'), speed: num('ogs-raid-speed'),
            ships: {}
        };
        document.querySelectorAll('.ogs-raid-ship-n').forEach(inp => {
            const id = parseInt(inp.dataset.shipId, 10);
            const raw = (inp.value || '').trim().toLowerCase();
            if (!raw || raw === '0') return;
            cfg.ships[id] = (raw === 'max' || raw === 'm') ? 'max' : (parseInt(raw, 10) || 0);
        });
        return cfg;
    }
    function applyRaidAutoCfgToUI() {
        const cfg = getRaidAutoCfg();
        const set = (id, v) => { const el = document.getElementById(id); if (el && v != null && !isNaN(v)) el.value = v; };
        set('ogs-raid-g', cfg.g); set('ogs-raid-s', cfg.s); set('ogs-raid-p', cfg.p);
        set('ogs-raid-type', cfg.type); set('ogs-raid-mission', cfg.mission); set('ogs-raid-speed', cfg.speed);
        document.querySelectorAll('.ogs-raid-ship-n').forEach(inp => {
            const id = parseInt(inp.dataset.shipId, 10);
            const v = cfg.ships && cfg.ships[id];
            inp.value = (v === 'max') ? 'max' : (v || '');
        });
    }
    // Prépare la flotte automatiquement : vaisseaux -> Continuer -> cible +
    // mission + vitesse sur l'écran d'envoi. Retourne true si #sendFleet est
    // prêt avec une config valide.
    async function prepareRaidAuto(cfg) {
        const fd = window.fleetDispatcher;
        if (!fd) { setStatus('Raid auto : fleetDispatcher absent', 'error'); return false; }
        if (!document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]')) {
            setStatus('Raid auto : va sur la page Flotte (étape 1)', 'error'); return false;
        }
        if (isNaN(cfg.g) || isNaN(cfg.s) || isNaN(cfg.p)) { setStatus('Raid auto : coordonnées invalides', 'error'); return false; }
        const shipIds = Object.keys(cfg.ships || {});
        if (!shipIds.length) { setStatus('Raid auto : aucun vaisseau', 'error'); return false; }
        // 1) Sélection des vaisseaux — étalée un par un, rythme humain
        await maybeHesitate();                      // parfois on "réfléchit" avant de cliquer
        try { fd.resetShips(); } catch (e) {}
        await sleep(humanMs(300, 700));
        const onPlanet = {};
        (fd.shipsOnPlanet || []).forEach(sh => { onPlanet[sh.id] = sh.number; });
        let selCount = 0;
        for (const idStr of shipIds) {
            const id = parseInt(idStr, 10);
            const want = cfg.ships[idStr];
            const avail = onPlanet[id] || 0;
            if (avail <= 0) continue;
            const n = (want === 'max') ? avail : Math.min(want, avail);
            if (n <= 0) continue;
            try { fd.selectShip(id, n); selCount++; } catch (e) { console.warn('[OGS] raid selectShip', id, e); }
            try { fd.refresh && fd.refresh(); } catch (e) {}   // l'UI suit chaque sélection, comme un clic
            await sleep(humanMs(350, 900));         // délai naturel entre deux types de vaisseaux
        }
        if (!selCount) { setStatus('Raid auto : vaisseaux indisponibles', 'error'); return false; }
        await sleep(humanMs(400, 900));
        // 2) Continuer -> écran d'envoi
        const cont = document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]');
        if (!cont) { setStatus('Raid auto : bouton Continuer introuvable', 'error'); return false; }
        cont.click();
        const sendBtn = await waitFor('#sendFleet', 8000);
        if (!sendBtn) { setStatus('Raid auto : écran d\'envoi non chargé', 'error'); return false; }
        await sleep(humanMs(600, 1300));            // le temps de "lire" l'écran d'envoi
        // 3) Cible + type — via les VRAIS champs du formulaire (le jeu les relit)
        try {
            const gi = document.getElementById('galaxy'), si = document.getElementById('system'), pi = document.getElementById('position');
            if (gi) fillInput(gi, cfg.g);
            await sleep(humanMs(200, 450));
            if (si) fillInput(si, cfg.s);
            await sleep(humanMs(200, 450));
            if (pi) fillInput(pi, cfg.p);
            fd.targetPlanet.galaxy = cfg.g; fd.targetPlanet.system = cfg.s; fd.targetPlanet.position = cfg.p;
            fd.targetPlanet.type = cfg.type || 1;   // 1 planète, 2 CDR, 3 lune
            clickTargetTypeBtn(cfg.type || 1);
            fd.updateTarget();
        } catch (e) { setStatus('Raid auto : cible refusée', 'error'); return false; }
        await sleep(900 + humanMs(200, 600)); // laisse le serveur valider la cible (fetchTargetPlayerData)
        // 4) Mission + vitesse
        await maybeHesitate(0.12);
        try { fd.selectMission(cfg.mission || 1); } catch (e) {}
        if (fd.mission !== (cfg.mission || 1)) {
            setStatus('Raid auto : mission indisponible sur cette cible', 'error'); return false;
        }
        await sleep(humanMs(300, 700));
        await applySpeedStep(cfg.speed || 100);
        await sleep(humanMs(400, 800));
        if (typeof fd.hasValidTarget === 'function') {
            let ok = false; try { ok = fd.hasValidTarget(); } catch (e) {}
            if (!ok) { setStatus('Raid auto : cible invalide', 'error'); return false; }
        }
        await sleep(400);
        if (isMissionBlocked()) { setStatus('Raid auto : mission refusée par le jeu', 'error'); return false; }
        return true;
    }
    async function armRaid(hhmmss, dateStr) {
        if (raid.armed) { disarmRaid('Raid désarmé'); return; }
        // Mode AUTO : préparer la flotte d'abord (vaisseaux + cible + mission + vitesse)
        if (getRaidMode() === 'auto') {
            const cfg = readRaidAutoCfgFromUI();
            saveRaidAutoCfg(cfg);
            setStatus('Raid auto : préparation…', 'busy');
            const okPrep = await prepareRaidAuto(cfg);
            if (!okPrep) return;
        }
        const f = readRaidFleet();
        if (!f) { setStatus('Raid : va sur Flotte étape 3', 'error'); return; }
        const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmmss || '');
        if (!tm) { setStatus('Raid : heure invalide (HH:MM:SS)', 'error'); return; }
        const hh = +tm[1], mm = +tm[2], ss = tm[3] != null ? +tm[3] : 0;
        if (hh > 23 || mm > 59 || ss > 59) { setStatus('Raid : heure invalide', 'error'); return; }
        setStatus('Raid : mesure offset…', 'busy');
        if (snipe.offset == null) { try { await measureSnipeOffset(); } catch (e) {} }
        if (snipe.offset == null) { setStatus('Raid : offset non mesuré', 'error'); return; }
        // Relit la flotte au cas où elle aurait bougé pendant la mesure
        const f2 = readRaidFleet() || f;
        const impact = raidNextOccurrence(hh, mm, ss, dateStr);
        const impactMs = impact.getTime();                     // timestamp SERVEUR de l'impact voulu
        const departServerMs = impactMs - f2.durationSec * 1000;
        const cushion = getRaidMargin();                       // ms dans la seconde de départ (biais tardif, jamais tôt)
        const fireClient = departServerMs + cushion - snipe.offset - (snipe.oneWay || 100);
        const dt = fireClient - Date.now();
        if (dt < -1500) { setStatus('Raid : trop tard (accélère la flotte ou décale l\'heure)', 'error'); return; }
        raid.armed = true; raid.fireAt = fireClient; raid.impactMs = impactMs; raid.durationSec = f2.durationSec;
        raid.coords = f2.coords; raid.typeLabel = f2.type; raid.missionName = f2.missionName; // pour l'affichage "en cours"
        try { raid.consumption = fleetDispatcher.getConsumption(); } catch (e) { raid.consumption = null; }
        scheduleRaidNotification();   // "Checker le raid" à impact - 3 min (via ntfy 'At')
        const btn = document.getElementById('ogs-raid-go');
        if (btn) { btn.textContent = '⏹ Désarmer le raid'; btn.classList.add('ogs-btn-stop'); }
        console.log('[OGS] RAID armé | impact', impact.toISOString(), '| départ serveur', new Date(departServerMs).toISOString(), '| envoi dans', Math.round(dt / 1000), 's | durée', f2.durationSec, 's');
        setStatus('Raid armé : impact ' + impact.toLocaleTimeString('fr-FR'), 'ok');
        updateRaidDisplay();
        const coarseWait = Math.max(0, dt - 2500);
        raid.coarse = setTimeout(raidTightLoop, coarseWait);
    }
    // ============================================================
    // DÉCALAGE SONDE (ACS) — retarder l'impact d'une attaque groupée en
    // faisant rejoindre 1 sonde dont l'ARRIVÉE = nouvelle heure d'impact.
    // arrivée = départ + durée(vitesse) -> départ timé à la seconde.
    // Option : espionnage (N sondes) timé pour arriver à l'impact INITIAL.
    // Structures validées en live : fd.unions = [{id, time (unix s = impact),
    // name, targetName, galaxy, system, position, planetType}], et le
    // dropdown #aksbox (value "g#s#p#type#nom#id") dont l'événement change
    // règle mission=2 + cible + union.
    // ============================================================
    function listUnions() {
        try { return (window.fleetDispatcher && fleetDispatcher.unions) || []; } catch (e) { return []; }
    }
    // ---- Durée de vol initiale du groupe (F) via la page Mouvements ----
    // Pour une attaque (pas de maintien) : retour = arrivée + F  =>  F = R - A.
    // Impact max autorisé = A + 30 % de F. Lu nativement : data-arrival-time
    // (unix) + .nextabsTime (heure de retour) sur la ligne de flotte du groupe.
    const _unionFlightCache = {};   // unionId -> {flightSec, maxImpactMs} | 'pending' | 'none'
    function fetchUnionFlightInfo(u) {
        if (!u) return;
        const c = _unionFlightCache[u.id];
        if (c === 'pending' || (c && c.maxImpactMs)) return;
        _unionFlightCache[u.id] = 'pending';
        fetch(location.pathname + '?page=ingame&component=movement', { credentials: 'same-origin' })
            .then(r => r.text())
            .then(htmlTxt => {
                const doc = new DOMParser().parseFromString(htmlTxt, 'text/html');
                let best = null;
                doc.querySelectorAll('.fleetDetails').forEach(row => {
                    const an = row.querySelector('.allianceName');
                    if (!an || (an.textContent || '').trim() !== (u.name || '').trim()) return;
                    const A = parseInt(row.getAttribute('data-arrival-time'), 10);
                    if (!A || Math.abs(A - u.time) > 3) return;   // même échéance que l'union
                    const rt = row.querySelector('.nextabsTime');
                    const m = rt && /(\d{1,2}):(\d{2}):(\d{2})/.exec(rt.textContent || '');
                    if (!m) return;
                    const R = new Date(A * 1000);
                    R.setHours(+m[1], +m[2], +m[3], 0);
                    let Rms = R.getTime();
                    if (Rms < A * 1000) Rms += 86400000;          // retour après minuit
                    const F = Math.round(Rms / 1000) - A;
                    if (F > 0) best = { flightSec: F, maxImpactMs: A * 1000 + Math.floor(0.3 * F) * 1000 };
                });
                _unionFlightCache[u.id] = best || 'none';
                if (best) console.log('[OGS] union', u.id, '| vol initial', fmtDur(best.flightSec), '| impact max', new Date(best.maxImpactMs).toLocaleTimeString('fr-FR'));
                refreshDecaUnions(true);
            })
            .catch(() => { _unionFlightCache[u.id] = 'none'; });
    }
    function getUnionMaxImpactMs(u) {
        const c = u && _unionFlightCache[u.id];
        return (c && c.maxImpactMs) ? c.maxImpactMs : null;
    }
    let _decaUnionsSig = '';
    function refreshDecaUnions() {
        const sel = document.getElementById('ogs-deca-union');
        const info = document.getElementById('ogs-deca-info');
        if (!sel) return;
        const unions = listUnions();
        const sig = unions.map(u => u.id + ':' + u.time).join(',');
        if (sig !== _decaUnionsSig) {
            _decaUnionsSig = sig;
            sel.innerHTML = unions.length
                ? unions.map(u => '<option value="' + u.id + '">' + escapeHtml(u.name || ('ACS ' + u.id)) + ' → ' + escapeHtml(u.targetName || '') + '</option>').join('')
                : '<option value="">(aucun groupe)</option>';
        }
        if (info) {
            const u = unions.find(x => String(x.id) === sel.value) || unions[0];
            if (u) {
                const t0 = new Date(u.time * 1000);
                fetchUnionFlightInfo(u);   // async, remplit le cache puis re-rend
                const maxMs = getUnionMaxImpactMs(u);
                const c = _unionFlightCache[u.id];
                let maxLine;
                if (maxMs) {
                    const maxDelaySec = Math.max(0, Math.round((maxMs - u.time * 1000) / 1000));
                    maxLine = 'Décalage max : <b style="color:#8ad6ff">+' + fmtDur(maxDelaySec) + '</b> → impact max <b style="color:#e87e7e">' + new Date(maxMs).toLocaleTimeString('fr-FR') + '</b>';
                } else if (c === 'pending' || c === undefined) {
                    maxLine = '<span style="color:#647c96">Impact max : calcul…</span>';
                } else {
                    maxLine = '<span style="color:#647c96">Impact max : +30 % du vol initial (contrôlé par le jeu)</span>';
                }
                info.innerHTML = 'Impact initial : <b style="color:#f0b24a">' + t0.toLocaleTimeString('fr-FR') + '</b><br>' + maxLine;
            } else {
                info.innerHTML = '<span style="color:#647c96">Aucune attaque groupée en cours.</span>';
            }
        }
    }
    // Choisit la vitesse et l'instant de départ pour que l'ARRIVÉE = targetMs.
    // Balaye 10%..100% (durées lues en live) et prend la vitesse la plus lente
    // dont le départ reste >= minLeadMs dans le futur (envoi au plus tôt).
    async function pickSpeedForArrival(targetMs, minLeadMs) {
        const results = await scanSpeedSteps();       // durées réelles via clics
        for (const r of results) {                    // plus lent d'abord = départ le plus tôt
            const departServerMs = targetMs - r.durSec * 1000;
            const fireClient = departServerMs - (snipe.offset || 0);
            if (fireClient - Date.now() >= minLeadMs) return { ...r, departServerMs };
        }
        return null;
    }
    // ---- Aperçu live : vitesse calculée AVANT l'armement ----
    // Mesure discrète (une fois par groupe/planète) de la table des durées de
    // la sonde vers la cible du groupe : sélectionne 1 sonde + cible, lit les
    // durées 10%..100%, puis restaure tout. Uniquement si rien n'est en cours
    // de préparation sur la page Flotte.
    const _decaDurCache = {};   // clé planète-union -> [{v, durSec}]
    let _decaDurMeasuring = false;
    function decaCacheKey(u) {
        const m = document.querySelector('meta[name="ogame-planet-id"]');
        return ((m && m.getAttribute('content')) || '?') + '-' + u.id;
    }
    async function measureDecaDurations(u) {
        if (!u || _decaDurMeasuring || _decaDurCache[decaCacheKey(u)]) return;
        // Uniquement quand l'onglet Raid est ouvert : pas de manipulation
        // silencieuse de la page Flotte pendant que tu fais autre chose.
        if (!document.querySelector('.ogs-pane[data-pane="raid"].ogs-on')) return;
        const fd = window.fleetDispatcher;
        if (!fd || !isFleetPage()) return;
        if ((fd.shipsToSend || []).length) return;   // l'utilisateur prépare quelque chose : on ne touche pas
        if (!document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]')) return;
        const gIn = document.getElementById('galaxy'), sIn = document.getElementById('system'), pIn = document.getElementById('position');
        if (!gIn || !sIn || !pIn) return;
        _decaDurMeasuring = true;
        ogsBusyOps++;
        try {
            // Ciblage par les VRAIS champs du formulaire (la mutation directe de
            // fd.targetPlanet peut être rétablie par le jeu -> durées fausses).
            const saveT = { g: gIn.value, s: sIn.value, p: pIn.value, type: fd.targetPlanet.type };
            fd.selectShip(210, 1);
            fillInput(gIn, u.galaxy); fillInput(sIn, u.system); fillInput(pIn, u.position);
            clickTargetTypeBtn(u.planetType || 1);
            try { fd.updateTarget(); } catch (e) {}
            await sleep(250);
            // vérification : la cible du dispatcher correspond bien au groupe
            const tp = fd.targetPlanet || {};
            const okTarget = (+tp.galaxy === +u.galaxy && +tp.system === +u.system && +tp.position === +u.position);
            const tbl = okTarget ? await scanSpeedSteps() : [];
            // restauration complète
            try { fd.resetShips(); } catch (e) {}
            fillInput(gIn, saveT.g); fillInput(sIn, saveT.s); fillInput(pIn, saveT.p);
            clickTargetTypeBtn(saveT.type || 1);
            try { fd.updateTarget(); } catch (e) {}
            try { fd.refresh && fd.refresh(); } catch (e) {}
            if (tbl.length) { _decaDurCache[decaCacheKey(u)] = tbl; console.log('[OGS] durées sonde mesurées pour union', u.id, tbl.map(t => t.v + '%:' + t.durSec + 's').join(' ')); }
        } finally { _decaDurMeasuring = false; ogsBusyOps--; }
        updateDecaPreview();
    }
    function parseDecaNewImpact(u) {
        const delayEl = document.getElementById('ogs-deca-delay');
        const s = parseInt((delayEl && delayEl.value) || '', 10);
        if (!u || isNaN(s) || s <= 0) return null;
        return u.time * 1000 + s * 1000;   // nouvel impact = initial + décalage (s)
    }
    function updateDecaPreview() {
        const el = document.getElementById('ogs-deca-preview');
        if (!el) return;
        const sel = document.getElementById('ogs-deca-union');
        const u = listUnions().find(x => String(x.id) === (sel && sel.value)) || listUnions()[0];
        if (!u) { el.innerHTML = ''; return; }
        measureDecaDurations(u);   // async, no-op si déjà en cache
        const newImpactMs = parseDecaNewImpact(u);
        if (!newImpactMs) { el.innerHTML = '<span style="color:#647c96">Saisis le décalage en secondes (fourchette ci-dessus).</span>'; return; }
        const t0Ms = u.time * 1000;
        const delaySec = Math.round((newImpactMs - t0Ms) / 1000);
        const maxMs = getUnionMaxImpactMs(u);
        if (maxMs && newImpactMs > maxMs + 2000) {
            el.innerHTML = '<span style="color:#e87e7e">+' + fmtDur(delaySec) + ' dépasse le max +' + fmtDur(Math.round((maxMs - t0Ms) / 1000)) + ' ✕</span>';
            return;
        }
        const tbl = _decaDurCache[decaCacheKey(u)];
        let speedLine = '<span style="color:#647c96">vitesse : mesure…</span>';
        if (tbl) {
            let pick = null;
            for (const r of tbl) {   // 10% d'abord = départ le plus tôt
                const fireClient = (newImpactMs - r.durSec * 1000) - (snipe.offset || 0);
                if (fireClient - Date.now() >= 15000) { pick = r; break; }
            }
            speedLine = pick
                ? 'vitesse <b style="color:#8ad6ff">' + pick.v + '%</b> · envoi dans <b style="color:#7fd98a">' + fmtDur(((newImpactMs - pick.durSec * 1000) - (snipe.offset || 0) - Date.now()) / 1000) + '</b> · vol ' + fmtDur(pick.durSec)
                : '<span style="color:#e87e7e">trop tard pour cette heure ✕</span>';
        }
        el.innerHTML = 'Nouvel impact : <b style="color:#f0b24a">' + new Date(newImpactMs).toLocaleTimeString('fr-FR') + '</b> (+' + fmtDur(delaySec) + ')' + (maxMs ? ' <span style="color:#7fd98a">✓</span>' : '') + '<br>' + speedLine;
    }
    async function armDeca() {
        if (raid.armed) { setStatus('Décalage : un envoi timé est déjà armé', 'error'); return; }
        const sel = document.getElementById('ogs-deca-union');
        const u = listUnions().find(x => String(x.id) === (sel && sel.value));
        if (!u) { setStatus('Décalage : aucun groupe sélectionné', 'error'); return; }
        const t0Ms = u.time * 1000;                                     // impact initial (serveur)
        const newImpactMs = parseDecaNewImpact(u);                      // initial + décalage saisi (s)
        if (!newImpactMs) { setStatus('Décalage : saisis un nombre de secondes', 'error'); return; }
        // Plafond +30 % (calculé via la page Mouvements : F = retour - arrivée)
        const maxMs = getUnionMaxImpactMs(u);
        if (maxMs && newImpactMs > maxMs + 2000) {
            setStatus('Décalage : dépasse l\'impact max ' + new Date(maxMs).toLocaleTimeString('fr-FR') + ' (+30 %)', 'error');
            return;
        }
        if (!document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]')) {
            setStatus('Décalage : va sur la page Flotte (étape 1)', 'error'); return;
        }
        setStatus('Décalage : mesure offset…', 'busy');
        if (snipe.offset == null) { try { await measureSnipeOffset(); } catch (e) {} }
        if (snipe.offset == null) { setStatus('Décalage : offset non mesuré', 'error'); return; }
        const fd = window.fleetDispatcher;
        // --- préparation façon humaine : 1 sonde -> Continuer -> groupe ---
        await maybeHesitate();
        try { fd.resetShips(); } catch (e) {}
        await sleep(humanMs(300, 700));
        try { fd.selectShip(210, 1); fd.refresh && fd.refresh(); } catch (e) { setStatus('Décalage : sonde indisponible', 'error'); return; }
        await sleep(humanMs(350, 800));
        const cont = document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]');
        if (!cont) { setStatus('Décalage : bouton Continuer introuvable', 'error'); return; }
        cont.click();
        const sendBtn = await waitFor('#sendFleet', 8000);
        if (!sendBtn) { setStatus('Décalage : écran d\'envoi non chargé', 'error'); return; }
        await sleep(humanMs(600, 1200));
        // Sélection du groupe via #aksbox (le change règle mission+cible+union)
        const aks = document.getElementById('aksbox');
        const opt = aks && Array.from(aks.options).find(o => o.value.endsWith('#' + u.id));
        if (!aks || !opt) { setStatus('Décalage : groupe introuvable dans la liste', 'error'); return; }
        aks.value = opt.value;
        aks.dispatchEvent(new Event('change', { bubbles: true }));
        await sleep(humanMs(500, 900));
        if (fd.union !== u.id || fd.mission !== 2) { setStatus('Décalage : sélection du groupe échouée', 'error'); return; }
        // Vitesse + départ pour arriver pile à la nouvelle heure
        const pick = await pickSpeedForArrival(newImpactMs, 15000);
        if (!pick) { setStatus('Décalage : trop tard pour cette heure', 'error'); return; }
        await applySpeedStep(pick.v);
        await sleep(humanMs(300, 600));
        // Garde-fou OGLight : "Time difference / Time remaining" (li.ogl_acsInfo).
        // "too late" à la vitesse choisie = déjà hors limite pour un envoi immédiat ;
        // notre départ étant PLUS TARD, c'est forcément hors +30 % -> abandon.
        try {
            const acs = {};
            document.querySelectorAll('li.ogl_acsInfo').forEach(li => {
                const label = (li.textContent || '').toLowerCase();
                const span = li.querySelector('span');
                const val = span ? (span.textContent || '').trim() : '';
                if (label.includes('difference')) acs.diff = val;
                if (label.includes('remaining')) acs.remaining = val;
                if (span && /ogl_danger/.test(span.className || '')) acs.danger = true;
            });
            if (acs.diff || acs.remaining) console.log('[OGS] OGLight ACS info — difference:', acs.diff, '| remaining:', acs.remaining);
            if (acs.danger || /too ?late/i.test(acs.diff || '') || /too ?late/i.test(acs.remaining || '')) {
                setStatus('Décalage : hors limite ACS (+30 %) — vise plus tôt', 'error');
                return;
            }
        } catch (e) { /* OGLight absent : on s'appuie sur le plafond calculé */ }
        // Espionnage à armer après l'envoi de la sonde (la page recharge)
        const spyCb = document.getElementById('ogs-deca-spy');
        const spyN = parseInt((document.getElementById('ogs-deca-spy-n') || {}).value, 10) || 100;
        if (spyCb && spyCb.checked) {
            localStorage.setItem(DECA_SPY_KEY, JSON.stringify({
                active: true, g: u.galaxy, s: u.system, p: u.position, type: u.planetType || 1,
                count: spyN, impactMs: t0Ms, until: Date.now() + 2 * 3600 * 1000
            }));
        } else { localStorage.removeItem(DECA_SPY_KEY); }
        // Armement du tir timé (réutilise le moteur raid)
        const cushion = getRaidMargin();
        const fireClient = pick.departServerMs + cushion - snipe.offset - (snipe.oneWay || 100);
        raid.armed = true; raid.fireAt = fireClient; raid.impactMs = newImpactMs; raid.durationSec = pick.durSec;
        raid.coords = u.galaxy + ':' + u.system + ':' + u.position; raid.typeLabel = 'ACS';
        raid.missionName = 'Sonde décalage (' + pick.v + '%)';
        try { raid.consumption = fd.getConsumption(); } catch (e) { raid.consumption = null; }
        scheduleRaidNotification();
        const btn = document.getElementById('ogs-deca-go');
        if (btn) { btn.textContent = '⏹ Sonde armée…'; btn.classList.add('ogs-btn-stop'); setTimeout(() => { btn.textContent = '🛰 Décaler l\'impact'; btn.classList.remove('ogs-btn-stop'); }, 4000); }
        console.log('[OGS] DÉCALAGE armé | union', u.id, '| nouvel impact', new Date(newImpactMs).toISOString(), '| vitesse', pick.v + '%', '| départ', new Date(pick.departServerMs).toISOString());
        setStatus('Décalage armé : impact ' + new Date(newImpactMs).toLocaleTimeString('fr-FR'), 'ok');
        updateRaidDisplay();
        raid.coarse = setTimeout(raidTightLoop, Math.max(0, fireClient - Date.now() - 2500));
    }
    // ---- Espionnage post-décalage (reprise après le reload du send) ----
    let decaSpyRunning = false;
    function consumeDecaSpyIfNeeded() {
        let st = null;
        try { st = JSON.parse(localStorage.getItem(DECA_SPY_KEY)); } catch (e) {}
        if (!st || !st.active) return;
        if (Date.now() > (st.until || 0)) { localStorage.removeItem(DECA_SPY_KEY); return; }
        if (!isFleetPage() || raid.armed || decaSpyRunning) return;
        if (!document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]')) return;
        st.active = false; localStorage.setItem(DECA_SPY_KEY, JSON.stringify(st)); // one-shot
        runDecaSpy(st);
    }
    async function runDecaSpy(st) {
        decaSpyRunning = true;
        try {
            const fd = window.fleetDispatcher;
            if (!fd) return;
            setStatus('Espionnage post-décalage : préparation…', 'busy');
            if (snipe.offset == null) { try { await measureSnipeOffset(); } catch (e) {} }
            await sleep(humanMs(800, 1600));
            try { fd.resetShips(); } catch (e) {}
            await sleep(humanMs(300, 600));
            const avail = ((fd.shipsOnPlanet || []).find(sh => sh.id === 210) || {}).number || 0;
            const n = Math.min(st.count || 100, avail);
            if (n <= 0) { setStatus('Espionnage : aucune sonde disponible', 'error'); return; }
            fd.selectShip(210, n);
            try { fd.refresh && fd.refresh(); } catch (e) {}
            await sleep(humanMs(350, 800));
            const cont = document.querySelector('[data-ipi-hint="ipiFleetContinueToPage2"]');
            if (!cont) { setStatus('Espionnage : Continuer introuvable', 'error'); return; }
            cont.click();
            const sendBtn = await waitFor('#sendFleet', 8000);
            if (!sendBtn) { setStatus('Espionnage : écran d\'envoi non chargé', 'error'); return; }
            await sleep(humanMs(600, 1200));
            try {
                const gi = document.getElementById('galaxy'), si = document.getElementById('system'), pi = document.getElementById('position');
                if (gi) fillInput(gi, st.g);
                if (si) fillInput(si, st.s);
                if (pi) fillInput(pi, st.p);
                fd.targetPlanet.galaxy = st.g; fd.targetPlanet.system = st.s; fd.targetPlanet.position = st.p;
                fd.targetPlanet.type = st.type || 1;
                clickTargetTypeBtn(st.type || 1);
                fd.updateTarget();
            } catch (e) { setStatus('Espionnage : cible refusée', 'error'); return; }
            await sleep(900 + humanMs(200, 500));
            try { fd.selectMission(6); } catch (e) {}
            if (fd.mission !== 6) { setStatus('Espionnage : mission indisponible', 'error'); return; }
            await sleep(400);
            if (isMissionBlocked()) { setStatus('Espionnage : mission refusée par le jeu', 'error'); return; }
            const pick = await pickSpeedForArrival(st.impactMs, 12000);
            if (!pick) { setStatus('Espionnage : trop tard pour l\'impact initial', 'error'); return; }
            await applySpeedStep(pick.v);
            await sleep(humanMs(300, 600));
            const cushion = getRaidMargin();
            const fireClient = pick.departServerMs + cushion - snipe.offset - (snipe.oneWay || 100);
            raid.armed = true; raid.fireAt = fireClient; raid.impactMs = st.impactMs; raid.durationSec = pick.durSec;
            raid.coords = st.g + ':' + st.s + ':' + st.p; raid.typeLabel = 'espionnage';
            raid.missionName = 'Espionnage x' + n + ' (' + pick.v + '%)';
            try { raid.consumption = fd.getConsumption(); } catch (e) { raid.consumption = null; }
            console.log('[OGS] ESPIONNAGE armé | arrivée', new Date(st.impactMs).toISOString(), '| vitesse', pick.v + '%', '| sondes', n);
            setStatus('Espionnage armé : arrivée ' + new Date(st.impactMs).toLocaleTimeString('fr-FR'), 'ok');
            updateRaidDisplay();
            raid.coarse = setTimeout(raidTightLoop, Math.max(0, fireClient - Date.now() - 2500));
        } finally {
            decaSpyRunning = false;
        }
    }
    // ============================================================
    // GHOST TIMÉ — analyse et PROPOSITIONS par mission, envoi MANUEL.
    // L'utilisateur sélectionne sa flotte + clique Continuer lui-même.
    // Missions testées, UNIQUEMENT dans le même système :
    //   1) Espionner en position 16
    //   2) Recycler un champ de débris (scan p1..15, type 2)
    //   3) Coloniser une position non occupée (scan p1..15)
    // Départ = immédiat (clic manuel sur « Envoyer la flotte ») donc
    // retour = maintenant + 2 × durée(vitesse). Pour chaque mission valide,
    // on propose la vitesse dont le retour est LE PLUS PROCHE de l'heure
    // demandée. L'utilisateur clique une proposition : la config (cible +
    // mission + vitesse) est appliquée, il n'a plus qu'à cliquer Envoyer.
    // ============================================================
    const ghostProps = { list: [], wishMs: null };
    function parseGhostReturn() {
        const el = document.getElementById('ogs-ghostt-time');
        const de = document.getElementById('ogs-ghostt-date');
        const tm = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((el && el.value) || '');
        if (!tm) return null;
        const now = new Date();
        const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec((de && de.value) || '');
        if (dm) {
            const d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], tm[3] != null ? +tm[3] : 0, 0);
            if (d.getTime() <= now.getTime() + 60000) return null;   // date+heure déjà passées
            return d.getTime();
        }
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +tm[1], +tm[2], tm[3] != null ? +tm[3] : 0, 0);
        let ms = d.getTime();
        if (ms <= now.getTime() + 60000) ms += 24 * 3600 * 1000;   // prochaine occurrence
        return ms;
    }
    // ---- Vitesse via les VRAIS boutons (10..100) ----
    // L'échelle interne de fd.speedPercent n'est PAS 10..100 (100% = 10 en
    // interne) : écrire fd.speedPercent directement fausse les durées. On
    // clique donc les boutons de la barre de vitesse comme un humain.
    function getSpeedSteps() {
        // Barre native OGame (.steps .step) OU barre OGLight (.ogl_speedBtn) qui
        // la remplace visuellement. Priorité aux boutons VISIBLES ; si tout est
        // masqué (OGLight cache la barre native), on clique la barre native
        // cachée : ses handlers restent actifs.
        const native = Array.from(document.querySelectorAll('#speedPercentage .step, .percentageBarWrapper .step, .steps .step'));
        const ogl = Array.from(document.querySelectorAll('.ogl_speedSelector .ogl_speedBtn, .ogl_speedBtn'));
        const vNative = native.filter(e => e.offsetParent !== null);
        if (vNative.length) return vNative;
        const vOgl = ogl.filter(e => e.offsetParent !== null);
        if (vOgl.length) return vOgl;
        return native;   // fallback : natifs même cachés
    }
    function speedStepValue(el) {
        return parseInt((el.getAttribute('data-value') || el.textContent || '').trim(), 10) || 0;
    }
    async function applySpeedStep(v) {
        const s = getSpeedSteps().find(e => speedStepValue(e) === v);
        if (!s) return false;
        s.click();
        await sleep(150 + humanMs(30, 120));
        return true;
    }
    // Clique chaque vitesse et lit durée + conso réelles du jeu.
    async function scanSpeedSteps() {
        const fd = window.fleetDispatcher;
        const tbl = [];
        for (const st of getSpeedSteps()) {
            const v = speedStepValue(st);
            if (!v) continue;
            st.click();
            await sleep(130 + humanMs(30, 130));
            try {
                const d = fd.getDuration();
                let cons = null; try { cons = fd.getConsumption(); } catch (e2) {}
                if (d > 0) tbl.push({ v, durSec: d, cons });
            } catch (e) {}
        }
        return tbl;
    }
    // Le verdict final du jeu : l'overlay "Vous ne pouvez pas commencer cette
    // mission." (visible = config invalide, ex. recyclage sans CDR existant).
    function isMissionBlocked() {
        const o = document.querySelector('.briefing_overlay');
        return !!(o && o.offsetParent !== null);
    }
    // Clique le bouton de type de cible (planète #pbutton / lune #mbutton / CDR #dbutton)
    function clickTargetTypeBtn(type) {
        const id = type === 2 ? 'dbutton' : (type === 3 ? 'mbutton' : 'pbutton');
        const b = document.getElementById(id);
        if (b) { b.click(); return true; }
        return false;
    }
    // Cible via les VRAIS champs du formulaire (le jeu relit ces inputs :
    // écrire seulement fd.targetPlanet ne suffit pas -> mission refusée).
    function setTargetViaDom(p, type) {
        const fd = window.fleetDispatcher;
        const gi = document.getElementById('galaxy'), si = document.getElementById('system'), pi = document.getElementById('position');
        if (gi) fillInput(gi, fd.currentPlanet.galaxy);
        if (si) fillInput(si, fd.currentPlanet.system);
        if (pi) fillInput(pi, p);
        fd.targetPlanet.galaxy = fd.currentPlanet.galaxy;
        fd.targetPlanet.system = fd.currentPlanet.system;
        fd.targetPlanet.position = p;
        fd.targetPlanet.type = type;
        clickTargetTypeBtn(type);                       // clic sur planète/lune/CDR (obligatoire pour le CDR)
        try { fd.updateTarget(); } catch (e) {}
    }
    async function testGhostCandidate(label, p, type, mission) {
        const fd = window.fleetDispatcher;
        setTargetViaDom(p, type);
        await sleep(800 + humanMs(100, 350));
        if (fd.targetPlanet.position !== p || fd.targetPlanet.type !== type) { console.log('[OGS] ghost: cible non appliquée', label); return null; }
        try { fd.selectMission(mission); } catch (e) {}
        if (fd.mission !== mission) return null;
        if (typeof fd.hasValidTarget === 'function') {
            let ok = false; try { ok = fd.hasValidTarget(); } catch (e) {}
            if (!ok) return null;
        }
        await sleep(450 + humanMs(50, 200));            // laisse le briefing se mettre à jour
        if (isMissionBlocked()) { console.log('[OGS] ghost: mission bloquée par le jeu ->', label); return null; }
        const tbl = await scanSpeedSteps();
        return tbl.length ? { label, p, type, mission, tbl } : null;
    }
    function renderGhostProps() {
        const box = document.getElementById('ogs-ghostt-props');
        if (!box) return;
        if (!ghostProps.list.length) { box.innerHTML = ''; return; }
        const wish = ghostProps.wishMs;
        box.innerHTML = ghostProps.list.map((pr, i) => {
            const ret = new Date(pr.returnMs);
            const tomorrow = ret.getDate() !== new Date().getDate();
            const dev = Math.round((pr.returnMs - wish) / 1000);
            const devTxt = dev === 0 ? 'pile' : ((dev > 0 ? '+' : '−') + fmtDur(Math.abs(dev)));
            return '<button type="button" class="ogs-btn ogs-btn-sub ogs-ghost-prop" data-idx="' + i + '" style="text-align:left;line-height:1.5;padding:8px 10px;">' +
                '<b style="color:#a6cbee">' + escapeHtml(pr.label) + '</b> · ' + pr.v + '%<br>' +
                'retour ~<b style="color:#f0b24a">' + ret.toLocaleTimeString('fr-FR') + '</b>' + (tomorrow ? ' <span style="color:#e0a94a">(+1j)</span>' : '') +
                ' <span style="color:#647c96">(' + devTxt + ')</span>' +
                (pr.cons != null ? ' · <span style="color:#e0a94a">' + Number(pr.cons).toLocaleString('fr') + '</span> deut' : '') +
                '</button>';
        }).join('');
    }
    async function analyzeGhost() {
        const fd = window.fleetDispatcher;
        const sendBtn = document.querySelector('#sendFleet');
        if (!fd || !sendBtn || !sendBtn.offsetParent) { setStatus('Ghost : sélectionne ta flotte et clique Continuer d\'abord', 'error'); return; }
        if (!(fd.shipsToSend || []).length) { setStatus('Ghost : aucune flotte sélectionnée', 'error'); return; }
        const wish = parseGhostReturn();
        if (!wish) { setStatus('Ghost : date/heure de retour invalide ou passée', 'error'); return; }
        ghostProps.list = []; ghostProps.wishMs = wish; renderGhostProps();
        const own = fd.currentPlanet;
        const candidates = [];
        setStatus('Ghost : test espionnage p16…', 'busy');
        let c = await testGhostCandidate('Espionnage p16', 16, 1, 6);
        if (c) candidates.push(c);
        for (let p = 1; p <= 15; p++) {                       // TOUS les CDR du système
            setStatus('Ghost : recherche CDR p' + p + '…', 'busy');
            c = await testGhostCandidate('Recyclage CDR p' + p, p, 2, 8);
            if (c) candidates.push(c);                        // pas de break : on continue le scan
        }
        for (let p = 1; p <= 15; p++) {                       // TOUTES les positions libres
            if (p === own.position) continue;
            setStatus('Ghost : test colonisation p' + p + '…', 'busy');
            c = await testGhostCandidate('Colonisation p' + p, p, 1, 7);
            if (c) candidates.push(c);                        // pas de break : scan complet
        }
        if (!candidates.length) {
            setStatus('Ghost : aucune mission possible (sonde ? recycleur ? colonisateur ? CDR ?)', 'error');
            return;
        }
        // UNE proposition par MISSION : parmi toutes les cibles analysées de la
        // mission (ex. tous les CDR), on garde la combinaison position+vitesse
        // dont le retour (départ immédiat) est le plus proche de l'heure demandée.
        const nowMs = Date.now();
        const byMission = {};
        candidates.forEach(cand => cand.tbl.forEach(r => {
            const returnMs = nowMs + 2 * r.durSec * 1000;
            const err = Math.abs(returnMs - wish);
            const cur = byMission[cand.mission];
            if (!cur || err < cur.err) byMission[cand.mission] = { ...cand, v: r.v, durSec: r.durSec, cons: r.cons, returnMs, err };
        }));
        ghostProps.list = Object.values(byMission);
        renderGhostProps();
        // Fenêtre atteignable (départ immédiat) : du retour le plus tôt (100%)
        // au retour le plus tard (10%). Alerte si la demande sort de la plage.
        let minRet = Infinity, maxRet = 0;
        candidates.forEach(cand => cand.tbl.forEach(r => {
            const ret = nowMs + 2 * r.durSec * 1000;
            if (ret < minRet) minRet = ret;
            if (ret > maxRet) maxRet = ret;
        }));
        const box = document.getElementById('ogs-ghostt-props');
        if (box && isFinite(minRet)) {
            const fmtT = ms => new Date(ms).toLocaleTimeString('fr-FR');
            let note = 'Retour atteignable : <b style="color:#8ad6ff">' + fmtT(minRet) + '</b> → <b style="color:#8ad6ff">' + fmtT(maxRet) + '</b>';
            if (wish > maxRet + 60000) note += '<br><span style="color:#e0a94a">⚠ Heure demandée au-delà du max — propositions au plus tard possible (10%).</span>';
            else if (wish < minRet - 60000) note += '<br><span style="color:#e0a94a">⚠ Heure demandée avant le min — propositions au plus tôt possible (100%).</span>';
            box.insertAdjacentHTML('afterbegin', '<div style="font-size:10px;line-height:1.6;color:#9fb2c8;padding:6px 8px;background:var(--ink);border:1px solid var(--bd);border-radius:4px;">' + note + '</div>');
        }
        setStatus('Ghost : ' + ghostProps.list.length + ' proposition(s) — choisis puis clique Envoyer', 'ok');
    }
    async function applyGhostProposal(idx) {
        const pr = ghostProps.list[idx];
        if (!pr) return;
        const fd = window.fleetDispatcher;
        setStatus('Ghost : application ' + pr.label + '…', 'busy');
        const ok = await testGhostCandidate(pr.label, pr.p, pr.type, pr.mission);
        if (!ok) { setStatus('Ghost : mission plus valide, relance l\'analyse', 'error'); return; }
        await applySpeedStep(pr.v);
        await sleep(humanMs(300, 600));
        let d = pr.durSec; try { d = fd.getDuration() || pr.durSec; } catch (e) {}
        const estReturn = Date.now() + 2 * d * 1000;
        // Notif « Retour de Ghost » ~3 min avant le retour estimé (ntfy 'At')
        const deliverAtMs = estReturn - 3 * 60 * 1000;
        if (deliverAtMs - Date.now() > 15000) {
            fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
                method: 'POST',
                headers: { 'Title': 'OGSentinel', 'Priority': 'high', 'Tags': 'ghost', 'At': String(Math.floor(deliverAtMs / 1000)) },
                body: 'Retour de Ghost',
            }).then(() => [500, 2000, 4000].forEach(t => setTimeout(updateScheduledList, t))).catch(() => {});
        }
        setStatus('Ghost prêt (' + pr.label + ' ' + pr.v + '%) — clique « Envoyer la flotte » ! Retour ≈ ' + new Date(estReturn).toLocaleTimeString('fr-FR'), 'ok');
        console.log('[OGS] GHOST appliqué |', pr.label, '|', pr.v + '% | retour estimé', new Date(estReturn).toISOString());
    }
    // ============================================================
    // AUTO-REFRESH via navigation menu aléatoire (intervalle paramétrable)
    // ============================================================
    let refreshDeadline = null;
    let refreshTimer = null;
    let countdownTimer = null;
    // Pages "sûres" (consultation pure, aucune action) pour la rotation.
    // On identifie chaque page par son data-ipi-hint de menu.
    const REFRESH_PAGES = [
        'ipiToolbarOverview',          // Vue d'ensemble
        'ipiToolbarResourcebuildings', // Ressources
        'ipiToolbarLifeformbuildings', // Forme de vie
        'ipiToolbarFacilities',        // Installations
        'ipiToolbarResearch',          // Recherche
        'ipiToolbarShipyard',          // Chantier spatial
        'ipiToolbarDefense',           // Défense
        'ipiToolbarGalaxy',            // Galaxie
    ];
    const LAST_REFRESH_PAGE_KEY = 'ogs_last_refresh_page';
    function isRefreshEnabled() {
        return localStorage.getItem(REFRESH_KEY) === '1';
    }
    function doRefresh() {
        // Sniper armé : on ne suspend le refresh QUE sur la page enchères
        // (ailleurs il n'y a pas de socket à protéger, endTime est en cache).
        // Raid armé : on ne recharge jamais (le clic d'envoi doit rester possible).
        if (ogsBusyOps > 0 || isExpeRunning() || ghostRunning || trapBusy || interAutoHot || interAutoRunning || raid.armed || (isSnipeArmed() && isAuctioneerPage())) { scheduleRefresh(); return; }
        // Liste des pages réellement présentes dans le menu
        const available = REFRESH_PAGES
            .map(hint => ({ hint, el: document.querySelector(`a.menubutton[data-ipi-hint="${hint}"]`) }))
            .filter(p => p.el);
        if (available.length === 0) {
            location.reload(); // fallback si aucun lien menu trouvé
            return;
        }
        // Évite de recliquer la même page que la fois précédente
        const last = localStorage.getItem(LAST_REFRESH_PAGE_KEY);
        let pool = available.filter(p => p.hint !== last);
        if (pool.length === 0) pool = available; // (une seule page dispo)
        const pick = pool[Math.floor(Math.random() * pool.length)];
        localStorage.setItem(LAST_REFRESH_PAGE_KEY, pick.hint);
        pick.el.click();
    }
    function scheduleRefresh() {
        const { min, max } = getRefreshBounds();
        const minMs = min * 60 * 1000;
        const maxMs = max * 60 * 1000;
        const delay = minMs + Math.round(Math.random() * (maxMs - minMs));
        refreshDeadline = Date.now() + delay;
        refreshTimer = setTimeout(() => {
            if (running || ogsBusyOps > 0 || isExpeRunning() || ghostRunning || trapBusy || interAutoHot || interAutoRunning || raid.armed || (isSnipeArmed() && isAuctioneerPage())) {
                scheduleRefresh();
                return;
            }
            doRefresh();
        }, delay);
        countdownTimer = setInterval(updateCountdown, 1000);
        updateCountdown();
    }
    function cancelRefresh() {
        clearTimeout(refreshTimer);
        clearInterval(countdownTimer);
        refreshTimer = null;
        countdownTimer = null;
        refreshDeadline = null;
        updateCountdown();
    }
    function restartRefreshIfEnabled() {
        if (isRefreshEnabled()) {
            cancelRefresh();
            scheduleRefresh();
        }
    }
    function updateCountdown() {
        const el = document.getElementById('ogs-refresh-countdown');
        if (!el) return;
        if (!refreshDeadline) {
            el.textContent = '--:--';
            el.style.color = '#5a7290';
            return;
        }
        const remain = Math.max(0, refreshDeadline - Date.now());
        const m = Math.floor(remain / 60000);
        const s = Math.floor((remain % 60000) / 1000);
        el.textContent = `${m}:${String(s).padStart(2, '0')}`;
        el.style.color = '#6af';
    }
    function toggleRefresh() {
        const cb = document.getElementById('ogs-refresh-cb');
        if (cb.checked) {
            localStorage.setItem(REFRESH_KEY, '1');
            scheduleRefresh();
        } else {
            localStorage.setItem(REFRESH_KEY, '0');
            cancelRefresh();
        }
    }
    // ============================================================
    // INTERFACE
    // ============================================================
    const saved = loadSelection();
    const bounds = getRefreshBounds();
    const shipRows = SHIPS.map(s => `
        <label class="ogs-ship-row">
            <input type="checkbox" class="ogs-ship-cb" data-ship-id="${s.id}" ${saved.includes(s.id) ? 'checked' : ''}>
            <span>${s.name}</span>
        </label>
    `).join('');
    (function(){ if(!document.getElementById('ogs-fonts')){ const l=document.createElement('link'); l.id='ogs-fonts'; l.rel='stylesheet'; l.href='https://fonts.googleapis.com/css2?family=Titillium+Web:wght@400;600;700&family=Share+Tech+Mono&display=swap'; document.head.appendChild(l);} })();
    const style = document.createElement('style');
    style.textContent = `
        /* ====== OGSENTINEL v6 — thème OGame (bleu acier / spatial) ====== */
        :root{
          --ink:#070b13;
          --blue:#6f9fc8; --blue-lt:#a6cbee; --cyan:#5cc6ff;
          --txt:#d6e2f0; --dim:#9fb2c8; --mute:#647c96;
          --amber:#f0b24a; --green:#74b23e; --green-d:#4b7a26; --red:#c8503f; --ok:#74b23e;
          --bd:#243449; --line:#2b3e5a;
          --ff:'Titillium Web',Verdana,'Segoe UI',sans-serif; --mono:'Share Tech Mono',monospace;
        }
        #ogs-panel{
          position:relative; width:160%; margin:6px 0; overflow:hidden;
          background:linear-gradient(180deg,#0e1626,#090e19); border:1px solid var(--bd); border-radius:5px;
          font-family:var(--ff); font-size:12px; color:var(--txt);
          box-shadow:0 6px 22px -8px rgba(0,0,0,.8), inset 0 0 0 1px rgba(90,140,200,.06), inset 0 1px 0 rgba(120,170,225,.12);
        }
        /* header — barre metallique OGame */
        #ogs-header{
          display:flex; align-items:center; gap:9px; padding:13px 12px; position:relative;
          border-bottom:1px solid #0a1526; cursor:pointer; user-select:none; overflow:hidden;
          background:linear-gradient(180deg,#2c3d5b 0%,#1e2c46 50%,#16203a 100%);
          box-shadow:inset 0 1px 0 rgba(150,190,235,.18);
        }
        #ogs-header::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;
          background:linear-gradient(90deg,transparent,var(--cyan),transparent);opacity:.55;z-index:0}
        #ogs-header > *{position:relative;z-index:1}
        #ogs-title{font-family:var(--ff);font-weight:700;letter-spacing:2px;text-transform:uppercase;font-size:14px;
          color:var(--blue-lt);text-shadow:0 0 9px rgba(92,198,255,.4),0 1px 2px #000;flex:1}
        #ogs-alert-dot{width:9px;height:9px;border-radius:50%;background:#3a4d68;box-shadow:0 0 0 2px rgba(0,0,0,.35)}
        #ogs-alert-dot.ogs-on{background:var(--red);box-shadow:0 0 9px var(--red);animation:ogs-pulse 1.2s infinite}
        @keyframes ogs-pulse{0%,100%{opacity:1}50%{opacity:.4}}
        #ogs-collapse-btn{color:var(--blue-lt);font-size:14px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,.28);text-shadow:0 1px 3px #000}
        #ogs-panel.ogs-collapsed .ogs-body{display:none}
        #ogs-panel.ogs-collapsed #ogs-header{border-bottom:none}
        .ogs-body{display:flex;flex-direction:column}
        /* hero readout — ecran console */
        #ogs-hero{margin:11px;border:1px solid var(--bd);border-radius:4px;padding:10px 12px;
          background:linear-gradient(180deg,#0a1222,#060a12);position:relative;
          box-shadow:inset 0 0 12px rgba(20,50,90,.4),inset 0 0 0 1px rgba(0,0,0,.4)}
        #ogs-snipe-status{display:block;font-family:var(--mono);font-size:23px;font-weight:400;color:#8ad6ff;
          text-shadow:0 0 10px rgba(92,198,255,.5);letter-spacing:1px;line-height:1.1;min-width:0;text-align:left;padding:0;background:none;border-radius:0}
        #ogs-snipe-info{font-family:var(--mono);font-size:10px;color:var(--mute);line-height:1.5;margin-top:3px;text-align:left}
        /* tabs */
        .ogs-tabs{display:flex;padding:0 8px;border-bottom:2px solid #0a1120;background:linear-gradient(180deg,rgba(20,30,48,.6),transparent)}
        .ogs-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 1px;cursor:pointer;
          color:var(--mute);font-weight:600;font-size:9px;letter-spacing:.3px;text-transform:uppercase;position:relative;
          border-right:1px solid rgba(0,0,0,.35);transition:.15s}
        .ogs-tab:last-child{border-right:none}
        .ogs-tab .ico{font-size:15px;line-height:1}
        .ogs-tab:hover{color:var(--dim);background:rgba(40,60,92,.25)}
        .ogs-tab.ogs-on{color:#e2edf9;background:rgba(44,66,100,.4)}
        .ogs-tab.ogs-on::after{content:"";position:absolute;left:0;right:0;bottom:-2px;height:3px;background:var(--cyan);box-shadow:0 0 8px var(--cyan)}
        .ogs-panes{padding:10px 9px 12px;background:linear-gradient(180deg,#0c1322,#080d17)}
        .ogs-pane{display:none;flex-direction:column;gap:10px}
        .ogs-pane.ogs-on{display:flex}
        .ogs-section{display:contents}
        .ogs-mlabel{display:flex;align-items:center;gap:7px;font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:var(--blue);font-weight:700;white-space:nowrap}
        .ogs-mlabel::before{content:"";width:9px;height:9px;background:var(--cyan);clip-path:polygon(0 0,100% 50%,0 100%)}
        .ogs-mlabel::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
        .ogs-section-title{font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--mute);font-weight:700}
        .ogs-sec-toggle{cursor:pointer;user-select:none}
        .ogs-sec-toggle:hover{color:var(--blue-lt)}
        .ogs-sec-toggle .ogs-chev{font-size:9px;color:var(--cyan)}
        .ogs-secbody{display:flex;flex-direction:column;gap:10px}
        .ogs-secbody.ogs-collapsed{display:none}
        /* Volet BDD locale ancré au menu de gauche */
        #ogs-db-flyout{
          position:fixed; z-index:99990; width:470px; max-height:70vh; overflow-y:auto;
          display:flex; flex-direction:column; gap:9px; padding:12px;
          background:linear-gradient(180deg,#0e1626,#090e19); border:1px solid var(--bd); border-radius:5px;
          font-family:var(--ff); font-size:12px; color:var(--txt);
          box-shadow:0 10px 30px -6px rgba(0,0,0,.85), inset 0 1px 0 rgba(120,170,225,.12);
        }
        #ogs-db-fly-head{
          display:flex; align-items:center; justify-content:space-between;
          font-size:11px; letter-spacing:1.6px; font-weight:700; color:var(--blue-lt);
          border-bottom:1px solid var(--bd); padding-bottom:8px;
        }
        #ogs-db-fly-close{cursor:pointer; color:var(--mute); padding:2px 6px}
        #ogs-db-fly-close:hover{color:var(--red)}
        #ogs-ia-badge{font-size:9px;font-weight:700;color:#74b23e;letter-spacing:1px}
        .ogs-tab.ogs-armed .ico{filter:drop-shadow(0 0 5px #74b23e)}
        .ogs-btn{width:100%;padding:10px;border-radius:4px;border:1px solid #0a1120;cursor:pointer;font-family:var(--ff);
          font-size:12px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#d8e6f6;
          background:linear-gradient(180deg,#2c3e5c,#1a2841);box-shadow:inset 0 1px 0 rgba(140,180,230,.14);transition:.12s}
        .ogs-btn:hover{filter:brightness(1.15)}
        .ogs-btn:active{transform:translateY(1px)}
        .ogs-btn-primary{background:linear-gradient(180deg,var(--green),var(--green-d));color:#0d1a05;border-color:#16260a;text-shadow:0 1px 0 rgba(255,255,255,.15)}
        .ogs-btn-stop{background:linear-gradient(180deg,#c8503f,#8a2f24) !important;border-color:#3a0f0a !important;color:#fff}
        .ogs-btn.ogs-busy{opacity:.5;cursor:default}
        .ogs-btn-sub{padding:6px;font-size:10px;text-transform:none;letter-spacing:0;background:var(--ink);color:var(--blue);border-color:var(--bd);font-weight:500}
        .ogs-inline-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 20px;min-width:200px;
          font-family:var(--ff);font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:#0d1a05;cursor:pointer;
          background:linear-gradient(180deg,var(--green),var(--green-d));border:1px solid #16260a;border-radius:5px;
          box-shadow:0 2px 6px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.18);transition:filter .12s,transform .05s}
        .ogs-inline-btn:hover{filter:brightness(1.1)} .ogs-inline-btn:active{transform:translateY(1px)}
        .ogs-inline-ico{font-size:15px;line-height:1}
        .ogs-inline-btn.ogs-inline-stop{background:linear-gradient(180deg,#c8503f,#8a2f24);color:#fff}
        @media (max-width:900px){.ogs-inline-btn{width:90%;min-width:0;padding:12px 16px;font-size:15px}.ogs-inline-ico{font-size:17px}}
        #ogs-ship-list{display:none;max-height:210px;overflow-y:auto;padding:6px;background:var(--ink);
          border:1px solid var(--bd);border-radius:4px;flex-direction:column;gap:2px}
        #ogs-ship-list.ogs-open{display:flex}
        .ogs-selall{display:flex;gap:5px;margin-bottom:4px}
        .ogs-ship-row{display:flex;align-items:center;gap:7px;padding:4px;border-radius:3px;cursor:pointer;color:var(--dim)}
        .ogs-ship-row:hover{background:rgba(92,198,255,.1)}
        .ogs-ship-cb{accent-color:var(--cyan);cursor:pointer}
        .ogs-toggle-line{display:flex;align-items:center;justify-content:space-between;cursor:pointer;font-size:12px;color:var(--txt)}
        .ogs-arm-line{justify-content:center;gap:8px;font-weight:700;letter-spacing:.5px;padding:4px 0;color:var(--blue-lt)}
        #ogs-snipe-body{display:flex;flex-direction:column;gap:10px;transition:opacity .15s}
        #ogs-snipe-body.ogs-disabled{opacity:.38;pointer-events:none;filter:grayscale(.5)}
        .ogs-toggle-line > span:first-child{display:flex;align-items:center;gap:7px}
        .ogs-switch input{accent-color:var(--cyan);cursor:pointer;width:15px;height:15px}
        .ogs-badge{font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:400;padding:2px 8px;border-radius:3px;
          background:var(--ink);border:1px solid var(--bd);min-width:44px;text-align:center;color:var(--cyan)}
        .ogs-interval{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px;color:var(--dim)}
        .ogs-num{width:64px;padding:6px;text-align:center;background:var(--ink);color:var(--amber);border:1px solid var(--bd);
          border-radius:4px;font-size:12px;font-family:var(--mono);outline:none}
        .ogs-num:focus{border-color:var(--cyan);box-shadow:0 0 0 1px rgba(92,198,255,.35)}
        /* selects : retirer le skin natif (OGLight) + fleche cyan custom */
        select.ogs-num{
          -webkit-appearance:none !important; -moz-appearance:none !important; appearance:none !important;
          background-color:var(--ink) !important; color:var(--amber) !important;
          background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='7' viewBox='0 0 10 7'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%235cc6ff' stroke-width='1.6'/%3E%3C/svg%3E") !important;
          background-repeat:no-repeat !important; background-position:right 7px center !important; background-size:9px 7px !important;
          padding:6px 20px 6px 8px !important; text-align:left; cursor:pointer; line-height:1.2;
        }
        select.ogs-num::-ms-expand{display:none}
        select.ogs-num option{background:#0e1626;color:var(--txt)}
        #ogs-raid-info{font-size:10px;line-height:1.6;color:#9fb2c8}
        /* toggle segmenté (2 options) */
        .ogs-seg{display:flex;background:var(--ink);border:1px solid var(--bd);border-radius:5px;overflow:hidden}
        .ogs-seg button{flex:1;padding:7px 4px;border:none;cursor:pointer;font-family:var(--ff);font-size:11px;
          font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--mute);background:transparent;transition:.15s}
        .ogs-seg button + button{border-left:1px solid var(--bd)}
        .ogs-seg button.ogs-on{color:#0d1a05;background:linear-gradient(180deg,var(--cyan),#3a9fd4);
          text-shadow:0 1px 0 rgba(255,255,255,.2);box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}
        .ogs-seg button:hover:not(.ogs-on){color:var(--dim);background:rgba(40,60,92,.3)}
        #ogs-status{text-align:center;min-height:15px;font-size:10px;padding:4px;color:var(--dim);font-family:var(--mono)}
        /* ---- recup. d'espace + fixes mobile (inchanges) ---- */
        #bannerskyscrapercomponent,#banner_skyscraper{display:none !important}
        #planetList .ogl_recap{display:none !important}
        #right{width:auto !important}
        @media (max-width:900px){
          html,body{overflow-x:hidden !important}
          #pageContent{width:100% !important;max-width:100% !important;min-width:0 !important}
          #middle{width:auto !important;max-width:100% !important;min-width:0 !important;overflow-x:hidden}
          #middle .maincontent,#fleetdispatchcomponent,#inhalt{width:auto !important;max-width:100% !important;min-width:0 !important}
          #middle table{max-width:100% !important}
          #ogs-panel{font-size:13px}
          #ogs-title{font-size:15px}
          .ogs-tab{font-size:10px;padding:11px 1px}.ogs-tab .ico{font-size:17px}
          .ogs-btn{padding:12px;font-size:13px}
          .ogs-toggle-line{font-size:13px}
          .ogs-badge{font-size:13px}
          .ogs-interval{font-size:13px}
          .ogs-num{width:74px;padding:9px 4px;font-size:14px}
          .ogs-ship-cb,.ogs-switch input{width:18px;height:18px}
          .ogs-ship-row{padding:8px 5px;font-size:14px}
          #ogs-snipe-status{font-size:26px}
        }
    `;
    document.head.appendChild(style);
    const panel = document.createElement('div');
    panel.id = 'ogs-panel';
    panel.innerHTML = `
        <div id="ogs-header">
            <span id="ogs-alert-dot"></span>
            <span id="ogs-title">OGSENTINEL</span>
            <span id="ogs-collapse-btn" title="Réduire / déployer">▾</span>
        </div>
        <div class="ogs-body">
            <div id="ogs-hero">
                <span id="ogs-snipe-status">--</span>
                <div id="ogs-snipe-info"></div>
            </div>
            <div class="ogs-tabs">
                <div class="ogs-tab ogs-on" data-pane="snipe"><span class="ico">🎯</span>Enchère</div>
                <div class="ogs-tab" data-pane="raid"><span class="ico">💥</span>Raid</div>
                <div class="ogs-tab" data-pane="ghost"><span class="ico">👻</span>Ghost</div>
                <div class="ogs-tab" data-pane="expe"><span class="ico">🚀</span>Expé</div>
                <div class="ogs-tab" data-pane="refresh"><span class="ico">🔄</span>Refresh</div>
                <div class="ogs-tab" data-pane="inter"><span class="ico">⚡</span>Inter</div>
                <div class="ogs-tab" data-pane="alert"><span class="ico">🔔</span>Alerte</div>
            </div>
            <div class="ogs-panes">
              <div class="ogs-pane ogs-on" data-pane="snipe">
                <div class="ogs-section">
                    <div id="ogs-snipe-empire" style="font-size:10px;color:#6f9fc8;"></div>
                    <label class="ogs-toggle-line ogs-switch ogs-arm-line">
                        <span><input type="checkbox" id="ogs-snipe-cb"> Armé</span>
                    </label>
                    <div id="ogs-snipe-body">
                    <div class="ogs-mlabel">Ressource</div>
                    <div class="ogs-seg" id="ogs-res-seg">
                        <button type="button" data-val="metal">Métal</button>
                        <button type="button" data-val="crystal">Cristal</button>
                    </div>
                    <div class="ogs-mlabel">Paramètres de tir</div>
                    <div class="ogs-interval"><span>Marge</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-snipe-margin" class="ogs-num" value="${getSnipeMargin()}" min="0" step="50"><span>ms</span></span></div>
                    <div class="ogs-interval"><span>Plafond</span>
                        <input type="number" id="ogs-snipe-max" class="ogs-num" style="width:96px;" value="${getSnipeMaxMetal()}" min="0" step="10000"></div>
                    <div class="ogs-interval"><span>Bump min.</span>
                        <input type="number" id="ogs-snipe-bump" class="ogs-num" style="width:80px;" value="${getSnipeBump()}" min="0" step="100"></div>
                    <div class="ogs-mlabel">Tir en rafale</div>
                    <label class="ogs-toggle-line ogs-switch">
                        <span><input type="checkbox" id="ogs-snipe-rafale"> Rafale</span>
                    </label>
                    <div class="ogs-interval"><span>Démarre à</span>
                        <span style="display:flex;gap:4px;align-items:center"><select id="ogs-snipe-rafale-window" class="ogs-num" style="width:74px;">${[1,2,3,4,5,6,7,8,9,10].map(s => `<option value="${s}"${s === (getRafaleWindowMs()/1000) ? ' selected' : ''}>${s} s</option>`).join('')}</select><span>av. fin</span></span></div>
                    <div class="ogs-interval"><span>Rafale +</span>
                        <input type="number" id="ogs-snipe-rafale-bump" class="ogs-num" style="width:90px;" value="${getRafaleBump()}" min="0" step="10000"></div>
                    <div class="ogs-interval"><span>Cadence</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-snipe-rafale-interval" class="ogs-num" style="width:74px;" value="${getRafaleInterval()}" min="100" step="100"><span>ms</span></span></div>
                    <button id="ogs-snipe-remeasure" class="ogs-btn ogs-btn-sub">↻ Re-mesurer offset</button>
                    </div>
                </div>
              </div>
              <div class="ogs-pane" data-pane="inter">
                <div class="ogs-section">
                    <div class="ogs-mlabel ogs-sec-toggle" data-sec="trap">🪤 Trap (leurre)<span class="ogs-chev">▾</span></div>
                    <div class="ogs-secbody" data-sec="trap">
                    <div style="font-size:10px;line-height:1.5;color:#647c96;">Étape 1 — Depuis la lune où est ta flotte, pose l'appât (% par vaisseau) sur la lune du trap via la Porte de saut. Données : BDD locale, relues en frais au moment de la pose.</div>
                    <div id="ogs-trap-box" style="display:none;flex-direction:column;gap:8px;">
                        <div id="ogs-trap-stats"></div>
                        <div style="font-size:10px;color:#6f9fc8;">Destination du saut</div>
                        <select id="ogs-trap-dest" class="ogs-num" style="width:100%;box-sizing:border-box;"></select>
                        <div style="font-size:10px;color:#6f9fc8;">Composition de l'appât (dispo · % · posés)</div>
                        <div id="ogs-trap-ships" style="display:flex;flex-direction:column;gap:4px;"></div>
                        <div style="font-size:10px;color:#6f9fc8;">Presets de composition</div>
                        <div style="display:flex;gap:6px;">
                            <select id="ogs-trap-preset" class="ogs-num" style="flex:1;min-width:0;"></select>
                            <button id="ogs-trap-preset-load" class="ogs-btn ogs-btn-sub" style="width:auto;">Charger</button>
                            <button id="ogs-trap-preset-del" class="ogs-btn ogs-btn-sub" style="width:auto;">🗑</button>
                        </div>
                        <div style="display:flex;gap:6px;">
                            <input type="text" id="ogs-trap-preset-name" class="ogs-num" placeholder="Nom du preset" style="flex:1;min-width:0;box-sizing:border-box;">
                            <button id="ogs-trap-preset-save" class="ogs-btn ogs-btn-sub" style="width:auto;">💾 Enregistrer</button>
                        </div>
                        <div id="ogs-trap-preview"></div>
                        <button id="ogs-trap-go" class="ogs-btn ogs-btn-primary">🪤 Poser le trap</button>
                    </div>
                    <div id="ogs-trap-status" style="font-size:10px;color:#647c96;"></div>
                    </div>
                </div>
                <div class="ogs-section">
                    <div class="ogs-mlabel ogs-sec-toggle" data-sec="fleet">⚔ Flotte d'interception<span class="ogs-chev">▾</span></div>
                    <div class="ogs-secbody" data-sec="fleet">
                    <div style="font-size:10px;line-height:1.5;color:#647c96;">Vaisseaux envoyés (au max dispo) par l'interception, manuelle comme auto.</div>
                    <button id="ogs-toggle-ships" class="ogs-btn ogs-btn-sub">Vaisseaux ▾</button>
                    <div id="ogs-ship-list">
                        <div class="ogs-selall">
                            <button id="ogs-all" class="ogs-btn ogs-btn-sub" style="flex:1;">Tout</button>
                            <button id="ogs-none" class="ogs-btn ogs-btn-sub" style="flex:1;">Rien</button>
                        </div>
                        ${shipRows}
                    </div>
                    <label class="ogs-toggle-line ogs-switch">
                        <span><input type="checkbox" id="ogs-ghost-auto"> Recycler après saut</span>
                    </label>
                    </div>
                </div>
                <div class="ogs-section">
                    <div class="ogs-mlabel ogs-sec-toggle" data-sec="auto">🛡 Interception auto <span id="ogs-ia-badge"></span><span class="ogs-chev">▾</span></div>
                    <div class="ogs-secbody" data-sec="auto">
                    <div style="font-size:10px;line-height:1.5;color:#647c96;">Étape 2 — Armé : surveille les attaques sur tes lunes. Toute la séquence (saut + recyclage) s'exécute dans les N dernières secondes avant impact.</div>
                    <div style="font-size:10px;color:#6f9fc8;">Lune d'intervention (où est ta flotte)</div>
                    <select id="ogs-ia-moon" class="ogs-num" style="width:100%;box-sizing:border-box;"></select>
                    <div class="ogs-interval"><span>Séquence à impact −</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-ia-lead" class="ogs-num" style="width:60px;" min="5" max="120" step="1"><span>s</span></span></div>
                    <button id="ogs-ia-arm" class="ogs-btn ogs-btn-primary">🛡 Armer l'interception</button>
                    <button id="ogs-ia-test" class="ogs-btn ogs-btn-sub">🧪 Tester la séquence (à blanc)</button>
                    <div id="ogs-ia-test-out" style="font-size:10px;line-height:1.7;"></div>
                    <div id="ogs-ia-status" style="font-size:10px;line-height:1.6;color:#647c96;"></div>
                    </div>
                </div>
                <div class="ogs-section">
                    <div class="ogs-mlabel ogs-sec-toggle" data-sec="manual">⚡ Interception manuelle<span class="ogs-chev">▾</span></div>
                    <div class="ogs-secbody" data-sec="manual">
                    <div style="font-size:10px;line-height:1.5;color:#647c96;">Saut immédiat de la flotte cochée vers la destination choisie, depuis la lune courante.</div>
                    <div style="font-size:10px;color:#6f9fc8;">Destination du saut</div>
                    <select id="ogs-inter-dest" class="ogs-num" style="width:100%;box-sizing:border-box;"></select>
                    <button id="ogs-interception" class="ogs-btn ogs-btn-primary">⚡ Interception</button>
                    </div>
                </div>
              </div>
              <div class="ogs-pane" data-pane="ghost">
                <div class="ogs-section">
                    <div class="ogs-mlabel">Ghost timé</div>
                    <div style="font-size:10px;line-height:1.5;color:#647c96;">Sélectionne ta flotte sur Flotte, clique Continuer, entre l'heure et analyse. Le départ reste MANUEL : choisis une proposition puis clique « Envoyer la flotte ». Missions : espionnage p16, recyclage CDR, colonisation (même système).</div>
                    <div id="ogs-ghost-fleetval" style="font-size:10px;color:#6f9fc8;"></div>
                    <div style="font-size:10px;color:#6f9fc8;">Retour souhaité</div>
                    <div style="display:flex;gap:6px;">
                        <input type="date" id="ogs-ghostt-date" class="ogs-num" style="flex:1;min-width:0;box-sizing:border-box;">
                        <input type="time" id="ogs-ghostt-time" step="1" class="ogs-num" style="width:110px;box-sizing:border-box;">
                    </div>
                    <button id="ogs-ghostt-go" class="ogs-btn ogs-btn-primary" style="width:100%;">🔍 Analyser les missions</button>
                    <div id="ogs-ghostt-props" style="display:flex;flex-direction:column;gap:6px;"></div>
                </div>
              </div>
              <div class="ogs-pane" data-pane="raid">
                <div class="ogs-section">
                    <div class="ogs-mlabel">Raid timé</div>
                    <div class="ogs-seg" id="ogs-raid-mode-seg">
                        <button type="button" data-val="manual">Manuel</button>
                        <button type="button" data-val="auto">Auto</button>
                    </div>
                    <div id="ogs-raid-info"></div>
                    <div id="ogs-raid-auto-box" style="display:none;flex-direction:column;gap:8px;">
                        <select id="ogs-raid-mypos" class="ogs-num" style="width:100%;box-sizing:border-box;"></select>
                        <div style="font-size:10px;color:#6f9fc8;">Cible (G : S : P)</div>
                        <div style="display:flex;gap:6px;">
                            <input type="number" id="ogs-raid-g" class="ogs-num" style="flex:1;min-width:0;" min="1" max="9" placeholder="G">
                            <input type="number" id="ogs-raid-s" class="ogs-num" style="flex:1.4;min-width:0;" min="1" max="499" placeholder="S">
                            <input type="number" id="ogs-raid-p" class="ogs-num" style="flex:1;min-width:0;" min="1" max="16" placeholder="P">
                        </div>
                        <div style="display:flex;gap:6px;">
                            <select id="ogs-raid-type" class="ogs-num" style="flex:1;min-width:0;">
                                <option value="1">Planète</option>
                                <option value="3">Lune</option>
                                <option value="2">CDR</option>
                            </select>
                            <select id="ogs-raid-mission" class="ogs-num" style="flex:1.3;min-width:0;">
                                <option value="1">Attaquer</option>
                                <option value="8">Recycler</option>
                                <option value="6">Espionner</option>
                            </select>
                            <select id="ogs-raid-speed" class="ogs-num" style="flex:1;min-width:0;">
                                ${[100,90,80,70,60,50,40,30,20,10].map(v => `<option value="${v}"${v === 100 ? ' selected' : ''}>${v}%</option>`).join('')}
                            </select>
                        </div>
                        <button id="ogs-raid-ships-toggle" class="ogs-btn ogs-btn-sub">Vaisseaux ▾</button>
                        <div id="ogs-raid-ship-list" style="display:none;flex-direction:column;gap:2px;max-height:200px;overflow-y:auto;padding:6px;background:var(--ink);border:1px solid var(--bd);border-radius:4px;">
                            ${SHIPS.map(s => `<div class="ogs-ship-row" style="justify-content:space-between;"><span>${s.name}</span><input type="text" class="ogs-num ogs-raid-ship-n" data-ship-id="${s.id}" style="width:58px;" placeholder="0 / max"></div>`).join('')}
                        </div>
                    </div>
                    <div style="font-size:10px;color:#6f9fc8;">Heure d'impact (HH:MM:SS)</div>
                    <div style="display:flex;gap:6px;">
                        <input type="date" id="ogs-raid-date" class="ogs-num" style="flex:1;min-width:0;box-sizing:border-box;">
                        <input type="time" id="ogs-raid-time" step="1" class="ogs-num" style="width:112px;box-sizing:border-box;">
                    </div>
                    <div class="ogs-interval"><span>Marge</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-raid-margin" class="ogs-num" style="width:72px;" value="${getRaidMargin()}" min="0" step="50"><span>ms</span></span></div>
                    <button id="ogs-raid-go" class="ogs-btn ogs-btn-primary" style="width:100%;">🎯 Armer le raid</button>
                    <div id="ogs-raid-active" style="display:none;font-size:10px;line-height:1.7;color:#9fb2c8;padding:8px 10px;background:var(--ink);border:1px solid var(--bd);border-radius:4px;"></div>

                    <div class="ogs-mlabel">Décalage sonde (ACS)</div>
                    <select id="ogs-deca-union" class="ogs-num" style="width:100%;box-sizing:border-box;"><option value="">(aucun groupe)</option></select>
                    <div id="ogs-deca-info" style="font-size:10px;line-height:1.6;color:#9fb2c8;"></div>
                    <div class="ogs-interval"><span>Décaler de</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-deca-delay" class="ogs-num" style="width:76px;" min="1" step="1" placeholder="sec"><span>s</span></span></div>
                    <div id="ogs-deca-preview" style="font-size:10px;line-height:1.6;color:#9fb2c8;"></div>
                    <div class="ogs-interval"><span>Espionner à l'impact initial</span>
                        <span style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="ogs-deca-spy" checked style="accent-color:var(--cyan);width:15px;height:15px;cursor:pointer;"><input type="number" id="ogs-deca-spy-n" class="ogs-num" style="width:60px;" value="100" min="1"><span>sondes</span></span></div>
                    <button id="ogs-deca-go" class="ogs-btn ogs-btn-primary" style="width:100%;">🛰 Décaler l'impact</button>
                </div>
              </div>
              <div class="ogs-pane" data-pane="expe">
                <div class="ogs-section">
                    <div class="ogs-mlabel">Détachement</div>
                    <div class="ogs-interval"><span>Maintien</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-expe-hold" class="ogs-num" style="width:56px;" value="${getExpeHoldHours()}" min="1" max="20" step="1"><span>h</span></span></div>
                    <div class="ogs-interval"><span>Envoyer</span>
                        <span style="display:flex;gap:4px;align-items:center"><select id="ogs-expe-count" class="ogs-num" style="width:82px;">${expeCountOptionsHtml()}</select><span>slot(s)</span></span></div>
                    <button id="ogs-expe" class="ogs-btn ogs-btn-primary">🚀 Envoyer les expéditions</button>
                </div>
              </div>
              <div class="ogs-pane" data-pane="refresh">
                <div class="ogs-section">
                    <label class="ogs-toggle-line ogs-switch">
                        <span><input type="checkbox" id="ogs-refresh-cb"> Auto-refresh</span>
                        <span id="ogs-refresh-countdown" class="ogs-badge">--:--</span>
                    </label>
                    <div class="ogs-interval"><span>Intervalle</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-refresh-min" class="ogs-num" style="width:56px;" value="${bounds.min}" min="0.25" step="0.25"><span>à</span><input type="number" id="ogs-refresh-max" class="ogs-num" style="width:56px;" value="${bounds.max}" min="0.25" step="0.25"><span>min</span></span></div>
                </div>
              </div>
              <div class="ogs-pane" data-pane="alert">
                <div class="ogs-section">
                    <div class="ogs-mlabel">Renseignement</div>
                    <div class="ogs-toggle-line">
                        <span>Alerte attaque</span>
                        <span style="display:flex; align-items:center; gap:6px;">
                            <span id="ogs-cooldown" class="ogs-badge"></span>
                            <button id="ogs-cooldown-reset" class="ogs-btn ogs-btn-sub" title="Reset cooldown" style="width:auto; padding:4px 8px;">↺</button>
                        </span>
                    </div>
                    <div class="ogs-interval"><span>Cooldown</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-cooldown-min" class="ogs-num" value="${getNotifCooldownMin()}" min="0" step="1"><span>min</span></span></div>
                    <label class="ogs-toggle-line ogs-switch">
                        <span><input type="checkbox" id="ogs-ret-cb"> Notifs retours de flotte (−1 min, expés groupées)</span>
                    </label>
                    <div class="ogs-mlabel">Notif. programmée</div>
                    <select id="ogs-notif-msg" class="ogs-num" style="width:100%;box-sizing:border-box;">${notifMsgOptionsHtml()}</select>
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <input type="date" id="ogs-notif-date" class="ogs-num" style="flex:1;min-width:0;box-sizing:border-box;">
                        <input type="time" id="ogs-notif-time" class="ogs-num" style="width:96px;box-sizing:border-box;" value="06:00">
                    </div>
                    <button id="ogs-notif-go" class="ogs-btn ogs-btn-primary" style="width:100%;margin-top:6px;">🔔 Programmer</button>
                    <div class="ogs-mlabel">Série récurrente</div>
                    <div class="ogs-interval"><span>Toutes les</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-recur-int" class="ogs-num" style="width:60px;" value="${getRecurInterval()}" min="1" step="1"><span>min</span></span></div>
                    <div class="ogs-interval"><span>Pendant</span>
                        <span style="display:flex;gap:4px;align-items:center"><input type="number" id="ogs-recur-dur" class="ogs-num" style="width:60px;" value="${getRecurDuration()}" min="1" step="1"><span>h</span></span></div>
                    <button id="ogs-recur-go" class="ogs-btn ogs-btn-primary" style="width:100%;margin-top:6px;">🔁 Programmer la série</button>
                    <div class="ogs-mlabel">Messages enregistrés</div>
                    <input type="text" id="ogs-notif-new" class="ogs-num" style="width:100%;box-sizing:border-box;" placeholder="Nouveau message">
                    <div style="display:flex;gap:6px;margin-top:6px;">
                        <button id="ogs-notif-add" class="ogs-btn ogs-btn-sub" style="flex:1;">＋ Ajouter</button>
                        <button id="ogs-notif-del" class="ogs-btn ogs-btn-sub" style="flex:1;">🗑 Supprimer</button>
                    </div>
                    <div class="ogs-mlabel" style="display:flex;justify-content:space-between;align-items:center;">
                        <span>Programmées</span>
                        <button id="ogs-sched-refresh" class="ogs-btn ogs-btn-sub" title="Actualiser" style="width:auto; padding:2px 8px;">↻</button>
                    </div>
                    <div id="ogs-sched-list" style="font-size:9px; text-align:center; line-height:1.7; color:#8fb0cc;"></div>
                </div>
              </div>
            </div>
            <div id="ogs-status"></div>
        </div>
    `;
    // Ancrage du panneau JUSTE APRÈS #planetList (hors de la liste), à la
    // place visuelle du récap OGLight (.ogl_recap) qui est masqué par CSS.
    // Fallback sur le body si la structure n'est pas présente.
    function anchorPanel() {
        if (panel.isConnected) return; // déjà placé
        const planetList = document.querySelector('#planetList');
        if (planetList) {
            planetList.insertAdjacentElement('afterend', panel);
        } else {
            document.body.appendChild(panel); // fallback
        }
    }
    anchorPanel();
    // Onglets du panneau — l'onglet actif est persistant (survit au rechargement)
    const ACTIVE_TAB_KEY = 'ogs_active_tab';
    function activatePane(pane) {
        const tab = panel.querySelector('.ogs-tab[data-pane="' + pane + '"]');
        const p = panel.querySelector('.ogs-pane[data-pane="' + pane + '"]');
        if (!tab || !p) return;
        panel.querySelectorAll('.ogs-tab').forEach(x => x.classList.remove('ogs-on'));
        panel.querySelectorAll('.ogs-pane').forEach(x => x.classList.remove('ogs-on'));
        tab.classList.add('ogs-on');
        p.classList.add('ogs-on');
        // Préremplit l'heure avec l'heure courante à l'ouverture de l'onglet Alerte
        if (pane === 'alert') {
            const ti = document.getElementById('ogs-notif-time');
            if (ti) {
                const d = new Date(), pad = n => String(n).padStart(2, '0');
                ti.value = pad(d.getHours()) + ':' + pad(d.getMinutes());
            }
        }
        if (pane === 'raid') { updateRaidDisplay(); fixDateToday('ogs-raid-date'); }
        if (pane === 'ghost') { updateGhostFleetVal(); fixDateToday('ogs-ghostt-date'); }
        if (pane === 'snipe') updateSnipeEmpireLine();
        try { localStorage.setItem(ACTIVE_TAB_KEY, pane); } catch (e) {}
    }
    panel.querySelectorAll('.ogs-tab').forEach(t => t.addEventListener('click', (e) => {
        e.stopPropagation();
        activatePane(t.dataset.pane);
    }));
    // Restaure l'onglet actif mémorisé (sinon reste sur "snipe" par défaut)
    const savedPane = localStorage.getItem(ACTIVE_TAB_KEY);
    if (savedPane && savedPane !== 'snipe') activatePane(savedPane);
    ogsActivatePaneHook = activatePane;
    setTimeout(consumeIaTestIfNeeded, 700);
    function setStatus(txt, kind) {
        const s = document.getElementById('ogs-status');
        if (!s) return;
        s.textContent = txt;
        const colors = { ok: '#7fd98a', error: '#e87e7e', busy: '#e0a94a', alert: '#ff5c5c' };
        s.style.color = colors[kind] || '#bcd4ea';
    }
    function setAlertIndicator(on) {
        const dot = document.getElementById('ogs-alert-dot');
        if (dot) dot.classList.toggle('ogs-on', on);
    }
    // Opérations longues sous verrou anti-refresh (rebind avant tout addEventListener)
    analyzeGhost = trackBusy(analyzeGhost);
    prepareRaidAuto = trackBusy(prepareRaidAuto);
    armDeca = trackBusy(armDeca);
    runDecaSpy = trackBusy(runDecaSpy);
    // ---- Interception ----
    document.getElementById('ogs-toggle-ships').addEventListener('click', () => {
        const list = document.getElementById('ogs-ship-list');
        const btn = document.getElementById('ogs-toggle-ships');
        const open = list.classList.toggle('ogs-open');
        btn.textContent = open ? 'Vaisseaux ▴' : 'Vaisseaux ▾';
    });
    document.querySelectorAll('.ogs-ship-cb').forEach(cb => {
        cb.addEventListener('change', () => saveSelection(getSelectedIds()));
    });
    document.getElementById('ogs-all').addEventListener('click', () => {
        document.querySelectorAll('.ogs-ship-cb').forEach(cb => cb.checked = true);
        saveSelection(getSelectedIds());
    });
    document.getElementById('ogs-none').addEventListener('click', () => {
        document.querySelectorAll('.ogs-ship-cb').forEach(cb => cb.checked = false);
        saveSelection(getSelectedIds());
    });
    document.getElementById('ogs-interception').addEventListener('click', runInterception);
    // ---- Destination d'interception (depuis la BDD locale si connue) ----
    dbRefreshEmpire();
    populateInterDestSelect(dbGateDestsForHere());
    // Collecte passive différée (fleetDispatcher pas toujours prêt au boot)
    setTimeout(() => { dbCollectFleetPage(); dbCollectResources(); updateGhostFleetVal(); }, 1200);
    // Scan empire silencieux : à la connexion (>30 min), sur changement de
    // structure (colonie/lune), ou après une action qui a déplacé des flottes.
    setTimeout(dbMaybeEmpireScan, 2500);
    updateSnipeEmpireLine();
    // Notifs de retour de flotte : activé par défaut, désactivable dans Alerte
    if (localStorage.getItem(RET_NOTIF_KEY) === null) localStorage.setItem(RET_NOTIF_KEY, '1');
    const retCb = document.getElementById('ogs-ret-cb');
    if (retCb) {
        retCb.checked = localStorage.getItem(RET_NOTIF_KEY) === '1';
        retCb.addEventListener('change', () => {
            localStorage.setItem(RET_NOTIF_KEY, retCb.checked ? '1' : '0');
            if (retCb.checked) syncReturnNotifs();
        });
    }
    // ---- Raid : préremplissage cible depuis la BDD (mes planètes/lunes) ----
    (function initRaidMyPos() {
        const sel = document.getElementById('ogs-raid-mypos');
        if (!sel) return;
        const db = dbLoad();
        let opts = '<option value="">— mes positions (BDD) —</option>';
        if (db.empire) {
            // noms réels planètes ET lunes depuis le scan empire
            const moonsByCoords = {};
            db.empire.moons.forEach(m => { moonsByCoords[m.coords] = m; });
            db.empire.planets.forEach(p => {
                opts += `<option value="1|${p.coords}">🪐 ${p.coords} ${p.name}</option>`;
                const mo = moonsByCoords[p.coords];
                if (mo) opts += `<option value="3|${p.coords}">🌙 ${p.coords} ${mo.name}</option>`;
            });
        } else {
            const planets = db.planets || [];
            if (!planets.length) { sel.style.display = 'none'; return; }
            planets.forEach(p => {
                opts += `<option value="1|${p.coords}">🪐 ${p.coords} ${p.name}</option>`;
                if (p.moonCp) opts += `<option value="3|${p.coords}">🌙 ${p.coords} Lune</option>`;
            });
        }
        sel.innerHTML = opts;
        sel.addEventListener('change', () => {
            if (!sel.value) return;
            const [type, coords] = sel.value.split('|');
            const m = coords.match(/\[(\d+):(\d+):(\d+)\]/);
            if (!m) return;
            const g = document.getElementById('ogs-raid-g');
            const s = document.getElementById('ogs-raid-s');
            const p = document.getElementById('ogs-raid-p');
            const t = document.getElementById('ogs-raid-type');
            if (g) g.value = m[1];
            if (s) s.value = m[2];
            if (p) p.value = m[3];
            if (t) t.value = type;   // 1 = planète, 3 = lune (préfixe du value)
            // Écrire .value par script ne déclenche PAS 'change' : sans ça la
            // config auto (dont le type Lune) n'est pas persistée et repart
            // sur « Planète » au prochain chargement.
            saveRaidAutoCfg(readRaidAutoCfgFromUI());
        });
    })();
    document.getElementById('ogs-inter-dest').addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        if (!e.target.value) localStorage.removeItem(INTER_DEST_KEY);
        else localStorage.setItem(INTER_DEST_KEY, JSON.stringify({ id: e.target.value, label: opt ? opt.textContent : '' }));
    });
    // ---- Sections repliables de l'onglet Inter ----
    (function initInterCollapse() {
        const KEY = 'ogs_inter_collapse';
        let st;
        try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
        if (!st) st = { fleet: 1, manual: 1 }; // défauts : flotte + manuelle repliées
        document.querySelectorAll('.ogs-sec-toggle').forEach(h => {
            const key = h.dataset.sec;
            const body = document.querySelector(`.ogs-secbody[data-sec="${key}"]`);
            const chev = h.querySelector('.ogs-chev');
            if (!body) return;
            const apply = () => {
                const c = !!st[key];
                body.classList.toggle('ogs-collapsed', c);
                if (chev) chev.textContent = c ? '▸' : '▾';
            };
            apply();
            h.addEventListener('click', () => {
                st[key] = st[key] ? 0 : 1;
                try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {}
                apply();
            });
        });
    })();
    // ---- Interception auto ----
    (function initInterAuto() {
        const cfg = getInterAuto();
        const moonSel = document.getElementById('ogs-ia-moon');
        const leadIn = document.getElementById('ogs-ia-lead');
        const armBtn = document.getElementById('ogs-ia-arm');
        const moons = listOwnMoons();
        const gates = dbGates();
        moonSel.innerHTML = '<option value="">— choisir une lune —</option>' +
            moons.map(m => {
                const hasGate = gates.some(g => g.id === m.cp || (g.coords && g.coords === m.coords));
                return `<option value="${m.cp}"${m.cp === cfg.moonCp ? ' selected' : ''}>Lune ${m.coords}${hasGate ? ' ⛩' : ''}</option>`;
            }).join('');
        leadIn.value = cfg.leadS || 10;
        function refreshArmBtn() {
            const c = getInterAuto();
            armBtn.textContent = c.armed ? '✕ Désarmer l\'interception' : '🛡 Armer l\'interception';
            armBtn.style.background = c.armed ? '#c8503f' : '';
            const badge = document.getElementById('ogs-ia-badge');
            if (badge) badge.textContent = c.armed ? '● ARMÉ' : '';
            document.querySelectorAll('.ogs-tab[data-pane="inter"]').forEach(t => t.classList.toggle('ogs-armed', !!c.armed));
        }
        function saveCfg(patch) {
            const c = getInterAuto();
            setInterAutoCfg(Object.assign(c, patch));
        }
        moonSel.addEventListener('change', () => {
            const m = moons.find(x => x.cp === moonSel.value);
            saveCfg({ moonCp: moonSel.value || null, moonCoords: m ? m.coords : null });
        });
        leadIn.addEventListener('change', () => {
            let v = parseInt(leadIn.value, 10);
            if (isNaN(v) || v < 5) v = 10;
            if (v > 120) v = 120;
            leadIn.value = v;
            saveCfg({ leadS: v });
        });
        armBtn.addEventListener('click', () => {
            const c = getInterAuto();
            if (!c.armed) {
                if (!c.moonCp) { setStatus('Choisis la lune d\'intervention', 'error'); return; }
                if (!getSelectedIds().length) { setStatus('Coche des vaisseaux (liste Interception)', 'error'); return; }
                saveCfg({ armed: 1 });
            } else {
                saveCfg({ armed: 0 });
                interAutoHot = false;
            }
            refreshArmBtn();
            interAutoTick();
        });
        refreshArmBtn();
        const testBtn = document.getElementById('ogs-ia-test');
        if (testBtn) testBtn.addEventListener('click', interAutoDryRun);
    })();
    // ---- Trap (leurre) ----
    // Délégation : les inputs % sont recréés à chaque analyse de la porte.
    document.getElementById('ogs-trap-ships').addEventListener('input', (e) => {
        const inp = e.target.closest && e.target.closest('.ogs-trap-pct');
        if (!inp) return;
        let v = parseInt(inp.value, 10);
        if (isNaN(v) || v < 0) v = 0;
        if (v > 100) { v = 100; inp.value = 100; }
        saveTrapPct(parseInt(inp.dataset.id, 10), v);
        updateTrapPreview();
    });
    document.getElementById('ogs-trap-ships').addEventListener('change', (e) => {
        const cb = e.target.closest && e.target.closest('.ogs-trap-cb');
        if (!cb) return;
        saveTrapSel(parseInt(cb.dataset.id, 10), cb.checked);
        const row = cb.closest('.ogs-trap-row');
        if (row) row.style.opacity = cb.checked ? '' : '.45';
        updateTrapPreview();
    });
    document.getElementById('ogs-trap-dest').addEventListener('change', (e) => {
        localStorage.setItem(TRAP_DEST_KEY, e.target.value);
    });
    // Trap 100% BDD : destinations connues + dernière composition de cette
    // lune. La pose relit du frais dans la porte de toute façon.
    function refreshTrapFromDb() {
        const box = document.getElementById('ogs-trap-box');
        if (!box) return;
        if (!getCurIsMoon()) {
            box.style.display = 'none';
            setTrapStatus('Va sur la lune où est ta flotte pour poser un trap', '');
            return;
        }
        const gates = dbGateDestsForHere();
        const cached = dbGetCounts();
        if (!gates.length || !cached) {
            box.style.display = 'none';
            setTrapStatus('BDD incomplète — scanne l\'empire (menu de gauche → BDD locale)', 'error');
            return;
        }
        const destSel = document.getElementById('ogs-trap-dest');
        const savedDest = localStorage.getItem(TRAP_DEST_KEY);
        destSel.innerHTML = gates.map(d =>
            `<option value="${d.id}"${d.id === savedDest ? ' selected' : ''}>${d.label}${destOptionSuffix(d.id)}</option>`).join('');
        trapGate = { dests: gates, counts: cached.counts };
        box.style.display = 'flex';
        renderTrapShipList();
        updateTrapPreview();
        const mins = Math.round((Date.now() - cached.at) / 60000);
        setTrapStatus(`BDD · MAJ il y a ${mins < 1 ? '<1' : mins} min — relecture fraîche à la pose`, '');
    }
    ogsTrapRefreshHook = refreshTrapFromDb;
    refreshTrapFromDb();
    document.getElementById('ogs-trap-go').addEventListener('click', trapDeploy);
    document.getElementById('ogs-trap-preset-save').addEventListener('click', trapPresetSave);
    document.getElementById('ogs-trap-preset-load').addEventListener('click', trapPresetLoad);
    document.getElementById('ogs-trap-preset-del').addEventListener('click', trapPresetDelete);
    refreshTrapPresetSelect();
    const ghosttDate = document.getElementById('ogs-ghostt-date');
    if (ghosttDate && !ghosttDate.value) {
        const d0 = new Date(), pad0 = n => String(n).padStart(2, '0');
        ghosttDate.value = d0.getFullYear() + '-' + pad0(d0.getMonth() + 1) + '-' + pad0(d0.getDate());
    }
    const ghosttGoBtn = document.getElementById('ogs-ghostt-go');
    if (ghosttGoBtn) ghosttGoBtn.addEventListener('click', analyzeGhost);
    const ghosttProps = document.getElementById('ogs-ghostt-props');
    if (ghosttProps) ghosttProps.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('.ogs-ghost-prop');
        if (b) applyGhostProposal(parseInt(b.dataset.idx, 10));
    });
    document.getElementById('ogs-expe').addEventListener('click', toggleExpeditions);
    // Délégation globale : le bouton inline est recréé par l'observer à chaque
    // reconstruction du DOM de fleet1, donc un listener direct se perd.
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('#ogs-expe-inline');
        if (t) { e.preventDefault(); toggleExpeditions(); }
    }, true);
    // Recyclage après saut : checkbox persistée
    const ghostAutoCb = document.getElementById('ogs-ghost-auto');
    ghostAutoCb.checked = isGhostAuto();
    ghostAutoCb.addEventListener('change', () => {
        localStorage.setItem(GHOST_AUTO_KEY, ghostAutoCb.checked ? '1' : '0');
    });
    // ---- Raid timé ----
    const raidDate = document.getElementById('ogs-raid-date');
    const raidTime = document.getElementById('ogs-raid-time');
    const raidMargin = document.getElementById('ogs-raid-margin');
    if (raidDate && !raidDate.value) {
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        raidDate.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    if (raidMargin) raidMargin.addEventListener('change', () => {
        let v = parseInt(raidMargin.value, 10); if (isNaN(v) || v < 0) v = DEFAULT_RAID_MARGIN_MS;
        localStorage.setItem(RAID_MARGIN_KEY, String(v)); raidMargin.value = v;
    });
    const raidGoBtn = document.getElementById('ogs-raid-go');
    if (raidGoBtn) raidGoBtn.addEventListener('click', () => {
        armRaid(raidTime ? raidTime.value : '', raidDate ? raidDate.value : '');
    });
    // Bascule Manuel / Auto (toggle segmenté) + affichage du bloc auto
    const raidModeSeg = document.getElementById('ogs-raid-mode-seg');
    const raidAutoBox = document.getElementById('ogs-raid-auto-box');
    function syncRaidModeUI() {
        const m = getRaidMode();
        if (raidModeSeg) raidModeSeg.querySelectorAll('button').forEach(b => b.classList.toggle('ogs-on', b.dataset.val === m));
        if (raidAutoBox) raidAutoBox.style.display = (m === 'auto') ? 'flex' : 'none';
        updateRaidDisplay();
    }
    function setRaidMode(m) { localStorage.setItem(RAID_MODE_KEY, m); syncRaidModeUI(); }
    if (raidModeSeg) raidModeSeg.querySelectorAll('button').forEach(b =>
        b.addEventListener('click', () => setRaidMode(b.dataset.val)));
    syncRaidModeUI();
    // Liste des vaisseaux du raid auto (repliable) + persistance de la config
    const raidShipsToggle = document.getElementById('ogs-raid-ships-toggle');
    const raidShipList = document.getElementById('ogs-raid-ship-list');
    if (raidShipsToggle && raidShipList) raidShipsToggle.addEventListener('click', () => {
        const open = raidShipList.style.display !== 'flex';
        raidShipList.style.display = open ? 'flex' : 'none';
        raidShipsToggle.textContent = open ? 'Vaisseaux ▴' : 'Vaisseaux ▾';
    });
    applyRaidAutoCfgToUI();
    ['ogs-raid-g','ogs-raid-s','ogs-raid-p','ogs-raid-type','ogs-raid-mission','ogs-raid-speed'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => saveRaidAutoCfg(readRaidAutoCfgFromUI()));
    });
    document.querySelectorAll('.ogs-raid-ship-n').forEach(inp => {
        inp.addEventListener('change', () => saveRaidAutoCfg(readRaidAutoCfgFromUI()));
    });
    setInterval(updateRaidDisplay, 500);
    updateRaidDisplay();
    // ---- Décalage sonde (ACS) ----
    const decaUnionSel = document.getElementById('ogs-deca-union');
    if (decaUnionSel) decaUnionSel.addEventListener('change', refreshDecaUnions);
    const decaGoBtn = document.getElementById('ogs-deca-go');
    if (decaGoBtn) decaGoBtn.addEventListener('click', armDeca);
    const decaDelayEl = document.getElementById('ogs-deca-delay');
    if (decaDelayEl) { decaDelayEl.addEventListener('input', updateDecaPreview); decaDelayEl.addEventListener('change', updateDecaPreview); }
    if (decaUnionSel) decaUnionSel.addEventListener('change', updateDecaPreview);
    refreshDecaUnions();
    setInterval(refreshDecaUnions, 5000);
    setInterval(updateDecaPreview, 2000);   // tient à jour "envoi dans Xs"
    // ---- Auto-refresh ----
    const refreshCb = document.getElementById('ogs-refresh-cb');
    refreshCb.addEventListener('change', toggleRefresh);
    function onBoundsChange() {
        const min = parseFloat(document.getElementById('ogs-refresh-min').value);
        const max = parseFloat(document.getElementById('ogs-refresh-max').value);
        if (isNaN(min) || isNaN(max)) return;
        saveRefreshBounds(min, max);
        const b = getRefreshBounds();
        document.getElementById('ogs-refresh-min').value = b.min;
        document.getElementById('ogs-refresh-max').value = b.max;
        restartRefreshIfEnabled();
    }
    document.getElementById('ogs-refresh-min').addEventListener('change', onBoundsChange);
    document.getElementById('ogs-refresh-max').addEventListener('change', onBoundsChange);
    if (isRefreshEnabled()) {
        refreshCb.checked = true;
        scheduleRefresh();
    }
    // ---- Notification attaque ----
    document.getElementById('ogs-cooldown-reset').addEventListener('click', resetCooldown);
    document.getElementById('ogs-sched-refresh').addEventListener('click', updateScheduledList);
    // Délégation : la liste est reconstruite à chaque refresh, un listener direct se perdrait
    document.getElementById('ogs-sched-list').addEventListener('click', (e) => {
        const del = e.target.closest && e.target.closest('.ogs-sched-del');
        if (del && del.dataset.mid) deleteScheduledNotif(del.dataset.mid);
    });
    updateScheduledList();
    setInterval(updateScheduledList, 120000); // rafraîchi toutes les 2 min
    const cooldownInput = document.getElementById('ogs-cooldown-min');
    cooldownInput.addEventListener('change', () => {
        let v = parseFloat(cooldownInput.value);
        if (isNaN(v) || v < 0) v = DEFAULT_NOTIF_COOLDOWN_MIN;
        saveNotifCooldownMin(v);
        cooldownInput.value = v;
        updateCooldownDisplay();
    });
    // ---- Notification programmée (ntfy 'At') + messages pré-enregistrés ----
    const notifMsgSel = document.getElementById('ogs-notif-msg');
    const notifDate   = document.getElementById('ogs-notif-date');
    const notifTime   = document.getElementById('ogs-notif-time');
    const notifNew    = document.getElementById('ogs-notif-new');
    // Date par défaut = aujourd'hui (locale)
    if (notifDate && !notifDate.value) {
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        notifDate.value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
    function refreshNotifMsgOptions(selectVal) {
        if (!notifMsgSel) return;
        notifMsgSel.innerHTML = getSavedNotifMsgs().map(m => '<option>' + escapeHtml(m) + '</option>').join('');
        if (selectVal != null) notifMsgSel.value = selectVal;
    }
    const notifGoBtn = document.getElementById('ogs-notif-go');
    if (notifGoBtn) notifGoBtn.addEventListener('click', () => {
        scheduleCustomNotif(
            notifMsgSel ? notifMsgSel.value : '',
            notifDate ? notifDate.value : '',
            notifTime ? notifTime.value : ''
        );
    });
    // Série récurrente : persistance des réglages + bouton
    const recurInt = document.getElementById('ogs-recur-int');
    const recurDur = document.getElementById('ogs-recur-dur');
    if (recurInt) recurInt.addEventListener('change', () => {
        let v = parseInt(recurInt.value, 10); if (isNaN(v) || v < 1) v = DEFAULT_RECUR_INT;
        localStorage.setItem(RECUR_INT_KEY, String(v)); recurInt.value = v;
    });
    if (recurDur) recurDur.addEventListener('change', () => {
        let v = parseInt(recurDur.value, 10); if (isNaN(v) || v < 1) v = DEFAULT_RECUR_DUR;
        localStorage.setItem(RECUR_DUR_KEY, String(v)); recurDur.value = v;
    });
    const recurGoBtn = document.getElementById('ogs-recur-go');
    if (recurGoBtn) recurGoBtn.addEventListener('click', () => {
        scheduleRecurringNotif(
            notifMsgSel ? notifMsgSel.value : '',
            recurInt ? recurInt.value : DEFAULT_RECUR_INT,
            recurDur ? recurDur.value : DEFAULT_RECUR_DUR
        );
    });
    const notifAddBtn = document.getElementById('ogs-notif-add');
    if (notifAddBtn) notifAddBtn.addEventListener('click', () => {
        const v = ((notifNew && notifNew.value) || '').trim();
        if (!v) return;
        const arr = getSavedNotifMsgs();
        if (!arr.includes(v)) { arr.push(v); saveNotifMsgs(arr); }
        if (notifNew) notifNew.value = '';
        refreshNotifMsgOptions(v);
        setStatus('Message enregistré', 'ok');
    });
    const notifDelBtn = document.getElementById('ogs-notif-del');
    if (notifDelBtn) notifDelBtn.addEventListener('click', () => {
        if (!notifMsgSel) return;
        const cur = notifMsgSel.value;
        let arr = getSavedNotifMsgs().filter(m => m !== cur);
        if (!arr.length) arr = DEFAULT_NOTIF_MSGS.slice();
        saveNotifMsgs(arr);
        refreshNotifMsgOptions();
        setStatus('Message supprimé', 'ok');
    });
    // ---- Sniper d'enchère ----
    const snipeCb = document.getElementById('ogs-snipe-cb');
    snipeCb.checked = isSnipeArmed();
    snipeCb.addEventListener('change', toggleSnipe);
    updateSnipeArmedUI();   // grise les réglages si non armé au chargement
    // Choix ressource : Métal OU Cristal (toggle segmenté)
    const resSeg = document.getElementById('ogs-res-seg');
    if (resSeg) {
        const syncResUI = () => {
            const r = getSnipeResource();
            resSeg.querySelectorAll('button').forEach(b => b.classList.toggle('ogs-on', b.dataset.val === r));
        };
        syncResUI();
        resSeg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
            localStorage.setItem(SNIPE_RESOURCE_KEY, b.dataset.val);
            syncResUI();
            setStatus('Mise en ' + (b.dataset.val === 'crystal' ? 'cristal (×1.5)' : 'métal'), 'ok');
            updateSnipeDisplay();
        }));
    }
    const rafaleCb = document.getElementById('ogs-snipe-rafale');
    rafaleCb.checked = isRafaleOn();
    rafaleCb.addEventListener('change', () => {
        localStorage.setItem(SNIPE_RAFALE_KEY, rafaleCb.checked ? '1' : '0');
        setStatus(rafaleCb.checked ? 'Rafale activée' : 'Rafale désactivée', 'ok');
        // (re)planifie si une vente est déjà armée
        if (rafaleCb.checked) { if (snipe.armed) scheduleRafale(); } else { stopRafale(); }
    });
    const bindSnipeNum = (id, key, def) => {
        const el = document.getElementById(id);
        el.addEventListener('change', () => {
            let v = parseInt(el.value, 10);
            if (isNaN(v) || v < 0) v = def;
            localStorage.setItem(key, String(v));
            el.value = v;
            updateSnipeDisplay();
        });
    };
    bindSnipeNum('ogs-snipe-margin', SNIPE_MARGIN_KEY, DEFAULT_SNIPE_MARGIN_MS);
    bindSnipeNum('ogs-snipe-max', SNIPE_MAXMETAL_KEY, DEFAULT_SNIPE_MAXMETAL);
    bindSnipeNum('ogs-snipe-bump', SNIPE_BUMP_KEY, 0);
    bindSnipeNum('ogs-snipe-rafale-bump', SNIPE_RAFALE_BUMP_KEY, DEFAULT_SNIPE_RAFALE_BUMP);
    bindSnipeNum('ogs-snipe-rafale-interval', SNIPE_RAFALE_INTERVAL_KEY, DEFAULT_SNIPE_RAFALE_INTERVAL);
    bindSnipeNum('ogs-snipe-rafale-window', SNIPE_RAFALE_WINDOW_KEY, DEFAULT_SNIPE_RAFALE_WINDOW_S); // liste déroulante 1..10 s
    // ---- Maintien des expéditions (heures) ----
    const expeHoldInput = document.getElementById('ogs-expe-hold');
    if (expeHoldInput) {
        expeHoldInput.value = getExpeHoldHours();
        expeHoldInput.addEventListener('change', () => {
            let v = parseInt(expeHoldInput.value, 10);
            if (isNaN(v) || v < 1) v = DEFAULT_EXPE_HOLD_HOURS;
            if (v > 20) v = 20;
            localStorage.setItem(EXPE_HOLD_KEY, String(v));
            expeHoldInput.value = v;
            setStatus('Maintien expédition : ' + v + ' h', 'ok');
        });
    }
    const expeCountSel = document.getElementById('ogs-expe-count');
    if (expeCountSel) {
        expeCountSel.addEventListener('change', () => {
            let v = parseInt(expeCountSel.value, 10);
            if (isNaN(v) || v < 0) v = 0;
            localStorage.setItem(EXPE_COUNT_KEY, String(v));
            setStatus(v === 0 ? 'Expéditions : toutes' : 'Expéditions : ' + v + ' slot(s)', 'ok');
        });
    }
    document.getElementById('ogs-snipe-remeasure').addEventListener('click', () => {
        setStatus('Mesure offset...', 'busy');
        measureSnipeOffset().then(() => setStatus('Offset mesuré', 'ok'));
    });
    initSnipeIfNeeded();
    setInterval(updateSnipeDisplay, 500);
    // Re-mesure périodique de l'offset horloge (toutes les 2 min) si armé
    setInterval(() => { if (isSnipeArmed() && isAuctioneerPage()) measureSnipeOffset(); }, 120000);
    // ---- Détection alerte + cooldown ----
    setTimeout(checkAlert, 3000);
    setInterval(checkAlert, 30000);
    updateCooldownDisplay();
    setInterval(updateCooldownDisplay, 1000);
    // ---- Expéditions + Ghost + boutons inline : reprise au chargement ----
    setTimeout(() => {
        // Nouvelle page = aucune étape en cours : on nettoie un éventuel
        // busy=true resté coincé si une page a rechargé en plein milieu.
        const st0 = loadExpeState();
        if (st0 && st0.busy) { st0.busy = false; saveExpeState(st0); }
        expeStepInFlight = false;
        injectInlineButtons();
        updateExpeButtons();
        resumeExpeditionsIfNeeded();
        consumeGhostPendingIfNeeded();
        consumeDecaSpyIfNeeded();
    }, 400);
    // Observer : re-détecte le retour AJAX sur fleet1, ré-ancre le panneau,
    // ré-injecte les boutons et relance l'étape expédition si besoin.
    let obsDebounce = null;
    const obs = new MutationObserver(() => {
        anchorPanel();
        injectInlineButtons();
        clearTimeout(obsDebounce);
        obsDebounce = setTimeout(() => {
            resumeExpeditionsIfNeeded();
            consumeGhostPendingIfNeeded();
            consumeDecaSpyIfNeeded();
        }, 600);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // ---- Repli / déploiement du panneau ----
    const COLLAPSE_KEY = 'ogs_panel_collapsed';
    const isMobile = window.matchMedia('(max-width: 900px)').matches;
    const panelEl = document.getElementById('ogs-panel');
    const collapseBtn = document.getElementById('ogs-collapse-btn');
    function applyCollapsed(collapsed) {
        panelEl.classList.toggle('ogs-collapsed', collapsed);
        collapseBtn.textContent = collapsed ? '▸' : '▾';
        localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    }
    const savedCollapsed = localStorage.getItem(COLLAPSE_KEY);
    applyCollapsed(savedCollapsed !== null ? savedCollapsed === '1' : isMobile);
    document.getElementById('ogs-header').addEventListener('click', () => {
        applyCollapsed(!panelEl.classList.contains('ogs-collapsed'));
    });
    // ---- Entrée "BDD locale" dans le menu de gauche d'OGame ----
    // Le contenu se déplie dans un volet flottant ancré au menu (déplié par défaut).
    (function injectLeftMenu() {
        const menu = document.querySelector('#menuTable');
        if (!menu || document.getElementById('ogs-menu-db')) return;
        // Volet flottant
        const fly = document.createElement('div');
        fly.id = 'ogs-db-flyout';
        fly.innerHTML =
            `<div id="ogs-db-fly-head"><span>🗄 BDD LOCALE</span><span id="ogs-db-fly-close" title="Replier">✕</span></div>` +
            `<div id="ogs-db-status" style="font-size:10px;line-height:1.6;color:#bcd4ea;"></div>` +
            `<button id="ogs-db-scan" class="ogs-btn ogs-btn-sub">🔄 Scanner l'empire</button>` +
            `<div id="ogs-db-view" style="display:flex;flex-direction:column;gap:4px;"></div>` +
            `<div style="display:flex;gap:6px;border-top:1px solid var(--bd);padding-top:8px;">` +
            `<button id="ogs-cfg-export" class="ogs-btn ogs-btn-sub" style="flex:1;">⬇ Exporter config</button>` +
            `<button id="ogs-cfg-import" class="ogs-btn ogs-btn-sub" style="flex:1;">⬆ Importer</button>` +
            `<input type="file" id="ogs-cfg-file" accept="application/json" style="display:none;">` +
            `</div>`;
        document.body.appendChild(fly);
        // Entrée de menu
        const li = document.createElement('li');
        li.id = 'ogs-menu-db';
        li.innerHTML = `<span class="menu_icon" style="text-align:center;line-height:26px;">🗄</span>` +
            `<a class="menubutton" href="#" style="cursor:pointer;"><span class="textlabel">BDD locale</span></a>`;
        menu.appendChild(li);
        const FLY_KEY = 'ogs_db_flyout_open';
        function positionFly() {
            const r = li.getBoundingClientRect();
            fly.style.left = Math.round(r.right + 10) + 'px';
            const maxTop = window.innerHeight - Math.min(fly.offsetHeight || 300, window.innerHeight * 0.7) - 10;
            fly.style.top = Math.max(10, Math.min(Math.round(r.top), maxTop)) + 'px';
        }
        function applyFly(open) {
            fly.style.display = open ? 'flex' : 'none';
            localStorage.setItem(FLY_KEY, open ? '1' : '0');
            if (open) { updateDbStatus(); positionFly(); }
        }
        li.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            applyFly(fly.style.display === 'none');
        });
        fly.querySelector('#ogs-db-fly-close').addEventListener('click', () => applyFly(false));
        fly.querySelector('#ogs-db-scan').addEventListener('click', () => {
            updateDbStatus();
            dbEmpireScan('manuel');
        });
        // Export / import de toute la config OGSentinel (clés ogs_* et pds_*)
        fly.querySelector('#ogs-cfg-export').addEventListener('click', () => {
            const data = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (/^(ogs_|pds_)/.test(k)) data[k] = localStorage.getItem(k);
            }
            const blob = new Blob([JSON.stringify({ ogsentinel: 1, exportedAt: new Date().toISOString(), data }, null, 1)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'ogsentinel-config.json';
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        });
        const cfgFile = fly.querySelector('#ogs-cfg-file');
        fly.querySelector('#ogs-cfg-import').addEventListener('click', () => cfgFile.click());
        cfgFile.addEventListener('change', () => {
            const f = cfgFile.files && cfgFile.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = () => {
                try {
                    const j = JSON.parse(rd.result);
                    if (!j || j.ogsentinel !== 1 || !j.data) throw new Error('format');
                    Object.keys(j.data).forEach(k => {
                        if (/^(ogs_|pds_)/.test(k)) localStorage.setItem(k, j.data[k]);
                    });
                    location.reload();
                } catch (e) {
                    updateDbStatus('Fichier de config invalide');
                }
            };
            rd.readAsText(f);
        });
        const saved = localStorage.getItem(FLY_KEY);
        applyFly(saved === '1');                            // défaut : plié
        window.addEventListener('resize', () => { if (fly.style.display !== 'none') positionFly(); });
    })();
})();
