import { localDateInput, possibleLocalTimes } from './time-input';
import { parseWorkHours } from './work-hours';
import { dailyTargetMs, hoursMs, weeklyTargetMs } from '../core/work-goals';
import type { AppError, Command, Environment, Locale, Project, RecordInput, Result, Snapshot, TimeRecord, WindowKind, WorkspaceView } from '../shared';

const en = {
  menuBarDisplay: 'Menu bar', showRemaining: 'Show remaining working time', showRemainingHelp: 'Off: worked time. On: time left until your daily target.', showRemainingFallback: 'Without a daily target, worked time is shown. Overtime appears with a minus sign.',
  workGoals: 'Working time targets', workGoalsIntro: 'Your regular hours, day by day.', workGoalsHelp: '0 = day off · Decimal hours: 7.6 h = 7 h 36 min', hours: 'hours', weeklyTarget: 'Weekly target', goalDays: '{days} working days · Mon–Sun', dayOff: 'Day off', goalReminders: 'Notifications', dailyGoalToggle: 'Daily target reached', weeklyGoalToggle: 'Weekly target reached', dailyGoalHelp: 'One notification per day', weeklyGoalHelp: 'One notification per week', goalNotificationSummary: 'About notifications', goalNotificationHelp: 'Breaks and unresolved time are excluded. Notifications do not repeat after restarting timi. Allow notifications for timi in System Settings → Notifications.', invalidWorkHours: 'Enter 0 to 24 hours for each weekday, for example 7.6 or 7,6.', target: 'Target',
  loading: 'Opening timi…', today: 'WORKED TODAY', untracked: 'Ready when you are', untrackedDetail: 'Choose a project to start working.', working: 'Working', manualBreak: 'On a break', breakDetail: 'Your break continues until you choose.', pending: 'Time needs clarification', pendingDetail: 'Resolve the open question before continuing.',
  pause: 'Pause', play: 'Play', stop: 'Stop', project: 'Project', projectPlaceholder: 'What are you working on?', entryHint: 'Enter starts a project. Esc closes this window.', entryKeys: '↑ ↓ to select · ↵ to start', current: 'Running', noProjects: 'Type a name and press Enter to create your first project.', noMatches: 'Press Enter to start this new project.', overview: 'Week overview', settings: 'Settings', quit: 'Quit timi',
  reminderTitle: 'Ready to track your time?', reminderText: 'You have been active without a project. Choose one to start now, or take a break.', later: 'Later', startBreak: 'Start break',
  weekTitle: 'Your week', weekSubtitle: 'A clear view of where your time went.', previousWeek: 'Previous week', nextWeek: 'Next week', thisWeek: 'This week', workTotal: 'Working time', breaks: 'Breaks', trackedProjects: 'Projects', actualTime: 'Actual elapsed time · H:MM', breaksSeparate: 'Not included in working time', projectsThisWeek: 'With work this week', total: 'Total', dailyTotal: 'Daily work', archived: 'archived', emptyWeek: 'No working time in this week yet.',
  records: 'Time records', addRecord: 'Add time', emptyRecords: 'Saved work and break periods will appear here.', start: 'Start', end: 'End', type: 'Type', duration: 'Duration', work: 'Work', break: 'Break', edit: 'Edit', trackedSource: 'Tracked', manualSource: 'Correction', idleSource: 'Inactivity clarified', recoverySource: 'Recovered', live: 'Ongoing', unresolved: 'Unresolved', dayNote: 'Days follow the current local time zone. Totals add milliseconds before showing hours and minutes; no rounding is applied. Unresolved time is excluded.',
  manageProjects: 'Manage projects', manageHelp: 'Rename a project without changing its history. Archived projects stay in reports.', createProject: 'Create project', newProjectName: 'New project name', rename: 'Rename', archive: 'Archive', restore: 'Restore', noManagedProjects: 'No projects yet.',
  settingsTitle: 'Settings', settingsIntro: 'A few preferences. Everything stays on this Mac.', timing: 'Timing', idleThreshold: 'Ask after inactivity', idleHelp: 'When this threshold is reached, all time since your last activity awaits clarification. The current inactivity streak uses the new value immediately.', reminderInterval: 'Remind me to choose a project', reminderHelp: 'Counts only active use without tracking. Work, breaks, sleep, lock and inactivity do not count.', minutes: 'minutes', saveSettings: 'Save preferences', saved: 'Preferences saved', launchAtLogin: 'Open timi at login', loginHelp: 'Start in the menu bar, ready for you to choose a project.', loginUnavailable: 'Available in the packaged macOS app.', loginApproval: 'Allow timi in System Settings → General → Login Items to enable this.', privacy: 'Local and offline. timi reads only the system’s inactivity duration; it never reads what you type or which apps you use.', version: 'Version {version} · macOS 13+',
  clarificationTitle: 'How should this time count?', clarificationIdle: 'You were away from your keyboard or your Mac was locked or asleep. Choose how to record the whole interval.', clarificationRecovery: 'timi did not finish its previous session cleanly. Review the saved uncertainty once; tracking will remain stopped.', idleContinuing: 'This interval continues through your decision, including any further inactivity. Your previous project resumes at that instant unless tracking has ended.', fixedContinuing: 'Tracking has ended. This interval has a fixed end, and answering will not resume tracking.', recoveryContinuing: 'Only the saved uncertain interval is included. Time while timi was closed is never added.', workFor: 'Work for {project}', workChoice: 'Record as work', breakChoice: 'Record as a break', discardChoice: 'Discard this time', breakChoiceHelp: 'A break without a project', discardChoiceHelp: 'Exclude it from work and breaks', recoveryProject: 'Project for recovered work', recoveryPlaceholder: 'Choose or enter a project', recoveryHelp: 'Recovery can be assigned to another project. A new name creates a project.', intervalFrom: 'From {date}', intervalTo: 'To {date}', awaiting: 'All time has been classified.',
  addTimeTitle: 'Add missing time', editTimeTitle: 'Edit time record', editHelp: 'Changes are saved together. Existing records and ongoing tracking must not overlap.', addHelp: 'Add work or a projectless break. Create projects below the week table if needed.', segment: 'Period {number}', split: 'Split', removeSegment: 'Remove', splitHelp: 'Split at the midpoint, then adjust the shared boundary and assignment before saving.', saveChanges: 'Save changes', cancel: 'Cancel', deleteRecord: 'Delete record', deleteConfirm: 'Delete this record permanently? This removes its time from all totals.', confirmDelete: 'Delete permanently', keepRecord: 'Keep record', chooseProject: 'Choose a project', boundaryHelp: 'Local time · seconds and milliseconds are preserved. Offset: {offset}', ambiguousTime: 'This clock time occurs twice. Choose which occurrence.', firstOccurrence: 'First occurrence ({offset})', secondOccurrence: 'Second occurrence ({offset})', exactDuration: '{hours} h {minutes} min {seconds} s', invalidDate: 'Enter a valid start and end, with the end after the start.', invalidProject: 'Select a project for each work period.', invalidSettings: 'Use positive whole minutes that can be represented safely. Preferences were not changed.', projectNameRequired: 'Enter a project name.', splitTooShort: 'This period is too short to split.',
  errorStorage: 'timi could not save or read its data. Your previous state has been preserved. Check free disk space and folder access, then try again.', errorStorageVersion: 'This data was created by a newer timi version. It has not been replaced.', errorStorageInvalid: 'The saved data cannot be read safely. It has not been replaced.', errorCommand: 'This action is not valid right now.', errorProjectExists: 'A project with that name already exists. Choose a different name.', errorInvalidProject: 'Enter or select a valid project.', errorProjectMissing: 'That project could not be found. Refresh and try again.', errorPending: 'Resolve the pending time question before starting work or a break.', errorOverlap: 'This period overlaps saved or ongoing work or a break. Adjust its boundaries; no records were changed.', errorRecordMissing: 'That record no longer exists. Close this editor and try again.', errorClock: 'The system clock moved backwards or is invalid. Check the date and time and try again.', errorGeneric: 'The action could not be completed. Please try again.', errorActivity: 'macOS inactivity could not be read. Please try again; timi has kept the previous state.', errorLogin: 'The macOS login setting could not be updated. Check System Settings → General → Login Items.', errorConflictTime: 'Conflicting interval: {start} – {end}.', errorDetailsProject: 'Project: {project}.', dismissError: 'Dismiss message', close: 'Close', refresh: 'Refresh', noProject: 'No project',
} as const;
const de: Record<keyof typeof en, string> = {
  menuBarDisplay: 'Menüleiste', showRemaining: 'Restarbeitszeit anzeigen', showRemainingHelp: 'Aus: gearbeitete Zeit. Ein: verbleibende Zeit bis zum Tagesziel.', showRemainingFallback: 'Ohne Tagesziel wird die gearbeitete Zeit angezeigt. Überstunden erscheinen mit Minuszeichen.',
  workGoals: 'Arbeitszeitziele', workGoalsIntro: 'Deine reguläre Arbeitszeit pro Tag.', workGoalsHelp: '0 = frei · Dezimalstunden: 7,6 h = 7 Std. 36 Min.', hours: 'Stunden', weeklyTarget: 'Wochenziel', goalDays: '{days} Arbeitstage · Mo–So', dayOff: 'Frei', goalReminders: 'Benachrichtigungen', dailyGoalToggle: 'Tagesziel erreicht', weeklyGoalToggle: 'Wochenziel erreicht', dailyGoalHelp: 'Eine Mitteilung pro Tag', weeklyGoalHelp: 'Eine Mitteilung pro Woche', goalNotificationSummary: 'Hinweise zu Mitteilungen', goalNotificationHelp: 'Pausen und ungeklärte Zeit zählen nicht mit. Mitteilungen wiederholen sich auch nach einem Neustart von timi nicht. Erlaube Mitteilungen für timi unter Systemeinstellungen → Mitteilungen.', invalidWorkHours: 'Gib für jeden Wochentag 0 bis 24 Stunden ein, zum Beispiel 7,6 oder 7.6.', target: 'Ziel',
  loading: 'timi wird geöffnet…', today: 'HEUTE GEARBEITET', untracked: 'Bereit, wenn du es bist', untrackedDetail: 'Wähle ein Projekt und starte.', working: 'Arbeit', manualBreak: 'In einer Pause', breakDetail: 'Die Pause läuft bis zu deiner Entscheidung.', pending: 'Zeit wartet auf Klärung', pendingDetail: 'Kläre zuerst die offene Zeitspanne.',
  pause: 'Pause', play: 'Weiter', stop: 'Stopp', project: 'Projekt', projectPlaceholder: 'Woran arbeitest du?', entryHint: 'Enter startet ein Projekt. Esc schließt dieses Fenster.', entryKeys: '↑ ↓ auswählen · ↵ starten', current: 'Läuft', noProjects: 'Gib einen Namen ein und drücke Enter, um dein erstes Projekt anzulegen.', noMatches: 'Drücke Enter, um dieses neue Projekt zu starten.', overview: 'Wochenübersicht', settings: 'Einstellungen', quit: 'timi beenden',
  reminderTitle: 'Möchtest du deine Zeit erfassen?', reminderText: 'Du bist ohne Projekt aktiv. Wähle ein Projekt und starte jetzt, oder beginne eine Pause.', later: 'Später', startBreak: 'Pause starten',
  weekTitle: 'Deine Woche', weekSubtitle: 'Ein klarer Überblick über deine Zeit.', previousWeek: 'Vorherige Woche', nextWeek: 'Nächste Woche', thisWeek: 'Diese Woche', workTotal: 'Arbeitszeit', breaks: 'Pausen', trackedProjects: 'Projekte', actualTime: 'Tatsächliche Dauer · H:MM', breaksSeparate: 'Nicht in der Arbeitszeit enthalten', projectsThisWeek: 'Mit Arbeitszeit in dieser Woche', total: 'Gesamt', dailyTotal: 'Arbeitszeit pro Tag', archived: 'archiviert', emptyWeek: 'In dieser Woche gibt es noch keine Arbeitszeit.',
  records: 'Zeiteinträge', addRecord: 'Zeit ergänzen', emptyRecords: 'Gespeicherte Arbeits- und Pausenzeiten erscheinen hier.', start: 'Beginn', end: 'Ende', type: 'Art', duration: 'Dauer', work: 'Arbeit', break: 'Pause', edit: 'Bearbeiten', trackedSource: 'Erfasst', manualSource: 'Korrektur', idleSource: 'Abwesenheit geklärt', recoverySource: 'Wiederhergestellt', live: 'Läuft', unresolved: 'Ungeklärt', dayNote: 'Die Tage folgen der aktuellen lokalen Zeitzone. Millisekunden werden vor der Anzeige in Stunden und Minuten addiert; es wird nicht gerundet. Ungeklärte Zeit ist ausgeschlossen.',
  manageProjects: 'Projekte verwalten', manageHelp: 'Umbenennen erhält die gesamte Historie. Archivierte Projekte bleiben in Berichten sichtbar.', createProject: 'Projekt anlegen', newProjectName: 'Neuer Projektname', rename: 'Umbenennen', archive: 'Archivieren', restore: 'Wiederherstellen', noManagedProjects: 'Noch keine Projekte.',
  settingsTitle: 'Einstellungen', settingsIntro: 'Ein paar Vorlieben. Alles bleibt auf diesem Mac.', timing: 'Zeitintervalle', idleThreshold: 'Nach Inaktivität fragen', idleHelp: 'Ab diesem Grenzwert wartet die gesamte Zeit seit deiner letzten Aktivität auf Klärung. Der neue Wert gilt sofort für die laufende Inaktivität.', reminderInterval: 'An die Projektwahl erinnern', reminderHelp: 'Zählt nur aktive Nutzung ohne Erfassung. Arbeit, Pausen, Ruhezustand, Sperre und Inaktivität zählen nicht.', minutes: 'Minuten', saveSettings: 'Einstellungen speichern', saved: 'Einstellungen gespeichert', launchAtLogin: 'timi beim Anmelden öffnen', loginHelp: 'Startet in der Menüleiste, bereit für deine Projektwahl.', loginUnavailable: 'In der verpackten macOS-App verfügbar.', loginApproval: 'Erlaube timi unter Systemeinstellungen → Allgemein → Anmeldeobjekte, um dies zu aktivieren.', privacy: 'Lokal und offline. timi liest nur die Inaktivitätsdauer des Systems; niemals Eingaben oder Informationen über verwendete Apps.', version: 'Version {version} · macOS 13+',
  clarificationTitle: 'Wie soll diese Zeit zählen?', clarificationIdle: 'Du warst nicht an der Tastatur, oder dein Mac war gesperrt oder im Ruhezustand. Ordne die gesamte Zeitspanne zu.', clarificationRecovery: 'Die letzte Sitzung von timi wurde nicht sauber beendet. Kläre die gespeicherte unsichere Zeit einmalig; die Erfassung bleibt gestoppt.', idleContinuing: 'Die Zeitspanne läuft bis zu deiner Entscheidung weiter, auch bei erneuter Inaktivität. Danach läuft das vorherige Projekt weiter, sofern die Erfassung nicht beendet wurde.', fixedContinuing: 'Die Erfassung wurde beendet. Diese Zeitspanne hat ein festes Ende. Die Antwort startet keine neue Erfassung.', recoveryContinuing: 'Nur die gespeicherte unsichere Zeitspanne zählt. Zeit bei geschlossener App wird niemals ergänzt.', workFor: 'Arbeit für {project}', workChoice: 'Als Arbeit erfassen', breakChoice: 'Als Pause erfassen', discardChoice: 'Diese Zeit verwerfen', breakChoiceHelp: 'Eine Pause ohne Projekt', discardChoiceHelp: 'Weder als Arbeit noch als Pause zählen', recoveryProject: 'Projekt für wiederhergestellte Arbeit', recoveryPlaceholder: 'Projekt auswählen oder eingeben', recoveryHelp: 'Bei der Wiederherstellung ist ein anderes Projekt möglich. Ein neuer Name legt ein Projekt an.', intervalFrom: 'Von {date}', intervalTo: 'Bis {date}', awaiting: 'Alle Zeitspannen wurden geklärt.',
  addTimeTitle: 'Fehlende Zeit ergänzen', editTimeTitle: 'Zeiteintrag bearbeiten', editHelp: 'Alle Änderungen werden gemeinsam gespeichert. Gespeicherte Zeiten und laufende Erfassung dürfen sich nicht überschneiden.', addHelp: 'Ergänze Arbeit oder eine Pause ohne Projekt. Neue Projekte kannst du unter der Wochentabelle anlegen.', segment: 'Zeitraum {number}', split: 'Teilen', removeSegment: 'Entfernen', splitHelp: 'Teilt in der Mitte. Passe vor dem Speichern die gemeinsame Grenze und Zuordnung an.', saveChanges: 'Änderungen speichern', cancel: 'Abbrechen', deleteRecord: 'Eintrag löschen', deleteConfirm: 'Diesen Eintrag endgültig löschen? Seine Zeit wird aus allen Summen entfernt.', confirmDelete: 'Endgültig löschen', keepRecord: 'Eintrag behalten', chooseProject: 'Projekt auswählen', boundaryHelp: 'Ortszeit · Sekunden und Millisekunden bleiben erhalten. Versatz: {offset}', ambiguousTime: 'Diese Uhrzeit kommt zweimal vor. Wähle den gewünschten Zeitpunkt.', firstOccurrence: 'Erstes Vorkommen ({offset})', secondOccurrence: 'Zweites Vorkommen ({offset})', exactDuration: '{hours} Std. {minutes} Min. {seconds} Sek.', invalidDate: 'Gib gültige Zeiten ein. Das Ende muss nach dem Beginn liegen.', invalidProject: 'Wähle für jeden Arbeitszeitraum ein Projekt.', invalidSettings: 'Verwende positive ganze Minuten, die sicher darstellbar sind. Die Einstellungen wurden nicht geändert.', projectNameRequired: 'Gib einen Projektnamen ein.', splitTooShort: 'Dieser Zeitraum ist zum Teilen zu kurz.',
  errorStorage: 'timi konnte die Daten nicht speichern oder lesen. Der vorherige Zustand wurde erhalten. Prüfe freien Speicherplatz und Ordnerzugriff und versuche es erneut.', errorStorageVersion: 'Diese Daten stammen aus einer neueren timi-Version. Sie wurden nicht ersetzt.', errorStorageInvalid: 'Die gespeicherten Daten können nicht sicher gelesen werden. Sie wurden nicht ersetzt.', errorCommand: 'Diese Aktion ist gerade nicht möglich.', errorProjectExists: 'Ein Projekt mit diesem Namen existiert bereits. Wähle einen anderen Namen.', errorInvalidProject: 'Gib ein gültiges Projekt ein oder wähle eines aus.', errorProjectMissing: 'Dieses Projekt wurde nicht gefunden. Aktualisiere die Ansicht und versuche es erneut.', errorPending: 'Kläre die offene Zeitspanne, bevor du Arbeit oder eine Pause startest.', errorOverlap: 'Dieser Zeitraum überschneidet sich mit gespeicherter oder laufender Arbeit oder einer Pause. Passe die Grenzen an; kein Eintrag wurde geändert.', errorRecordMissing: 'Dieser Eintrag existiert nicht mehr. Schließe den Editor und versuche es erneut.', errorClock: 'Die Systemuhr wurde zurückgestellt oder ist ungültig. Prüfe Datum und Uhrzeit und versuche es erneut.', errorGeneric: 'Die Aktion konnte nicht abgeschlossen werden. Bitte versuche es erneut.', errorActivity: 'Die macOS-Inaktivität konnte nicht gelesen werden. Versuche es erneut; timi hat den vorherigen Zustand erhalten.', errorLogin: 'Die macOS-Anmeldeeinstellung konnte nicht aktualisiert werden. Prüfe Systemeinstellungen → Allgemein → Anmeldeobjekte.', errorConflictTime: 'Überschneidung: {start} – {end}.', errorDetailsProject: 'Projekt: {project}.', dismissError: 'Meldung schließen', close: 'Schließen', refresh: 'Aktualisieren', noProject: 'Kein Projekt',
};
type TextKey = keyof typeof en;
let locale: Locale = 'en';
let env: Environment;
let state: Snapshot;
let weekOffset = 0;
let busy = false;
let refreshing = false;
let queuedRefresh = false;
let projectSignature = '';
let editorAlert: HTMLElement | null = null;
const rawKind = new URLSearchParams(location.search).get('window');
const kind: WindowKind = rawKind === 'overview' || rawKind === 'clarification' ? rawKind : 'entry';
let workspaceView: WorkspaceView = 'overview';
let overviewPage: HTMLElement;
let settingsPage: HTMLElement;
const viewScroll = { overview: 0, settings: 0 };
const app = document.querySelector<HTMLElement>('#app')!;
const errors = document.createElement('div');
errors.setAttribute('role', 'alert');
const content = document.createElement('div');
app.append(errors, content);

function t(key: TextKey, values: Record<string, string | number> = {}): string {
  let value: string = (locale === 'de' ? de : en)[key];
  for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
  return value;
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (className) node.className = className; if (text) node.textContent = text; return node;
}
function button(text: string, action: () => void | Promise<unknown>, className = ''): HTMLButtonElement {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', () => { void action(); }); return node;
}
function append(parent: Node, ...children: Node[]): void { for (const child of children) parent.appendChild(child); }
function labelField(label: string, input: HTMLElement, help?: string): HTMLElement {
  const field = el('div', 'field'); const labelNode = el('label', '', label);
  if (!input.id) input.id = `field-${++fieldId}`;
  labelNode.htmlFor = input.id; append(field, labelNode, input);
  if (help) { const helpNode = el('p', 'field-help', help); helpNode.id = `${input.id}-help`; input.setAttribute('aria-describedby', helpNode.id); field.append(helpNode); }
  return field;
}
let fieldId = 0;
function fmt(ms: number): string { const minutes = Math.floor(Math.max(0, ms) / 60_000); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`; }
function exact(ms: number): string { const duration = Math.max(0, ms); const seconds = Math.floor(duration / 1_000); return t('exactDuration', { hours: Math.floor(seconds / 3600), minutes: Math.floor(seconds / 60) % 60, seconds: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(duration / 1000 % 60) }); }
function dateTime(ms: number): string { return new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms); }
function shortDate(ms: number): string { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(ms); }
function projectName(id: string | null): string { return state?.projects.find(project => project.id === id)?.name ?? t('noProject'); }
function brand(): HTMLElement { const node = el('div', 'brand', 'timi'); node.append(el('span', 'brand-dot')); return node; }
function errorText(error: AppError): string {
  const map: Record<string, TextKey> = { STORAGE_ERROR: 'errorStorage', STORAGE_VERSION: 'errorStorageVersion', STORAGE_INVALID: 'errorStorageInvalid', INVALID_COMMAND: 'errorCommand', INVALID_SETTINGS: 'invalidSettings', INVALID_PROJECT: 'errorInvalidProject', PROJECT_EXISTS: 'errorProjectExists', PROJECT_NOT_FOUND: 'errorProjectMissing', PENDING_REQUIRED: 'errorPending', INVALID_RANGE: 'invalidDate', OVERLAP: 'errorOverlap', RECORD_NOT_FOUND: 'errorRecordMissing', CLOCK_INVALID: 'errorClock', LOGIN_ERROR: 'errorLogin', ACTIVITY_ERROR: 'errorActivity' };
  let message = t(map[error.code] ?? 'errorGeneric');
  if (error.code === 'OVERLAP' && typeof error.details?.start === 'number' && typeof error.details?.end === 'number') message += ` ${t('errorConflictTime', { start: dateTime(error.details.start), end: dateTime(error.details.end) })}`;
  if (error.code === 'OVERLAP' && typeof error.details?.projectId === 'string') message += ` ${t('errorDetailsProject', { project: projectName(error.details.projectId) })}`;
  return message;
}
function showError(error: AppError | string): void {
  const text = typeof error === 'string' ? error : errorText(error);
  if (editorAlert) editorAlert.textContent = text;
  if (errors.textContent?.includes(text)) return;
  errors.replaceChildren(); const banner = el('div', 'error-banner'); const message = el('span', 'grow', text);
  const close = button('×', () => errors.replaceChildren()); close.setAttribute('aria-label', t('dismissError')); append(banner, message, close); errors.append(banner);
}
async function safe<T>(operation: Promise<Result<T>>): Promise<Result<T>> {
  try { return await operation; } catch { return { ok: false, error: { code: 'STORAGE_ERROR' } }; }
}
async function send(command: Command): Promise<boolean> {
  if (busy) return false;
  busy = true; updateBusy();
  const result = await safe(window.timi.command(command));
  busy = false;
  if (!result.ok) { showError(result.error); updateBusy(); return false; }
  state = kind === 'overview' && weekOffset !== 0 ? { ...result.value, week: state.week } : result.value; errors.replaceChildren(); update();
  if (kind === 'overview' && weekOffset !== 0) await refresh();
  return true;
}
async function nativeAction(action: Promise<Result<unknown>>): Promise<void> { const result = await safe(action); if (!result.ok) showError(result.error); }
async function refresh(): Promise<void> {
  if (refreshing) { queuedRefresh = true; return; }
  refreshing = true;
  const result = await safe(window.timi.snapshot(weekOffset));
  refreshing = false;
  if (result.ok) { state = result.value; update(); } else showError(result.error);
  if (queuedRefresh) { queuedRefresh = false; void refresh(); }
}
function updateBusy(): void { for (const control of content.querySelectorAll<HTMLButtonElement>('[data-action]')) control.disabled = busy; }
function markAction(control: HTMLButtonElement): HTMLButtonElement { control.dataset.action = 'true'; return control; }
function update(): void {
  if (!state) return;
  if (kind === 'entry') updateEntry();
  else if (kind === 'overview') updateOverview();
  else if (kind === 'clarification') updateClarification();
  updateBusy();
}

let entryInput: HTMLInputElement;
let suggestions: HTMLUListElement;
let suggestionProjects: Project[] = [];
let selectedSuggestion = -1;
let entryHint: HTMLElement;
let todayValue: HTMLElement;
let statusTitle: HTMLElement;
let statusDetail: HTMLElement;
let statusMark: HTMLElement;
let statusPanel: HTMLElement;
let trackingControls: HTMLElement;
let reminderPanel: HTMLElement;
function buildEntry(): void {
  const page = el('div', 'entry-page'); const header = el('header', 'entry-header'); const today = el('div', 'today');
  todayValue = el('div', 'today-value mono'); append(today, todayValue, el('div', 'today-label', t('today'))); append(header, brand(), today);
  statusPanel = el('section', 'status'); statusMark = el('div', 'status-mark'); statusMark.setAttribute('aria-hidden', 'true');
  const statusText = el('div', 'grow'); statusTitle = el('div', 'status-title'); statusDetail = el('div', 'status-detail'); append(statusText, statusTitle, statusDetail);
  trackingControls = el('div', 'tracking-controls'); append(statusPanel, statusMark, statusText, trackingControls);
  reminderPanel = el('section', 'notice reminder'); append(reminderPanel, el('strong', '', t('reminderTitle')), el('p', '', t('reminderText')));
  const reminderButtons = el('div', 'button-row'); append(reminderButtons, markAction(button(t('later'), async () => { if (await send({ type: 'later' })) await nativeAction(window.timi.closeWindow()); })), markAction(button(t('startBreak'), async () => { if (await send({ type: 'pause' })) await nativeAction(window.timi.closeWindow()); }, 'primary'))); reminderPanel.append(reminderButtons);
  const projectEntry = el('section', 'project-entry'); const label = el('label', 'project-label', t('project')); label.htmlFor = 'project-entry'; label.append(el('span', 'key-hint', t('entryKeys')));
  entryInput = el('input'); entryInput.id = 'project-entry'; entryInput.type = 'text'; entryInput.placeholder = t('projectPlaceholder'); entryInput.autocomplete = 'off'; entryInput.spellcheck = false;
  entryInput.setAttribute('role', 'combobox'); entryInput.setAttribute('aria-autocomplete', 'list'); entryInput.setAttribute('aria-controls', 'project-suggestions'); entryInput.setAttribute('aria-expanded', 'false');
  suggestions = el('ul', 'suggestions'); suggestions.id = 'project-suggestions'; suggestions.setAttribute('role', 'listbox'); suggestions.setAttribute('aria-label', t('project'));
  entryHint = el('p', 'entry-hint'); entryInput.addEventListener('input', () => { selectedSuggestion = -1; renderSuggestions(); });
  entryInput.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!suggestionProjects.length) return; selectedSuggestion = selectedSuggestion < 0 ? (event.key === 'ArrowDown' ? 0 : suggestionProjects.length - 1) : (selectedSuggestion + (event.key === 'ArrowDown' ? 1 : -1) + suggestionProjects.length) % suggestionProjects.length; renderSuggestions(false); suggestions.children[selectedSuggestion]?.scrollIntoView({ block: 'nearest' }); }
    else if (event.key === 'Enter') { event.preventDefault(); const name = selectedSuggestion >= 0 ? suggestionProjects[selectedSuggestion]?.name : entryInput.value; if (name?.trim()) void startProject(name); }
  });
  append(projectEntry, label, entryInput, suggestions, entryHint);
  const footer = el('footer', 'entry-footer'); const links = el('div', 'button-row'); append(links, button(t('overview'), () => nativeAction(window.timi.openWindow('overview')), 'quiet'), button(t('settings'), () => nativeAction(window.timi.openWindow('settings')), 'quiet'));
  append(footer, links, button(t('quit'), () => nativeAction(window.timi.quit()), 'quiet')); append(page, header, statusPanel, reminderPanel, projectEntry, footer); content.replaceChildren(page);
}
async function startProject(name: string): Promise<void> { if (await send({ type: 'start', name })) { entryInput.value = ''; selectedSuggestion = -1; renderSuggestions(); await nativeAction(window.timi.closeWindow()); } }
function renderSuggestions(recompute = true): void {
  if (!state) return;
  if (recompute) { const query = entryInput.value.trim().normalize('NFC').toLowerCase(); suggestionProjects = state.projects.filter(project => !project.archived && project.name.normalize('NFC').toLowerCase().includes(query)).sort((a, b) => a.name.localeCompare(b.name, locale)); }
  if (selectedSuggestion >= suggestionProjects.length) selectedSuggestion = -1;
  suggestions.replaceChildren(); suggestionProjects.forEach((project, index) => {
    const item = el('li', index === selectedSuggestion ? 'selected' : ''); item.id = `suggestion-${index}`; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(index === selectedSuggestion));
    item.append(el('span', '', project.name)); if (state.mode === 'work' && state.active?.projectId === project.id) item.append(el('span', 'suggestion-running', t('current')));
    item.addEventListener('mousedown', event => event.preventDefault()); item.addEventListener('click', () => { void startProject(project.name); }); suggestions.append(item);
  });
  entryInput.setAttribute('aria-expanded', String(suggestionProjects.length > 0));
  if (selectedSuggestion >= 0) entryInput.setAttribute('aria-activedescendant', `suggestion-${selectedSuggestion}`); else entryInput.removeAttribute('aria-activedescendant');
  entryHint.textContent = !state.projects.some(project => !project.archived) && !entryInput.value.trim() ? t('noProjects') : !suggestionProjects.length && entryInput.value.trim() ? t('noMatches') : t('entryHint');
}
let entryControlSignature = '';
function updateEntry(): void {
  const target = dailyTargetMs(state.settings.workGoals, state.now);
  todayValue.textContent = `${fmt(state.todayMs)}${target > 0 ? ` / ${fmt(target)}` : ''}`; statusPanel.className = `status ${state.mode}`;
  if (state.mode === 'work') { statusTitle.textContent = projectName(state.active?.projectId ?? null); statusDetail.textContent = `${t('working')} · ${fmt(state.now - (state.active?.start ?? state.now))}`; statusMark.textContent = '●'; }
  else if (state.mode === 'break') { statusTitle.textContent = t('manualBreak'); statusDetail.textContent = `${fmt(state.now - (state.active?.start ?? state.now))} · ${t('break')}`; statusMark.textContent = 'Ⅱ'; }
  else if (state.mode === 'pending') { statusTitle.textContent = t('pending'); statusDetail.textContent = t('pendingDetail'); statusMark.textContent = '?'; }
  else { statusTitle.textContent = t('untracked'); statusDetail.textContent = t('untrackedDetail'); statusMark.textContent = '○'; }
  const controlsSignature = `${state.mode}:${state.resumeProjectId}`;
  if (controlsSignature !== entryControlSignature) {
    entryControlSignature = controlsSignature; trackingControls.replaceChildren();
    if (state.mode === 'work') trackingControls.append(markAction(button(t('pause'), () => send({ type: 'pause' }))));
    if (state.mode === 'break' && state.resumeProjectId) trackingControls.append(markAction(button(t('play'), () => send({ type: 'resume' }))));
    if (state.mode !== 'untracked') trackingControls.append(markAction(button(t('stop'), () => send({ type: 'stop' }), 'quiet')));
  }
  reminderPanel.hidden = !state.reminderDue || state.mode !== 'untracked';
  const signature = JSON.stringify(state.projects) + state.active?.projectId;
  if (signature !== projectSignature) { projectSignature = signature; renderSuggestions(); }
}

let weekRange: HTMLElement;
let workSummary: HTMLElement;
let breakSummary: HTMLElement;
let projectSummary: HTMLElement;
let weekTable: HTMLElement;
let recordTable: HTMLElement;
let managerList: HTMLElement;
let nextWeekButton: HTMLButtonElement;
let currentWeekButton: HTMLButtonElement;
let tableSignature = '';
let recordsSignature = '';
function buildOverview(): void {
  const page = el('div', 'page overview-page'); const header = el('header', 'page-header row between'); const title = el('div'); append(title, el('h1', '', t('weekTitle')), el('p', 'muted tiny', t('weekSubtitle')));
  const navigation = el('nav', 'week-navigation'); const previous = button('‹', async () => { weekOffset--; await refresh(); }, 'icon'); previous.setAttribute('aria-label', t('previousWeek'));
  nextWeekButton = button('›', async () => { weekOffset++; await refresh(); }, 'icon'); nextWeekButton.setAttribute('aria-label', t('nextWeek')); weekRange = el('span', 'week-range');
  currentWeekButton = button(t('thisWeek'), async () => { weekOffset = 0; await refresh(); });
  append(navigation, previous, weekRange, nextWeekButton, currentWeekButton);
  const settings = button(t('settings'), () => nativeAction(window.timi.openWindow('settings')), 'workspace-settings');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
  icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7'); icon.setAttribute('stroke-linecap', 'round');
  const lines = document.createElementNS(icon.namespaceURI, 'path'); lines.setAttribute('d', 'M3 5h5m4 0h9M3 12h10m4 0h4M3 19h2m4 0h12'); icon.append(lines);
  for (const [x, y] of [[10, 5], [15, 12], [7, 19]]) {
    const circle = document.createElementNS(icon.namespaceURI, 'circle'); circle.setAttribute('cx', String(x)); circle.setAttribute('cy', String(y)); circle.setAttribute('r', '2'); icon.append(circle);
  }
  settings.prepend(icon);
  const actions = el('div', 'overview-header-actions'); append(actions, navigation, settings); append(header, title, actions);
  const summaries = el('section', 'summary-grid');
  function summary(title: string, caption: string): HTMLElement { const card = el('div', 'card summary-card'); const value = el('div', 'summary-number mono'); append(card, el('div', 'eyebrow', title), value, el('p', 'muted summary-caption', caption)); summaries.append(card); return value; }
  workSummary = summary(t('workTotal'), t('actualTime')); breakSummary = summary(t('breaks'), t('breaksSeparate')); projectSummary = summary(t('trackedProjects'), t('projectsThisWeek'));
  weekTable = el('div', 'table-wrap'); const note = el('p', 'overview-note', t('dayNote'));
  const recordsHeader = el('div', 'section-header row between'); append(recordsHeader, el('h2', '', t('records')), button(t('addRecord'), () => openEditor(), 'primary')); recordTable = el('div', 'table-wrap');
  const manager = el('details', 'card projects-panel'); append(manager, el('summary', '', t('manageProjects')), el('p', 'field-help', t('manageHelp'))); managerList = el('div', 'project-manager-list'); manager.append(managerList);
  const createRow = el('form', 'project-create-row'); const name = el('input'); name.placeholder = t('newProjectName'); name.setAttribute('aria-label', t('newProjectName')); name.autocomplete = 'off'; const create = markAction(button(t('createProject'), () => undefined)); create.type = 'submit'; append(createRow, name, create);
  createRow.addEventListener('submit', event => { event.preventDefault(); if (!name.value.trim()) { showError(t('projectNameRequired')); name.focus(); return; } void send({ type: 'createProject', name: name.value }).then(success => { if (success) name.value = ''; }); }); manager.append(createRow);
  append(page, header, summaries, weekTable, note, recordsHeader, recordTable, manager); overviewPage = page; content.append(page);
}
function showWorkspaceView(view: WorkspaceView): void {
  if (view !== 'overview' && view !== 'settings') return;
  if (!overviewPage || !settingsPage) { workspaceView = view; return; }
  const changed = workspaceView !== view;
  if (changed) viewScroll[workspaceView] = window.scrollY;
  workspaceView = view;
  overviewPage.hidden = view !== 'overview'; settingsPage.hidden = view !== 'settings';
  document.title = `timi · ${t(view)}`;
  // Keep correction drafts mounted while their modal is suspended in settings.
  if (view === 'settings') { editorDialog?.close(); void refreshEnvironment(); }
  else if (editorDialog && !editorDialog.open) editorDialog.showModal();
  update();
  if (changed) {
    window.scrollTo(0, viewScroll[view]);
    const heading = (view === 'overview' ? overviewPage : settingsPage).querySelector('h1')!;
    heading.tabIndex = -1; heading.focus({ preventScroll: true });
  }
}
function dayMatches(a: number, b: number): boolean { const left = new Date(a), right = new Date(b); return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate(); }
function updateOverview(): void {
  const week = state.week; weekRange.textContent = `${shortDate(week.start)} – ${shortDate(week.end - 1)} ${new Date(week.end - 1).getFullYear()}`;
  nextWeekButton.disabled = weekOffset >= 0; currentWeekButton.disabled = weekOffset === 0;
  const target = weeklyTargetMs(state.settings.workGoals);
  workSummary.textContent = `${fmt(week.workTotal)}${target > 0 && weekOffset === 0 ? ` / ${fmt(target)}` : ''}`; breakSummary.textContent = fmt(week.breakTotal); projectSummary.textContent = String(week.rows.filter(row => row.total > 0).length);
  const signature = JSON.stringify({ start: week.start, rows: week.rows.map(row => ({ ...row, days: row.days.map(fmt), total: fmt(row.total) })), work: week.workDays.map(fmt), breaks: week.breakDays.map(fmt), totals: [fmt(week.workTotal), fmt(week.breakTotal)] });
  if (signature !== tableSignature) { tableSignature = signature; renderWeekTable(); }
  const records = state.records.filter(record => record.start < week.end && record.end > week.start).sort((a, b) => b.start - a.start);
  const active = state.active && state.active.start < week.end && state.now > week.start ? state.active : null;
  const pending = state.pending && state.pending.start < week.end && (state.pending.end ?? state.now) > week.start ? state.pending : null;
  const logSignature = JSON.stringify([records, state.projects, active, pending, active || pending ? fmt(state.now) : '']);
  if (logSignature !== recordsSignature) { recordsSignature = logSignature; renderRecords(records, !!active, !!pending); }
  const projects = JSON.stringify(state.projects);
  if (projects !== projectSignature) { projectSignature = projects; renderProjectManager(); }
}
function renderWeekTable(): void {
  const week = state.week; const table = el('table'); table.setAttribute('aria-label', t('weekTitle')); const head = el('thead'); const header = el('tr'); header.append(el('th', '', t('project')));
  for (const day of week.days) { const cell = el('th', `number${dayMatches(day, state.now) ? ' today-column' : ''}`, new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(day)); cell.scope = 'col'; cell.append(el('span', 'day-number', new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(day))); header.append(cell); }
  header.append(el('th', 'number', t('total'))); head.append(header); const body = el('tbody');
  for (const row of week.rows) { const tr = el('tr'); const name = el('td', 'project-name', row.name); name.title = row.name; if (row.archived) name.append(el('span', 'archived-tag', t('archived'))); tr.append(name); row.days.forEach((ms, index) => tr.append(el('td', `number${dayMatches(week.days[index], state.now) ? ' today-column' : ''}`, ms ? fmt(ms) : '—'))); tr.append(el('td', 'number', fmt(row.total))); body.append(tr); }
  if (!week.rows.length) { const row = el('tr'); const cell = el('td', 'empty-state', t('emptyWeek')); cell.colSpan = 9; row.append(cell); body.append(row); }
  const foot = el('tfoot'); const total = el('tr'); total.append(el('td', '', t('dailyTotal'))); for (const ms of week.workDays) total.append(el('td', 'number', fmt(ms))); total.append(el('td', 'number', fmt(week.workTotal)));
  const breaks = el('tr', 'break-total-row'); breaks.append(el('td', '', t('breaks'))); for (const ms of week.breakDays) breaks.append(el('td', 'number', fmt(ms))); breaks.append(el('td', 'number', fmt(week.breakTotal))); append(foot, total, breaks); append(table, head, body, foot); weekTable.replaceChildren(table);
}
function renderRecords(records: TimeRecord[], showActive: boolean, showPending: boolean): void {
  if (!records.length && !showActive && !showPending) { recordTable.replaceChildren(el('div', 'empty-state', t('emptyRecords'))); return; }
  const table = el('table', 'records-table'); const head = el('thead'); const tr = el('tr'); for (const key of ['type', 'project', 'start', 'end', 'duration'] as TextKey[]) tr.append(el('th', key === 'duration' ? 'number' : '', t(key))); tr.append(el('th')); head.append(tr); const body = el('tbody');
  function row(item: Pick<TimeRecord, 'kind' | 'start' | 'projectId'> & { end: number }, subtitle: string, saved?: TimeRecord, pending = false): void {
    const tr = el('tr'); const kindCell = el('td'); kindCell.append(el('span', `kind-badge ${pending ? 'pending' : item.kind}`, t(pending ? 'unresolved' : item.kind))); const projectCell = el('td', 'project-name', item.kind === 'work' || pending ? projectName(item.projectId) : '—'); projectCell.append(el('div', 'record-source', subtitle));
    const startCell = el('td', 'mono', dateTime(item.start)); const endCell = el('td', 'mono', saved || state.pending?.end && pending ? dateTime(item.end) : t('live')); const duration = el('td', 'number', pending ? '—' : fmt(item.end - item.start)); duration.title = exact(item.end - item.start); const action = el('td'); if (saved) action.append(button(t('edit'), () => openEditor(saved)));
    append(tr, kindCell, projectCell, startCell, endCell, duration, action); body.append(tr);
  }
  if (showPending && state.pending) { const pending = state.pending; row({ kind: 'work', start: pending.start, end: pending.end ?? state.now, projectId: pending.projectId }, t('unresolved'), undefined, true); }
  if (showActive && state.active) row({ ...state.active, end: state.now }, t('live'));
  const sources: Record<TimeRecord['source'], TextKey> = { manual: 'manualSource', tracked: 'trackedSource', idle: 'idleSource', recovery: 'recoverySource' };
  for (const record of records) row(record, t(sources[record.source]), record);
  append(table, head, body); recordTable.replaceChildren(table);
}
function renderProjectManager(): void {
  managerList.replaceChildren(); if (!state.projects.length) { managerList.append(el('p', 'field-help', t('noManagedProjects'))); return; }
  for (const project of [...state.projects].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, locale))) {
    const row = el('div', `project-manager-item${project.archived ? ' archived' : ''}`); const input = el('input'); input.value = project.name; input.setAttribute('aria-label', `${t('project')}: ${project.name}`); input.autocomplete = 'off';
    const rename = markAction(button(t('rename'), () => send({ type: 'renameProject', id: project.id, name: input.value })));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void send({ type: 'renameProject', id: project.id, name: input.value }); } });
    const archive = markAction(button(t(project.archived ? 'restore' : 'archive'), () => send({ type: 'archiveProject', id: project.id, archived: !project.archived }), 'quiet')); append(row, input, rename, archive); managerList.append(row);
  }
}

let loginCheckbox: HTMLInputElement | null = null;
let loginDescription: HTMLElement | null = null;
async function refreshEnvironment(): Promise<void> {
  const result = await safe(window.timi.environment());
  if (!result.ok) { showError(result.error); return; }
  env = result.value;
  if (loginCheckbox) { loginCheckbox.checked = env.launchAtLogin; loginCheckbox.disabled = !env.loginAvailable; }
  if (loginDescription) loginDescription.textContent = t(!env.loginAvailable ? 'loginUnavailable' : env.launchAtLoginStatus === 'requires-approval' ? 'loginApproval' : 'loginHelp');
}
function buildSettings(): void {
  const page = el('div', 'page settings-page');
  const header = el('header', 'page-header row between');
  const title = el('div'); append(title, el('h1', '', t('settingsTitle')), el('p', 'muted tiny', t('settingsIntro')));
  append(header, title, button(`‹ ${t('overview')}`, () => nativeAction(window.timi.openWindow('overview')))); page.append(header);
  const form = el('form', 'settings-form'); const timing = el('section', 'card settings-section');
  timing.append(el('h2', 'settings-section-title', t('timing')));
  const idle = el('input'); idle.type = 'text'; idle.inputMode = 'numeric'; idle.value = String(state.settings.idleMinutes); idle.autocomplete = 'off'; idle.id = 'idle-minutes';
  const reminder = el('input'); reminder.type = 'text'; reminder.inputMode = 'numeric'; reminder.value = String(state.settings.reminderMinutes); reminder.autocomplete = 'off'; reminder.id = 'reminder-minutes';
  for (const [input, label, help] of [[idle, 'idleThreshold', 'idleHelp'], [reminder, 'reminderInterval', 'reminderHelp']] as const) {
    const field = labelField(t(label), input, t(help)); const unit = el('div', 'input-unit'); input.replaceWith(unit); append(unit, input, el('span', '', t('minutes'))); timing.append(field);
  }
  const goals = el('section', 'card settings-section work-goals-section');
  const heading = el('header', 'work-goals-heading');
  append(heading, el('h2', '', t('workGoals')), el('p', 'field-help', t('workGoalsIntro')));
  const weekly = el('div', 'goal-week-summary'); weekly.setAttribute('aria-live', 'polite');
  const weekLabel = el('div', 'goal-week-label'); const weekDays = el('small');
  append(weekLabel, el('strong', '', t('weeklyTarget')), weekDays);
  const weekValue = el('span', 'goal-week-value mono');
  append(weekly, weekLabel, weekValue);
  const days = el('div', 'workday-list');
  const dayVisuals: { row: HTMLElement; meter: HTMLMeterElement; rest: HTMLElement }[] = [];
  let remainingToggle: HTMLInputElement | undefined;
  const hours = state.settings.workGoals.dailyHours.map((value, index) => {
    const input = el('input'); input.type = 'text'; input.inputMode = 'decimal'; input.autocomplete = 'off'; input.id = `work-hours-${index}`;
    input.setAttribute('aria-describedby', 'work-hours-help');
    input.value = new Intl.NumberFormat(locale, { maximumFractionDigits: 15, useGrouping: false }).format(value);
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 0, 5 + index));
    const row = el('div', `workday-row${index === 5 ? ' weekend-start' : ''}`);
    const label = el('label', 'workday-name', weekday); label.htmlFor = input.id;
    const visual = el('div', 'workday-visual'); visual.setAttribute('aria-hidden', 'true');
    const meter = el('meter', 'workday-meter'); meter.min = 0; meter.max = 8;
    const rest = el('span', 'workday-rest', t('dayOff')); append(visual, meter, rest);
    const unit = el('div', 'workday-hours'); const unitLabel = el('span', '', 'h'); unitLabel.setAttribute('aria-hidden', 'true');
    append(unit, input, unitLabel); append(row, label, visual, unit); days.append(row);
    dayVisuals.push({ row, meter, rest }); return input;
  });
  function updateWeeklyTarget(): void {
    const values = hours.map(input => parseWorkHours(input.value));
    if (remainingToggle) remainingToggle.disabled = !values.some(value => value !== null && value > 0);
    weekValue.textContent = values.every(value => value !== null) ? `${fmt(values.reduce<number>((sum, value) => sum + hoursMs(value!), 0))} h` : '—';
    weekDays.textContent = t('goalDays', { days: values.filter(value => value !== null && value > 0).length });
    const maximum = Math.max(8, ...values.map(value => value ?? 0));
    dayVisuals.forEach(({ row, meter, rest }, index) => {
      const value = values[index];
      row.classList.toggle('day-off', value === 0);
      meter.max = maximum; meter.value = value ?? 0; meter.hidden = value === null || value === 0;
      rest.hidden = value !== 0;
      hours[index]!.setAttribute('aria-invalid', String(value === null));
    });
  }
  updateWeeklyTarget();
  const hoursHelp = el('p', 'work-hours-help', t('workGoalsHelp')); hoursHelp.id = 'work-hours-help';
  const reminders = el('div', 'goal-reminders'); reminders.append(el('h3', '', t('goalReminders')));
  function goalToggle(text: string, help: string, checked: boolean, id: string, parent: HTMLElement = reminders): HTMLInputElement {
    const label = el('label', 'goal-toggle');
    const description = el('span', 'goal-toggle-copy'); const title = el('strong', '', text); title.id = `${id}-label`;
    const hint = el('small', '', help); hint.id = `${id}-help`; append(description, title, hint);
    const control = el('span', 'goal-switch'); const input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = checked;
    input.setAttribute('role', 'switch'); input.setAttribute('aria-labelledby', title.id); input.setAttribute('aria-describedby', hint.id);
    const track = el('span', 'goal-switch-track'); track.setAttribute('aria-hidden', 'true'); append(control, input, track);
    append(label, description, control); parent.append(label); return input;
  }
  const display = el('div', 'goal-reminders'); display.append(el('h3', '', t('menuBarDisplay')));
  remainingToggle = goalToggle(t('showRemaining'), t('showRemainingHelp'), state.settings.workGoals.showRemaining === true, 'show-remaining', display);
  remainingToggle.disabled = !state.settings.workGoals.dailyHours.some(value => value > 0);
  display.append(el('p', 'work-hours-help', t('showRemainingFallback')));
  const notifyDaily = goalToggle(t('dailyGoalToggle'), t('dailyGoalHelp'), state.settings.workGoals.notifyDaily, 'notify-daily');
  const notifyWeekly = goalToggle(t('weeklyGoalToggle'), t('weeklyGoalHelp'), state.settings.workGoals.notifyWeekly, 'notify-weekly');
  const notificationHelp = el('details', 'goal-notification-help');
  append(notificationHelp, el('summary', '', t('goalNotificationSummary')), el('p', 'field-help', t('goalNotificationHelp')));
  append(goals, heading, weekly, days, hoursHelp, display);
  const preferences = el('section', 'card settings-section'); append(preferences, reminders, notificationHelp);
  const loginSection = el('section', 'card settings-section'); const loginLabel = el('label', 'setting-toggle'); const text = el('span'); loginDescription = el('small', '', t(!env.loginAvailable ? 'loginUnavailable' : env.launchAtLoginStatus === 'requires-approval' ? 'loginApproval' : 'loginHelp')); append(text, el('strong', '', t('launchAtLogin')), loginDescription);
  const login = el('input'); loginCheckbox = login; login.type = 'checkbox'; login.checked = env.launchAtLogin; login.disabled = !env.loginAvailable; loginLabel.append(text, login); loginSection.append(loginLabel);
  login.addEventListener('change', async () => { login.disabled = true; const result = await safe(window.timi.setLaunchAtLogin(login.checked)); if (result.ok) { login.checked = result.value; env.launchAtLogin = result.value; } else { login.checked = env.launchAtLogin; showError(result.error); } await refreshEnvironment(); });
  const footer = el('div', 'settings-footer');
  const info = el('div', 'settings-footer-info');
  const saved = el('span', 'saved-status'); saved.setAttribute('role', 'status');
  append(info, el('p', 'privacy-note', t('privacy')), el('p', 'privacy-note', t('version', { version: env.version })), saved);
  const save = markAction(button(t('saveSettings'), () => undefined, 'primary')); save.type = 'submit'; append(footer, info, save);
  const schedule = el('div', 'settings-side'); append(schedule, goals);
  const preferencesSide = el('div', 'settings-side'); append(preferencesSide, timing, preferences, loginSection);
  append(form, schedule, preferencesSide, footer);
  function positiveMinutes(value: string): number | null { const input = value.trim(); if (!/^\d+$/.test(input)) return null; const number = Number(input); return number > 0 && Number.isSafeInteger(number) && Number.isSafeInteger(number * 60_000) ? number : null; }
  form.addEventListener('submit', event => {
    event.preventDefault(); const idleMinutes = positiveMinutes(idle.value), reminderMinutes = positiveMinutes(reminder.value);
    if (idleMinutes === null || reminderMinutes === null) { showError(t('invalidSettings')); return; }
    const dailyHours = hours.map(input => parseWorkHours(input.value));
    if (dailyHours.some(value => value === null)) { showError(t('invalidWorkHours')); return; }
    void send({ type: 'settings', idleMinutes, reminderMinutes, workGoals: { dailyHours: dailyHours as number[], notifyDaily: notifyDaily.checked, notifyWeekly: notifyWeekly.checked, showRemaining: remainingToggle!.checked } }).then(success => {
      if (success) { saved.textContent = t('saved'); idle.value = String(state.settings.idleMinutes); reminder.value = String(state.settings.reminderMinutes); }
    });
  });
  for (const input of [...hours, notifyDaily, notifyWeekly, remainingToggle]) input.addEventListener('input', () => { saved.textContent = ''; updateWeeklyTarget(); });
  idle.addEventListener('input', () => { saved.textContent = ''; }); reminder.addEventListener('input', () => { saved.textContent = ''; });
  page.append(form); settingsPage = page; content.append(page);
}

let clarificationDescription: HTMLElement;
let clarificationDuration: HTMLElement;
let clarificationStart: HTMLElement;
let clarificationEnd: HTMLElement;
let clarificationNote: HTMLElement;
let recoveryField: HTMLElement;
let recoveryInput: HTMLInputElement;
let recoveryOptions: HTMLDataListElement;
let workChoice: HTMLButtonElement;
let clarificationPendingId = '';
function buildClarification(): void {
  const page = el('div', 'clarification-page'); const title = el('div'); append(title, el('h1', '', t('clarificationTitle'))); clarificationDescription = el('p', 'clarification-description'); title.append(clarificationDescription);
  const interval = el('section', 'interval-card'); clarificationDuration = el('div', 'interval-duration mono'); const dates = el('div', 'interval-dates mono'); clarificationStart = el('div'); clarificationEnd = el('div'); append(dates, clarificationStart, clarificationEnd); append(interval, clarificationDuration, dates);
  recoveryInput = el('input'); recoveryInput.placeholder = t('recoveryPlaceholder'); recoveryInput.autocomplete = 'off'; recoveryInput.setAttribute('list', 'recovery-projects'); recoveryOptions = el('datalist'); recoveryOptions.id = 'recovery-projects'; recoveryField = labelField(t('recoveryProject'), recoveryInput, t('recoveryHelp')); recoveryField.append(recoveryOptions);
  const choices = el('div', 'clarification-choices');
  workChoice = markAction(button(t('workChoice'), async () => {
    if (!state.pending) return;
    if (state.pending.reason === 'recovery') { const name = recoveryInput.value.trim(); if (!name) { showError(t('projectNameRequired')); recoveryInput.focus(); return; } const existing = state.projects.find(project => project.name.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase()); await send({ type: 'resolve', pendingId: state.pending.id, choice: 'work', ...(existing ? { projectId: existing.id } : { projectName: name }) }); }
    else await send({ type: 'resolve', pendingId: state.pending.id, choice: 'work' });
  }, 'primary'));
  const breakChoice = markAction(button(t('breakChoice'), () => state.pending ? send({ type: 'resolve', pendingId: state.pending.id, choice: 'break' }) : undefined)); breakChoice.append(el('span', 'choice-subtitle', t('breakChoiceHelp')));
  const discard = markAction(button(t('discardChoice'), () => state.pending ? send({ type: 'resolve', pendingId: state.pending.id, choice: 'discard' }) : undefined, 'quiet')); discard.append(el('span', 'choice-subtitle', t('discardChoiceHelp'))); append(choices, workChoice, breakChoice, discard);
  clarificationNote = el('p', 'clarification-note'); append(page, title, interval, recoveryField, choices, clarificationNote); content.replaceChildren(page);
}
function updateClarification(): void {
  const pending = state.pending;
  if (!pending) { content.replaceChildren(el('div', 'loading', t('awaiting'))); return; }
  if (!content.contains(clarificationDuration)) buildClarification();
  const recovery = pending.reason === 'recovery'; clarificationDescription.textContent = t(recovery ? 'clarificationRecovery' : 'clarificationIdle'); recoveryField.hidden = !recovery;
  clarificationDuration.textContent = fmt((pending.end ?? state.now) - pending.start); clarificationDuration.title = exact((pending.end ?? state.now) - pending.start);
  clarificationStart.textContent = t('intervalFrom', { date: dateTime(pending.start) }); clarificationEnd.textContent = t('intervalTo', { date: dateTime(pending.end ?? state.now) });
  workChoice.textContent = recovery ? t('workChoice') : t('workFor', { project: projectName(pending.projectId) });
  clarificationNote.textContent = t(recovery ? 'recoveryContinuing' : pending.resume && pending.end === null ? 'idleContinuing' : 'fixedContinuing');
  if (pending.id !== clarificationPendingId) { clarificationPendingId = pending.id; recoveryInput.value = pending.projectId ? projectName(pending.projectId) : ''; recoveryOptions.replaceChildren(...state.projects.map(project => { const option = el('option'); option.value = project.name; return option; })); }
}

interface SegmentState { record: RecordInput; startInput?: HTMLInputElement; endInput?: HTMLInputElement; startOccurrence?: HTMLSelectElement; endOccurrence?: HTMLSelectElement; kindInput?: HTMLSelectElement; projectInput?: HTMLSelectElement }
let editorDialog: HTMLDialogElement | null = null;
function parseLocalInput(value: string, original: number, occurrence?: HTMLSelectElement): number {
  const possible = possibleLocalTimes(value);
  if (occurrence && possible.includes(Number(occurrence.value))) return Number(occurrence.value);
  return possible.includes(original) ? original : possible[0] ?? NaN;
}
function utcOffset(ms: number): string { const minutes = -new Date(ms).getTimezoneOffset(); return `UTC${minutes >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`; }
function openEditor(record?: TimeRecord): void {
  editorDialog?.close(); editorDialog?.remove();
  const now = Math.floor(state.now / 60_000) * 60_000;
  const segments: SegmentState[] = [{ record: record ? { start: record.start, end: record.end, kind: record.kind, projectId: record.projectId } : { start: now - 3600_000, end: now, kind: 'work', projectId: state.projects.find(project => !project.archived)?.id ?? null } }];
  const dialog = el('dialog'); editorDialog = dialog; dialog.setAttribute('aria-labelledby', 'editor-title'); const editor = el('form', 'editor'); editor.noValidate = true; const header = el('div', 'editor-header'); const title = el('h2', '', t(record ? 'editTimeTitle' : 'addTimeTitle')); title.id = 'editor-title'; const close = button('×', closeEditor, 'quiet icon'); close.setAttribute('aria-label', t('close')); append(header, title, close);
  const intro = el('p', 'editor-intro', t(record ? 'editHelp' : 'addHelp')); const segmentList = el('div', 'editor-segments'); const editorError = el('p', 'editor-error'); editorAlert = editorError; editorError.setAttribute('role', 'alert');
  const actions = el('div', 'editor-actions'); const left = el('div'); const right = el('div', 'button-row'); const save = button(t('saveChanges'), () => undefined, 'primary'); save.type = 'submit'; append(right, button(t('cancel'), closeEditor), save); append(actions, left, right);
  const deleteConfirm = el('div', 'delete-confirm'); deleteConfirm.hidden = true; deleteConfirm.append(el('p', '', t('deleteConfirm'))); const deleteButtons = el('div', 'button-row');
  if (record) {
    left.append(button(t('deleteRecord'), () => { deleteConfirm.hidden = false; }, 'quiet danger'));
    append(deleteButtons, button(t('confirmDelete'), async () => { if (busy) return; save.disabled = true; if (await send({ type: 'correct', removeIds: [record.id], records: [] })) closeEditor(); else save.disabled = false; }, 'danger'), button(t('keepRecord'), () => { deleteConfirm.hidden = true; })); deleteConfirm.append(deleteButtons);
  }
  function closeEditor(): void { dialog.close(); dialog.remove(); if (editorDialog === dialog) { editorDialog = null; editorAlert = null; } }
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  function collect(): RecordInput[] | null {
    const result: RecordInput[] = [];
    for (const segment of segments) {
      const start = parseLocalInput(segment.startInput!.value, segment.record.start, segment.startOccurrence), end = parseLocalInput(segment.endInput!.value, segment.record.end, segment.endOccurrence);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) { editorError.textContent = t('invalidDate'); return null; }
      const kind = segment.kindInput!.value === 'break' ? 'break' : 'work'; const projectId = kind === 'work' ? segment.projectInput!.value || null : null;
      if (kind === 'work' && !projectId) { editorError.textContent = t('invalidProject'); return null; }
      result.push({ start, end, kind, projectId });
    }
    return result;
  }
  function preserve(): boolean { const records = collect(); if (!records) return false; records.forEach((item, index) => { segments[index].record = item; }); return true; }
  function renderSegments(): void {
    segmentList.replaceChildren(); segments.forEach((segment, index) => {
      const card = el('section', 'segment'); const title = el('div', 'segment-title'); title.append(el('strong', '', t('segment', { number: index + 1 }))); const controls = el('div', 'button-row');
      const split = button(t('split'), () => { if (!preserve()) return; const item = segment.record; const midpoint = item.start + Math.floor((item.end - item.start) / 2); if (midpoint <= item.start || midpoint >= item.end) { editorError.textContent = t('splitTooShort'); return; } segments.splice(segments.indexOf(segment), 1, { record: { ...item, end: midpoint } }, { record: { ...item, start: midpoint } }); editorError.textContent = ''; renderSegments(); }); split.title = t('splitHelp'); controls.append(split);
      if (segments.length > 1) { const remove = button(t('removeSegment'), () => { segments.splice(segments.indexOf(segment), 1); card.remove(); [...segmentList.children].forEach((node, position) => { const heading = node.querySelector('.segment-title strong'); if (heading) heading.textContent = t('segment', { number: position + 1 }); const removeButton = node.querySelector<HTMLButtonElement>('[data-remove]'); if (removeButton) removeButton.hidden = segments.length < 2; }); }, 'quiet'); remove.dataset.remove = 'true'; controls.append(remove); } title.append(controls);
      const grid = el('div', 'segment-grid'); const start = el('input'); start.type = 'datetime-local'; start.step = '0.001'; start.required = true; start.value = localDateInput(segment.record.start); const end = el('input'); end.type = 'datetime-local'; end.step = '0.001'; end.required = true; end.value = localDateInput(segment.record.end); segment.startInput = start; segment.endInput = end;
      const kind = el('select'); kind.dataset.field = 'kind'; for (const value of ['work', 'break'] as const) { const option = el('option', '', t(value)); option.value = value; kind.append(option); } kind.value = segment.record.kind; segment.kindInput = kind;
      const project = el('select'); project.dataset.field = 'project'; const blank = el('option', '', t('chooseProject')); blank.value = ''; project.append(blank); for (const item of state.projects) { const option = el('option', '', `${item.name}${item.archived ? ` (${t('archived')})` : ''}`); option.value = item.id; project.append(option); } project.value = segment.record.projectId ?? ''; project.disabled = kind.value === 'break'; segment.projectInput = project;
      kind.addEventListener('change', () => { project.disabled = kind.value === 'break'; });
      const startField = labelField(t('start'), start), endField = labelField(t('end'), end);
      const startOccurrence = el('select'), endOccurrence = el('select'); startOccurrence.dataset.field = 'start-occurrence'; endOccurrence.dataset.field = 'end-occurrence'; segment.startOccurrence = startOccurrence; segment.endOccurrence = endOccurrence;
      startOccurrence.setAttribute('aria-label', `${t('start')}: ${t('ambiguousTime')}`); endOccurrence.setAttribute('aria-label', `${t('end')}: ${t('ambiguousTime')}`);
      const startAmbiguity = el('div', 'ambiguity'), endAmbiguity = el('div', 'ambiguity'); append(startAmbiguity, el('p', 'field-help', t('ambiguousTime')), startOccurrence); append(endAmbiguity, el('p', 'field-help', t('ambiguousTime')), endOccurrence); startField.append(startAmbiguity); endField.append(endAmbiguity);
      append(grid, startField, endField, labelField(t('type'), kind), labelField(t('project'), project));
      const duration = el('p', 'segment-duration'); const boundary = el('p', 'field-help');
      function updateOccurrence(input: HTMLInputElement, select: HTMLSelectElement, wrapper: HTMLElement, original: number): void {
        const candidates = possibleLocalTimes(input.value), prior = select.value ? Number(select.value) : original;
        const selected = candidates.includes(prior) ? prior : candidates.includes(original) ? original : candidates[0];
        select.replaceChildren(...candidates.map((candidate, index) => { const option = el('option', '', t(index === 0 ? 'firstOccurrence' : 'secondOccurrence', { offset: utcOffset(candidate) })); option.value = String(candidate); return option; }));
        if (selected !== undefined) select.value = String(selected); wrapper.hidden = candidates.length < 2;
      }
      function updateDuration(): void { const startMs = parseLocalInput(start.value, segment.record.start, startOccurrence), endMs = parseLocalInput(end.value, segment.record.end, endOccurrence); duration.textContent = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? `${t('duration')}: ${exact(endMs - startMs)} (${fmt(endMs - startMs)})` : t('invalidDate'); boundary.textContent = Number.isFinite(startMs) && Number.isFinite(endMs) ? t('boundaryHelp', { offset: `${utcOffset(startMs)} → ${utcOffset(endMs)}` }) : ''; }
      function updateBoundaries(): void { updateOccurrence(start, startOccurrence, startAmbiguity, segment.record.start); updateOccurrence(end, endOccurrence, endAmbiguity, segment.record.end); updateDuration(); }
      start.addEventListener('input', updateBoundaries); end.addEventListener('input', updateBoundaries); startOccurrence.addEventListener('change', updateDuration); endOccurrence.addEventListener('change', updateDuration); updateBoundaries(); append(card, title, grid, duration, boundary); segmentList.append(card);
    });
  }
  editor.addEventListener('submit', async event => { event.preventDefault(); const records = collect(); if (!records || busy) return; editorError.textContent = ''; save.disabled = true; const success = await send({ type: 'correct', removeIds: record ? [record.id] : [], records }); if (success) closeEditor(); else { editorError.textContent = errors.textContent?.replace(/×$/, '') ?? t('errorGeneric'); save.disabled = false; } });
  append(editor, header, intro, segmentList, editorError, deleteConfirm, actions); dialog.append(editor); content.append(dialog); renderSegments(); dialog.showModal(); segments[0].startInput?.focus();
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (kind === 'clarification') { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (editorDialog?.open) return;
  if (kind === 'entry') { event.preventDefault(); void nativeAction(window.timi.closeWindow()); }
});

async function initialize(): Promise<void> {
  content.append(el('div', 'loading', t('loading')));
  const [environmentResult, snapshotResult, viewResult] = await Promise.all([safe(window.timi.environment()), safe(window.timi.snapshot()), kind === 'overview' ? safe(window.timi.workspaceView()) : Promise.resolve(null)]);
  if (!environmentResult.ok || !snapshotResult.ok || (viewResult && !viewResult.ok)) {
    app.setAttribute('aria-busy', 'false'); if (environmentResult.ok) locale = environmentResult.value.locale;
    content.replaceChildren(el('div', 'loading')); content.firstChild?.appendChild(button(t('refresh'), initialize));
    showError(!environmentResult.ok ? environmentResult.error : !snapshotResult.ok ? snapshotResult.error : viewResult && !viewResult.ok ? viewResult.error : { code: 'STORAGE_ERROR' }); return;
  }
  env = environmentResult.value; locale = env.locale; state = snapshotResult.value; document.documentElement.lang = locale; app.setAttribute('aria-busy', 'false'); document.title = kind === 'entry' ? 'timi' : `timi · ${t(kind === 'overview' ? 'overview' : 'clarificationTitle')}`;
  if (kind === 'entry') buildEntry();
  else if (kind === 'overview') {
    content.replaceChildren(); buildOverview(); buildSettings();
    showWorkspaceView(viewResult?.ok ? viewResult.value : workspaceView);
  } else buildClarification();
  update(); if (kind === 'entry') entryInput.focus();
  window.timi.onChanged(() => { void refresh(); }); window.timi.onError(showError); window.timi.onFocus(() => { if (kind === 'entry') entryInput.focus(); if (kind === 'overview' && workspaceView === 'settings') void refreshEnvironment(); void refresh(); });
  setInterval(() => { if (!document.hidden && !busy) void refresh(); }, 1000);
}
if (kind === 'overview') window.timi.onNavigate(showWorkspaceView);
void initialize();
